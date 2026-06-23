// programme.js - build/edit a training programme as a weekly calendar grid
// (weeks down, days across with dates, coloured cells). New, or ?id= to edit.
// Shares TP_COLORS / tpWeekDates / tpNormalisePlan / DOW from programme-doc.js.
(async function () {
  const app = document.getElementById('app');

  const session = await requireAuth();
  if (!session) return;
  await loadContext();
  if (!RT.memberships.length) { window.location.replace('index.html'); return; }
  renderHeader('programme.html');

  const editId = new URLSearchParams(location.search).get('id');
  let title = 'Untitled programme';
  let plan = tpNormalisePlan({ meta: {}, weeks: [blankWeek(1)] });

  if (editId) {
    const { data, error } = await sb.from('training_programmes').select('*').eq('id', editId).single();
    if (error || !data) toast('Could not load that programme', 'error');
    else { title = data.title; plan = tpNormalisePlan(data.plan); }
  }

  render();

  function blankWeek(n) {
    return { name: `Week ${n}`, days: DOW.map(() => ({ sessions: [] })) };
  }

  function render() {
    app.innerHTML = `
      <div class="page-head">
        <div style="flex:1">
          <input class="input tp-title" id="tp-title" value="${escapeHtml(title)}" placeholder="Programme title">
          <p class="page-sub" style="margin-top:6px">${escapeHtml(activeGroup().name)}</p>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn btn-ghost" id="dl-btn">Download PDF</button>
          <button class="btn btn-ghost" id="share-btn">Share PDF</button>
          <button class="btn btn-primary" id="save-btn">Save</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="form-row">
          <div class="field"><label for="m-phase">Phase</label>
            <input class="input" id="m-phase" value="${escapeHtml(plan.meta.phase || '')}" placeholder="e.g. Winter base"></div>
          <div class="field"><label for="m-start">Week 1 start (Monday)</label>
            <input class="input" id="m-start" type="date" value="${escapeHtml(plan.meta.start_date || '')}"></div>
        </div>
        <div class="field" style="margin-bottom:0"><label for="m-notes">Notes</label>
          <input class="input" id="m-notes" value="${escapeHtml(plan.meta.notes || '')}" placeholder="Overview / aims (optional)"></div>
      </div>

      <div id="weeks">${plan.weeks.map(weekHtml).join('')}</div>
      <button class="btn btn-ghost" id="add-week" style="margin-top:6px">+ Add week</button>`;

    bind();
  }

  function weekHtml(w, wi) {
    const dates = tpWeekDates(plan.meta.start_date, wi);
    const head = DOW.map((d, i) =>
      `<th>${d}${dates ? `<div class="tp-date">${dates[i]}</div>` : ''}</th>`).join('');
    const cells = w.days.map((day, di) => cellHtml(wi, di, day)).join('');
    return `<div class="tp-week" data-w="${wi}">
      <div class="tp-week-head">
        <input class="input tp-week-name" data-w="${wi}" data-k="name" value="${escapeHtml(w.name || '')}" placeholder="Week name">
        <button class="icon-btn danger" data-delweek="${wi}">Remove week</button>
      </div>
      <div class="tp-grid-scroll">
        <table class="tp-grid">
          <thead><tr>${head}</tr></thead>
          <tbody><tr>${cells}</tr></tbody>
        </table>
      </div>
    </div>`;
  }

  function cellHtml(wi, di, day) {
    const sessions = day.sessions || [];
    const typeOpts = ['', ...TP_SESSION_TYPES.map(t => t.type)];
    const sessionBlocks = sessions.map((s, si) => {
      const color = TP_TYPE_TO_COLOR[s.type] || '#fff';
      return `<div class="tp-session" style="background:${color}">
        <div class="tp-session-head">
          <select class="tp-session-type" data-w="${wi}" data-d="${di}" data-s="${si}" data-k="type">
            ${typeOpts.map(t => `<option value="${escapeHtml(t)}"${s.type === t ? ' selected' : ''}>${escapeHtml(t || '—')}</option>`).join('')}
          </select>
          <button class="tp-session-del" data-w="${wi}" data-d="${di}" data-s="${si}" type="button">×</button>
        </div>
        <textarea class="tp-session-text" data-w="${wi}" data-d="${di}" data-s="${si}" data-k="text" rows="2" placeholder="Details...">${escapeHtml(s.text || '')}</textarea>
        <textarea class="tp-session-notes" data-w="${wi}" data-d="${di}" data-s="${si}" data-k="notes" rows="1" placeholder="Notes...">${escapeHtml(s.notes || '')}</textarea>
      </div>`;
    }).join('');
    return `<td class="tp-cell" data-cell="${wi}.${di}">
      <div class="tp-cell-content">${sessionBlocks}</div>
      <button class="tp-add-session" data-w="${wi}" data-d="${di}" type="button">+ Add session</button>
    </td>`;
  }

  // Read field values out of the DOM into the model (before any re-render).
  function syncFromDom() {
    title = document.getElementById('tp-title').value;
    plan.meta.phase = document.getElementById('m-phase').value;
    plan.meta.start_date = document.getElementById('m-start').value;
    plan.meta.notes = document.getElementById('m-notes').value;

    // Sync week names
    document.querySelectorAll('[data-w][data-k="name"]').forEach(inp => {
      plan.weeks[+inp.dataset.w].name = inp.value;
    });

    // Sync sessions: collect all session inputs by week/day/session index
    plan.weeks.forEach(w => w.days.forEach(d => d.sessions = []));
    document.querySelectorAll('[data-s]').forEach(inp => {
      const w = +inp.dataset.w, d = +inp.dataset.d, s = +inp.dataset.s, k = inp.dataset.k;
      while (plan.weeks[w].days[d].sessions.length <= s) {
        plan.weeks[w].days[d].sessions.push({ type: '', text: '', notes: '' });
      }
      plan.weeks[w].days[d].sessions[s][k] = inp.value;
    });
  }

  function bind() {
    document.getElementById('add-week').onclick = () => {
      syncFromDom(); plan.weeks.push(blankWeek(plan.weeks.length + 1)); render();
    };
    document.querySelectorAll('[data-delweek]').forEach(b => b.onclick = () => {
      syncFromDom(); plan.weeks.splice(+b.dataset.delweek, 1);
      if (!plan.weeks.length) plan.weeks.push(blankWeek(1));
      render();
    });

    // Add session to a cell
    document.querySelectorAll('.tp-add-session').forEach(btn => btn.onclick = () => {
      const w = +btn.dataset.w, d = +btn.dataset.d;
      plan.weeks[w].days[d].sessions.push({ type: '', text: '', notes: '' });
      syncFromDom(); render();
    });

    // Delete session from a cell
    document.querySelectorAll('.tp-session-del').forEach(btn => btn.onclick = () => {
      const w = +btn.dataset.w, d = +btn.dataset.d, s = +btn.dataset.s;
      plan.weeks[w].days[d].sessions.splice(s, 1);
      syncFromDom(); render();
    });

    // Live session colour when type changes
    document.querySelectorAll('.tp-session-type').forEach(sel => sel.onchange = () => {
      const session = sel.closest('.tp-session');
      if (session) session.style.background = TP_TYPE_TO_COLOR[sel.value] || '#fff';
    });

    // Re-render when start date changes so column dates update
    document.getElementById('m-start').onchange = () => { syncFromDom(); render(); };

    document.getElementById('save-btn').onclick = save;
    document.getElementById('dl-btn').onclick = () => { syncFromDom(); downloadProgrammePdf({ title, plan }); };
    document.getElementById('share-btn').onclick = async () => {
      syncFromDom();
      try { const r = await shareProgrammePdf({ title, plan }); toast(r === 'shared' ? 'Shared' : 'Downloaded PDF'); }
      catch (e) { toast('Could not share', 'error'); }
    };
  }

  async function save() {
    syncFromDom();
    const btn = document.getElementById('save-btn');
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      if (editId) {
        const { error } = await sb.from('training_programmes')
          .update({ title: title.trim() || 'Untitled programme', plan, updated_at: new Date().toISOString() })
          .eq('id', editId);
        if (error) throw error;
        toast('Saved');
        btn.disabled = false; btn.textContent = 'Save';
      } else {
        const { data, error } = await sb.from('training_programmes')
          .insert({ group_id: RT.activeGroupId, created_by: session.user.id, title: title.trim() || 'Untitled programme', plan })
          .select('id').single();
        if (error) throw error;
        toast('Saved to workspace');
        location.search = `?id=${data.id}`;  // reload in edit mode so further saves update
      }
    } catch (e) {
      toast(e.message || 'Could not save', 'error');
      btn.disabled = false; btn.textContent = 'Save';
    }
  }
})();
