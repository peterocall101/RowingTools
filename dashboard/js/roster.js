// roster.js - athlete CRUD for the active group.
(async function () {
  const app = document.getElementById('app');

  const session = await requireAuth();
  if (!session) return;
  await loadContext();
  if (!RT.memberships.length) { window.location.replace('index.html'); return; }
  renderHeader('roster.html');

  await render();

  async function render() {
    const { data: rows, error } = await sb
      .from('athletes')
      .select('*')
      .eq('group_id', RT.activeGroupId)
      .is('deleted_at', null)
      .order('name');

    if (error) { app.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`; return; }

    app.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Roster</div>
          <p class="page-sub">${escapeHtml(activeGroup().name)} &middot; ${rows.length} athlete${rows.length === 1 ? '' : 's'}</p>
        </div>
        <button class="btn btn-primary" id="add-btn">+ Add athlete</button>
      </div>
      ${rows.length ? tableHtml(rows) : emptyHtml()}`;

    document.getElementById('add-btn').onclick = () => openForm();
    const addEmpty = document.getElementById('add-empty');
    if (addEmpty) addEmpty.onclick = () => openForm();
    app.querySelectorAll('[data-edit]').forEach(b =>
      b.onclick = () => openForm(rows.find(r => r.id === b.dataset.edit)));
    app.querySelectorAll('[data-del]').forEach(b =>
      b.onclick = () => removeAthlete(rows.find(r => r.id === b.dataset.del)));
  }

  function tableHtml(rows) {
    return `<div class="table-wrap"><table class="data">
      <thead><tr><th>Name</th><th>Sex</th><th>Age</th><th>Notes</th><th></th></tr></thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table></div>`;
  }

  function rowHtml(a) {
    return `<tr>
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td>${a.sex ? escapeHtml(a.sex) : '<span class="muted">-</span>'}</td>
      <td>${a.dob ? ageFrom(a.dob) : '<span class="muted">-</span>'}</td>
      <td>${a.notes ? escapeHtml(a.notes) : '<span class="muted">-</span>'}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-edit="${a.id}">Edit</button>
        <button class="icon-btn danger" data-del="${a.id}">Remove</button>
      </div></td>
    </tr>`;
  }

  function emptyHtml() {
    return `<div class="empty">
      <h2>No athletes yet</h2>
      <p>Add the rowers in this squad. You'll be able to tag them on results and follow each one's progress.</p>
      <button class="btn btn-primary" id="add-empty">+ Add your first athlete</button>
    </div>`;
  }

  function openForm(athlete) {
    const editing = !!athlete;
    openModal({
      title: editing ? 'Edit athlete' : 'Add athlete',
      submitLabel: editing ? 'Save changes' : 'Add athlete',
      bodyHtml: `
        <div class="field">
          <label for="f-name">Name</label>
          <input class="input" id="f-name" name="name" required value="${editing ? escapeHtml(athlete.name) : ''}" placeholder="Tom Smith">
        </div>
        <div class="form-row">
          <div class="field">
            <label for="f-sex">Sex</label>
            <select class="input-select" id="f-sex" name="sex">
              <option value="">-</option>
              <option value="M"${editing && athlete.sex === 'M' ? ' selected' : ''}>M</option>
              <option value="F"${editing && athlete.sex === 'F' ? ' selected' : ''}>F</option>
            </select>
          </div>
          <div class="field">
            <label for="f-dob">Date of birth</label>
            <input class="input" id="f-dob" name="dob" type="date" value="${editing && athlete.dob ? athlete.dob : ''}">
          </div>
        </div>
        <div class="field">
          <label for="f-notes">Notes</label>
          <input class="input" id="f-notes" name="notes" value="${editing && athlete.notes ? escapeHtml(athlete.notes) : ''}" placeholder="Optional">
        </div>`,
      onSubmit: async (form, close) => {
        const fd = new FormData(form);
        const payload = {
          name: fd.get('name').trim(),
          sex: fd.get('sex') || null,
          dob: fd.get('dob') || null,
          notes: fd.get('notes').trim() || null,
        };
        if (!payload.name) throw new Error('Enter a name.');

        if (editing) {
          const { error } = await sb.from('athletes').update(payload).eq('id', athlete.id);
          if (error) throw error;
          toast('Athlete updated');
        } else {
          const { error } = await sb.from('athletes').insert({
            ...payload, group_id: RT.activeGroupId, created_by: session.user.id,
          });
          if (error) throw error;
          toast('Athlete added');
        }
        close();
        await render();
      },
    });
  }

  async function removeAthlete(a) {
    if (!confirm(`Remove ${a.name} from the roster? Their past results stay, but they'll no longer appear here.`)) return;
    const { error } = await sb.from('athletes').update({ deleted_at: new Date().toISOString() }).eq('id', a.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Athlete removed');
    await render();
  }

  function ageFrom(dob) {
    const d = new Date(dob), now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
  }
})();
