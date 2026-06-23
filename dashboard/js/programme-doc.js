// programme-doc.js - render a training programme as a weekly calendar grid
// (dates across, weeks down, coloured day cells) and export to PDF. Shared by
// the builder and workspace. Requires html2pdf (CDN) + escapeHtml() (auth.js).

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Session types with auto-assigned colours (same type = same colour across the programme).
const TP_SESSION_TYPES = [
  { type: 'Rest',           color: '#efefef' },    // grey
  { type: 'Water UT3',      color: '#e8f5e9' },    // very light green
  { type: 'Water UT2',      color: '#d9ead3' },    // green (easy steady)
  { type: 'Water UT1',      color: '#a4c2f4' },    // light blue
  { type: 'Water AT',       color: '#f9cb9c' },    // orange (threshold)
  { type: 'Water TR',       color: '#ef9a9a' },    // light red (tempo)
  { type: 'Water AC',       color: '#f48fb1' },    // pink (race pace)
  { type: 'Erg UT3',        color: '#f1f8e9' },    // pale green
  { type: 'Erg UT2',        color: '#c5e1a5' },    // pale green
  { type: 'Erg UT1',        color: '#aed581' },    // softer green-yellow
  { type: 'Erg AT',         color: '#ffcc80' },    // soft orange
  { type: 'Erg TR',         color: '#ffab91' },    // soft red-orange
  { type: 'Erg AC',         color: '#ff8a80' },    // red
  { type: 'Weights',        color: '#f8cbad' },    // tan
  { type: 'Cross-train',    color: '#d5a6bd' },    // mauve
  { type: 'Race',           color: '#fff2cc' },    // yellow
];
const TP_TYPE_TO_COLOR = Object.fromEntries(TP_SESSION_TYPES.map(t => [t.type, t.color]));

function tpFmtDate(dt) {
  return String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0');
}

// Dates (dd/MM) for the 7 columns of week N, from the programme start date
// (the Monday of week 1). Returns null if no valid start date.
function tpWeekDates(startDate, weekIndex) {
  if (!startDate) return null;
  const [y, m, d] = String(startDate).split('-').map(Number);
  if (!y || !m || !d) return null;
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + weekIndex * 7);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + i);
    out.push(tpFmtDate(dt));
  }
  return out;
}

// Normalise any saved plan to the current shape: weeks[].days = 7 x {sessions: [{type,text,notes}, ...]}.
// Converts the earlier single {type,text,notes} and {text,color} shapes so old programmes still open.
function tpNormalisePlan(p) {
  p = p ? JSON.parse(JSON.stringify(p)) : {};
  p.meta = p.meta || {};
  p.weeks = (p.weeks && p.weeks.length) ? p.weeks : [];
  p.weeks.forEach(w => {
    let days = w.days || [];
    days = days.map(d => {
      if (d && d.sessions && Array.isArray(d.sessions)) {
        return { sessions: d.sessions.map(s => ({ type: s.type || '', text: s.text || '', notes: s.notes || '' })) };
      }
      if (d && (d.type || d.text || d.notes)) {
        return { sessions: [{ type: d.type || '', text: d.text || '', notes: d.notes || '' }] };
      }
      return { sessions: [] };
    });
    while (days.length < 7) days.push({ sessions: [] });
    w.days = days.slice(0, 7);
  });
  if (!p.weeks.length) p.weeks.push({ name: 'Week 1', days: DOW.map(() => ({ sessions: [] })) });
  return p;
}

function buildProgrammeDoc(programme) {
  const plan = tpNormalisePlan(programme.plan);
  const meta = plan.meta || {};

  const el = document.createElement('div');
  el.className = 'tp-doc';

  const metaBits = [
    meta.phase ? `Phase: ${escapeHtml(meta.phase)}` : '',
    meta.start_date ? `Starts: ${escapeHtml(meta.start_date)}` : '',
  ].filter(Boolean).join(' &middot; ');

  el.innerHTML = `
    <div class="tp-doc-head">
      <h1>${escapeHtml(programme.title || 'Training programme')}</h1>
      ${metaBits ? `<div class="tp-doc-meta">${metaBits}</div>` : ''}
      ${meta.notes ? `<div class="tp-doc-notes">${escapeHtml(meta.notes)}</div>` : ''}
    </div>
    ${plan.weeks.map((w, wi) => weekDocHtml(w, wi, meta.start_date)).join('')}`;
  return el;
}

function weekDocHtml(week, wi, startDate) {
  const dates = tpWeekDates(startDate, wi);
  const head = DOW.map((d, i) =>
    `<th>${d}${dates ? `<div class="tp-doc-date">${dates[i]}</div>` : ''}</th>`).join('');
  const cells = week.days.map(day => {
    const sessions = (day.sessions && day.sessions.length) ? day.sessions : [];
    const html = sessions.map(s => {
      const color = TP_TYPE_TO_COLOR[s.type] || '#fff';
      const typeHeading = s.type ? `<div class="tp-doc-type">${escapeHtml(s.type)}</div>` : '';
      const text = s.text ? escapeHtml(s.text).replace(/\n/g, '<br>') : '';
      const notes = s.notes ? `<div class="tp-doc-notes">${escapeHtml(s.notes).replace(/\n/g, '<br>')}</div>` : '';
      return `<div class="tp-doc-session" style="background:${color}">${typeHeading}${text}${notes}</div>`;
    }).join('');
    return `<td>${html || '<div class="tp-doc-empty"></div>'}</td>`;
  }).join('');
  return `<div class="tp-doc-week">
    <h2>${escapeHtml(week.name || 'Week')}</h2>
    <table class="tp-doc-grid"><thead><tr>${head}</tr></thead><tbody><tr>${cells}</tr></tbody></table>
  </div>`;
}

// ---- PDF export (landscape, to fit the weekly grid) ----
function _mountForRender(programme) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed; left:-10000px; top:0; width:1100px; background:#fff;';
  holder.appendChild(buildProgrammeDoc(programme));
  document.body.appendChild(holder);
  return holder;
}
function _fileName(programme) {
  return (programme.title || 'training-programme').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.pdf';
}
function _opts(programme) {
  return {
    margin: [10, 10, 10, 10],
    filename: _fileName(programme),
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
    pagebreak: { mode: ['css', 'legacy'], avoid: '.tp-doc-week' },
  };
}

async function downloadProgrammePdf(programme) {
  const holder = _mountForRender(programme);
  try { await html2pdf().set(_opts(programme)).from(holder.firstChild).save(); }
  finally { holder.remove(); }
}

async function shareProgrammePdf(programme) {
  const holder = _mountForRender(programme);
  try {
    const blob = await html2pdf().set(_opts(programme)).from(holder.firstChild).outputPdf('blob');
    const file = new File([blob], _fileName(programme), { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: programme.title || 'Training programme' });
      return 'shared';
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = _fileName(programme); a.click();
    URL.revokeObjectURL(url);
    return 'downloaded';
  } finally { holder.remove(); }
}
