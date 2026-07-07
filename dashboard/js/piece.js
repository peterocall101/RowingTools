// piece.js - log an on-water piece with mapped course + fetched conditions.
//
// Drop a start pin and a finish pin on the map; the course distance and
// bearing are computed for you. "Fetch conditions" then pulls:
//   - wind/temperature for that date, hour and location from Open-Meteo
//     (forecast API for the last ~5 days and future, archive API for older),
//     resolved into head/cross components against the course bearing, and
//   - river flow from the nearest Environment Agency gauging station
//     (real-time flood-monitoring API; readings go back ~4 weeks, England
//     only - it degrades gracefully to "no gauge nearby / no reading").
// Everything fetched is cached onto the result row (weather/stream jsonb), so
// analytics never needs to refetch.
(async function () {
  const app = document.getElementById('app');
  const DEFAULT_CENTER = [51.4715, -0.2245];   // Putney Embankment
  const COMMON_DISTANCES = [250, 500, 1000, 1500, 2000, 5000];

  const session = await requireAuth();
  if (!session) return;
  await loadContext();
  if (!RT.memberships.length) { window.location.replace('index.html'); return; }
  renderHeader('results.html');

  const [{ data: roster }, { data: coursesData }] = await Promise.all([
    sb.from('athletes').select('id, name').eq('group_id', RT.activeGroupId)
      .is('deleted_at', null).order('name'),
    sb.from('courses').select('*').eq('group_id', RT.activeGroupId).order('name'),
  ]);
  let courses = coursesData || [];

  // Centre the map where the squad last rowed, if we know.
  const { data: lastGeo } = await sb.from('results')
    .select('start_lat, start_lng').eq('group_id', RT.activeGroupId)
    .not('start_lat', 'is', null).order('performed_at', { ascending: false }).limit(1);
  const center = lastGeo?.[0] ? [lastGeo[0].start_lat, lastGeo[0].start_lng] : DEFAULT_CENTER;

  const today = new Date().toISOString().slice(0, 10);

  app.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Log water piece</div>
        <p class="page-sub">${escapeHtml(activeGroup().name)} &middot; tag the course on the map, fetch the conditions, save.</p>
      </div>
      <a class="btn btn-ghost" href="results.html">Back to results</a>
    </div>

    <div class="grid grid-2 piece-grid">
      <div class="card">
        <div class="form-row">
          <div class="field">
            <label for="p-date">Date</label>
            <input class="input" id="p-date" type="date" value="${today}">
          </div>
          <div class="field">
            <label for="p-tod">Time of day</label>
            <input class="input" id="p-tod" type="time" value="08:00">
          </div>
          <div class="field" style="max-width:110px">
            <label for="p-boat">Boat class</label>
            <input class="input" id="p-boat" placeholder="M4x" autocomplete="off">
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="p-distance">Distance (m)</label>
            <input class="input" id="p-distance" inputmode="numeric" list="p-dist-list" placeholder="from map, or type">
            <datalist id="p-dist-list">${COMMON_DISTANCES.map(d => `<option value="${d}">`).join('')}</datalist>
          </div>
          <div class="field">
            <label for="p-time">Time</label>
            <input class="input" id="p-time" placeholder="1:32.4">
          </div>
          <div class="field" style="max-width:90px">
            <label for="p-rate">Rate</label>
            <input class="input" id="p-rate" inputmode="numeric" placeholder="-">
          </div>
        </div>
        <div class="field">
          <label for="p-location">Stretch of water (optional)</label>
          <input class="input" id="p-location" placeholder="e.g. Tideway, Putney to Hammersmith">
        </div>
        <div class="field">
          <label>Athletes</label>
          ${(roster || []).length ? `<div class="check-list">
            ${roster.map(a => `<label class="check-row">
              <input type="checkbox" name="athlete" value="${a.id}"><span>${escapeHtml(a.name)}</span></label>`).join('')}
          </div>` : '<p class="muted">No athletes in the roster yet.</p>'}
        </div>
        <div class="field">
          <label for="p-notes">Notes</label>
          <input class="input" id="p-notes" placeholder="Optional">
        </div>
        <div class="error-box" id="p-error" style="display:none"></div>
        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:6px">
          <button class="btn btn-primary" id="p-save">Save piece</button>
        </div>
      </div>

      <div class="card">
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px; flex-wrap:wrap">
          <select id="p-course-sel" class="input-select" style="max-width:230px"></select>
          <button class="btn btn-ghost" id="p-course-save" style="padding:6px 12px; font-size:12.5px" disabled>Save course...</button>
          <button class="btn btn-ghost" id="p-course-del" style="padding:6px 12px; font-size:12.5px; color:var(--danger); display:none">Delete</button>
        </div>
        <p class="muted" style="margin-bottom:10px; font-size:13px">
          Pick a saved course, or click the map to drop the <strong>start</strong> pin, click again for the
          <strong>finish</strong>. Drag pins to adjust.
          <button class="btn btn-ghost" id="p-reset" style="padding:3px 10px; font-size:12px; margin-left:6px">Reset pins</button></p>
        <div id="p-map" class="piece-map"></div>
        <div class="piece-course" id="p-course">No course tagged yet.</div>
        <div style="display:flex; gap:10px; align-items:center; margin-top:10px">
          <button class="btn btn-ghost" id="p-usedist" disabled>Use as piece distance</button>
          <button class="btn btn-primary" id="p-fetch" disabled>Fetch conditions</button>
        </div>
        <div id="p-cond" class="piece-cond"></div>
        <div class="field" style="margin-top:12px">
          <label for="p-current">Stream current (m/s, optional; + = pushing you along)</label>
          <input class="input" id="p-current" inputmode="decimal" placeholder="e.g. 0.4 - the EA gauge gives flow volume, not current; enter your own estimate">
        </div>
      </div>
    </div>`;

  // ---- map ----
  const map = L.map('p-map').setView(center, 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  let startPin = null, finishPin = null, line = null;
  let course = null;                 // { startLat, startLng, finLat, finLng, distM, bearing }
  let conditions = { weather: null, stream: null };

  const mkIcon = (color, label) => L.divIcon({
    className: '', iconSize: [26, 26], iconAnchor: [13, 24],
    html: `<div class="pin" style="--pin:${color}"><span>${label}</span></div>`,
  });

  // First click places the start; every later click (re)places the finish.
  map.on('click', e => setPin(startPin ? 'finish' : 'start', e.latlng));

  function setPin(which, latlng) {
    const icon = which === 'start' ? mkIcon('#2a9d8f', 'S') : mkIcon('#cf3131', 'F');
    let pin = which === 'start' ? startPin : finishPin;
    if (pin) pin.setLatLng(latlng);
    else {
      pin = L.marker(latlng, { draggable: true, icon }).addTo(map);
      pin.on('drag dragend', refreshCourse);
      if (which === 'start') startPin = pin; else finishPin = pin;
    }
    refreshCourse();
  }

  document.getElementById('p-reset').onclick = () => {
    [startPin, finishPin, line].forEach(x => x && map.removeLayer(x));
    startPin = finishPin = line = null;
    course = null; conditions = { weather: null, stream: null };
    refreshCourse();
    document.getElementById('p-cond').innerHTML = '';
  };

  function refreshCourse() {
    const box = document.getElementById('p-course');
    if (line) { map.removeLayer(line); line = null; }
    if (!startPin || !finishPin) {
      course = null;
      box.textContent = startPin ? 'Now click the finish.' : 'No course tagged yet.';
      document.getElementById('p-usedist').disabled = true;
      document.getElementById('p-fetch').disabled = !startPin;
      syncCourseControls();
      return;
    }
    const s = startPin.getLatLng(), f = finishPin.getLatLng();
    const distM = RTM.haversineM(s.lat, s.lng, f.lat, f.lng);
    const bearing = RTM.bearingDeg(s.lat, s.lng, f.lat, f.lng);
    course = { startLat: s.lat, startLng: s.lng, finLat: f.lat, finLng: f.lng, distM, bearing };
    line = L.polyline([s, f], { color: '#1d5b8a', weight: 3, dashArray: '6 6' }).addTo(map);
    box.innerHTML = `Course: <strong>${Math.round(distM).toLocaleString()} m</strong>
      &middot; bearing <strong>${Math.round(bearing)}°</strong> (${windCompass(bearing)})
      <span class="muted">straight line start → finish</span>`;
    document.getElementById('p-usedist').disabled = false;
    document.getElementById('p-fetch').disabled = false;
    syncCourseControls();
  }

  // Saved-course controls follow the pins: "Save course" needs a full
  // course; changing pins by hand deselects the preset.
  function syncCourseControls() {
    courseSave.disabled = !course;
    if (!applyingPreset) { courseSel.value = ''; courseDel.style.display = 'none'; }
  }

  document.getElementById('p-usedist').onclick = () => {
    if (course) document.getElementById('p-distance').value = Math.round(course.distM);
  };

  // ---- saved courses ----
  const courseSel = document.getElementById('p-course-sel');
  const courseSave = document.getElementById('p-course-save');
  const courseDel = document.getElementById('p-course-del');
  let applyingPreset = false;

  function renderCourseList(selectedId) {
    courseSel.innerHTML = '<option value="">Saved courses...</option>'
      + courses.map(c => `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    courseDel.style.display = courseSel.value ? '' : 'none';
  }
  renderCourseList();

  courseSel.onchange = () => {
    const c = courses.find(x => x.id === courseSel.value);
    courseDel.style.display = c ? '' : 'none';
    if (!c) return;
    applyingPreset = true;
    setPin('start', L.latLng(c.start_lat, c.start_lng));
    setPin('finish', L.latLng(c.finish_lat, c.finish_lng));
    applyingPreset = false;
    map.fitBounds(L.latLngBounds([c.start_lat, c.start_lng], [c.finish_lat, c.finish_lng]), { padding: [40, 40] });
    const loc = document.getElementById('p-location');
    if (!loc.value.trim()) loc.value = c.name;
  };

  courseSave.onclick = () => {
    if (!course) return;
    openModal({
      title: 'Save course',
      submitLabel: 'Save',
      bodyHtml: `
        <p class="muted" style="margin-bottom:10px">${Math.round(course.distM).toLocaleString()} m &middot; bearing ${Math.round(course.bearing)}&deg;</p>
        <div class="field"><label for="c-name">Name</label>
        <input class="input" id="c-name" name="name" required placeholder="e.g. Putney - Hammersmith"></div>`,
      onSubmit: async (form, close) => {
        const name = String(new FormData(form).get('name') || '').trim();
        if (!name) throw new Error('Give the course a name.');
        const { data, error } = await sb.from('courses').insert({
          group_id: RT.activeGroupId, name,
          start_lat: course.startLat, start_lng: course.startLng,
          finish_lat: course.finLat, finish_lng: course.finLng,
          created_by: session.user.id,
        }).select('*').single();
        if (error) throw error;
        courses = [...courses, data].sort((a, b) => a.name.localeCompare(b.name));
        renderCourseList(data.id);
        toast('Course saved');
        close();
      },
    });
  };

  courseDel.onclick = async () => {
    const c = courses.find(x => x.id === courseSel.value);
    if (!c || !confirm(`Delete saved course "${c.name}"? (The pins stay on the map.)`)) return;
    const { error } = await sb.from('courses').delete().eq('id', c.id);
    if (error) { toast(error.message, 'error'); return; }
    courses = courses.filter(x => x.id !== c.id);
    renderCourseList();
    toast('Course deleted');
  };

  // Fetched conditions belong to a specific date/hour - changing either
  // invalidates them so a stale day's wind can never be saved onto the piece.
  for (const id of ['p-date', 'p-tod']) {
    document.getElementById(id).addEventListener('change', () => {
      if (!conditions.weather && !conditions.stream) return;
      conditions = { weather: null, stream: null };
      document.getElementById('p-cond').innerHTML =
        '<p class="muted">Date/time changed - fetch conditions again.</p>';
    });
  }

  // ---- conditions ----
  document.getElementById('p-fetch').onclick = async () => {
    const btn = document.getElementById('p-fetch');
    const out = document.getElementById('p-cond');
    const date = document.getElementById('p-date').value;
    const tod = document.getElementById('p-tod').value || '08:00';
    if (!date) { out.innerHTML = '<p class="muted">Pick a date first.</p>'; return; }
    const lat = course ? (course.startLat + course.finLat) / 2 : startPin.getLatLng().lat;
    const lng = course ? (course.startLng + course.finLng) / 2 : startPin.getLatLng().lng;

    btn.disabled = true; btn.textContent = 'Fetching...';
    out.innerHTML = '<p class="muted">Fetching wind and stream...</p>';
    const [wx, stream] = await Promise.all([
      fetchWind(lat, lng, date, tod),
      fetchStream(lat, lng, date, tod),
    ]);
    btn.disabled = false; btn.textContent = 'Fetch conditions';

    conditions.weather = wx;
    conditions.stream = stream;
    renderConditions();
  };

  // Cache head/cross onto the fetched weather for the current course. The
  // single place the cached jsonb shape is defined - used at render AND at
  // save time (pins may have moved between the two).
  function cacheWindComponents() {
    const w = conditions.weather;
    if (!w || !course) return null;
    const c = RTM.windComponents(w.wdir, w.wspd / 3.6, course.bearing);
    w.head_ms = round2(c.head);
    w.cross_ms = round2(c.cross);
    return c;
  }

  function renderConditions() {
    const out = document.getElementById('p-cond');
    const w = conditions.weather, s = conditions.stream;
    const rows = [];
    if (w) {
      let windLine = `${windCompass(w.wdir)} ${w.wspd} km/h (gust ${w.wgust})`;
      const c = cacheWindComponents();
      if (c) {
        windLine += ` → <strong>${c.head >= 0 ? 'headwind' : 'tailwind'} ${Math.abs(c.head).toFixed(1)} m/s</strong>, cross ${c.cross.toFixed(1)} m/s`;
      }
      rows.push(`<div class="cond-row"><span>Wind</span><div>${windLine}</div></div>`);
      rows.push(`<div class="cond-row"><span>Air</span><div>${w.temp}°C · ${w.hum}% humidity</div></div>`);
    } else {
      rows.push('<div class="cond-row"><span>Wind</span><div class="muted">Not available for that date/location.</div></div>');
    }
    if (s) {
      rows.push(`<div class="cond-row"><span>Stream</span><div><strong>${s.flow_m3s} m³/s</strong> at ${escapeHtml(s.station)}${s.river ? ' (' + escapeHtml(s.river) + ')' : ''}, ${s.dist_km} km away<div class="muted" style="font-size:12px">measured ${escapeHtml(s.measured_at || '')}</div></div></div>`);
    } else {
      rows.push('<div class="cond-row"><span>Stream</span><div class="muted">No EA flow gauge reading found nearby (England-only, readings kept ~4 weeks).</div></div>');
    }
    out.innerHTML = rows.join('');
  }

  // Wind/temp for the piece's hour and location (shared fetcher in weather.js
  // handles the forecast-vs-archive API selection and null guarding).
  function fetchWind(lat, lng, date, tod) {
    return fetchHourlyWeather(lat, lng, date, clockToHour(tod || '08:00'));
  }

  // Environment Agency real-time flow: nearest gauging station within 15 km,
  // latest reading for today or the day's readings for a recent past date.
  async function fetchStream(lat, lng, date, tod) {
    try {
      const stRes = await fetch(`https://environment.data.gov.uk/flood-monitoring/id/stations`
        + `?parameter=flow&lat=${lat.toFixed(4)}&long=${lng.toFixed(4)}&dist=15`);
      if (!stRes.ok) return null;
      const stations = ((await stRes.json()).items || [])
        .filter(s => s.lat != null && s.long != null)
        .map(s => ({ ...s, _dist: RTM.haversineM(lat, lng, s.lat, s.long) }))
        .sort((a, b) => a._dist - b._dist);

      const isToday = date === new Date().toISOString().slice(0, 10);
      for (const st of stations.slice(0, 3)) {
        const ref = st.stationReference || (st['@id'] || '').split('/').pop();
        if (!ref) continue;
        const q = isToday ? 'latest' : `date=${date}`;
        const rdRes = await fetch(`https://environment.data.gov.uk/flood-monitoring/id/stations/${encodeURIComponent(ref)}/readings?${q}&_sorted&_limit=200`);
        if (!rdRes.ok) continue;
        const readings = ((await rdRes.json()).items || [])
          .filter(r => /flow/i.test(r.measure || '') && typeof r.value === 'number');
        if (!readings.length) continue;
        // latest for today; otherwise the reading nearest the time of day
        let r = readings[0];
        if (!isToday) {
          const target = new Date(`${date}T${tod || '08:00'}:00`).getTime();
          r = readings.reduce((best, x) =>
            Math.abs(new Date(x.dateTime) - target) < Math.abs(new Date(best.dateTime) - target) ? x : best, r);
        }
        return {
          station_id: ref,
          station: st.label || ref,
          river: st.riverName || null,
          flow_m3s: Math.round(r.value * 100) / 100,
          measured_at: r.dateTime,
          dist_km: Math.round(st._dist / 100) / 10,
          source: 'ea-flood-monitoring',
        };
      }
      return null;
    } catch (e) {
      console.error('EA stream fetch failed', e);
      return null;
    }
  }

  // ---- save ----
  document.getElementById('p-save').onclick = async () => {
    const err = document.getElementById('p-error');
    const btn = document.getElementById('p-save');
    err.style.display = 'none';
    try {
      const date = document.getElementById('p-date').value;
      if (!date) throw new Error('Pick a date.');
      const distance = parseInt(document.getElementById('p-distance').value, 10);
      if (!Number.isFinite(distance) || distance <= 0) throw new Error('Enter a distance in metres (or tag the course and "Use as piece distance").');
      const time_ms = parseTimeToMs(document.getElementById('p-time').value);
      const rateRaw = document.getElementById('p-rate').value.trim();
      const rate = rateRaw ? parseInt(rateRaw, 10) : null;
      if (rateRaw && (!Number.isFinite(rate) || rate <= 0)) throw new Error('Rate must be a number.');

      btn.disabled = true; btn.textContent = 'Saving...';

      const athleteIds = [...document.querySelectorAll('input[name="athlete"]:checked')].map(c => c.value);
      let crewId = null;
      if (athleteIds.length) {
        const { data: cid, error: cErr } = await sb.rpc('upsert_crew', {
          p_group_id: RT.activeGroupId, p_athlete_ids: athleteIds,
        });
        if (cErr) throw cErr;
        crewId = cid;
      }

      const curRaw = document.getElementById('p-current').value.trim();
      let stream = conditions.stream;
      if (curRaw) {
        const cur = parseFloat(curRaw);
        if (!Number.isFinite(cur)) throw new Error('Stream current must be a number (m/s).');
        stream = { ...(stream || {}), current_ms: cur };
      }

      // Make sure cached wind carries head/cross for the course as tagged now.
      cacheWindComponents();

      const { data: ins, error } = await sb.from('results').insert({
        group_id: RT.activeGroupId,
        created_by: session.user.id,
        source: 'manual',
        piece_type: 'water',
        performed_at: date,
        clock: document.getElementById('p-tod').value || null,
        distance_m: distance,
        time_ms,
        rate,
        boat_class: document.getElementById('p-boat').value.trim() || null,
        crew_id: crewId,
        notes: document.getElementById('p-notes').value.trim() || null,
        location_name: document.getElementById('p-location').value.trim() || null,
        start_lat: course?.startLat ?? (startPin ? startPin.getLatLng().lat : null),
        start_lng: course?.startLng ?? (startPin ? startPin.getLatLng().lng : null),
        finish_lat: course?.finLat ?? null,
        finish_lng: course?.finLng ?? null,
        bearing: course ? Math.round(course.bearing * 10) / 10 : null,
        weather: conditions.weather,
        stream,
      }).select('id').single();
      if (error) throw error;

      if (athleteIds.length) {
        const { error: aErr } = await sb.from('result_athletes')
          .insert(athleteIds.map(aid => ({ result_id: ins.id, athlete_id: aid })));
        if (aErr) throw aErr;
      }

      toast('Piece logged');
      window.location.href = 'results.html';
    } catch (e) {
      err.style.display = 'block';
      err.textContent = e.message || 'Something went wrong.';
      btn.disabled = false; btn.textContent = 'Save piece';
    }
  };

  function round2(x) { return Math.round(x * 100) / 100; }
})().catch(e => {
  console.error(e);
  const app = document.getElementById('app');
  if (app) app.innerHTML = `<div class="error-box">This page failed to load: ${escapeHtml(e.message || String(e))}</div>`;
});
