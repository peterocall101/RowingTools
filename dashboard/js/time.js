// time.js - parse/format rowing times. Shared by results (and later benchmarks).

// Parse a human time string into milliseconds.
// Accepts: "ss(.t)", "mm:ss(.t)", "h:mm:ss(.t)".  e.g. "6:23.4", "1:42:05", "94.2"
// Throws on anything malformed so the form can surface it.
function parseTimeToMs(str) {
  const s = String(str).trim();
  if (!s) throw new Error('Enter a time.');
  const parts = s.split(':');
  if (parts.length > 3) throw new Error('Time format looks wrong. Use mm:ss.t');

  const nums = parts.map((p, i) => {
    if (!/^\d+(\.\d+)?$/.test(p)) throw new Error('Time format looks wrong. Use mm:ss.t');
    const n = parseFloat(p);
    // Only the last (seconds) field may be fractional; minutes/hours must be whole.
    if (i < parts.length - 1 && !Number.isInteger(n)) throw new Error('Time format looks wrong. Use mm:ss.t');
    return n;
  });

  let h = 0, m = 0, sec = 0;
  if (nums.length === 1) { sec = nums[0]; }
  else if (nums.length === 2) { [m, sec] = nums; }
  else { [h, m, sec] = nums; }

  if (sec >= 60 && nums.length > 1) throw new Error('Seconds must be under 60.');
  if (m >= 60 && nums.length > 2) throw new Error('Minutes must be under 60.');

  const ms = Math.round((h * 3600 + m * 60 + sec) * 1000);
  if (ms <= 0) throw new Error('Time must be greater than zero.');
  return ms;
}

// Format milliseconds back to a display time with tenths.
// < 1h -> "m:ss.t"; >= 1h -> "h:mm:ss.t"
function formatMs(ms, { tenths = true } = {}) {
  if (ms == null) return '';
  const totalSec = ms / 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const secStr = tenths
    ? (sec < 10 ? '0' : '') + sec.toFixed(1)
    : (sec < 10 ? '0' : '') + Math.round(sec);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${secStr}`;
  return `${m}:${secStr}`;
}

// Average split per 500m, formatted. distanceM must be > 0.
function formatSplit(ms, distanceM) {
  if (!distanceM || distanceM <= 0) return '-';
  const per500 = ms * 500 / distanceM;
  return formatMs(per500) + '/500m';
}
