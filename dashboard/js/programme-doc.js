// programme-doc.js - render a training programme as a weekly calendar grid
// (dates across, weeks down, coloured day cells) and export to PDF. Shared by
// the builder and workspace. Requires html2pdf (CDN) + escapeHtml() (auth.js).

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Google-Sheets-style pastel palette for day cells.
const TP_COLORS = {
  '':       '#ffffff',
  green:    '#d9ead3',
  yellow:   '#fff2cc',
  grey:     '#efefef',
  blue:     '#cfe2f3',
  red:      '#f4cccc',
};
const TP_COLOR_OPTIONS = [['', 'None'], ['green', 'Green'], ['yellow', 'Yellow'], ['grey', 'Grey'], ['blue', 'Blue'], ['red', 'Red']];

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

// Normalise any saved plan to the current shape: weeks[].days = 7 x {text,color}.
// Converts the earlier {dow,sessions:[...]} day shape so old programmes still open.
function tpNormalisePlan(p) {
  p = p ? JSON.parse(JSON.stringify(p)) : {};
  p.meta = p.meta || {};
  p.weeks = (p.weeks && p.weeks.length) ? p.weeks : [];
  p.weeks.forEach(w => {
    let days = w.days || [];
    days = days.map(d => {
      if (d && Array.isArray(d.sessions)) {
        const text = d.sessions
          .map(s => [s.type, s.distance, s.duration, s.rate ? 'r' + s.rate : '', s.notes].filter(Boolean).join(' '))
          .join('\n');
        return { text, color: d.color || '' };
      }
      return { text: (d && d.text) || '', color: (d && d.color) || '' };
    });
    while (days.length < 7) days.push({ text: '', color: '' });
    w.days = days.slice(0, 7);
  });
  if (!p.weeks.length) p.weeks.push({ name: 'Week 1', days: DOW.map(() => ({ text: '', color: '' })) });
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
  const cells = week.days.map(day =>
    `<td style="background:${TP_COLORS[day.color] || '#fff'}">${escapeHtml(day.text || '').replace(/\n/g, '<br>')}</td>`).join('');
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
