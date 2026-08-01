// RowingTools Tracker - single-page app logic.
// Weights logging (user-defined exercise library, template share) + erg
// logging (photo -> parse-erg Edge Function -> editable confirm card, or
// manual). All data personal, RLS owner-only. No programme concept.

/* ================= state ================= */
const S = {
  session: null,
  profile: null,
  exercises: [],   // library rows (including retired - needed for history)
  workouts: [],    // weights sessions, sorted date+at desc
  ergs: [],        // erg sessions, sorted date+at desc
  routines: [],    // core routine templates
  coreSessions: [],// logged runs through a core routine
};

const PATTERN_ORDER = ['squat', 'pull', 'hinge', 'push', 'legs', 'shoulders', 'arms', 'core', 'other'];

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

function toast(holderId, msg, cls) {
  $(holderId).innerHTML = '<div class="toast ' + (cls || '') + '">' + msg + '</div>';
}

function track(event, params) { if (typeof gtag === 'function') gtag('event', event, params || {}); }

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

// What is currently open in the log, so editing the library doesn't discard
// a session the athlete is halfway through entering.
function snapshotLog() {
  return [...document.querySelectorAll('#log-sections .ex')].map(card => ({
    id: card.dataset.id,
    rows: [...card.querySelectorAll('.setrow')].map(row => ({
      r: row.querySelector('.in-r').value,
      w: row.querySelector('.in-w') ? row.querySelector('.in-w').value : '',
    })),
  }));
}
function restoreLog(snap) {
  snap.forEach(item => {
    if (!exById(item.id) || exById(item.id).retired) return;
    addExercise(item.id, false, item.rows);
  });
}

function renderLog(snap) {
  const lib = activeLibrary();
  const chipsEl = $('chips');

  if (!lib.length) {
    chipsEl.innerHTML = '<p class="placeholder">No exercises yet - set up your library in the <b>Exercises</b> tab first (or upload a crewmate\'s template there).</p>';
  } else {
    const groupings = allGroups(lib);
    chipsEl.innerHTML = groupings.map(g => {
      const inG = lib.filter(e => groupsOf(e).includes(g));
      const pats = [...new Set(inG.map(e => e.pattern))].sort((a, b) => patIdx(a) - patIdx(b));
      return '<div class="picker-session">' + esc(g) + '</div>' +
        pats.map(p => '<div class="picker-row"><span class="rowlab">' + esc(p) + '</span><div class="chips">' +
          inG.filter(e => e.pattern === p).map(e =>
            '<button class="chip" aria-pressed="false" data-chip="' + e.id + '">' + esc(e.name) + '</button>'
          ).join('') + '</div></div>').join('');
    }).join('');
  }

  const pats = [...new Set(lib.map(e => e.pattern))].sort((a, b) => patIdx(a) - patIdx(b));
  $('log-sections').innerHTML =
    (lib.length ? '<p class="placeholder" id="log-empty">Nothing added yet - tap an exercise above</p>' : '') +
    pats.map((p, i) =>
      '<div class="logsec" data-sec="' + esc(p) + '"><h3>' + (i + 1) + ' · ' + esc(cap(p)) +
      '<span class="secnote"></span></h3><div class="secbody"></div></div>').join('');

  $('log-msg').innerHTML = '';
  if (snap && snap.length) restoreLog(snap);
  refreshWeekCount();
}

// A set that opens with a value (pre-filled from last time, or restored) counts
// as already the athlete's own, so mirroring from set 1 must not overwrite it.
const held = v => (v === '' || v == null) ? '' : ' data-touched="1"';

function setRowHTML(j, r, w, bw, timeOnly) {
  if (timeOnly) {
    return '<div class="setrow time"><span class="setno">' + (j + 1) + '</span>' +
      '<input type="number" inputmode="decimal" class="in-r" value="' + esc(r || '') + '"' + held(r) + ' placeholder="secs">' +
      '<button class="ghostx rm" title="Remove hold">×</button></div>';
  }
  return '<div class="setrow"><span class="setno">' + (j + 1) + '</span>' +
    '<input type="number" inputmode="decimal" class="in-r" value="' + esc(r || '') + '"' + held(r) + ' placeholder="–">' +
    '<input type="number" inputmode="decimal" class="in-w" value="' + esc(w || '') + '"' + held(w) + ' placeholder="' + (bw ? '+0' : '–') + '">' +
    '<button class="ghostx rm" title="Remove set">×</button></div>';
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

function addExercise(exId, scroll, rows) {
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
        '<div class="ex-note"><span class="src">' + esc(groupsOf(m).join(' · ')) + '</span>' + (m.note ? ' · ' + esc(m.note) : '') + '</div></div>' +
        '<button class="ghostx ex-close" title="Remove">×</button></div>' +
      '<div class="lastline' + (prev ? '' : ' none') + '">' +
        (prev ? 'Last (' + (prev.date === currentDate() ? 'earlier today' : prettyDate(prev.date)) + '): ' + setsToText(prev.sets[exId], m.unit)
              : 'No history yet - first time in.') + '</div>' +
      (timeOnly
        ? '<div class="colhead time"><span>#</span><span>Seconds</span><span></span></div>'
        : '<div class="colhead"><span>#</span><span>' + unitLabel + '</span><span>Weight kg</span><span></span></div>') +
      '<div class="rows">' + start.map((r, j) => setRowHTML(j, r.r, r.w, m.bodyweight, timeOnly)).join('') + '</div>' +
      '<button class="addset">+ add ' + (timeOnly ? 'hold' : 'set') + '</button>' +
    '</div>');

  document.querySelectorAll('[data-chip="' + exId + '"]').forEach(c => c.setAttribute('aria-pressed', 'true'));
  updateSecNotes();
  if (scroll !== false) secBody.querySelector('[data-id="' + exId + '"]').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function removeExercise(exId) {
  const card = document.querySelector('#log-sections [data-id="' + exId + '"]');
  if (card) card.remove();
  document.querySelectorAll('[data-chip="' + exId + '"]').forEach(c => c.setAttribute('aria-pressed', 'false'));
  updateSecNotes();
}

function updateSecNotes() {
  let any = 0;
  document.querySelectorAll('.logsec').forEach(sec => {
    const n = sec.querySelectorAll('.ex').length;
    any += n;
    sec.classList.toggle('has', n > 0);
    sec.querySelector('.secnote').textContent = n ? n + ' in session' : '';
  });
  const empty = $('log-empty');
  if (empty) empty.style.display = any ? 'none' : 'block';
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
  const date = currentDate(), sets = {};
  let total = 0;
  document.querySelectorAll('#log-sections .ex').forEach(card => {
    const rows = [...card.querySelectorAll('.setrow')].map(row => ({
      r: row.querySelector('.in-r').value.trim(),
      w: row.querySelector('.in-w') ? row.querySelector('.in-w').value.trim() : '',
    })).filter(x => x.r !== '');
    if (rows.length) { sets[card.dataset.id] = rows; total += rows.length; }
  });
  if (!total) { toast('log-msg', 'Nothing to save - add an exercise and enter at least one set.', 'warn'); return; }

  const at = nowHM();
  const { data, error } = await sb.from('tracker_workouts')
    .insert({ profile_id: S.session.user.id, date, at, sets }).select().single();
  if (error) { toast('log-msg', 'Save failed: ' + esc(error.message), 'err'); return; }

  S.workouts.push(data); sortDesc(S.workouts);
  track('workout_saved', { exercises: Object.keys(sets).length, sets: total });
  const nToday = S.workouts.filter(x => x.date === date).length;
  renderLog();
  toast('log-msg', 'Saved - ' + prettyDate(date) + ' ' + at + ' · ' + Object.keys(sets).length +
    ' exercises, ' + total + ' sets' + (nToday > 1 ? ' · entry ' + nToday + ' today' : '') + '.');
  renderSummary(); renderHistory();
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
function openErgForm(data, source) {
  $('erg-form-holder').innerHTML = ergFormHTML(data, source);
  $('erg-form-holder').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const { data, error } = await sb.from('tracker_erg_sessions').insert(row).select().single();
  if (error) { toast('erg-parse-status', 'Save failed: ' + esc(error.message), 'err'); return; }

  S.ergs.push(data); sortDesc(S.ergs);
  track('erg_saved', { source: row.source, intervals: intervals.length });
  $('erg-form-holder').innerHTML = '';
  toast('erg-parse-status', 'Saved - ' + prettyDate(row.date) +
    (row.session_type ? ' · ' + esc(row.session_type) : '') +
    (row.distance_m ? ' · ' + row.distance_m + 'm' : '') + '.');
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

function renderErgRecent() {
  const recent = S.ergs.slice(0, 6);
  $('erg-recent').innerHTML = !recent.length
    ? '<p class="empty">No erg sessions logged yet.</p>'
    : '<div class="patlabel">Recent</div>' + recent.map(s =>
      '<div class="entry erg"><div class="entry-head"><strong>' + prettyDate(s.date) + '</strong>' +
      '<span class="entry-date">' + esc(s.erg_type || '') + ' · ' + esc(s.source) + '</span></div>' +
      '<div class="erg-line">' + ergSummaryLine(s) + '</div>' +
      '<button class="del" data-del-erg="' + s.id + '">Delete</button></div>').join('');
}

/* ---- entitlement: photo reading is the one paid feature ---- */
// The server decides this too - this is only so free users see an honest
// message up front instead of uploading a photo and being refused.
function canReadPhotos() {
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
  $('erg-photo-btn').title = 'Part of the £5/month plan';
  wrap.innerHTML =
    '<div class="gate"><b>Reading erg photos is part of the £5/month plan.</b>' +
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
              startedAt: 0, carried: 0, tick: null, wake: null };
let editingRoutine = null;   // null = not editing, else {id|null, name, steps}

const routineById = id => S.routines.find(r => r.id === id) || null;
const stepsOf = r => Array.isArray(r && r.steps) ? r.steps : [];
const totalTarget = steps => steps.reduce((a, s) => a + (Number(s.target_s) || 0), 0);

function renderCoreTab() {
  const pick = $('core-pick');
  const live = S.routines.filter(r => !r.retired);
  pick.innerHTML = live.length
    ? live.map(r => '<option value="' + r.id + '">' + esc(r.name) + '</option>').join('')
    : '<option value="">No routines yet</option>';
  if (RUN.routineId && live.some(r => r.id === RUN.routineId)) pick.value = RUN.routineId;
  $('core-edit').disabled = !live.length;

  if (editingRoutine) { renderBuilder(); $('core-runner').innerHTML = ''; return; }
  $('core-builder').innerHTML = '';
  if (!live.length) {
    $('core-runner').innerHTML = '<p class="placeholder">No core routines yet. Hit <b>New routine</b> ' +
      'and list the holds in the order you do them, each with a target time. The same hold can ' +
      'appear as often as you like - round 1 and round 4 are two entries, not one.</p>';
    return;
  }
  loadRun(pick.value);
}

/* ---- builder ---- */
function renderBuilder() {
  const r = editingRoutine;
  $('core-runner').innerHTML = '';
  $('core-builder').innerHTML =
    '<div class="lib-form"><h3>' + (r.id ? 'Edit routine' : 'New routine') + '</h3>' +
    '<div class="fwide"><label>Routine name</label>' +
      '<input type="text" id="cr-name" value="' + esc(r.name) + '" placeholder="e.g. Core circuit"></div>' +
    '<div class="chead"><span>#</span><span>Exercise</span><span>Secs</span><span></span></div>' +
    '<div id="cr-steps">' + r.steps.map(stepRowHTML).join('') + '</div>' +
    '<button class="addset" id="cr-add">+ add exercise</button>' +
    '<div class="fhint" style="margin:8px 0 12px">Total ' + fmtTime(totalTarget(r.steps)) +
      ' over ' + r.steps.length + ' round' + (r.steps.length === 1 ? '' : 's') + '.</div>' +
    '<button class="primary" id="cr-save" style="height:42px">Save routine</button>' +
    '<button id="cr-cancel" style="width:100%;margin-top:8px">Cancel</button>' +
    (r.id ? '<button id="cr-del" style="width:100%;margin-top:8px">Delete routine</button>' : '') +
    '</div>';
}
function stepRowHTML(s, i) {
  return '<div class="cstep"><span class="cno">' + (i + 1) + '</span>' +
    '<input type="text" class="cs-name" value="' + esc(s.name || '') + '" placeholder="e.g. Plank" list="cr-names">' +
    '<input type="number" class="cs-secs" inputmode="numeric" value="' + esc(s.target_s != null ? s.target_s : '') + '" placeholder="60">' +
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
  }));
}

async function saveRoutine() {
  syncBuilderFromDOM();
  const r = editingRoutine;
  const name = (r.name || '').trim();
  const steps = r.steps.filter(s => s.name);
  if (!name) { toast('core-msg', 'Give the routine a name.', 'warn'); return; }
  if (!steps.length) { toast('core-msg', 'Add at least one exercise.', 'warn'); return; }

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
  if (error) { toast('core-msg', 'Save failed: ' + esc(error.message), 'err'); return; }
  editingRoutine = null;
  if (saved) RUN.routineId = saved.id;
  renderCoreTab();
  toast('core-msg', 'Routine saved.');
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
  if (error) { toast('core-msg', 'Delete failed: ' + esc(error.message), 'err'); return; }
  editingRoutine = null;
  if (RUN.routineId === id) RUN.routineId = null;
  renderCoreTab();
  toast('core-msg', used ? 'Routine removed (past sessions kept).' : 'Routine deleted.');
}

/* ---- runner + timer ---- */
function loadRun(routineId) {
  const r = routineById(routineId);
  if (!r) { $('core-runner').innerHTML = ''; return; }
  stopTimer();
  RUN.routineId = r.id;
  RUN.name = r.name;
  RUN.steps = stepsOf(r).map(s => ({ name: s.name, target_s: Number(s.target_s) || 0, actual_s: null }));
  RUN.idx = 0; RUN.carried = 0; RUN.running = false;
  renderRunner();
}

function renderRunner() {
  const done = RUN.steps.every(s => s.actual_s != null);
  $('core-runner').innerHTML =
    '<div class="timer">' +
      '<div class="timer-pos" id="tm-pos"></div>' +
      '<div class="timer-step" id="tm-name"></div>' +
      '<div class="timer-clock" id="tm-clock">0:00</div>' +
      '<div class="timer-target" id="tm-target"></div>' +
      '<div class="timer-bar"><i id="tm-bar"></i></div>' +
      '<div class="timer-btns">' +
        '<button class="go" id="tm-go">Start</button>' +
        '<button id="tm-next">Next</button>' +
        '<button id="tm-reset">Reset</button>' +
      '</div>' +
      (done ? '<div class="timer-done">Routine complete - check the times and save.</div>' : '') +
    '</div>' +
    '<div class="chead"><span>#</span><span>Exercise</span><span>Target</span><span>Actual</span></div>' +
    '<div id="core-rows">' + RUN.steps.map(rowRunHTML).join('') + '</div>' +
    '<div class="fwide" style="margin-top:12px"><label>Notes</label><input type="text" id="core-notes"></div>' +
    '<button class="save" id="core-save">Save core session</button>';
  paintTimer();
}
function rowRunHTML(s, i) {
  return '<div class="crow' + (i === RUN.idx ? ' now' : '') + (s.actual_s != null ? ' done' : '') + '" data-crow="' + i + '">' +
    '<span class="cno">' + (i + 1) + '</span>' +
    '<span class="cname">' + esc(s.name) + '</span>' +
    '<span class="ctar">' + (s.target_s ? s.target_s + 's' : '–') + '</span>' +
    '<input type="number" inputmode="numeric" class="cs-actual" data-i="' + i + '" ' +
      'value="' + (s.actual_s != null ? s.actual_s : '') + '" placeholder="' + (s.target_s || '') + '"></div>';
}

const elapsedNow = () => RUN.carried + (RUN.running ? (Date.now() - RUN.startedAt) / 1000 : 0);

function paintTimer() {
  const s = RUN.steps[RUN.idx];
  const pos = $('tm-pos'); if (!pos) return;
  if (!s) {
    pos.textContent = 'Finished';
    $('tm-name').textContent = RUN.name;
    $('tm-clock').textContent = fmtClock(0);
    $('tm-target').textContent = 'All ' + RUN.steps.length + ' rounds done';
    $('tm-bar').style.width = '100%';
    $('tm-go').textContent = 'Start';
    return;
  }
  const el = elapsedNow(), left = (s.target_s || 0) - el;
  pos.textContent = 'Round ' + (RUN.idx + 1) + ' of ' + RUN.steps.length;
  $('tm-name').textContent = s.name;
  const clock = $('tm-clock');
  clock.textContent = (left < 0 ? '+' : '') + fmtClock(Math.abs(left));
  clock.classList.toggle('over', left < 0);
  $('tm-target').textContent = s.target_s ? 'Target ' + s.target_s + 's' : 'No target set';
  $('tm-bar').style.width = s.target_s ? Math.min(100, (el / s.target_s) * 100) + '%' : '0%';
  $('tm-go').textContent = RUN.running ? 'Pause' : (el > 0 ? 'Resume' : 'Start');
}
const fmtClock = sec => {
  const t = Math.max(0, Math.floor(sec));
  return Math.floor(t / 60) + ':' + pad(t % 60);
};

function startTimer() {
  if (RUN.running || !RUN.steps[RUN.idx]) return;
  RUN.running = true;
  RUN.startedAt = Date.now();
  RUN.tick = setInterval(() => {
    const s = RUN.steps[RUN.idx];
    // Auto-advance so a circuit runs hands-free; the athlete can still hit
    // Next early or let it run over, and either way the real elapsed is kept.
    if (s && s.target_s && elapsedNow() >= s.target_s) { nextStep(true); return; }
    paintTimer();
  }, 200);
  keepAwake(true);
  paintTimer();
}
function pauseTimer() {
  if (!RUN.running) return;
  RUN.carried = elapsedNow();
  RUN.running = false;
  clearInterval(RUN.tick); RUN.tick = null;
  paintTimer();
}
function stopTimer() {
  RUN.running = false;
  if (RUN.tick) { clearInterval(RUN.tick); RUN.tick = null; }
  RUN.carried = 0;
  keepAwake(false);
}

function nextStep(auto) {
  const s = RUN.steps[RUN.idx];
  if (!s) return;
  s.actual_s = Math.max(1, Math.round(elapsedNow() || s.target_s || 0));
  const wasRunning = RUN.running;
  if (RUN.tick) { clearInterval(RUN.tick); RUN.tick = null; }
  RUN.running = false; RUN.carried = 0;
  RUN.idx++;
  beep(auto);
  if (RUN.idx >= RUN.steps.length) { RUN.idx = RUN.steps.length; stopTimer(); renderRunner(); return; }
  renderRunner();
  if (wasRunning) startTimer();   // keep the circuit rolling
}

// Short tone + buzz so a round change lands without looking at the screen.
function beep(strong) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = strong ? 880 : 620;
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.26);
      setTimeout(() => ctx.close(), 400);
    }
  } catch (e) { /* audio blocked until a gesture - not worth surfacing */ }
  if (navigator.vibrate) navigator.vibrate(strong ? [90, 60, 90] : 60);
}

// Stop the phone locking mid-circuit. Silently unavailable on some browsers.
async function keepAwake(on) {
  try {
    if (on && !RUN.wake && navigator.wakeLock) RUN.wake = await navigator.wakeLock.request('screen');
    else if (!on && RUN.wake) { RUN.wake.release(); RUN.wake = null; }
  } catch (e) { RUN.wake = null; }
}

async function saveCoreSession() {
  // hand-typed overrides win over whatever the timer recorded
  document.querySelectorAll('.cs-actual').forEach(inp => {
    const v = parseInt(inp.value, 10);
    RUN.steps[Number(inp.dataset.i)].actual_s = isNaN(v) ? null : v;
  });
  const steps = RUN.steps.filter(s => s.actual_s != null);
  if (!steps.length) { toast('core-msg', 'Nothing to save - time at least one round, or type a number in.', 'warn'); return; }

  const row = {
    profile_id: S.session.user.id,
    date: $('core-date').value || todayISO(),
    at: nowHM(),
    routine_id: RUN.routineId,
    routine_name: RUN.name,
    steps,
    notes: ($('core-notes').value || '').trim() || null,
  };
  const { data, error } = await sb.from('tracker_core_sessions').insert(row).select().single();
  if (error) { toast('core-msg', 'Save failed: ' + esc(error.message), 'err'); return; }
  S.coreSessions.push(data); sortDesc(S.coreSessions);
  track('core_saved', { rounds: steps.length });
  stopTimer();
  loadRun(RUN.routineId);
  toast('core-msg', 'Saved - ' + steps.length + ' round' + (steps.length === 1 ? '' : 's') +
    ', ' + fmtTime(steps.reduce((a, s) => a + s.actual_s, 0)) + ' of work.');
  renderHistory(); renderSummary();
}

function histCoreHTML(s) {
  const steps = Array.isArray(s.steps) ? s.steps : [];
  const total = steps.reduce((a, x) => a + (x.actual_s || 0), 0);
  const summary = esc(s.routine_name || 'Core') + ' · ' + steps.length +
    ' round' + (steps.length === 1 ? '' : 's') + ' · ' + fmtTime(total);
  const detail = '<div class="dsub">Rounds</div><div class="dtbl-wrap"><table class="dtbl">' +
    '<thead><tr><th>#</th><th>Exercise</th><th>Target</th><th>Actual</th><th>Diff</th></tr></thead><tbody>' +
    steps.map((x, i) => {
      const d = (x.actual_s != null && x.target_s) ? x.actual_s - x.target_s : null;
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(x.name) + '</td>' +
        '<td>' + (x.target_s ? x.target_s + 's' : '<span class="na">–</span>') + '</td>' +
        '<td>' + (x.actual_s != null ? x.actual_s + 's' : '<span class="na">–</span>') + '</td>' +
        '<td>' + (d === null ? '<span class="na">–</span>'
          : '<span class="delta ' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '+' : '') + d + 's</span>') +
        '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    (s.notes ? '<div class="dnote">' + esc(s.notes) + '</div>' : '');
  return entryHTML(s, 'core', 'core', summary, detail, 'c');
}

/* ================= summary ================= */
function weeklyStats() {
  const weeks = {};
  S.workouts.forEach(s => {
    const w = mondayOf(s.date);
    weeks[w] = weeks[w] || { n: 0, ex: {} };
    weeks[w].n++;
    Object.keys(s.sets).forEach(id => {
      const e = weeks[w].ex[id] = weeks[w].ex[id] || { times: 0, sets: 0, reps: [], weights: [] };
      e.times++; e.sets += s.sets[id].length;
      s.sets[id].forEach(r => {
        const rv = parseFloat(r.r); if (!isNaN(rv)) e.reps.push(rv);
        const wv = parseFloat(r.w); if (!isNaN(wv)) e.weights.push(wv);
      });
    });
  });
  return weeks;
}

function renderSummary() {
  const el = $('sum-body');
  const weeks = weeklyStats();
  // fold erg weeks in so a week with only erg work still shows
  const ergWeeks = {};
  S.ergs.forEach(s => {
    const w = mondayOf(s.date);
    const e = ergWeeks[w] = ergWeeks[w] || { n: 0, meters: 0, time: 0 };
    e.n++; e.meters += s.distance_m || 0; e.time += s.total_time_s || 0;
  });
  const coreWeeks = {};
  S.coreSessions.forEach(s => {
    const w = mondayOf(s.date);
    const c = coreWeeks[w] = coreWeeks[w] || { n: 0, rounds: 0, time: 0 };
    c.n++;
    (Array.isArray(s.steps) ? s.steps : []).forEach(x => { c.rounds++; c.time += x.actual_s || 0; });
  });
  const keys = [...new Set([...Object.keys(weeks), ...Object.keys(ergWeeks), ...Object.keys(coreWeeks)])].sort().reverse();
  if (!keys.length) { el.innerHTML = '<p class="empty">Nothing to summarise yet - log a session first.</p>'; return; }

  el.innerHTML = keys.map((w, wi) => {
    const wk = weeks[w], prevKey = keys.slice(wi + 1).find(k => weeks[k]), prev = prevKey ? weeks[prevKey] : null;
    const eg = ergWeeks[w], cw = coreWeeks[w];
    const sunday = new Date(w + 'T12:00:00'); sunday.setDate(sunday.getDate() + 6);
    const sunISO = sunday.getFullYear() + '-' + pad(sunday.getMonth() + 1) + '-' + pad(sunday.getDate());

    let body = '';
    if (eg) {
      body += '<div class="patlabel">Erg</div><div class="srow"><div class="sname">Erg volume</div><div class="sstats">' +
        '<span><b>' + eg.n + '</b>sessions</span>' +
        (eg.meters ? '<span><b>' + (eg.meters >= 10000 ? (eg.meters / 1000).toFixed(1) + 'k' : eg.meters) + '</b>m</span>' : '') +
        (eg.time ? '<span><b>' + fmtTime(eg.time) + '</b></span>' : '') + '</div></div>';
    }
    if (cw) {
      body += '<div class="patlabel">Core</div><div class="srow"><div class="sname">Core work</div><div class="sstats">' +
        '<span><b>' + cw.n + '</b>sessions</span><span><b>' + cw.rounds + '</b>rounds</span>' +
        '<span><b>' + fmtTime(cw.time) + '</b></span></div></div>';
    }
    if (wk) {
      const ids = Object.keys(wk.ex).sort((a, b) => patIdx(patternOf(a)) - patIdx(patternOf(b)) || exName(a).localeCompare(exName(b)));
      const pats = [...new Set(ids.map(patternOf))];
      body += pats.map(p => '<div class="patlabel">' + esc(cap(p)) + '</div>' +
        ids.filter(id => patternOf(id) === p).map(id => {
          const e = wk.ex[id], m = exById(id) || {};
          const timeOnly = m.unit === 'secs';
          const aReps = mean(e.reps), aW = mean(e.weights), aSets = e.sets / e.times;
          let delta = '';
          if (prev && prev.ex[id] && prev.ex[id].weights.length && e.weights.length) {
            const d = round1(aW - mean(prev.ex[id].weights));
            if (d !== 0) delta = '<span class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲' : '▼') + Math.abs(d) + '</span>';
          }
          return '<div class="srow"><div class="sname">' + esc(exName(id)) +
            ' <span class="delta">×' + e.times + '</span></div><div class="sstats">' +
            '<span><b>' + round1(aSets) + '</b>' + (timeOnly ? 'holds' : 'sets') + '</span>' +
            '<span><b>' + (aReps !== null ? round1(aReps) : '–') + '</b>' + (timeOnly ? 'secs' : 'reps') + '</span>' +
            (timeOnly ? '' : '<span><b>' + (aW !== null ? round1(aW) : 'BW') + '</b>' + (aW !== null ? 'kg' : '') + delta + '</span>') +
            '</div></div>';
        }).join('')).join('');
    }
    return '<div class="sumweek"><h4>' + shortDate(w) + ' - ' + shortDate(sunISO) + '</h4>' +
      '<div class="meta">' + (wk ? wk.n + ' weights' : '0 weights') +
      (eg ? ' · ' + eg.n + ' erg' : '') + (cw ? ' · ' + cw.n + ' core' : '') + '</div>' + body + '</div>';
  }).join('') +
  '<footer class="footer" style="margin-top:1rem"><span>Averages are per set across the week. ×n = sessions the exercise appeared in; the arrow compares average weight with the previous logged week.</span></footer>';
}

/* ================= history ================= */
function renderHistory() {
  const el = $('hist-body');
  const all = [
    ...S.workouts.map(r => ({ kind: 'w', r })),
    ...S.ergs.map(r => ({ kind: 'e', r })),
    ...S.coreSessions.map(r => ({ kind: 'c', r })),
  ];
  if (!all.length) { el.innerHTML = '<p class="empty">No sessions logged yet.</p>'; return; }

  const weeks = {};
  all.forEach(x => { const w = mondayOf(x.r.date); (weeks[w] = weeks[w] || []).push(x); });

  el.innerHTML = Object.keys(weeks).sort().reverse().map(w => {
    const items = weeks[w].sort((a, b) => sortKey(b.r).localeCompare(sortKey(a.r)));
    return '<div class="weekgroup"><h4>Week of ' + prettyDate(w) + ' - ' + items.length + ' session' + (items.length > 1 ? 's' : '') + '</h4>' +
      items.map(x => x.kind === 'w' ? histWorkoutHTML(x.r)
                   : x.kind === 'c' ? histCoreHTML(x.r) : histErgHTML(x.r)).join('') + '</div>';
  }).join('');
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

// Collapsed by default: a scannable line per session, full detail on click.
// delKey must match the table the session lives in - 'w', 'erg' or 'c'.
function entryHTML(s, cls, kindLabel, summary, detail, delKey) {
  return '<div class="entry' + (cls ? ' ' + cls : '') + '">' +
    '<button class="entry-toggle" aria-expanded="false">' +
      '<span class="chev" aria-hidden="true">▸</span>' +
      '<span class="entry-main">' +
        '<span class="entry-when">' + prettyDate(s.date) +
          (s.at ? ' <span class="entry-time">' + esc(s.at) + '</span>' : '') + '</span>' +
        '<span class="entry-sum">' + summary + '</span>' +
      '</span>' +
      '<span class="entry-kind">' + kindLabel + '</span>' +
    '</button>' +
    '<div class="entry-detail" hidden>' + detail +
      '<button class="del" data-del-' + delKey + '="' + s.id + '">Delete this session</button>' +
    '</div></div>';
}

function histWorkoutHTML(s) {
  const ids = Object.keys(s.sets).sort((a, b) => patIdx(patternOf(a)) - patIdx(patternOf(b)));
  const t = workoutTotals(s);
  const summary = t.exercises + ' exercise' + (t.exercises === 1 ? '' : 's') + ' · ' +
    t.sets + ' set' + (t.sets === 1 ? '' : 's') +
    (t.weighted ? ' · ' + kg(t.volume) + ' kg' : '');

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

  return entryHTML(s, '', 'weights', summary, detail, 'w');
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
  const snap = snapshotLog();
  let payload;
  try { payload = JSON.parse(await file.text()); }
  catch (e) { toast('lib-msg', 'That file is not valid JSON.', 'err'); return; }
  if (!payload || payload.kind !== 'exercise-template' || !Array.isArray(payload.exercises)) {
    toast('lib-msg', 'That does not look like a RowingTools template file.', 'err'); return;
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
  if (!fresh.length) { toast('lib-msg', 'Nothing new in that template - everything is already in your library.', 'warn'); return; }
  const { data, error } = await sb.from('tracker_exercises').insert(fresh).select();
  if (error) { toast('lib-msg', 'Import failed: ' + esc(error.message), 'err'); return; }
  S.exercises.push(...data);
  toast('lib-msg', 'Imported ' + data.length + ' exercise' + (data.length > 1 ? 's' : '') + '.');
  track('template_uploaded', { exercises: data.length });
  renderLibrary(); renderLog(snap);
}

/* ================= events ================= */
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.classList || !(el.classList.contains('in-r') || el.classList.contains('in-w'))) return;
  const card = el.closest('.ex'), row = el.closest('.setrow');
  if (!card || !row) return;
  if (card.querySelector('.setrow') === row) fillDown(card);
  else el.dataset.touched = '1';   // typed into by hand: stop mirroring set 1
});

document.addEventListener('click', async e => {
  const tog = e.target.closest('.entry-toggle');
  if (tog) {
    const open = tog.getAttribute('aria-expanded') === 'true';
    tog.setAttribute('aria-expanded', String(!open));
    tog.parentElement.querySelector('.entry-detail').hidden = open;
    return;
  }
  const chip = e.target.closest('[data-chip]');
  if (chip) {
    chip.getAttribute('aria-pressed') === 'true' ? removeExercise(chip.dataset.chip) : addExercise(chip.dataset.chip);
    return;
  }
  if (e.target.classList.contains('ex-close')) { removeExercise(e.target.closest('.ex').dataset.id); return; }
  if (e.target.classList.contains('addset')) {
    // .addset is shared styling, so route the other users of it first
    if (e.target.id === 'eg-addiv') {
      $('eg-ivs').insertAdjacentHTML('beforeend', ergIvRowHTML($('eg-ivs').children.length, {}));
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
    return;
  }
  if (e.target.classList.contains('rm')) {
    const rowsEl = e.target.closest('.rows');
    e.target.closest('.setrow').remove();
    [...rowsEl.children].forEach((row, i) => row.querySelector('.setno').textContent = i + 1);
    return;
  }
  if (e.target.classList.contains('iv-rm')) {
    const tb = e.target.closest('tbody');
    e.target.closest('tr').remove();
    [...tb.children].forEach((tr, i) => tr.querySelector('.setno').textContent = i + 1);
    return;
  }
  const dw = e.target.closest('[data-del-w]');
  if (dw) {
    const { error } = await sb.from('tracker_workouts').delete().eq('id', dw.dataset.delW);
    if (!error) { S.workouts = S.workouts.filter(s => s.id !== dw.dataset.delW); renderHistory(); renderSummary(); refreshWeekCount(); }
    return;
  }
  const dc = e.target.closest('[data-del-c]');
  if (dc) {
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
  if (e.target.id === 'cr-cancel') { editingRoutine = null; renderCoreTab(); return; }
  if (e.target.id === 'cr-del') { deleteRoutine(editingRoutine.id); return; }
  // ---- timer ----
  if (e.target.id === 'tm-go') { RUN.running ? pauseTimer() : startTimer(); return; }
  if (e.target.id === 'tm-next') { nextStep(false); return; }
  if (e.target.id === 'tm-reset') { stopTimer(); loadRun(RUN.routineId); return; }
  if (e.target.id === 'core-save') { saveCoreSession(); return; }
  const de = e.target.closest('[data-del-erg]');
  if (de) {
    const { error } = await sb.from('tracker_erg_sessions').delete().eq('id', de.dataset.delErg);
    if (!error) { S.ergs = S.ergs.filter(s => s.id !== de.dataset.delErg); renderHistory(); renderSummary(); renderErgRecent(); refreshWeekCount(); }
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) { fillLibForm(exById(ed.dataset.edit)); $('lx-name').focus(); return; }
  const dx = e.target.closest('[data-del-ex]');
  if (dx) { deleteLibExercise(dx.dataset.delEx); return; }
  if (e.target.id === 'eg-save') { saveErg(); return; }
  if (e.target.id === 'eg-cancel') { $('erg-form-holder').innerHTML = ''; return; }
});

/* ================= boot ================= */
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.replace('login.html'); return; }
  S.session = session;

  const err = await loadAll();
  if (err) {
    $('app-loading').innerHTML = 'Could not load your data: ' + esc(err) +
      '<br><br>If the tracker tables have not been created yet, run tracker/supabase/tracker_schema.sql in the Supabase SQL editor.';
    return;
  }

  $('whoami').textContent = (S.profile && S.profile.display_name) || session.user.email || '';
  $('log-date').value = todayISO();
  $('core-date').value = todayISO();
  renderLog(); renderErgGate(); renderErgRecent(); renderCoreTab();
  renderSummary(); renderHistory(); renderLibrary();

  $('app-loading').style.display = 'none';
  $('app').style.display = '';

  // tabs
  document.querySelectorAll('.tabs .tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === tab.dataset.panel));
    };
  });

  // A date change re-derives every "last time" line, so the log resets.
  $('log-date').onchange = () => renderLog();
  $('save-btn').onclick = saveWorkout;
  $('signout').onclick = async () => { await sb.auth.signOut(); window.location.replace('login.html'); };

  $('erg-photo-btn').onclick = () => $('erg-file').click();
  $('erg-file').onchange = () => { if ($('erg-file').files[0]) { handleErgPhoto($('erg-file').files[0]); $('erg-file').value = ''; } };
  $('erg-manual-btn').onclick = () => openErgForm(null, 'manual');

  $('core-pick').onchange = () => loadRun($('core-pick').value);
  $('core-new').onclick = () => { editingRoutine = { id: null, name: '', steps: [{ name: '', target_s: 60 }] }; renderCoreTab(); };
  $('core-edit').onclick = () => {
    const r = routineById($('core-pick').value);
    if (!r) return;
    editingRoutine = { id: r.id, name: r.name, steps: stepsOf(r).map(s => ({ ...s })) };
    renderCoreTab();
  };
  // A running timer must not survive leaving the tab, or it keeps counting and
  // holding the wake lock against a circuit the athlete has walked away from.
  document.querySelectorAll('.tabs .tab').forEach(t => t.addEventListener('click', () => {
    if (t.dataset.panel !== 'p-core' && RUN.running) pauseTimer();
  }));

  $('lx-save').onclick = saveLibExercise;
  $('lx-cancel').onclick = () => fillLibForm(null);
  $('tmpl-dl').onclick = downloadTemplate;
  $('tmpl-ul').onclick = () => $('tmpl-file').click();
  $('tmpl-file').onchange = () => { if ($('tmpl-file').files[0]) { uploadTemplate($('tmpl-file').files[0]); $('tmpl-file').value = ''; } };
})();
