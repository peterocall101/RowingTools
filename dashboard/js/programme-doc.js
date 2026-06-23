// programme-doc.js - render a training programme as a printable document and
// export it to PDF (download or share). Shared by the builder and workspace.
// Requires html2pdf (loaded via CDN) and escapeHtml() from auth.js.

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Build a styled, A4-width document element for a programme { title, plan }.
function buildProgrammeDoc(programme) {
  const plan = programme.plan || {};
  const meta = plan.meta || {};
  const weeks = plan.weeks || [];

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
    ${weeks.map(weekDocHtml).join('')}`;
  return el;
}

function weekDocHtml(week) {
  const days = (week.days || []).filter(d => (d.sessions || []).length);
  const rows = days.map(d => {
    const sess = d.sessions.map(s => {
      const bits = [
        s.type ? `<strong>${escapeHtml(s.type)}</strong>` : '',
        s.distance ? escapeHtml(s.distance) : '',
        s.duration ? escapeHtml(s.duration) : '',
        s.rate ? `r${escapeHtml(String(s.rate))}` : '',
      ].filter(Boolean).join(' &middot; ');
      const notes = s.notes ? `<div class="tp-doc-note">${escapeHtml(s.notes)}</div>` : '';
      return `<div class="tp-doc-session">${bits || '<span class="muted">-</span>'}${notes}</div>`;
    }).join('');
    return `<tr><th>${escapeHtml(d.dow)}</th><td>${sess}</td></tr>`;
  }).join('');

  return `<div class="tp-doc-week">
    <h2>${escapeHtml(week.name || 'Week')}${week.focus ? ` <span class="tp-doc-focus">- ${escapeHtml(week.focus)}</span>` : ''}</h2>
    ${rows ? `<table class="tp-doc-table"><tbody>${rows}</tbody></table>` : '<p class="muted">No sessions.</p>'}
  </div>`;
}

// Render the doc off-screen at A4 width so html2canvas captures it cleanly.
function _mountForRender(programme) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed; left:-10000px; top:0; width:794px; background:#fff;';
  const doc = buildProgrammeDoc(programme);
  holder.appendChild(doc);
  document.body.appendChild(holder);
  return { holder, doc };
}

function _fileName(programme) {
  return (programme.title || 'training-programme').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.pdf';
}

function _opts(programme) {
  return {
    margin: [12, 12, 12, 12],
    filename: _fileName(programme),
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'], avoid: '.tp-doc-week' },
  };
}

async function downloadProgrammePdf(programme) {
  const { holder } = _mountForRender(programme);
  try { await html2pdf().set(_opts(programme)).from(holder.firstChild).save(); }
  finally { holder.remove(); }
}

async function shareProgrammePdf(programme) {
  const { holder } = _mountForRender(programme);
  try {
    const blob = await html2pdf().set(_opts(programme)).from(holder.firstChild).outputPdf('blob');
    const file = new File([blob], _fileName(programme), { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: programme.title || 'Training programme' });
      return 'shared';
    }
    // Desktop / unsupported: fall back to a download.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = _fileName(programme); a.click();
    URL.revokeObjectURL(url);
    return 'downloaded';
  } finally { holder.remove(); }
}
