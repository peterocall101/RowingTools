// Sample mode - the tracker with no account.
//
// The whole app runs, unmodified, against a stand-in for the Supabase client
// that reads and writes one localStorage blob instead of the database. That is
// the point: there is no second, cut-down version of the tracker to keep in
// step with the real one, and nothing in app.js has to ask "am I in a trial?"
// before every save. Only three things differ, and each is refused at the one
// place it happens: erg-photo parsing (it costs money per call), squads (they
// need a real identity), and cross-device anything.
//
// Sample data is device-local and disposable. Creating an account uploads it
// in one go - see migrateTrial() in app.js - which is the only reason the ids
// written here are real uuids: they become the primary keys, so the exercise
// ids that a saved workout's `sets` object is keyed by survive the move.

const TRIAL_FLAG  = 'rt-trial';
const TRIAL_STORE = 'rt-trial-store';
const TRIAL_UID   = 'sample-local';
// Bumped only if the shape of the blob changes in a way an old one can't meet.
const TRIAL_V     = 1;

const trialActive = () => {
  try { return localStorage.getItem(TRIAL_FLAG) === '1'; }
  catch (e) { if (e instanceof TypeError) return false; throw e; }
};
const trialStart = () => localStorage.setItem(TRIAL_FLAG, '1');
const trialEnd   = () => { localStorage.removeItem(TRIAL_FLAG); localStorage.removeItem(TRIAL_STORE); };

function trialUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

// A sample that opens on an empty exercise library is not a sample of
// anything: the Weights tab would be a picker with nothing in it. So the
// store starts with a plain barbell session and one core circuit, which the
// person can edit or delete like any other - and which come with them if they
// make an account.
function trialSeed() {
  const ex = [
    ['Back Squat', 'Session 1', 'squat', 'reps', false, false, 'Chest tall, knees out'],
    ['Bench Press', 'Session 1', 'push', 'reps', false, false, ''],
    ['Single-arm Row', 'Session 1', 'pull', 'reps', true, false, 'Square hips'],
    ['Plank', 'Session 1', 'core', 'secs', false, true, ''],
    ['Deadlift', 'Session 2', 'hinge', 'reps', false, false, ''],
    ['Overhead Press', 'Session 2', 'shoulders', 'reps', false, false, ''],
    ['Chin-up', 'Session 2', 'pull', 'reps', false, true, ''],
    ['Bulgarian Split Squat', 'Session 2', 'legs', 'reps', true, false, ''],
  ].map((r, i) => ({
    id: trialUuid(), profile_id: TRIAL_UID, name: r[0], session_groups: [r[1]],
    pattern: r[2], unit: r[3], per_side: r[4], bodyweight: r[5], note: r[6] || null,
    position: i, retired: false, created_at: new Date().toISOString(),
  }));
  return {
    v: TRIAL_V,
    started_at: new Date().toISOString(),
    profiles: { id: TRIAL_UID, display_name: 'Sample', tracker_plan: 'free' },
    tracker_exercises: ex,
    tracker_workouts: [],
    tracker_erg_sessions: [],
    tracker_water_sessions: [],
    tracker_core_routines: [{
      id: trialUuid(), profile_id: TRIAL_UID, name: 'Core circuit', position: 0, retired: false,
      steps: [
        { name: 'Front plank', target_s: 60, per_side: false },
        { name: 'Side plank', target_s: 45, per_side: true },
        { name: 'Dead bug', target_s: 40, per_side: false },
        { name: 'Hollow hold', target_s: 30, per_side: false },
      ],
      created_at: new Date().toISOString(),
    }],
    tracker_core_sessions: [],
  };
}

const TRIAL_LOGS = ['tracker_workouts', 'tracker_erg_sessions',
                    'tracker_water_sessions', 'tracker_core_sessions'];

function trialRead() {
  const raw = localStorage.getItem(TRIAL_STORE);
  if (!raw) return trialSeed();
  // A truncated value is not worth taking the page down for; it is a sample.
  let v;
  try { v = JSON.parse(raw); }
  catch (e) { if (e instanceof SyntaxError) return trialSeed(); throw e; }
  return (v && v.v === TRIAL_V) ? v : trialSeed();
}
function trialWrite(store) {
  // A full quota in sample mode means the sample stops growing, not that the
  // page dies mid-save.
  try { localStorage.setItem(TRIAL_STORE, JSON.stringify(store)); return null; }
  catch (e) {
    if (e.name !== 'QuotaExceededError' && e.name !== 'NS_ERROR_DOM_QUOTA_REACHED') throw e;
    return { message: 'This device is out of storage for the sample. Create an account to keep going.' };
  }
}
// Has anything actually been logged, as opposed to just the seed?
const trialHasWork = store => TRIAL_LOGS.some(t => (store[t] || []).length);
const trialCounts = store => ({
  weights: (store.tracker_workouts || []).length,
  erg: (store.tracker_erg_sessions || []).length,
  water: (store.tracker_water_sessions || []).length,
  core: (store.tracker_core_sessions || []).length,
  exercises: (store.tracker_exercises || []).length,
  routines: (store.tracker_core_routines || []).length,
});

// The slice of PostgREST that app.js actually calls. Deliberately not a
// general query engine: it supports exactly the chains in use, and anything
// else comes back as an error rather than as quietly wrong data.
function trialClient() {
  const table = name => {
    const st = { name, op: 'select', row: null, patch: null, filters: [], orders: [], one: false, cap: 0 };
    const b = {
      select() { return b; },
      single() { st.one = true; return b; },
      maybeSingle() { st.one = true; return b; },
      eq(col, val) { st.filters.push([col, val]); return b; },
      order(col, opts) { st.orders.push([col, !opts || opts.ascending !== false]); return b; },
      limit(n) { st.cap = n; return b; },
      insert(row) { st.op = 'insert'; st.row = row; return b; },
      update(patch) { st.op = 'update'; st.patch = patch; return b; },
      delete() { st.op = 'delete'; return b; },
      then(resolve, reject) { return run(st).then(resolve, reject); },
    };
    return b;
  };
  return {
    from: table,
    // Squads are the one thing sample mode cannot fake: they are other
    // people. Say so rather than returning an empty board that looks broken.
    rpc: () => Promise.resolve({ data: null, error: { message: 'Squads need an account.' } }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: trialSession() } }),
      signOut: () => { trialEnd(); return Promise.resolve({ error: null }); },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };

  async function run(st) {
    const store = trialRead();
    // Tables the sample has no answer for: never invent squad-mates.
    if (!(st.name in store)) return { data: st.one ? null : [], error: null };
    const isRow = !Array.isArray(store[st.name]);

    if (st.op === 'insert') {
      if (isRow) return { data: null, error: { message: 'Cannot insert into ' + st.name } };
      const rows = (Array.isArray(st.row) ? st.row : [st.row]).map(r =>
        Object.assign({ id: trialUuid(), profile_id: TRIAL_UID, created_at: new Date().toISOString() }, r));
      if (rows.some(r => store[st.name].some(x => x.id === r.id))) {
        // Same shape as Postgres, because flushOutbox() reads this code to
        // decide that a retried offline write had already landed.
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      store[st.name] = store[st.name].concat(rows);
      const err = trialWrite(store);
      return { data: err ? null : (st.one ? rows[0] : rows), error: err };
    }

    if (st.op === 'update') {
      if (isRow) { Object.assign(store[st.name], st.patch); return { data: null, error: trialWrite(store) }; }
      store[st.name] = store[st.name].map(r => match(r, st.filters) ? Object.assign({}, r, st.patch) : r);
      return { data: null, error: trialWrite(store) };
    }

    if (st.op === 'delete') {
      if (isRow) return { data: null, error: { message: 'Cannot delete ' + st.name } };
      store[st.name] = store[st.name].filter(r => !match(r, st.filters));
      return { data: null, error: trialWrite(store) };
    }

    // select
    if (isRow) return { data: match(store[st.name], st.filters) ? store[st.name] : null, error: null };
    let out = store[st.name].filter(r => match(r, st.filters));
    st.orders.forEach(([col, asc]) => {
      out = out.slice().sort((a, x) => {
        const av = a[col], xv = x[col];
        if (av === xv) return 0;
        if (av == null) return 1;
        if (xv == null) return -1;
        return (av > xv ? 1 : -1) * (asc ? 1 : -1);
      });
    });
    if (st.cap) out = out.slice(0, st.cap);
    return { data: st.one ? (out[0] || null) : out, error: null };
  }

  function match(row, filters) { return filters.every(([col, val]) => row[col] === val); }
}

// Shaped like a Supabase session so nothing downstream has to special-case it.
const trialSession = () => ({ user: { id: TRIAL_UID, email: null } });
