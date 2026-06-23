// crews.js - crews are DISTINCT ATHLETE-SETS. They appear automatically when a
// combination of athletes is tagged on a result, and can be created/named
// manually here. Membership = identity, so you rename (not re-line-up).
(async function () {
  const app = document.getElementById('app');

  const session = await requireAuth();
  if (!session) return;
  await loadContext();
  if (!RT.memberships.length) { window.location.replace('index.html'); return; }
  renderHeader('crews.html');

  let roster = [];

  await render();

  async function render() {
    const [{ data: crews, error }, { data: rosterRows }] = await Promise.all([
      sb.from('crews').select('*').eq('group_id', RT.activeGroupId).is('deleted_at', null).order('created_at'),
      sb.from('athletes').select('id, name').eq('group_id', RT.activeGroupId).is('deleted_at', null).order('name'),
    ]);
    if (error) { app.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`; return; }
    roster = rosterRows || [];
    const nameById = Object.fromEntries(roster.map(a => [a.id, a.name]));

    // Members + result counts for the listed crews.
    let membersByCrew = {}, countByCrew = {};
    if (crews.length) {
      const ids = crews.map(c => c.id);
      const [{ data: cm }, { data: res }] = await Promise.all([
        sb.from('crew_members').select('crew_id, athlete_id').in('crew_id', ids),
        sb.from('results').select('crew_id').in('crew_id', ids).is('deleted_at', null),
      ]);
      (cm || []).forEach(m => { (membersByCrew[m.crew_id] = membersByCrew[m.crew_id] || []).push(nameById[m.athlete_id] || '?'); });
      (res || []).forEach(r => { countByCrew[r.crew_id] = (countByCrew[r.crew_id] || 0) + 1; });
    }

    app.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Crews</div>
          <p class="page-sub">${escapeHtml(activeGroup().name)} &middot; ${crews.length} crew${crews.length === 1 ? '' : 's'}</p>
        </div>
        <button class="btn btn-primary" id="add-btn">+ New crew</button>
      </div>
      <p class="muted" style="margin:-10px 0 18px">A crew is a set of athletes. They form automatically when you tag the same athletes on a result, or you can create and name one here.</p>
      ${crews.length ? tableHtml(crews, membersByCrew, countByCrew) : emptyHtml()}`;

    document.getElementById('add-btn').onclick = () => openCrewForm();
    const addEmpty = document.getElementById('add-empty');
    if (addEmpty) addEmpty.onclick = () => openCrewForm();
    app.querySelectorAll('[data-rename]').forEach(b =>
      b.onclick = () => openRename(crews.find(c => c.id === b.dataset.rename), (membersByCrew[b.dataset.rename] || [])));
    app.querySelectorAll('[data-del]').forEach(b =>
      b.onclick = () => removeCrew(crews.find(c => c.id === b.dataset.del), membersByCrew[b.dataset.del] || []));
  }

  function label(crew, members) {
    return crew.name || members.join(', ') || 'Empty crew';
  }

  function tableHtml(crews, membersByCrew, countByCrew) {
    return `<div class="table-wrap"><table class="data">
      <thead><tr><th>Crew</th><th>Athletes</th><th>Results</th><th></th></tr></thead>
      <tbody>${crews.map(c => {
        const members = membersByCrew[c.id] || [];
        return `<tr>
          <td><strong>${escapeHtml(c.name || '-')}</strong>${c.name ? '' : '<span class="muted">unnamed</span>'}</td>
          <td>${members.length ? escapeHtml(members.join(', ')) : '<span class="muted">-</span>'}</td>
          <td>${countByCrew[c.id] || 0}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-rename="${c.id}">Rename</button>
            <button class="icon-btn danger" data-del="${c.id}">Remove</button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  function emptyHtml() {
    return `<div class="empty">
      <h2>No crews yet</h2>
      <p>Tag a set of athletes on a result and they'll appear here as a crew. Or create one now and give it a name.</p>
      <button class="btn btn-primary" id="add-empty">+ New crew</button>
    </div>`;
  }

  // Manual create: pick athletes (+ optional name) -> find-or-create the set.
  function openCrewForm() {
    if (!roster.length) {
      openModal({ title: 'New crew', submitLabel: 'Go to Roster',
        bodyHtml: `<p class="muted">Add athletes on the Roster page first, then come back to form a crew.</p>`,
        onSubmit: async () => { window.location.href = 'roster.html'; } });
      return;
    }
    openModal({
      title: 'New crew',
      submitLabel: 'Create crew',
      bodyHtml: `
        <div class="field">
          <label for="c-name">Name (optional)</label>
          <input class="input" id="c-name" name="name" placeholder="e.g. Senior 8+ A">
        </div>
        <div class="field" style="margin-bottom:0">
          <label>Athletes</label>
          <div class="check-list">
            ${roster.map(a => `<label class="check-row">
              <input type="checkbox" name="athlete" value="${a.id}"><span>${escapeHtml(a.name)}</span></label>`).join('')}
          </div>
        </div>`,
      onSubmit: async (form, close) => {
        const ids = [...form.querySelectorAll('input[name="athlete"]:checked')].map(c => c.value);
        if (!ids.length) throw new Error('Pick at least one athlete.');
        const name = form.querySelector('#c-name').value.trim() || null;
        const { error } = await sb.rpc('upsert_crew', { p_group_id: RT.activeGroupId, p_athlete_ids: ids, p_name: name });
        if (error) throw error;
        toast('Crew saved');
        close();
        await render();
      },
    });
  }

  function openRename(crew, members) {
    openModal({
      title: 'Rename crew',
      submitLabel: 'Save',
      bodyHtml: `
        <p class="muted" style="margin-bottom:10px">${escapeHtml(members.join(', ') || 'No athletes')}</p>
        <div class="field" style="margin-bottom:0">
          <label for="r-name">Name</label>
          <input class="input" id="r-name" value="${escapeHtml(crew.name || '')}" placeholder="Crew name">
        </div>`,
      onSubmit: async (form, close) => {
        const name = form.querySelector('#r-name').value.trim() || null;
        const { error } = await sb.from('crews').update({ name }).eq('id', crew.id);
        if (error) throw error;
        toast('Renamed');
        close();
        await render();
      },
    });
  }

  async function removeCrew(c, members) {
    if (!confirm(`Remove the crew "${label(c, members)}"? Results stay; the athletes remain tagged, so this combination can reappear if tagged again.`)) return;
    const { error } = await sb.from('crews').update({ deleted_at: new Date().toISOString() }).eq('id', c.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Crew removed');
    await render();
  }
})();
