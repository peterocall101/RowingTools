// ui.js - tiny modal + toast helpers shared by dashboard pages.
// Requires escapeHtml() from auth.js.

function toast(msg, kind = 'ok') {
  let t = document.getElementById('rt-toast');
  if (!t) { t = document.createElement('div'); t.id = 'rt-toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast show' + (kind === 'error' ? ' toast-error' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast' + (kind === 'error' ? ' toast-error' : ''); }, 2600);
}

// openModal({ title, bodyHtml, submitLabel, onSubmit })
// onSubmit(form, close) may be async and should throw to show an inline error.
function openModal({ title, bodyHtml, submitLabel = 'Save', onSubmit }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h2>${escapeHtml(title)}</h2>
        <button class="modal-close" type="button" aria-label="Close">&times;</button>
      </div>
      <form class="modal-body">
        <div class="error-box modal-error" style="display:none"></div>
        ${bodyHtml}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
          <button type="submit" class="btn btn-primary" data-submit>${escapeHtml(submitLabel)}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('form');
  const errEl = overlay.querySelector('.modal-error');
  const submitBtn = overlay.querySelector('[data-submit]');
  const close = () => overlay.remove();

  overlay.querySelector('.modal-close').onclick = close;
  overlay.querySelector('[data-cancel]').onclick = close;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.style.display = 'none';
    submitBtn.disabled = true;
    const orig = submitBtn.textContent;
    submitBtn.textContent = 'Saving...';
    try {
      await onSubmit(form, close);
    } catch (err) {
      errEl.style.display = 'block';
      errEl.textContent = err.message || 'Something went wrong.';
      submitBtn.disabled = false;
      submitBtn.textContent = orig;
    }
  });

  // Focus the first input for quick entry.
  const first = form.querySelector('input, select, textarea');
  if (first) first.focus();

  return { overlay, form, close };
}
