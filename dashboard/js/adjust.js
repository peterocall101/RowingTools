// adjust.js - the distance adjustment calculator. Converts a performance at
// one distance to an equivalent at another using the power-law drop-off
// v(d) = a·d^b (a straight line on the log-log speed/distance chart - exactly
// the shape of the coach's Excel plot). The exponent b can be:
//   - the built-in default (Riegel / Paul's-Law territory),
//   - fitted empirically from this squad's own logged pieces (envelope fit
//     over the fastest observation per distance bucket), or
//   - set by hand.
(async function () {
  const app = document.getElementById('app');

  const session = await requireAuth();
  if (!session) return;
  await loadContext();
  if (!RT.memberships.length) { window.location.replace('index.html'); return; }
  renderHeader('tools.html');

  const state = {
    type: 'water', boat: '',
    fromD: 500, toD: 2000, timeMs: null,
    expSource: 'default',     // 'default' | 'squad' | 'manual'
    manualB: -0.06,
    pts: [],                  // squad scatter for the current type/boat filter
    fit: null,                // envelope fit over pts
  };
  let rawRows = [];

  // Load the squad's own pieces once, in the background, then fit.
  (async () => {
    // Newest first so the 1000-row query cap drops old pieces, not new.
    const { data } = await sb.from('results')
      .select('piece_type, source, distance_m, time_ms, boat_class')
      .eq('group_id', RT.activeGroupId).is('deleted_at', null)
      .not('distance_m', 'is', null)
      .order('performed_at', { ascending: false });
    rawRows = (data || []).filter(r => r.source !== 'public' && r.distance_m > 0 && r.time_ms > 0);
    refit();
    renderExpSource();
    update();
  })();

  // Recompute the scatter + envelope fit for the current type/boat filter,
  // and keep the boat-class options in step with the data for that type.
  function refit() {
    const rows = rawRows.filter(r => r.piece_type === state.type);
    const classes = [...new Set(rows.map(r => r.boat_class).filter(Boolean))].sort();
    const sel = document.getElementById('aj-boat');
    if (state.boat && !classes.includes(state.boat)) state.boat = '';
    sel.innerHTML = '<option value="">All boats</option>'
      + classes.map(c => `<option${c === state.boat ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
    state.pts = rows
      .filter(r => !state.boat || r.boat_class === state.boat)
      .map(r => ({ d: r.distance_m, v: RTM.speedOf(r.distance_m, r.time_ms) }));
    state.fit = RTM.fitEnvelope(state.pts);
  }

  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Distance adjuster</div>
        <p class="page-sub">Convert a performance at one distance to its equivalent at another,
          on a log-scale drop-off you can calibrate from your own squad's data.</p>
      </div>
      <a class="btn btn-ghost" href="analytics.html">Analytics</a>
    </div>

    <div class="grid grid-2 adjust-grid">
      <div class="card">
        <div class="form-row">
          <div class="field">
            <label>Type</label>
            <select id="aj-type" class="input-select">
              <option value="water">On water</option>
              <option value="erg">Erg</option>
            </select>
          </div>
          <div class="field" style="max-width:130px">
            <label>Boat class</label>
            <select id="aj-boat" class="input-select"><option value="">All boats</option></select>
          </div>
          <div class="field">
            <label>Known distance (m)</label>
            <input id="aj-from" class="input" inputmode="numeric" value="500">
          </div>
          <div class="field">
            <label>Time over it</label>
            <input id="aj-time" class="input" placeholder="1:22.5">
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label>Target distance (m)</label>
            <input id="aj-to" class="input" inputmode="numeric" value="2000">
          </div>
          <div class="field">
            <label>Drop-off exponent (b)</label>
            <select id="aj-exp" class="input-select"></select>
          </div>
          <div class="field" id="aj-manual-wrap" style="max-width:110px; display:none">
            <label>b value</label>
            <input id="aj-manual" class="input" value="-0.060">
          </div>
        </div>
        <div id="aj-out" class="adjust-out muted">Enter a time to convert.</div>
        <p class="muted" style="font-size:12.5px; margin-top:14px">
          Model: speed(d) = a·d<sup>b</sup>, a straight line on a log-log plot. b ≈ -0.06 means
          roughly 4% of speed lost per doubling of distance. "Fitted from squad data" fits the
          fastest observed speed per distance bucket in your logged pieces, so paddling doesn't
          drag the curve down.</p>
      </div>

      <div class="card chart-card">
        <div class="chart-head"><div>
          <div class="chart-title">The curve</div>
          <div class="chart-sub" id="aj-chart-sub">Your performance slid along the drop-off, over your squad's data.</div>
        </div></div>
        <div id="aj-chart" class="chart"></div>
      </div>
    </div>`;

  const chart = echarts.init(document.getElementById('aj-chart'));
  window.addEventListener('resize', () => chart.resize());

  function renderExpSource() {
    const fit = state.fit;
    const scope = state.boat ? state.boat : 'squad';
    const sel = document.getElementById('aj-exp');
    const cur = state.expSource;
    sel.innerHTML = `
      <option value="default">Default (${RTM.DEFAULT_EXPONENT[state.type]})</option>
      <option value="squad"${fit ? '' : ' disabled'}>${fit
        ? `Fitted from ${scope} data (${fit.b.toFixed(3)}, n=${fit.n})`
        : `Fitted from ${scope} data (not enough pieces yet)`}</option>
      <option value="manual">Manual</option>`;
    sel.value = (cur === 'squad' && !fit) ? 'default' : cur;
    state.expSource = sel.value;
  }

  function exponent() {
    if (state.expSource === 'manual') return state.manualB;
    if (state.expSource === 'squad' && state.fit) return state.fit.b;
    return RTM.DEFAULT_EXPONENT[state.type];
  }

  // ---- bindings ----
  const $ = id => document.getElementById(id);
  $('aj-type').onchange = e => { state.type = e.target.value; refit(); renderExpSource(); update(); };
  $('aj-boat').onchange = e => { state.boat = e.target.value; refit(); renderExpSource(); update(); };
  $('aj-from').oninput = update;
  $('aj-to').oninput = update;
  $('aj-time').oninput = update;
  $('aj-exp').onchange = e => {
    state.expSource = e.target.value;
    $('aj-manual-wrap').style.display = state.expSource === 'manual' ? '' : 'none';
    update();
  };
  $('aj-manual').oninput = e => {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v) && v < 0.05 && v > -0.5) state.manualB = v;
    update();
  };

  renderExpSource();
  update();

  function update() {
    state.fromD = parseInt($('aj-from').value, 10);
    state.toD = parseInt($('aj-to').value, 10);
    try { state.timeMs = parseTimeToMs($('aj-time').value); } catch (e) { state.timeMs = null; }

    const out = $('aj-out');
    const ok = Number.isFinite(state.fromD) && state.fromD > 0
      && Number.isFinite(state.toD) && state.toD > 0 && state.timeMs;

    if (!ok) { out.className = 'adjust-out muted'; out.textContent = 'Enter distances and a time to convert.'; drawChart(null); return; }

    const b = exponent();
    const predMs = RTM.predictTime(state.fromD, state.timeMs, state.toD, b);
    const v1 = RTM.speedOf(state.fromD, state.timeMs);
    const v2 = RTM.speedOf(state.toD, predMs);

    out.className = 'adjust-out';
    out.innerHTML = `
      <div class="adjust-big">${formatMs(predMs)}</div>
      <div class="adjust-sub">${state.toD.toLocaleString()}m &middot; ${RTM.fmtSplitOfSpeed(v2)} &middot; ${RTM.fmtSpeed(v2)}</div>
      <div class="muted" style="margin-top:6px; font-size:13px">
        from ${state.fromD.toLocaleString()}m in ${formatMs(state.timeMs)}
        (${RTM.fmtSplitOfSpeed(v1)}) &middot; b = ${b.toFixed(3)}</div>`;

    drawChart({ b, v1 });
  }

  function drawChart(calc) {
    const pts = state.pts;
    const series = [];

    if (pts.length) {
      series.push({
        name: 'squad pieces', type: 'scatter', silent: true, symbolSize: 7,
        itemStyle: { color: '#9db4c6', opacity: 0.55 },
        data: pts.map(p => [p.d, round2(p.v)]),
      });
    }

    let dLo = 250, dHi = 10000;
    if (calc) {
      dLo = Math.min(dLo, state.fromD * 0.8, state.toD * 0.8);
      dHi = Math.max(dHi, state.fromD * 1.2, state.toD * 1.2);
      const a = calc.v1 / Math.pow(state.fromD, calc.b);
      const xs = logSpace(dLo, dHi, 60);
      series.push({
        name: 'drop-off', type: 'line', showSymbol: false, silent: true,
        data: xs.map(d => [d, round2(a * Math.pow(d, calc.b))]),
        lineStyle: { color: '#1d5b8a', width: 2 },
      });
      series.push({
        name: 'known', type: 'scatter', symbolSize: 14, symbol: 'circle',
        itemStyle: { color: '#1d5b8a' },
        data: [[state.fromD, round2(calc.v1)]],
        label: { show: true, position: 'top', formatter: 'known', fontSize: 11 },
      });
      const vTo = calc.v1 * Math.pow(state.toD / state.fromD, calc.b);
      series.push({
        name: 'predicted', type: 'scatter', symbolSize: 14, symbol: 'diamond',
        itemStyle: { color: '#2a9d8f' },
        data: [[state.toD, round2(vTo)]],
        label: { show: true, position: 'top', formatter: 'predicted', fontSize: 11 },
      });
    }

    chart.setOption({
      animationDuration: 250,
      grid: { left: 52, right: 66, top: 24, bottom: 32 },
      tooltip: { trigger: 'item', formatter: p =>
        `${fmtDist(p.value[0])} · ${p.value[1].toFixed(2)} m/s · ${RTM.fmtSplitOfSpeed(p.value[1])}` },
      xAxis: { type: 'log', min: dLo, max: dHi, axisLabel: { formatter: v => fmtDist(v) }, splitLine: { lineStyle: { color: '#edf1f5' } } },
      yAxis: { type: 'value', scale: true, name: 'speed (m/s)', splitLine: { lineStyle: { color: '#edf1f5' } } },
      series,
    }, true);
  }

  const logSpace = RTM.logSpace, fmtDist = RTM.fmtDist;
  function round2(x) { return Math.round(x * 100) / 100; }
})().catch(e => {
  console.error(e);
  const app = document.getElementById('app');
  if (app) app.innerHTML = `<div class="error-box">This page failed to load: ${escapeHtml(e.message || String(e))}</div>`;
});
