// settings.js - group settings page for admins (benchmarks, etc)
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

  render();
  await load();

  async function load() {
    benchmarks = await listBenchmarks(RT.activeGroupId);
    const activeId = group.active_benchmark_id;
    activeBench = benchmarks.find(b => b.id === activeId);
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
        <p style="color:var(--ink-2); font-size:14px; margin-bottom:16px">Select the reference times to use when calculating GMT% on results.</p>

        <div id="benchmarks-list" style="margin-bottom:16px"></div>

        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn btn-ghost" id="import-wbt">+ WBT</button>
          <button class="btn btn-ghost" id="import-met_a_slowest">+ Met A (slowest)</button>
          <button class="btn btn-ghost" id="import-met_b_slowest">+ Met B (slowest)</button>
          <button class="btn btn-ghost" id="import-met_c_slowest">+ Met C (slowest)</button>
          <button class="btn btn-ghost" id="import-met_raw">+ Met (raw)</button>
          <button class="btn btn-ghost" id="import-custom">+ Custom</button>
        </div>
      </div>
    `;

    renderBenchmarksList();
    bind();
  }

  function renderBenchmarksList() {
    const list = document.getElementById('benchmarks-list');
    if (!benchmarks.length) {
      list.innerHTML = '<p style="color:var(--ink-2)">No benchmarks yet. Import one below.</p>';
      return;
    }

    const html = benchmarks.map(b => {
      const isActive = activeBench && activeBench.id === b.id;
      const sourceLabel = {
        wbt: 'World Best Time',
        met_raw: 'Metropolitan (raw)',
        met_a_slowest: 'Metropolitan A (slowest)',
        met_b_slowest: 'Metropolitan B (slowest)',
        met_c_slowest: 'Metropolitan C (slowest)',
        hrr_raw: 'Harvard (raw)',
        hwr_raw: 'Henley (raw)',
        custom: 'Custom',
      }[b.source] || b.source;

      return `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px; border:1px solid var(--line); border-radius:8px; margin-bottom:8px">
          <div style="flex:1">
            <div style="font-weight:600; color:var(--ink)">${escapeHtml(b.name)}</div>
            <div style="font-size:12px; color:var(--ink-2)">${sourceLabel}</div>
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
    ['wbt', 'met_a_slowest', 'met_b_slowest', 'met_c_slowest', 'met_raw'].forEach(source => {
      const btn = document.getElementById(`import-${source}`);
      if (btn) {
        btn.onclick = () => importPreset(source);
      }
    });

    const customBtn = document.getElementById('import-custom');
    if (customBtn) customBtn.onclick = importCustom;

    benchmarks.forEach(b => {
      const setBtn = document.getElementById(`set-active-${b.id}`);
      if (setBtn) {
        setBtn.onclick = async () => {
          try {
            await setActiveBenchmark(b.id);
            toast('Benchmark activated');
            await load();
          } catch (e) {
            toast(e.message || 'Could not activate benchmark', 'error');
          }
        };
      }

      const delBtn = document.getElementById(`del-${b.id}`);
      if (delBtn) {
        delBtn.onclick = async () => {
          if (!confirm(`Delete "${b.name}"? This cannot be undone.`)) return;
          try {
            const { error } = await sb.from('benchmarks').update({ deleted_at: new Date().toISOString() }).eq('id', b.id);
            if (error) throw error;
            toast('Benchmark deleted');
            await load();
          } catch (e) {
            toast(e.message || 'Could not delete benchmark', 'error');
          }
        };
      }
    });
  }

  async function importPreset(source) {
    const btn = document.getElementById(`import-${source.replace(/_/g, '-')}`);
    if (btn) btn.disabled = true;
    try {
      await createBenchmarkFromPreset(source);
      toast('Benchmark imported');
      await load();
    } catch (e) {
      toast(e.message || 'Could not import benchmark', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function importCustom() {
    const name = prompt('Benchmark name (e.g. "Spring 2026")');
    if (!name) return;

    const result = await openModal({
      title: 'Import custom benchmark',
      bodyHtml: `
        <div class="field">
          <label>Times (JSON format)</label>
          <textarea id="custom-times" style="width:100%; border:1px solid var(--line); border-radius:8px; padding:8px; font-family:monospace; font-size:12px; min-height:200px" placeholder='{"M4x": 1280000, "W4x": 1380000, ...}'></textarea>
          <p style="font-size:12px; color:var(--ink-2); margin-top:6px">Times in milliseconds. 2000m times for each boat class.</p>
        </div>
      `,
      submitLabel: 'Import',
      onSubmit: async () => {
        try {
          const json = JSON.parse(document.getElementById('custom-times').value);
          const { error } = await sb.rpc('create_benchmark', {
            p_group_id: RT.activeGroupId,
            p_name: name,
            p_source: 'custom',
            p_times: json,
          });
          if (error) throw error;
          toast('Benchmark imported');
          await load();
          return true;
        } catch (e) {
          toast(e.message || 'Invalid JSON', 'error');
          return false;
        }
      },
    });
  }
})();
