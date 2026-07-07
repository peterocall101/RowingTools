// sampledata.js - build a realistic demo squad on top of the active group so
// the analytics pages have something to show before real data exists. Every
// row is flagged is_demo, so it can be cleanly removed again.
//
// The generated data is physically plausible on purpose: speeds follow the
// power-law drop-off, respond to stroke rate, improve through the season, and
// are perturbed by wind (via the same head/cross model analytics uses) and a
// river stream that helps one direction and hurts the other. So the charts
// don't just fill up - the wind-sensitivity fit and the envelope fit both
// recover the constants that generated them.
const RTDemo = (function () {

  const ATHLETES = [
    'Alex Carter', 'Ben Osei', 'Charlie Wren', 'Dan Kowalski',
    'Ed Hartley', 'Fin Murray', 'George Adeyemi', 'Harry Voss',
    'Iwan Rees', 'Jack Delaney',
  ];

  // 2000m gold-standard speeds (m/s) used to seed crew baselines.
  const BOAT_V2K = { 'M8+': 6.15, 'M4-': 5.85, 'M2-': 5.35, 'M2x': 5.55, 'M1x': 5.15 };

  const B = -0.062;            // drop-off exponent baked into the data
  // Home stretch: Putney embankment <-> towards Hammersmith. Bearings are
  // derived from the pins so map, bearing and wind components always agree.
  const P_PUTNEY = [51.4664, -0.2244], P_HAMMER = [51.4877, -0.2360];
  const LEGS = {
    down: { start: P_HAMMER, finish: P_PUTNEY,
            bearing: RTM.bearingDeg(P_HAMMER[0], P_HAMMER[1], P_PUTNEY[0], P_PUTNEY[1]) },
    up:   { start: P_PUTNEY, finish: P_HAMMER,
            bearing: RTM.bearingDeg(P_PUTNEY[0], P_PUTNEY[1], P_HAMMER[0], P_HAMMER[1]) },
  };

  const SESSIONS = [
    { name: 'rate ladder', pieces: [[500, 20], [500, 24], [500, 28], [500, 32]] },
    { name: '2 x 2k',      pieces: [[2000, 25], [2000, 26]] },
    { name: '1k work',     pieces: [[1000, 30], [1000, 32], [1000, 34]] },
    { name: 'sprints',     pieces: [[250, 36], [250, 38], [250, 40]] },
    { name: 'steady 5k',   pieces: [[5000, 18]] },
    { name: 'race pace',   pieces: [[1500, 33], [750, 35]] },
  ];

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  async function load() {
    const gid = RT.activeGroupId;
    const uid = RT.session.user.id;
    if (!gid) throw new Error('No active squad.');

    // A retry after a mid-way failure must not stack a second demo squad.
    const { data: existing } = await sb.from('athletes')
      .select('id').eq('group_id', gid).eq('is_demo', true).limit(1);
    if (existing?.length) throw new Error('Demo data is already loaded (or partially loaded) - remove it first, then load again.');

    // ---- athletes ----
    const { data: aths, error: aErr } = await sb.from('athletes')
      .insert(ATHLETES.map(name => ({
        group_id: gid, name, sex: 'M', is_demo: true, created_by: uid,
      }))).select('id, name');
    if (aErr) throw aErr;
    const ids = aths.map(a => a.id);

    // ---- crews (direct insert so we can flag is_demo; signature = sorted ids) ----
    const crewDefs = [
      { name: 'Demo 8+', boat: 'M8+', members: ids.slice(0, 8), pct: [76, 84] },
      { name: 'Demo 4-', boat: 'M4-', members: ids.slice(0, 4), pct: [74, 82] },
      { name: 'Demo 2-', boat: 'M2-', members: ids.slice(4, 6), pct: [72, 80] },
      { name: 'Demo 2x', boat: 'M2x', members: ids.slice(8, 10), pct: [75, 83] },
      { name: 'Demo 1x', boat: 'M1x', members: [ids[8]], pct: [73, 81] },
    ];
    const { data: crews, error: cErr } = await sb.from('crews')
      .insert(crewDefs.map(c => ({
        group_id: gid, name: c.name, boat_class: c.boat, is_demo: true,
        signature: [...c.members].sort().join(','), created_by: uid,
      }))).select('id, name');
    if (cErr) throw cErr;
    const crewByName = Object.fromEntries(crews.map(c => [c.name, c.id]));

    const cmRows = crewDefs.flatMap(c =>
      c.members.map((aid, i) => ({ crew_id: crewByName[c.name], athlete_id: aid, seat: i + 1 })));
    const { error: cmErr } = await sb.from('crew_members').insert(cmRows);
    if (cmErr) throw cmErr;

    // ---- season of water pieces ----
    const now = new Date();
    const seasonY = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    const start = new Date(seasonY, 8, 7);                  // first week of Sep
    // 1-6 September: "this season" hasn't started yet - use last season.
    if (start > now) start.setFullYear(start.getFullYear() - 1);
    const weeks = Math.max(6, Math.min(44, Math.floor((now - start) / (7 * 86400000))));

    const results = [], tags = [];   // tags: [{ri, athlete_ids}] resolved after insert
    const SESSIONS_PER_WEEK = { 'Demo 8+': 1.0, 'Demo 4-': 0.7, 'Demo 2-': 0.35, 'Demo 2x': 0.4, 'Demo 1x': 0.3 };

    for (const c of crewDefs) {
      const v2k = BOAT_V2K[c.boat];
      for (let w = 0; w < weeks; w++) {
        if (Math.random() > SESSIONS_PER_WEEK[c.name]) continue;
        const day = new Date(start.getTime() + (w * 7 + Math.floor(rnd(0, 6))) * 86400000);
        if (day > now) break;
        const date = day.toISOString().slice(0, 10);
        const progress = w / weeks;                          // season improvement
        const level = (c.pct[0] + (c.pct[1] - c.pct[0]) * progress) / 100;

        // one weather draw per session (SW-biased wind)
        const wdir = Math.round((225 + rnd(-70, 70) + 360) % 360);
        const wspdKmh = Math.round(rnd(4, 30));
        const temp = Math.round(6 + 14 * Math.sin(Math.PI * ((day.getMonth() + 1) / 12)) + rnd(-3, 3));
        const flow = Math.round(rnd(25, 60) + 60 * Math.max(0, Math.sin(Math.PI * ((day.getMonth() + 4) % 12) / 12)));

        const session = pick(SESSIONS);
        let legKey = pick(['down', 'up']);
        for (const [d, rate] of session.pieces) {
          legKey = legKey === 'down' ? 'up' : 'down';        // alternate direction
          const leg = LEGS[legKey];
          const wind = RTM.windComponents(wdir, wspdKmh / 3.6, leg.bearing);
          const streamMs = (flow / 100) * 0.22 * (legKey === 'down' ? 1 : -1);

          let v = v2k * level * Math.pow(d / 2000, B)        // calm baseline at distance
            * Math.pow(rate / 34, 0.30)                      // rate response
            * rnd(0.985, 1.015);                             // day-to-day noise
          // Wind applied via the SAME empirical table analytics normalises
          // with (and stream as a plain current), so toggling "Normalise for
          // conditions" recovers the calm baseline exactly.
          const wf = RTM.windTimeFactor(c.boat, wdir, wspdKmh / 3.6, leg.bearing) || 1;
          v = v / wf + streamMs;

          const time_ms = Math.round(d / v * 1000);
          results.push({
            group_id: gid, created_by: uid, source: 'manual', piece_type: 'water',
            performed_at: date, clock: pick(['07:00', '07:30', '18:00']),
            distance_m: d, time_ms, rate,
            boat_class: c.boat, crew_id: crewByName[c.name],
            start_lat: leg.start[0], start_lng: leg.start[1],
            finish_lat: leg.finish[0], finish_lng: leg.finish[1],
            bearing: Math.round(leg.bearing * 10) / 10,
            weather: {
              temp, hum: Math.round(rnd(55, 95)), wspd: wspdKmh,
              wgust: Math.round(wspdKmh * rnd(1.2, 1.7)), wdir,
              head_ms: Math.round(wind.head * 100) / 100,
              cross_ms: Math.round(wind.cross * 100) / 100, source: 'demo',
            },
            stream: {
              station: 'Kingston (demo)', river: 'River Thames',
              flow_m3s: flow, dist_km: 8.1, source: 'demo',
              current_ms: Math.round(streamMs * 100) / 100,
            },
            location_name: 'Tideway (demo)',
            notes: session.name, is_demo: true,
          });
          tags.push(c.members);
        }
      }
    }

    // ---- erg tests: each athlete, every ~6 weeks ----
    for (let i = 0; i < ids.length; i++) {
      const base2k = rnd(370, 410);                          // 6:10 - 6:50 in seconds
      for (let w = 2; w < weeks; w += 6) {
        const day = new Date(start.getTime() + (w * 7 + Math.floor(rnd(0, 4))) * 86400000);
        if (day > now) break;
        const progress = w / weeks;
        const d = pick([2000, 2000, 5000]);
        const v2k = 2000 / (base2k * (1 - 0.04 * progress)); // gets faster over the season
        const v = v2k * Math.pow(d / 2000, RTM.DEFAULT_EXPONENT.erg) * rnd(0.99, 1.01);
        results.push({
          group_id: gid, created_by: uid, source: 'manual', piece_type: 'erg',
          performed_at: day.toISOString().slice(0, 10),
          distance_m: d, time_ms: Math.round(d / v * 1000),
          rate: d === 2000 ? Math.round(rnd(28, 34)) : Math.round(rnd(22, 26)),
          notes: d === 2000 ? '2k test' : '5k test', is_demo: true,
        });
        tags.push([ids[i]]);
      }
    }

    // ---- insert results (chunks in parallel; chunk order preserves the
    // results<->tags correlation), then the athlete tags ----
    const chunks = [];
    for (let i = 0; i < results.length; i += 100) chunks.push(results.slice(i, i + 100));
    const parts = await Promise.all(chunks.map(ch => sb.from('results').insert(ch).select('id')));
    const inserted = [];
    for (const { data, error } of parts) {
      if (error) throw error;
      inserted.push(...data.map(r => r.id));
    }
    const tagRows = inserted.flatMap((rid, i) =>
      (tags[i] || []).map(aid => ({ result_id: rid, athlete_id: aid })));
    const tagChunks = [];
    for (let i = 0; i < tagRows.length; i += 400) tagChunks.push(tagRows.slice(i, i + 400));
    for (const { error } of await Promise.all(tagChunks.map(ch => sb.from('result_athletes').insert(ch)))) {
      if (error) throw error;
    }

    return { athletes: ids.length, crews: crews.length, results: inserted.length };
  }

  // Remove every demo row from the active group (hard delete - these were
  // never real, so no 48h bin).
  async function clear() {
    const gid = RT.activeGroupId;
    const del = async (table) => {
      const { error } = await sb.from(table).delete()
        .eq('group_id', gid).eq('is_demo', true);
      if (error) throw error;
    };
    await del('results');    // result_athletes rows cascade
    await del('crews');      // crew_members rows cascade
    await del('athletes');
    // RLS only lets an admin or the row creator delete; for anyone else the
    // delete silently matches nothing - check, and say so rather than lie.
    const { data: left } = await sb.from('athletes')
      .select('id').eq('group_id', gid).eq('is_demo', true).limit(1);
    if (left?.length) throw new Error('Demo rows could not be removed - only a squad admin or whoever loaded the demo can remove it.');
  }

  return { load, clear };
})();
