/* deeplink.js - land a leaderboard page on one crew's race in the heatmap.

   The tracker's Races tab links here: a rower taps a result in their own race
   history and wants the race it came from, in context, not a 900-row table.
   The heatmap is already the default view and already dims every club but one,
   so this only has to point the existing machinery at the right cell.

   Query string, all optional:
     ?ev=<event>&rd=<round>&crew=<crew name>&hlclub=<club>

   Deliberately NOT ?club=. rowingtools-share.js already claims that parameter
   and uses it to jump to the Result Leaderboard tab, which is the view this is
   trying to avoid. A separate name means the two never fight.

   Every step is guarded: a page whose markup differs, a regatta whose results
   were re-cut, or a crew that is no longer there all end with the page simply
   sitting on its normal heatmap. A deep link that misses must never be worse
   than no deep link. */
(function () {
  var q = new URLSearchParams(location.search);
  var ev = (q.get('ev') || '').trim();
  var rd = (q.get('rd') || '').trim();
  var crew = (q.get('crew') || '').trim();
  var club = (q.get('hlclub') || '').trim();
  if (!ev && !crew && !club) return;

  var st = document.createElement('style');
  st.textContent =
    '.rt-hl{outline:2px solid #c8472b;outline-offset:-2px;' +
    'box-shadow:inset 0 0 0 9999px rgba(200,71,43,.10);position:relative}' +
    '.rt-hl .cn{color:#fff}' +
    '.rt-hlnote{display:inline-flex;align-items:center;gap:7px;margin:0 0 14px;padding:7px 12px;' +
    'background:rgba(200,71,43,.14);border:1px solid rgba(200,71,43,.4);border-radius:8px;' +
    'font-size:12.5px;color:#d9d9d6}' +
    '.rt-hlnote b{color:#f0f0ee}' +
    '.rt-hlnote a{color:#ef8268;margin-left:4px}';
  document.head.appendChild(st);

  // The page's own club filter does the dimming, so use it rather than
  // inventing a second way to say the same thing. It re-renders the heatmap,
  // which is why the cell is looked up afterwards.
  function applyClub() {
    var box = document.getElementById('club-filter-hm');
    if (!box || !club) return;
    box.value = club;
    if (typeof window.filterClubHm === 'function') window.filterClubHm(club);
    else box.dispatchEvent(new Event('input', { bubbles: true }));
  }

  var norm = function (s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); };

  function findCell() {
    if (!ev && !crew) return null;
    var tables = document.querySelectorAll('#heatmap-out table');
    for (var i = 0; i < tables.length; i++) {
      var cap = tables[i].querySelector('caption');
      if (ev && (!cap || norm(cap.getAttribute('data-event')) !== norm(ev))) continue;
      var rows = tables[i].querySelectorAll('tbody tr');
      for (var j = 0; j < rows.length; j++) {
        var rnd = rows[j].querySelector('td.rnd');
        if (rd && (!rnd || norm(rnd.getAttribute('data-round')) !== norm(rd))) continue;
        if (!crew) return rnd || rows[j].cells[0];
        var names = rows[j].querySelectorAll('td .cn');
        for (var k = 0; k < names.length; k++) {
          if (norm(names[k].textContent) === norm(crew)) return names[k].closest('td');
        }
      }
    }
    return null;
  }

  function run() {
    applyClub();
    var cell = findCell();
    if (!cell) return;
    cell.classList.add('rt-hl');
    // A line above the heatmap saying why one cell is ringed, and a way out of
    // the filtered view without knowing which box to clear.
    var out = document.getElementById('heatmap-out');
    if (out && !document.querySelector('.rt-hlnote')) {
      var note = document.createElement('div');
      note.className = 'rt-hlnote';
      note.innerHTML = 'Showing <b>' + (crew || club).replace(/[<>&]/g, '') + '</b>' +
        (ev ? ' in <b>' + ev.replace(/[<>&]/g, '') + '</b>' : '') +
        '<a href="' + location.pathname + '">show everyone</a>';
      out.parentNode.insertBefore(note, out);
    }
    cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // The inline script renders the heatmap synchronously before this file is
  // fetched, but a deferred or slower page would leave nothing to find, so
  // wait for the DOM either way.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
