// weather.js - fetch + summarise race-time weather, matching conditions.js on
// the main site (Open-Meteo historical archive, no key). Used to cache a
// summary onto imported results; conditions.js itself draws the full modal.

const _COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function windCompass(deg) { return _COMPASS[Math.round(((deg % 360) / 22.5)) % 16]; }

// { temp, hum, wspd, wgust, wdir, code } or null. Mirrors conditions.js wxFetch.
async function fetchRaceWeather(venue, date, clock) {
  if (!venue || venue.lat == null || venue.lon == null || !date || !clock) return null;
  const [hh, mm] = String(clock).split(':').map(Number);
  if (!Number.isFinite(hh)) return null;
  const hour = Math.min(23, hh + (mm >= 30 ? 1 : 0));
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${venue.lat}&longitude=${venue.lon}`
    + `&start_date=${date}&end_date=${date}`
    + `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code`
    + `&wind_speed_unit=kmh&timezone=Europe%2FLondon`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const h = (await res.json()).hourly;
    const i = Math.max(0, Math.min(h.time.length - 1, hour));
    return {
      temp: Math.round(h.temperature_2m[i]),
      hum: Math.round(h.relative_humidity_2m[i]),
      wspd: Math.round(h.wind_speed_10m[i]),
      wgust: Math.round(h.wind_gusts_10m[i]),
      wdir: Math.round(h.wind_direction_10m[i]),
      code: h.weather_code[i],
    };
  } catch (e) { return null; }
}

// Short inline summary, e.g. "12°C · WSW 15 km/h".
function weatherSummary(w) {
  if (!w) return '';
  return `${w.temp}°C · ${windCompass(w.wdir)} ${w.wspd} km/h`;
}
