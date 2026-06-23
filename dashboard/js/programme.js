// programme.js - build/edit a rowing training programme (weeks -> days ->
// sessions). New plan, or ?id=<uuid> to edit an existing one.
(async function () {
  const app = document.getElementById('app');
  const SESSION_TYPES = ['Water UT2', 'Water UT1', 'Water AT', 'Water TR', 'Erg', 'Weights', 'Cross-train', 'Rest', 'Other'];

  const session = await requireAuth();
  if (!session) return;
  await loadContext();
  if (!RT.memberships.length) { window.location.replace('index.html'); return; }
  renderHeader('programme.html');

  const editId = new URLSearchParams(location.search).get('id');
  let title = 'Untitled programme';
  let plan = blankPlan();

  if (editId) {
    const { data, error } = await sb.from('training_programmes').select('*').eq('id', editId).single();
    if (error || !data) { toast('Could not load that programme', 'error'); }
    else { title = data.title; plan = normalisePlan(data.plan); }
  }

  render();

  function blankPlan() {
    return { meta: { phase: '', start_date: '', notes: '' }, weeks: [blankWeek(1)] };
  }
  function blankWeek(n) {
    return { name: `Week ${n}`, focus: '', days: DOW.map(dow => ({ dow, sessions: [] })) };
  }
  function normalisePlan(p) {
    p = p || {};
    p.meta = p.meta || { phase: '', start_date: '', notes: '' };
    p.weeks = (p.weeks && p.weeks.length) ? p.weeks : [blankWeek(1)];
    p.weeks.forEach(w => {
      w.days = w.days && w.days.length ? w.days : DOW.map(dow => ({ dow, sessions: [] }));
      w.days.forEach(d => { d.sessions = d.sessions || []; });
    });
    return p;
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
          <div class="field"><label for="m-start">Start date</label>
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
    return `<div class="tp-week" data-w="${wi}">
      <div class="tp-week-head">
        <input class="input tp-week-name" data-w="${wi}" data-k="name" value="${escapeHtml(w.name || '')}" placeholder="Week name">
        <input class="input tp-week-focus" data-w="${wi}" data-k="focus" value="${escapeHtml(w.focus || '')}" placeholder="Focus (optional)">
        <button class="icon-btn danger" data-delweek="${wi}">Remove week</button>
      </div>
      <div class="tp-days">
        ${w.days.map((d, di) => dayHtml(w, wi, d, di)).join('')}
      </div>
    </div>`;
  }

  function dayHtml(w, wi, d, di) {
    return `<div class="tp-day">
      <div class="tp-day-label">${escapeHtml(d.dow)}</div>
      <div class="tp-day-sessions">
        ${d.sessions.map((s, si) => sessionHtml(wi, di, s, si)).join('')}
        <button class="tp-add-session" data-addsession="${wi}.${di}">+ session</button>
      </div>
    </div>`;
  }

  function sessionHtml(wi, di, s, si) {
    const p = `${wi}.${di}.${si}`;
    return `<div class="tp-session" data-s="${p}">
      <select class="input-select tp-sess-type" data-s="${p}" data-k="type">
        <option value="">Type...</option>
        ${SESSION_TYPES.map(t => `<option value="${t}"${s.type === t ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
      <input class="input" data-s="${p}" data-k="distance" value="${escapeHtml(s.distance || '')}" placeholder="Dist (16k)">
      <input class="input" data-s="${p}" data-k="duration" value="${escapeHtml(s.duration || '')}" placeholder="Dur (3x20')">
      <input class="input tp-sess-rate" data-s="${p}" data-k="rate" value="${escapeHtml(s.rate || '')}" placeholder="r">
      <input class="input tp-sess-notes" data-s="${p}" data-k="notes" value="${escapeHtml(s.notes || '')}" placeholder="Notes">
      <button class="icon-btn danger" data-delsession="${p}">&times;</button>
    </div>`;
  }

  // Read all field values out of the DOM into the model (call before re-render).
  function syncFromDom() {
    title = document.getElementById('tp-title').value;
    plan.meta.phase = document.getElementById('m-phase').value;
    plan.meta.start_date = document.getElementById('m-start').value;
    plan.meta.notes = document.getElementById('m-notes').value;

    document.querySelectorAll('[data-k]').forEach(inp => {
      const k = inp.dataset.k;
      if (inp.dataset.w !== undefined && inp.dataset.s === undefined) {
        plan.weeks[+inp.dataset.w][k] = inp.value;
      } else if (inp.dataset.s !== undefined) {
        const [wi, di, si] = inp.dataset.s.split('.').map(Number);
        plan.weeks[wi].days[di].sessions[si][k] = inp.value;
      }
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
    document.querySelectorAll('[data-addsession]').forEach(b => b.onclick = () => {
      syncFromDom();
      const [wi, di] = b.dataset.addsession.split('.').map(Number);
      plan.weeks[wi].days[di].sessions.push({ type: '', distance: '', duration: '', rate: '', notes: '' });
      render();
    });
    document.querySelectorAll('[data-delsession]').forEach(b => b.onclick = () => {
      syncFromDom();
      const [wi, di, si] = b.dataset.delsession.split('.').map(Number);
      plan.weeks[wi].days[di].sessions.splice(si, 1);
      render();
    });

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
      } else {
        const { data, error } = await sb.from('training_programmes')
          .insert({ group_id: RT.activeGroupId, created_by: session.user.id, title: title.trim() || 'Untitled programme', plan })
          .select('id').single();
        if (error) throw error;
        toast('Saved to workspace');
        history.replaceState(null, '', `programme.html?id=${data.id}`);
        // Subsequent saves now update this row.
        location.search = `?id=${data.id}`;
        return;
      }
    } catch (e) {
      toast(e.message || 'Could not save', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  }
})();
