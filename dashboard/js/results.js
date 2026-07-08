// results.js - log/edit pieces, tag a crew + athletes, show /500m split, and
// import a squad's public regatta results from the main site.
(async function () {
  const app = document.getElementById('app');
  const COMMON_DISTANCES = [2000, 5000, 6000, 500, 1000, 1500];
  const WIND_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2"/><path d="M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2"/><path d="M12.59 19.41A2 2 0 1 0 14 16H2"/></svg>';

  // A result's location for the conditions modal, as {name,lat,lon,bearing,lanes}.
  // Imported races carry a venue jsonb; water pieces logged on the map carry
  // start/finish coords instead, so synthesise a venue from the course midpoint.
  function resultVenue(r) {
    if (r.venue && r.venue.lat != null) return r.venue;
    if (r.start_lat != null) {
      const lat = r.finish_lat != null ? (r.start_lat + r.finish_lat) / 2 : r.start_lat;
      const lon = r.finish_lng != null ? (r.start_lng + r.finish_lng) / 2 : r.start_lng;
      return { name: r.location_name || 'Water piece', lat, lon, bearing: r.bearing ?? 0, lanes: 1 };
    }
    return null;
  }

  // Conditions chip for any race/piece with a location + clock time; opens the
  // shared conditions.js modal (live weather + wind-vs-course), same as the main
  // site. Works for imported races and mapped water pieces alike.
  function conditionsChip(r) {
    if (!r.clock || !resultVenue(r)) return '';
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
  let activeBenchmark = null, allBenchmarks = [];
  let allResults = [];
  let filters = {
    athletes: new Set(),
    crews: new Set(),
    types: new Set(),
    dateFrom: null,
    dateTo: null,
    sort: 'date-desc',
    normalize: false,   // show times/GMT% normalised to calm conditions
  };

  // Displayed time for a row under the current normalise setting (shared
  // definition lives in metrics.js so Results and Analytics always agree).
  function displayTimeMs(r) {
    if (!filters.normalize) return r.time_ms;
    return RTM.normaliseResultRow(r)?.timeMs ?? r.time_ms;
  }

  async function loadRefs() {
    const [{ data: r }, { data: c }, { data: b }] = await Promise.all([
      sb.from('athletes').select('id, name').eq('group_id', RT.activeGroupId).is('deleted_at', null).order('name'),
      sb.from('crews').select('id, name').eq('group_id', RT.activeGroupId).is('deleted_at', null).order('created_at'),
      sb.from('benchmarks').select('id, name').eq('group_id', RT.activeGroupId).is('deleted_at', null).order('created_at'),
    ]);
    roster = r || [];
    crews = c || [];
    allBenchmarks = b || [];
    nameById = Object.fromEntries(roster.map(a => [a.id, a.name]));
    lineups = {};
    if (crews.length) {
      const { data: cm } = await sb.from('crew_members').select('crew_id, athlete_id').in('crew_id', crews.map(x => x.id));
      (cm || []).forEach(m => { (lineups[m.crew_id] = lineups[m.crew_id] || []).push(m.athlete_id); });
    }
    const activeId = activeGroup().active_benchmark_id;
    if (activeId) {
      activeBenchmark = await getActiveBenchmark(RT.activeGroupId);
    } else {
      activeBenchmark = null;
    }
  }

  // A crew's display label: its name, or the athletes that make it up.
  function crewLabel(crewId) {
    const c = crews.find(x => x.id === crewId);
    if (!c) return '';
    if (c.name) return c.name;
    return (lineups[crewId] || []).map(id => nameById[id] || '?').join(', ') || 'Empty crew';
  }

  function applyFilters(rows) {
    let result = [...rows];   // copy so sorting never mutates allResults

    if (filters.athletes.size) {
      result = result.filter(r => (r.result_athletes || []).some(a => filters.athletes.has(a.athletes?.name)));
    }
    if (filters.crews.size) {
      result = result.filter(r => filters.crews.has(r.crew?.name));
    }
    if (filters.types.size) {
      result = result.filter(r => {
        const type = r.source === 'public' ? 'Race' : r.piece_type === 'erg' ? 'Erg' : 'Water';
        return filters.types.has(type);
      });
    }

    // Sort. Time sorts compare the DISPLAYED time, so the order matches the
    // column when "Normalise for wind" is on.
    if (filters.sort === 'date-asc') {
      result.sort((a, b) => new Date(a.performed_at) - new Date(b.performed_at));
    } else if (filters.sort === 'time-fast' || filters.sort === 'time-slow') {
      const shown = new Map(result.map(r => [r.id, displayTimeMs(r)]));
      const dir = filters.sort === 'time-fast' ? 1 : -1;
      result.sort((a, b) => (shown.get(a.id) - shown.get(b.id)) * dir);
    } else {
      result.sort((a, b) => new Date(b.performed_at) - new Date(a.performed_at));
    }

    return result;
  }

  await loadRefs();
  await refresh();

  // Fetch from the DB, then draw. Filter changes only need render() - no
  // point re-querying (and re-flashing the page) to narrow a list we have.
  async function refresh() {
    const { data: rows, error } = await sb
      .from('results')
      .select('*, crew:crews(id,name), result_athletes(athlete_id, athletes(name))')
      .eq('group_id', RT.activeGroupId)
      .is('deleted_at', null)
      .order('performed_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) { app.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`; return; }

    allResults = rows || [];
    render();
  }

  function render() {
    const scrollY = window.scrollY;   // full re-render; keep the user's place
    const filtered = applyFilters(allResults);

    const importBtn = `<button class="btn btn-ghost" id="import-btn">Import results</button>`;
    const benchmarkLabel = activeBenchmark
      ? `<span style="font-size:13px; color:var(--ink-2)">Benchmark: <strong>${escapeHtml(activeBenchmark.name)}</strong></span>`
      : '<span style="font-size:13px; color:var(--ink-3)">No benchmark set</span>';
    const benchmarkSelector = isActiveAdmin() && allBenchmarks.length
      ? `<select id="benchmark-sel" class="input-select" style="width:auto; max-width:240px; margin-top:4px">${allBenchmarks.map(b => `<option value="${b.id}"${activeBenchmark?.id === b.id ? ' selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}</select>`
      : '';

    const allAthletes = [...new Set(allResults.flatMap(r => (r.result_athletes || []).map(a => a.athletes?.name).filter(Boolean)))].sort();
    const allCrews = [...new Set(allResults.map(r => r.crew?.name).filter(Boolean))].sort();
    const allTypes = [...new Set(allResults.map(r => r.source === 'public' ? 'Race' : r.piece_type === 'erg' ? 'Erg' : 'Water'))].sort();

    app.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Results</div>
          <p class="page-sub">${escapeHtml(activeGroup().name)} &middot; ${filtered.length} of ${allResults.length} result${allResults.length === 1 ? '' : 's'}</p>
          <div style="margin-top:8px">${benchmarkLabel}${benchmarkSelector ? '<br>' + benchmarkSelector : ''}</div>
        </div>
        <div style="display:flex; gap:10px">
          ${importBtn}
          <a class="btn btn-ghost" href="piece.html">+ Water piece (map)</a>
          <button class="btn btn-primary" id="add-btn">+ Log result</button>
        </div>
      </div>

      <div class="filter-panel">
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:20px; align-items:start">
          ${allAthletes.length ? `
            <div>
              <div style="font-size:12px; font-weight:600; margin-bottom:8px; color:var(--ink-2)">ATHLETES</div>
              <div style="display:flex; flex-direction:column; gap:4px">${allAthletes.map(a => `
                <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer">
                  <input type="checkbox" class="filter-athlete-cb" value="${escapeHtml(a)}"${filters.athletes.has(a) ? ' checked' : ''}> ${escapeHtml(a)}
                </label>`).join('')}</div>
            </div>
          ` : ''}
          ${allCrews.length ? `
            <div>
              <div style="font-size:12px; font-weight:600; margin-bottom:8px; color:var(--ink-2)">CREWS</div>
              <div style="display:flex; flex-direction:column; gap:4px">${allCrews.map(c => `
                <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer">
                  <input type="checkbox" class="filter-crew-cb" value="${escapeHtml(c)}"${filters.crews.has(c) ? ' checked' : ''}> ${escapeHtml(c)}
                </label>`).join('')}</div>
            </div>
          ` : ''}
          <div>
            <div style="font-size:12px; font-weight:600; margin-bottom:8px; color:var(--ink-2)">TYPE</div>
            <div style="display:flex; flex-direction:column; gap:4px">${allTypes.map(t => `
              <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer">
                <input type="checkbox" class="filter-type-cb" value="${t}"${filters.types.has(t) ? ' checked' : ''}> ${escapeHtml(t)}
              </label>`).join('')}</div>
          </div>
          <div>
            <div style="font-size:12px; font-weight:600; margin-bottom:8px; color:var(--ink-2)">SORT</div>
            <select id="filter-sort" class="input-select" style="width:100%">
              ${[['date-desc', 'Newest first'], ['date-asc', 'Oldest first'], ['time-fast', 'Fastest'], ['time-slow', 'Slowest']]
                .map(([v, l]) => `<option value="${v}"${filters.sort === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
            <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer; margin-top:10px">
              <input type="checkbox" id="filter-norm"${filters.normalize ? ' checked' : ''}> Normalise for wind
            </label>
            <button class="btn btn-ghost" id="clear-filters" style="width:100%; margin-top:8px; padding:7px 12px; font-size:12px">Clear all</button>
          </div>
        </div>
      </div>

      ${filtered.length ? tableHtml(filtered) : emptyHtml()}`;

    window.scrollTo(0, scrollY);

    document.getElementById('add-btn').onclick = () => openForm();
    const addEmpty = document.getElementById('add-empty');
    if (addEmpty) addEmpty.onclick = () => openForm();
    const impBtn = document.getElementById('import-btn');
    if (impBtn) impBtn.onclick = () => openImport();

    // Filter bindings
    const updateFilters = () => {
      filters.athletes = new Set([...document.querySelectorAll('.filter-athlete-cb:checked')].map(c => c.value));
      filters.crews = new Set([...document.querySelectorAll('.filter-crew-cb:checked')].map(c => c.value));
      filters.types = new Set([...document.querySelectorAll('.filter-type-cb:checked')].map(c => c.value));
      filters.sort = document.getElementById('filter-sort').value;
      filters.normalize = document.getElementById('filter-norm').checked;
      render();
    };
    document.getElementById('filter-norm').onchange = updateFilters;

    document.querySelectorAll('.filter-athlete-cb, .filter-crew-cb, .filter-type-cb').forEach(cb => cb.onchange = updateFilters);
    document.getElementById('filter-sort').onchange = updateFilters;
    document.getElementById('clear-filters').onclick = () => {
      document.querySelectorAll('.filter-athlete-cb, .filter-crew-cb, .filter-type-cb').forEach(cb => cb.checked = false);
      document.getElementById('filter-sort').value = 'date-desc';
      document.getElementById('filter-norm').checked = false;
      updateFilters();
    };

    const benchmarkSel = document.getElementById('benchmark-sel');
    if (benchmarkSel) {
      benchmarkSel.onchange = async () => {
        try {
          await setActiveBenchmark(benchmarkSel.value);
          // reload so GMT% is computed against the newly selected benchmark
          activeBenchmark = await getActiveBenchmark(RT.activeGroupId);
        } catch (e) {
          toast(e.message || 'Could not set benchmark', 'error');
        }
        render();
      };
    }

    app.querySelectorAll('[data-edit]').forEach(b =>
      b.onclick = () => {
        const row = allResults.find(r => r.id === b.dataset.edit);
        row.source === 'public' ? openTagAthletes(row) : openForm(row);
      });
    app.querySelectorAll('[data-del]').forEach(b =>
      b.onclick = () => removeResult(allResults.find(r => r.id === b.dataset.del)));
    app.querySelectorAll('[data-wx]').forEach(b =>
      b.onclick = () => {
        const r = allResults.find(x => x.id === b.dataset.wx);
        const label = [r.crew_label || r.crew?.name, r.event || r.location_name].filter(Boolean).join(' - ') || 'Piece';
        window.wxOpen(r.clock, label, r.boat_class, r.performed_at, resultVenue(r));
      });
  }

  function tableHtml(rows) {
    // Separate public (imports) from manual
    const publicRows = rows.filter(r => r.source === 'public');
    const manualRows = rows.filter(r => r.source !== 'public');

    // Group public by regatta
    const byRegatta = {};
    publicRows.forEach(r => {
      const key = r.regatta || 'Other';
      if (!byRegatta[key]) byRegatta[key] = [];
      byRegatta[key].push(r);
    });

    // Group manual by date
    const byDate = {};
    manualRows.forEach(r => {
      const key = r.performed_at;
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(r);
    });

    const html = [];

    // Render regatta sections
    Object.entries(byRegatta).forEach(([regatta, rows]) => {
      html.push(`<div class="result-section">
        <h3 class="result-section-head">${escapeHtml(regatta)}</h3>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Date</th><th>Type</th><th>Crew / athletes</th><th>Dist</th><th>Time</th><th>Split / GMT%</th><th></th></tr></thead>
          <tbody>${rows.map(rowHtml).join('')}</tbody>
        </table></div>
      </div>`);
    });

    // Render date sections
    Object.entries(byDate).sort().reverse().forEach(([date, rows]) => {
      html.push(`<div class="result-section">
        <h3 class="result-section-head">${fmtDate(date)}</h3>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Date</th><th>Type</th><th>Crew / athletes</th><th>Dist</th><th>Time</th><th>Split / GMT%</th><th></th></tr></thead>
          <tbody>${rows.map(rowHtml).join('')}</tbody>
        </table></div>
      </div>`);
    });

    return html.join('');
  }

  function rowHtml(r) {
    const isPublic = r.source === 'public';
    const typePill = isPublic ? 'Race' : (r.piece_type === 'erg' ? 'Erg' : 'Water');
    const tagged = (r.result_athletes || []).map(x => x.athletes?.name).filter(Boolean);

    // Conditions normalisation (single shared definition in metrics.js).
    const norm = filters.normalize ? RTM.normaliseResultRow(r) : null;
    const shownMs = norm ? norm.timeMs : r.time_ms;
    const isNorm = !!norm;
    const normMark = isNorm
      ? ` <span class="norm-mark" title="Normalised to calm conditions - raw ${formatMs(r.time_ms)}">≈</span>`
      : '';

    const chip = conditionsChip(r);
    let who;
    if (isPublic) {
      const sub = [r.event, r.regatta].filter(Boolean).map(escapeHtml).join(' &middot; ');
      who = `<strong>${escapeHtml(r.crew_label || r.crew?.name || '-')}</strong>`
          + (sub ? `<div class="muted">${sub}</div>` : '')
          + (tagged.length ? `<div class="muted">with: ${escapeHtml(tagged.join(', '))}</div>` : '');
    } else if (r.crew?.name) {
      who = `<strong>${escapeHtml(r.crew.name)}</strong>`
          + (tagged.length ? `<div class="muted">${escapeHtml(tagged.join(', '))}</div>` : '');
    } else {
      who = tagged.length ? escapeHtml(tagged.join(', ')) : '<span class="muted">-</span>';
    }
    // Conditions chip on any row that has a location + clock (mapped water
    // pieces as well as imported races), not just public imports.
    if (chip) who += `<div>${chip}</div>`;

    const dist = isPublic
      ? (r.boat_class ? `<span class="pill">${escapeHtml(r.boat_class)}</span>` : '<span class="muted">-</span>')
      : (r.distance_m != null ? `${r.distance_m.toLocaleString()} m` : '<span class="muted">-</span>');

    let metric;
    if (isPublic) {
      const pctShown = r.pct != null ? (isNorm ? Math.round(r.pct * norm.f * 10) / 10 : r.pct) : null;
      metric = pctShown != null ? `<strong>${pctShown}%</strong> <span class="muted">GMT</span>${normMark}` : '<span class="muted">-</span>';
    } else {
      // Manual result: GMT% if the active benchmark covers the boat class,
      // else the /500m split. GMT% = reference / yours (matches the site).
      const refTime = benchRefTime(activeBenchmark, r.boat_class);
      if (refTime) {
        const gmt = Math.round((refTime / shownMs) * 100 * 10) / 10;
        metric = `<strong>${gmt}%</strong> <span class="muted">GMT</span>${normMark}`;
      } else {
        metric = formatSplit(shownMs, r.distance_m) + normMark;
      }
    }

    return `<tr>
      <td>${fmtDate(r.performed_at)}</td>
      <td><span class="pill">${typePill}</span></td>
      <td>${who}</td>
      <td>${dist}</td>
      <td><strong>${formatMs(shownMs)}</strong>${r.rate ? ` <span class="muted">r${r.rate}</span>` : ''}${normMark}</td>
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

        // Fetch race-time weather for each (best-effort) so it's cached on
        // import. Deduped per venue/date/hour - a regatta's results mostly
        // share one weather lookup, so N picks is not N fetches.
        const wxCache = new Map();
        const wxFor = (venue, date, clock) => {
          const key = venue ? `${venue.lat},${venue.lon},${date},${clockToHour(clock)}` : 'none';
          if (!wxCache.has(key)) wxCache.set(key, fetchRaceWeather(venue, date, clock));
          return wxCache.get(key);
        };
        const payload = (await Promise.all(picks.map(async e => {
          const time_ms = safeParse(e.time);
          if (time_ms == null) return null;
          const weather = await wxFor(e.venue, e.date, e.clock);
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
        await refresh();
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
        await refresh();
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
          <div class="field" style="max-width:100px">
            <label for="f-boat">Boat class</label>
            <input class="input" id="f-boat" name="boat_class" value="${editing && result.boat_class ? escapeHtml(result.boat_class) : ''}" placeholder="M4x" autocomplete="off">
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
          boat_class: fd.get('boat_class').trim() || null,
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
        await refresh();
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
    await refresh();
  }

  function safeParse(t) { try { return parseTimeToMs(t); } catch (e) { return null; } }
})().catch(e => {
  // Surface boot failures instead of sitting on "Loading..." forever.
  console.error(e);
  const app = document.getElementById('app');
  if (app) app.innerHTML = `<div class="error-box">This page failed to load: ${escapeHtml(e.message || String(e))}</div>`;
});
