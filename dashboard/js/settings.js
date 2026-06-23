// settings.js - group settings (benchmarks)
(async function () {
  const app = document.getElementById('app');

  const session = await requireAuth();
  if (!session) return;
  await loadContext();
  if (!RT.memberships.length) { window.location.replace('index.html'); return; }
  renderHeader('settings.html');

  if (!isActiveAdmin()) {
    app.innerHTML = `<div class="empty"><h2>Access denied</h2><p>Only group admins can manage settings.</p></div>`;
    return;
  }

  const group = activeGroup();
  let benchmarks = [];
  let activeBench = null;
  let wbtData = null;

  await load();

  async function load() {
    benchmarks = await listBenchmarks(RT.activeGroupId);
    const activeId = group.active_benchmark_id;
    activeBench = benchmarks.find(b => b.id === activeId);
    wbtData = await loadWBT();
    render();
  }

  function render() {
    app.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-sub">${escapeHtml(group.name)}</p>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <h2 style="font-size:18px; font-weight:600; margin-bottom:12px">Benchmarks</h2>
        <p style="color:var(--ink-2); font-size:14px; margin-bottom:16px">All benchmarks are based on World Best Time (WBT). Create custom versions by applying adjustments to specific boat classes.</p>

        <div id="benchmarks-list" style="margin-bottom:16px"></div>

        <button class="btn btn-ghost" id="create-btn">+ Create benchmark</button>
      </div>
    `;

    renderBenchmarksList();
    bind();
  }

  function renderBenchmarksList() {
    const list = document.getElementById('benchmarks-list');
    if (!benchmarks.length) {
      list.innerHTML = '<p style="color:var(--ink-2)">No benchmarks yet. Create one below.</p>';
      return;
    }

    const html = benchmarks.map(b => {
      const isActive = activeBench && activeBench.id === b.id;
      return `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px; border:1px solid var(--line); border-radius:8px; margin-bottom:8px">
          <div style="flex:1">
            <div style="font-weight:600; color:var(--ink)">${escapeHtml(b.name)}</div>
            <div style="font-size:12px; color:var(--ink-2)">Based on WBT</div>
          </div>
          <div style="display:flex; gap:8px; align-items:center">
            ${!isActive ? `<button class="btn btn-ghost" id="set-active-${b.id}" style="padding:7px 12px; font-size:13px">Set active</button>` : '<span style="font-weight:600; color:var(--brand)">Active</span>'}
            <button class="icon-btn danger" id="del-${b.id}" style="padding:6px 10px">Delete</button>
          </div>
        </div>
      `;
    }).join('');

    list.innerHTML = html;
  }

  function bind() {
    document.getElementById('create-btn').onclick = openCreateForm;

    benchmarks.forEach(b => {
      const setBtn = document.getElementById(`set-active-${b.id}`);
      if (setBtn) {
        setBtn.onclick = async () => {
          try {
            await setActiveBenchmark(b.id);
            toast('Benchmark activated');
            await load();
          } catch (e) {
            toast(e.message || 'Could not activate', 'error');
          }
        };
      }

      const delBtn = document.getElementById(`del-${b.id}`);
      if (delBtn) {
        delBtn.onclick = async () => {
          if (!confirm(`Delete "${b.name}"?`)) return;
          try {
            const { error } = await sb.from('benchmarks').update({ deleted_at: new Date().toISOString() }).eq('id', b.id);
            if (error) throw error;
            toast('Benchmark deleted');
            await load();
          } catch (e) {
            toast(e.message || 'Could not delete', 'error');
          }
        };
      }
    });
  }

  function openCreateForm() {
    const boatClasses = Object.keys(wbtData || {}).sort();
    const adjHtml = boatClasses.map(bc => `
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px">
        <label style="min-width:60px; font-size:13px; font-weight:500">${escapeHtml(bc)}</label>
        <input type="number" class="input" style="width:80px" data-bc="${bc}" placeholder="0" value="0">
        <span style="font-size:12px; color:var(--ink-2)">seconds</span>
      </div>
    `).join('');

    openModal({
      title: 'Create benchmark',
      bodyHtml: `
        <div class="field">
          <label for="bench-name">Name</label>
          <input class="input" id="bench-name" placeholder="e.g., Spring 2026" required>
        </div>
        <div class="field">
          <label>Adjustments (optional)</label>
          <p style="font-size:12px; color:var(--ink-2); margin-bottom:10px">Enter positive/negative seconds to adjust WBT for each boat class. Leave blank for no adjustment.</p>
          <div style="max-height:300px; overflow-y:auto">${adjHtml}</div>
        </div>
      `,
      submitLabel: 'Create',
      onSubmit: async (form, close) => {
        const name = document.getElementById('bench-name').value.trim();
        if (!name) throw new Error('Name required');

        const adjustments = {};
        form.querySelectorAll('input[data-bc]').forEach(inp => {
          const val = parseInt(inp.value, 10);
          if (!isNaN(val) && val !== 0) {
            adjustments[inp.dataset.bc] = val * 1000; // convert seconds to ms
          }
        });

        try {
          await createBenchmark(name, adjustments);
          toast('Benchmark created');
          close();
          await load();
        } catch (e) {
          throw new Error(e.message || 'Failed to create');
        }
      },
    });
  }
})();
