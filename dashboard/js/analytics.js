// analytics.js - the coach reporting layer. One page, four linked views over
// the squad's results (manual water/erg pieces + imported race results):
//
//   1. Speed vs distance (log x) - every piece as a point, coloured by rate
//      band, faded by age, with GMT reference curves and the squad's own
//      fitted drop-off envelope. The interactive version of the coach's chart.
//   2. Progression over time - % of benchmark by date, grouped by crew,
//      athlete or boat class.
//   3. Athlete comparison - best % of benchmark per athlete in the window.
//   4. Wind sensitivity - how far off the squad's envelope each water piece
//      was vs the headwind it faced, with a fitted trend.
//
// "% of benchmark" = race GMT% for imported results; for training pieces it is
// the prognostic %: speed vs the benchmark 2000m speed slid to the piece's own
// distance along the power-law drop-off (see metrics.js). That is what makes a
// 500m burst and a 5k comparable on one axis.
(async function () {
  const app = document.getElementById('app');

  const session = await requireAuth();
  if (!session) return;
  await loadContext();
  if (!RT.memberships.length) { window.location.replace('index.html'); return; }
  renderHeader('analytics.html');

  // ---- load everything once ----
  // (a failure here is surfaced by the boot catch rather than silently
  // degrading the page to no-benchmark mode)
  const bench = await getActiveBenchmark(RT.activeGroupId);

  // Newest first: supabase caps a query at 1000 rows, so if a squad ever
  // exceeds that it is the OLD pieces that fall off the charts, not the new.
  const { data: rows, error } = await sb
    .from('results')
    .select('*, crew:crews(id,name), result_athletes(athlete_id, athletes(name))')
    .eq('group_id', RT.activeGroupId)
    .is('deleted_at', null)
    .order('performed_at', { ascending: false });
  if (error) { app.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`; return; }

  // ---- normalise into piece objects ----
  const NOW = Date.now();
  const pieces = (rows || []).map(r => {
    const type = r.source === 'public' ? 'Race' : (r.piece_type === 'erg' ? 'Erg' : 'Water');
    const v = RTM.speedOf(r.distance_m, r.time_ms);
    const athletes = (r.result_athletes || []).map(x => x.athletes?.name).filter(Boolean);

    // Crew identity = a tagged crew or a tagged athlete-set, never the public
    // race label ("M1x Lea Rowing Club" is not the same crew across regattas).
    // Untagged races keep crewKey null and stay out of crew groupings; their
    // label is only used for display.
    let crewKey = null, crewName = null;
    if (r.crew_id) {
      crewKey = 'crew:' + r.crew_id;
      crewName = r.crew?.name || (athletes.length ? athletes.join(', ') : 'Unnamed crew');
    } else if (athletes.length) {
      crewKey = 'ath:' + [...athletes].sort().join('|');
      crewName = athletes.join(', ');
    }
    const raceLabel = r.crew_label || null;

    // Wind geometry: course bearing comes from the piece logger for manual
    // pieces, or the venue record for imported races. head/cross prefer the
    // values cached at log time.
    const bearing = r.bearing ?? r.venue?.bearing ?? null;
    let head = null, cross = null;
    const w = r.weather;
    if (w && w.head_ms != null) { head = w.head_ms; cross = w.cross_ms ?? null; }
    else if (w && w.wdir != null && w.wspd != null && bearing != null) {
      const c = RTM.windComponents(w.wdir, w.wspd / 3.6, bearing);
      if (c) { head = c.head; cross = c.cross; }
    }

    return {
      id: r.id, date: r.performed_at, t: new Date(r.performed_at + 'T12:00:00').getTime(),
      type, d: r.distance_m, timeMs: r.time_ms, v, rate: r.rate,
      boat: r.boat_class || null, crewKey, crewName, raceLabel, athletes,
      head, cross, bearing,
      wdir: w?.wdir ?? null, wspdMs: w?.wspd != null ? w.wspd / 3.6 : null,
      current: r.stream?.current_ms ?? null,
      // calm-conditions conversion, computed once (shared def in metrics.js)
      norm: RTM.normaliseResultRow(r),
      stream: r.stream || null,
      racePct: r.pct != null ? Number(r.pct) : null,
      regatta: r.regatta, event: r.event, notes: r.notes,
      ageDays: Math.max(0, (NOW - new Date(r.performed_at).getTime()) / 86400000),
    };
  });

  if (!pieces.length) { renderEmpty(); return; }

  // ---- state ----
  const state = {
    preset: 'season',         // 'season' | '90' | 'all'
    types: new Set(['Water', 'Erg', 'Race']),
    boat: '', athlete: '', crew: '',
    windAdj: false,
    groupBy: 'crew',          // progression grouping
  };

  function seasonStart() {
    const now = new Date();
    const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return new Date(y, 8, 1).getTime();          // 1 September
  }

  function filtered() {
    const from = state.preset === 'all' ? 0
      : state.preset === '90' ? NOW - 90 * 86400000
      : seasonStart();
    return pieces.filter(p =>
      p.t >= from
      && state.types.has(p.type)
      && (!state.boat || p.boat === state.boat)
      && (!state.athlete || p.athletes.includes(state.athlete))
      && (!state.crew || p.crewName === state.crew));
  }

  // Conditions-normalised speed (water pieces only). The conversion itself is
  // RTM.normaliseResultRow, precomputed per piece at load.
  function vShown(p) {
    if (!state.windAdj || p.type !== 'Water' || p.v == null) return p.v;
    return p.norm?.v ?? p.v;
  }

  function benchTimeFor(boat) { return benchRefTime(bench, boat); }

  // Squad drop-off exponent: envelope fit over the filtered water pieces
  // (falls back over all water pieces, then the default constant).
  function squadFit(set) {
    const water = set.filter(p => p.type === 'Water' && p.d && p.v);
    let fit = RTM.fitEnvelope(water.map(p => ({ d: p.d, v: vShown(p) })));
    if (!fit) {
      const all = pieces.filter(p => p.type === 'Water' && p.d && p.v);
      fit = RTM.fitEnvelope(all.map(p => ({ d: p.d, v: p.v })));
    }
    return fit;
  }

  function pctOf(p, exponent) {
    if (p.type === 'Race') {
      // GMT% scales with speed, so the normalisation factor applies directly.
      if (state.windAdj && p.racePct != null && p.norm) return p.racePct * p.norm.f;
      return p.racePct;
    }
    const bt = benchTimeFor(p.boat);
    if (!bt || !p.d || !p.v) return null;
    const ref = RTM.benchmarkSpeedAt(p.d, bt, exponent);
    return ref > 0 ? vShown(p) / ref * 100 : null;
  }

  // ---- shell ----
  const boats = [...new Set(pieces.map(p => p.boat).filter(Boolean))].sort();
  const athleteNames = [...new Set(pieces.flatMap(p => p.athletes))].sort();
  const crewNames = [...new Set(pieces.filter(p => p.crewKey).map(p => p.crewName))].sort();

  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Analytics</div>
        <p class="page-sub">${escapeHtml(activeGroup().name)} &middot; <span id="an-count"></span></p>
      </div>
      <div style="display:flex; gap:10px">
        <a class="btn btn-ghost" href="adjust.html">Distance adjuster</a>
        <a class="btn btn-primary" href="piece.html">+ Log water piece</a>
      </div>
    </div>

    <div class="filter-panel an-filters">
      <div class="an-filter-group">
        <span class="an-filter-label">Window</span>
        <select id="an-preset" class="input-select">
          <option value="season">This season (since 1 Sep)</option>
          <option value="90">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </div>
      <div class="an-filter-group">
        <span class="an-filter-label">Type</span>
        <div class="chip-row" id="an-types">
          ${['Water', 'Erg', 'Race'].map(t => `<button class="chip on" data-type="${t}">${t}</button>`).join('')}
        </div>
      </div>
      <div class="an-filter-group">
        <span class="an-filter-label">Boat class</span>
        <select id="an-boat" class="input-select"><option value="">All</option>
          ${boats.map(b => `<option>${escapeHtml(b)}</option>`).join('')}</select>
      </div>
      <div class="an-filter-group">
        <span class="an-filter-label">Athlete</span>
        <select id="an-athlete" class="input-select"><option value="">All</option>
          ${athleteNames.map(a => `<option>${escapeHtml(a)}</option>`).join('')}</select>
      </div>
      <div class="an-filter-group">
        <span class="an-filter-label">Crew</span>
        <select id="an-crew" class="input-select"><option value="">All</option>
          ${crewNames.map(c => `<option>${escapeHtml(c)}</option>`).join('')}</select>
      </div>
      <div class="an-filter-group">
        <span class="an-filter-label">Wind</span>
        <label class="chip-toggle"><input type="checkbox" id="an-wind"><span>Normalise for conditions</span></label>
      </div>
    </div>

    <div class="grid an-kpis" id="an-kpis"></div>

    <div class="card chart-card">
      <div class="chart-head">
        <div>
          <div class="chart-title">Speed vs distance</div>
        <div class="chart-sub" id="an-c1-sub">Fastest observed speed per distance; reference curves show the active benchmark dropped off along the squad's fitted power law.</div>
        </div>
      </div>
      <div id="chart-speed" class="chart chart-tall"></div>
    </div>

    <div class="grid grid-2 an-chartrow">
      <div class="card chart-card">
        <div class="chart-head">
          <div>
            <div class="chart-title">Progression</div>
            <div class="chart-sub">% of benchmark over time</div>
          </div>
          <div class="seg" id="an-groupby">
            <button data-g="crew" class="on">Crew</button><button data-g="athlete">Athlete</button><button data-g="boat">Boat</button>
          </div>
        </div>
        <div id="chart-prog" class="chart"></div>
      </div>
      <div class="card chart-card">
        <div class="chart-head">
          <div>
            <div class="chart-title">Athletes</div>
            <div class="chart-sub">Best % of benchmark in window (pieces they are tagged on)</div>
          </div>
        </div>
        <div id="chart-ath" class="chart"></div>
      </div>
    </div>

    <div class="card chart-card" id="wind-card">
      <div class="chart-head">
        <div>
          <div class="chart-title">Wind sensitivity</div>
          <div class="chart-sub">Each water piece vs the squad envelope at its distance, against the headwind it faced. The slope is your squad's empirical wind cost.</div>
        </div>
      </div>
      <div id="chart-wind" class="chart"></div>
    </div>

    <p class="muted" style="margin:14px 2px 30px; font-size:12.5px" id="an-foot"></p>`;

  const charts = {
    speed: echarts.init(document.getElementById('chart-speed')),
    prog: echarts.init(document.getElementById('chart-prog')),
    ath: echarts.init(document.getElementById('chart-ath')),
    wind: echarts.init(document.getElementById('chart-wind')),
  };
  window.addEventListener('resize', () => Object.values(charts).forEach(c => c.resize()));

  // ---- filter bindings ----
  document.getElementById('an-preset').onchange = e => { state.preset = e.target.value; update(); };
  document.getElementById('an-boat').onchange = e => { state.boat = e.target.value; update(); };
  document.getElementById('an-athlete').onchange = e => { state.athlete = e.target.value; update(); };
  document.getElementById('an-crew').onchange = e => { state.crew = e.target.value; update(); };
  document.getElementById('an-wind').onchange = e => { state.windAdj = e.target.checked; update(); };
  document.querySelectorAll('#an-types .chip').forEach(ch => ch.onclick = () => {
    ch.classList.toggle('on');
    state.types = new Set([...document.querySelectorAll('#an-types .chip.on')].map(c => c.dataset.type));
    update();
  });
  document.querySelectorAll('#an-groupby button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#an-groupby button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    state.groupBy = b.dataset.g;
    update();
  });

  update();

  // ================================================================
  function update() {
    const set = filtered();
    const fit = squadFit(set);
    const exponent = fit ? fit.b : RTM.DEFAULT_EXPONENT.water;

    document.getElementById('an-count').textContent =
      `${set.length} of ${pieces.length} results in view`;

    renderKpis(set, fit, exponent);
    renderSpeedChart(set, fit, exponent);
    renderProgChart(set, exponent);
    renderAthChart(set, exponent);
    renderWindChart(set, exponent, fit);

    document.getElementById('an-foot').textContent =
      (bench ? `Benchmark: ${bench.name}. ` : 'No active benchmark set - % of benchmark views need one (Settings). ')
      + `Drop-off model v = a·d^b, b = ${exponent.toFixed(3)}`
      + (fit ? ` fitted from ${fit.n} envelope points (R² ${fit.r2.toFixed(2)})` : ' (default)')
      + (state.windAdj
        ? `. Normalisation: empirical 2k wind table (boat class × wind speed × angle to course), stream current subtracted where recorded; linear fallback +${RTM.WIND_COEF} m/s per m/s of headwind when boat class or wind geometry is missing.`
        : '.');
  }

  function renderKpis(set, fit, exponent) {
    const water = set.filter(p => p.type === 'Water');
    const km = set.reduce((s, p) => s + (p.d || 0), 0) / 1000;
    const racePcts = set.map(p => p.type === 'Race' ? p.racePct : null).filter(x => x != null);
    const trainPcts = set.map(p => p.type !== 'Race' ? pctOf(p, exponent) : null).filter(x => x != null);
    const kpi = (label, value, sub) => `
      <div class="card stat">
        <div class="stat-value">${value}</div>
        <div class="stat-label">${label}${sub ? `<span class="muted"> · ${sub}</span>` : ''}</div>
      </div>`;
    document.getElementById('an-kpis').innerHTML =
      kpi('Pieces', set.length, `${water.length} water`)
      + kpi('Distance logged', km >= 1 ? km.toFixed(1) + ' km' : '-')
      + kpi('Best race GMT', racePcts.length ? Math.max(...racePcts).toFixed(1) + '%' : '-')
      + kpi('Best training %', trainPcts.length ? Math.max(...trainPcts).toFixed(1) + '%' : '-', 'prognostic')
      + kpi('Drop-off b', exponent.toFixed(3), fit ? 'fitted' : 'default');
  }

  // ---- chart 1: speed vs distance ----
  function renderSpeedChart(set, fit, exponent) {
    const pts = set.filter(p => p.d > 0 && p.v > 0);
    const el = document.getElementById('chart-speed');
    if (!pts.length) { charts.speed.clear(); el.classList.add('chart-empty'); return; }
    el.classList.remove('chart-empty');

    const dMin = Math.min(...pts.map(p => p.d)) * 0.85;
    const dMax = Math.max(...pts.map(p => p.d)) * 1.15;
    const vs = pts.map(p => vShown(p));
    let vMin = Math.min(...vs), vMax = Math.max(...vs);

    // group points into rate-band series
    const bands = [...RTM.RATE_BANDS.map(b => b.label), 'no rate'];
    const bySeries = Object.fromEntries(bands.map(b => [b, []]));
    for (const p of pts) {
      const band = p.type === 'Race' && p.rate == null ? 'no rate' : RTM.rateBand(p.rate).label;
      bySeries[band].push({
        value: [p.d, round2(vShown(p))],
        symbol: p.type === 'Erg' ? 'circle' : p.type === 'Race' ? 'diamond' : 'triangle',
        symbolSize: p.type === 'Race' ? 11 : 10,
        itemStyle: { opacity: p.ageDays <= 28 ? 0.92 : Math.max(0.18, 0.92 - p.ageDays / 400) },
        meta: p,
      });
    }

    const series = bands.filter(b => bySeries[b].length).map(b => ({
      name: b, type: 'scatter', data: bySeries[b],
      itemStyle: { color: b === 'no rate' ? '#8a97a5' : RTM.RATE_BANDS.find(x => x.label === b)?.color || '#8a97a5' },
      emphasis: { scale: 1.6 },
    }));

    // reference curves: benchmark GMT lines (needs a single boat class) + squad envelope
    const xs = logSpace(dMin, dMax, 40);
    const bt = benchTimeFor(state.boat);
    if (bt) {
      for (const pct of [100, 90, 80, 70]) {
        const line = xs.map(d => [d, round2(RTM.benchmarkSpeedAt(d, bt, exponent, pct))]);
        vMax = Math.max(vMax, line[0][1]);
        series.push({
          name: `${pct}%`, type: 'line', data: line, showSymbol: false, silent: true,
          lineStyle: { color: '#9aa7b4', width: pct === 100 ? 2 : 1, type: pct === 100 ? 'solid' : 'dashed' },
          endLabel: { show: true, formatter: `${pct}%`, color: '#8a97a5', fontSize: 11 },
          tooltip: { show: false },
        });
      }
    }
    if (fit) {
      series.push({
        name: 'squad envelope', type: 'line', showSymbol: false, silent: true,
        data: xs.map(d => [d, round2(fit.a * Math.pow(d, fit.b))]),
        lineStyle: { color: '#0d1b2a', width: 2, type: [6, 5] },
        tooltip: { show: false },
      });
    }

    document.getElementById('an-c1-sub').textContent = bt
      ? `Reference curves: ${bench.name} for ${state.boat}, dropped off along b = ${exponent.toFixed(3)}. Triangles = water, circles = erg, diamonds = races. Faded = older.`
      : 'Pick a single boat class (with an active benchmark) to overlay GMT reference curves. Triangles = water, circles = erg, diamonds = races. Faded = older.';

    const pad = (vMax - vMin) * 0.08 + 0.05;
    const yMin = round2(Math.max(0.5, vMin - pad)), yMax = round2(vMax + pad);

    charts.speed.setOption({
      animationDuration: 350,
      grid: { left: 58, right: 74, top: 24, bottom: 44 },
      legend: { bottom: 0, itemWidth: 14, textStyle: { fontSize: 11 }, data: bands.filter(b => bySeries[b].length) },
      tooltip: { trigger: 'item', confine: true, formatter: p => p.data?.meta ? pieceTip(p.data.meta, exponent) : '' },
      xAxis: {
        type: 'log', min: round2(dMin), max: round2(dMax), name: 'distance',
        axisLabel: { formatter: v => fmtDist(v) }, splitLine: { lineStyle: { color: '#edf1f5' } },
      },
      yAxis: [
        { type: 'value', min: yMin, max: yMax, name: 'speed (m/s)', splitLine: { lineStyle: { color: '#edf1f5' } } },
        { type: 'value', min: yMin, max: yMax, name: 'split /500m', splitLine: { show: false },
          axisLabel: { formatter: v => formatMs(RTM.splitMsOfSpeed(v), { tenths: false }) } },
      ],
      series,
    }, true);
  }

  // ---- chart 2: progression over time ----
  function renderProgChart(set, exponent) {
    const pts = set.map(p => ({ p, pct: pctOf(p, exponent) })).filter(x => x.pct != null);
    const el = document.getElementById('chart-prog');
    if (pts.length < 2) { charts.prog.clear(); el.classList.add('chart-empty'); return; }
    el.classList.remove('chart-empty');

    const groups = {};
    for (const x of pts) {
      if (state.groupBy === 'athlete') {
        // fan a piece out to every tagged athlete
        x.p.athletes.forEach(n => (groups[n] = groups[n] || []).push(x));
      } else if (state.groupBy === 'boat') {
        const k = x.p.boat || 'no class';
        (groups[k] = groups[k] || []).push(x);
      } else {
        // by crew: tagged crews / athlete-sets only - public race labels are
        // not a crew identity, so untagged races are left out of this view
        if (!x.p.crewKey) continue;
        (groups[x.p.crewName] = groups[x.p.crewName] || []).push(x);
      }
    }
    const top = Object.entries(groups).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
    const palette = ['#1d5b8a', '#2a9d8f', '#ef8c1f', '#cf3131', '#7c5cd6', '#3f8f3f', '#c74f8c', '#5b6570'];

    charts.prog.setOption({
      animationDuration: 350,
      grid: { left: 44, right: 18, top: 20, bottom: 58 },
      legend: { bottom: 0, itemWidth: 14, textStyle: { fontSize: 11 } },
      tooltip: { trigger: 'item', confine: true, formatter: p => p.data?.meta ? pieceTip(p.data.meta, exponent) : '' },
      xAxis: { type: 'time', splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, axisLabel: { formatter: '{value}%' }, splitLine: { lineStyle: { color: '#edf1f5' } } },
      series: top.map(([name, xs], i) => ({
        name: truncate(name, 26), type: 'line', smooth: 0.25, connectNulls: true,
        symbolSize: 7, itemStyle: { color: palette[i % palette.length] },
        lineStyle: { width: 2 },
        data: xs.sort((a, b) => a.p.t - b.p.t).map(x => ({ value: [x.p.t, round1(x.pct)], meta: x.p })),
      })),
    }, true);
  }

  // ---- chart 3: athlete comparison ----
  function renderAthChart(set, exponent) {
    const best = {};
    for (const p of set) {
      const pct = pctOf(p, exponent);
      if (pct == null) continue;
      for (const a of p.athletes) {
        if (!best[a] || pct > best[a].pct) best[a] = { pct, p };
      }
    }
    const entries = Object.entries(best).sort((a, b) => a[1].pct - b[1].pct).slice(-15);
    const el = document.getElementById('chart-ath');
    if (!entries.length) { charts.ath.clear(); el.classList.add('chart-empty'); return; }
    el.classList.remove('chart-empty');

    charts.ath.setOption({
      animationDuration: 350,
      grid: { left: 110, right: 46, top: 10, bottom: 28 },
      tooltip: { trigger: 'item', confine: true, formatter: p => p.data?.meta ? pieceTip(p.data.meta, exponent) : '' },
      xAxis: { type: 'value', scale: true, axisLabel: { formatter: '{value}%' }, splitLine: { lineStyle: { color: '#edf1f5' } } },
      yAxis: { type: 'category', data: entries.map(e => truncate(e[0], 16)), axisLabel: { fontSize: 12 } },
      series: [{
        type: 'bar', barMaxWidth: 16,
        data: entries.map(e => ({ value: round1(e[1].pct), meta: e[1].p })),
        itemStyle: { color: '#1d5b8a', borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', formatter: '{c}%', fontSize: 11, color: '#5b6570' },
      }],
    }, true);
  }

  // ---- chart 4: wind sensitivity ----
  function renderWindChart(set, exponent, fit) {
    const card = document.getElementById('wind-card');
    // residuals vs RAW speed envelope (adjusting would hide the effect);
    // with normalisation off the squad fit IS the raw fit - reuse it
    const water = set.filter(p => p.type === 'Water' && p.d && p.v && p.head != null);
    const rawFit = state.windAdj
      ? RTM.fitEnvelope(set.filter(p => p.type === 'Water' && p.d && p.v).map(p => ({ d: p.d, v: p.v })))
      : fit;
    if (water.length < 8 || !rawFit) { card.style.display = 'none'; return; }
    card.style.display = '';

    const data = water.map(p => ({
      value: [round2(p.head), round1(p.v / (rawFit.a * Math.pow(p.d, rawFit.b)) * 100)],
      meta: p,
    }));
    // simple OLS trend (skipped when the headwind values have no spread -
    // a zero denominator would draw a NaN line)
    const n = data.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    data.forEach(({ value: [x, y] }) => { sx += x; sy += y; sxx += x * x; sxy += x * y; });
    const denom = n * sxx - sx * sx;
    const slope = Math.abs(denom) > 1e-9 ? (n * sxy - sx * sy) / denom : null;
    const icept = slope != null ? (sy - slope * sx) / n : null;
    const xMin = Math.min(...data.map(d => d.value[0])), xMax = Math.max(...data.map(d => d.value[0]));

    charts.wind.setOption({
      animationDuration: 350,
      grid: { left: 52, right: 24, top: 30, bottom: 44 },
      tooltip: { trigger: 'item', confine: true, formatter: p => p.data?.meta ? pieceTip(p.data.meta, exponent) : '' },
      xAxis: { type: 'value', name: 'headwind (m/s), negative = tailwind', nameLocation: 'middle', nameGap: 28, splitLine: { lineStyle: { color: '#edf1f5' } } },
      yAxis: { type: 'value', scale: true, name: '% of envelope', axisLabel: { formatter: '{value}%' }, splitLine: { lineStyle: { color: '#edf1f5' } } },
      series: [
        { type: 'scatter', data, symbolSize: 9, itemStyle: { color: '#2a9d8f', opacity: 0.75 } },
        { type: 'line', silent: true, showSymbol: false, tooltip: { show: false },
          data: [[round2(xMin), round1(icept + slope * xMin)], [round2(xMax), round1(icept + slope * xMax)]],
          lineStyle: { color: '#0d1b2a', width: 2, type: 'dashed' },
          endLabel: { show: true, formatter: `${slope.toFixed(1)}%/(m/s)`, fontSize: 11, color: '#5b6570' } },
      ],
    }, true);
  }

  // ---- shared bits ----
  function pieceTip(p, exponent) {
    const pct = pctOf(p, exponent);
    const rows = [
      ['Date', fmtDate(p.date)],
      ['Type', p.type + (p.boat ? ` · ${p.boat}` : '')],
      (p.crewName || p.raceLabel) ? ['Crew', truncate(p.crewName || p.raceLabel, 40)] : null,
      p.type === 'Race' ? ['Race', [p.event, p.regatta].filter(Boolean).join(' · ')] : null,
      p.d ? ['Piece', `${p.d.toLocaleString()}m in ${formatMs(p.timeMs)}${p.rate ? ` @ r${p.rate}` : ''}`] : ['Time', formatMs(p.timeMs)],
      p.v ? ['Speed', `${RTM.fmtSpeed(vShown(p))} · ${RTM.fmtSplitOfSpeed(vShown(p))}`] : null,
      pct != null ? ['% benchmark', pct.toFixed(1) + '%'] : null,
      p.head != null ? ['Wind', `${p.head >= 0 ? 'head' : 'tail'} ${Math.abs(p.head).toFixed(1)} m/s, cross ${p.cross?.toFixed(1) ?? '-'} m/s`] : null,
      p.stream?.flow_m3s != null ? ['Stream', `${p.stream.flow_m3s} m³/s (${p.stream.station || 'gauge'})`
        + (p.current != null ? `, current ${p.current > 0 ? '+' : ''}${p.current.toFixed(2)} m/s` : '')] : null,
    ].filter(Boolean);
    return `<div style="font-size:12px; line-height:1.5">${rows.map(([k, v]) =>
      `<div><span style="color:#8a97a5">${k}</span>&nbsp; <strong>${escapeHtml(String(v))}</strong></div>`).join('')}</div>`;
  }

  function renderEmpty() {
    app.innerHTML = `
      <div class="page-head"><div>
        <div class="page-title">Analytics</div>
        <p class="page-sub">${escapeHtml(activeGroup().name)}</p>
      </div></div>
      <div class="empty">
        <h2>No data to analyse yet</h2>
        <p>Log pieces on the Results page, log a water piece with mapped conditions, or import your club's
           public regatta results. Or load a realistic demo dataset to explore what this page does.</p>
        <div style="display:flex; gap:10px; justify-content:center; margin-top:14px">
          <button class="btn btn-primary" id="demo-btn">Load demo data</button>
          <a class="btn btn-ghost" href="piece.html">+ Log water piece</a>
        </div>
      </div>`;
    document.getElementById('demo-btn').onclick = async () => {
      const btn = document.getElementById('demo-btn');
      btn.disabled = true; btn.textContent = 'Building demo squad...';
      try {
        await RTDemo.load();
        toast('Demo data loaded');
        window.location.reload();
      } catch (e) {
        toast(e.message || 'Demo load failed', 'error');
        btn.disabled = false; btn.textContent = 'Load demo data';
      }
    };
  }

  const logSpace = RTM.logSpace, fmtDist = RTM.fmtDist;
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function round1(x) { return Math.round(x * 10) / 10; }
  function round2(x) { return Math.round(x * 100) / 100; }
})().catch(e => {
  console.error(e);
  const app = document.getElementById('app');
  if (app) app.innerHTML = `<div class="error-box">This page failed to load: ${escapeHtml(e.message || String(e))}</div>`;
});
