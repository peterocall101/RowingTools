// metrics.js - shared performance maths for the analytics pages: speed/split
// conversion, the power-law speed-vs-distance model (the "log scale" the
// distance adjuster and the reference curves on the speed chart use), an
// empirical fit of that model to a squad's own data, and wind geometry.
//
// Model: v(d) = a * d^b  (straight line in log-log space). b is negative and
// small - the "fatigue exponent". Riegel's endurance model (t = T*(D/d)^1.06)
// gives b = -0.06; Paul's Law on the erg (+5s/500m per doubling) is ~ -0.065.
// These are the fallbacks when a squad hasn't got enough data to fit.

const RTM = (function () {

  const DEFAULT_EXPONENT = { water: -0.06, erg: -0.065 };

  // Empirical linear wind correction: estimated still-air speed =
  // measured speed + WIND_COEF * headwind component (m/s). A 5 m/s headwind
  // on a ~5 m/s boat gives ~4% - in line with published shell drag estimates.
  // One constant for all boat classes (small boats are hit a little harder;
  // refine later if the data says so).
  const WIND_COEF = 0.04;

  // ---- speed / split ----
  function speedOf(distanceM, timeMs) {
    if (!distanceM || !timeMs) return null;
    return distanceM / (timeMs / 1000);            // m/s
  }
  function splitMsOfSpeed(v) { return v > 0 ? 500 / v * 1000 : null; }
  function fmtSpeed(v) { return v == null ? '-' : v.toFixed(2) + ' m/s'; }
  function fmtSplitOfSpeed(v) {
    const ms = splitMsOfSpeed(v);
    return ms == null ? '-' : formatMs(ms) + '/500m';
  }

  // ---- power-law model ----
  // Predict time (ms) at toDist given a known performance, sliding along
  // v(d) = a*d^b: v2 = v1 * (d2/d1)^b.
  function predictTime(fromDistM, fromTimeMs, toDistM, exponent) {
    const v1 = speedOf(fromDistM, fromTimeMs);
    const v2 = v1 * Math.pow(toDistM / fromDistM, exponent);
    return toDistM / v2 * 1000;
  }

  // OLS fit of ln(v) = ln(a) + b*ln(d) over [{d, v}] points.
  // Returns { a, b, r2, n } or null when under-determined.
  function fitPowerLaw(points) {
    const pts = (points || []).filter(p => p.d > 0 && p.v > 0);
    const n = pts.length;
    if (n < 3) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    for (const p of pts) {
      const x = Math.log(p.d), y = Math.log(p.v);
      sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-12) return null;
    const b = (n * sxy - sx * sy) / denom;
    const a = Math.exp((sy - b * sx) / n);
    const r2num = (n * sxy - sx * sy) ** 2;
    const r2den = denom * (n * syy - sy * sy);
    const r2 = r2den > 0 ? r2num / r2den : 0;
    return { a, b, r2, n };
  }

  // The coach-chart trick: fit the FASTEST observation per distance bucket
  // (the top envelope), not the cloud, so easy paddling doesn't drag the
  // curve down. Buckets are log-spaced (8 per decade).
  function envelope(points) {
    const best = new Map();
    for (const p of (points || [])) {
      if (!(p.d > 0 && p.v > 0)) continue;
      const key = Math.round(Math.log10(p.d) * 8);
      const cur = best.get(key);
      if (!cur || p.v > cur.v) best.set(key, p);
    }
    return [...best.values()];
  }

  function fitEnvelope(points) { return fitPowerLaw(envelope(points)); }

  // Reference speed at distance d for a 2000m benchmark time, dropped off
  // along the power law. pct scales the whole curve (e.g. 80 for a GMT 80% line).
  function benchmarkSpeedAt(d, benchTimeMs2k, exponent, pct = 100) {
    const v2k = speedOf(2000, benchTimeMs2k);
    return v2k * Math.pow(d / 2000, exponent) * pct / 100;
  }

  // ---- wind geometry ----
  // bearing: direction of travel (deg true). wdir: direction wind comes FROM.
  // head > 0 = headwind, head < 0 = tailwind; cross is unsigned magnitude.
  function windComponents(wdirDeg, wspdMs, bearingDeg) {
    if (wdirDeg == null || wspdMs == null || bearingDeg == null) return null;
    const rel = (wdirDeg - bearingDeg) * Math.PI / 180;
    return { head: wspdMs * Math.cos(rel), cross: Math.abs(wspdMs * Math.sin(rel)) };
  }

  function windAdjustedSpeed(v, headMs) {
    if (v == null) return null;
    if (headMs == null) return v;
    return v + WIND_COEF * headMs;
  }

  // ---- empirical wind table ----
  // "Change of 2000m times [s] for different boat classes under wind
  // conditions" (FES/Kleshnev-style study, coach-supplied). Rows = wind speed
  // 1..6 m/s measured stationary to the course; cols = wind angle to the
  // course 0/30/60/90 deg. head = wind from ahead, tail = from behind; the
  // two blocks meet at 90 deg (pure cross, both positive - cross always
  // slows). t0 = the table's calm 2000m time for that class.
  // NOTE: the 2- head 5 m/s 0deg value is printed "81,3" in the source, which
  // breaks monotonicity and the row's internal ratios; transcribed as 61.3.
  const WIND_TABLE = {
    '1x': { v0: 4.71, t0: 424.6,
      head: { 1: [11.6, 10.1, 5.9, 0.1], 2: [25.8, 23.0, 15.1, 1.6], 3: [41.1, 37.2, 23.3, 2.5],
              4: [57.2, 52.4, 31.1, 4.1], 5: [73.7, 68.2, 39.5, 6.8], 6: [90.3, 84.3, 48.7, 9.9] },
      tail: { 1: [-11.9, -10.2, -5.7, 0.1], 2: [-20.6, -17.1, -10.1, 1.6], 3: [-26.7, -23.7, -14.2, 2.5],
              4: [-30.2, -27.4, -16.5, 4.1], 5: [-31.0, -32.0, -18.8, 6.8], 6: [-33.4, -32.6, -20.2, 9.9] } },
    '2-': { v0: 4.82, t0: 414.9,
      head: { 1: [9.7, 8.6, 5.4, 0.7], 2: [21.3, 19.4, 13.2, 4.1], 3: [33.9, 31.4, 22.6, 7.8],
              4: [47.3, 44.3, 33.4, 9.3], 5: [61.3, 57.9, 43.5, 11.1], 6: [75.5, 71.9, 52.3, 13.8] },
      tail: { 1: [-9.3, -7.8, -4.1, 0.7], 2: [-16.3, -13.3, -5.7, 4.1], 3: [-21.3, -17.6, -8.4, 7.8],
              4: [-24.2, -21.2, -10.7, 9.3], 5: [-25.0, -26.4, -12.5, 11.1], 6: [-26.6, -26.2, -14.3, 13.8] } },
    '4-': { v0: 5.26, t0: 380.2,
      head: { 1: [6.3, 5.7, 3.0, 1.3], 2: [17.2, 11.5, 11.3, 2.6], 3: [28.9, 28.1, 21.6, 3.4],
              4: [41.2, 40.7, 32.2, 6.3], 5: [54.0, 53.9, 38.8, 8.3], 6: [67.0, 67.1, 46.8, 10.8] },
      tail: { 1: [-12.0, -10.1, -6.1, 1.3], 2: [-18.9, -15.3, -7.1, 2.6], 3: [-24.1, -19.7, -10.3, 3.4],
              4: [-27.6, -24.2, -13.2, 6.3], 5: [-29.1, -26.8, -15.4, 8.3], 6: [-29.7, -29.5, -17.3, 10.8] } },
    '8+': { v0: 5.88, t0: 340.1,
      head: { 1: [8.4, 8.1, 6.2, 3.1], 2: [15.9, 15.5, 12.0, 5.8], 3: [24.0, 23.7, 18.6, 9.9],
              4: [32.5, 32.5, 26.2, 12.8], 5: [41.5, 41.6, 34.7, 13.9], 6: [50.8, 51.4, 44.8, 15.5] },
      tail: { 1: [-4.2, -2.9, -0.1, 3.1], 2: [-9.2, -6.6, -0.9, 5.8], 3: [-13.1, -9.3, -1.2, 9.9],
              4: [-15.9, -12.1, -3.0, 12.8], 5: [-17.5, -15.0, -5.4, 13.9], 6: [-18.0, -20.2, -7.2, 15.5] } },
  };

  // Reference class by crew size: the dominant variable is frontal area per
  // rower, so 2x/2+ use the 2- data, 4x/4+ the 4- data, and so on.
  function refClassOf(boatClass) {
    const m = String(boatClass || '').match(/([1248])/);
    return m ? { 1: '1x', 2: '2-', 4: '4-', 8: '8+' }[m[1]] : null;
  }

  // Bilinear interpolation into the table. rel = wind angle to the course,
  // 0 (dead ahead) .. 180 (dead behind). Wind speed clamps at the table's
  // 6 m/s edge. Returns delta-t seconds on a 2000m at that class's speed.
  function windDelta2k(cls, windMs, rel) {
    const T = WIND_TABLE[cls];
    if (!T) return null;
    const w = Math.min(6, Math.abs(windMs));
    if (w === 0) return 0;
    const block = rel <= 90 ? T.head : T.tail;
    const ang = rel <= 90 ? rel : 180 - rel;
    const gi = Math.min(2, Math.floor(ang / 30));
    const af = (ang - gi * 30) / 30;
    const at = row => row[gi] + (row[Math.min(3, gi + 1)] - row[gi]) * af;
    const lo = Math.floor(w), hi = Math.ceil(w), wf = w - lo;
    const rowLo = lo === 0 ? [0, 0, 0, 0] : block[lo];
    const rowHi = block[hi] || rowLo;
    return at(rowLo) + (at(rowHi) - at(rowLo)) * wf;
  }

  // The normalisation factor for a piece rowed in wind: multiply the measured
  // speed (or GMT%) by f, divide the time by f, to get the calm-conditions
  // equivalent. f = 1 + dt/t0 (headwind: f > 1). Returns null when any input
  // is missing - callers fall back to the linear model or leave the row raw.
  function windTimeFactor(boatClass, wdirDeg, wspdMs, bearingDeg) {
    const cls = refClassOf(boatClass);
    if (!cls || wdirDeg == null || wspdMs == null || bearingDeg == null) return null;
    let rel = Math.abs(((wdirDeg - bearingDeg) % 360 + 360) % 360);
    if (rel > 180) rel = 360 - rel;
    const dt = windDelta2k(cls, wspdMs, rel);
    return dt == null ? null : 1 + dt / WIND_TABLE[cls].t0;
  }

  // Calm-conditions normalisation for a results row - THE single definition
  // used by both the Results table and Analytics, so the two pages can never
  // disagree. Strips the recorded stream current, then takes out the wind:
  // the empirical table when boat class + wind geometry allow, else the
  // linear model on the cached headwind component. Returns null when nothing
  // can be normalised, else { v, timeMs, f } (v null for rows with no
  // distance, f = effective speed multiplier - also applies to GMT%).
  function normaliseResultRow(row) {
    const w = row.weather || null;
    const bearing = row.bearing ?? (row.venue ? row.venue.bearing : null) ?? null;
    const current = row.stream ? (row.stream.current_ms ?? null) : null;
    const table = (w && w.wspd != null && w.wdir != null)
      ? windTimeFactor(row.boat_class, w.wdir, w.wspd / 3.6, bearing)
      : null;

    if (row.distance_m > 0 && row.time_ms > 0) {
      const raw = row.distance_m / (row.time_ms / 1000);
      let v = raw;
      if (current != null) v -= current;
      if (table != null) v *= table;
      else if (w && w.head_ms != null) v += WIND_COEF * w.head_ms;
      else if (current == null) return null;      // nothing to apply
      if (v <= 0) return null;
      return { v, timeMs: Math.round(row.distance_m / v * 1000), f: v / raw };
    }
    // No distance (imported race): only a multiplicative factor works.
    if (table == null || !row.time_ms) return null;
    return { v: null, timeMs: Math.round(row.time_ms / table), f: table };
  }

  // DRV boat-class factors (speed multipliers vs 1x), "normal weather"
  // column - reference data for deriving benchmarks for classes without a
  // WBT. WBT-derived ratios run 0-3% above these (see analytics report).
  const DRV_FACTORS = {
    '1x': 1.0, '2+': 0.985, '2-': 1.039, '2x': 1.076,
    '4+': 1.094, '4-': 1.122, '4x': 1.164, '8+': 1.206,
  };

  // ---- geo ----
  const R_EARTH = 6371000;
  function haversineM(lat1, lon1, lat2, lon2) {
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const s = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.sqrt(s));
  }
  function bearingDeg(lat1, lon1, lat2, lon2) {
    const toRad = x => x * Math.PI / 180;
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
      - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // ---- chart helpers (shared by the analytics + adjuster pages) ----
  function logSpace(a, b, n) {
    const la = Math.log(a), lb = Math.log(b);
    return Array.from({ length: n }, (_, i) => Math.exp(la + (lb - la) * i / (n - 1)));
  }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(m % 1000 ? 1 : 0) + 'km' : Math.round(m) + 'm'; }

  // ---- presentation ----
  // Rate bands and colours, matching the "coach's Excel chart" convention.
  const RATE_BANDS = [
    { max: 20,  label: '<20',   color: '#2e6fb7' },
    { max: 25,  label: '20-25', color: '#3f8f3f' },
    { max: 30,  label: '25-30', color: '#e3c229' },
    { max: 35,  label: '30-35', color: '#ef8c1f' },
    { max: 999, label: '35+',   color: '#cf3131' },
  ];
  function rateBand(rate) {
    if (rate == null) return { label: 'no rate', color: '#8a97a5' };
    return RATE_BANDS.find(b => rate < b.max) || RATE_BANDS[RATE_BANDS.length - 1];
  }

  return {
    DEFAULT_EXPONENT, WIND_COEF,
    speedOf, splitMsOfSpeed, fmtSpeed, fmtSplitOfSpeed,
    predictTime, fitPowerLaw, envelope, fitEnvelope,
    benchmarkSpeedAt,
    windComponents, windAdjustedSpeed, normaliseResultRow,
    WIND_TABLE, DRV_FACTORS, refClassOf, windDelta2k, windTimeFactor,
    haversineM, bearingDeg, logSpace, fmtDist,
    RATE_BANDS, rateBand,
  };
})();
