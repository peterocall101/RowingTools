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
      <a href="analytics.html" class="tile">
        <div class="tile-title">Analytics</div>
        <div class="tile-desc">Speed vs distance, progression, athlete comparison and wind sensitivity across every logged piece and imported race.</div>
      </a>

      <a href="adjust.html" class="tile">
        <div class="tile-title">Distance Adjuster</div>
        <div class="tile-desc">Convert a 500m pace to its 2k equivalent (or any distance to any other) on a log-scale drop-off, calibrated from your own squad's data.</div>
      </a>

      <a href="piece.html" class="tile">
        <div class="tile-title">Log Water Piece</div>
        <div class="tile-desc">Pin start and finish on a map, and the course bearing, wind (head/cross), and river flow from the nearest EA gauge are fetched and stored with the result.</div>
      </a>

      <a href="programme.html" class="tile">
        <div class="tile-title">Training Programmes</div>
        <div class="tile-desc">Create and manage customized training plans. Weekly calendar view with colour-coded sessions, PDF export, and squad sharing.</div>
      </a>

      <a href="workspace.html" class="tile">
        <div class="tile-title">Workspace</div>
        <div class="tile-desc">View and manage your saved training programmes. Download as PDF or share with your squad.</div>
      </a>

      <div class="tile" style="cursor:default">
        <div class="tile-title">Demo data</div>
        <div class="tile-desc">Build (or remove) a realistic demo squad - athletes, crews and a season of pieces with wind and stream - to explore the analytics.</div>
        <div style="display:flex; gap:8px; margin-top:10px">
          <button class="btn btn-ghost" id="demo-load" style="padding:6px 12px; font-size:13px">Load</button>
          <button class="btn btn-ghost" id="demo-clear" style="padding:6px 12px; font-size:13px; color:var(--danger)">Remove</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('demo-load').onclick = async (e) => {
    const b = e.target; b.disabled = true; b.textContent = 'Building...';
    try {
      const r = await RTDemo.load();
      toast(`Demo loaded: ${r.athletes} athletes, ${r.crews} crews, ${r.results} results`);
    } catch (err) { toast(err.message || 'Demo load failed', 'error'); }
    b.disabled = false; b.textContent = 'Load';
  };
  document.getElementById('demo-clear').onclick = async (e) => {
    if (!confirm('Remove all demo athletes, crews and results from this squad?')) return;
    const b = e.target; b.disabled = true; b.textContent = 'Removing...';
    try { await RTDemo.clear(); toast('Demo data removed'); }
    catch (err) { toast(err.message || 'Demo clear failed', 'error'); }
    b.disabled = false; b.textContent = 'Remove';
  };
})();
