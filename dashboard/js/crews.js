// crews.js - crew CRUD + line-up editor for the active group.
(async function () {
  const app = document.getElementById('app');
  const BOAT_CLASSES = ['1x', '2x', '2-', '2+', '4x', '4-', '4+', '8+'];

  const session = await requireAuth();
  if (!session) return;
  await loadContext();
  if (!RT.memberships.length) { window.location.replace('index.html'); return; }
  renderHeader('crews.html');

  await render();

  async function render() {
    // Crews + their line-up counts in two queries.
    const { data: crews, error } = await sb
      .from('crews')
      .select('*')
      .eq('group_id', RT.activeGroupId)
      .is('deleted_at', null)
      .order('name');
    if (error) { app.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`; return; }

    let counts = {};
    if (crews.length) {
      const { data: cm } = await sb.from('crew_members')
        .select('crew_id').in('crew_id', crews.map(c => c.id));
      (cm || []).forEach(r => { counts[r.crew_id] = (counts[r.crew_id] || 0) + 1; });
    }

    app.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Crews</div>
          <p class="page-sub">${escapeHtml(activeGroup().name)} &middot; ${crews.length} crew${crews.length === 1 ? '' : 's'}</p>
        </div>
        <button class="btn btn-primary" id="add-btn">+ Add crew</button>
      </div>
      ${crews.length ? tableHtml(crews, counts) : emptyHtml()}`;

    document.getElementById('add-btn').onclick = () => openCrewForm();
    const addEmpty = document.getElementById('add-empty');
    if (addEmpty) addEmpty.onclick = () => openCrewForm();
    app.querySelectorAll('[data-edit]').forEach(b =>
      b.onclick = () => openCrewForm(crews.find(c => c.id === b.dataset.edit)));
    app.querySelectorAll('[data-lineup]').forEach(b =>
      b.onclick = () => openLineup(crews.find(c => c.id === b.dataset.lineup)));
    app.querySelectorAll('[data-del]').forEach(b =>
      b.onclick = () => removeCrew(crews.find(c => c.id === b.dataset.del)));
  }

  function tableHtml(crews, counts) {
    return `<div class="table-wrap"><table class="data">
      <thead><tr><th>Crew</th><th>Boat</th><th>Line-up</th><th></th></tr></thead>
      <tbody>${crews.map(c => `
        <tr>
          <td><strong>${escapeHtml(c.name)}</strong></td>
          <td>${c.boat_class ? `<span class="pill">${escapeHtml(c.boat_class)}</span>` : '<span class="muted">-</span>'}</td>
          <td>${(counts[c.id] || 0)} rower${(counts[c.id] || 0) === 1 ? '' : 's'}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-lineup="${c.id}">Line-up</button>
            <button class="icon-btn" data-edit="${c.id}">Edit</button>
            <button class="icon-btn danger" data-del="${c.id}">Remove</button>
          </div></td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  }

  function emptyHtml() {
    return `<div class="empty">
      <h2>No crews yet</h2>
      <p>Name a line-up, e.g. <em>Senior 8+ A</em>, then add the athletes who sit in it. You'll be able to tag results to a crew and track it across the season.</p>
      <button class="btn btn-primary" id="add-empty">+ Add your first crew</button>
    </div>`;
  }

  function openCrewForm(crew) {
    const editing = !!crew;
    openModal({
      title: editing ? 'Edit crew' : 'Add crew',
      submitLabel: editing ? 'Save changes' : 'Add crew',
      bodyHtml: `
        <div class="field">
          <label for="f-name">Crew name</label>
          <input class="input" id="f-name" name="name" required value="${editing ? escapeHtml(crew.name) : ''}" placeholder="Senior 8+ A">
        </div>
        <div class="field">
          <label for="f-boat">Boat class</label>
          <select class="input-select" id="f-boat" name="boat_class">
            <option value="">-</option>
            ${BOAT_CLASSES.map(b => `<option value="${b}"${editing && crew.boat_class === b ? ' selected' : ''}>${b}</option>`).join('')}
          </select>
        </div>`,
      onSubmit: async (form, close) => {
        const fd = new FormData(form);
        const payload = { name: fd.get('name').trim(), boat_class: fd.get('boat_class') || null };
        if (!payload.name) throw new Error('Enter a crew name.');

        if (editing) {
          const { error } = await sb.from('crews').update(payload).eq('id', crew.id);
          if (error) throw error;
          toast('Crew updated');
        } else {
          const { error } = await sb.from('crews').insert({
            ...payload, group_id: RT.activeGroupId, created_by: session.user.id,
          });
          if (error) throw error;
          toast('Crew added');
        }
        close();
        await render();
      },
    });
  }

  async function openLineup(crew) {
    // Need the roster and the current line-up.
    const [{ data: roster }, { data: current }] = await Promise.all([
      sb.from('athletes').select('id, name').eq('group_id', RT.activeGroupId).is('deleted_at', null).order('name'),
      sb.from('crew_members').select('athlete_id').eq('crew_id', crew.id),
    ]);

    if (!roster || !roster.length) {
      openModal({
        title: `Line-up - ${crew.name}`,
        submitLabel: 'Go to Roster',
        bodyHtml: `<p class="muted" style="margin-bottom:4px">There are no athletes in this squad yet. Add some on the Roster page first, then come back to pick the line-up.</p>`,
        onSubmit: async () => { window.location.href = 'roster.html'; },
      });
      return;
    }

    const inCrew = new Set((current || []).map(r => r.athlete_id));
    openModal({
      title: `Line-up - ${crew.name}`,
      submitLabel: 'Save line-up',
      bodyHtml: `
        <p class="muted" style="margin-bottom:10px">Tick the athletes who sit in this crew.</p>
        <div class="check-list">
          ${roster.map(a => `
            <label class="check-row">
              <input type="checkbox" name="athlete" value="${a.id}"${inCrew.has(a.id) ? ' checked' : ''}>
              <span>${escapeHtml(a.name)}</span>
            </label>`).join('')}
        </div>`,
      onSubmit: async (form, close) => {
        const selected = [...form.querySelectorAll('input[name="athlete"]:checked')].map(c => c.value);
        // Replace the line-up: clear then insert the selected set.
        const { error: delErr } = await sb.from('crew_members').delete().eq('crew_id', crew.id);
        if (delErr) throw delErr;
        if (selected.length) {
          const { error: insErr } = await sb.from('crew_members')
            .insert(selected.map(aid => ({ crew_id: crew.id, athlete_id: aid })));
          if (insErr) throw insErr;
        }
        toast('Line-up saved');
        close();
        await render();
      },
    });
  }

  async function removeCrew(c) {
    if (!confirm(`Remove the crew "${c.name}"? Results already tagged to it keep their data.`)) return;
    const { error } = await sb.from('crews').update({ deleted_at: new Date().toISOString() }).eq('id', c.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Crew removed');
    await render();
  }
})();
