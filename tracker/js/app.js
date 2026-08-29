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
  routines: [],    // core routine templates
  coreSessions: [],// logged runs through a core routine
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
  const logged = c.weights + c.erg + c.core;
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
  for (const t of ['tracker_exercises', 'tracker_core_routines',
                   'tracker_workouts', 'tracker_erg_sessions', 'tracker_core_sessions']) {
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
  const [prof, ex, wk, erg, rt, core] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).single(),   // carries tracker_plan
    sb.from('tracker_exercises').select('*').order('position').order('created_at'),
    sb.from('tracker_workouts').select('*').order('date', { ascending: false }).limit(1000),
    sb.from('tracker_erg_sessions').select('*').order('date', { ascending: false }).limit(1000),
    sb.from('tracker_core_routines').select('*').order('position').order('created_at'),
    sb.from('tracker_core_sessions').select('*').order('date', { ascending: false }).limit(1000),
  ]);
  S.profile = prof.data;
  S.exercises = ex.data || [];
  S.workouts = sortDesc(wk.data || []);
  S.ergs = sortDesc(erg.data || []);
  S.routines = (rt.data || []).filter(r => !r.retired).concat((rt.data || []).filter(r => r.retired));
  S.coreSessions = sortDesc(core.data || []);
  const errs = [prof.error, ex.error, wk.error, erg.error, rt.error, core.error].filter(Boolean);
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
    coreSessions: S.coreSessions.slice(0, CACHE_SESSIONS),
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
  S.coreSessions = sortDesc(c.coreSessions || []);
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

// Exercises in the order they were last actually done. With a big library this
// is the row you use; the session groups below it are for everything else.
function recentExercises(lib, limit) {
  const seen = [], byId = new Set(lib.map(e => e.id));
  for (const w of S.workouts) {
    for (const id of Object.keys(w.sets)) {
      if (byId.has(id) && !seen.includes(id)) seen.push(id);
    }
    if (seen.length >= limit) break;
  }
  return seen.slice(0, limit).map(exById);
}

const chipHTML = e => '<button class="chip" aria-pressed="false" data-chip="' + e.id + '">' + esc(e.name) + '</button>';

function renderLog(snap) {
  const lib = activeLibrary();
  const chipsEl = $('chips');

  if (!lib.length) {
    chipsEl.innerHTML = '<p class="placeholder">No exercises yet - set up your library in the <b>Templates</b> tab first (or upload a crewmate\'s template there).</p>';
  } else {
    const recent = recentExercises(lib, 10);
    const recentHTML = recent.length
      ? '<div class="picker-session">Recent</div>' +
        '<div class="picker-row"><span class="rowlab">last used</span><div class="chips">' +
        recent.map(chipHTML).join('') + '</div></div>'
      : '';
    const groupings = allGroups(lib);
    chipsEl.innerHTML = recentHTML + groupings.map(g => {
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
  const cores = S.coreSessions.filter(s => mondayOf(s.date) === wk).length;
  const today = S.workouts.filter(s => s.date === date).length;
  $('weekcount').innerHTML = 'Week of ' + prettyDate(wk) + ' - <b>' + weights + '</b> weights · <b>' +
    ergs + '</b> erg' + (cores ? ' · <b>' + cores + '</b> core' : '') +
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
    renderLog(); renderSummary(); renderProgress(); renderHistory();
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
  renderSummary(); renderProgress(); renderHistory();
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
  renderErgRecent(); renderSummary(); renderHistory(); refreshWeekCount();
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
function canReadPhotos() {
  if (S.trial) return false;      // every parse costs money; a sample cannot spend it
  const p = S.profile || {};
  if (p.tracker_plan === 'paid') return true;
  return p.tracker_plan === 'trial' && p.tracker_trial_ends_at
    && new Date(p.tracker_trial_ends_at) > new Date();
}

function renderErgGate() {
  const wrap = $('erg-gate');
  if (!wrap) return;
  if (canReadPhotos()) {
    $('erg-photo-btn').disabled = false;
    $('erg-photo-btn').title = '';
    wrap.innerHTML = '';
    return;
  }
  $('erg-photo-btn').disabled = true;
  $('erg-photo-btn').title = S.trial ? 'Needs an account' : 'Part of the £5/month plan';
  wrap.innerHTML = S.trial
    ? '<div class="gate"><b>Reading erg photos needs an account.</b>' +
      '<span>Every photo is read by an AI model and costs real money per picture, so it is the ' +
      'one thing the sample cannot do. <b>Enter manually</b> works exactly as it will once you ' +
      'sign up.</span></div>'
    : '<div class="gate"><b>Reading erg photos is part of the £5/month plan.</b>' +
      '<span>Logging weights and typing erg sessions in by hand is free, and always unlimited. ' +
      'The photo reader turns a picture of the monitor into a full session, splits and all.</span></div>';
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
    // 402 = not on the plan, 429 = over quota. Both are expected states with a
    // useful message, not crashes, so don't dress them up as errors.
    const kind = (resp.status === 402 || resp.status === 429) ? 'warn' : 'err';
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
  $('core-edit-rt').disabled = !live.length;

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
  renderHistory(); renderSummary();
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

function renderSummary() {
  const el = $('sum-body');
  const weeks = weeklyStats(), ergWeeks = ergWeekly(), coreWeeks = coreWeekly();
  const keys = [...new Set([...Object.keys(weeks), ...Object.keys(ergWeeks), ...Object.keys(coreWeeks)])].sort().reverse();
  if (!keys.length) {
    el.innerHTML = '<p class="empty">Nothing to summarise yet - log a session first.</p>';
    return;
  }

  el.innerHTML = keys.map((w, wi) => {
    const wk = weeks[w], eg = ergWeeks[w], cw = coreWeeks[w];
    const prevKey = keys.slice(wi + 1).find(k => weeks[k]), prev = prevKey ? weeks[prevKey] : null;
    const total = (wk ? wk.n : 0) + (eg ? eg.n : 0) + (cw ? cw.n : 0);

    const strip = '<div class="sum-strip">' +
      statCell('Weights', wk ? wk.n : '–', '', wk ? wk.sets + ' sets' : 'none logged', !wk) +
      statCell('Erg', eg ? round1(eg.km) : '–', eg ? 'km' : '',
        eg ? eg.n + (eg.n === 1 ? ' session · ' : ' sessions · ') + fmtHM(eg.min) : 'none logged', !eg) +
      statCell('Core', cw ? fmtHM(cw.min) : '–', '',
        cw ? cw.n + (cw.n === 1 ? ' session' : ' sessions') : 'none logged', !cw) +
      '</div>';

    let table = '';
    if (wk) {
      const ids = Object.keys(wk.ex).sort((a, b) =>
        patIdx(patternOf(a)) - patIdx(patternOf(b)) || exName(a).localeCompare(exName(b)));
      const pats = [...new Set(ids.map(patternOf))];
      table = '<table class="sumtbl"><thead><tr><th>Exercise</th>' +
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

    return '<section class="sumweek">' +
      '<div class="sum-head"><h4>' + shortDate(w) + ' - ' + shortDate(addDays(w, 6)) + '</h4>' +
      '<span class="sum-count">' + total + ' session' + (total === 1 ? '' : 's') + '</span></div>' +
      strip + table + '</section>';
  }).join('') +
  '<footer class="footer" style="margin-top:1rem"><span>Averages are per set across the week. ' +
  '×n = sessions the exercise appeared in; the arrow compares average load with the previous week you lifted.</span></footer>';
}

/* ================= progress =================
   Three things get plotted here and they are not the same shape, so the tab
   switches between them rather than stacking them:
     Weights - one lift, one measure, a line by session.
     Erg and Core - weekly load as bars, because "am I getting through more"
     is a question about weeks, not about single sessions.
   Never two measures on one axis. Session tonnage is gone on purpose: it moves
   when the rep scheme changes and says nothing about whether you got stronger. */
const PROG = { mode: 'weights', ex: '', metric: '', weeks: '12' };

const REP_METRICS = [
  { k: 'top',  label: 'Heaviest set',  unit: 'kg' },
  { k: 'e1rm', label: 'Estimated 1RM', unit: 'kg' },
];
const SEC_METRICS = [
  { k: 'top',    label: 'Longest hold',   unit: 's' },
  { k: 'volume', label: 'Total time held', unit: 's' },
];
const metricsFor = m => (m && m.unit === 'secs') ? SEC_METRICS : REP_METRICS;
// Epley. Named on the chart, because an estimate presented as a measurement is
// worse than no estimate.
const e1rm = (w, reps) => w * (1 + reps / 30);

// dp is the precision the number is SHOWN at; week-on-week change is computed
// from the rounded figures so the table can never read "8m, 8m, +0.1".
const ERG_METRICS = [
  { k: 'km',  label: 'Distance a week', col: 'Distance', dp: 1,
    fmt: v => round1(v) + ' km', short: v => round1(v) + ' km' },
  { k: 'min', label: 'Time a week',     col: 'Time',     dp: 0,
    fmt: v => fmtHM(v), short: v => fmtHM(v) },
  { k: 'n',   label: 'Sessions a week', col: 'Sessions', dp: 0,
    fmt: v => Math.round(v) + (v === 1 ? ' session' : ' sessions'), short: v => String(Math.round(v)) },
];
const CORE_METRICS = [
  { k: 'min', label: 'Time working a week', col: 'Working',  dp: 0,
    fmt: v => fmtHM(v), short: v => fmtHM(v) },
  { k: 'n',   label: 'Sessions a week',     col: 'Sessions', dp: 0,
    fmt: v => Math.round(v) + (v === 1 ? ' session' : ' sessions'), short: v => String(Math.round(v)) },
];
const WEEK_RANGES = [
  { k: '8',   label: 'Last 8 weeks' },
  { k: '12',  label: 'Last 12 weeks' },
  { k: '26',  label: 'Last 26 weeks' },
  { k: 'all', label: 'All time' },
];

const weeklyMetrics = mode => mode === 'core' ? CORE_METRICS : ERG_METRICS;
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
function weeklySeries(mode, metricKey, range) {
  const agg = mode === 'core' ? coreWeekly() : ergWeekly();
  const logged = Object.keys(agg).sort();
  if (!logged.length) return [];
  const end = thisMonday();
  let start = range === 'all' ? logged[0] : addDays(end, -7 * (parseInt(range, 10) - 1));
  if (start < logged[0]) start = logged[0];
  if (start > end) start = end;
  const out = [];
  for (let w = start; w <= end; w = addDays(w, 7)) {
    const a = agg[w] || { n: 0, km: 0, min: 0 };
    out.push({ date: w, v: round1(a[metricKey] || 0), n: a.n });
  }
  return out;
}

// plotted point positions, for the hover layer
let chartPts = [];

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

// Weekly load is a count per bucket, not a reading on a curve, so it gets bars
// and a zero baseline. The line over the top is a four-week mean: week to week
// is noise, and the trend is the thing you actually want off this chart.
function barsHTML(pts, metric, W) {
  const H = 250, P = { t: 26, r: 14, b: 30, l: 46 };
  const iw = Math.max(40, W - P.l - P.r), ih = H - P.t - P.b;
  const vs = pts.map(p => p.v);
  const hi = Math.max(...vs, 0);
  const step = niceStep(hi || 1);
  const y1 = Math.max(step, Math.ceil(hi / step) * step);
  const Y = v => P.t + ih - (v / y1) * ih;
  const slot = iw / pts.length;
  const bw = Math.max(3, Math.min(38, slot * 0.66));
  const cx = i => P.l + slot * (i + 0.5);

  const grid = [];
  for (let v = 0; v <= y1 + 1e-9; v += step) {
    grid.push('<line class="cgrid" x1="' + P.l + '" y1="' + Y(v).toFixed(1) + '" x2="' + (P.l + iw) + '" y2="' + Y(v).toFixed(1) + '"/>' +
      '<text class="ctick" x="' + (P.l - 8) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + round1(v) + '</text>');
  }

  const bars = pts.map((p, i) => {
    const h = Math.max(p.v > 0 ? 2 : 0, ih - (Y(p.v) - P.t));
    return '<rect class="cbar' + (p.v ? '' : ' zero') + (i === pts.length - 1 ? ' last' : '') + '" x="' +
      (cx(i) - bw / 2).toFixed(1) + '" y="' + (P.t + ih - h).toFixed(1) +
      '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '"/>';
  }).join('');

  // four-week mean, drawn only once there is enough series to mean anything
  let trend = '';
  if (pts.length >= 5) {
    const roll = pts.map((_, i) => {
      const from = Math.max(0, i - 3);
      const win = vs.slice(from, i + 1);
      return win.reduce((a, x) => a + x, 0) / win.length;
    });
    trend = '<path class="ctrend" d="' + roll.map((v, i) =>
      (i ? 'L' : 'M') + cx(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ') + '"/>';
  }

  // one x label roughly every fifth bar, always including the last week
  const every = Math.max(1, Math.ceil(pts.length / 5));
  const xlabs = pts.map((p, i) => {
    if (i !== pts.length - 1 && (pts.length - 1 - i) % every) return '';
    return '<text class="ctick" x="' + cx(i).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle">' +
      shortDate(p.date) + '</text>';
  }).join('');

  chartPts = pts.map((p, i) => ({
    x: +cx(i).toFixed(1), y: +Y(p.v).toFixed(1),
    lab: 'Week of ' + shortDate(p.date),
    val: metric.fmt(p.v),
    sub: p.v ? '' : 'nothing logged',
  }));

  return '<div class="chartwrap" id="chartwrap">' +
    '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Weekly training load; the same numbers are in the table below">' +
      grid.join('') + bars + trend +
      '<line class="caxis" x1="' + P.l + '" y1="' + (P.t + ih) + '" x2="' + (P.l + iw) + '" y2="' + (P.t + ih) + '"/>' +
      '<line class="ccross" id="ch-cross" x1="0" y1="' + P.t + '" x2="0" y2="' + (P.t + ih) + '" style="display:none"/>' +
      '<circle class="cdot-hi" id="ch-hi" cx="0" cy="0" r="5.5" style="display:none"/>' +
      xlabs +
      '<rect id="ch-hit" x="' + P.l + '" y="' + P.t + '" width="' + iw + '" height="' + ih + '" fill="transparent"/>' +
    '</svg><div class="ctip" id="ch-tip" style="display:none"></div></div>';
}

const tileHTML = (lab, val, note, cls) =>
  '<div class="tile"><div class="tile-lab">' + lab + '</div>' +
  '<div class="tile-val' + (cls ? ' ' + cls : '') + '">' + val + '</div>' +
  '<div class="tile-note">' + note + '</div></div>';

/* ---- controls ---- */
function progControlsHTML() {
  const seg = ['weights', 'erg', 'core'].map(k =>
    '<button class="seg' + (PROG.mode === k ? ' active' : '') + '" data-pmode="' + k + '" ' +
    'role="tab" aria-selected="' + (PROG.mode === k) + '">' + cap(k) + '</button>').join('');
  let rest = '';
  if (PROG.mode === 'weights') {
    const done = new Set();
    S.workouts.forEach(w => Object.keys(w.sets).forEach(id => done.add(id)));
    const opts = S.exercises.filter(e => done.has(e.id));
    if (opts.length) {
      if (!opts.some(e => e.id === PROG.ex)) PROG.ex = opts[0].id;
      const metrics = metricsFor(exById(PROG.ex));
      if (!metrics.some(x => x.k === PROG.metric)) PROG.metric = metrics[0].k;
      rest =
        '<select id="prog-pick" aria-label="Exercise">' + opts.map(e =>
          '<option value="' + e.id + '"' + (e.id === PROG.ex ? ' selected' : '') + '>' +
          esc(e.name) + (e.retired ? ' (retired)' : '') + '</option>').join('') + '</select>' +
        '<select id="prog-metric" aria-label="Measure">' + metrics.map(x =>
          '<option value="' + x.k + '"' + (x.k === PROG.metric ? ' selected' : '') + '>' +
          x.label + '</option>').join('') + '</select>';
    }
  } else {
    const metrics = weeklyMetrics(PROG.mode);
    if (!metrics.some(x => x.k === PROG.metric)) PROG.metric = metrics[0].k;
    rest =
      '<select id="prog-metric" aria-label="Measure">' + metrics.map(x =>
        '<option value="' + x.k + '"' + (x.k === PROG.metric ? ' selected' : '') + '>' +
        x.label + '</option>').join('') + '</select>' +
      '<select id="prog-weeks" aria-label="Range">' + WEEK_RANGES.map(r =>
        '<option value="' + r.k + '"' + (r.k === PROG.weeks ? ' selected' : '') + '>' +
        r.label + '</option>').join('') + '</select>';
  }
  return '<div class="segmented" role="tablist" aria-label="What to chart">' + seg + '</div>' +
    (rest ? '<div class="progbar">' + rest + '</div>' : '');
}

function renderProgress() {
  const body = $('prog-body'), ctl = $('prog-controls');
  if (!body || !ctl) return;
  ctl.innerHTML = progControlsHTML();
  if (PROG.mode === 'weights') renderProgWeights(body);
  else renderProgWeekly(body);
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
  const label = PROG.mode === 'erg' ? 'Erg' : 'Core';
  const metric = pickMetric(weeklyMetrics(PROG.mode), PROG.metric);
  const pts = weeklySeries(PROG.mode, metric.k, PROG.weeks);
  const head = '<div class="prog-head"><h3 class="prog-title">' + label + ' load</h3>' +
    '<span class="prog-sub">' + esc(metric.label) + ', Monday to Sunday' +
    (pts.length >= 5 ? ' · the line is a four-week average' : '') + '</span></div>';

  if (!pts.length) {
    body.innerHTML = head + '<p class="empty">No ' + label.toLowerCase() +
      ' sessions logged yet. Anything you record on the ' + label +
      ' tab shows up here as weekly load.</p>';
    return;
  }

  const vs = pts.map(p => p.v);
  const last = pts[pts.length - 1];
  const hi = Math.max(...vs), hiAt = pts[vs.indexOf(hi)];
  const avg = vs.reduce((a, x) => a + x, 0) / vs.length;
  // this week against the mean of the weeks before it, which is the comparison
  // you are actually making when you look at a load chart
  const before = vs.slice(0, -1);
  const prevAvg = before.length ? before.reduce((a, x) => a + x, 0) / before.length : null;
  const diff = prevAvg == null ? null : round1(last.v - prevAvg);
  const weeksOn = vs.filter(v => v > 0).length;

  // a difference that rounds away at the displayed precision is not a difference
  const f = Math.pow(10, metric.dp);
  const shownDiff = diff == null ? null : Math.round(diff * f) / f;
  const tiles = '<div class="prog-tiles">' +
    tileHTML('This week', metric.fmt(last.v),
      shownDiff == null ? 'first week logged'
        : shownDiff === 0 ? 'level with your average'
        : (shownDiff > 0 ? '+' : '-') + metric.short(Math.abs(shownDiff)) + ' on your average',
      !shownDiff ? '' : shownDiff > 0 ? 'up' : 'down') +
    tileHTML('Weekly average', metric.fmt(avg), weeksOn + ' of ' + pts.length + ' weeks trained') +
    tileHTML('Best week', metric.fmt(hi), shortDate(hiAt.date)) +
    '</div>';

  const chart = barsHTML(pts, metric, Math.max(300, body.clientWidth || 620)) +
    '<p class="chart-note">Tap or hover a bar for the week. Empty weeks are shown, not skipped.</p>';

  const agg = PROG.mode === 'core' ? coreWeekly() : ergWeekly();
  const shown = v => Math.round(v * f) / f;
  const rows = [...pts].reverse().map((p, i, arr) => {
    const prev = arr[i + 1];
    const d = prev ? round1(shown(p.v) - shown(prev.v)) : null;
    const a = agg[p.date] || { n: 0, km: 0, min: 0 };
    const detail = a.n
      ? a.n + (a.n === 1 ? ' session · ' : ' sessions · ') +
        (PROG.mode === 'erg' ? round1(a.km) + ' km · ' + fmtHM(a.min) : fmtHM(a.min) + ' working')
      : 'nothing logged';
    return '<tr' + (p.v ? '' : ' class="offweek"') + '><td>' + shortDate(p.date) + ' - ' + shortDate(addDays(p.date, 6)) + '</td>' +
      '<td class="n">' + esc(metric.short(p.v)) + '</td>' +
      '<td class="n">' + (d === null || d === 0 ? '<span class="na">–</span>'
        : '<span class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '') + round1(d) + '</span>') + '</td>' +
      '<td class="dim">' + esc(detail) + '</td></tr>';
  }).join('');
  const table = '<div class="dtbl-wrap"><table class="dtbl prog-tbl">' +
    '<thead><tr><th>Week</th><th class="n">' + esc(metric.col) + '</th>' +
    '<th class="n">Change</th><th>Detail</th></tr></thead><tbody>' +
    rows + '</tbody></table></div>';

  body.innerHTML = head + tiles + chart + table;
  wireChart();
}

// Crosshair + tooltip. A chart on a page is interactive by default; the hit
// target is the whole plot, not the dots.
function wireChart() {
  const wrap = $('chartwrap');
  if (!wrap || !chartPts.length) return;
  const pts = chartPts;
  const hit = $('ch-hit'), cross = $('ch-cross'), hi = $('ch-hi'), tip = $('ch-tip');
  const move = ev => {
    const r = wrap.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    let near = pts[0];
    pts.forEach(p => { if (Math.abs(p.x - px) < Math.abs(near.x - px)) near = p; });
    cross.setAttribute('x1', near.x); cross.setAttribute('x2', near.x);
    cross.style.display = ''; hi.style.display = '';
    hi.setAttribute('cx', near.x); hi.setAttribute('cy', near.y);
    tip.innerHTML = '<span class="tdate">' + esc(near.lab) + '</span><br><b>' + esc(near.val) + '</b>' +
      (near.sub ? '<br><span class="tsub">' + esc(near.sub) + '</span>' : '');
    tip.style.display = '';
    tip.style.left = Math.min(r.width - 8, Math.max(8, near.x)) + 'px';
    tip.style.top = (near.y - 12) + 'px';
  };
  const leave = () => { cross.style.display = 'none'; hi.style.display = 'none'; tip.style.display = 'none'; };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
}

/* ================= history =================
   A ruled list, one line per session, grouped by week. Date, discipline and a
   one-line summary line up in columns down the page so a month of training can
   be read without opening anything; the detail is one tap away. */
function renderHistory() {
  const el = $('hist-body');
  const all = [
    ...S.workouts.map(r => ({ kind: 'w', r })),
    ...S.ergs.map(r => ({ kind: 'e', r })),
    ...S.coreSessions.map(r => ({ kind: 'c', r })),
  ];
  if (!all.length) {
    el.innerHTML = '<p class="empty">No sessions logged yet. Whatever you record on the ' +
      'Weights, Erg and Core tabs lands here, newest first.</p>';
    return;
  }

  const weeks = {};
  all.forEach(x => { const w = mondayOf(x.r.date); (weeks[w] = weeks[w] || []).push(x); });

  el.innerHTML = Object.keys(weeks).sort().reverse().map(w => {
    const items = weeks[w].sort((a, b) => sortKey(b.r).localeCompare(sortKey(a.r)));
    const n = { w: 0, e: 0, c: 0 };
    items.forEach(x => n[x.kind]++);
    const counts = [[n.w, 'weights'], [n.e, 'erg'], [n.c, 'core']]
      .filter(([c]) => c).map(([c, l]) => c + ' ' + l).join(' · ');
    return '<section class="weekgroup"><h4><span class="wg-when">' +
      shortDate(w) + ' - ' + shortDate(addDays(w, 6)) + '</span>' +
      '<span class="wg-count">' + counts + '</span></h4>' +
      items.map(x => x.kind === 'w' ? histWorkoutHTML(x.r)
                   : x.kind === 'c' ? histCoreHTML(x.r) : histErgHTML(x.r)).join('') +
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
  board: [], templates: [],
  period: '4w', metric: 'days_trained', busy: false, adding: false, posting: false,
};

const PERIODS = [
  { k: 'week', label: 'This week' },
  { k: '4w',   label: 'Last 4 weeks' },
  { k: '12w',  label: 'Last 12 weeks' },
  { k: 'all',  label: 'All time' },
];

// Consistency first, volume second, and on purpose. A board topped by whoever
// erged the most metres rewards junk volume and punishes the athlete on a
// taper; "days trained" is the number that actually reflects turning up, and
// it is far harder to inflate than a distance you type in yourself.
const METRICS = [
  { k: 'days_trained',     label: 'Days trained',      unit: '',    group: 'Consistency' },
  { k: 'sessions_total',   label: 'Sessions',          unit: '',    group: 'Consistency' },
  { k: 'erg_metres',       label: 'Erg metres',        unit: 'm',   group: 'Erg' },
  { k: 'erg_seconds',      label: 'Erg time',          unit: 'time',group: 'Erg' },
  { k: 'sessions_erg',     label: 'Erg sessions',      unit: '',    group: 'Erg' },
  { k: 'core_work_s',      label: 'Core time working', unit: 'time',group: 'Core' },
  { k: 'sessions_core',    label: 'Core sessions',     unit: '',    group: 'Core' },
  { k: 'weights_sets',     label: 'Weights sets',      unit: '',    group: 'Weights' },
  { k: 'weights_volume',   label: 'Weights volume',    unit: 'kg',  group: 'Weights' },
  { k: 'sessions_weights', label: 'Weights sessions',  unit: '',    group: 'Weights' },
];
const metricBy = k => METRICS.find(m => m.k === k) || METRICS[0];

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
  SQ.templates = tmpl.error ? [] : (tmpl.data || []);
  SQ.boardError = board.error ? board.error.message : null;
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
  const p = $('squad-period'); if (p) p.value = SQ.period;
  const m = $('squad-metric'); if (m) m.value = SQ.metric;
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
  const metric = metricBy(SQ.metric);
  const me = S.session.user.id;
  const isAdmin = !!(sq && sq.role === 'admin');
  const sharing = SQ.sharing.has(SQ.groupId);

  const rows = SQ.board.filter(r => r.sharing);
  const quiet = SQ.board.filter(r => !r.sharing);
  rows.sort((a, b) => (Number(b[metric.k]) || 0) - (Number(a[metric.k]) || 0));
  const top = Math.max(...rows.map(r => Number(r[metric.k]) || 0), 0);

  // Only an admin can remove anyone, and never themselves - leaving is the
  // way out for you. Matches tracker_admin_remove_member().
  const rmBtn = r => (isAdmin && r.profile_id !== me)
    ? '<button class="brm" data-sq-rm="' + r.profile_id + '" data-sq-rmname="' + esc(r.display_name) +
      '">remove</button>' : '';

  const board = SQ.boardError
    ? '<div class="toast err">Could not load the board: ' + esc(SQ.boardError) + '</div>'
    : !SQ.board.length
    ? '<p class="empty">Nobody in this squad yet.</p>'
    : '<div class="bhead"><span>#</span><span>Athlete</span><span class="r">' +
        esc(metric.label) + '</span></div>' +
      rows.map((r, i) => {
          const v = Number(r[metric.k]) || 0;
          return '<div class="brow' + (i ? '' : ' lead') + (r.profile_id === me ? ' me' : '') +
            (v ? '' : ' zero') + '">' +
            '<span class="brank">' + (i + 1) + '</span>' +
            '<span class="bname">' + esc(r.display_name) + '</span>' +
            '<span class="bval">' + fmtMetric(v, metric.unit) +
              (metric.unit && metric.unit !== 'time' ? '<small>' + metric.unit + '</small>' : '') + '</span>' +
            '<span class="bsub">' + r.days_trained + ' day' + (r.days_trained === 1 ? '' : 's') + ' · ' +
              r.sessions_weights + ' weights · ' + r.sessions_erg + ' erg · ' + r.sessions_core + ' core</span>' +
            rmBtn(r) +
            '<span class="bbar"><i style="width:' + (top ? Math.round((v / top) * 100) : 0) + '%"></i></span>' +
          '</div>';
        }).join('') +
        // Anyone here predates sharing-follows-membership and has not had the
        // backfill run over them yet. Yours is fixable from here; other
        // people's is theirs to fix.
        (quiet.length ? quiet.map(r =>
          '<div class="brow bquiet' + (r.profile_id === me ? ' me' : '') + '">' +
            '<span class="brank">–</span>' +
            '<span class="bname">' + esc(r.display_name) + '</span>' +
            '<span class="bval">–</span>' +
            '<span class="bsub">not on the board' +
              (r.profile_id === me
                ? ' <button class="blink" id="sq-share-me" data-group="' + SQ.groupId + '">show my totals</button>'
                : '') + '</span>' +
            rmBtn(r) + '</div>').join('') : '');

  return '<div class="setup-sec">' +
    '<div class="squad-bar">' +
      '<select id="squad-pick">' + SQ.squads.map(s =>
        '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('') + '</select>' +
      '<button id="sq-add">+ Join another</button>' +
    '</div>' +

    // Getting someone in is the thing this tab is for, so it is the first
    // thing on it - link, email or the phone's own share sheet, all carrying
    // the same code.
    (sq && sq.code
      ? '<div class="invite">' +
          '<div class="inv-code">Invite code <b>' + esc(sq.code) + '</b></div>' +
          '<div class="inv-acts">' +
            '<button id="sq-mail">Invite by email</button>' +
            (navigator.share ? '<button id="sq-share">Share&hellip;</button>' : '') +
            '<button id="sq-copy">Copy link</button>' +
          '</div>' +
          '<p class="inv-note">Anyone with the link or the code can join, and joining puts them on ' +
            'this board. Email opens your own mail app with the link in it.</p>' +
        '</div>'
      : '<p class="squad-code">No invite code on this squad.</p>') +

    '<div class="boardctl">' +
      '<select id="squad-metric">' +
        [...new Set(METRICS.map(m => m.group))].map(g =>
          '<optgroup label="' + g + '">' + METRICS.filter(m => m.group === g).map(m =>
            '<option value="' + m.k + '">' + m.label + '</option>').join('') + '</optgroup>').join('') +
      '</select>' +
      '<select id="squad-period">' + PERIODS.map(p =>
        '<option value="' + p.k + '">' + p.label + '</option>').join('') + '</select>' +
    '</div>' +
    board +
    // What sharing means, said once, in one paragraph. Being in the squad is
    // being on the board; leaving is how you take yourself off it.
    '<p class="squad-note">' + rows.length + ' of ' + SQ.board.length + ' on the board · ' +
      esc(metricBy(SQ.metric).label) + ', ' +
      esc((PERIODS.find(p => p.k === SQ.period) || {}).label || '').toLowerCase() + '.<br>' +
      'Everyone here sees your <b>totals</b> - days trained, sessions, erg metres and time, core ' +
      'time, weights sets and volume. Never a session, a lift, a date or a note. ' +
      (sharing ? 'Leave the squad and your numbers go with you. ' : '') +
      'They are self-reported: they show who is putting the work in, not who is fastest.' +
      '<br><button class="blink" id="sq-leave">Leave ' + esc((sq && sq.name) || 'this squad') + '</button>' +
      (isAdmin ? ' · you started this squad, so you can remove people from it' : '') +
    '</p>' +
    '<div id="squad-msg"></div>' +
  '</div>' + squadTemplatesHTML();
}

function squadTemplatesHTML() {
  return '<div class="setup-sec"><h3 class="setup-head">Shared templates</h3>' +
    '<p class="setup-intro">Post your exercise library so the rest of the squad can pick it up, ' +
    'or take someone else\'s. Importing adds anything you do not already have and never overwrites ' +
    'your own setup.</p>' +
    (SQ.templates.length
      ? SQ.templates.map(t => {
          const n = (t.payload && Array.isArray(t.payload.exercises)) ? t.payload.exercises.length : 0;
          // created_at is server-set; a row that somehow lacks it must not take
          // the whole panel down
          const when = (t.created_at || '').slice(0, 10);
          return '<div class="lib-item"><div><div class="nm">' + esc(t.name) + '</div>' +
            '<div class="meta">' + n + ' exercise' + (n === 1 ? '' : 's') +
            (when ? ' · ' + shortDate(when) : '') +
            (t.profile_id === S.session.user.id ? ' · yours' : '') + '</div></div>' +
            '<div class="ops"><button class="ghost" data-tmpl-get="' + t.id + '">Import</button>' +
            (t.profile_id === S.session.user.id
              ? '<button class="ghost" data-tmpl-del="' + t.id + '" title="Remove">×</button>' : '') +
            '</div></div>';
        }).join('')
      : '<p class="placeholder">Nothing shared with this squad yet.</p>') +
    '<div class="tmpl-row"><button id="sq-post">&#8593; Share my exercise library</button></div>' +
    '<div id="squad-tmsg"></div></div>';
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
  // same merge rules as a file upload: additive, never overwrites
  const n = await importExercises(t.payload, 'squad-tmsg');
  if (n) track('squad_template_imported', { exercises: n });
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
  if (e.target.id === 'prog-metric') { PROG.metric = e.target.value; renderProgress(); return; }
  if (e.target.id === 'prog-weeks')  { PROG.weeks = e.target.value; renderProgress(); return; }
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
    if (!error) { S.workouts = S.workouts.filter(s => s.id !== dw.dataset.delW); renderHistory(); renderSummary(); renderProgress(); refreshWeekCount(); }
    return;
  }
  const dc = e.target.closest('[data-del-c]');
  if (dc) {
    if (!confirm('Delete this core session for good?')) return;
    const { error } = await sb.from('tracker_core_sessions').delete().eq('id', dc.dataset.delC);
    if (!error) { S.coreSessions = S.coreSessions.filter(s => s.id !== dc.dataset.delC); renderHistory(); renderSummary(); refreshWeekCount(); }
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
  const de = e.target.closest('[data-del-erg]');
  if (de) {
    if (!confirm('Delete this erg session for good?')) return;
    const { error } = await sb.from('tracker_erg_sessions').delete().eq('id', de.dataset.delErg);
    if (!error) { S.ergs = S.ergs.filter(s => s.id !== de.dataset.delErg); renderHistory(); renderSummary(); renderErgRecent(); refreshWeekCount(); }
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) { fillLibForm(exById(ed.dataset.edit)); $('lx-name').focus(); return; }
  const dx = e.target.closest('[data-del-ex]');
  if (dx) { deleteLibExercise(dx.dataset.delEx); return; }
  // ---- squad ----
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
  renderLog(); renderErgGate(); renderErgRecent(); renderCoreTab();
  renderSummary(); renderProgress(); renderHistory(); renderLibrary(); renderRoutines();
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
    const n = migrated.weights + migrated.erg + migrated.core;
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
    renderLog(snapshotLog()); renderErgRecent(); renderSummary();
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

  $('core-pick').onchange = () => loadRun($('core-pick').value);
  $('core-edit-rt').onclick = () => {
    const r = routineById($('core-pick').value);
    if (!r) return;
    editingRoutine = { id: r.id, name: r.name, steps: stepsOf(r).map(s => ({ ...s })) };
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
    if (ev.target.id === 'squad-period') { SQ.period = ev.target.value; refreshSquad(); }
    if (ev.target.id === 'squad-metric') { SQ.metric = ev.target.value; renderSquad(); }
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
