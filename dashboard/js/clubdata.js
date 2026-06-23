// clubdata.js - reads the public site's all_results.json (same origin), caches
// it, and exposes the club list + per-club results for the import feature.
const ClubData = (function () {
  let _cache = null;

  async function load() {
    if (_cache) return _cache;
    // Dashboard lives at /dashboard/, the data at /data/ - one level up.
    const res = await fetch('../data/all_results.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load the public results data.');
    _cache = await res.json();
    return _cache;
  }

  // Distinct club names across every regatta, sorted. These are the canonical
  // names a squad attaches to, so import matching is an exact equality.
  async function clubs() {
    const comps = await load();
    const set = new Set();
    comps.forEach(c => (c.results || []).forEach(r => { if (r.club) set.add(r.club); }));
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // Flat, newest-first list of a club's public results, each enriched with the
  // regatta it came from and a stable `ref` used to dedupe imports.
  async function resultsForClub(clubName) {
    if (!clubName) return [];
    const comps = await load();
    const out = [];
    comps.forEach(c => (c.results || []).forEach(r => {
      if (r.club !== clubName) return;
      out.push({
        comp: c.comp,
        regatta: c.title,
        venue: c.venue || null,
        crew: r.crew,
        event: r.event,
        round: r.round,
        time: r.time,
        clock: r.clock,
        pct: r.pct,
        boat: r.boat,
        date: r.date || c.date,
        ref: `${c.comp}|${r.crew}|${r.event}|${r.round}|${r.time}`,
      });
    }));
    out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return out;
  }

  return { load, clubs, resultsForClub };
})();
