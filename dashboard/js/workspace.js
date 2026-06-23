// workspace.js - saved training programmes: open, duplicate, delete, PDF.
(async function () {
  const app = document.getElementById('app');

  const session = await requireAuth();
  if (!session) return;
  await loadContext();
  if (!RT.memberships.length) { window.location.replace('index.html'); return; }
  renderHeader('workspace.html');

  await render();

  async function render() {
    const { data: rows, error } = await sb
      .from('training_programmes')
      .select('id, title, plan, updated_at, created_at')
      .eq('group_id', RT.activeGroupId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });

    if (error) { app.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`; return; }

    app.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Workspace</div>
          <p class="page-sub">${escapeHtml(activeGroup().name)} &middot; ${rows.length} programme${rows.length === 1 ? '' : 's'}</p>
        </div>
        <a class="btn btn-primary" href="programme.html">+ New programme</a>
      </div>
      ${rows.length ? grid(rows) : emptyHtml()}`;

    app.querySelectorAll('[data-dup]').forEach(b => b.onclick = () => duplicate(rows.find(r => r.id === b.dataset.dup)));
    app.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove(rows.find(r => r.id === b.dataset.del)));
    app.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => downloadProgrammePdf(rows.find(r => r.id === b.dataset.dl)));
    app.querySelectorAll('[data-share]').forEach(b => b.onclick = async () => {
      try { const r = await shareProgrammePdf(rows.find(x => x.id === b.dataset.share)); toast(r === 'shared' ? 'Shared' : 'Downloaded PDF'); }
      catch (e) { toast('Could not share', 'error'); }
    });
  }

  function grid(rows) {
    return `<div class="grid grid-3">${rows.map(cardHtml).join('')}</div>`;
  }

  function cardHtml(p) {
    const weeks = (p.plan?.weeks || []).length;
    const phase = p.plan?.meta?.phase;
    return `<div class="card tp-card">
      <a class="tp-card-title" href="programme.html?id=${p.id}">${escapeHtml(p.title || 'Untitled programme')}</a>
      <div class="tp-card-meta">${weeks} week${weeks === 1 ? '' : 's'}${phase ? ' &middot; ' + escapeHtml(phase) : ''}</div>
      <div class="tp-card-date muted">Updated ${fmtDate(p.updated_at)}</div>
      <div class="tp-card-actions">
        <a class="icon-btn" href="programme.html?id=${p.id}">Open</a>
        <button class="icon-btn" data-dup="${p.id}">Duplicate</button>
        <button class="icon-btn" data-dl="${p.id}">PDF</button>
        <button class="icon-btn" data-share="${p.id}">Share</button>
        <button class="icon-btn danger" data-del="${p.id}">Delete</button>
      </div>
    </div>`;
  }

  function emptyHtml() {
    return `<div class="empty">
      <h2>No programmes yet</h2>
      <p>Build a training programme - weeks, days and sessions - then save it here to open, duplicate, or share as a PDF.</p>
      <a class="btn btn-primary" href="programme.html">+ New programme</a>
    </div>`;
  }

  async function duplicate(p) {
    const { error } = await sb.from('training_programmes').insert({
      group_id: RT.activeGroupId, created_by: session.user.id,
      title: (p.title || 'Untitled programme') + ' (copy)', plan: p.plan,
    });
    if (error) { toast(error.message, 'error'); return; }
    toast('Duplicated');
    await render();
  }

  async function remove(p) {
    if (!confirm(`Delete "${p.title}"? It moves to the bin and is removed after 48 hours.`)) return;
    const { error } = await sb.from('training_programmes').update({ deleted_at: new Date().toISOString() }).eq('id', p.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Deleted');
    await render();
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
})();
