// tools.js - other tools hub (training programmes, etc)
(async function () {
  const app = document.getElementById('app');

  const session = await requireAuth();
  if (!session) return;
  await loadContext();
  if (!RT.memberships.length) { window.location.replace('index.html'); return; }
  renderHeader('tools.html');

  const group = activeGroup();

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Tools</h1>
        <p class="page-sub">${escapeHtml(group.name)}</p>
      </div>
    </div>

    <div class="grid grid-2">
      <a href="programme.html" class="tile">
        <div class="tile-title">Training Programmes</div>
        <div class="tile-desc">Create and manage customized training plans. Weekly calendar view with colour-coded sessions, PDF export, and squad sharing.</div>
      </a>

      <a href="workspace.html" class="tile">
        <div class="tile-title">Workspace</div>
        <div class="tile-desc">View and manage your saved training programmes. Download as PDF or share with your squad.</div>
      </a>
    </div>
  `;
})();
