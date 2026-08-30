// RowingTools Tracker - single-page app logic.
// Weights logging (user-defined exercise library, template share) + erg
// logging (photo -> parse-erg Edge Function -> editable confirm card, or
// manual). All data personal, RLS owner-only. No programme concept.

/* ================= state ================= */
const S = {
  session: null,
  profile: null,
  trial: false,    // sample mode: no account, everything in localStorage
  joinCode: null,  // a ?join= code waiting to be acted on
  exercises: [],   // library rows (including retired - needed for history)
  workouts: [],    // weights sessions, sorted date+at desc
  ergs: [],        // erg sessions, sorted date+at desc
  water: [],       // water outings, sorted date+at desc
  routines: [],    // core routine templates
  coreSessions: [],// logged runs through a core routine
  races: [],       // regatta results claimed from the leaderboards, newest first
};

const PATTERN_ORDER = ['squat', 'pull', 'hinge', 'push', 'legs', 'shoulders', 'arms', 'core', 'other'];
// Date the wording in tracker/terms.html last changed. Stamped on the profile
// at signup so a later change has something to compare against.
const TERMS_VERSION = '2026-08-29';

/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const round1 = n => Math.round(n * 10) / 10;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
const prettyDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const shortDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// An exercise can sit in several sessions while staying ONE exercise with one
// id, so its history, last-time prefill and bests are never split. Tolerates
// rows written before session_groups became an array.
const groupsOf = e => {
  const g = e && e.session_groups;
  if (Array.isArray(g)) return g.filter(Boolean);
  return g ? [g] : ['Session 1'];
};
// Preserves first-seen order rather than sorting, so the athlete's own ordering
// of their sessions survives.
const allGroups = lib => {
  const out = [];
  lib.forEach(e => groupsOf(e).forEach(g => { if (!out.includes(g)) out.push(g); }));
  return out;
};
const parseGroups = str => {
  const list = String(str || '').split(',').map(s => s.trim().slice(0, 40)).filter(Boolean);
  return list.length ? [...new Set(list)] : ['Session 1'];
};

const exById = id => S.exercises.find(e => e.id === id) || null;
const exName = id => { const e = exById(id); return e ? e.name : '(deleted exercise)'; };
const patternOf = id => { const e = exById(id); return e ? e.pattern : 'other'; };
const patIdx = p => { const i = PATTERN_ORDER.indexOf(p); return i < 0 ? PATTERN_ORDER.length : i; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

const sortKey = r => r.date + 'T' + (r.at || '00:00');
const sortDesc = arr => arr.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

// "7:12.3" -> 432.3 | "1:02:05" -> 3725 | "112.4" -> 112.4 | "" -> null
function parseTimeStr(str) {
  if (str == null) return null;
  const t = String(str).trim().replace(',', '.');
  if (!t) return null;
  const parts = t.split(':');
  if (parts.some(p => p === '' || isNaN(Number(p)))) return null;
  let s = 0;
  for (const p of parts) s = s * 60 + Number(p);
  return isNaN(s) ? null : s;
}
// seconds -> "m:ss.t" (or "h:mm:ss" over an hour)
function fmtTime(sec) {
  if (sec == null || isNaN(sec)) return '';
  sec = Math.round(sec * 10) / 10;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = (s < 10 ? '0' : '') + (Number.isInteger(s) ? s + '.0' : s.toFixed(1));
  return h ? h + ':' + pad(m) + ':' + ss.slice(0, 2) : m + ':' + ss;
}
const fmtSplit = sec => sec == null ? '' : fmtTime(sec) + '/500m';

// Null-safe: several holders live inside panels that are rebuilt wholesale, so
// a message can outrace its container. Losing the message beats a crash.
function toast(holderId, msg, cls) {
  const el = $(holderId);
  if (el) el.innerHTML = '<div class="toast ' + (cls || '') + '">' + msg + '</div>';
}

function track(event, params) { if (typeof gtag === 'function') gtag('event', event, params || {}); }

function selectTab(panelId) {
  document.querySelectorAll('.tabs .tab').forEach(t => {
    const on = t.dataset.panel === panelId;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === panelId));
}

/* ================= offline saves =================
   A gym basement has no signal. Every insert carries a client-generated id, so
   a save that failed on the way out can be retried without risking a duplicate:
   if the first attempt did land, the retry hits the primary key and we treat
   that as success. Failed writes sit in a local outbox and go out on the next
   connection. */
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

// A transport failure is retryable; a rejected row is not, and queueing it
// would mean retrying a bad write for ever.
const looksOffline = err => !navigator.onLine ||
  /failed to fetch|networkerror|network request failed|load failed|timeout|fetch failed/i
    .test(String((err && err.message) || ''));

// supabase-js normally hands a network failure back as an error object, but a
// connection that drops mid-flight surfaces as the TypeError fetch() throws.
// Narrow on purpose: anything else is a real bug and must still blow up.
async function updateRow(table, patch, id) {
  try { return await sb.from(table).update(patch).eq('id', id); }
  catch (e) {
    if (!(e instanceof TypeError)) throw e;
    return { error: { message: e.message || 'Failed to fetch' } };
  }
}

async function insertRow(table, row) {
  try { return await sb.from(table).insert(row); }
  catch (e) {
    if (!(e instanceof TypeError)) throw e;
    return { error: { message: e.message || 'Failed to fetch' } };
  }
}

const outboxKey = () => 'rt-outbox-' + (S.session ? S.session.user.id : 'anon');
function readJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  // A truncated or corrupted value is not worth taking the page down for.
  try { const v = JSON.parse(raw); return v == null ? fallback : v; }
  catch (e) { if (e instanceof SyntaxError) return fallback; throw e; }
}
const readOutbox = () => readJSON(outboxKey(), []);
function queueWrite(table, row) {
  const q = readOutbox();
  q.push({ table, row });
  localStorage.setItem(outboxKey(), JSON.stringify(q));
  paintSyncBadge();
}

let flushing = false;
async function flushOutbox(loud) {
  if (flushing) return 0;
  const q = readOutbox();
  if (!q.length) { paintSyncBadge(); return 0; }
  flushing = true;
  const left = [], dropped = [];
  let sent = 0;
  for (const item of q) {
    const { error } = await insertRow(item.table, item.row);
    // 23505 = unique violation: an earlier attempt did land after all
    if (!error || error.code === '23505') { sent++; continue; }
    // Still no connection: keep it and try again later. Anything else is the
    // server refusing the row, and retrying that for ever would leave a badge
    // stuck on screen with no way to clear it.
    if (looksOffline(error)) left.push(item);
    else dropped.push(error.message || 'rejected');
  }
  localStorage.setItem(outboxKey(), JSON.stringify(left));
  flushing = false;
  paintSyncBadge();
  if (dropped.length) {
    toast('log-msg', dropped.length + ' waiting session' + (dropped.length === 1 ? '' : 's') +
      ' could not be saved and ' + (dropped.length === 1 ? 'has' : 'have') + ' been dropped: ' +
      esc(dropped[0]), 'err');
  } else if (sent && loud) {
    toast('log-msg', 'Synced ' + sent + ' session' + (sent === 1 ? '' : 's') + ' that had been waiting.');
  }
  return sent;
}

function paintSyncBadge() {
  const el = $('syncbadge');
  if (!el) return;
  const n = readOutbox().length;
  el.innerHTML = n
    ? '&#9888; ' + n + ' waiting to sync<button id="sync-now">retry</button>'
    : '';
}

/* ================= sample mode =================
   The app runs unchanged against trial.js's stand-in client; only the three
   things a sample genuinely cannot do are refused, each at the point it
   happens. This section is the rest of it: the banner that says the work is
   not saved anywhere yet, and the one-shot upload when an account appears. */
const PENDING_JOIN = 'rt-pending-join';

function paintTrialBar() {
  const el = $('trial-bar');
  if (!el) return;
  if (!S.trial) { el.innerHTML = ''; return; }
  const c = trialCounts(trialRead());
  const logged = c.weights + c.erg + c.water + c.core;
  el.innerHTML =
    '<div class="trialbar">' +
      '<div class="tb-main"><b>Sample - nothing is saved to an account yet.</b>' +
        '<span>' + (logged
          ? logged + ' session' + (logged === 1 ? '' : 's') + ' logged, kept on this device only. ' +
            'Clear your browser data and ' + (logged === 1 ? 'it is' : 'they are') + ' gone.'
          : 'Log a session and it stays on this device. Everything except erg photos and squads works.') +
        '</span></div>' +
      '<a class="tb-cta" href="login.html?signup=1">Create a free account</a>' +
    '</div>';
}

// One upload, once, the first time a real session exists alongside a sample.
// Upsert on id rather than insert: a migration that died halfway through has
// to be safe to repeat, and the ids are already the primary keys.
async function migrateTrial() {
  const store = trialRead();
  const counts = trialCounts(store);
  const uid = S.session.user.id;
  const anything = counts.exercises + counts.routines + counts.weights + counts.erg + counts.core;
  if (!anything) { trialEnd(); return null; }
  // Exercises and routines first: a workout's `sets` is keyed by exercise id
  // and a core session points at a routine id.
  for (const t of ['tracker_exercises', 'tracker_core_routines', 'tracker_workouts',
                   'tracker_erg_sessions', 'tracker_water_sessions', 'tracker_core_sessions']) {
    const rows = (store[t] || []).map(r => Object.assign({}, r, { profile_id: uid }));
    if (!rows.length) continue;
    const { error } = await sb.from(t).upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    // Leave the sample alone on failure - it is the only copy - and let the
    // next boot try again.
    if (error) return { error: error.message };
  }
  trialEnd();
  return counts;
}

// The terms tick happens on the signup form, in auth.users metadata the app
// cannot read back. Mirror it onto the profile once, so a future change of
// wording has something to compare against.
// Best effort: profiles' UPDATE policy is inherited from the coach dashboard
// and not defined in this repo's schema, so a refusal here is not worth a
// message. auth.users keeps the copy that actually matters.
async function stampTerms() {
  if (S.trial || !S.profile || S.profile.terms_accepted_at) return;
  const at = (S.session.user.user_metadata || {}).terms_accepted_at || new Date().toISOString();
  const version = (S.session.user.user_metadata || {}).terms_version || TERMS_VERSION;
  const { error } = await sb.from('profiles')
    .update({ terms_accepted_at: at, terms_version: version }).eq('id', S.session.user.id);
  if (!error) Object.assign(S.profile, { terms_accepted_at: at, terms_version: version });
}

/* ================= data access ================= */
async function loadAll() {
  const uid = S.session.user.id;
  const [prof, ex, wk, erg, water, rt, core, races] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).single(),   // carries tracker_plan
    sb.from('tracker_exercises').select('*').order('position').order('created_at'),
    sb.from('tracker_workouts').select('*').order('date', { ascending: false }).limit(1000),
    sb.from('tracker_erg_sessions').select('*').order('date', { ascending: false }).limit(1000),
    sb.from('tracker_water_sessions').select('*').order('date', { ascending: false }).limit(1000),
    sb.from('tracker_core_routines').select('*').order('position').order('created_at'),
    sb.from('tracker_core_sessions').select('*').order('date', { ascending: false }).limit(1000),
    sb.from('tracker_races').select('*').order('date', { ascending: false }).limit(500),
  ]);
  S.profile = prof.data;
  S.exercises = ex.data || [];
  S.workouts = sortDesc(wk.data || []);
  S.ergs = sortDesc(erg.data || []);
  S.water = sortDesc(water.data || []);
  S.routines = (rt.data || []).filter(r => !r.retired).concat((rt.data || []).filter(r => r.retired));
  S.coreSessions = sortDesc(core.data || []);
  S.races = sortDesc(races.data || []);
  const errs = [prof.error, ex.error, wk.error, erg.error, water.error, rt.error, core.error,
                races.error].filter(Boolean);
  return errs.length ? errs[0].message : null;
}

/* ---- last good load, kept locally so the app still opens with no signal.
   Without this the boot sequence dies on the first failed query and nothing
   can be logged at all, which is exactly when you are standing in a gym
   basement wanting to log something. ---- */
const cacheKey = () => 'rt-cache-' + (S.session ? S.session.user.id : 'anon');
const CACHE_WORKOUTS = 400, CACHE_SESSIONS = 200;

function cacheData() {
  // Sample mode already IS a local store; a second copy of it would just eat
  // the same quota twice.
  if (S.trial) return;
  const payload = {
    profile: S.profile, exercises: S.exercises, routines: S.routines,
    workouts: S.workouts.slice(0, CACHE_WORKOUTS),
    ergs: S.ergs.slice(0, CACHE_SESSIONS),
    water: S.water.slice(0, CACHE_SESSIONS),
    coreSessions: S.coreSessions.slice(0, CACHE_SESSIONS),
    races: S.races,
    at: Date.now(),
  };
  // Best-effort only: a full quota must not take a save down with it.
  try { localStorage.setItem(cacheKey(), JSON.stringify(payload)); }
  catch (e) { if (e.name !== 'QuotaExceededError' && e.name !== 'NS_ERROR_DOM_QUOTA_REACHED') throw e; }
}

function loadCached() {
  const c = readJSON(cacheKey(), null);
  if (!c || !Array.isArray(c.exercises)) return false;
  S.profile = c.profile;
  S.exercises = c.exercises;
  S.routines = c.routines || [];
  S.workouts = sortDesc(c.workouts || []);
  S.ergs = sortDesc(c.ergs || []);
  S.water = sortDesc(c.water || []);
  S.coreSessions = sortDesc(c.coreSessions || []);
  S.races = sortDesc(c.races || []);
  return true;
}

/* ================= weights log ================= */
const currentDate = () => $('log-date').value || todayISO();
const activeLibrary = () => S.exercises.filter(e => !e.retired);

function lastEntryFor(exId, onOrBeforeISO) {
  return S.workouts.find(w => w.date <= onOrBeforeISO && w.sets[exId] && w.sets[exId].length) || null;
}
function setsToText(rows, unit) {
  const u = unit === 'secs' ? 's' : '';
  return rows.map(r => r.w !== '' && r.w != null ? r.r + u + '×' + r.w + 'kg' : r.r + u).join('  ');
}

const cardRows = card => [...card.querySelectorAll('.setrow')].map(row => ({
  r: row.querySelector('.in-r').value,
  w: row.querySelector('.in-w') ? row.querySelector('.in-w').value : '',
}));

// What is currently open in the log, so editing the library doesn't discard
// a session the athlete is halfway through entering. Also the draft payload.
function snapshotLog() {
  return [...document.querySelectorAll('#log-sections .ex')].map(card => ({
    id: card.dataset.id,
    rows: cardRows(card),
    saved: card.dataset.saved === '1',
  }));
}
function restoreLog(snap) {
  snap.forEach(item => {
    if (!exById(item.id) || exById(item.id).retired) return;
    addExercise(item.id, false, item.rows, item.saved);
  });
}

/* ---- draft: a half-entered session survives a refresh, a locked phone or a
   tab switch. Local only - it is the working copy, not history, so it never
   touches the database until "Save session". Keyed by date, so flipping the
   date picker moves between drafts instead of binning one. ---- */
const draftKey = () => 'rt-draft-' + (S.session ? S.session.user.id : 'anon');
const DRAFT_TTL = 14 * 864e5;

// Set while amending a session that is already in History. That is not a draft
// of a new session, so drafting is suspended for the duration.
let editingWorkoutId = null;
// Sets belonging to exercises no longer in the library: they can't be shown as
// cards, so they are held aside and written back untouched on save.
let editingExtra = null;

const readDrafts = () => readJSON(draftKey(), {});
function writeDrafts(all) {
  Object.keys(all).forEach(d => { if (!all[d] || all[d].updated < Date.now() - DRAFT_TTL) delete all[d]; });
  localStorage.setItem(draftKey(), JSON.stringify(all));
}
function saveDraft() {
  if (editingWorkoutId) { paintDraftLine(); return; }
  // everything on the page, filled or not - tapping four exercises up front is
  // setting the session up, and that shouldn't evaporate on a reload either
  const items = snapshotLog();
  const all = readDrafts(), date = currentDate();
  const notes = $('log-notes') ? $('log-notes').value : '';
  if (items.length || notes) all[date] = { items, notes, updated: Date.now() };
  else delete all[date];
  writeDrafts(all);
  paintDraftLine();
}
function clearDraft(date) {
  const all = readDrafts();
  delete all[date];
  writeDrafts(all);
}
let draftTimer = null;
const queueDraft = () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 500); };

// Live read-out of what's queued: how much is entered, how much is still open,
// and confirmation that it is being held somewhere.
function paintDraftLine() {
  const el = $('draft-line');
  if (!el) return;
  const cards = [...document.querySelectorAll('#log-sections .ex')];
  if (!cards.length) { el.innerHTML = ''; return; }
  let done = 0, open = 0, sets = 0;
  cards.forEach(card => {
    const filled = cardRows(card).filter(r => r.r !== '').length;
    sets += filled;
    if (card.dataset.saved === '1') done++; else open++;
  });
  const draft = readDrafts()[currentDate()];
  el.innerHTML =
    '<span><b>' + done + '</b> done · <b>' + open + '</b> open · <b>' + sets + '</b> sets entered</span>' +
    (editingWorkoutId ? '' : draft ? '<span>Draft kept on this device <button id="draft-drop">discard</button></span>' : '');
}

/* ---- amending a session already in History ---- */
function paintEditBar() {
  const bar = $('edit-bar');
  if (!bar) return;
  if (!editingWorkoutId) {
    bar.innerHTML = '';
    $('cancel-edit').style.display = 'none';
    $('save-btn').dataset.editing = '';
    return;
  }
  const wk = S.workouts.find(x => x.id === editingWorkoutId);
  const held = editingExtra ? Object.keys(editingExtra).length : 0;
  bar.innerHTML = '<div class="editbar"><div><b>Editing a saved session</b>' +
    '<span>' + (wk ? prettyDate(wk.date) + (wk.at ? ' · ' + esc(wk.at) : '') : '') +
    ' · saving replaces it rather than adding another' +
    (held ? ' · ' + held + ' retired exercise' + (held === 1 ? '' : 's') + ' kept as ' + (held === 1 ? 'it is' : 'they are') : '') +
    '</span></div><button id="edit-cancel-top">Cancel</button></div>';
  $('cancel-edit').style.display = '';
  $('save-btn').dataset.editing = '1';
}

function startEditWorkout(id) {
  const wk = S.workouts.find(x => x.id === id);
  if (!wk) return;
  editingWorkoutId = id;
  editingExtra = {};
  const snap = [];
  Object.keys(wk.sets).forEach(exId => {
    const m = exById(exId);
    if (m && !m.retired) snap.push({ id: exId, rows: wk.sets[exId].map(r => ({ r: r.r, w: r.w })), saved: true });
    else editingExtra[exId] = wk.sets[exId];   // can't be shown, must not be lost
  });
  $('log-date').value = wk.date;
  renderLog(snap);
  $('log-notes').value = wk.notes || '';
  selectTab('p-log');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEditWorkout() {
  editingWorkoutId = null;
  editingExtra = null;
  $('log-date').value = todayISO();
  $('log-notes').value = '';
  renderLog();
  toast('log-msg', 'Edit cancelled - the saved session is untouched.');
}

// The most recent saved session that used anything from this group. What
// "repeat" means is: put the same exercises back on the page.
function lastSessionForGroup(group, lib) {
  const ids = new Set(lib.filter(e => groupsOf(e).includes(group)).map(e => e.id));
  return S.workouts.find(w => Object.keys(w.sets).some(id => ids.has(id))) || null;
}

function repeatGroup(group) {
  const lib = activeLibrary();
  const last = lastSessionForGroup(group, lib);
  if (!last) return;
  const ids = new Set(lib.filter(e => groupsOf(e).includes(group)).map(e => e.id));
  // in the order they were done, and each one pre-filled from its own last
  // outing rather than from this session, which may be older for some lifts
  let n = 0;
  Object.keys(last.sets).forEach(id => { if (ids.has(id)) { addExercise(id, false); n++; } });
  saveDraft();
  track('repeat_session', { group, exercises: n });
  toast('log-msg', n
    ? 'Loaded the ' + n + ' exercises from ' + prettyDate(last.date) + ', with your last numbers ready to edit.'
    : 'Nothing in that session is still in your library.');
}

const chipHTML = e => '<button class="chip" aria-pressed="false" data-chip="' + e.id + '">' + esc(e.name) + '</button>';

function renderLog(snap) {
  const lib = activeLibrary();
  const chipsEl = $('chips');

  if (!lib.length) {
    chipsEl.innerHTML = '<p class="placeholder">No exercises yet - set up your library in the <b>Templates</b> tab first (or upload a crewmate\'s template there).</p>';
  } else {
    const groupings = allGroups(lib);
    chipsEl.innerHTML = groupings.map(g => {
      const inG = lib.filter(e => groupsOf(e).includes(g));
      const pats = [...new Set(inG.map(e => e.pattern))].sort((a, b) => patIdx(a) - patIdx(b));
      const last = lastSessionForGroup(g, lib);
      return '<div class="picker-session"><span>' + esc(g) + '</span>' +
        (last ? '<button class="repeat" data-repeat="' + esc(g) + '">&#8635; repeat ' + shortDate(last.date) + '</button>' : '') +
        '</div>' +
        pats.map(p => '<div class="picker-row"><span class="rowlab">' + esc(p) + '</span><div class="chips">' +
          inG.filter(e => e.pattern === p).map(chipHTML).join('') + '</div></div>').join('');
    }).join('') + '<p class="nomatch" id="chip-nomatch" hidden>Nothing in your library matches that.</p>';
  }

  const pats = [...new Set(lib.map(e => e.pattern))].sort((a, b) => patIdx(a) - patIdx(b));
  $('log-sections').innerHTML =
    (lib.length ? '<p class="placeholder" id="log-empty">Nothing added yet - tap an exercise above</p>' : '') +
    pats.map((p, i) =>
      '<div class="logsec" data-sec="' + esc(p) + '"><h3>' + (i + 1) + ' · ' + esc(cap(p)) +
      '<span class="secnote"></span></h3><div class="secbody"></div></div>').join('');

  $('log-msg').innerHTML = '';
  // an explicit snapshot (library edit mid-session, or a session being amended)
  // wins; otherwise pick up whatever draft belongs to the date now showing
  const draft = editingWorkoutId ? null : readDrafts()[currentDate()];
  const restore = (snap && snap.length) ? snap : ((draft || {}).items || []);
  if (restore.length) restoreLog(restore);
  // unconditionally, or a note typed against one date follows you to the next
  if (!snap && !editingWorkoutId && $('log-notes')) $('log-notes').value = (draft && draft.notes) || '';
  filterChips();
  refreshWeekCount();
  updateSecNotes();
  paintEditBar();
  // re-sync: a library edit can drop an exercise the draft still names
  saveDraft();
}

// Live filter over the picker. Hides chips, then any row and any session
// heading left with nothing under it.
function filterChips() {
  const box = $('chip-search');
  if (!box) return;
  const q = box.value.trim().toLowerCase();
  document.querySelectorAll('#chips .chip').forEach(c => {
    c.hidden = !!q && !c.textContent.toLowerCase().includes(q);
  });
  document.querySelectorAll('#chips .picker-row').forEach(r => {
    r.hidden = ![...r.querySelectorAll('.chip')].some(c => !c.hidden);
  });
  let anyRow = false;
  document.querySelectorAll('#chips .picker-session').forEach(h => {
    let n = h.nextElementSibling, any = false;
    while (n && !n.classList.contains('picker-session')) {
      if (n.classList.contains('picker-row') && !n.hidden) any = true;
      n = n.nextElementSibling;
    }
    h.hidden = !any;
    anyRow = anyRow || any;
  });
  const none = $('chip-nomatch');
  if (none) none.hidden = anyRow || !q;
}

// A set that opens with a value (pre-filled from last time, or restored) counts
// as already the athlete's own, so mirroring from set 1 must not overwrite it.
const held = v => (v === '' || v == null) ? '' : ' data-touched="1"';

// Weight and hold length get - / + either side of the field. Typing a number
// on a phone mid-set is the thing that actually goes wrong, not the arithmetic.
const WEIGHT_STEP = 2.5, SECS_STEP = 5;
function stepperHTML(cls, val, ph, step) {
  return '<span class="stepper" data-step="' + step + '">' +
    '<button class="sdn" type="button" tabindex="-1" aria-label="Down ' + step + '">&minus;</button>' +
    '<input type="number" inputmode="decimal" class="' + cls + '" value="' + esc(val || '') + '"' + held(val) +
      ' placeholder="' + ph + '">' +
    '<button class="sup" type="button" tabindex="-1" aria-label="Up ' + step + '">&plus;</button></span>';
}

function setRowHTML(j, r, w, bw, timeOnly) {
  if (timeOnly) {
    return '<div class="setrow time"><span class="setno">' + (j + 1) + '</span>' +
      stepperHTML('in-r', r, 'secs', SECS_STEP) +
      '<button class="ghostx rm" title="Remove hold">×</button></div>';
  }
  return '<div class="setrow"><span class="setno">' + (j + 1) + '</span>' +
    '<input type="number" inputmode="decimal" class="in-r" value="' + esc(r || '') + '"' + held(r) + ' placeholder="–">' +
    stepperHTML('in-w', w, bw ? '+0' : '–', WEIGHT_STEP) +
    '<button class="ghostx rm" title="Remove set">×</button></div>';
}

/* ---- what you've already done, so the number is on the card and not in your
   head. All of it is client-side already, so this costs nothing. ---- */
function loggedSets(exId) {
  const out = [];
  S.workouts.forEach(w => (w.sets[exId] || []).forEach(r => {
    const reps = parseFloat(r.r), wt = parseFloat(r.w);
    if (!isNaN(reps)) out.push({ date: w.date, reps, wt: isNaN(wt) ? null : wt });
  }));
  return out;
}
const heaviest = arr => arr.reduce((a, x) => (a && a.wt >= x.wt) ? a : x, null);

function bestLine(exId, atReps) {
  const m = exById(exId) || {};
  const all = loggedSets(exId);
  if (!all.length) return '';
  if (m.unit === 'secs') {
    const b = all.reduce((a, x) => (a && a.reps >= x.reps) ? a : x, null);
    return 'Longest hold: <b>' + round1(b.reps) + 's</b> · ' + shortDate(b.date);
  }
  const weighted = all.filter(x => x.wt != null);
  if (!weighted.length) return '';
  // the rep count you're on right now beats the all-time best for usefulness
  const at = atReps ? weighted.filter(x => x.reps === atReps) : [];
  if (at.length) {
    const b = heaviest(at);
    return 'Best at ' + round1(atReps) + ' reps: <b>' + round1(b.wt) + 'kg</b> · ' + shortDate(b.date);
  }
  const b = heaviest(weighted);
  return 'Best: <b>' + round1(b.wt) + 'kg</b> × ' + round1(b.reps) + ' · ' + shortDate(b.date);
}

function refreshBest(card) {
  const el = card.querySelector('.bestline');
  if (!el) return;
  const first = card.querySelector('.setrow .in-r');
  const reps = first ? parseFloat(first.value) : NaN;
  el.innerHTML = bestLine(card.dataset.id, isNaN(reps) ? null : reps);
}

// Typing set 1 fills the sets below it, so a straight-across 3x8 @ 60kg is one
// entry rather than six. Stops mirroring into any set you've typed into
// yourself, and never touches sets pre-filled from last time.
function fillDown(card) {
  const rows = [...card.querySelectorAll('.setrow')];
  if (rows.length < 2) return;
  ['in-r', 'in-w'].forEach(cls => {
    const first = rows[0].querySelector('.' + cls);
    if (!first) return;
    rows.slice(1).forEach(row => {
      const el = row.querySelector('.' + cls);
      if (el && !el.dataset.touched) el.value = first.value;
    });
  });
}

function addExercise(exId, scroll, rows, saved) {
  const m = exById(exId);
  if (!m) return;
  const secBody = document.querySelector('.logsec[data-sec="' + esc(m.pattern) + '"] .secbody');
  if (!secBody || secBody.querySelector('[data-id="' + exId + '"]')) return;

  const timeOnly = m.unit === 'secs';
  const prev = lastEntryFor(exId, currentDate());
  const blank = Array.from({ length: timeOnly ? 1 : 3 }, () => ({ r: '', w: '' }));
  const start = (rows && rows.length) ? rows : (prev ? prev.sets[exId] : blank);
  const unitLabel = timeOnly ? 'Seconds' : (m.per_side ? 'Reps e/s' : 'Reps');

  secBody.insertAdjacentHTML('beforeend',
    '<div class="ex" data-id="' + exId + '" data-timeonly="' + timeOnly + '" data-bw="' + !!m.bodyweight + '">' +
      '<div class="ex-head"><div><span class="ex-name">' + esc(m.name) + '</span>' +
        (m.per_side ? '<span class="tagps">each side</span>' : '') +
        '<div class="ex-note"><span class="src">' + esc(groupsOf(m).join(' · ')) + '</span>' + (m.note ? ' · ' + esc(m.note) : '') + '</div></div>' +
        '<button class="ghostx ex-close" title="Remove">×</button></div>' +
      '<div class="ex-body">' +
        '<div class="lastline' + (prev ? '' : ' none') + '">' +
          (prev ? 'Last (' + (prev.date === currentDate() ? 'earlier today' : prettyDate(prev.date)) + '): ' + setsToText(prev.sets[exId], m.unit)
                : 'No history yet - first time in.') + '</div>' +
        '<div class="bestline"></div>' +
        (timeOnly
          ? '<div class="colhead time"><span>#</span><span>Seconds</span><span></span></div>'
          : '<div class="colhead"><span>#</span><span>' + unitLabel + '</span><span>Weight kg</span><span></span></div>') +
        '<div class="rows">' + start.map((r, j) => setRowHTML(j, r.r, r.w, m.bodyweight, timeOnly)).join('') + '</div>' +
        '<button class="addset">+ add ' + (timeOnly ? 'hold' : 'set') + '</button>' +
        '<button class="exdone">&check; Done with this exercise</button>' +
      '</div>' +
      '<div class="ex-done" hidden><span class="done-sets"></span><button class="exedit">Edit</button></div>' +
    '</div>');

  const card = secBody.querySelector('[data-id="' + exId + '"]');
  refreshBest(card);
  if (saved) collapseExercise(card, true);
  document.querySelectorAll('[data-chip="' + exId + '"]').forEach(c => c.setAttribute('aria-pressed', 'true'));
  updateSecNotes();
  // Deliberately no scroll: you often tap four or five exercises up front, and
  // being thrown down the page after each one makes that impossible.
  if (scroll === true) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Collapsing is only a display state - the inputs stay in the DOM, so the
// session save and the draft keep seeing the same values either way.
function collapseExercise(card, on) {
  if (on) {
    const m = exById(card.dataset.id) || {};
    const rows = cardRows(card).filter(r => r.r !== '');
    card.querySelector('.done-sets').textContent =
      setsToText(rows, m.unit) + (m.per_side ? '  (each side)' : '');
  }
  card.dataset.saved = on ? '1' : '';
  card.querySelector('.ex-body').hidden = on;
  card.querySelector('.ex-done').hidden = !on;
}

function flashCard(card) {
  card.classList.remove('ex-flash');
  void card.offsetWidth;   // restart the animation
  card.classList.add('ex-flash');
}

function removeExercise(exId) {
  const card = document.querySelector('#log-sections [data-id="' + exId + '"]');
  if (card) card.remove();
  document.querySelectorAll('[data-chip="' + exId + '"]').forEach(c => c.setAttribute('aria-pressed', 'false'));
  updateSecNotes();
  saveDraft();
}

function updateSecNotes() {
  let any = 0, sets = 0;
  document.querySelectorAll('.logsec').forEach(sec => {
    const cards = [...sec.querySelectorAll('.ex')];
    const n = cards.length, done = cards.filter(c => c.dataset.saved === '1').length;
    any += n;
    cards.forEach(c => { sets += cardRows(c).filter(r => r.r !== '').length; });
    sec.classList.toggle('has', n > 0);
    sec.querySelector('.secnote').textContent = n ? (done ? done + ' of ' + n + ' done' : n + ' in session') : '';
  });
  const empty = $('log-empty');
  if (empty) empty.style.display = any ? 'none' : 'block';
  const btn = $('save-btn');
  const verb = editingWorkoutId ? 'Update session' : 'Save session';
  if (btn) btn.textContent = any
    ? verb + ' · ' + any + ' exercise' + (any === 1 ? '' : 's') + ', ' + sets + ' set' + (sets === 1 ? '' : 's')
    : verb;
}

function refreshWeekCount() {
  const date = currentDate();
  const wk = mondayOf(date);
  const weights = S.workouts.filter(s => mondayOf(s.date) === wk).length;
  const ergs = S.ergs.filter(s => mondayOf(s.date) === wk).length;
  const waters = S.water.filter(s => mondayOf(s.date) === wk).length;
  const cores = S.coreSessions.filter(s => mondayOf(s.date) === wk).length;
  const today = S.workouts.filter(s => s.date === date).length;
  $('weekcount').innerHTML = 'Week of ' + prettyDate(wk) + ' - <b>' + weights + '</b> weights · <b>' +
    ergs + '</b> erg' + (waters ? ' · <b>' + waters + '</b> water' : '') +
    (cores ? ' · <b>' + cores + '</b> core' : '') +
    (today ? ' · ' + today + ' already logged today' : '');
}

async function saveWorkout() {
  const date = currentDate(), sets = Object.assign({}, editingExtra || {});
  const notes = ($('log-notes').value || '').trim() || null;
  let total = 0, skipped = 0;
  document.querySelectorAll('#log-sections .ex').forEach(card => {
    const rows = cardRows(card).map(x => ({ r: x.r.trim(), w: x.w.trim() })).filter(x => x.r !== '');
    if (rows.length) { sets[card.dataset.id] = rows; total += rows.length; }
    else skipped++;
  });
  if (!total && !Object.keys(sets).length) {
    toast('log-msg', 'Nothing to save - add an exercise and enter at least one set.', 'warn'); return;
  }

  // ---- amending a session that is already in History ----
  if (editingWorkoutId) {
    const id = editingWorkoutId;
    const { error } = await updateRow('tracker_workouts', { date, sets, notes }, id);
    if (error) { toast('log-msg', 'Update failed: ' + esc(error.message), 'err'); return; }
    Object.assign(S.workouts.find(x => x.id === id), { date, sets, notes });
    sortDesc(S.workouts);
    track('workout_edited', { exercises: Object.keys(sets).length, sets: total });
    editingWorkoutId = null; editingExtra = null;
    cacheData();
    $('log-date').value = todayISO();
    $('log-notes').value = '';
    renderLog(); renderProgress(); renderHistory();
    toast('log-msg', 'Session updated - ' + prettyDate(date) + ' · ' + plural(Object.keys(sets).length, 'exercise') +
      ', ' + plural(total, 'set') + '.');
    return;
  }

  // id is generated here, not by the database, so a save that fails on the way
  // out can be retried later without risking a second copy
  const row = { id: newId(), profile_id: S.session.user.id, date, at: nowHM(), sets, notes };
  const { error } = await insertRow('tracker_workouts', row);
  const queued = error && looksOffline(error);
  if (error && !queued) { toast('log-msg', 'Save failed: ' + esc(error.message), 'err'); return; }
  if (queued) queueWrite('tracker_workouts', row);

  S.workouts.push(row); sortDesc(S.workouts);
  track('workout_saved', { exercises: Object.keys(sets).length, sets: total, queued: !!queued });
  const nToday = S.workouts.filter(x => x.date === date).length;
  cacheData();
  clearDraft(date);
  $('log-notes').value = '';   // or renderLog would draft it straight back
  renderLog();
  toast('log-msg',
    (queued ? 'Saved on this device - no connection, so it will sync as soon as you are back online. ' : 'Saved - ') +
    prettyDate(date) + ' ' + row.at + ' · ' + plural(Object.keys(sets).length, 'exercise') +
    ', ' + plural(total, 'set') + (nToday > 1 ? ' · entry ' + nToday + ' today' : '') + '.' +
    (skipped ? ' ' + skipped + ' exercise' + (skipped === 1 ? ' was' : 's were') + ' empty and left out.' : ''),
    queued ? 'warn' : '');
  renderProgress(); renderHistory();
}

/* ================= erg ================= */
function ergFormHTML(d, source) {
  d = d || {};
  const iv = Array.isArray(d.intervals) ? d.intervals : [];
  return '<div class="erg-form" id="erg-form" data-source="' + esc(source) + '">' +
    '<h3>' + (source === 'photo' ? 'Check the numbers' : 'Erg session') + '</h3>' +
    '<div class="hint">' + (source === 'photo'
      ? 'Read from your photo - check every field before saving, especially splits.'
      : 'Fill in what you have; anything can be left blank.') + '</div>' +
    (d.warnings && d.warnings.length ? '<div class="parse-note">⚠ ' + esc(d.warnings.join(' · ')) + '</div>' : '') +
    '<div class="fgrid">' +
      '<div><label>Date</label><input type="date" id="eg-date" value="' + esc(d.date || todayISO()) + '"></div>' +
      '<div><label>Machine</label><select id="eg-type">' +
        '<option value="concept2"' + (d.erg_type === 'concept2' || !d.erg_type ? ' selected' : '') + '>Concept2</option>' +
        '<option value="rowperfect"' + (d.erg_type === 'rowperfect' ? ' selected' : '') + '>RowPerfect</option></select></div>' +
      '<div><label>Session</label><input type="text" id="eg-session" value="' + esc(d.session_type || '') + '" placeholder="e.g. 2k test, 8x500m"></div>' +
      '<div><label>Total time</label><input type="text" id="eg-time" value="' + esc(d.total_time_s != null ? fmtTime(d.total_time_s) : '') + '" placeholder="mm:ss.t" inputmode="decimal"></div>' +
      '<div><label>Distance m</label><input type="number" id="eg-dist" value="' + esc(d.distance_m != null ? d.distance_m : '') + '" inputmode="numeric"></div>' +
      '<div><label>Avg /500m</label><input type="text" id="eg-split" value="' + esc(d.avg_split_s != null ? fmtTime(d.avg_split_s) : '') + '" placeholder="m:ss.t" inputmode="decimal"></div>' +
      '<div><label>Avg rate</label><input type="number" id="eg-rate" value="' + esc(d.avg_rate != null ? d.avg_rate : '') + '" inputmode="numeric"></div>' +
      '<div><label>Avg HR</label><input type="number" id="eg-hr" value="' + esc(d.avg_hr != null ? d.avg_hr : '') + '" inputmode="numeric"></div>' +
    '</div>' +
    '<label style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)">Intervals / splits</label>' +
    '<table class="itbl"><thead><tr><th>#</th><th>Time</th><th>Dist m</th><th>/500m</th><th>Rate</th><th>HR</th><th></th></tr></thead>' +
    '<tbody id="eg-ivs">' + iv.map((r, i) => ergIvRowHTML(i, r)).join('') + '</tbody></table>' +
    '<button class="addset" id="eg-addiv">+ add interval</button>' +
    '<div class="fwide" style="margin-top:10px"><label>Notes</label><input type="text" id="eg-notes" value="' + esc(d.notes || '') + '"></div>' +
    '<button class="primary" id="eg-save" style="height:44px">Save erg session</button>' +
    '<button id="eg-cancel" style="width:100%;margin-top:8px">Discard</button>' +
  '</div>';
}
function ergIvRowHTML(i, r) {
  r = r || {};
  return '<tr><td class="setno">' + (i + 1) + '</td>' +
    '<td><input type="text" class="iv-time" value="' + esc(r.time_s != null ? fmtTime(r.time_s) : '') + '" inputmode="decimal"></td>' +
    '<td><input type="number" class="iv-dist" value="' + esc(r.distance_m != null ? r.distance_m : '') + '" inputmode="numeric"></td>' +
    '<td><input type="text" class="iv-split" value="' + esc(r.split_s != null ? fmtTime(r.split_s) : '') + '" inputmode="decimal"></td>' +
    '<td><input type="number" class="iv-rate" value="' + esc(r.rate != null ? r.rate : '') + '" inputmode="numeric"></td>' +
    '<td><input type="number" class="iv-hr" value="' + esc(r.hr != null ? r.hr : '') + '" inputmode="numeric"></td>' +
    '<td><button class="ghostx iv-rm" title="Remove">×</button></td></tr>';
}
function openErgForm(data, source, quiet) {
  $('erg-form-holder').innerHTML = ergFormHTML(data, source);
  if (!quiet) $('erg-form-holder').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---- an open confirm card survives leaving the page. A photo parse costs real
   money, so losing one to a stray tab switch is the expensive kind of mistake.
   Raw field values are stored rather than parsed numbers, so a half-typed
   "7:" is still there when you come back. ---- */
const ergDraftKey = () => 'rt-ergdraft-' + (S.session ? S.session.user.id : 'anon');
const ERG_FIELDS = ['eg-date', 'eg-type', 'eg-session', 'eg-time', 'eg-dist', 'eg-split', 'eg-rate', 'eg-hr', 'eg-notes'];
const IV_FIELDS = ['iv-time', 'iv-dist', 'iv-split', 'iv-rate', 'iv-hr'];

function ergSnapshot() {
  const f = $('erg-form');
  if (!f) return null;
  return {
    source: f.dataset.source,
    fields: ERG_FIELDS.reduce((o, id) => { o[id] = $(id) ? $(id).value : ''; return o; }, {}),
    intervals: [...document.querySelectorAll('#eg-ivs tr')].map(tr =>
      IV_FIELDS.reduce((o, c) => { o[c] = tr.querySelector('.' + c).value; return o; }, {})),
    updated: Date.now(),
  };
}
function saveErgDraft() {
  const snap = ergSnapshot();
  if (snap) localStorage.setItem(ergDraftKey(), JSON.stringify(snap));
  else localStorage.removeItem(ergDraftKey());
}
const clearErgDraft = () => localStorage.removeItem(ergDraftKey());
let ergDraftTimer = null;
const queueErgDraft = () => { clearTimeout(ergDraftTimer); ergDraftTimer = setTimeout(saveErgDraft, 500); };

function restoreErgForm() {
  const snap = readJSON(ergDraftKey(), null);
  if (!snap || !snap.fields) return false;
  openErgForm({ intervals: snap.intervals.map(() => ({})) }, snap.source, true);
  Object.keys(snap.fields).forEach(id => { if ($(id)) $(id).value = snap.fields[id]; });
  [...document.querySelectorAll('#eg-ivs tr')].forEach((tr, i) => {
    const r = snap.intervals[i];
    if (r) IV_FIELDS.forEach(c => { tr.querySelector('.' + c).value = r[c]; });
  });
  toast('erg-parse-status', 'Picked up the session you had open' +
    (snap.source === 'photo' ? ' from your photo' : '') + '. Check it over and save, or discard it.', 'warn');
  return true;
}

async function saveErg() {
  const form = $('erg-form');
  const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  const intervals = [...document.querySelectorAll('#eg-ivs tr')].map(tr => ({
    time_s: parseTimeStr(tr.querySelector('.iv-time').value),
    distance_m: num(tr.querySelector('.iv-dist').value),
    split_s: parseTimeStr(tr.querySelector('.iv-split').value),
    rate: num(tr.querySelector('.iv-rate').value),
    hr: num(tr.querySelector('.iv-hr').value),
  })).filter(r => r.time_s != null || r.distance_m != null || r.split_s != null);

  const int = v => { const n = num(v); return n == null ? null : Math.round(n); };
  let total_time_s = parseTimeStr($('eg-time').value);
  let distance_m = int($('eg-dist').value);
  let avg_split_s = parseTimeStr($('eg-split').value);
  // derive the obvious blanks
  if (avg_split_s == null && total_time_s && distance_m) avg_split_s = round1(total_time_s / (distance_m / 500));
  if (total_time_s == null && intervals.length && intervals.every(r => r.time_s != null))
    total_time_s = round1(intervals.reduce((a, r) => a + r.time_s, 0));
  if (distance_m == null && intervals.length && intervals.every(r => r.distance_m != null))
    distance_m = Math.round(intervals.reduce((a, r) => a + r.distance_m, 0));

  if (total_time_s == null && distance_m == null && !intervals.length) {
    toast('erg-parse-status', 'Nothing to save - enter at least a time, distance or interval.', 'warn'); return;
  }

  const row = {
    id: newId(),
    profile_id: S.session.user.id,
    date: $('eg-date').value || todayISO(),
    at: nowHM(),
    source: form.dataset.source,
    erg_type: $('eg-type').value,
    session_type: $('eg-session').value.trim() || null,
    total_time_s, distance_m, avg_split_s,
    avg_rate: int($('eg-rate').value),
    avg_hr: int($('eg-hr').value),
    intervals: intervals.length ? intervals : null,
    notes: $('eg-notes').value.trim() || null,
  };
  const { error } = await insertRow('tracker_erg_sessions', row);
  const queued = error && looksOffline(error);
  if (error && !queued) { toast('erg-parse-status', 'Save failed: ' + esc(error.message), 'err'); return; }
  if (queued) queueWrite('tracker_erg_sessions', row);

  S.ergs.push(row); sortDesc(S.ergs);
  track('erg_saved', { source: row.source, intervals: intervals.length, queued: !!queued });
  $('erg-form-holder').innerHTML = '';
  cacheData();
  clearErgDraft();
  toast('erg-parse-status',
    (queued ? 'Saved on this device - it will sync when you are back online. ' : 'Saved - ') +
    prettyDate(row.date) +
    (row.session_type ? ' · ' + esc(row.session_type) : '') +
    (row.distance_m ? ' · ' + row.distance_m + 'm' : '') + '.', queued ? 'warn' : '');
  renderErgRecent(); renderHistory(); refreshWeekCount();
}

function ergSummaryLine(s) {
  const bits = [];
  if (s.session_type) bits.push('<b>' + esc(s.session_type) + '</b>');
  if (s.total_time_s != null) bits.push('<b>' + fmtTime(s.total_time_s) + '</b>');
  if (s.distance_m != null) bits.push(s.distance_m + 'm');
  if (s.avg_split_s != null) bits.push(fmtSplit(s.avg_split_s));
  if (s.avg_rate != null) bits.push('r' + s.avg_rate);
  if (s.avg_hr != null) bits.push(s.avg_hr + 'bpm');
  if (s.intervals && s.intervals.length) bits.push(s.intervals.length + ' intervals');
  return bits.join(' · ');
}

// Same collapsible card as History, rather than a second layout that has to be
// kept in step with it.
function renderErgRecent() {
  const recent = S.ergs.slice(0, 6);
  $('erg-recent').innerHTML = !recent.length
    ? '<p class="empty">No erg sessions logged yet.</p>'
    : '<div class="dsub" style="margin-top:24px">Recent erg sessions</div>' + recent.map(histErgHTML).join('');
}

/* ---- entitlement: photo reading is the one paid feature ---- */
// The server decides this too - this is only so free users see an honest
// message up front instead of uploading a photo and being refused.
// Every account can read photos; the plan only decides how many a day, and
// the server is what counts them. Sample mode is the one case that cannot:
// a parse costs real money and a sample has no account to bill it against.
function canReadPhotos() { return !S.trial; }
const onPaidPlan = () => ((S.profile || {}).tracker_plan === 'paid');

function renderErgGate() {
  const wrap = $('erg-gate');
  if (!wrap) return;
  if (canReadPhotos()) {
    $('erg-photo-btn').disabled = false;
    $('erg-photo-btn').title = '';
    // Not a gate - the button works. Free accounts get a smaller allowance,
    // and saying so up front beats letting someone find out by being refused
    // on the third photo. The server is what actually enforces it.
    wrap.innerHTML = onPaidPlan() ? ''
      : '<p class="allowance">Photo reading: <b>2 a day</b> on the free plan, 20 on £5 a month. ' +
        'Typing sessions in by hand is free and unlimited either way.</p>';
    return;
  }
  $('erg-photo-btn').disabled = true;
  $('erg-photo-btn').title = 'Needs an account';
  wrap.innerHTML =
    '<div class="gate"><b>Reading erg photos needs an account.</b>' +
    '<span>Every photo is read by an AI model and costs real money per picture, so it is the ' +
    'one thing the sample cannot do. <b>Enter manually</b> works exactly as it will once you ' +
    'sign up.</span></div>';
}

/* ---- photo capture -> Edge Function ---- */
function downscale(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      // 2576px on the long edge is the high-resolution ceiling current Claude
      // vision models read at. Monitor split rows are small, dense digits, so
      // resolution and JPEG quality are what accuracy actually hinges on here.
      const MAX = 2576;
      let { width: w, height: h } = img;
      if (Math.max(w, h) > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.92).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

async function handleErgPhoto(file) {
  $('erg-parse-status').innerHTML = '<div class="toast"><span class="spin"></span>Reading the monitor… usually a few seconds.</div>';
  let b64;
  try { b64 = await downscale(file); }
  catch (e) { toast('erg-parse-status', esc(e.message), 'err'); return; }

  // fetch a fresh token - the boot-time one can have expired mid-session
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.replace('login.html'); return; }

  const resp = await fetch(PARSE_ERG_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ image: b64, media_type: 'image/jpeg' }),
  });
  if (!resp.ok) {
    let msg = '', reason = '';
    try { const j = await resp.json(); msg = j.error || ''; reason = j.reason || ''; }
    catch (e) { msg = 'Something went wrong reading the photo.'; }
    // 402 = not on the plan, 429 = over quota (yours or the site's), 503 = the
    // reader is switched off. All three are expected states with a useful
    // message of their own, not crashes, so don't dress them up as errors.
    const kind = [402, 429, 503].includes(resp.status) ? 'warn' : 'err';
    toast('erg-parse-status', esc(msg) +
      (kind === 'err' ? ' You can still enter the session by hand.' : ''), kind);
    track('erg_photo_failed', { status: resp.status, reason });
    if (resp.status === 402) renderErgGate();
    return;
  }
  const out = await resp.json();
  $('erg-parse-status').innerHTML = '';
  track('erg_photo_parsed', {});
  openErgForm(out.session || {}, 'photo');
}

/* ================= water =================
   Rowing on the water. The same weekly shape as the erg and none of the
   machinery: no monitor to photograph, no splits table, no draft. Distance is
   the point, time is optional, and the split is derived for display rather
   than stored, so it can never disagree with the two numbers it came from. */
const waterSplit = s => (s.total_time_s && s.distance_m)
  ? round1(s.total_time_s / (s.distance_m / 500)) : null;
// Whole seconds. fmtTime carries a tenth because an erg piece is timed to one;
// an hour on the water is not, and "56:55.0" reads like false precision. The
// split keeps its decimal - that one is a real measurement.
const fmtDur = sec => {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
  return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(t % 60);
};

function waterSummaryLine(s) {
  const bits = [];
  if (s.boat) bits.push('<b>' + esc(s.boat) + '</b>');
  if (s.distance_m != null) bits.push('<b>' + s.distance_m.toLocaleString('en-GB') + 'm</b>');
  if (s.total_time_s != null) bits.push(fmtDur(s.total_time_s));
  const sp = waterSplit(s);
  if (sp != null) bits.push(fmtSplit(sp));
  return bits.join(' · ') || 'Water session';
}

// The boats a UK club actually owns, smallest first, sweep and scull together
// because that is the order a rower says them in. A datalist, not a select:
// these cover the vast majority without making a 2x- or a coxed pair
// unloggable, and the same strings are what tracker_races stores in `boat`.
const WATER_BOATS = ['1x', '2x', '2-', '2+', '4x', '4x+', '4-', '4+', '8+'];

function renderWaterTab() {
  const el = $('water-body');
  if (!el) return;
  el.innerHTML =
    '<div class="erg-form">' +
      '<h3>Log a water session</h3>' +
      '<div class="hint">Distance is the only thing needed. Time is optional; give both and the ' +
      'split works itself out.</div>' +
      '<div class="fgrid">' +
        '<div><label for="wt-date">Date</label><input type="date" id="wt-date"></div>' +
        '<div><label for="wt-dist">Distance (m)</label>' +
          '<input type="number" id="wt-dist" inputmode="numeric" placeholder="e.g. 16000"></div>' +
        '<div><label for="wt-time">Time (optional)</label>' +
          '<input type="text" id="wt-time" inputmode="numeric" placeholder="e.g. 1:12:30"></div>' +
        '<div><label for="wt-boat">Boat (optional)</label>' +
          '<input type="text" id="wt-boat" list="wt-boats" placeholder="e.g. 4x-" autocomplete="off">' +
          '<datalist id="wt-boats">' +
          WATER_BOATS.map(b => '<option value="' + b + '"></option>').join('') +
          '</datalist></div>' +
      '</div>' +
      '<div class="fwide"><label for="wt-notes">Notes</label>' +
        '<input type="text" id="wt-notes" placeholder="Crew, conditions, how it went"></div>' +
      '<button class="primary" id="wt-save" style="height:42px">Save water session</button>' +
      '<div id="water-msg"></div>' +
    '</div>' +
    '<div id="water-recent"></div>';
  $('wt-date').value = todayISO();
  renderWaterRecent();
}

function renderWaterRecent() {
  const el = $('water-recent');
  if (!el) return;
  const recent = S.water.slice(0, 6);
  el.innerHTML = recent.length
    ? '<div class="dsub" style="margin-top:24px">Recent water sessions</div>' +
      recent.map(histWaterHTML).join('')
    : '';
}

async function saveWater() {
  const dist = parseInt($('wt-dist').value, 10);
  const time = parseTimeStr($('wt-time').value);
  if (isNaN(dist) && time == null) {
    toast('water-msg', 'Enter at least a distance, or a time.', 'warn');
    return;
  }
  const row = {
    id: newId(),
    profile_id: S.session.user.id,
    date: $('wt-date').value || todayISO(),
    at: nowHM(),
    distance_m: isNaN(dist) ? null : dist,
    total_time_s: time,
    boat: $('wt-boat').value.trim() || null,
    notes: $('wt-notes').value.trim() || null,
  };
  const { error } = await insertRow('tracker_water_sessions', row);
  const queued = error && looksOffline(error);
  if (error && !queued) { toast('water-msg', 'Save failed: ' + esc(error.message), 'err'); return; }
  if (queued) queueWrite('tracker_water_sessions', row);

  S.water.push(row); sortDesc(S.water);
  track('water_saved', { queued: !!queued });
  cacheData();
  $('wt-dist').value = ''; $('wt-time').value = ''; $('wt-notes').value = '';
  // The boat is deliberately NOT cleared: an outing is usually followed by
  // another in the same boat, and retyping it every time is friction for
  // nothing. Date, distance and time all change; the boat rarely does.
  renderWaterRecent(); renderProgress(); renderHistory(); refreshWeekCount();
  toast('water-msg',
    (queued ? 'Saved on this device - no connection, so it will sync when you are back online. ' : 'Saved - ') +
    prettyDate(row.date) + ' · ' + waterSummaryLine(row).replace(/<[^>]+>/g, '') + '.',
    queued ? 'warn' : '');
}

/* ================= core routines ================= */
// A routine is an ORDERED list of named holds with a target time. Repeats are
// normal (plank as round 1 and round 4), so steps are addressed by index, never
// by name. RUN holds the in-progress attempt; the timer writes actual times
// into it, and the athlete can override any of them by hand before saving.
const RUN = { routineId: null, name: '', steps: [], idx: 0, running: false,
              startedAt: 0, carried: 0, tick: null, wake: null,
              // countdown before a round, and the rest clock between rounds
              counting: false, countEnd: 0, countTick: null, lastCount: 0,
              started: false, idleSince: 0, restAccum: 0 };
let editingRoutine = null;   // null = not editing, else {id|null, name, steps}

// The "get set" countdown is a preference, not a law. It was five seconds on
// every round with only a per-round Skip, which is five seconds and a tap you
// did not ask for at every single hold; the length is now yours to set, and 0
// turns it off for good.
const AUTONEXT_KEY = 'rt-core-autonext';
const COUNTDOWN_KEY = 'rt-core-countdown';
const COUNTDOWN_CHOICES = [0, 3, 5, 10];
const autoNext = () => localStorage.getItem(AUTONEXT_KEY) === '1';
const countdownS = () => {
  const v = parseInt(localStorage.getItem(COUNTDOWN_KEY), 10);
  return COUNTDOWN_CHOICES.includes(v) ? v : 5;
};

const routineById = id => S.routines.find(r => r.id === id) || null;
const stepsOf = r => Array.isArray(r && r.steps) ? r.steps : [];
// A per-side step is two rounds of the same target, so both the round count and
// the total target have to double for it.
const roundCount = steps => steps.reduce((a, s) => a + (s.per_side ? 2 : 1), 0);
const totalTarget = steps => steps.reduce((a, s) => a + (Number(s.target_s) || 0) * (s.per_side ? 2 : 1), 0);
const stepLabel = s => s.name + (s.side ? ' (' + s.side + ')' : '');

const liveRoutines = () => S.routines.filter(r => !r.retired);

// Core tab = run a routine. Building and editing them lives in Set up > Templates.
function renderCoreTab() {
  const pick = $('core-pick');
  const live = liveRoutines();
  pick.innerHTML = live.length
    ? live.map(r => '<option value="' + r.id + '">' + esc(r.name) + '</option>').join('')
    : '<option value="">No routines yet</option>';
  if (RUN.routineId && live.some(r => r.id === RUN.routineId)) pick.value = RUN.routineId;
  // With no routines this is the only way to Templates from here, so it stays
  // enabled and changes job: build the first one rather than edit nothing.
  const edit = $('core-edit-rt');
  edit.disabled = false;
  edit.innerHTML = live.length ? '✎ Edit this routine' : '✎ Build a routine';

  if (!live.length) {
    stopTimer();
    RUN.routineId = null;
    $('core-runner').innerHTML = '<p class="placeholder">No core routines yet. Open the ' +
      '<b>Templates</b> tab and build one - list the holds in the order you do them, each with a ' +
      'target time. The same hold can appear as often as you like - round 1 and round 4 are two ' +
      'entries, not one.</p>';
    return;
  }
  loadRun(pick.value);
}

/* ---- builder (Templates tab) ---- */
function renderRoutines() {
  const live = liveRoutines();
  $('rt-list').innerHTML = live.length
    ? live.map(r => {
        const st = stepsOf(r), n = roundCount(st);
        return '<div class="lib-item"><div><div class="nm">' + esc(r.name) + '</div>' +
          '<div class="meta">' + n + ' round' + (n === 1 ? '' : 's') +
          (n !== st.length ? ' (' + st.length + ' exercises, sides counted)' : '') +
          ' · ' + fmtTime(totalTarget(st)) + '</div></div>' +
          '<div class="ops"><button class="ghost" data-rt-edit="' + r.id + '" title="Edit" style="font-size:13px">✎</button>' +
          '<button class="ghost" data-rt-del="' + r.id + '" title="Delete">×</button></div></div>';
      }).join('')
    : '<p class="placeholder">No core routines yet. Hit <b>New routine</b> below.</p>';
  $('rt-new').style.display = editingRoutine ? 'none' : '';
  if (editingRoutine) renderBuilder(); else $('rt-builder').innerHTML = '';
}

function renderBuilder() {
  const r = editingRoutine;
  $('rt-builder').innerHTML =
    '<div class="lib-form"><h3>' + (r.id ? 'Edit routine' : 'New routine') + '</h3>' +
    '<div class="fwide"><label>Routine name</label>' +
      '<input type="text" id="cr-name" value="' + esc(r.name) + '" placeholder="e.g. Core circuit"></div>' +
    '<div class="chead"><span>#</span><span>Exercise</span><span>Secs</span><span title="Each side">E/S</span><span></span></div>' +
    '<div id="cr-steps">' + r.steps.map(stepRowHTML).join('') + '</div>' +
    '<button class="addset" id="cr-add">+ add exercise</button>' +
    '<div class="fhint" style="margin:8px 0 12px">Total ' + fmtTime(totalTarget(r.steps)) +
      ' over ' + roundCount(r.steps) + ' round' + (roundCount(r.steps) === 1 ? '' : 's') +
      '. Tick <b>E/S</b> for a side-specific hold - it runs twice, left then right.</div>' +
    '<button class="primary" id="cr-save" style="height:42px">Save routine</button>' +
    '<button id="cr-cancel" style="width:100%;margin-top:8px">Cancel</button>' +
    (r.id ? '<button id="cr-del" style="width:100%;margin-top:8px">Delete routine</button>' : '') +
    '</div>';
}
function stepRowHTML(s, i) {
  return '<div class="cstep"><span class="cno">' + (i + 1) + '</span>' +
    '<input type="text" class="cs-name" value="' + esc(s.name || '') + '" placeholder="e.g. Plank" list="cr-names">' +
    '<input type="number" class="cs-secs" inputmode="numeric" value="' + esc(s.target_s != null ? s.target_s : '') + '" placeholder="60">' +
    '<span class="cps"><input type="checkbox" class="cs-side" title="Each side - runs twice"' +
      (s.per_side ? ' checked' : '') + '></span>' +
    '<span class="cops">' +
      '<button data-cup="' + i + '" title="Move up">&uarr;</button>' +
      '<button data-cdown="' + i + '" title="Move down">&darr;</button>' +
      '<button data-cdup="' + i + '" title="Duplicate">&plus;</button>' +
      '<button data-crm="' + i + '" title="Remove">&times;</button>' +
    '</span></div>';
}
// Read the DOM back into state before any structural change, so half-typed
// edits survive a reorder.
function syncBuilderFromDOM() {
  if (!editingRoutine) return;
  editingRoutine.name = ($('cr-name') || {}).value || editingRoutine.name;
  const rows = [...document.querySelectorAll('#cr-steps .cstep')];
  if (rows.length) editingRoutine.steps = rows.map(el => ({
    name: el.querySelector('.cs-name').value.trim(),
    target_s: parseInt(el.querySelector('.cs-secs').value, 10) || 0,
    per_side: el.querySelector('.cs-side').checked,
  }));
}

async function saveRoutine() {
  syncBuilderFromDOM();
  const r = editingRoutine;
  const name = (r.name || '').trim();
  const steps = r.steps.filter(s => s.name);
  if (!name) { toast('rt-msg', 'Give the routine a name.', 'warn'); return; }
  if (!steps.length) { toast('rt-msg', 'Add at least one exercise.', 'warn'); return; }

  let error, saved;
  if (r.id) {
    ({ error } = await sb.from('tracker_core_routines').update({ name, steps }).eq('id', r.id));
    if (!error) Object.assign(routineById(r.id), { name, steps });
  } else {
    const res = await sb.from('tracker_core_routines').insert({
      profile_id: S.session.user.id, name, steps,
      position: Math.max(0, ...S.routines.map(x => x.position)) + 1,
    }).select().single();
    error = res.error; saved = res.data;
    if (!error) S.routines.push(saved);
  }
  if (error) { toast('rt-msg', 'Save failed: ' + esc(error.message), 'err'); return; }
  editingRoutine = null;
  if (saved) RUN.routineId = saved.id;
  renderRoutines(); renderCoreTab();
  toast('rt-msg', 'Routine saved.');
}

async function deleteRoutine(id) {
  if (!confirm('Delete this routine? Sessions you have already logged are kept.')) return;
  const used = S.coreSessions.some(c => c.routine_id === id);
  let error;
  if (used) {
    ({ error } = await sb.from('tracker_core_routines').update({ retired: true }).eq('id', id));
    if (!error) routineById(id).retired = true;
  } else {
    ({ error } = await sb.from('tracker_core_routines').delete().eq('id', id));
    if (!error) S.routines = S.routines.filter(r => r.id !== id);
  }
  if (error) { toast('rt-msg', 'Delete failed: ' + esc(error.message), 'err'); return; }
  editingRoutine = null;
  if (RUN.routineId === id) RUN.routineId = null;
  renderRoutines(); renderCoreTab();
  toast('rt-msg', used ? 'Routine removed (past sessions kept).' : 'Routine deleted.');
}

/* ---- runner + timer ---- */
function loadRun(routineId) {
  const r = routineById(routineId);
  if (!r) { $('core-runner').innerHTML = ''; return; }
  stopTimer();
  RUN.routineId = r.id;
  RUN.name = r.name;
  // A per-side hold becomes two rounds. They are separate rounds all the way
  // through - separately timed, separately saved - because that is how they
  // are actually done.
  RUN.steps = [];
  stepsOf(r).forEach(s => {
    const t = Number(s.target_s) || 0;
    if (s.per_side) {
      RUN.steps.push({ name: s.name, side: 'L', target_s: t, actual_s: null, rest_s: 0 });
      RUN.steps.push({ name: s.name, side: 'R', target_s: t, actual_s: null, rest_s: 0 });
    } else {
      RUN.steps.push({ name: s.name, target_s: t, actual_s: null, rest_s: 0 });
    }
  });
  RUN.idx = 0; RUN.carried = 0; RUN.running = false;
  RUN.started = false; RUN.idleSince = 0; RUN.restAccum = 0; RUN.notes = '';
  renderRunner();
}

function renderRunner() {
  const done = RUN.steps.every(s => s.actual_s != null);
  const notes = RUN.notes || '';   // every round change re-renders this away
  $('core-runner').innerHTML =
    '<div class="timer">' +
      '<div class="timer-pos" id="tm-pos"></div>' +
      '<div class="timer-step" id="tm-name"></div>' +
      '<div class="timer-clock" id="tm-clock">0:00</div>' +
      '<div class="timer-target" id="tm-target"></div>' +
      '<div class="timer-bar"><i id="tm-bar"></i></div>' +
      '<div class="timer-btns">' +
        '<button class="go" id="tm-go">Start</button>' +
        '<button id="tm-back"' + (RUN.idx <= 0 ? ' disabled' : '') + '>&larr; Back</button>' +
        '<button id="tm-next">Next</button>' +
        '<button id="tm-reset">Reset</button>' +
      '</div>' +
      '<div class="timer-opts">' +
        '<label class="timer-opt"><input type="checkbox" id="tm-auto"' + (autoNext() ? ' checked' : '') + '>' +
          'Roll into the next round</label>' +
        '<label class="timer-opt">Get set' +
          '<select id="tm-count">' + COUNTDOWN_CHOICES.map(v =>
            '<option value="' + v + '"' + (v === countdownS() ? ' selected' : '') + '>' +
            (v ? v + 's' : 'off') + '</option>').join('') + '</select></label>' +
      '</div>' +
      '<div class="timer-tot" id="tm-tot"></div>' +
      (done ? '<div class="timer-done">Routine complete - check the times and save.</div>' : '') +
    '</div>' +
    '<div class="chead run"><span>#</span><span>Exercise</span><span>Target</span><span>Actual</span><span>Reset</span></div>' +
    '<div id="core-rows">' + RUN.steps.map(rowRunHTML).join('') + '</div>' +
    '<p class="crow-hint">Tap <b>e/s</b> on a round to time left and right separately - it becomes two ' +
      'rounds, two times, saved side by side. That is for this run; tick <b>E/S</b> in the routine ' +
      'itself to have it split every time.</p>' +
    '<div class="fwide" style="margin-top:12px"><label>Notes</label>' +
      '<input type="text" id="core-notes" value="' + esc(notes) + '"></div>' +
    '<button class="save" id="core-save">Save core session</button>';
  paintTimer();
}
// A round can be split into left and right on the spot, without going back to
// the routine: you find out a hold is one-sided while you are doing it, not
// while you are writing the circuit down.
function pairOf(i) {
  const s = RUN.steps[i];
  if (!s || !s.side) return null;
  const li = s.side === 'L' ? i : i - 1;
  const l = RUN.steps[li], r = RUN.steps[li + 1];
  if (!l || !r || l.side !== 'L' || r.side !== 'R' || l.name !== r.name) return null;
  return { li, l, r };
}
function splitRound(i) {
  syncActualsFromDOM();
  const s = RUN.steps[i];
  if (!s || s.side || s.actual_s != null) return;
  s.side = 'L'; s.beeped = false;
  RUN.steps.splice(i + 1, 0, { name: s.name, side: 'R', target_s: s.target_s, actual_s: null, rest_s: 0 });
  renderRunner();
}
function mergeRound(i) {
  syncActualsFromDOM();
  const pr = pairOf(i);
  if (!pr || pr.l.actual_s != null || pr.r.actual_s != null) return;
  RUN.steps.splice(pr.li, 2, { name: pr.l.name, target_s: pr.l.target_s, actual_s: null, rest_s: 0 });
  if (RUN.idx > pr.li) RUN.idx = Math.max(0, RUN.idx - 1);
  renderRunner();
}

function rowRunHTML(s, i) {
  // don't offer to re-shape a round that is already recorded or already running
  const open = s.actual_s == null && !(RUN.running && i === RUN.idx) && !(RUN.counting && i === RUN.idx);
  const pr = pairOf(i);
  const side = s.side
    ? '<span class="cside">' + s.side + '</span>' +
      (open && pr && pr.l.actual_s == null && pr.r.actual_s == null
        ? '<button class="sidebtn on" data-cmerge="' + i + '" title="Back to one round">e/s</button>' : '')
    : (open ? '<button class="sidebtn" data-csplit="' + i + '" title="Time each side separately">e/s</button>' : '');
  return '<div class="crow' + (i === RUN.idx ? ' now' : '') + (s.actual_s != null ? ' done' : '') + '" data-crow="' + i + '">' +
    '<span class="cno">' + (i + 1) + '</span>' +
    '<span class="cname">' + esc(s.name) + side + '</span>' +
    '<span class="ctar">' + (s.target_s ? s.target_s + 's' : '–') + '</span>' +
    '<input type="number" inputmode="numeric" class="cs-actual" data-i="' + i + '" ' +
      'value="' + (s.actual_s != null ? s.actual_s : '') + '" placeholder="' + (s.target_s || '') + '">' +
    '<span class="crest">' + (s.rest_s ? s.rest_s + 's' : '–') + '</span></div>';
}

const elapsedNow = () => RUN.carried + (RUN.running ? (Date.now() - RUN.startedAt) / 1000 : 0);
// Work is time on the clock; reset is everything else once the circuit has
// begun - the shuffle between holds, and any pause. Together they are how long
// the session actually took, which is the number that gets away from you.
const workNow = () => RUN.steps.reduce((a, s) => a + (s.actual_s || 0), 0) + elapsedNow();
const restNow = () => RUN.restAccum + (RUN.idleSince ? (Date.now() - RUN.idleSince) / 1000 : 0);

function paintTimer() {
  const s = RUN.steps[RUN.idx];
  const pos = $('tm-pos'); if (!pos) return;
  const clock = $('tm-clock'), bar = $('tm-bar'), go = $('tm-go');
  clock.classList.toggle('count', RUN.counting);

  if (RUN.counting) {
    const left = Math.max(0, Math.ceil((RUN.countEnd - Date.now()) / 1000));
    pos.textContent = 'Get set - round ' + (RUN.idx + 1) + ' of ' + RUN.steps.length;
    $('tm-name').textContent = s ? stepLabel(s) : RUN.name;
    clock.textContent = String(left);
    clock.classList.remove('over');
    $('tm-target').textContent = s && s.target_s ? 'Target ' + s.target_s + 's' : 'No target set';
    bar.style.width = '0%'; bar.classList.remove('over');
    go.textContent = 'Skip';
  } else if (!s) {
    pos.textContent = 'Finished';
    $('tm-name').textContent = RUN.name;
    clock.textContent = fmtClock(0);
    clock.classList.remove('over');
    $('tm-target').textContent = 'All ' + RUN.steps.length + ' rounds done';
    bar.style.width = '100%'; bar.classList.remove('over');
    go.textContent = 'Start';
  } else {
    // Counts UP, and keeps counting past the target rather than jumping on -
    // holding longer than planned is a result, not a mistake to be truncated.
    const el = elapsedNow(), over = (s.target_s || 0) && el > s.target_s;
    pos.textContent = 'Round ' + (RUN.idx + 1) + ' of ' + RUN.steps.length;
    $('tm-name').textContent = stepLabel(s);
    clock.textContent = fmtClock(el);
    clock.classList.toggle('over', !!over);
    $('tm-target').innerHTML = s.target_s
      ? 'Target ' + s.target_s + 's' + (over ? ' · <b>+' + Math.floor(el - s.target_s) + 's over</b>' : '')
      : 'No target - tap Next when you are done';
    bar.style.width = s.target_s ? Math.min(100, (el / s.target_s) * 100) + '%' : '0%';
    bar.classList.toggle('over', !!over);
    go.textContent = RUN.running ? 'Pause' : (el > 0 ? 'Resume' : 'Start');
    // one cue as the target passes, then it is on you to call it
    if (over && !s.beeped && RUN.running) { s.beeped = true; beep(true); }
  }
  paintTotals();
}
function paintTotals() {
  const el = $('tm-tot'); if (!el) return;
  if (!RUN.started) { el.innerHTML = 'Not started · ' + RUN.steps.length + ' rounds, ' +
    fmtClock(RUN.steps.reduce((a, s) => a + (s.target_s || 0), 0)) + ' of work planned'; return; }
  const w = workNow(), r = restNow();
  el.innerHTML = 'Session <b>' + fmtClock(w + r) + '</b> · work <b>' + fmtClock(w) +
    '</b> · reset <b>' + fmtClock(r) + '</b>';
}
const fmtClock = sec => {
  const t = Math.max(0, Math.floor(sec));
  return Math.floor(t / 60) + ':' + pad(t % 60);
};

/* ---- timer engine ---- */
function startTimer(skipCountdown) {
  if (RUN.running || !RUN.steps[RUN.idx]) return;
  if (RUN.counting) { cancelCountdown(); beginRound(); return; }
  const cd = countdownS();
  if (skipCountdown || !cd) { beginRound(); return; }
  RUN.counting = true;
  RUN.countEnd = Date.now() + cd * 1000;
  RUN.lastCount = cd + 1;
  keepAwake(true);
  RUN.countTick = setInterval(() => {
    const left = Math.ceil((RUN.countEnd - Date.now()) / 1000);
    if (left <= 0) { cancelCountdown(); beginRound(); return; }
    if (left !== RUN.lastCount) { RUN.lastCount = left; beep(false); }
    paintTimer();
  }, 80);
  paintTimer();
}
function cancelCountdown() {
  RUN.counting = false;
  if (RUN.countTick) { clearInterval(RUN.countTick); RUN.countTick = null; }
}
function beginRound() {
  absorbIdle();
  RUN.started = true;
  RUN.running = true;
  RUN.startedAt = Date.now();
  RUN.tick = setInterval(paintTimer, 200);
  keepAwake(true);
  beep(true);
  paintTimer();
}
// Everything between working - the reset shuffle, a pause - lands on the round
// that has just been done, so the saved session's rounds still add up to the
// session length shown here.
function absorbIdle() {
  if (!RUN.idleSince) return;
  const secs = (Date.now() - RUN.idleSince) / 1000;
  RUN.idleSince = 0;
  if (!RUN.started) return;          // waiting to start is not resting
  RUN.restAccum += secs;
  const s = RUN.steps[Math.max(0, RUN.idx - 1)];
  if (s) s.rest_s = (s.rest_s || 0) + Math.round(secs);
}
function pauseTimer() {
  cancelCountdown();
  if (!RUN.running) return;
  RUN.carried = elapsedNow();
  RUN.running = false;
  clearInterval(RUN.tick); RUN.tick = null;
  RUN.idleSince = Date.now();
  paintTimer();
}
function stopTimer() {
  cancelCountdown();
  RUN.running = false;
  if (RUN.tick) { clearInterval(RUN.tick); RUN.tick = null; }
  RUN.carried = 0;
  RUN.idleSince = 0;
  keepAwake(false);
}

function nextStep() {
  const s = RUN.steps[RUN.idx];
  if (!s) return;
  syncActualsFromDOM();
  s.actual_s = Math.max(1, Math.round(elapsedNow() || s.target_s || 0));
  cancelCountdown();
  if (RUN.tick) { clearInterval(RUN.tick); RUN.tick = null; }
  RUN.running = false; RUN.carried = 0;
  RUN.idx++;
  RUN.idleSince = Date.now();   // the reset clock starts here
  beep(true);
  if (RUN.idx >= RUN.steps.length) { RUN.idx = RUN.steps.length; stopTimer(); renderRunner(); return; }
  renderRunner();
  if (autoNext()) startTimer();   // countdown, then straight into the next round
}

// Next is one tap and there is no undo, so there has to be a way back. The
// round you return to is un-recorded so it can be timed again, and its rest
// comes back off the running total with it.
function prevStep() {
  if (RUN.idx <= 0) return;
  syncActualsFromDOM();
  cancelCountdown();
  if (RUN.tick) { clearInterval(RUN.tick); RUN.tick = null; }
  RUN.running = false; RUN.carried = 0;
  RUN.idx--;
  const s = RUN.steps[RUN.idx];
  if (s) {
    RUN.restAccum = Math.max(0, RUN.restAccum - (s.rest_s || 0));
    s.actual_s = null; s.rest_s = 0; s.beeped = false;
  }
  RUN.idleSince = Date.now();
  renderRunner();
}

// Hand-typed actuals and notes must survive the re-render that every round
// change causes.
function syncActualsFromDOM() {
  document.querySelectorAll('.cs-actual').forEach(inp => {
    const v = parseInt(inp.value, 10);
    const s = RUN.steps[Number(inp.dataset.i)];
    if (s) s.actual_s = isNaN(v) ? null : v;
  });
  if ($('core-notes')) RUN.notes = $('core-notes').value;
}

// Short tone + buzz so a round change lands without looking at the screen.
// One context, reused: a five-second countdown is five beeps, and browsers cap
// how many AudioContexts a page may open.
let audioCtx = null;
function beep(strong) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) {
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.frequency.value = strong ? 880 : 620;
    gain.gain.setValueAtTime(strong ? 0.18 : 0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (strong ? 0.25 : 0.13));
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + (strong ? 0.26 : 0.14));
  }
  if (navigator.vibrate) navigator.vibrate(strong ? [90, 60, 90] : 40);
}

// Stop the phone locking mid-circuit. Silently unavailable on some browsers.
async function keepAwake(on) {
  try {
    if (on && !RUN.wake && navigator.wakeLock) RUN.wake = await navigator.wakeLock.request('screen');
    else if (!on && RUN.wake) { RUN.wake.release(); RUN.wake = null; }
  } catch (e) { RUN.wake = null; }
}

// Work, reset and the session total for a saved core session. rest_s lives on
// each round rather than in a column of its own, so the shape stays inside the
// existing steps jsonb.
function coreTotals(steps) {
  const work = steps.reduce((a, s) => a + (s.actual_s || 0), 0);
  const rest = steps.reduce((a, s) => a + (s.rest_s || 0), 0);
  return { work, rest, total: work + rest };
}

async function saveCoreSession() {
  syncActualsFromDOM();   // hand-typed overrides win over whatever the timer recorded
  const steps = RUN.steps.filter(s => s.actual_s != null)
    .map(s => ({ name: s.name, side: s.side || null, target_s: s.target_s, actual_s: s.actual_s, rest_s: s.rest_s || 0 }));
  if (!steps.length) { toast('core-msg', 'Nothing to save - time at least one round, or type a number in.', 'warn'); return; }

  const row = {
    id: newId(),
    profile_id: S.session.user.id,
    date: $('core-date').value || todayISO(),
    at: nowHM(),
    routine_id: RUN.routineId,
    routine_name: RUN.name,
    steps,
    notes: (RUN.notes || '').trim() || null,
  };
  const { error } = await insertRow('tracker_core_sessions', row);
  const queued = error && looksOffline(error);
  if (error && !queued) { toast('core-msg', 'Save failed: ' + esc(error.message), 'err'); return; }
  if (queued) queueWrite('tracker_core_sessions', row);

  S.coreSessions.push(row); sortDesc(S.coreSessions);
  const t = coreTotals(steps);
  cacheData();
  track('core_saved', { rounds: steps.length, work_s: t.work, rest_s: t.rest, queued: !!queued });
  stopTimer();
  loadRun(RUN.routineId);
  toast('core-msg',
    (queued ? 'Saved on this device - it will sync when you are back online. ' : 'Saved - ') +
    steps.length + ' round' + (steps.length === 1 ? '' : 's') +
    ' · ' + fmtTime(t.total) + ' total (' + fmtTime(t.work) + ' work, ' + fmtTime(t.rest) + ' reset).',
    queued ? 'warn' : '');
  renderHistory(); renderProgress();
}

function histCoreHTML(s) {
  const steps = Array.isArray(s.steps) ? s.steps : [];
  const t = coreTotals(steps);
  const summary = esc(s.routine_name || 'Core') + ' · ' + fmtTime(t.work) + ' working' +
    (t.rest ? ' · ' + fmtTime(t.total) + ' start to finish' : '');
  const facts = '<dl class="dfacts">' +
    '<dt>Session length</dt><dd>' + fmtTime(t.total) + '</dd>' +
    '<dt>Time working</dt><dd>' + fmtTime(t.work) + '</dd>' +
    '<dt>Time resetting</dt><dd>' + fmtTime(t.rest) +
      (t.total ? ' (' + Math.round((t.rest / t.total) * 100) + '%)' : '') + '</dd></dl>';
  const detail = facts + '<div class="dsub">Rounds</div><div class="dtbl-wrap"><table class="dtbl">' +
    '<thead><tr><th>#</th><th>Exercise</th><th>Target</th><th>Actual</th><th>Diff</th><th>Reset</th></tr></thead><tbody>' +
    steps.map((x, i) => {
      const d = (x.actual_s != null && x.target_s) ? x.actual_s - x.target_s : null;
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(x.name) + (x.side ? ' (' + esc(x.side) + ')' : '') + '</td>' +
        '<td>' + (x.target_s ? x.target_s + 's' : '<span class="na">–</span>') + '</td>' +
        '<td>' + (x.actual_s != null ? x.actual_s + 's' : '<span class="na">–</span>') + '</td>' +
        '<td>' + (d === null ? '<span class="na">–</span>'
          : '<span class="delta ' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '+' : '') + d + 's</span>') +
        '</td><td>' + (x.rest_s ? x.rest_s + 's' : '<span class="na">–</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    (s.notes ? '<div class="dnote">' + esc(s.notes) + '</div>' : '');
  return entryHTML(s, 'core', 'core', summary, detail, 'c');
}

/* ================= summary =================
   One ruled block per week: what the week weighed in at across all three
   disciplines, then the lifts that made it up. Rules and tabular figures, not
   cards - a week should read like a sheet pinned to the boathouse wall. */
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};
const thisMonday = () => mondayOf(todayISO());
// Minutes, because every duration on these screens is compared against another
// duration and h:mm:ss does not subtract in your head.
const fmtHM = min => {
  const t = Math.round(min);
  return t >= 60 ? Math.floor(t / 60) + 'h ' + pad(t % 60) + 'm' : t + 'm';
};

function weeklyStats() {
  const weeks = {};
  S.workouts.forEach(s => {
    const w = mondayOf(s.date);
    const wk = weeks[w] = weeks[w] || { n: 0, sets: 0, ex: {} };
    wk.n++;
    wk.sets += workoutTotals(s).sets;
    Object.keys(s.sets).forEach(id => {
      const e = wk.ex[id] = wk.ex[id] || { times: 0, sets: 0, reps: [], weights: [] };
      e.times++; e.sets += s.sets[id].length;
      s.sets[id].forEach(r => {
        const rv = parseFloat(r.r); if (!isNaN(rv)) e.reps.push(rv);
        const wv = parseFloat(r.w); if (!isNaN(wv)) e.weights.push(wv);
      });
    });
  });
  return weeks;
}

// Erg and core, by week, in the shape both the summary and the progress bars
// want: distance in km, time in minutes, sessions counted.
function ergWeekly() {
  const out = {};
  S.ergs.forEach(s => {
    const w = mondayOf(s.date);
    const e = out[w] = out[w] || { n: 0, km: 0, min: 0 };
    e.n++; e.km += (s.distance_m || 0) / 1000; e.min += (s.total_time_s || 0) / 60;
  });
  return out;
}
function waterWeekly() {
  const out = {};
  S.water.forEach(s => {
    const w = mondayOf(s.date);
    const e = out[w] = out[w] || { n: 0, km: 0, min: 0 };
    e.n++; e.km += (s.distance_m || 0) / 1000; e.min += (s.total_time_s || 0) / 60;
  });
  return out;
}
function coreWeekly() {
  const out = {};
  S.coreSessions.forEach(s => {
    const w = mondayOf(s.date);
    const c = out[w] = out[w] || { n: 0, min: 0, rest: 0 };
    c.n++;
    (Array.isArray(s.steps) ? s.steps : []).forEach(x => {
      c.min += (x.actual_s || 0) / 60; c.rest += (x.rest_s || 0) / 60;
    });
  });
  return out;
}

const statCell = (lab, val, unit, note, dim) =>
  '<div class="sm' + (dim ? ' dim' : '') + '"><div class="sm-lab">' + lab + '</div>' +
  '<div class="sm-val">' + val + (unit ? '<i>' + unit + '</i>' : '') + '</div>' +
  '<div class="sm-note">' + note + '</div></div>';

// The week across all three disciplines at once - the one view neither
// Progress (one discipline, one measure) nor a session list gives you. It
// heads each week in History.
function weekStripHTML(wk, eg, wa, cw) {
  const dist = (a, lab) => statCell(lab, a ? round1(a.km) : '–', a ? 'km' : '',
    a ? plural(a.n, 'session') + (a.min ? ' · ' + fmtHM(a.min) : '') : 'none logged', !a);
  return '<div class="sum-strip">' +
    statCell('Weights', wk ? wk.n : '–', '', wk ? wk.sets + ' sets' : 'none logged', !wk) +
    dist(eg, 'Erg') +
    dist(wa, 'Water') +
    statCell('Core', cw ? fmtHM(cw.min) : '–', '',
      cw ? plural(cw.n, 'session') : 'none logged', !cw) +
    '</div>';
}

// Every lift in one week, grouped by movement, with the change in average
// load against the last week you did it. Progress charts one lift at a time,
// so this is the only place a whole week of lifting is on one page.
function liftWeekHTML(wk, prev) {
  const ids = Object.keys(wk.ex).sort((a, b) =>
    patIdx(patternOf(a)) - patIdx(patternOf(b)) || exName(a).localeCompare(exName(b)));
  const pats = [...new Set(ids.map(patternOf))];
  return '<table class="sumtbl"><thead><tr><th>Exercise</th>' +
    '<th class="n">Sets</th><th class="n">Avg reps</th><th class="n">Avg load</th></tr></thead><tbody>' +
    pats.map(p => '<tr class="patrow"><td colspan="4">' + esc(cap(p)) + '</td></tr>' +
      ids.filter(id => patternOf(id) === p).map(id => {
        const e = wk.ex[id], m = exById(id) || {};
        const timeOnly = m.unit === 'secs';
        const aReps = mean(e.reps), aW = mean(e.weights);
        let delta = '';
        if (prev && prev.ex[id] && prev.ex[id].weights.length && e.weights.length) {
          const d = round1(aW - mean(prev.ex[id].weights));
          if (d !== 0) delta = ' <span class="delta ' + (d > 0 ? 'up' : 'down') + '">' +
            (d > 0 ? '▲' : '▼') + Math.abs(d) + '</span>';
        }
        return '<tr><td class="exc"><span class="nm">' + esc(exName(id)) + '</span>' +
          '<span class="x">×' + e.times + '</span></td>' +
          '<td class="n">' + e.sets + '</td>' +
          '<td class="n">' + (aReps !== null ? round1(aReps) + (timeOnly ? 's' : '') : '–') + '</td>' +
          '<td class="n">' + (timeOnly ? '<span class="na">–</span>'
            : aW !== null ? round1(aW) + '<i>kg</i>' + delta : '<span class="na">BW</span>') +
          '</td></tr>';
      }).join('')).join('') + '</tbody></table>';
}

/* ================= progress =================
   Three things get plotted here and they are not the same shape, so the tab
   switches between them rather than stacking them:
     Weights - one lift, one measure, a line by session.
     Erg and Core - weekly load as bars, because "am I getting through more"
     is a question about weeks, not about single sessions.
   Never two measures on one axis. Session tonnage is gone on purpose: it moves
   when the rep scheme changes and says nothing about whether you got stronger. */
// Twelve weeks is the block a rower actually thinks in; everything else is
// "zoom out". Two states, one button, instead of a four-way dropdown.
const RANGE_DEFAULT = '12';
// Not a uuid, so it can never collide with a real exercise id.
const ALL_LIFTS = 'all-lifts';
// Weights opens on the whole picture, not on whichever lift happened to be
// first alphabetically: "how much am I lifting" comes before "how is the squat
// going", and the second question is one dropdown away.
const PROG = { mode: 'weights', ex: ALL_LIFTS, metric: '', weeks: RANGE_DEFAULT };

const REP_METRICS = [
  { k: 'top',  btn: 'Heaviest set', label: 'Heaviest set',  unit: 'kg' },
  { k: 'e1rm', btn: 'Est. 1RM',     label: 'Estimated 1RM', unit: 'kg' },
];
const SEC_METRICS = [
  { k: 'top',    btn: 'Longest hold', label: 'Longest hold',    unit: 's' },
  { k: 'volume', btn: 'Total held',   label: 'Total time held', unit: 's' },
];
const metricsFor = m => (m && m.unit === 'secs') ? SEC_METRICS : REP_METRICS;
// Epley. Named on the chart, because an estimate presented as a measurement is
// worse than no estimate.
const e1rm = (w, reps) => w * (1 + reps / 30);

// dp is the precision the number is SHOWN at; week-on-week change is computed
// from the rounded figures so the table can never read "8m, 8m, +0.1".
// `btn` is the word on the toggle, `label` the sentence under the heading,
// `col` the table header, `short` the compact form used on bars and in cells.
const ERG_METRICS = [
  { k: 'km',  btn: 'Distance', label: 'Distance a week', col: 'Distance', dp: 1,
    fmt: v => round1(v) + ' km', short: v => round1(v) + ' km', bar: v => round1(v) + ' km' },
  { k: 'min', btn: 'Time',     label: 'Time a week',     col: 'Time',     dp: 0,
    fmt: v => fmtHM(v), short: v => fmtHM(v), bar: v => fmtHM(v) },
];
const WEIGHT_WEEK_METRICS = [
  { k: 'n',    btn: 'Sessions', label: 'Sessions a week', col: 'Sessions', dp: 0,
    fmt: v => plural(Math.round(v), 'session'), short: v => String(Math.round(v)), bar: v => Math.round(v) },
  { k: 'sets', btn: 'Sets',     label: 'Sets a week',     col: 'Sets',     dp: 0,
    fmt: v => plural(Math.round(v), 'set'),     short: v => String(Math.round(v)), bar: v => Math.round(v) },
];
const CORE_METRICS = [
  { k: 'min', btn: 'Time',     label: 'Time working a week', col: 'Working',  dp: 0,
    fmt: v => fmtHM(v), short: v => fmtHM(v), bar: v => fmtHM(v) },
  { k: 'n',   btn: 'Sessions', label: 'Sessions a week',     col: 'Sessions', dp: 0,
    fmt: v => plural(Math.round(v), 'session'), short: v => String(Math.round(v)), bar: v => Math.round(v) },
];

// Water takes the same measures as the erg - distance, time, sessions - so it
// shares the list rather than duplicating it.
const WATER_METRICS = ERG_METRICS;
const weeklyMetrics = mode =>
  mode === 'core' ? CORE_METRICS
  : mode === 'weights' ? WEIGHT_WEEK_METRICS
  : mode === 'water' ? WATER_METRICS : ERG_METRICS;
// The weekly shape of each, in the form weeklySeries() wants.
const weeklyAgg = mode =>
  mode === 'core' ? coreWeekly()
  : mode === 'erg' ? ergWeekly()
  : mode === 'water' ? waterWeekly() : weightsWeekly();
function weightsWeekly() {
  const out = {};
  const w = weeklyStats();
  Object.keys(w).forEach(k => { out[k] = { n: w[k].n, sets: w[k].sets }; });
  return out;
}
const pickMetric = (list, k) => list.find(x => x.k === k) || list[0];

function progressSeries(exId, metric) {
  const m = exById(exId) || {};
  const timeOnly = m.unit === 'secs';
  const pts = [];
  [...S.workouts].reverse().forEach(w => {
    const rows = w.sets[exId];
    if (!rows || !rows.length) return;
    const sets = rows.map(r => ({ reps: parseFloat(r.r), wt: parseFloat(r.w) })).filter(x => !isNaN(x.reps));
    if (!sets.length) return;
    let v = null, best = null;
    if (timeOnly) {
      if (metric === 'volume') v = sets.reduce((a, s) => a + s.reps, 0);
      else { best = sets.reduce((a, s) => (a && a.reps >= s.reps) ? a : s, null); v = best.reps; }
    } else {
      const wt = sets.filter(s => !isNaN(s.wt));
      if (!wt.length) return;                      // bodyweight-only day: nothing to plot
      if (metric === 'e1rm') {
        best = wt.reduce((a, s) => (a && e1rm(a.wt, a.reps) >= e1rm(s.wt, s.reps)) ? a : s, null);
        v = e1rm(best.wt, best.reps);
      } else {
        best = wt.reduce((a, s) => (a && a.wt >= s.wt) ? a : s, null);
        v = best.wt;
      }
    }
    if (v == null || !isFinite(v) || v <= 0) return;
    pts.push({ date: w.date, v: round1(v), sets, best, id: w.id });
  });
  return pts;
}

// Erg and core roll up by week, and the empty weeks have to be in the series:
// a fortnight off is the most important thing a load chart can show you.
function weeklySeries(agg, metricKey, range) {
  const logged = Object.keys(agg).sort();
  if (!logged.length) return [];
  const end = thisMonday();
  let start = range === 'all' ? logged[0] : addDays(end, -7 * (parseInt(range, 10) - 1));
  if (start < logged[0]) start = logged[0];
  if (start > end) start = end;
  const out = [];
  for (let w = start; w <= end; w = addDays(w, 7)) {
    const a = agg[w] || { n: 0, km: 0, min: 0, sets: 0 };
    out.push({ date: w, v: round1(a[metricKey] || 0), n: a.n });
  }
  return out;
}

// plotted point positions, for the hover layer. A line wants a crosshair and
// a moving dot; bars want the bar itself to light up.
let chartPts = [];
let chartMode = 'line';

const niceStep = span => {
  const raw = span / 4, pow = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
};

// Rendered at a measured pixel width rather than scaled from a viewBox, so the
// axis labels stay 10px on a phone instead of shrinking to nothing.
function chartHTML(pts, unit, W) {
  // top padding leaves room for the value label that sits above the top point
  const H = 250, P = { t: 30, r: 14, b: 28, l: 46 };
  const iw = Math.max(40, W - P.l - P.r), ih = H - P.t - P.b;
  const ts = pts.map(p => new Date(p.date + 'T12:00:00').getTime());
  const t0 = ts[0], t1 = ts[ts.length - 1], span = (t1 - t0) || 1;
  const vs = pts.map(p => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const step = niceStep((hi - lo) || hi || 1);
  let y0 = Math.max(0, Math.floor(lo / step) * step - (hi === lo ? step : 0));
  let y1 = Math.ceil(hi / step) * step + (hi === lo ? step : 0);
  // a lowest point sitting exactly on the axis line reads as falling off it
  if (lo === y0 && y0 > 0) y0 = Math.max(0, y0 - step);
  if (y1 === y0) y1 = y0 + step;
  // Time-scaled, so a month off training shows as a gap. Two sessions on the
  // same date would otherwise land on one x, so that case falls back to even
  // spacing by session.
  const xs = (t1 === t0)
    ? pts.map((_, i) => P.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw))
    : ts.map(t => P.l + ((t - t0) / span) * iw);
  const Y = v => P.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const xy = pts.map((p, i) => [xs[i], Y(p.v)]);

  const grid = [];
  for (let v = y0; v <= y1 + 1e-9; v += step) {
    grid.push('<line class="cgrid" x1="' + P.l + '" y1="' + Y(v).toFixed(1) + '" x2="' + (P.l + iw) + '" y2="' + Y(v).toFixed(1) + '"/>' +
      '<text class="ctick" x="' + (P.l - 8) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + round1(v) + '</text>');
  }

  const line = xy.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const area = line + ' L' + xy[xy.length - 1][0].toFixed(1) + ' ' + (P.t + ih) + ' L' + xy[0][0].toFixed(1) + ' ' + (P.t + ih) + ' Z';

  // Label the latest, the peak and the start - in that order of priority, and
  // only where there is room. A number on every point is noise, and two numbers
  // on top of each other are worse than one.
  const GAP = 46;
  const iMax = vs.indexOf(hi);
  const marked = [];
  [pts.length - 1, iMax, 0].forEach(i => {
    if (i < 0 || marked.includes(i)) return;
    if (marked.some(j => Math.abs(xs[j] - xs[i]) < GAP)) return;
    marked.push(i);
  });
  const labels = marked.sort((a, b) => a - b).map(i => {
    const [x, y] = xy[i];
    const anchor = i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle';
    const dx = i === 0 ? -3 : i === pts.length - 1 ? 3 : 0;
    return '<text class="clab" x="' + (x + dx).toFixed(1) + '" y="' + (y - 12).toFixed(1) + '" text-anchor="' + anchor + '">' +
      round1(pts[i].v) + unit + '</text>';
  }).join('');

  const ends = xy[xy.length - 1][0] - xy[0][0] < GAP ? [pts.length - 1] : [0, pts.length - 1];
  const xlabs = ends.map(i =>
    '<text class="ctick" x="' + xy[i][0].toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' +
      (i === 0 ? 'start' : 'end') + '">' + shortDate(pts[i].date) + '</text>').join('');

  chartMode = 'line';
  chartPts = pts.map((p, i) => ({
    x: +xy[i][0].toFixed(1), y: +xy[i][1].toFixed(1),
    lab: prettyDate(p.date), val: round1(p.v) + unit,
    sub: p.best ? topSetText(p.best, unit === 's') : '',
  }));
  return '<div class="chartwrap" id="chartwrap">' +
    '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Progress over time; the same numbers are in the table below">' +
      grid.join('') +
      '<path class="carea" d="' + area + '"/>' +
      '<path class="cline" d="' + line + '"/>' +
      '<line class="caxis" x1="' + P.l + '" y1="' + (P.t + ih) + '" x2="' + (P.l + iw) + '" y2="' + (P.t + ih) + '"/>' +
      '<line class="ccross" id="ch-cross" x1="0" y1="' + P.t + '" x2="0" y2="' + (P.t + ih) + '" style="display:none"/>' +
      xy.map(([x, y]) => '<circle class="cdot" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4.5"/>').join('') +
      '<circle class="cdot-hi" id="ch-hi" cx="0" cy="0" r="6.5" style="display:none"/>' +
      labels + xlabs +
      '<rect id="ch-hit" x="' + P.l + '" y="' + P.t + '" width="' + iw + '" height="' + ih + '" fill="transparent"/>' +
    '</svg><div class="ctip" id="ch-tip" style="display:none"></div></div>';
}

const topSetText = (s, timeOnly) => !s ? ''
  : timeOnly ? round1(s.reps) + 's hold'
  : isNaN(s.wt) ? round1(s.reps) + ' reps bodyweight'
  : round1(s.reps) + ' × ' + round1(s.wt) + 'kg';

// Weekly load, drawn the way a training app draws it and not the way a
// scientific plot does: no y-axis, no gridlines, one dashed average line, and
// the bars carrying the shape. The numbers a person actually wants off it -
// this week, the average, the best week - are in the tiles directly above, so
// axis ticks would be a third copy of them. Reading a single bar is a hover
// or a tap.
function barsHTML(pts, metric, W) {
  // Top padding carries the value labels that sit above each bar.
  const H = 196, P = { t: 24, r: 10, b: 26, l: 10 };
  const iw = Math.max(40, W - P.l - P.r), ih = H - P.t - P.b;
  const vs = pts.map(p => p.v);
  const hi = Math.max(...vs, 0);
  const avg = vs.reduce((a, x) => a + x, 0) / (vs.length || 1);
  // Headroom so the tallest bar is not jammed against the top, and a floor so
  // a series of noughts still draws a sane baseline.
  const y1 = Math.max(hi, avg) * 1.1 || 1;
  const Y = v => P.t + ih - (v / y1) * ih;
  const slot = iw / pts.length;
  const bw = Math.max(3, Math.min(58, slot * 0.62));
  const cx = i => P.l + slot * (i + 0.5);

  const bars = pts.map((p, i) => {
    if (!p.v) return '';                          // an untrained week is a gap
    const h = Math.max(2, ih - (Y(p.v) - P.t));
    return '<rect class="cbar' + (i === pts.length - 1 ? ' last' : '') + '" data-bar="' + i + '" x="' +
      (cx(i) - bw / 2).toFixed(1) + '" y="' + (P.t + ih - h).toFixed(1) +
      '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '"/>';
  }).join('');

  // The week's figure above its own bar, so the chart reads without hovering.
  // Zoomed out to a year the slots are narrower than the text, and overlapping
  // numbers are worse than none - so they thin out and the tooltip takes over.
  // Thinning is driven by the width of the widest label, not a fixed slot
  // width: "35.5 km" needs half again the room of "12", and a label that
  // carries its unit is worth more than one that reads as a bare number.
  const labelText = p => String((metric.bar || metric.short)(p.v));
  const widest = pts.reduce((m, p) => p.v ? Math.max(m, labelText(p).length) : m, 0);
  const need = widest * 6.3 + 8;               // mono 10.5px, plus a gap
  const labelEvery = slot >= need ? 1 : slot * 2 >= need ? 2 : 0;
  const barLabels = !labelEvery ? '' : pts.map((p, i) => {
    if (!p.v || (pts.length - 1 - i) % labelEvery) return '';
    return '<text class="cbarlab' + (i === pts.length - 1 ? ' last' : '') + '" x="' + cx(i).toFixed(1) +
      '" y="' + (Y(p.v) - 7).toFixed(1) + '" text-anchor="middle">' +
      esc(labelText(p)) + '</text>';
  }).join('');

  // One flat average across what is on screen: "is this week above or below
  // how I normally train" is the question a load chart gets asked. It is not
  // labelled on the chart - the Weekly average tile is directly above it, and
  // an inline label collides with the bars on a phone.
  let avgLine = '';
  if (avg > 0 && pts.length > 2) {
    const y = Y(avg).toFixed(1);
    avgLine = '<line class="cavg" x1="' + P.l + '" y1="' + y + '" x2="' + (P.l + iw) + '" y2="' + y + '"/>';
  }

  // One x label roughly every fifth bar, always including the last week
  const every = Math.max(1, Math.ceil(pts.length / 5));
  const xlabs = pts.map((p, i) => {
    if (i !== pts.length - 1 && (pts.length - 1 - i) % every) return '';
    return '<text class="ctick" x="' + cx(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' +
      shortDate(p.date) + '</text>';
  }).join('');

  chartMode = 'bar';
  chartPts = pts.map((p, i) => ({
    x: +cx(i).toFixed(1), y: +Y(p.v).toFixed(1),
    lab: 'Week of ' + shortDate(p.date),
    val: metric.fmt(p.v),
    sub: p.v ? '' : 'nothing logged',
  }));

  return '<div class="chartwrap" id="chartwrap">' +
    '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Weekly training load; the same numbers are in the table below">' +
      bars + barLabels + avgLine +
      '<line class="caxis" x1="' + P.l + '" y1="' + (P.t + ih) + '" x2="' + (P.l + iw) + '" y2="' + (P.t + ih) + '"/>' +
      xlabs +
      '<rect id="ch-hit" x="' + P.l + '" y="' + P.t + '" width="' + iw + '" height="' + (ih + 10) + '" fill="transparent"/>' +
    '</svg><div class="ctip" id="ch-tip" style="display:none"></div></div>';
}

const tileHTML = (lab, val, note, cls) =>
  '<div class="tile"><div class="tile-lab">' + lab + '</div>' +
  '<div class="tile-val' + (cls ? ' ' + cls : '') + '">' + val + '</div>' +
  '<div class="tile-note">' + note + '</div></div>';

/* ---- controls ---- */
// Everything on this row is a button now, because every choice here has two or
// three options and a dropdown hides the alternatives behind a click.
const metricToggle = (metrics, current) => metrics.length < 2 ? '' :
  '<div class="segmented sm" role="group" aria-label="Measure">' + metrics.map(m =>
    '<button class="seg' + (m.k === current ? ' active' : '') + '" data-pmetric="' + m.k + '" ' +
    'aria-pressed="' + (m.k === current) + '">' + esc(m.btn || m.label) + '</button>').join('') + '</div>';

const rangeToggle = () =>
  '<button class="seg solo" data-prange="' + (PROG.weeks === 'all' ? RANGE_DEFAULT : 'all') + '">' +
  (PROG.weeks === 'all' ? 'Last ' + RANGE_DEFAULT + ' weeks' : 'Show all time') + '</button>';

function progControlsHTML() {
  const seg = ['weights', 'erg', 'water', 'core'].map(k =>
    '<button class="seg' + (PROG.mode === k ? ' active' : '') + '" data-pmode="' + k + '" ' +
    'role="tab" aria-selected="' + (PROG.mode === k) + '">' + cap(k) + '</button>').join('');
  let rest = '';
  if (PROG.mode === 'weights') {
    const done = new Set();
    S.workouts.forEach(w => Object.keys(w.sets).forEach(id => done.add(id)));
    const opts = S.exercises.filter(e => done.has(e.id));
    if (opts.length) {
      if (PROG.ex !== ALL_LIFTS && !opts.some(e => e.id === PROG.ex)) PROG.ex = opts[0].id;
      const all = PROG.ex === ALL_LIFTS;
      // All lifts is a weekly load view like the rest; one lift takes the
      // per-lift measures. The exercise list stays a select - it is the one
      // control here with more than a handful of options.
      const metrics = all ? WEIGHT_WEEK_METRICS : metricsFor(exById(PROG.ex));
      if (!metrics.some(x => x.k === PROG.metric)) PROG.metric = metrics[0].k;
      rest =
        '<select id="prog-pick" aria-label="Exercise">' +
          '<option value="' + ALL_LIFTS + '"' + (all ? ' selected' : '') + '>' +
          'All lifts, week by week</option>' +
          opts.map(e =>
          '<option value="' + e.id + '"' + (e.id === PROG.ex ? ' selected' : '') + '>' +
          esc(e.name) + (e.retired ? ' (retired)' : '') + '</option>').join('') + '</select>' +
        metricToggle(metrics, PROG.metric) +
        (all ? rangeToggle() : '');
    }
  } else {
    const metrics = weeklyMetrics(PROG.mode);
    if (!metrics.some(x => x.k === PROG.metric)) PROG.metric = metrics[0].k;
    rest = metricToggle(metrics, PROG.metric) + rangeToggle();
  }
  return '<div class="segmented" role="tablist" aria-label="What to chart">' + seg + '</div>' +
    (rest ? '<div class="progbar">' + rest + '</div>' : '');
}

function renderProgress() {
  const body = $('prog-body'), ctl = $('prog-controls');
  if (!body || !ctl) return;
  ctl.innerHTML = progControlsHTML();
  if (PROG.mode !== 'weights') { renderProgWeekly(body); return; }
  if (PROG.ex === ALL_LIFTS) renderProgAllLifts(body);
  else renderProgWeights(body);
}

// Tiles + bars, shared by all three weekly load views. The tiles carry the
// numbers, which is what lets the chart drop its axis.
function weeklyLoadHTML(pts, metric, width) {
  const vs = pts.map(p => p.v);
  const last = pts[pts.length - 1];
  const hi = Math.max(...vs), hiAt = pts[vs.indexOf(hi)];
  const avg = vs.reduce((a, x) => a + x, 0) / vs.length;
  // This week against the mean of the weeks before it: the comparison you are
  // actually making when you look at a load chart.
  const before = vs.slice(0, -1);
  const prevAvg = before.length ? before.reduce((a, x) => a + x, 0) / before.length : null;
  const f = Math.pow(10, metric.dp);
  const diff = prevAvg == null ? null : Math.round((last.v - prevAvg) * f) / f;
  const weeksOn = vs.filter(v => v > 0).length;

  return '<div class="prog-tiles">' +
      tileHTML('This week', metric.fmt(last.v),
        diff == null ? 'first week logged'
          : diff === 0 ? 'level with your average'
          : (diff > 0 ? '+' : '-') + metric.short(Math.abs(diff)) + ' on your average',
        !diff ? '' : diff > 0 ? 'up' : 'down') +
      tileHTML('Weekly average', metric.fmt(avg), weeksOn + ' of ' + pts.length + ' weeks trained') +
      tileHTML('Best week', metric.fmt(hi), shortDate(hiAt.date)) +
    '</div>' +
    barsHTML(pts, metric, width) +
    '<p class="chart-note">Tap or hover a bar for the week. Weeks you did nothing are left as gaps, ' +
    'not skipped; the dashed line is your average over the range shown.</p>';
}

// Every lift, week by week: how much lifting, then what it consisted of. This
// is the view that answers "what did I actually lift last week", which a
// per-lift chart cannot.
function renderProgAllLifts(body) {
  const metric = pickMetric(WEIGHT_WEEK_METRICS, PROG.metric);
  const pts = weeklySeries(weightsWeekly(), metric.k, PROG.weeks);
  const head = '<div class="prog-head"><h3 class="prog-title">All lifts</h3>' +
    '<span class="prog-sub">' + esc(metric.label) + ', Monday to Sunday · the arrow in each ' +
    'week compares average load with the previous week you did that lift</span></div>';
  if (!pts.length) {
    body.innerHTML = head + '<p class="empty">No weights sessions logged yet. Anything you record ' +
      'on the Weights tab shows up here as weekly load, and lift by lift underneath.</p>';
    return;
  }

  // Only the weeks on the chart get a table, so the range control governs the
  // whole page rather than just its top.
  const weeks = weeklyStats();
  const all = Object.keys(weeks).sort();
  const tables = pts.map(p => p.date).filter(w => weeks[w]).reverse().map(w => {
    // The comparison week is the last one you lifted, even where that falls
    // off the bottom of the range on screen.
    const prevKey = [...all].reverse().find(k => k < w);
    return '<section class="sumweek"><div class="sum-head">' +
      '<h4>' + shortDate(w) + ' - ' + shortDate(addDays(w, 6)) + '</h4>' +
      '<span class="sum-count">' + plural(weeks[w].n, 'session') + ' · ' +
        plural(weeks[w].sets, 'set') + '</span></div>' +
      liftWeekHTML(weeks[w], prevKey ? weeks[prevKey] : null) + '</section>';
  }).join('');

  body.innerHTML = head + weeklyLoadHTML(pts, metric, Math.max(300, body.clientWidth || 620)) +
    (tables || '<p class="empty">Nothing lifted in this range.</p>');
  wireChart();
}

function renderProgWeights(body) {
  if (!$('prog-pick')) {
    body.innerHTML = '<p class="empty">Log a few weights sessions and this fills in - one lift at a ' +
      'time, so you can see whether it is actually moving.</p>';
    return;
  }
  const m = exById(PROG.ex) || {};
  const metric = pickMetric(metricsFor(m), PROG.metric);
  const timeOnly = m.unit === 'secs';
  const pts = progressSeries(PROG.ex, metric.k);
  const head = '<div class="prog-head"><h3 class="prog-title">' + esc(m.name || '') + '</h3>' +
    '<span class="prog-sub">' + esc(metric.label) + ' by session' +
    (metric.k === 'e1rm' ? ' · Epley estimate from your best set, not a tested max' : '') + '</span></div>';

  if (!pts.length) {
    body.innerHTML = head + '<p class="empty">No sets with a weight recorded for this one yet.</p>';
    return;
  }

  const vs = pts.map(p => p.v);
  const last = pts[pts.length - 1];
  const best = Math.max(...vs), bestAt = pts[vs.indexOf(best)];
  const change = round1(last.v - pts[0].v);
  const tiles = '<div class="prog-tiles">' +
    tileHTML('Latest', round1(last.v) + metric.unit,
      shortDate(last.date) + (last.best ? ' · ' + topSetText(last.best, timeOnly) : '')) +
    tileHTML('Best', round1(best) + metric.unit, shortDate(bestAt.date)) +
    tileHTML('Since ' + shortDate(pts[0].date), (change > 0 ? '+' : '') + change + metric.unit,
      pts.length + ' session' + (pts.length === 1 ? '' : 's'),
      change > 0 ? 'up' : change < 0 ? 'down' : '') +
    '</div>';

  const chart = pts.length > 1
    ? chartHTML(pts, metric.unit, Math.max(300, body.clientWidth || 620)) +
      '<p class="chart-note">Tap or hover the chart for a session. Every session is in the table below.</p>'
    : '<p class="chart-note">One session so far - the chart starts once there are two.</p>';

  const table = '<div class="dtbl-wrap"><table class="dtbl prog-tbl">' +
    '<thead><tr><th>Date</th><th class="n">' + esc(metric.label) + '</th><th class="n">Change</th>' +
    '<th>Top set</th><th>All sets</th></tr></thead><tbody>' +
    [...pts].reverse().map((p, i, arr) => {
      const prev = arr[i + 1];
      const d = prev ? round1(p.v - prev.v) : null;
      return '<tr><td>' + shortDate(p.date) + '</td>' +
        '<td class="n">' + round1(p.v) + metric.unit + '</td>' +
        '<td class="n">' + (d === null || d === 0 ? '<span class="na">–</span>'
          : '<span class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '') + d + '</span>') + '</td>' +
        '<td>' + esc(topSetText(p.best, timeOnly) || '–') + '</td>' +
        '<td class="dim">' + esc(p.sets.map(s => (isNaN(s.wt) ? round1(s.reps) + (timeOnly ? 's' : '')
          : round1(s.reps) + '×' + round1(s.wt))).join('  ')) + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  body.innerHTML = head + tiles + chart + table;
  wireChart();
}

function renderProgWeekly(body) {
  const label = { erg: 'Erg', water: 'Water', core: 'Core' }[PROG.mode];
  const metric = pickMetric(weeklyMetrics(PROG.mode), PROG.metric);
  const pts = weeklySeries(weeklyAgg(PROG.mode), metric.k, PROG.weeks);
  const head = '<div class="prog-head"><h3 class="prog-title">' + label + ' load</h3>' +
    '<span class="prog-sub">' + esc(metric.label) + ', Monday to Sunday</span></div>';

  if (!pts.length) {
    body.innerHTML = head + '<p class="empty">No ' + label.toLowerCase() +
      ' sessions logged yet. Anything you record on the ' + label +
      ' tab shows up here as weekly load.</p>';
    return;
  }

  const agg = weeklyAgg(PROG.mode);
  const shown = v => { const f = Math.pow(10, metric.dp); return Math.round(v * f) / f; };
  const rows = [...pts].reverse().map((p, i, arr) => {
    const prev = arr[i + 1];
    const d = prev ? round1(shown(p.v) - shown(prev.v)) : null;
    const a = agg[p.date] || { n: 0, km: 0, min: 0 };
    const detail = a.n
      ? plural(a.n, 'session') + ' \u00b7 ' +
        (PROG.mode === 'core' ? fmtHM(a.min) + ' working'
          : round1(a.km) + ' km' + (a.min ? ' \u00b7 ' + fmtHM(a.min) : ''))
      : 'nothing logged';
    return '<tr' + (p.v ? '' : ' class="offweek"') + '><td>' + shortDate(p.date) + ' - ' + shortDate(addDays(p.date, 6)) + '</td>' +
      '<td class="n">' + esc(metric.short(p.v)) + '</td>' +
      '<td class="n">' + (d === null || d === 0 ? '<span class="na">\u2013</span>'
        : '<span class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '') + round1(d) + '</span>') + '</td>' +
      '<td class="dim">' + esc(detail) + '</td></tr>';
  }).join('');
  const table = '<div class="dtbl-wrap"><table class="dtbl prog-tbl">' +
    '<thead><tr><th>Week</th><th class="n">' + esc(metric.col) + '</th>' +
    '<th class="n">Change</th><th>Detail</th></tr></thead><tbody>' +
    rows + '</tbody></table></div>';

  body.innerHTML = head + weeklyLoadHTML(pts, metric, Math.max(300, body.clientWidth || 620)) + table;
  wireChart();
}

// A chart on a page is interactive by default, and the hit target is the whole
// plot rather than the marks. What lights up depends on the chart: a line gets
// the crosshair and a moving dot, bars get the bar under your finger.
function wireChart() {
  const wrap = $('chartwrap');
  if (!wrap || !chartPts.length) return;
  const pts = chartPts, bars = chartMode === 'bar';
  const hit = $('ch-hit'), tip = $('ch-tip');
  const cross = $('ch-cross'), hi = $('ch-hi');
  let lit = null;
  const move = ev => {
    const r = wrap.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    let near = pts[0], ni = 0;
    pts.forEach((p, i) => { if (Math.abs(p.x - px) < Math.abs(near.x - px)) { near = p; ni = i; } });
    if (bars) {
      if (lit) lit.classList.remove('on');
      lit = wrap.querySelector('[data-bar="' + ni + '"]');
      if (lit) lit.classList.add('on');
    } else {
      cross.setAttribute('x1', near.x); cross.setAttribute('x2', near.x);
      cross.style.display = ''; hi.style.display = '';
      hi.setAttribute('cx', near.x); hi.setAttribute('cy', near.y);
    }
    tip.innerHTML = '<span class="tdate">' + esc(near.lab) + '</span><br><b>' + esc(near.val) + '</b>' +
      (near.sub ? '<br><span class="tsub">' + esc(near.sub) + '</span>' : '');
    tip.style.display = '';
    tip.style.left = Math.min(r.width - 8, Math.max(8, near.x)) + 'px';
    tip.style.top = (near.y - 10) + 'px';
  };
  const leave = () => {
    if (lit) { lit.classList.remove('on'); lit = null; }
    if (cross) cross.style.display = 'none';
    if (hi) hi.style.display = 'none';
    tip.style.display = 'none';
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
}

/* ================= history =================
   Filtering is client-side over what is already loaded, so it is instant and
   works offline. The week strip keeps showing the WHOLE week even when a
   filter is on: it is the context for what you are looking at, and hiding
   three quarters of it would make a filtered week look like a light one. */
let histFilter = 'all';
const HIST_KINDS = [
  { k: 'all',   label: 'All' },
  { k: 'w',     label: 'Weights' },
  { k: 'e',     label: 'Erg' },
  { k: 'wa',    label: 'Water' },
  { k: 'c',     label: 'Core' },
];

/* ================= history =================
   A ruled list, one line per session, grouped by week. Date, discipline and a
   one-line summary line up in columns down the page so a month of training can
   be read without opening anything; the detail is one tap away. */
function renderHistory() {
  const el = $('hist-body');
  const all = [
    ...S.workouts.map(r => ({ kind: 'w', r })),
    ...S.ergs.map(r => ({ kind: 'e', r })),
    ...S.water.map(r => ({ kind: 'wa', r })),
    ...S.coreSessions.map(r => ({ kind: 'c', r })),
  ];
  if (!all.length) {
    el.innerHTML = '<p class="empty">No sessions logged yet. Whatever you record on the ' +
      'Weights, Erg and Core tabs lands here, newest first.</p>';
    return;
  }

  const counts = { all: all.length, w: 0, e: 0, wa: 0, c: 0 };
  all.forEach(x => counts[x.kind]++);
  if (!counts[histFilter]) histFilter = 'all';      // filtered everything away
  // All five are always shown, including the ones you have nothing in - hiding
  // a discipline at zero makes the filter itself look like it is not there.
  // Those are disabled rather than absent, so the row is a full contents list.
  const bar = '<div class="segmented histfilter" role="group" aria-label="Show which sessions">' +
    HIST_KINDS.map(k =>
      '<button class="seg' + (histFilter === k.k ? ' active' : '') +
      (counts[k.k] ? '' : ' none') + '" data-hfilter="' + k.k + '"' +
      (counts[k.k] ? '' : ' disabled') + ' ' +
      'aria-pressed="' + (histFilter === k.k) + '">' + k.label +
      '<small>' + counts[k.k] + '</small></button>').join('') + '</div>';

  const shown = histFilter === 'all' ? all : all.filter(x => x.kind === histFilter);
  const weeks = {};
  shown.forEach(x => { const w = mondayOf(x.r.date); (weeks[w] = weeks[w] || []).push(x); });
  // Each week opens with what the week weighed in at across all three
  // disciplines, then the sessions that made it up.
  const wStats = weeklyStats(), ergW = ergWeekly(), waterW = waterWeekly(), coreW = coreWeekly();

  el.innerHTML = bar + Object.keys(weeks).sort().reverse().map(w => {
    const items = weeks[w].sort((a, b) => sortKey(b.r).localeCompare(sortKey(a.r)));
    return '<section class="weekgroup"><h4><span class="wg-when">' +
      shortDate(w) + ' - ' + shortDate(addDays(w, 6)) + '</span>' +
      '<span class="wg-count">' + plural(items.length, 'session') + '</span></h4>' +
      weekStripHTML(wStats[w], ergW[w], waterW[w], coreW[w]) +
      items.map(x => x.kind === 'w' ? histWorkoutHTML(x.r)
                   : x.kind === 'c' ? histCoreHTML(x.r)
                   : x.kind === 'wa' ? histWaterHTML(x.r) : histErgHTML(x.r)).join('') +
      '</section>';
  }).join('');
  // The sample banner counts sessions, and this runs after every save.
  paintTrialBar();
}
const kg = n => Math.round(n).toLocaleString('en-GB');

// Reps and volume ignore timed holds and unweighted sets, so a plank or a
// bodyweight press-up can't distort a session's tonnage.
function workoutTotals(s) {
  let sets = 0, reps = 0, volume = 0, weighted = false;
  Object.keys(s.sets).forEach(id => {
    const timeOnly = (exById(id) || {}).unit === 'secs';
    s.sets[id].forEach(r => {
      sets++;
      if (timeOnly) return;
      const rv = parseFloat(r.r), wv = parseFloat(r.w);
      if (!isNaN(rv)) reps += rv;
      if (!isNaN(rv) && !isNaN(wv)) { volume += rv * wv; weighted = true; }
    });
  });
  return { sets, reps, volume, weighted, exercises: Object.keys(s.sets).length };
}

// Collapsed by default: one ruled line per session, full detail on tap.
// delKey must match the table the session lives in - 'w', 'erg' or 'c'.
function entryHTML(s, cls, kindLabel, summary, detail, delKey, editKey) {
  const d = new Date(s.date + 'T12:00:00');
  return '<div class="entry' + (cls ? ' ' + cls : '') + '">' +
    '<button class="entry-toggle" aria-expanded="false">' +
      '<span class="entry-day"><b>' + d.toLocaleDateString('en-GB', { weekday: 'short' }) + '</b>' +
        '<span>' + d.getDate() + ' ' + d.toLocaleDateString('en-GB', { month: 'short' }) + '</span></span>' +
      '<span class="entry-kind">' + kindLabel + '</span>' +
      '<span class="entry-main"><span class="entry-sum">' + summary + '</span>' +
        (s.at ? '<span class="entry-time">' + esc(s.at) + '</span>' : '') + '</span>' +
      '<span class="chev" aria-hidden="true">›</span>' +
    '</button>' +
    '<div class="entry-detail" hidden>' + detail +
      '<div class="entry-ops">' +
        (editKey ? '<button class="del" data-' + editKey + '="' + s.id + '">Edit this session</button>' : '') +
        '<button class="del" data-del-' + delKey + '="' + s.id + '">Delete this session</button>' +
      '</div>' +
    '</div></div>';
}

function histWorkoutHTML(s) {
  const ids = Object.keys(s.sets).sort((a, b) => patIdx(patternOf(a)) - patIdx(patternOf(b)));
  const t = workoutTotals(s);
  const summary = t.exercises + ' exercise' + (t.exercises === 1 ? '' : 's') + ' · ' +
    t.sets + ' set' + (t.sets === 1 ? '' : 's') +
    (t.reps ? ' · ' + round1(t.reps) + ' reps' : '');

  const detail = ids.map(id => {
    const m = exById(id) || {};
    const timeOnly = m.unit === 'secs';
    const rows = s.sets[id];
    let vol = 0, reps = 0, hasW = false;
    rows.forEach(r => {
      const rv = parseFloat(r.r), wv = parseFloat(r.w);
      if (!isNaN(rv)) reps += rv;
      if (!isNaN(rv) && !isNaN(wv)) { vol += rv * wv; hasW = true; }
    });
    return '<div class="dex"><div class="dex-head">' +
      '<span class="dex-name">' + esc(exName(id)) + (m.retired ? ' <span class="dex-tag">retired</span>' : '') + '</span>' +
      '<span class="dex-stats">' + rows.length + (timeOnly ? ' hold' : ' set') + (rows.length === 1 ? '' : 's') +
        (timeOnly ? '' : ' · ' + round1(reps) + ' reps' + (hasW ? ' · ' + kg(vol) + ' kg' : '')) +
      '</span></div>' +
      rows.map((r, i) => '<div class="dset"><span class="dset-no">' + (i + 1) + '</span><span>' +
        (timeOnly
          ? esc(r.r) + ' sec'
          : esc(r.r) + (m.per_side ? ' reps each side' : ' reps') +
            (r.w !== '' && r.w != null
              ? (m.bodyweight ? ' + ' : ' × ') + esc(r.w) + ' kg'
              : (m.bodyweight ? ' (bodyweight)' : ''))) +
        '</span></div>').join('') + '</div>';
  }).join('') + (s.notes ? '<div class="dnote">' + esc(s.notes) + '</div>' : '');

  return entryHTML(s, '', 'weights', summary, detail, 'w', 'edit-w');
}

function histWaterHTML(s) {
  const sp = waterSplit(s);
  const facts = [
    s.distance_m != null ? ['Distance', s.distance_m.toLocaleString('en-GB') + ' m'] : null,
    s.total_time_s != null ? ['Time', fmtDur(s.total_time_s)] : null,
    sp != null ? ['Average split', fmtSplit(sp)] : null,
  ].filter(Boolean);
  const detail = '<dl class="dfacts">' +
    facts.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl>' +
    (s.notes ? '<div class="dnote">' + esc(s.notes) + '</div>' : '');
  return entryHTML(s, 'water', 'water', waterSummaryLine(s), detail, 'wa');
}

function histErgHTML(s) {
  const src = { photo: 'Read from a monitor photo', manual: 'Entered by hand', 'c2-logbook': 'Concept2 Logbook' };
  const facts = [
    s.session_type ? ['Session', esc(s.session_type)] : null,
    s.erg_type ? ['Machine', s.erg_type === 'concept2' ? 'Concept2' : 'RowPerfect'] : null,
    s.total_time_s != null ? ['Total time', fmtTime(s.total_time_s)] : null,
    s.distance_m != null ? ['Distance', s.distance_m.toLocaleString('en-GB') + ' m'] : null,
    s.avg_split_s != null ? ['Average split', fmtSplit(s.avg_split_s)] : null,
    s.avg_rate != null ? ['Average rate', s.avg_rate + ' spm'] : null,
    s.avg_hr != null ? ['Average HR', s.avg_hr + ' bpm'] : null,
    ['Logged', src[s.source] || esc(s.source)],
  ].filter(Boolean);

  const iv = s.intervals || [];
  const cell = v => v == null ? '<span class="na">–</span>' : v;
  const table = iv.length
    ? '<div class="dsub">Breakdown</div><div class="dtbl-wrap"><table class="dtbl">' +
      '<thead><tr><th>#</th><th>Time</th><th>Dist</th><th>/500m</th><th>Rate</th><th>HR</th></tr></thead><tbody>' +
      iv.map((r, i) => '<tr><td>' + (i + 1) + '</td>' +
        '<td>' + cell(r.time_s != null ? fmtTime(r.time_s) : null) + '</td>' +
        '<td>' + cell(r.distance_m != null ? r.distance_m + ' m' : null) + '</td>' +
        '<td>' + cell(r.split_s != null ? fmtTime(r.split_s) : null) + '</td>' +
        '<td>' + cell(r.rate) + '</td><td>' + cell(r.hr) + '</td></tr>').join('') +
      '</tbody></table></div>'
    : '<div class="dnote">No interval breakdown recorded for this piece.</div>';

  const detail = '<dl class="dfacts">' +
    facts.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl>' +
    table + (s.notes ? '<div class="dnote">' + esc(s.notes) + '</div>' : '');

  return entryHTML(s, 'erg', 'erg', ergSummaryLine(s) || 'Erg session', detail, 'erg');
}

/* ================= library ================= */
let editingExId = null;

function renderLibrary() {
  const lib = activeLibrary();
  $('session_group-list').innerHTML = allGroups(lib).map(g => '<option value="' + esc(g) + '">').join('');

  const el = $('lib-list');
  if (!lib.length) {
    el.innerHTML = '<p class="placeholder">Your library is empty. Add your exercises above - name, which session they belong to, and the movement type - or upload a template below. The Weights tab builds itself from this list.</p>';
    return;
  }
  const groupings = allGroups(lib);
  el.innerHTML = groupings.map(g =>
    '<div class="picker-session">' + esc(g) + '</div>' +
    lib.filter(e => groupsOf(e).includes(g))
      .sort((a, b) => patIdx(a.pattern) - patIdx(b.pattern) || a.position - b.position)
      .map(e =>
        '<div class="lib-item"><div><div class="nm">' + esc(e.name) + '</div>' +
        '<div class="meta">' + esc(e.pattern) + (e.unit === 'secs' ? ' · secs' : '') +
        (e.per_side ? ' · each side' : '') + (e.bodyweight ? ' · BW' : '') +
        // it's the same exercise, listed here and elsewhere - say so, or the
        // repeat looks like an accidental duplicate
        (groupsOf(e).length > 1
          ? ' · also in ' + esc(groupsOf(e).filter(x => x !== g).join(', ')) : '') +
        (e.note ? ' · ' + esc(e.note) : '') + '</div></div>' +
        '<div class="ops"><button class="ghost" data-edit="' + e.id + '" title="Edit" style="font-size:13px">✎</button>' +
        '<button class="ghost" data-del-ex="' + e.id + '" title="Delete">×</button></div></div>'
      ).join('')
  ).join('');
}

function fillLibForm(e) {
  $('lx-name').value = e ? e.name : '';
  $('lx-session_group').value = e ? groupsOf(e).join(', ') : ($('lx-session_group').value || '');
  $('lx-pattern').value = e ? e.pattern : 'squat';
  $('lx-unit').value = e ? e.unit : 'reps';
  $('lx-note').value = e ? (e.note || '') : '';
  $('lx-perside').checked = e ? !!e.per_side : false;
  $('lx-bw').checked = e ? !!e.bodyweight : false;
  editingExId = e ? e.id : null;
  $('lib-form-title').textContent = e ? 'Edit: ' + e.name : 'Add an exercise';
  $('lx-save').textContent = e ? 'Save changes' : 'Add exercise';
  $('lx-cancel').style.display = e ? '' : 'none';
}

async function saveLibExercise() {
  const snap = snapshotLog();
  const name = $('lx-name').value.trim();
  const session_groups = parseGroups($('lx-session_group').value);
  if (!name) { toast('lib-msg', 'Give it a name.', 'warn'); return; }
  const row = {
    name, session_groups,
    pattern: $('lx-pattern').value,
    unit: $('lx-unit').value,
    per_side: $('lx-perside').checked,
    bodyweight: $('lx-bw').checked,
    note: $('lx-note').value.trim() || null,
  };
  let error;
  if (editingExId) {
    ({ error } = await sb.from('tracker_exercises').update(row).eq('id', editingExId));
    if (!error) Object.assign(exById(editingExId), row);
  } else {
    // One name = one exercise now. To put an existing lift in another session,
    // edit it and add the group, rather than creating a second row that would
    // split its history.
    const dup = activeLibrary().find(e => e.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      toast('lib-msg', esc(name) + ' is already in your library (' + esc(groupsOf(dup).join(', ')) +
        '). Edit it to add another session rather than adding it twice.', 'warn');
      return;
    }
    row.profile_id = S.session.user.id;
    row.position = Math.max(0, ...S.exercises.map(e => e.position)) + 1;
    const res = await sb.from('tracker_exercises').insert(row).select().single();
    error = res.error;
    if (!error) S.exercises.push(res.data);
  }
  if (error) { toast('lib-msg', 'Save failed: ' + esc(error.message), 'err'); return; }
  toast('lib-msg', editingExId ? 'Updated.' : 'Added ' + esc(name) + '.');
  fillLibForm(null);
  renderLibrary(); renderLog(snap);
}

async function deleteLibExercise(id) {
  const snap = snapshotLog();
  const used = S.workouts.some(w => w.sets[id] && w.sets[id].length);
  let error;
  if (used) {
    ({ error } = await sb.from('tracker_exercises').update({ retired: true }).eq('id', id));
    if (!error) exById(id).retired = true;
  } else {
    ({ error } = await sb.from('tracker_exercises').delete().eq('id', id));
    if (!error) S.exercises = S.exercises.filter(e => e.id !== id);
  }
  if (error) { toast('lib-msg', 'Delete failed: ' + esc(error.message), 'err'); return; }
  toast('lib-msg', used ? 'Removed from your picker (kept in old sessions).' : 'Deleted.');
  renderLibrary(); renderLog(snap);
}

/* ---- templates ---- */
function downloadTemplate() {
  const lib = activeLibrary().map(e => ({
    name: e.name, session_groups: groupsOf(e), pattern: e.pattern, unit: e.unit,
    per_side: e.per_side, bodyweight: e.bodyweight, note: e.note, position: e.position,
  }));
  const payload = { app: 'rowingtools-tracker', kind: 'exercise-template', version: 1, exported: todayISO(), exercises: lib };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rowingtools-template-' + todayISO() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  track('template_downloaded', { exercises: lib.length });
}

async function uploadTemplate(file) {
  let payload;
  // A file the user picked can be anything at all; bad JSON is an expected
  // outcome here, not a bug.
  try { payload = JSON.parse(await file.text()); }
  catch (e) { if (!(e instanceof SyntaxError)) throw e;
              toast('lib-msg', 'That file is not valid JSON.', 'err'); return; }
  await importExercises(payload, 'lib-msg');
}

// Shared by the file upload and the squad import. Additive only: anything you
// already have by name is skipped, so importing can never overwrite your setup.
// Returns how many were added.
async function importExercises(payload, msgId) {
  const snap = snapshotLog();
  if (!payload || payload.kind !== 'exercise-template' || !Array.isArray(payload.exercises)) {
    toast(msgId, 'That does not look like a RowingTools template.', 'err'); return 0;
  }
  const existing = new Set(activeLibrary().map(e => e.name.trim().toLowerCase()));
  const posBase = Math.max(0, ...S.exercises.map(e => e.position)) + 1;
  const fresh = payload.exercises
    .filter(e => e && typeof e.name === 'string' && e.name.trim())
    .filter(e => !existing.has(e.name.trim().toLowerCase()))
    .map((e, i) => ({
      profile_id: S.session.user.id,
      name: e.name.trim().slice(0, 80),
      // accepts both shapes so an older exported template still imports
      session_groups: parseGroups(
        Array.isArray(e.session_groups) ? e.session_groups.join(',') : (e.session_groups || e.session_group)),
      pattern: PATTERN_ORDER.includes(e.pattern) ? e.pattern : 'other',
      unit: e.unit === 'secs' ? 'secs' : 'reps',
      per_side: !!e.per_side,
      bodyweight: !!e.bodyweight,
      note: typeof e.note === 'string' ? e.note.slice(0, 200) : null,
      position: posBase + i,
    }));
  if (!fresh.length) {
    toast(msgId, 'Nothing new in there - everything is already in your library.', 'warn'); return 0;
  }
  const { data, error } = await sb.from('tracker_exercises').insert(fresh).select();
  if (error) { toast(msgId, 'Import failed: ' + esc(error.message), 'err'); return 0; }
  S.exercises.push(...data);
  toast(msgId, 'Imported ' + data.length + ' exercise' + (data.length > 1 ? 's' : '') + '.');
  track('template_uploaded', { exercises: data.length });
  renderLibrary(); renderLog(snap);
  return data.length;
}

/* ================= races =================
   Everything else in this app is training you typed in. This tab is the one
   place it meets a public result: the regatta leaderboards already published on
   rowingtools.co.uk, which carry a GMT percentage for every crew.

   A crew result is not a person, and no results file anywhere names who was in
   the boat - so there is nothing to match on and nothing is guessed. You find
   your race and claim it. That also means a claim is a statement about
   yourself, never a fact about someone else's crew.

   The leaderboard file is ~800KB, so it is fetched the first time this tab is
   opened and not before, and kept in sessionStorage for the rest of the visit -
   the same treatment the clubs pages give it. conditions.js (the weather card)
   is injected the same way, on the same trigger. */
// The same wind mark the clubs pages put on their conditions button, inlined
// so it inherits the button's colour. A full-colour cloud emoji in a results
// row reads as a sticker on a page that is otherwise one red on near-black.
const WIND_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9.59 4.59A2 2 0 1 1 11 8H2"/><path d="M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2"/>' +
  '<path d="M12.59 19.41A2 2 0 1 0 14 16H2"/></svg>';

const RACE_DATA_URL = '/data/all_results.json';
const RACE_ALIAS_URL = '/data/club_aliases.json';

const RC = {
  loaded: false, loading: false, error: null,
  comps: [],        // [{comp,title,date,url,year,venue,results:[...]}]
  aliases: {},
  year: 'all', comp: 'all', q: '',
  sort: 'date',     // how MY races are ordered inside each year: 'date' | 'gmt'
  limit: 30,        // how many search hits to draw; "show more" raises it
  picked: null,     // id of the race whose detail panel is open under the chart
  busy: null,       // race_key currently being written
};

// Same normalisation the clubs pages use, so "Lea RC (A)" and "Lea" are one
// club here too. Deliberately in step with clubs/index.html - if that changes,
// this has to change with it or a search will quietly miss results.
const raceNormClub = n => (n || '').replace(/`/g, "'").replace(/\s*\/\s*/g, '/')
  .replace(/\s*\([A-Za-z]\)\s*$/, '').trim();
const raceCanonDisp = n => raceNormClub(n)
  .replace(/\bUniv\b/g, 'University').replace(/\bColl\b/g, 'College').replace(/\bSch\b/g, 'School')
  .replace(/\s+(Rowing Club|Boat Club|RC|BC|ARC)\s*$/i, '').trim();
function raceResolve(n) {
  const disp = raceCanonDisp(n), key = disp.toLowerCase();
  if (RC.aliases[key]) { const d = RC.aliases[key]; return { disp: d, key: raceCanonDisp(d).toLowerCase() }; }
  return { disp, key };
}

// The identity of a result inside the file. Not a database id - the file is
// re-cut when regattas are added - so it is built from the five fields that
// together pick out one crew in one race.
const raceKey = (comp, r) => [comp, r.event, r.round, r.crew, r.time].join('|');
const raceYearOf = comp => '20' + comp.slice(-2);

// "British Rowing Club Championships 2026" is the full title; the year is
// already the heading and the rest is a mouthful on a phone.
const compShort = (title, comp) => (title || comp || '').replace(/\s+20\d\d\b/, '').trim();

// The regatta's HEATMAP, with this crew's cell ringed. Not the results table:
// the question a result provokes is "who else was in that race and how did the
// lanes go", and the heatmap is the view that answers it - it is the default
// tab on those pages, so landing there costs nothing.
//
// leaderboards/deeplink.js reads these four and does the highlighting. `hlclub`
// rather than `club` on purpose: rowingtools-share.js already claims ?club= and
// uses it to jump to the Result Leaderboard, which is the view being avoided.
//
// New tab, because this is a reference, and losing a half-finished search to a
// back button is a poor trade.
function compHref(r, comp, club) {
  const base = (r && r.comp_url) || (comp ? '/leaderboards/' + comp + '/' : '');
  if (!base) return '';
  const q = [];
  if (r && r.event) q.push('ev=' + encodeURIComponent(r.event));
  if (r && r.round) q.push('rd=' + encodeURIComponent(r.round));
  if (r && r.crew)  q.push('crew=' + encodeURIComponent(r.crew));
  if (club)         q.push('hlclub=' + encodeURIComponent(club));
  return base + (q.length ? '?' + q.join('&') : '');
}

function sessionCache(key, fetcher) {
  try {
    const hit = sessionStorage.getItem(key);
    if (hit) return Promise.resolve(JSON.parse(hit));
  } catch (e) { if (e.name !== 'SyntaxError') throw e; }
  return fetcher().then(d => {
    // Best-effort: a full session quota must not fail the load.
    try { sessionStorage.setItem(key, JSON.stringify(d)); }
    catch (e) { if (e.name !== 'QuotaExceededError' && e.name !== 'NS_ERROR_DOM_QUOTA_REACHED') throw e; }
    return d;
  });
}

// conditions.js injects its own CSS and modal and then defines window.wxOpen.
// Injected once, on demand, so a tracker that never opens this tab never pays
// for it.
let wxLoading = null;
function ensureConditions() {
  if (window.wxOpen) return Promise.resolve(true);
  if (wxLoading) return wxLoading;
  wxLoading = new Promise(resolve => {
    const el = document.createElement('script');
    el.src = '/conditions.js';
    el.onload = () => resolve(!!window.wxOpen);
    el.onerror = () => resolve(false);
    document.head.appendChild(el);
  });
  return wxLoading;
}

async function loadRaceData() {
  if (RC.loaded || RC.loading) return;
  RC.loading = true; RC.error = null; renderRaces();
  ensureConditions();
  let data = null, aliases = {};
  try {
    data = await sessionCache('rt:' + RACE_DATA_URL, () => fetch(RACE_DATA_URL).then(r => {
      if (!r.ok) throw new Error('the results file returned ' + r.status);
      return r.json();
    }));
    // Aliases are a nicety - without them a few clubs search under two names -
    // so a failure there must not stop the tab loading.
    aliases = await sessionCache('rt:' + RACE_ALIAS_URL,
      () => fetch(RACE_ALIAS_URL).then(r => r.json())).catch(() => ({}));
  } catch (e) {
    if (!(e instanceof TypeError) && !(e instanceof SyntaxError) && !(e instanceof Error)) throw e;
    RC.loading = false;
    RC.error = 'Could not load the regatta results (' + e.message + ').';
    renderRaces();
    return;
  }
  RC.loading = false;
  RC.aliases = aliases || {};
  RC.comps = (data || []).map(c => ({
    comp: c.comp, title: c.title, date: c.date, url: c.url,
    venue: c.venue, year: raceYearOf(c.comp), results: c.results || [],
  })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  RC.loaded = true;
  renderRaces();
  backfillPlaces();
}

/* ---- where you came in your own race ----
   A GMT percentage says how the crew went against the world best. It does not
   say how the race went: 84% into a headwind at Nottingham can be a win, and
   88% in a flat final can be last. The field is right there in the same file -
   every crew in the same comp, event and round is that race - so the placing
   and the size of the field are a lookup, not a guess.

   Rounds matter and are used: "Final B" is its own race, and calling someone
   3rd when they were 3rd of the B final would be a lie by omission. */
function raceField(comp, r) {
  const same = comp.results.filter(x => x.event === r.event && x.round === r.round);
  const timed = same.map(x => ({ x, s: parseTimeStr(x.time) })).filter(t => t.s != null);
  if (!timed.length) return null;
  timed.sort((a, b) => a.s - b.s);
  const i = timed.findIndex(t => t.x === r);
  return { place: i < 0 ? null : i + 1, field: same.length };
}

const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th'
  : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th');

// Just the placing. The gap to the winner was here for a day and cut: on a
// multi-lane course the placing is the fact, and "+12.40" beside a 4th of 5
// says the same thing twice in a way that reads as a reproach.
const placeLine = r => (r.place && r.field) ? ord(r.place) + ' of ' + r.field : '';

/* Races claimed before this existed have no place, and neither does one
   claimed offline. Both are filled in the next time the tab has the file, in
   one pass, quietly - it is derived data, so there is nothing to tell the
   athlete about and nothing to undo. */
async function backfillPlaces() {
  const gaps = S.races.filter(r => r.place == null && r.comp);
  if (!gaps.length) return;
  let done = 0;
  for (const race of gaps) {
    const comp = RC.comps.find(c => c.comp === race.comp);
    if (!comp) continue;
    const hit = comp.results.find(x => raceKey(comp.comp, x) === race.race_key);
    if (!hit) continue;
    const f = raceField(comp, hit);
    if (!f || !f.place) continue;
    Object.assign(race, f);
    done++;
    const { error } = await sb.from('tracker_races')
      .update({ place: f.place, field: f.field }).eq('id', race.id);
    // Offline is fine: the values are in memory for this visit and the next
    // load will try again. Anything else is a real error and should surface.
    if (error && !looksOffline(error)) {
      toast('race-msg', 'Could not save the race positions: ' + esc(error.message), 'err');
      break;
    }
  }
  if (done) { cacheData(); renderRaces(); }
}

const myRaceKeys = () => new Set(S.races.map(r => r.race_key));

/* ---- claiming ---- */
async function claimRace(compId, idx) {
  const comp = RC.comps.find(c => c.comp === compId);
  const r = comp && comp.results[idx];
  if (!r) return;
  const key = raceKey(comp.comp, r);
  if (myRaceKeys().has(key)) return;
  RC.busy = key; renderRaces();
  const row = {
    id: newId(),
    profile_id: S.session.user.id,
    race_key: key,
    comp: comp.comp, comp_title: comp.title, comp_url: comp.url || null,
    date: r.date || comp.date,
    club: r.club || null, crew: r.crew || null, event: r.event || null,
    round: r.round || null, boat: r.boat || null, time: r.time || null,
    clock: r.clock || null, pct: r.pct == null ? null : r.pct,
    venue: comp.venue || null,
  };
  Object.assign(row, raceField(comp, r) || { place: null, field: null });
  const { error } = await insertRow('tracker_races', row);
  const queued = error && looksOffline(error);
  RC.busy = null;
  if (error && !queued) {
    toast('race-msg', 'Could not add it: ' + esc(error.message), 'err');
    renderRaces();
    return;
  }
  if (queued) queueWrite('tracker_races', row);
  S.races.push(row); sortDesc(S.races);
  track('race_claimed', { comp: comp.comp, queued: !!queued });
  cacheData(); renderRaces();
  toast('race-msg',
    (queued ? 'Added on this device - it will sync when you are back online. ' : 'Added - ') +
    esc(r.event || 'race') + ' at ' + esc(comp.title) + '.', queued ? 'warn' : '');
}

async function unclaimRace(id) {
  if (!S.races.some(r => r.id === id)) return;
  const { error } = await sb.from('tracker_races').delete().eq('id', id);
  if (error) { toast('race-msg', 'Could not remove it: ' + esc(error.message), 'err'); return; }
  S.races = S.races.filter(r => r.id !== id);
  track('race_unclaimed', {});
  cacheData(); renderRaces();
}

/* Tapping a dot used to jump straight to the weather card, which answered a
   question nobody had asked yet: the first thing you want off a dot is which
   race it was. So a tap opens a panel under the chart with the race in full,
   and the two things you might then want - the conditions, and the regatta's
   heatmap - are buttons on it. */
function raceDetailHTML() {
  const r = S.races.find(x => x.id === RC.picked);
  if (!r) return '';
  const bits = [
    r.time ? '<span><i>Time</i>' + esc(r.time) + '</span>' : '',
    r.pct != null ? '<span><i>GMT</i>' + pctHTML(Number(r.pct)) + '</span>' : '',
    placeLine(r) ? '<span><i>Placing</i>' + esc(placeLine(r)) + '</span>' : '',
    r.crew ? '<span><i>Crew</i>' + esc(r.crew) + '</span>' : '',
  ].filter(Boolean).join('');
  return '<div class="rdet">' +
    '<div class="rdet-head"><div><b>' + esc(r.event || r.boat || 'Race') + '</b>' +
      (r.round ? ' <span class="rr-round">' + esc(r.round) + '</span>' : '') +
      '<small>' + esc(prettyDate(r.date)) + ' \u00b7 ' +
      esc(compShort(r.comp_title, r.comp)) + '</small></div>' +
      '<button class="ghostx" data-race-close aria-label="Close">\u00d7</button></div>' +
    '<div class="rdet-grid">' + bits + '</div>' +
    '<div class="rdet-acts">' +
      (r.venue && r.clock
        ? '<button class="wxbtn" data-race-wx="' + r.id + '">' + WIND_SVG +
          '<span>Conditions</span></button>' : '') +
      '<a class="ghost rdet-lb" href="' + esc(compHref(r, r.comp, r.club)) +
        '" target="_blank" rel="noopener">Heatmap for this race \u2197</a>' +
    '</div></div>';
}

function openRaceConditions(id) {
  const r = S.races.find(x => x.id === id);
  if (!r || !r.venue || !r.clock) return;
  ensureConditions().then(ok => {
    if (!ok) { toast('race-msg', 'The conditions card could not be loaded.', 'warn'); return; }
    window.wxOpen(r.clock, [r.crew, r.event].filter(Boolean).join(' \u00b7 '), r.boat, r.date, r.venue);
  });
}

/* ---- the year summary ----
   Top three rather than the clubs pages' top ten: a club enters a hundred crews
   a season and a person races a handful, so ten would be "all of them, including
   the one you sculled in a gale". Three is enough to mean a good season rather
   than one good day, and small enough that a first season has it. */
const TOP_N = 3;
function raceYearStats(rows) {
  const pcts = rows.map(r => Number(r.pct)).filter(v => v > 0).sort((a, b) => b - a);
  const n = Math.min(TOP_N, pcts.length);
  return {
    races: rows.length,
    regattas: new Set(rows.map(r => r.comp)).size,
    top: n ? pcts.slice(0, n).reduce((a, b) => a + b, 0) / n : null,
    topN: n,
    best: pcts.length ? pcts[0] : null,
    bestRow: rows.slice().sort((a, b) => Number(b.pct || 0) - Number(a.pct || 0))[0] || null,
  };
}

// The same four bands the leaderboards and club pages use, so a number means
// the same thing wherever it is read.
const pctClass = p => p >= 87 ? 'gmt-a' : p >= 80 ? 'gmt-b' : p >= 72 ? 'gmt-c' : 'gmt-d';
const pctHTML = p => p == null ? '<span class="na">-</span>'
  : '<span class="gmt ' + pctClass(p) + '">' + round1(p) + '%</span>';

/* ---- every race you have ever claimed, in order ----
   Deliberately NOT the weekly-bar treatment the training charts get. Racing is
   not a volume you accumulate: it is a handful of separate afternoons, weeks
   apart, and drawing them as adjacent bars would invent a rhythm that is not
   there. One dot per race on a real time axis, so a season looks like a season
   and the winter gap looks like a gap.

   The y-axis stays: these are absolute percentages that mean the same thing
   across every athlete and every year, which is exactly the case the weekly
   charts do not have. */

// What a dot is called. NOT the event code: "W Ch Lwt 4x" carries a class and a
// tier that mean nothing once you already know it is your own race. The boat
// and the regatta are the two things that tell you which afternoon this was.
const raceDotLab = r => [r.boat || r.event, compTiny(r.comp_title, r.comp)]
  .filter(Boolean).join(' \u00b7 ');

// A regatta name short enough to sit under a dot. Drop the word Regatta; if
// what is left is still long, take the initials, which is what these are
// called out loud anyway - British Rowing Club Championships is BRCC and
// National Schools' Regatta is NSR.
function compTiny(title, comp) {
  const base = compShort(title, comp);
  const trimmed = base.replace(/\s*\bRegatta\b\s*/, ' ')
    // A two-day regatta is "Met - Saturday", and the day is the half that
    // tells the two apart, so it is shortened rather than initialised away:
    // initials would turn Met Regatta - Saturday into MRS, which is nothing.
    .replace(/\b(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/, '$1')
    .replace(/\bTues\b/, 'Tue').replace(/\bWednes\b/, 'Wed')
    .replace(/\bThurs\b/, 'Thu').replace(/\bSatur\b/, 'Sat')
    .replace(/\s+/g, ' ').trim();
  if (trimmed.length <= 14) return trimmed;
  const initials = base.split(/[\s-]+/).filter(w => /^[A-Z]/.test(w)).map(w => w[0]).join('');
  return initials.length >= 2 ? initials : trimmed.slice(0, 13) + '\u2026';
}

function raceChartHTML(W) {
  const rows = S.races.filter(r => r.pct != null && r.date).slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (rows.length < 2) return '';

  // Room above and below the dots for their labels, and for the season row.
  const H = 250, P = { t: 34, r: 14, b: 44, l: 38 };
  const iw = Math.max(60, W - P.l - P.r), ih = H - P.t - P.b;
  const ts = rows.map(r => Date.parse(r.date));
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  const pad = Math.max((t1 - t0) * 0.04, 864e5 * 3);   // never zero-width
  const X = t => P.l + ((t - (t0 - pad)) / ((t1 + pad) - (t0 - pad))) * iw;

  const ps = rows.map(r => Number(r.pct));
  const lo = Math.floor(Math.min(...ps) - 1), hi = Math.ceil(Math.max(...ps) + 1);
  const span = Math.max(1, hi - lo);
  const Y = v => P.t + ih - ((v - lo) / span) * ih;

  const step = span <= 4 ? 1 : span <= 10 ? 2 : span <= 25 ? 5 : 10;
  let grid = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    grid += '<line class="rcgrid" x1="' + P.l + '" y1="' + Y(v).toFixed(1) +
      '" x2="' + (P.l + iw) + '" y2="' + Y(v).toFixed(1) + '"/>' +
      '<text class="rcax" x="' + (P.l - 7) + '" y="' + (Y(v) + 3.5).toFixed(1) +
      '" text-anchor="end">' + v + '</text>';
  }

  // A rule at each new season, labelled - the one bit of structure a rower
  // reads this chart by.
  let seasons = '';
  const seen = new Set();
  rows.forEach((r, i) => {
    const y = (r.date || '').slice(0, 4);
    if (seen.has(y)) return;
    seen.add(y);
    const x = i === 0 ? P.l : X(Date.parse(y + '-01-01'));
    const cx = Math.max(P.l, Math.min(P.l + iw, x));
    seasons += (i === 0 ? '' : '<line class="rcyear" x1="' + cx.toFixed(1) + '" y1="' + P.t +
      '" x2="' + cx.toFixed(1) + '" y2="' + (P.t + ih) + '"/>') +
      '<text class="rcyearlab" x="' + (cx + 5).toFixed(1) + '" y="14">' + y + '</text>';
  });

  /* Labels on the chart itself rather than only in a tooltip: a scatter you
     have to hover to read is no use on a phone, and hovering was the whole
     complaint. They are placed greedily - above the dot first, then below -
     and a label that would collide in both bands is dropped rather than
     overlapped. The chip still has everything for the ones that get dropped. */
  const CH = 5.4;                                   // mono 9.5px, per character
  const placed = [];                                // {x0,x1,y} of labels already drawn
  const pts = rows.map((r, i) => ({ x: X(ts[i]), y: Y(Number(r.pct)) }));
  let labels = '';
  rows.forEach((r, i) => {
    const text = raceDotLab(r);
    if (!text) return;
    const w = text.length * CH + 8;
    // Nudge the label in at the edges so it cannot run out of the chart.
    const x = Math.max(P.l + w / 2 + 2, Math.min(P.l + iw - w / 2 - 2, pts[i].x));
    const x0 = x - w / 2, x1 = x + w / 2;
    // Above the dot first, then below. A label must clear the other LABELS and
    // the other DOTS - the first version only checked labels, so a neighbouring
    // dot sat in the middle of the text.
    // Inside the plot only: a label that drops below the baseline lands on the
    // axis numbers, and one above the top rides over the season row.
    const y = [pts[i].y - 13, pts[i].y + 20].find(cand =>
      cand >= P.t + 9 && cand <= P.t + ih - 4 &&
      placed.every(o => x1 < o.x0 || x0 > o.x1 || Math.abs(cand - o.y) > 11) &&
      pts.every((p, j) => j === i || Math.abs(p.x - x) > w / 2 + 9 || Math.abs(p.y - cand) > 12));
    if (y == null) return;                          // no room: the chip still has it
    placed.push({ x0: x0, x1: x1, y: y });
    labels += '<text class="rcdotlab" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
      '" text-anchor="middle">' + esc(text) + '</text>';
  });

  const dots = rows.map((r, i) => {
    const v = Number(r.pct);
    const cx = X(ts[i]).toFixed(1), cy = Y(v).toFixed(1);
    // Two circles: a much larger transparent one you can actually hit with a
    // thumb - 7px of dot is not a tap target - and then the dot you see. The
    // hit circle comes FIRST so the CSS can light its own dot with `+`; with
    // the dot first, the adjacent-sibling rule lit the next race along.
    return '<circle class="rchit" data-race-dot="' + r.id + '" data-i="' + i +
      '" cx="' + cx + '" cy="' + cy + '" r="17"/>' +
      '<circle class="rcdot ' + pctClass(v) + (RC.picked === r.id ? ' picked' : '') +
      '" cx="' + cx + '" cy="' + cy + '" r="7"/>';
  }).join('');

  // The chip is filled in by wireRaceChart(); the data it needs rides along on
  // the hit circles, so the markup stays a pure function of the rows.
  return '<div class="rchart" id="rchartwrap">' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
    '" role="img" aria-label="Every claimed race by date and GMT percentage">' +
    grid + seasons + labels + dots +
    '<line class="rcbase" x1="' + P.l + '" y1="' + (P.t + ih) + '" x2="' + (P.l + iw) +
      '" y2="' + (P.t + ih) + '"/>' +
    '</svg><div class="ctip" id="rc-tip" style="display:none"></div>' +
    raceDetailHTML() +
    '<p class="rcnote">One dot a race, GMT% up the side. Tap a dot to open it.</p></div>';
}

// Hover or tap fills the chip; the click itself opens the conditions card and
// is handled by the delegated click listener like every other button.
function wireRaceChart() {
  const wrap = $('rchartwrap'), tip = $('rc-tip');
  if (!wrap || !tip) return;
  const show = ev => {
    const hit = ev.target.closest('.rchit');
    if (!hit) return;
    const r = S.races.find(x => x.id === hit.dataset.raceDot);
    if (!r) return;
    const box = wrap.getBoundingClientRect(), c = hit.getBoundingClientRect();
    tip.innerHTML = '<span class="tdate">' + esc(prettyDate(r.date)) + '</span><br>' +
      '<b>' + esc(raceDotLab(r)) + '</b><br>' +
      '<span class="tsub">' + round1(Number(r.pct)) + '% GMT' +
      (r.time ? ' \u00b7 ' + esc(r.time) : '') +
      (placeLine(r) ? ' \u00b7 ' + esc(placeLine(r)) : '') + '</span>';
    tip.style.display = '';
    tip.style.left = Math.min(box.width - 8, Math.max(8, c.left - box.left + c.width / 2)) + 'px';
    tip.style.top = (c.top - box.top + c.height / 2 - 12) + 'px';
  };
  wrap.addEventListener('pointermove', show);
  wrap.addEventListener('pointerdown', show);
  wrap.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
}

/* ---- the season card ----
   Same recipe as rowingtools-share.js on the leaderboards - an SVG drawn to a
   canvas at 2x and handed over as a PNG - rather than a call into it: those
   two functions read the page title and a button's dataset, neither of which
   exists here. What is shared is the same shape, so a card from the tracker
   and a card from a leaderboard look like they came from the same place. */
function shareSeason(year) {
  const rows = S.races.filter(r => (r.date || '').slice(0, 4) === year);
  if (!rows.length) return;
  const st = raceYearStats(rows);
  const name = (S.profile && S.profile.display_name) || 'My season';
  const col = st.top >= 87 ? '#34d399' : st.top >= 80 ? '#60a5fa' : st.top >= 72 ? '#fb923c' : '#f87171';
  const best = st.bestRow || {};
  const F = "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif";
  const W = 600, H = 300;
  const t = (x, y, size, weight, fill, str, anchor) =>
    '<text x="' + x + '" y="' + y + '" font-family="' + F + '" font-size="' + size +
    '" font-weight="' + weight + '" fill="' + fill + '"' +
    (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + esc(str) + '</text>';

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">' +
    '<rect width="' + W + '" height="' + H + '" fill="#0f0f0e"/>' +
    '<rect width="' + W + '" height="4" fill="#c8472b"/>' +
    t(24, 36, 13, 700, '#c8472b', 'rowingtools.co.uk') +
    t(W - 24, 36, 12, 400, '#4b5563', year + ' season', 'end') +
    '<line x1="24" y1="50" x2="' + (W - 24) + '" y2="50" stroke="#1c1c1c" stroke-width="1"/>' +
    t(24, 102, 28, 700, '#f0f0ee', name.length > 30 ? name.slice(0, 29) + '\u2026' : name) +
    t(24, 124, 13, 400, '#4b5563',
      plural(st.races, 'race') + ' \u00b7 ' + plural(st.regattas, 'regatta')) +
    t(24, 176, 14, 400, '#9ca3af', 'Top ' + st.topN + ' avg GMT%') +
    t(W - 24, 196, 64, 800, col, round1(st.top) + '%', 'end') +
    t(24, 212, 13, 400, '#4b5563', 'Best ' + round1(st.best) + '% \u00b7 ' +
      (best.event || '') + (best.comp_title ? ' \u00b7 ' + compShort(best.comp_title, best.comp) : '')) +
    '<line x1="24" y1="244" x2="' + (W - 24) + '" y2="244" stroke="#1c1c1c" stroke-width="1"/>' +
    t(24, 270, 12, 400, '#4b5563', 'GMT% = World Best Time \u00f7 your time \u00d7 100') +
    '</svg>';

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = W * 2; c.height = H * 2;
    const ctx = c.getContext('2d');
    ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
    c.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'season-' + year + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
    URL.revokeObjectURL(url);
    track('race_season_shared', { year: year, races: rows.length });
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('race-msg', 'Could not draw the card.', 'warn'); };
  img.src = url;
}

function myRacesHTML() {
  if (!S.races.length) {
    return '<p class="placeholder">No races yet. Find one below and press <b>+</b> to put it in ' +
      'your history. Everything on the RowingTools leaderboards is here, every regatta with a ' +
      'GMT percentage.</p>';
  }
  const el = $('races-body');
  const W = Math.max(280, Math.min(760, (el ? el.clientWidth : 0) || 700));
  const years = {};
  S.races.forEach(r => { const y = (r.date || '').slice(0, 4) || '?'; (years[y] = years[y] || []).push(r); });
  const sortBtns = S.races.length < 2 ? '' :
    '<div class="rsort"><span class="rsort-lab">Order</span>' +
    '<div class="segmented sm" role="group" aria-label="Order races within each year">' +
    [{ k: 'date', label: 'By date' }, { k: 'gmt', label: 'Best first' }].map(o =>
      '<button class="seg' + (RC.sort === o.k ? ' active' : '') + '" data-rsort="' + o.k + '" ' +
      'aria-pressed="' + (RC.sort === o.k) + '">' + o.label + '</button>').join('') + '</div></div>';

  return raceChartHTML(W) + sortBtns + Object.keys(years).sort().reverse().map(y => {
    // Sorting is inside the year, never across them: a season is the unit a
    // rower thinks in, and a list that ran best-to-worst across four years
    // would bury this summer under a good day in 2024.
    const rows = years[y].slice().sort(RC.sort === 'gmt'
      ? (a, b) => Number(b.pct || 0) - Number(a.pct || 0)
      : (a, b) => (b.date || '').localeCompare(a.date || ''));
    const st = raceYearStats(rows);
    return '<section class="ryear">' +
      '<h4><span class="ry-when">' + esc(y) + '</span>' +
        '<span class="ry-count">' + plural(st.races, 'race') +
          '<button class="ghost rshare" data-race-share="' + esc(y) + '" ' +
          'title="Save a card for this season">\u2193 Card</button></span></h4>' +
      '<div class="rystats">' +
        '<div class="rystat"><div class="k">Top ' + st.topN + ' GMT</div><div class="v">' +
          (st.top == null ? '<span class="na">-</span>' : pctHTML(st.top)) + '</div>' +
          '<div class="s">' + (st.topN < TOP_N ? 'your ' + plural(st.topN, 'race') + ' so far'
                                               : 'average of your best ' + TOP_N) + '</div></div>' +
        '<div class="rystat"><div class="k">Best</div><div class="v">' + pctHTML(st.best) + '</div>' +
          '<div class="s">' + (st.bestRow ? esc(st.bestRow.event || '') : '') + '</div></div>' +
        '<div class="rystat"><div class="k">Regattas</div><div class="v">' + st.regattas + '</div>' +
          '<div class="s">' + plural(st.races, 'result') + '</div></div>' +
      '</div>' +
      rows.map(raceRowHTML).join('') +
    '</section>';
  }).join('');
}

function raceRowHTML(r) {
  return '<div class="rrow">' +
    '<div class="rr-when">' + shortDate(r.date) + '</div>' +
    '<a class="rr-what" href="' + esc(compHref(r, r.comp, r.club)) +
      '" target="_blank" rel="noopener"><b>' + esc(r.event || '') + '</b>' +
      (r.round ? ' <span class="rr-round">' + esc(r.round) + '</span>' : '') +
      '<small><span class="mdate">' + shortDate(r.date) + ' \u00b7 </span>' +
      esc([r.crew, placeLine(r), compShort(r.comp_title, r.comp)]
        .filter(Boolean).join(' \u00b7 ')) + '</small></a>' +
    '<div class="rr-time">' + esc(r.time || '') + '</div>' +
    '<div class="rr-pct">' + pctHTML(r.pct == null ? null : Number(r.pct)) + '</div>' +
    '<div class="rr-ops">' +
      (r.venue && r.clock
        ? '<button class="wxbtn" data-race-wx="' + r.id +
          '" title="Weather and wind at race time">' + WIND_SVG +
          '<span>Conditions</span></button>'
        : '') +
      '<button class="ghostx rr-rm" data-race-rm="' + r.id +
        '" title="Remove from my races" aria-label="Remove from my races">\u00d7</button>' +
    '</div></div>';
}

/* ---- the finder ---- */
function raceSearchHTML() {
  if (RC.loading) return '<p class="loading-app">Loading the regatta results\u2026</p>';
  if (RC.error) {
    return '<div class="toast err">' + esc(RC.error) +
      '<br>It is a static file on this site, so this is usually a connection problem. ' +
      '<button class="ghost" id="race-retry">Try again</button></div>';
  }
  if (!RC.loaded) return '';

  const years = [...new Set(RC.comps.map(c => c.year))].sort().reverse();
  const comps = RC.comps.filter(c => RC.year === 'all' || c.year === RC.year);
  if (RC.comp !== 'all' && !comps.some(c => c.comp === RC.comp)) RC.comp = 'all';

  // Two or three years is a button row; fourteen regattas is a select. Same
  // rule as everywhere else in the app.
  const yearBtns = '<div class="segmented sm" role="group" aria-label="Year">' +
    [{ k: 'all', label: 'All years' }].concat(years.map(y => ({ k: y, label: y }))).map(o =>
      '<button class="seg' + (RC.year === o.k ? ' active' : '') + '" data-ryear="' + esc(o.k) + '" ' +
      'aria-pressed="' + (RC.year === o.k) + '">' + esc(o.label) + '</button>').join('') + '</div>';

  const compSel = '<select id="race-comp" aria-label="Regatta">' +
    '<option value="all">Every regatta</option>' +
    comps.map(c => '<option value="' + esc(c.comp) + '"' + (c.comp === RC.comp ? ' selected' : '') +
      '>' + esc(c.title) + '</option>').join('') + '</select>';

  const hits = raceHits();
  const mine = myRaceKeys();
  const shown = hits.slice(0, RC.limit);

  const list = !RC.q.trim() && RC.comp === 'all'
    ? '<p class="placeholder">Type your club to find your races - or pick a regatta above and read ' +
      'the whole results list.</p>'
    : !hits.length
    ? '<p class="placeholder">Nothing matches. Club names come from the results as published, so ' +
      'try a shorter word: <b>Lea</b> rather than <b>Lea Rowing Club</b>.</p>'
    : '<div class="rhits">' + shown.map(h => {
        const key = raceKey(h.comp.comp, h.r);
        const got = mine.has(key);
        return '<div class="rrow find' + (got ? ' got' : '') + '">' +
          '<div class="rr-when">' + shortDate(h.r.date || h.comp.date) + '</div>' +
          '<a class="rr-what" href="' + esc(compHref(
            Object.assign({ comp_url: h.comp.url }, h.r), h.comp.comp, h.r.club)) +
            '" target="_blank" rel="noopener"><b>' + esc(h.r.event || '') + '</b>' +
            (h.r.round ? ' <span class="rr-round">' + esc(h.r.round) + '</span>' : '') +
            '<small><span class="mdate">' + shortDate(h.r.date || h.comp.date) + ' \u00b7 </span>' +
            esc([h.r.crew, compShort(h.comp.title, h.comp.comp)]
              .filter(Boolean).join(' \u00b7 ')) + '</small></a>' +
          '<div class="rr-time">' + esc(h.r.time || '') + '</div>' +
          '<div class="rr-pct">' + pctHTML(h.r.pct) + '</div>' +
          '<div class="rr-ops">' + (got
            ? '<span class="got-tick" title="Already in your races">\u2713</span>'
            : '<button class="add" data-race-add="' + esc(h.comp.comp) + '" data-race-i="' + h.i + '"' +
              (RC.busy === key ? ' disabled' : '') + ' title="Add to my races">+</button>') +
          '</div></div>';
      }).join('') +
      (hits.length > shown.length
        ? '<button class="ghost rmore" id="race-more">Show ' +
          Math.min(RC.limit, hits.length - shown.length) + ' more of ' + hits.length + '</button>'
        : '') +
      '</div>';

  return '<div class="rfind">' +
    '<div class="rfind-ctl">' + yearBtns + compSel +
      '<input type="search" id="race-q" class="chipsearch" placeholder="Club or crew\u2026" ' +
      'value="' + esc(RC.q) + '" autocomplete="off"></div>' +
    (hits.length ? '<p class="rfind-note">' + plural(hits.length, 'result') +
      ' - press <b>+</b> on the ones you were in.</p>' : '') +
    list + '</div>';
}

// Matching is on the club as published AND on the crew line, because a crew
// often carries a composite or a school name rather than the club.
function raceHits() {
  const q = RC.q.trim().toLowerCase();
  const qKey = q ? raceResolve(q).key : '';
  const out = [];
  RC.comps.forEach(comp => {
    if (RC.year !== 'all' && comp.year !== RC.year) return;
    if (RC.comp !== 'all' && comp.comp !== RC.comp) return;
    comp.results.forEach((r, i) => {
      if (q) {
        const club = (r.club || '').toLowerCase(), crew = (r.crew || '').toLowerCase();
        const hit = club.includes(q) || crew.includes(q) ||
          (qKey && raceResolve(r.club || '').key.indexOf(qKey) === 0);
        if (!hit) return;
      }
      out.push({ comp, r, i });
    });
  });
  out.sort((a, b) => (b.r.date || b.comp.date || '').localeCompare(a.r.date || a.comp.date || '') ||
                     Number(b.r.pct || 0) - Number(a.r.pct || 0));
  return out;
}

function renderRaces() {
  const el = $('races-body');
  if (!el) return;
  el.innerHTML =
    '<section class="setup-sec"><h3 class="setup-head">My races</h3>' + myRacesHTML() + '</section>' +
    '<section class="setup-sec"><h3 class="setup-head">Find a race</h3>' +
    '<p class="setup-intro">Every result on the RowingTools leaderboards, with its GMT percentage. ' +
    'Adding one keeps a copy, so your history stands even if the leaderboard is re-cut.</p>' +
    raceSearchHTML() + '</section>' +
    '<div id="race-msg"></div>';
  wireRaceChart();
}

/* ================= squad =================
   Squads reuse the coach dashboard's groups/group_members tables in the same
   Supabase project. Nothing here widens the tracker's own RLS: every number on
   the board comes from the tracker_squad_board() function, which returns counts
   and totals only. Notes, individual lifts and session dates are not leaked
   because that function never reads them.

   Loaded lazily on first visit to the tab, and it degrades to an instruction
   rather than an error if the schema has not been run - a missing table
   must not take the whole app down at boot. */
const SQ = {
  loaded: false, tried: false, ready: false, error: null,
  squads: [], groupId: null, sharing: new Set(),
  board: [], templates: [], tmplError: null,
  period: '4w', bmode: 'erg', metric: 'erg_metres', busy: false, adding: false, posting: false,
  settings: false,   // the admin drawer is closed until asked for
  preview: null,     // id of the shared template being read before importing
  picked: null,      // Set of exercise names ticked in that preview
};

const PERIODS = [
  { k: 'week', short: 'Week',  label: 'This week' },
  { k: '4w',   short: '4 wks', label: 'Last 4 weeks' },
  { k: '12w',  short: '12 wks', label: 'Last 12 weeks' },
  { k: 'all',  short: 'All',   label: 'All time' },
];

// Consistency first, volume second, and on purpose. A board topped by whoever
// erged the most metres rewards junk volume and punishes the athlete on a
// taper; "days trained" is the number that reflects turning up, is far harder
// to inflate than a distance you type in, and does not disadvantage the
// lighter athlete the way tonnage does. It stays the default, which is why
// Overall is the first mode rather than a footnote.
//
// Two levels, both buttons: what you are looking at, then which measure of it.
// Erg + Water is summed on the client - the function returns the two
// separately, and adding a third pre-summed column would be a column that can
// disagree with the two it came from.
const BOARD_MODES = [
  { k: 'erg',     label: 'Erg', metrics: [
      { k: 'erg_metres',       btn: 'Distance', unit: 'm' },
      { k: 'erg_seconds',      btn: 'Time',     unit: 'time' } ] },
  { k: 'water',   label: 'Water', metrics: [
      { k: 'water_metres',     btn: 'Distance', unit: 'm' },
      { k: 'water_seconds',    btn: 'Time',     unit: 'time' } ] },
  { k: 'both',    label: 'Erg + Water', metrics: [
      { k: 'combined_metres',  btn: 'Distance', unit: 'm' },
      { k: 'combined_seconds', btn: 'Time',     unit: 'time' } ] },
  { k: 'weights', label: 'Weights', metrics: [
      { k: 'sessions_weights', btn: 'Sessions', unit: '' },
      { k: 'weights_sets',     btn: 'Sets',     unit: '' } ] },
  { k: 'core',    label: 'Core', metrics: [
      { k: 'core_work_s',      btn: 'Time',     unit: 'time' },
      { k: 'sessions_core',    btn: 'Sessions', unit: '' } ] },
  // Racing ranks on results, not on training. A claimed race is already public
  // on the regatta leaderboard, so what crosses to the squad is the athlete's
  // own association with it - which is what being on a board says anyway.
  { k: 'races',   label: 'Racing', metrics: [
      { k: 'races_top3',       btn: 'Top 3 GMT', unit: 'pct' },
      { k: 'races',            btn: 'Races',     unit: '' } ] },
];
const boardMode = () => BOARD_MODES.find(m => m.k === SQ.bmode) || BOARD_MODES[0];
const num = v => Number(v) || 0;
// The only derived measures. Everything else is read straight off the row.
// Percentages are compared against a floor rather than zero. A board of GMT
// averages between 82 and 90 drawn from nought is eight identical bars; from a
// floor a little under the worst of them, it is a ranking you can read.
function barPct(v, top, metric) {
  if (!v || !top) return 0;
  if (metric.unit !== 'pct') return Math.round((v / top) * 100);
  const floor = Math.max(0, Math.min(v, top) - 12);
  return Math.round(((v - floor) / Math.max(1, top - floor)) * 100);
}

const boardVal = (r, k) =>
  k === 'combined_metres'  ? num(r.erg_metres) + num(r.water_metres)
  : k === 'combined_seconds' ? num(r.erg_seconds) + num(r.water_seconds)
  // Kept null on purpose: nobody rows a 0% GMT, so a nought here would rank a
  // squad-mate who has not raced below one who had a shocker.
  : k === 'races_top3' ? (r.races_top3 == null ? null : Number(r.races_top3))
  : num(r[k]);

const metricBy = k => {
  const ms = boardMode().metrics;
  return ms.find(m => m.k === k) || ms[0];
};

// The window is NOT computed here. tracker_squad_board takes a period keyword
// and derives the date itself, because a caller-supplied date would let anyone
// call the board twice a day apart and subtract the results to reconstruct a
// squad-mate's exact per-day training. Four fixed windows leave nothing to
// difference.

function fmtMetric(v, unit) {
  if (v == null) return '–';
  if (unit === 'time') return fmtClock(v);
  if (unit === 'm') return v >= 10000 ? round1(v / 1000) + 'k' : String(Math.round(v));
  if (unit === 'kg') return Math.round(v).toLocaleString('en-GB');
  if (unit === 'pct') return round1(v) + '%';
  return String(round1(v));
}

/* ---- loading ---- */
// A missing table here means the SQL has not been run yet. That is a state to
// explain, not an exception to throw.
async function loadSquads() {
  SQ.tried = true;
  const uid = S.session.user.id;
  const { data, error } = await sb.from('group_members')
    .select('group_id, role, groups(id, name, join_code)')
    .eq('profile_id', uid);
  // loaded stays false on failure, so the next visit retries instead of the
  // tab being wedged for the rest of the session by one dropped request
  if (error) { SQ.ready = false; SQ.error = error.message; return; }
  SQ.loaded = true; SQ.ready = true; SQ.error = null;
  SQ.squads = (data || [])
    .map(m => ({ id: m.group_id, role: m.role, name: (m.groups || {}).name, code: (m.groups || {}).join_code }))
    .filter(x => x.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!SQ.squads.some(s => s.id === SQ.groupId)) SQ.groupId = SQ.squads.length ? SQ.squads[0].id : null;

  const sh = await sb.from('tracker_sharing').select('group_id').eq('profile_id', uid);
  // Getting this wrong is worse than not knowing: a silently empty set shows
  // "not sharing" for a squad you ARE sharing with, and the button then tries
  // to insert a row that already exists.
  if (sh.error) { SQ.ready = false; SQ.loaded = false; SQ.error = sh.error.message; return; }
  SQ.sharing = new Set((sh.data || []).map(r => r.group_id));
}

async function loadBoard() {
  if (!SQ.groupId) { SQ.board = []; SQ.templates = []; return; }
  const [board, tmpl] = await Promise.all([
    sb.rpc('tracker_squad_board', { p_group: SQ.groupId, p_period: SQ.period }),
    sb.from('tracker_shared_templates').select('*').eq('group_id', SQ.groupId)
      .order('created_at', { ascending: false }),
  ]);
  SQ.board = board.error ? [] : (board.data || []);
  SQ.boardError = board.error ? board.error.message : null;
  // A failed read here used to be dropped on the floor, which rendered as
  // "Nothing shared with this squad yet" - a sentence that is indistinguishable
  // from the truth and sends you looking in the wrong place. Say what happened.
  SQ.templates = tmpl.error ? [] : (tmpl.data || []);
  SQ.tmplError = tmpl.error ? tmpl.error.message : null;
}

// One refresh at a time, but a refresh asked for while one is running is
// queued rather than dropped - dropping it leaves the caller's reload undone
// and, after create/join/leave, SQ.loaded false and the panel stuck on
// "Loading your squads...".
let pendingRefresh;
async function refreshSquad(loud) {
  if (S.trial) { renderSquad(); return; }
  if (SQ.busy) { pendingRefresh = loud || pendingRefresh || null; return; }
  SQ.busy = true;
  try {
    if (!SQ.loaded) await loadSquads();
    if (SQ.ready) await loadBoard();
  } finally {
    SQ.busy = false;      // or one thrown request disables the tab for good
  }
  renderSquad();
  if (loud) toast('squad-msg', loud);
  if (pendingRefresh !== undefined) {
    const again = pendingRefresh;
    pendingRefresh = undefined;
    await refreshSquad(again || undefined);
  }
}

/* ---- render ---- */
function renderSquad() {
  const el = $('squad-body');
  if (!el) return;

  // A squad is other people. There is nothing honest to show a sample here.
  if (S.trial) {
    el.innerHTML = '<div class="setup-sec"><h3 class="setup-head">Squads</h3>' +
      '<p class="setup-intro">A squad is a group of people who can see how much training each ' +
      'other is getting through - days trained, sessions, metres, time - and swap exercise ' +
      'templates. Totals only: never a session, a lift or a note.</p>' +
      '<div class="gate"><b>Squads need an account.</b><span>' +
      (S.joinCode ? 'You arrived on an invite for code <b>' + esc(S.joinCode) + '</b>, and it is being ' +
        'held for you: create an account and you can accept it straight away. ' : '') +
      'Your squad-mates have to be able to find you, which a sample on one device cannot be. ' +
      'Everything you have logged so far comes with you when you sign up.</span></div>' +
      '<a class="primary" id="sq-signup" href="login.html?signup=1" style="display:block;text-align:center;' +
      'text-decoration:none;line-height:42px;height:42px;margin-top:14px">Create a free account</a></div>';
    return;
  }

  if (!SQ.tried) { el.innerHTML = '<p class="loading-app">Loading your squads&hellip;</p>'; return; }

  if (!SQ.ready) {
    // Could be either "SQL not run" or a dropped connection, and guessing
    // wrong sends someone to the SQL editor for a wifi blip. Say both, and
    // always offer the retry.
    el.innerHTML = '<div class="setup-sec"><h3 class="setup-head">Squads</h3>' +
      '<p class="setup-intro">Could not read your squads. Either squads are not set up on this ' +
      'database yet - run <b>tracker/supabase/tracker_schema.sql</b> in the Supabase SQL editor - ' +
      'or the connection dropped.</p>' +
      '<div class="toast err">' + esc(SQ.error || 'Could not read group membership.') + '</div>' +
      '<button id="sq-retry" style="width:100%;margin-top:12px">Try again</button></div>';
    return;
  }

  el.innerHTML = (SQ.squads.length ? squadMainHTML() : squadJoinHTML(true)) +
    (SQ.squads.length && SQ.adding ? squadJoinHTML(false) : '');
  const sel = $('squad-pick');
  if (sel) sel.value = SQ.groupId;
  // period and measure are buttons now; see the click handler.
}

function squadJoinHTML(alone) {
  const invited = !!S.joinCode;
  return '<div class="setup-sec">' +
    (alone ? '<h3 class="setup-head">Squads</h3>' +
      '<p class="setup-intro">A squad is a group of people who can see how much training each other ' +
      'is getting through - days trained, sessions, metres, time - and swap exercise templates. ' +
      'Joining puts your <b>totals</b> on that squad’s board; never a session, a lift, a date or a ' +
      'note. Leaving takes them straight back off.</p>' : '<h3 class="setup-head" style="margin-top:8px">Join another squad</h3>') +
    '<div class="lib-form"><h3>' + (invited ? 'You have been invited' : 'Join with a code') + '</h3>' +
      (invited ? '<p class="fhint" style="margin:-4px 0 12px">Someone sent you the code below. ' +
        'Join and your totals go on their board.</p>' : '') +
      '<div class="fwide"><label>Six-character code from a squad-mate</label>' +
        '<input type="text" id="sq-code" placeholder="e.g. K7RMQ2" maxlength="10" ' +
        'value="' + esc(S.joinCode || '') + '" ' +
        'autocapitalize="characters" autocomplete="off" style="letter-spacing:.24em;text-transform:uppercase"></div>' +
      '<button class="primary" id="sq-join" style="height:42px">Join squad</button>' +
      (invited ? '<button id="sq-nojoin" style="width:100%;margin-top:8px">Not now</button>' : '') +
    '</div>' +
    '<div class="lib-form"><h3>Or start one</h3>' +
      '<div class="fwide"><label>Squad name</label>' +
        '<input type="text" id="sq-name" placeholder="e.g. Senior Men 2026" maxlength="60"></div>' +
      '<button id="sq-create" style="width:100%;height:42px">Create squad</button>' +
      '<div class="fhint">You get a code to pass on. Anyone with it can join.</div>' +
    '</div>' +
    // distinct id: when this block sits below an existing board the page
    // already has a #squad-msg, and a duplicate id would send every message
    // to the wrong end of the panel
    '<div id="' + (alone ? 'squad-msg' : 'squad-msg2') + '"></div></div>';
}
// whichever message holder belongs to the form actually on screen
const squadMsg = () => ($('squad-msg2') ? 'squad-msg2' : 'squad-msg');

// The join link. Built from the page's own location so it works on
// localhost and on rowingtools.co.uk without a hard-coded host.
const joinLink = code =>
  window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + '?join=' + encodeURIComponent(code);

function squadMainHTML() {
  const sq = SQ.squads.find(s => s.id === SQ.groupId) || SQ.squads[0];
  const isAdmin = !!(sq && sq.role === 'admin');
  const me = S.session.user.id;
  const mode = boardMode();
  if (!mode.metrics.some(m => m.k === SQ.metric)) SQ.metric = mode.metrics[0].k;
  const metric = metricBy(SQ.metric);

  const rows = SQ.board.filter(r => r.sharing);
  const quiet = SQ.board.filter(r => !r.sharing);
  // A null measure sorts last rather than as a zero, and is drawn as a dash.
  const sortVal = r => { const v = boardVal(r, metric.k); return v == null ? -Infinity : v; };
  rows.sort((a, b) => sortVal(b) - sortVal(a));
  const top = Math.max(...rows.map(r => boardVal(r, metric.k) || 0), 0);

  const rmBtn = r => (isAdmin && r.profile_id !== me)
    ? '<button class="brm" data-sq-rm="' + r.profile_id + '" data-sq-rmname="' + esc(r.display_name) +
      '">remove</button>' : '';

  const board = SQ.boardError
    ? '<div class="toast err">Could not load the board: ' + esc(SQ.boardError) + '</div>'
    : !SQ.board.length
    ? '<p class="empty">Nobody in this squad yet.</p>'
    : '<div class="bhead"><span>#</span><span>Athlete</span><span class="r">' +
        esc(mode.label) + ' \u00b7 ' + esc(metric.btn) + '</span></div>' +
      rows.map((r, i) => {
          const v = boardVal(r, metric.k);
          const rm = rmBtn(r);
          // `adm` tells the CSS to stop the breakdown line short of the remove
          // link; without it the two share the same grid cell and overlap.
          return '<div class="brow' + (i ? '' : ' lead') + (r.profile_id === me ? ' me' : '') +
            (v ? '' : ' zero') + (rm ? ' adm' : '') + '">' +
            '<span class="brank">' + (i + 1) + '</span>' +
            '<span class="bname">' + esc(r.display_name) + '</span>' +
            '<span class="bval">' + fmtMetric(v, metric.unit) +
              (metric.unit && metric.unit !== 'time' && metric.unit !== 'pct'
                ? '<small>' + metric.unit + '</small>' : '') + '</span>' +
            '<span class="bsub">' + r.days_trained + ' day' + (r.days_trained === 1 ? '' : 's') + ' \u00b7 ' +
              r.sessions_weights + ' weights \u00b7 ' + r.sessions_erg + ' erg \u00b7 ' +
              (r.sessions_water || 0) + ' water \u00b7 ' + r.sessions_core + ' core</span>' +
            rm +
            '<span class="bbar"><i style="width:' + barPct(v, top, metric) + '%"></i></span>' +
          '</div>';
        }).join('') +
        (quiet.length ? quiet.map(r =>
          '<div class="brow bquiet' + (r.profile_id === me ? ' me' : '') + '">' +
            '<span class="brank">\u2013</span>' +
            '<span class="bname">' + esc(r.display_name) + '</span>' +
            '<span class="bval">\u2013</span>' +
            '<span class="bsub">not on the board' +
              (r.profile_id === me
                ? ' <button class="blink" id="sq-share-me" data-group="' + SQ.groupId + '">show my totals</button>'
                : '') + '</span>' +
            rmBtn(r) + '</div>').join('') : '');

  return '<div class="setup-sec">' +
    '<div class="squad-bar">' +
      (SQ.squads.length > 1
        ? '<select id="squad-pick">' + SQ.squads.map(x =>
            '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('') + '</select>'
        : '<h3 class="setup-head" style="flex:1;margin:0;border:none;padding:0">' +
          esc((sq && sq.name) || 'Squad') + '</h3>') +
      '<button class="seg solo' + (SQ.settings ? ' active' : '') + '" id="sq-settings">' +
        (SQ.settings ? '\u2715 Close settings' : '\u2699 Board settings') + '</button>' +
    '</div>' +

    (SQ.settings ? squadSettingsHTML(sq, isAdmin) : '') +

    // what you are looking at, then which measure of it
    '<div class="segmented bmodes" role="tablist" aria-label="What to rank by">' +
      BOARD_MODES.map(m => '<button class="seg' + (m.k === SQ.bmode ? ' active' : '') +
        '" data-bmode="' + m.k + '" role="tab" aria-selected="' + (m.k === SQ.bmode) + '">' +
        m.label + '</button>').join('') + '</div>' +
    '<div class="boardctl">' +
      '<div class="segmented sm" role="group" aria-label="Measure">' +
        mode.metrics.map(m => '<button class="seg' + (m.k === SQ.metric ? ' active' : '') +
          '" data-bmetric="' + m.k + '" aria-pressed="' + (m.k === SQ.metric) + '">' +
          m.btn + '</button>').join('') + '</div>' +
      '<div class="segmented sm" role="group" aria-label="Period">' +
        PERIODS.map(p => '<button class="seg' + (p.k === SQ.period ? ' active' : '') +
          '" data-bperiod="' + p.k + '" aria-pressed="' + (p.k === SQ.period) + '">' +
          p.short + '</button>').join('') + '</div>' +
    '</div>' +
    board +
    '<p class="squad-note">' + rows.length + ' of ' + SQ.board.length + ' on the board \u00b7 ' +
      esc(mode.label) + ', ' + esc(metric.btn.toLowerCase()) + ', ' +
      esc((PERIODS.find(p => p.k === SQ.period) || {}).label || '').toLowerCase() + '.<br>' +
      'Everyone here sees your <b>totals</b> - days trained, sessions, erg and water distance and ' +
      'time, core time, weights sets and volume, and how many races you have claimed with the ' +
      'average of your best three. Never a session, a lift, a date or a note. ' +
      'They are self-reported: they show who is putting the work in, not who is fastest.' +
    '</p>' +
    '<div id="squad-msg"></div>' +
  '</div>';
}

// Everything you do to a squad rather than read from it: the invite, who is in
// it, and the shared templates. It lives behind one button because it is all
// occasional - you set a squad up once and then look at the board every week.
function squadSettingsHTML(sq, isAdmin) {
  return '<div class="bsettings">' +
    (sq && sq.code
      ? '<div class="invite">' +
          '<div class="inv-code">Invite code <b>' + esc(sq.code) + '</b>' +
            (isAdmin ? '<button class="blink" id="sq-newcode">new code</button>' : '') + '</div>' +
          '<div class="inv-acts">' +
            '<button id="sq-mail">Invite by email</button>' +
            (navigator.share ? '<button id="sq-share">Share&hellip;</button>' : '') +
            '<button id="sq-copy">Copy link</button>' +
          '</div>' +
          '<p class="inv-note">Anyone with the link or the code can join, and joining puts them on ' +
            'this board. Email opens your own mail app with the link in it.' +
            (isAdmin ? ' A new code stops every link you have already sent from working.' : '') +
          '</p>' +
        '</div>'
      : '<div class="invite"><div class="inv-code">No invite code yet</div>' +
          (isAdmin
            ? '<div class="inv-acts"><button class="primary" id="sq-newcode" style="height:38px">' +
              'Create an invite code</button></div>' +
              '<p class="inv-note">This squad was made before invite codes existed, so there is ' +
                'nothing to hand out yet. Generate one and you can invite people by email or link.</p>'
            : '<p class="inv-note">This squad has no invite code. Whoever started it can create ' +
                'one from here.</p>') +
        '</div>') +
    squadTemplatesHTML() +
    '<p class="squad-note" style="margin-bottom:0">' +
      '<button class="blink" id="sq-leave">Leave ' + esc((sq && sq.name) || 'this squad') + '</button>' +
      (isAdmin ? ' \u00b7 you started this squad, so you can remove people from the board above' : '') +
      ' \u00b7 <button class="blink" id="sq-add">join another squad</button>' +
    '</p>' +
  '</div>';
}

function squadTemplatesHTML() {
  const mine = S.session.user.id;
  return '<div class="tsec"><h4>Shared templates</h4>' +
    '<p class="inv-note" style="margin:0 0 12px">Post your exercise library so the squad can pick ' +
    'it up, or take someone else\'s. Importing only ever adds - it never changes or removes what ' +
    'you already have.</p>' +
    (SQ.tmplError
      ? '<div class="toast err">Could not read this squad\u2019s templates: ' + esc(SQ.tmplError) +
        '<br>If that mentions a missing table or a policy, run ' +
        '<b>tracker/supabase/tracker_schema.sql</b> in the Supabase SQL editor.</div>'
      : SQ.templates.length
      ? SQ.templates.map(t => {
          const list = (t.payload && Array.isArray(t.payload.exercises)) ? t.payload.exercises : [];
          const when = (t.created_at || '').slice(0, 10);
          const open = SQ.preview === t.id;
          return '<div class="lib-item"><div><div class="nm">' + esc(t.name) + '</div>' +
            '<div class="meta">' + plural(list.length, 'exercise') +
            (when ? ' \u00b7 ' + shortDate(when) : '') +
            (t.profile_id === mine ? ' \u00b7 yours' : '') + '</div></div>' +
            '<div class="ops">' +
              '<button class="ghost" data-tmpl-open="' + t.id + '" style="font-size:12.5px">' +
                (open ? 'Close' : 'Read') + '</button>' +
              (t.profile_id === mine
                ? '<button class="ghost" data-tmpl-del="' + t.id + '" title="Remove">\u00d7</button>' : '') +
            '</div></div>' +
            (open ? tmplPreviewHTML(t, list) : '');
        }).join('')
      : '<p class="placeholder">Nothing shared with this squad yet.</p>') +
    '<div class="tmpl-row"><button id="sq-post">&#8593; Share my exercise library</button></div>' +
    '<div id="squad-tmsg"></div></div>';
}

// You should be able to see what is in someone's library before it lands in
// yours, and take the four lifts you wanted rather than all twenty. Anything
// already in your library by name is ticked off and labelled, so importing
// cannot look like it silently did nothing.
function tmplPreviewHTML(t, list) {
  const have = new Set(activeLibrary().map(e => e.name.trim().toLowerCase()));
  const picked = SQ.picked || new Set();
  const fresh = list.filter(x => !have.has(String(x.name || '').trim().toLowerCase()));
  return '<div class="tprev">' +
    '<div class="tprev-head">' +
      '<span>' + plural(fresh.length, 'exercise') + ' you do not have' +
        (list.length - fresh.length ? ' \u00b7 ' + (list.length - fresh.length) + ' already yours' : '') +
      '</span>' +
      '<span><button class="blink" data-tmpl-all="' + t.id + '">all</button> \u00b7 ' +
        '<button class="blink" data-tmpl-none="' + t.id + '">none</button></span>' +
    '</div>' +
    list.map(x => {
      const nm = String(x.name || '');
      const dup = have.has(nm.trim().toLowerCase());
      return '<label class="tprev-row' + (dup ? ' dup' : '') + '">' +
        '<input type="checkbox" data-tmpl-pick="' + esc(nm) + '"' +
          (picked.has(nm) && !dup ? ' checked' : '') + (dup ? ' disabled' : '') + '>' +
        '<span class="tp-name">' + esc(nm) + '</span>' +
        '<span class="tp-meta">' + esc(x.pattern || 'other') +
          (x.unit === 'secs' ? ' \u00b7 timed' : '') +
          (x.per_side ? ' \u00b7 each side' : '') +
          (x.bodyweight ? ' \u00b7 bodyweight' : '') +
          (dup ? ' \u00b7 already yours' : '') + '</span>' +
        (x.note ? '<span class="tp-note">' + esc(x.note) + '</span>' : '') +
      '</label>';
    }).join('') +
    '<button class="primary" data-tmpl-get="' + t.id + '" style="height:40px;margin-top:12px"' +
      (picked.size ? '' : ' disabled') + '>' +
      (picked.size ? 'Import ' + plural(picked.size, 'exercise') : 'Tick what you want') + '</button>' +
  '</div>';
}

/* ---- actions ---- */
async function squadCreate() {
  const msg = squadMsg();
  const name = ($('sq-name').value || '').trim();
  if (!name) { toast(msg, 'Give the squad a name.', 'warn'); return; }
  const { data, error } = await sb.rpc('tracker_create_group', { p_name: name });
  if (error) { toast(msg, 'Could not create it: ' + esc(error.message), 'err'); return; }
  SQ.adding = false;
  const made = Array.isArray(data) ? data[0] : data;
  SQ.loaded = false;
  SQ.groupId = made ? made.group_id : null;
  track('squad_created', {});
  await refreshSquad('Squad created. Its code is ' + esc((made && made.join_code) || '') +
    ' - pass that on and people can join.');
}

async function squadJoin() {
  const msg = squadMsg();
  const code = ($('sq-code').value || '').trim();
  if (!code) { toast(msg, 'Enter the code you were given.', 'warn'); return; }
  const { data, error } = await sb.rpc('tracker_join_group', { p_code: code });
  if (error) { toast(msg, esc(error.message), 'err'); return; }
  SQ.adding = false;
  const j = Array.isArray(data) ? data[0] : data;
  SQ.loaded = false;
  SQ.groupId = j ? j.group_id : null;
  localStorage.removeItem(PENDING_JOIN);
  S.joinCode = null;
  track('squad_joined', {});
  await refreshSquad('Joined ' + esc((j && j.group_name) || 'the squad') +
    '. Your totals are on their board from now on - leave the squad to take them off again.');
}

async function squadLeave() {
  const sq = SQ.squads.find(s => s.id === SQ.groupId);
  if (!sq) return;
  if (!confirm('Leave ' + sq.name + '?\n\nYour totals come off their board straight away and nobody in ' +
      'the squad can see anything of yours after that. Your own training log is untouched.')) return;
  const { error } = await sb.rpc('tracker_leave_group', { p_group: SQ.groupId });
  if (error) { toast('squad-msg', 'Could not leave: ' + esc(error.message), 'err'); return; }
  SQ.loaded = false; SQ.groupId = null;
  await refreshSquad('Left ' + esc(sq.name) + '.');
}

// Being in a squad is being on its board, so nothing calls this to opt out
// any more - leaving does that. It survives as the repair for a membership
// that predates the change and has no sharing row: "show my totals" on your
// own greyed row.
async function squadToggleSharing(gid) {
  // The id comes from the rendered button, not from SQ.groupId: switching the
  // picker sets SQ.groupId immediately while the old panel is still on screen,
  // so reading it here could act on a squad other than the one on screen.
  if (!gid) return;
  const on = SQ.sharing.has(gid);
  const uid = S.session.user.id;
  let error;
  if (on) {
    ({ error } = await sb.from('tracker_sharing').delete().eq('profile_id', uid).eq('group_id', gid));
    if (!error) SQ.sharing.delete(gid);
  } else {
    ({ error } = await sb.from('tracker_sharing').insert({ profile_id: uid, group_id: gid }));
    if (!error) SQ.sharing.add(gid);
  }
  if (error) { toast('squad-msg', 'Could not change that: ' + esc(error.message), 'err'); return; }
  track('squad_sharing', { on: !on });
  await refreshSquad(on
    ? 'Your totals are off this board. Nothing of yours is shared with this squad now.'
    : 'You are on the board. Totals only - your sessions, lifts and notes stay private.');
}

// Removing someone is an admin-only RPC; the client cannot touch
// group_members directly (it has no DELETE policy, on purpose).
async function squadRemoveMember(pid, name) {
  if (!confirm('Remove ' + name + ' from this squad?\n\nTheir totals come off the board and they ' +
    'lose access to anything shared with it. Their own training log is untouched, and they can ' +
    'join again with the code.')) return;
  const { error } = await sb.rpc('tracker_admin_remove_member', { p_group: SQ.groupId, p_profile: pid });
  if (error) { toast('squad-msg', 'Could not remove them: ' + esc(error.message), 'err'); return; }
  track('squad_member_removed', {});
  await refreshSquad(esc(name) + ' is no longer in this squad.');
}

// Gives a squad its first code, or replaces one that has got out. Both are
// the same operation; only the warning differs.
async function squadRotateCode(hadOne) {
  if (hadOne && !confirm('Give this squad a new invite code?' + String.fromCharCode(10, 10) +
      'Every link and code you have already sent out stops working. Anyone already in the squad ' +
      'stays in it.')) return;
  const { data, error } = await sb.rpc('tracker_rotate_code', { p_group: SQ.groupId });
  if (error) { toast('squad-msg', 'Could not change the code: ' + esc(error.message), 'err'); return; }
  const sq = SQ.squads.find(x => x.id === SQ.groupId);
  if (sq) sq.code = data;
  track('squad_code_rotated', { first: !hadOne });
  renderSquad();
  toast('squad-msg', hadOne
    ? 'New code: <b>' + esc(data) + '</b>. The old one no longer works.'
    : 'Invite code <b>' + esc(data) + '</b> created - you can send it out now.');
}

// Share sheet, mail app, clipboard - the same link three ways, because how a
// crew passes something around is not something to have an opinion about.
const NL = String.fromCharCode(10);
function squadInvite(how) {
  const sq = SQ.squads.find(s => s.id === SQ.groupId);
  if (!sq || !sq.code) return;
  const url = joinLink(sq.code);
  const name = (S.profile && S.profile.display_name) || 'A crewmate';
  const subject = 'Join ' + sq.name + ' on RowingTools';
  const body = name + ' has invited you to ' + sq.name + ' on the RowingTools training tracker.' + NL + NL +
    'Open this link to join:' + NL + url + NL + NL +
    'Or enter the code ' + sq.code + ' on the Board tab.' + NL + NL +
    'A squad shows how much training each of you is getting through - days trained, sessions, ' +
    'erg metres and time. Totals only: nobody sees your individual sessions, lifts or notes.';

  if (how === 'mail') {
    track('squad_invite', { how: 'mail' });
    window.location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    return;
  }
  if (how === 'share' && navigator.share) {
    track('squad_invite', { how: 'share' });
    // A cancelled share sheet rejects; that is a choice, not a failure.
    navigator.share({ title: subject, text: 'Join ' + sq.name + ' on RowingTools', url }).catch(() => {});
    return;
  }
  track('squad_invite', { how: 'copy' });
  // The clipboard needs a secure context and permission; the link is on
  // screen either way, so falling back to showing it is enough.
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      () => toast('squad-msg', 'Invite link copied. Anyone you send it to can join with one tap.'),
      () => toast('squad-msg', 'Copy this link by hand: <b>' + esc(url) + '</b>', 'warn'));
  } else {
    toast('squad-msg', 'Copy this link by hand: <b>' + esc(url) + '</b>', 'warn');
  }
}

async function squadPostTemplate() {
  if (SQ.posting) return;
  const lib = activeLibrary();
  if (!lib.length) { toast('squad-tmsg', 'Your library is empty - nothing to share yet.', 'warn'); return; }
  SQ.posting = true;
  const name = ((S.profile && S.profile.display_name) || 'Someone') + "'s library";
  const payload = {
    app: 'rowingtools-tracker', kind: 'exercise-template', version: 1, exported: todayISO(),
    exercises: lib.map(e => ({
      name: e.name, session_groups: groupsOf(e), pattern: e.pattern, unit: e.unit,
      per_side: e.per_side, bodyweight: e.bodyweight, note: e.note, position: e.position,
    })),
  };
  const { error } = await sb.from('tracker_shared_templates').insert({
    group_id: SQ.groupId, profile_id: S.session.user.id, name, kind: 'exercise-template', payload,
  });
  SQ.posting = false;
  if (error) { toast('squad-tmsg', 'Could not share it: ' + esc(error.message), 'err'); return; }
  track('squad_template_shared', { exercises: lib.length });
  await refreshSquad();
  toast('squad-tmsg', 'Shared ' + lib.length + ' exercises with the squad.');
}

async function squadImportTemplate(id) {
  const t = SQ.templates.find(x => x.id === id);
  if (!t) return;
  const picked = SQ.picked || new Set();
  const all = (t.payload && Array.isArray(t.payload.exercises)) ? t.payload.exercises : [];
  const wanted = all.filter(x => picked.has(String(x.name || '')));
  if (!wanted.length) { toast('squad-tmsg', 'Tick the exercises you want first.', 'warn'); return; }
  // Same merge rules as a file upload - additive, never overwrites - applied to
  // the subset that was ticked rather than the whole library.
  const n = await importExercises(Object.assign({}, t.payload, { exercises: wanted }), 'squad-tmsg');
  if (n) {
    track('squad_template_imported', { exercises: n, of: all.length });
    SQ.preview = null; SQ.picked = null;
    renderLibrary(); renderLog(snapshotLog()); renderSquad();
  }
}

async function squadDeleteTemplate(id) {
  if (!confirm('Remove this from the squad? Anyone who already imported it keeps their copy.')) return;
  const { error } = await sb.from('tracker_shared_templates').delete().eq('id', id);
  if (error) { toast('squad-tmsg', 'Could not remove it: ' + esc(error.message), 'err'); return; }
  await refreshSquad();
  toast('squad-tmsg', 'Removed.');
}

/* ================= events ================= */
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.classList) return;
  if (el.id === 'chip-search') { filterChips(); return; }
  if (el.id === 'race-q') {
    RC.q = el.value; RC.limit = 30;
    const at = el.selectionStart;
    renderRaces();
    const box = $('race-q');
    if (box) { box.focus(); box.setSelectionRange(at, at); }
    return;
  }
  if (el.id === 'log-notes') { queueDraft(); return; }
  if (el.closest && el.closest('#erg-form')) { queueErgDraft(); return; }
  if (!(el.classList.contains('in-r') || el.classList.contains('in-w'))) return;
  const card = el.closest('.ex'), row = el.closest('.setrow');
  if (!card || !row) return;
  if (card.querySelector('.setrow') === row) fillDown(card);
  else el.dataset.touched = '1';   // typed into by hand: stop mirroring set 1
  refreshBest(card);
  updateSecNotes();
  queueDraft();
});
// selects don't fire input in every browser
document.addEventListener('change', e => {
  if (e.target.closest && e.target.closest('#erg-form')) { queueErgDraft(); return; }
  if (e.target.id === 'tm-count') {
    localStorage.setItem(COUNTDOWN_KEY, e.target.value);
    if (RUN.counting) { cancelCountdown(); startTimer(); }   // apply to the round you are waiting on
    return;
  }
  // The progress controls are rebuilt with the panel, so they are wired by
  // delegation rather than by id at boot.
  if (e.target.id === 'prog-pick')   { PROG.ex = e.target.value; PROG.metric = ''; renderProgress(); return; }
  // prog-metric and prog-weeks are buttons now; see the click handler.
});

document.addEventListener('click', async e => {
  const tog = e.target.closest('.entry-toggle');
  if (tog) {
    const open = tog.getAttribute('aria-expanded') === 'true';
    tog.setAttribute('aria-expanded', String(!open));
    tog.parentElement.querySelector('.entry-detail').hidden = open;
    return;
  }
  // steppers: nudge the field, then let the normal input path do fill-down,
  // the PB line and the draft
  if (e.target.classList.contains('sdn') || e.target.classList.contains('sup')) {
    const wrap = e.target.closest('.stepper'), inp = wrap.querySelector('input');
    const step = parseFloat(wrap.dataset.step) || 1;
    const cur = parseFloat(inp.value);
    const next = (isNaN(cur) ? 0 : cur) + (e.target.classList.contains('sup') ? step : -step);
    inp.value = Math.max(0, Math.round(next * 100) / 100);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const rep = e.target.closest('[data-repeat]');
  if (rep) { repeatGroup(rep.dataset.repeat); return; }
  const chip = e.target.closest('[data-chip]');
  if (chip) {
    chip.getAttribute('aria-pressed') === 'true' ? removeExercise(chip.dataset.chip) : addExercise(chip.dataset.chip, false);
    saveDraft();
    return;
  }
  if (e.target.classList.contains('ex-close')) { removeExercise(e.target.closest('.ex').dataset.id); return; }
  // finish an exercise as you finish it, rather than holding the whole session
  // in your head until the end
  if (e.target.classList.contains('exdone')) {
    const card = e.target.closest('.ex');
    if (!cardRows(card).some(r => r.r !== '')) {
      flashCard(card);
      toast('log-msg', 'Enter at least one set before closing that exercise off.', 'warn');
      return;
    }
    collapseExercise(card, true);
    updateSecNotes(); saveDraft();
    $('log-msg').innerHTML = '';
    return;
  }
  if (e.target.classList.contains('exedit')) {
    collapseExercise(e.target.closest('.ex'), false);
    updateSecNotes(); saveDraft();
    return;
  }
  if (e.target.id === 'draft-drop') {
    if (!confirm('Throw away what you have entered for this date? Sessions you have already saved are kept.')) return;
    clearDraft(currentDate());
    $('log-notes').value = '';
    renderLog();
    return;
  }
  if (e.target.id === 'edit-cancel-top' || e.target.id === 'cancel-edit') { cancelEditWorkout(); return; }
  const ew = e.target.closest('[data-edit-w]');
  if (ew) { startEditWorkout(ew.dataset.editW); return; }
  if (e.target.id === 'sync-now') { flushOutbox(true); return; }
  if (e.target.classList.contains('addset')) {
    // .addset is shared styling, so route the other users of it first
    if (e.target.id === 'eg-addiv') {
      $('eg-ivs').insertAdjacentHTML('beforeend', ergIvRowHTML($('eg-ivs').children.length, {}));
      saveErgDraft();
      return;
    }
    if (e.target.id === 'cr-add') {
      syncBuilderFromDOM();
      editingRoutine.steps.push({ name: '', target_s: 60 });
      renderBuilder();
      return;
    }
    const card = e.target.closest('.ex');
    if (!card) return;
    const rowsEl = card.querySelector('.rows');
    rowsEl.insertAdjacentHTML('beforeend',
      setRowHTML(rowsEl.children.length, '', '', card.dataset.bw === 'true', card.dataset.timeonly === 'true'));
    fillDown(card);   // a 4th set starts from set 1 rather than blank
    updateSecNotes(); saveDraft();
    return;
  }
  if (e.target.classList.contains('rm')) {
    const rowsEl = e.target.closest('.rows');
    e.target.closest('.setrow').remove();
    [...rowsEl.children].forEach((row, i) => row.querySelector('.setno').textContent = i + 1);
    updateSecNotes(); saveDraft();
    return;
  }
  if (e.target.classList.contains('iv-rm')) {
    const tb = e.target.closest('tbody');
    e.target.closest('tr').remove();
    [...tb.children].forEach((tr, i) => tr.querySelector('.setno').textContent = i + 1);
    saveErgDraft();
    return;
  }
  // Deleting a logged session cannot be undone, and the button sits one tap
  // away from the session you were reading. Always ask.
  const dw = e.target.closest('[data-del-w]');
  if (dw) {
    if (!confirm('Delete this weights session for good?')) return;
    const { error } = await sb.from('tracker_workouts').delete().eq('id', dw.dataset.delW);
    if (!error) { S.workouts = S.workouts.filter(s => s.id !== dw.dataset.delW); renderHistory(); renderProgress(); refreshWeekCount(); }
    return;
  }
  const dc = e.target.closest('[data-del-c]');
  if (dc) {
    if (!confirm('Delete this core session for good?')) return;
    const { error } = await sb.from('tracker_core_sessions').delete().eq('id', dc.dataset.delC);
    if (!error) { S.coreSessions = S.coreSessions.filter(s => s.id !== dc.dataset.delC); renderHistory(); renderProgress(); refreshWeekCount(); }
    return;
  }
  // ---- core routine builder ----
  const cUp = e.target.closest('[data-cup]'), cDn = e.target.closest('[data-cdown]'),
        cDup = e.target.closest('[data-cdup]'), cRm = e.target.closest('[data-crm]');
  if (cUp || cDn || cDup || cRm) {
    syncBuilderFromDOM();
    const st = editingRoutine.steps;
    if (cUp) { const i = +cUp.dataset.cup; if (i > 0) st.splice(i - 1, 0, st.splice(i, 1)[0]); }
    if (cDn) { const i = +cDn.dataset.cdown; if (i < st.length - 1) st.splice(i + 1, 0, st.splice(i, 1)[0]); }
    if (cDup) { const i = +cDup.dataset.cdup; st.splice(i + 1, 0, { ...st[i] }); }
    if (cRm) { st.splice(+cRm.dataset.crm, 1); }
    renderBuilder();
    return;
  }
  if (e.target.id === 'cr-save') { saveRoutine(); return; }
  if (e.target.id === 'cr-cancel') { editingRoutine = null; renderRoutines(); return; }
  if (e.target.id === 'cr-del') { deleteRoutine(editingRoutine.id); return; }
  const rtEd = e.target.closest('[data-rt-edit]');
  if (rtEd) {
    const r = routineById(rtEd.dataset.rtEdit);
    if (!r) return;
    editingRoutine = { id: r.id, name: r.name, steps: stepsOf(r).map(s => ({ ...s })) };
    renderRoutines();
    $('rt-builder').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const rtDel = e.target.closest('[data-rt-del]');
  if (rtDel) { deleteRoutine(rtDel.dataset.rtDel); return; }
  // ---- progress ----
  const pm = e.target.closest('[data-pmode]');
  if (pm) {
    if (PROG.mode !== pm.dataset.pmode) { PROG.mode = pm.dataset.pmode; PROG.metric = ''; renderProgress(); }
    return;
  }
  const pmet = e.target.closest('[data-pmetric]');
  if (pmet) {
    if (PROG.metric !== pmet.dataset.pmetric) { PROG.metric = pmet.dataset.pmetric; renderProgress(); }
    return;
  }
  const prng = e.target.closest('[data-prange]');
  if (prng) { PROG.weeks = prng.dataset.prange; renderProgress(); return; }
  const ry = e.target.closest('[data-ryear]');
  if (ry) {
    if (RC.year !== ry.dataset.ryear) { RC.year = ry.dataset.ryear; RC.limit = 30; renderRaces(); }
    return;
  }
  const radd = e.target.closest('[data-race-add]');
  if (radd) { claimRace(radd.dataset.raceAdd, Number(radd.dataset.raceI)); return; }
  const rdot = e.target.closest('[data-race-dot]');
  if (rdot) {
    // Tapping the open one again closes it, which is what a toggle should do.
    RC.picked = RC.picked === rdot.dataset.raceDot ? null : rdot.dataset.raceDot;
    renderRaces();
    return;
  }
  if (e.target.closest('[data-race-close]')) { RC.picked = null; renderRaces(); return; }
  const rso = e.target.closest('[data-rsort]');
  if (rso) {
    if (RC.sort !== rso.dataset.rsort) { RC.sort = rso.dataset.rsort; renderRaces(); }
    return;
  }
  const rsh = e.target.closest('[data-race-share]');
  if (rsh) { shareSeason(rsh.dataset.raceShare); return; }
  const rwx = e.target.closest('[data-race-wx]');
  if (rwx) { openRaceConditions(rwx.dataset.raceWx); return; }
  const rrm = e.target.closest('[data-race-rm]');
  if (rrm) { unclaimRace(rrm.dataset.raceRm); return; }
  if (e.target.id === 'race-more') { RC.limit += 30; renderRaces(); return; }
  if (e.target.id === 'race-retry') { RC.error = null; loadRaceData(); return; }
  const hf = e.target.closest('[data-hfilter]');
  if (hf) {
    if (histFilter !== hf.dataset.hfilter) { histFilter = hf.dataset.hfilter; renderHistory(); }
    return;
  }
  if (e.target.id === 'edit-lib') {
    selectTab('p-lib');
    $('lib-list').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  // ---- timer ----
  const cSplit = e.target.closest('[data-csplit]');
  if (cSplit) { splitRound(Number(cSplit.dataset.csplit)); return; }
  const cMerge = e.target.closest('[data-cmerge]');
  if (cMerge) { mergeRound(Number(cMerge.dataset.cmerge)); return; }
  // the countdown is skippable by hitting the clock as well as the button - it
  // is the biggest target on the screen and your hands are on the floor
  if (e.target.id === 'tm-clock' && RUN.counting) { startTimer(); return; }
  if (e.target.closest('#tm-go')) { RUN.running ? pauseTimer() : startTimer(); return; }
  if (e.target.id === 'tm-next') { nextStep(); return; }
  if (e.target.id === 'tm-back') { prevStep(); return; }
  if (e.target.id === 'tm-reset') {
    if (RUN.started && !confirm('Start this routine again from round 1? The times recorded so far are lost.')) return;
    stopTimer(); loadRun(RUN.routineId); return;
  }
  if (e.target.id === 'tm-auto') { localStorage.setItem(AUTONEXT_KEY, e.target.checked ? '1' : '0'); return; }
  if (e.target.id === 'core-save') { saveCoreSession(); return; }
  const dw2 = e.target.closest('[data-del-wa]');
  if (dw2) {
    if (!confirm('Delete this water session for good?')) return;
    const { error } = await sb.from('tracker_water_sessions').delete().eq('id', dw2.dataset.delWa);
    if (!error) {
      S.water = S.water.filter(s => s.id !== dw2.dataset.delWa);
      renderHistory(); renderProgress(); renderWaterRecent(); refreshWeekCount();
    }
    return;
  }
  const de = e.target.closest('[data-del-erg]');
  if (de) {
    if (!confirm('Delete this erg session for good?')) return;
    const { error } = await sb.from('tracker_erg_sessions').delete().eq('id', de.dataset.delErg);
    if (!error) { S.ergs = S.ergs.filter(s => s.id !== de.dataset.delErg); renderHistory(); renderProgress(); renderErgRecent(); refreshWeekCount(); }
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) { fillLibForm(exById(ed.dataset.edit)); $('lx-name').focus(); return; }
  const dx = e.target.closest('[data-del-ex]');
  if (dx) { deleteLibExercise(dx.dataset.delEx); return; }
  // ---- squad ----
  const bm = e.target.closest('[data-bmode]');
  if (bm) {
    if (SQ.bmode !== bm.dataset.bmode) { SQ.bmode = bm.dataset.bmode; SQ.metric = ''; renderSquad(); }
    return;
  }
  const bmet = e.target.closest('[data-bmetric]');
  if (bmet) {
    if (SQ.metric !== bmet.dataset.bmetric) { SQ.metric = bmet.dataset.bmetric; renderSquad(); }
    return;
  }
  const bper = e.target.closest('[data-bperiod]');
  if (bper) {
    // the period is a server-side window, so this one has to go back for data
    if (SQ.period !== bper.dataset.bperiod) { SQ.period = bper.dataset.bperiod; refreshSquad(); }
    return;
  }
  if (e.target.id === 'sq-settings') { SQ.settings = !SQ.settings; renderSquad(); return; }
  const tOpen = e.target.closest('[data-tmpl-open]');
  if (tOpen) {
    const id = tOpen.dataset.tmplOpen;
    SQ.preview = SQ.preview === id ? null : id;
    SQ.picked = new Set();
    renderSquad();
    return;
  }
  const tAll = e.target.closest('[data-tmpl-all]');
  if (tAll) {
    const t = SQ.templates.find(x => x.id === tAll.dataset.tmplAll);
    const have = new Set(activeLibrary().map(x => x.name.trim().toLowerCase()));
    SQ.picked = new Set(((t && t.payload && t.payload.exercises) || [])
      .map(x => String(x.name || ''))
      .filter(n => n && !have.has(n.trim().toLowerCase())));
    renderSquad();
    return;
  }
  const tNone = e.target.closest('[data-tmpl-none]');
  if (tNone) { SQ.picked = new Set(); renderSquad(); return; }
  if (e.target.id === 'sq-create') { squadCreate(); return; }
  if (e.target.id === 'sq-join')   { squadJoin(); return; }
  if (e.target.id === 'sq-leave')  { squadLeave(); return; }
  if (e.target.id === 'sq-share-me') { squadToggleSharing(e.target.dataset.group); return; }
  if (e.target.id === 'sq-post')   { squadPostTemplate(); return; }
  if (e.target.id === 'sq-retry')  { SQ.loaded = false; refreshSquad(); return; }
  if (e.target.id === 'sq-add') { SQ.adding = true; renderSquad(); return; }
  if (e.target.id === 'sq-nojoin') {
    localStorage.removeItem(PENDING_JOIN); S.joinCode = null; SQ.adding = false; renderSquad(); return;
  }
  if (e.target.id === 'sq-newcode') {
    const sq = SQ.squads.find(x => x.id === SQ.groupId);
    squadRotateCode(!!(sq && sq.code));
    return;
  }
  if (e.target.id === 'sq-mail')  { squadInvite('mail'); return; }
  if (e.target.id === 'sq-share') { squadInvite('share'); return; }
  if (e.target.id === 'sq-copy')  { squadInvite('copy'); return; }
  const sqRm = e.target.closest('[data-sq-rm]');
  if (sqRm) { squadRemoveMember(sqRm.dataset.sqRm, sqRm.dataset.sqRmname); return; }
  const tg = e.target.closest('[data-tmpl-get]');
  if (tg) { squadImportTemplate(tg.dataset.tmplGet); return; }
  const td = e.target.closest('[data-tmpl-del]');
  if (td) { squadDeleteTemplate(td.dataset.tmplDel); return; }
  if (e.target.id === 'eg-save') { saveErg(); return; }
  if (e.target.id === 'eg-cancel') {
    if (!confirm('Discard this session without saving it?')) return;
    $('erg-form-holder').innerHTML = '';
    clearErgDraft();
    $('erg-parse-status').innerHTML = '';
    return;
  }
});

/* ================= boot ================= */
(async () => {
  // An invite link has to survive sign-in and, for a new account, an email
  // confirmation round trip - so the code is parked locally rather than
  // carried in the URL, and taken out of the address bar so it is not shared
  // on by accident.
  const joinParam = (new URLSearchParams(window.location.search).get('join') || '').trim().toUpperCase();
  if (joinParam) {
    localStorage.setItem(PENDING_JOIN, joinParam);
    history.replaceState(null, '', window.location.pathname);
  }
  S.joinCode = localStorage.getItem(PENDING_JOIN) || null;

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    S.session = session;
  } else if (trialActive()) {
    // Swap the whole data layer for the localStorage one; see js/trial.js.
    sb = trialClient();
    S.trial = true;
    S.session = trialSession();
  } else {
    window.location.replace('login.html');
    return;
  }

  // An account has just appeared over the top of a sample: bring the sample
  // with it before anything is loaded, or the first thing the new account
  // shows is an empty log where the work used to be.
  let migrated = null;
  if (!S.trial && trialActive()) migrated = await migrateTrial();

  const err = await loadAll();
  let fromCache = false;
  if (err) {
    // No connection is not a fatal error - fall back to the last good load so
    // sessions can still be logged and queued. A real error still stops here.
    if (looksOffline({ message: err }) && loadCached()) fromCache = true;
    else {
      $('app-loading').innerHTML = 'Could not load your data: ' + esc(err) +
        '<br><br>If the tracker tables have not been created yet, run tracker/supabase/tracker_schema.sql in the Supabase SQL editor.';
      return;
    }
  } else {
    cacheData();
  }

  $('whoami').textContent = S.trial ? 'Sample'
    : ((S.profile && S.profile.display_name) || S.session.user.email || '');
  $('signout').textContent = S.trial ? 'Leave sample' : 'Sign out';
  paintTrialBar();
  if (!S.trial) stampTerms();
  $('log-date').value = todayISO();
  $('core-date').value = todayISO();
  renderLog(); renderErgGate(); renderErgRecent(); renderWaterTab(); renderCoreTab();
  renderProgress(); renderHistory(); renderLibrary(); renderRoutines(); renderRaces();
  restoreErgForm();
  paintSyncBadge();
  if (fromCache) {
    toast('log-msg', 'No connection - showing your training log from this device. ' +
      'Anything you log now is kept here and syncs when you are back online.', 'warn');
  }
  if (migrated && migrated.error) {
    toast('log-msg', 'Your sample is still on this device but could not be uploaded: ' +
      esc(migrated.error) + ' It will try again next time you open the tracker.', 'err');
  } else if (migrated) {
    const n = migrated.weights + migrated.erg + migrated.water + migrated.core;
    toast('log-msg', 'Welcome in. ' + (n
      ? 'The ' + n + ' session' + (n === 1 ? '' : 's') + ' you logged as a sample ' +
        (n === 1 ? 'is' : 'are') + ' now saved to your account, along with your exercises.'
      : 'Your sample exercise library has been saved to your account.'));
  }
  // Rows flushed at boot are on the server but not in what was just loaded, so
  // pull again rather than leaving the athlete looking at a log that is missing
  // the session they logged offline.
  flushOutbox(true).then(async n => {
    if (!n) return;
    const e2 = await loadAll();
    if (e2) return;
    cacheData();
    renderLog(snapshotLog()); renderErgRecent();
    renderProgress(); renderHistory(); refreshWeekCount();
  });

  $('app-loading').style.display = 'none';
  $('app').style.display = '';
  // Boot got here, so the fast signed-out redirect in index.html is free to
  // fire again next time.
  sessionStorage.removeItem('rt-bounced');

  // Arrived on an invite link: open the tab that can act on it rather than
  // leaving the code sitting in storage with nothing to show for it.
  if (S.joinCode && !S.trial) { selectTab('p-squad'); SQ.adding = true; refreshSquad(); }

  // tabs
  document.querySelectorAll('.tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      selectTab(tab.dataset.panel);
      // the chart is sized in real pixels, so it can only be drawn once its
      // panel is on screen and has a width
      if (tab.dataset.panel === 'p-prog') renderProgress();
      // squads are a network round trip, so they load on first visit rather
      // than slowing every boot down for a feature most sessions never touch
      if (tab.dataset.panel === 'p-squad') refreshSquad();
      // The leaderboard file is ~800KB. Fetched on the first visit to this tab
      // and never on boot, so a tracker that only logs training never pays for it.
      if (tab.dataset.panel === 'p-races') { renderRaces(); loadRaceData(); }
      // A running timer must not survive leaving the tab, or it keeps counting
      // and holding the wake lock against a circuit that has been walked away from.
      if (tab.dataset.panel !== 'p-core') { cancelCountdown(); if (RUN.running) pauseTimer(); }
    });
  });

  // A date change re-derives every "last time" line, so the log rebuilds -
  // picking up whatever draft belongs to the date you moved to. While amending
  // a saved session the date is part of what is being edited, so keep the sets.
  $('log-date').onchange = () => renderLog(editingWorkoutId ? snapshotLog() : null);
  $('save-btn').onclick = saveWorkout;
  $('signout').onclick = async () => {
    if (S.trial && !confirm('Leave the sample?' + String.fromCharCode(10, 10) +
        'Everything you logged here is on this device only and will be deleted. ' +
        'Creating an account instead keeps the lot.')) return;
    await sb.auth.signOut();
    window.location.replace('login.html');
  };

  $('erg-photo-btn').onclick = () => $('erg-file').click();
  $('erg-file').onchange = () => { if ($('erg-file').files[0]) { handleErgPhoto($('erg-file').files[0]); $('erg-file').value = ''; } };
  $('erg-manual-btn').onclick = () => { openErgForm(null, 'manual'); saveErgDraft(); };

  // The water form is rebuilt with its panel, so its button is wired by
  // delegation rather than by id at boot.
  document.addEventListener('click', ev => { if (ev.target.id === 'wt-save') saveWater(); });

  $('core-pick').onchange = () => loadRun($('core-pick').value);
  $('core-edit-rt').onclick = () => {
    const r = routineById($('core-pick').value);
    // No routine picked means there are none: open the builder on a blank one,
    // which is what someone standing on an empty Core tab actually wants.
    editingRoutine = r
      ? { id: r.id, name: r.name, steps: stepsOf(r).map(s => ({ ...s })) }
      : { id: null, name: '', steps: [{ name: '', target_s: 60 }] };
    renderRoutines();
    selectTab('p-lib');
    $('rt-builder').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('rt-new').onclick = () => {
    editingRoutine = { id: null, name: '', steps: [{ name: '', target_s: 60 }] };
    renderRoutines();
  };

  // The squad panel is rebuilt wholesale on every change, so its selects are
  // wired by delegation rather than by id.
  document.addEventListener('change', ev => {
    if (ev.target.id === 'squad-pick')   { SQ.groupId = ev.target.value; refreshSquad(); }
    if (ev.target.id === 'race-comp') { RC.comp = ev.target.value; RC.limit = 30; renderRaces(); }
    // Ticking an exercise in a shared template. Held in memory only - it is a
    // selection, not a setting, and it dies with the preview.
    if (ev.target.dataset && ev.target.dataset.tmplPick !== undefined) {
      SQ.picked = SQ.picked || new Set();
      if (ev.target.checked) SQ.picked.add(ev.target.dataset.tmplPick);
      else SQ.picked.delete(ev.target.dataset.tmplPick);
      renderSquad();
    }
  });
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (document.getElementById('p-prog').classList.contains('active')) renderProgress();
    }, 250);
  });

  // Last line of defence for the drafts: a phone can kill the tab without ever
  // firing another input event.
  const flushDrafts = () => { clearTimeout(draftTimer); clearTimeout(ergDraftTimer); saveDraft(); saveErgDraft(); };
  window.addEventListener('beforeunload', flushDrafts);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushDrafts(); });
  window.addEventListener('online', () => flushOutbox(true));

  $('lx-save').onclick = saveLibExercise;
  $('lx-cancel').onclick = () => fillLibForm(null);
  $('tmpl-dl').onclick = downloadTemplate;
  $('tmpl-ul').onclick = () => $('tmpl-file').click();
  $('tmpl-file').onchange = () => { if ($('tmpl-file').files[0]) { uploadTemplate($('tmpl-file').files[0]); $('tmpl-file').value = ''; } };
})();
