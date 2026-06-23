// results.js - log/edit pieces, tag a crew + athletes, show /500m split, and
// import a squad's public regatta results from the main site.
(async function () {
  const app = document.getElementById('app');
  const COMMON_DISTANCES = [2000, 5000, 6000, 500, 1000, 1500];
  const WIND_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2"/><path d="M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2"/><path d="M12.59 19.41A2 2 0 1 0 14 16H2"/></svg>';

  // Conditions chip for a race row with a venue + clock time; opens the shared
  // conditions.js modal (live weather + wind-vs-course), same as the main site.
  function conditionsChip(r) {
    if (!r.clock || !r.venue) return '';
    const sum = r.weather ? ' &middot; ' + escapeHtml(weatherSummary(r.weather)) : '';
    return `<button class="rt-wx" data-wx="${r.id}">${WIND_SVG}<span>${escapeHtml(r.clock)}${sum}</span></button>`;
  }

  const session = await requireAuth();
  if (!session) return;
  await loadContext();
  if (!RT.memberships.length) { window.location.replace('index.html'); return; }
  renderHeader('results.html');

  // Roster, crews and crew line-ups are needed by the forms; load once.
  let roster = [], crews = [], lineups = {}, nameById = {};

  async function loadRefs() {
    const [{ data: r }, { data: c }] = await Promise.all([
      sb.from('athletes').select('id, name').eq('group_id', RT.activeGroupId).is('deleted_at', null).order('name'),
      sb.from('crews').select('id, name').eq('group_id', RT.activeGroupId).is('deleted_at', null).order('created_at'),
    ]);
    roster = r || [];
    crews = c || [];
    nameById = Object.fromEntries(roster.map(a => [a.id, a.name]));
    lineups = {};
    if (crews.length) {
      const { data: cm } = await sb.from('crew_members').select('crew_id, athlete_id').in('crew_id', crews.map(x => x.id));
      (cm || []).forEach(m => { (lineups[m.crew_id] = lineups[m.crew_id] || []).push(m.athlete_id); });
    }
  }

  // A crew's display label: its name, or the athletes that make it up.
  function crewLabel(crewId) {
    const c = crews.find(x => x.id === crewId);
    if (!c) return '';
    if (c.name) return c.name;
    return (lineups[crewId] || []).map(id => nameById[id] || '?').join(', ') || 'Empty crew';
  }

  await loadRefs();
  await render();

  async function render() {
    const { data: rows, error } = await sb
      .from('results')
      .select('*, crew:crews(id,name), result_athletes(athlete_id, athletes(name))')
      .eq('group_id', RT.activeGroupId)
      .is('deleted_at', null)
      .order('performed_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) { app.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`; return; }

    const importBtn = `<button class="btn btn-ghost" id="import-btn">Import results</button>`;

    app.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Results</div>
          <p class="page-sub">${escapeHtml(activeGroup().name)} &middot; ${rows.length} result${rows.length === 1 ? '' : 's'}</p>
        </div>
        <div style="display:flex; gap:10px">
          ${importBtn}
          <button class="btn btn-primary" id="add-btn">+ Log result</button>
        </div>
      </div>
      ${rows.length ? tableHtml(rows) : emptyHtml()}`;

    document.getElementById('add-btn').onclick = () => openForm();
    const addEmpty = document.getElementById('add-empty');
    if (addEmpty) addEmpty.onclick = () => openForm();
    const impBtn = document.getElementById('import-btn');
    if (impBtn) impBtn.onclick = () => openImport();

    app.querySelectorAll('[data-edit]').forEach(b =>
      b.onclick = () => {
        const row = rows.find(r => r.id === b.dataset.edit);
        row.source === 'public' ? openTagAthletes(row) : openForm(row);
      });
    app.querySelectorAll('[data-del]').forEach(b =>
      b.onclick = () => removeResult(rows.find(r => r.id === b.dataset.del)));
    app.querySelectorAll('[data-wx]').forEach(b =>
      b.onclick = () => {
        const r = rows.find(x => x.id === b.dataset.wx);
        const label = [r.crew_label, r.event].filter(Boolean).join(' - ') || 'Race';
        window.wxOpen(r.clock, label, r.boat_class, r.performed_at, r.venue);
      });
  }

  function tableHtml(rows) {
    return `<div class="table-wrap"><table class="data">
      <thead><tr><th>Date</th><th>Type</th><th>Crew / athletes</th><th>Dist</th><th>Time</th><th>Split / GMT%</th><th></th></tr></thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table></div>`;
  }

  function rowHtml(r) {
    const isPublic = r.source === 'public';
    const typePill = isPublic ? 'Race' : (r.piece_type === 'erg' ? 'Erg' : 'Water');
    const tagged = (r.result_athletes || []).map(x => x.athletes?.name).filter(Boolean);

    let who;
    if (isPublic) {
      const sub = [r.event, r.regatta].filter(Boolean).map(escapeHtml).join(' &middot; ');
      const chip = conditionsChip(r);
      who = `<strong>${escapeHtml(r.crew_label || r.crew?.name || '-')}</strong>`
          + (sub ? `<div class="muted">${sub}</div>` : '')
          + (tagged.length ? `<div class="muted">with: ${escapeHtml(tagged.join(', '))}</div>` : '')
          + (chip ? `<div>${chip}</div>` : '');
    } else if (r.crew?.name) {
      who = `<strong>${escapeHtml(r.crew.name)}</strong>`
          + (tagged.length ? `<div class="muted">${escapeHtml(tagged.join(', '))}</div>` : '');
    } else {
      who = tagged.length ? escapeHtml(tagged.join(', ')) : '<span class="muted">-</span>';
    }

    const dist = isPublic
      ? (r.boat_class ? `<span class="pill">${escapeHtml(r.boat_class)}</span>` : '<span class="muted">-</span>')
      : `${r.distance_m.toLocaleString()} m`;
    const metric = isPublic
      ? (r.pct != null ? `<strong>${r.pct}%</strong> <span class="muted">GMT</span>` : '<span class="muted">-</span>')
      : formatSplit(r.time_ms, r.distance_m);

    return `<tr>
      <td>${fmtDate(r.performed_at)}</td>
      <td><span class="pill">${typePill}</span></td>
      <td>${who}</td>
      <td>${dist}</td>
      <td><strong>${formatMs(r.time_ms)}</strong>${r.rate ? ` <span class="muted">r${r.rate}</span>` : ''}</td>
      <td>${metric}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-edit="${r.id}">${isPublic ? 'Tag' : 'Edit'}</button>
        <button class="icon-btn danger" data-del="${r.id}">Delete</button>
      </div></td>
    </tr>`;
  }

  function emptyHtml() {
    return `<div class="empty">
      <h2>No results yet</h2>
      <p>Log your first piece - an erg test or an on-water row - or use <strong>Import results</strong> to pull a club's regatta results in from the main site. Tag it to a crew and the athletes who did it, and the split is worked out for you.</p>
      <button class="btn btn-primary" id="add-empty">+ Log your first result</button>
    </div>`;
  }

  // ---- Import public results: pick any club, then choose results ----
  async function openImport() {
    const [allClubs, { data: imported }] = await Promise.all([
      ClubData.clubs().catch(() => []),
      sb.from('results').select('public_ref').eq('group_id', RT.activeGroupId).not('public_ref', 'is', null),
    ]);
    const have = new Set((imported || []).map(r => r.public_ref));
    // Default the picker to the squad's attached club if it's a real match - but
    // you can type any club; nothing is auto-matched.
    const attached = activeGroup().club_name;
    const def = attached && allClubs.includes(attached) ? attached : '';

    let currentEntries = [];

    const { form } = openModal({
      title: 'Import club results',
      submitLabel: 'Import selected',
      bodyHtml: `
        <div class="field">
          <label for="im-club">Club</label>
          <input class="input" id="im-club" list="im-club-list" value="${escapeHtml(def)}" placeholder="Start typing to find a club" autocomplete="off">
          <datalist id="im-club-list">${allClubs.map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
        </div>
        <div id="im-results"><p class="muted">Pick a club to see its results.</p></div>`,
      onSubmit: async (form, close) => {
        const picks = [...form.querySelectorAll('input[name="imp"]:checked')].map(c => currentEntries[parseInt(c.value, 10)]);
        if (!picks.length) throw new Error('Select at least one result.');

        // Fetch race-time weather for each (best-effort) so it's cached on import,
        // exactly the conditions the main site shows.
        const payload = (await Promise.all(picks.map(async e => {
          const time_ms = safeParse(e.time);
          if (time_ms == null) return null;
          const weather = await fetchRaceWeather(e.venue, e.date, e.clock);
          return {
            group_id: RT.activeGroupId,
            created_by: session.user.id,
            source: 'public',
            piece_type: 'water',
            performed_at: e.date,
            time_ms,
            distance_m: null,
            rate: null,
            pct: e.pct ?? null,
            event: e.event || null,
            regatta: e.regatta || null,
            round: e.round || null,
            clock: e.clock || null,
            boat_class: e.boat || null,
            crew_label: e.crew || null,
            venue: e.venue || null,
            weather,
            crew_id: null,
            public_ref: e.ref,
          };
        }))).filter(Boolean);

        const { error } = await sb.from('results')
          .upsert(payload, { onConflict: 'group_id,public_ref', ignoreDuplicates: true });
        if (error) throw error;
        toast(`Imported ${payload.length} result${payload.length === 1 ? '' : 's'}`);
        close();
        await render();
      },
    });

    const clubInput = form.querySelector('#im-club');
    const box = form.querySelector('#im-results');

    async function loadClub(clubName) {
      currentEntries = [];
      if (!clubName) { box.innerHTML = '<p class="muted">Pick a club to see its results.</p>'; return; }
      box.innerHTML = '<p class="muted">Loading...</p>';
      const entries = await ClubData.resultsForClub(clubName);
      const fresh = entries.filter(e => !have.has(e.ref));
      currentEntries = fresh;

      if (!entries.length) { box.innerHTML = `<p class="muted">No public results found for ${escapeHtml(clubName)}.</p>`; return; }
      if (!fresh.length) { box.innerHTML = `<p class="muted">All ${entries.length} of ${escapeHtml(clubName)}'s results are already imported.</p>`; return; }

      box.innerHTML = `
        <p class="muted" style="margin:4px 0 10px">${fresh.length} result${fresh.length === 1 ? '' : 's'} not yet imported.</p>
        <label class="check-row" style="border:none; padding-left:2px"><input type="checkbox" id="imp-all"><span><strong>Select all</strong></span></label>
        <div class="check-list">
          ${fresh.map((e, i) => `<label class="check-row">
            <input type="checkbox" name="imp" value="${i}">
            <span>${escapeHtml(e.event)} - <strong>${escapeHtml(e.crew)}</strong> &middot; ${escapeHtml(e.time)}${e.pct != null ? ` (${e.pct}%)` : ''}
              <div class="muted">${escapeHtml(e.regatta)} &middot; ${fmtDate(e.date)}</div></span>
          </label>`).join('')}
        </div>`;
      const all = box.querySelector('#imp-all');
      if (all) all.onclick = () => box.querySelectorAll('input[name="imp"]').forEach(cb => { cb.checked = all.checked; });
    }

    // Load when a full club name is entered (datalist pick fires 'input';
    // 'change' covers blur/enter).
    clubInput.addEventListener('change', () => loadClub(clubInput.value.trim()));
    clubInput.addEventListener('input', () => { if (allClubs.includes(clubInput.value.trim())) loadClub(clubInput.value.trim()); });
    if (def) loadClub(def);
  }

  // ---- Tag athletes onto an imported (public) result ----
  function openTagAthletes(result) {
    const pre = new Set((result.result_athletes || []).map(x => x.athlete_id));
    openModal({
      title: 'Tag athletes',
      submitLabel: 'Save',
      bodyHtml: `
        <p class="muted" style="margin-bottom:10px"><strong>${escapeHtml(result.crew_label || '')}</strong> - ${escapeHtml(result.event || '')} &middot; ${escapeHtml(result.regatta || '')}</p>
        ${roster.length ? `<div class="check-list">
          ${roster.map(a => `<label class="check-row">
            <input type="checkbox" name="athlete" value="${a.id}"${pre.has(a.id) ? ' checked' : ''}>
            <span>${escapeHtml(a.name)}</span></label>`).join('')}
        </div>` : '<p class="muted">No athletes in the roster yet. Add some on the Roster page.</p>'}`,
      onSubmit: async (form, close) => {
        const ids = [...form.querySelectorAll('input[name="athlete"]:checked')].map(c => c.value);
        const { error: dErr } = await sb.from('result_athletes').delete().eq('result_id', result.id);
        if (dErr) throw dErr;
        if (ids.length) {
          const { error } = await sb.from('result_athletes').insert(ids.map(aid => ({ result_id: result.id, athlete_id: aid })));
          if (error) throw error;
        }
        toast('Athletes tagged');
        close();
        await render();
      },
    });
  }

  // ---- Manual log / edit ----
  async function openForm(result) {
    const editing = !!result;
    const today = new Date().toISOString().slice(0, 10);
    const preAthletes = new Set(editing ? (result.result_athletes || []).map(x => x.athlete_id) : []);

    openModal({
      title: editing ? 'Edit result' : 'Log result',
      submitLabel: editing ? 'Save changes' : 'Log result',
      bodyHtml: `
        <div class="form-row">
          <div class="field">
            <label for="f-date">Date</label>
            <input class="input" id="f-date" name="performed_at" type="date" required value="${editing ? result.performed_at : today}">
          </div>
          <div class="field">
            <label for="f-type">Type</label>
            <select class="input-select" id="f-type" name="piece_type">
              <option value="water"${editing && result.piece_type === 'water' ? ' selected' : ''}>On water</option>
              <option value="erg"${editing && result.piece_type === 'erg' ? ' selected' : ''}>Erg</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="f-distance">Distance (m)</label>
            <input class="input" id="f-distance" name="distance_m" list="dist-list" inputmode="numeric"
                   required value="${editing ? result.distance_m : ''}" placeholder="2000">
            <datalist id="dist-list">${COMMON_DISTANCES.map(d => `<option value="${d}">`).join('')}</datalist>
          </div>
          <div class="field">
            <label for="f-time">Time</label>
            <input class="input" id="f-time" name="time" required value="${editing ? formatMs(result.time_ms) : ''}" placeholder="6:23.4">
          </div>
          <div class="field" style="max-width:90px">
            <label for="f-rate">Rate</label>
            <input class="input" id="f-rate" name="rate" inputmode="numeric" value="${editing && result.rate ? result.rate : ''}" placeholder="-">
          </div>
        </div>
        <div class="field">
          <label for="f-crew">Use a saved crew (optional)</label>
          <select class="input-select" id="f-crew" name="crew_id">
            <option value="">-</option>
            ${crews.map(c => `<option value="${c.id}"${editing && result.crew_id === c.id ? ' selected' : ''}>${escapeHtml(crewLabel(c.id))}</option>`).join('')}
          </select>
          ${crews.length ? '<p class="muted" style="margin-top:6px">Picking a crew ticks its athletes below. Otherwise just tick athletes - the combination becomes a crew.</p>' : ''}
        </div>
        <div class="field">
          <label>Athletes</label>
          ${roster.length ? `<div class="check-list" id="athlete-list">
            ${roster.map(a => `<label class="check-row">
              <input type="checkbox" name="athlete" value="${a.id}"${preAthletes.has(a.id) ? ' checked' : ''}>
              <span>${escapeHtml(a.name)}</span></label>`).join('')}
          </div>` : '<p class="muted">No athletes in the roster yet.</p>'}
        </div>
        <div class="field">
          <label for="f-notes">Notes</label>
          <input class="input" id="f-notes" name="notes" value="${editing && result.notes ? escapeHtml(result.notes) : ''}" placeholder="Optional">
        </div>`,
      onSubmit: async (form, close) => {
        const fd = new FormData(form);
        const distance = parseInt(fd.get('distance_m'), 10);
        if (!Number.isFinite(distance) || distance <= 0) throw new Error('Enter a distance in metres.');
        const time_ms = parseTimeToMs(fd.get('time'));
        const rateRaw = fd.get('rate').trim();
        const rate = rateRaw ? parseInt(rateRaw, 10) : null;
        if (rateRaw && (!Number.isFinite(rate) || rate <= 0)) throw new Error('Rate must be a number.');

        const athleteIds = [...form.querySelectorAll('input[name="athlete"]:checked')].map(c => c.value);

        // The crew is DERIVED from the tagged athlete-set (find-or-create).
        let crewId = null;
        if (athleteIds.length) {
          const { data: cid, error: cErr } = await sb.rpc('upsert_crew', {
            p_group_id: RT.activeGroupId, p_athlete_ids: athleteIds,
          });
          if (cErr) throw cErr;
          crewId = cid;
        }

        const payload = {
          performed_at: fd.get('performed_at'),
          piece_type: fd.get('piece_type'),
          distance_m: distance,
          time_ms,
          rate,
          crew_id: crewId,
          notes: fd.get('notes').trim() || null,
        };

        let resultId;
        if (editing) {
          const { error } = await sb.from('results').update(payload).eq('id', result.id);
          if (error) throw error;
          resultId = result.id;
          const { error: dErr } = await sb.from('result_athletes').delete().eq('result_id', resultId);
          if (dErr) throw dErr;
        } else {
          const { data, error } = await sb.from('results')
            .insert({ ...payload, group_id: RT.activeGroupId, created_by: session.user.id })
            .select('id').single();
          if (error) throw error;
          resultId = data.id;
        }

        if (athleteIds.length) {
          const { error: aErr } = await sb.from('result_athletes')
            .insert(athleteIds.map(aid => ({ result_id: resultId, athlete_id: aid })));
          if (aErr) throw aErr;
        }

        toast(editing ? 'Result updated' : 'Result logged');
        close();
        await render();
      },
    });

    // Picking a saved crew sets the athlete ticks to exactly that crew's set.
    const crewSel = document.getElementById('f-crew');
    if (crewSel) {
      crewSel.addEventListener('change', () => {
        if (!crewSel.value) return;
        const ids = lineups[crewSel.value] || [];
        document.querySelectorAll('#athlete-list input[name="athlete"]').forEach(cb => {
          cb.checked = ids.includes(cb.value);
        });
      });
    }
  }

  async function removeResult(r) {
    if (!confirm('Delete this result? It moves to the bin and is removed permanently after 48 hours.')) return;
    const { error } = await sb.from('results').update({ deleted_at: new Date().toISOString() }).eq('id', r.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Result deleted');
    await render();
  }

  function safeParse(t) { try { return parseTimeToMs(t); } catch (e) { return null; } }

  function fmtDate(d) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
})();
