// weather.js - fetch + summarise race-time weather, matching conditions.js on
// the main site (Open-Meteo historical archive, no key). Used to cache a
// summary onto imported results; conditions.js itself draws the full modal.

const _COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function windCompass(deg) { return _COMPASS[Math.round(((deg % 360) / 22.5)) % 16]; }

// "07:42" -> nearest whole hour index (0-23), or null if malformed.
function clockToHour(clock) {
  const [hh, mm] = String(clock).split(':').map(Number);
  if (!Number.isFinite(hh)) return null;
  return Math.min(23, hh + (mm >= 30 ? 1 : 0));
}

// One hour of weather at a point: { temp, hum, wspd, wgust, wdir, code,
// source } or null. The archive API lags a few days behind, so recent dates
// (and the future) go to the forecast API, which also serves the recent
// past - otherwise the archive returns nulls that would get cached as 0s.
async function fetchHourlyWeather(lat, lon, date, hour) {
  if (lat == null || lon == null || !date || hour == null) return null;
  const recent = (Date.now() - new Date(date).getTime()) < 5 * 86400000;
  const base = recent
    ? 'https://api.open-meteo.com/v1/forecast'
    : 'https://archive-api.open-meteo.com/v1/archive';
  const url = `${base}?latitude=${lat}&longitude=${lon}`
    + `&start_date=${date}&end_date=${date}`
    + `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code`
    + `&wind_speed_unit=kmh&timezone=Europe%2FLondon`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const h = (await res.json()).hourly;
    if (!h?.time?.length) return null;
    const i = Math.max(0, Math.min(h.time.length - 1, hour));
    // Data gap for that hour: never Math.round(null) -> 0 a fabricated wind.
    if (h.wind_speed_10m[i] == null || h.wind_direction_10m[i] == null) return null;
    return {
      temp: Math.round(h.temperature_2m[i]),
      hum: Math.round(h.relative_humidity_2m[i]),
      wspd: Math.round(h.wind_speed_10m[i]),
      wgust: Math.round(h.wind_gusts_10m[i]),
      wdir: Math.round(h.wind_direction_10m[i]),
      code: h.weather_code[i],
      source: 'open-meteo',
    };
  } catch (e) {
    // best-effort fetch: degrade to "no weather", but never silently -
    // a parsing bug must be distinguishable from missing data
    console.error('weather fetch failed', e);
    return null;
  }
}

// Race-time weather for an imported result's venue. Mirrors conditions.js.
async function fetchRaceWeather(venue, date, clock) {
  if (!venue || venue.lat == null || venue.lon == null || !date || !clock) return null;
  return fetchHourlyWeather(venue.lat, venue.lon, date, clockToHour(clock));
}

// Short inline summary, e.g. "12°C · WSW 15 km/h".
function weatherSummary(w) {
  if (!w) return '';
  return `${w.temp}°C · ${windCompass(w.wdir)} ${w.wspd} km/h`;
}
