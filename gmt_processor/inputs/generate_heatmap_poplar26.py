#!/usr/bin/env python3
"""
generate_heatmap_poplar26.py
Generate a GMT% heatmap HTML by scraping beta.regatta.time-team.nl
for Poplar Regatta 2026 (Sunday 17 May 2026).

Site structure:
  /poplar/2026/races         - schedule listing all races with UUID links
  /poplar/2026/races/{UUID}  - result page: list items with position, club, crew, time

Includes: all Finals. Excludes J14 and J15 events (no meaningful WBT comparison).
J16 and J18 are included using standard boat-class WBTs.

Usage:
    python generate_heatmap_poplar26.py
    python generate_heatmap_poplar26.py --comp poplar26 --title "Poplar Regatta 2026" --out ../../heatmap-poplar26.html
"""

import argparse, json, re, sys, time
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    raise SystemExit("Install dependencies: pip install requests beautifulsoup4")

sys.path.insert(0, str(Path(__file__).parent))
from courses import COURSES

BASE_URL = "https://beta.regatta.time-team.nl/poplar/2026/races"
WBT_PATH = Path(__file__).parent.parent.parent / "data" / "benchmarks_v3.json"

# Course / venue config for the "race conditions" feature (see courses.py).
# Poplar Regatta 2026 is at Royal Albert Dock, London, single day.
VENUE = COURSES["albert"]
RACE_DATE = "2026-05-17"   # Poplar Regatta 2026, Sunday

CLOCK_RE = re.compile(r'\b(\d{1,2}:\d{2})\b')   # race start clock time "HH:MM"

# All Final A races from Poplar Regatta 2026.
# J14 and J15 events omitted (Op J14 4x+, W J14 4x+, Op J14 8x+, W J14 8x+,
# W J15 8+, Op J15 8+, Op J15 4x+, W J15 4x+).
# Format: (round_label, event_display, uuid)
FINALS = [
    ("Final A", "W 4x- Trophy",  "10019a8a-119f-4917-b404-8e497c2acd10"),
    ("Final A", "W 2- Trophy",   "fd74d297-af3f-4972-bd0f-b9c6971cbdc2"),
    ("Final A", "Op J18 1x",     "252461f7-129f-4ae0-8e4c-4542b54c46ff"),
    ("Final A", "W J18 1x",      "5d9f7c3c-266f-4910-92c7-ffc15a70ef14"),
    ("Final A", "W 8+ Trophy",   "6e533b17-562e-4453-8af7-cdbae66b5a88"),
    ("Final A", "W 4- Gold",     "1546a823-021c-4968-9bb1-79213654768a"),
    ("Final A", "Op J16 2x",     "32e77c52-d70f-4707-830b-19943bce138e"),
    ("Final A", "Op 2- Trophy",  "cf33d697-5e61-47d6-8ce7-d8f5ebafa84f"),
    ("Final A", "W J16 2x",      "956aae30-8b44-41aa-a356-ad8c120ea490"),
    ("Final A", "W 1x Gold",     "30527006-fad2-44c8-a134-9d9bad4a340f"),
    ("Final A", "W J16 4+",      "a1fdb414-7af4-4687-b1be-a28bd100bab6"),
    ("Final A", "Op 4x- Trophy", "ee472e34-1bc7-488c-8aae-7116068b75db"),
    ("Final A", "W 4+ Gold",     "4527a63b-ef13-4d8c-b338-df87458cfece"),
    ("Final A", "Op J16 4+",     "8a632c30-6769-456f-8e22-10317845c187"),
    ("Final A", "Op 2x Trophy",  "2dddff30-4441-43b4-956d-e4794720f11a"),
    ("Final A", "Op 8+ Trophy",  "8bb1306c-6656-4f80-ab7b-e6dd2cdd1d47"),
    ("Final A", "Op J18 8+",     "e10434aa-9a4b-4e13-9954-a1191c988d53"),
    ("Final A", "W 2x Trophy",   "a4ae6910-05a0-47c2-b950-6fa048c9dca4"),
    ("Final A", "Op 4+ Gold",    "9387e938-f595-4818-968f-c351255e8220"),
    ("Final A", "Op 4- Gold",    "89d75f94-ab38-4c9e-860e-ee9867d7594a"),
    ("Final A", "Op 1x Gold",    "0ab4d35c-bc6c-4c6d-a2b4-710648294e67"),
    ("Final A", "W J18 2x",      "404b7f9b-1699-43ed-b25a-dc3a0efaa0ba"),
    ("Final A", "W 1x Trophy",   "30d823a9-7f1a-4d7f-a382-ceaf58c2f4de"),
    ("Final A", "Op J18 2x",     "b056ac40-2517-4e2e-b9ef-ca208b6336a2"),
    ("Final A", "Op 2- Gold",    "b7b7a4bc-6de0-4417-a5c4-8e71370ec1de"),
    ("Final A", "Op J16 4x-",    "0c6a3189-17f1-41a7-a645-35105adc7a81"),
    ("Final A", "W J16 8+",      "3aba651e-4502-4d73-b798-9504d00e3677"),
    ("Final A", "W 4x- Gold",    "99c36c58-b90b-46b8-90b9-dfb75a7e6b3f"),
    ("Final A", "Op 4+ Trophy",  "574bafe9-ef8e-459a-9a6f-dfac702854d8"),
    ("Final A", "W J18 4x-",     "d9cfe024-351a-4db4-b486-bbe1db265672"),
    ("Final A", "W 2- Gold",     "83f5c83f-a3e8-49d9-a224-337df35cc39e"),
    ("Final A", "Op J16 8+",     "1377169e-39b2-4c91-8b8f-eb1b3f8bab4a"),
    ("Final A", "W 2x Gold",     "09b258ad-9217-4f70-b084-eaac2ac95f25"),
    ("Final A", "Op J18 4+",     "1a6ad0f0-e6bd-4f85-88ee-de3b42a7a10c"),
    ("Final A", "W J18 4+",      "2df8c80c-9835-4a7b-ac8d-276614a08e47"),
    ("Final A", "Op 4- Trophy",  "ee4741c3-c664-4220-b515-d330e46fadd9"),
    ("Final A", "W 4+ Trophy",   "da56dc84-4147-44e3-953b-a08205d578f3"),
    ("Final A", "Op 1x Trophy",  "edc39486-d1f2-498f-bf32-aca3393b5598"),
    ("Final A", "Op 8+ Gold",    "06824649-4226-4d3c-be7d-c94b3041f316"),
    ("Final A", "W 8+ Gold",     "8412aa12-6509-479c-8f66-a56b20a6b02b"),
]


def load_wbt():
    bm = json.loads(WBT_PATH.read_text())
    wbt = {}
    for k, v in bm["wbt"].items():
        t = parse_time(v["time"])
        if t:
            wbt[k] = t
    return wbt


def parse_time(t):
    t = str(t).strip()
    m = re.match(r'^(\d+):(\d{2})\.(\d+)$', t)
    if not m:
        return None
    total = int(m[1]) * 60 + int(m[2]) + float('0.' + m[3])
    return total if total <= 1200 else None


def fmt_time(s):
    mins = int(s // 60)
    secs = s - mins * 60
    return f"{mins}:{secs:04.1f}"


def to_boat_class(ev):
    """Map an event string to a WBT key. Returns None if no WBT applies."""
    n = ev.strip()
    is_w   = bool(re.match(r'W\b', n))
    is_lwt = bool(re.search(r'\bLwt\b', n, re.I))
    pfx    = ("L" if is_lwt else "") + ("W" if is_w else "M")
    for pat, sfx in [("8+", "8+"), ("4-", "4-"), ("4x", "4x"), ("4+", "4+"),
                     ("2-", "2-"), ("2x", "2x"), ("1x", "1x")]:
        if re.search(re.escape(pat), n):
            return pfx + sfx
    return None


def scrape_result(session, uuid, event_name):
    """Fetch a race result page via __NEXT_DATA__ JSON and return results sorted by position."""
    url = f"{BASE_URL}/{uuid}"
    resp = session.get(url, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'html.parser')

    nd = soup.find('script', id='__NEXT_DATA__')
    if not nd:
        raise ValueError("No __NEXT_DATA__ found - site may have changed")

    data = json.loads(nd.string)
    q0 = data['props']['pageProps']['dehydratedState']['queries'][0]['state']['data']
    race_crew = q0.get('race_crew', {})

    # Race start clock time "HH:MM" for the "race conditions" feature. The race
    # dict carries start_time directly; fall back to parsing the "Sun, HH:MM - ..."
    # string with CLOCK_RE if needed.
    clock = None
    for race in (q0.get('race') or {}).values():
        clock = race.get('start_time')
        if not clock:
            cm = CLOCK_RE.search(race.get('string') or '')
            clock = cm.group(1) if cm else None
        break

    is_sculler = bool(re.search(r'\b1x\b', event_name))

    results = []
    for rc in race_crew.values():
        pos      = rc.get('adjusted_pos')
        time_str = rc.get('adjusted_result') or ''
        entry    = rc.get('entry') or {}

        if not pos or not time_str:
            continue
        try:
            pos_int = int(pos)
        except (ValueError, TypeError):
            continue

        combination = entry.get('combination', False)
        if combination:
            club_name = entry.get('name', '')
        else:
            club_name = (entry.get('club') or {}).get('name') or entry.get('name', '')

        stroke_name = entry.get('stroke_fullname') or ''
        crew = stroke_name if is_sculler else club_name

        results.append({
            'pos':      pos_int,
            'crew':     crew or club_name,
            'club':     club_name,
            'time_str': time_str,
        })

    return sorted(results, key=lambda x: x['pos']), clock


def build_races(wbt):
    session = requests.Session()
    session.headers['User-Agent'] = 'Mozilla/5.0 (compatible; rowingtools-scraper/1.0)'

    rows = []
    total = len(FINALS)
    for i, (round_label, event_name, uuid) in enumerate(FINALS):
        print(f"  [{i+1}/{total}] {event_name}", end=' ', flush=True)

        boat = to_boat_class(event_name)

        try:
            results, clock = scrape_result(session, uuid, event_name)
            time.sleep(0.15)
        except Exception as e:
            print(f"- ERROR: {e}")
            continue

        if not results:
            print("- no results")
            continue

        lanes = []
        for entry in results:
            wbt_t = wbt.get(boat) if boat else None
            t     = parse_time(entry['time_str'])
            pct   = round(wbt_t / t * 100, 1) if (wbt_t and t) else None
            if pct is not None and pct > 100:
                pct = None

            lanes.append({
                'crew': entry['crew'],
                'club': entry['club'],
                'time': fmt_time(t) if t else entry['time_str'],
                'pct':  pct,
            })

        if lanes:
            rows.append({
                'event': event_name,
                'round': round_label,
                'lanes': lanes,
                'boat':  boat or '',
                'clock': clock,
            })
            print(f"- {len(lanes)} entries")
        else:
            print("- no valid entries")

    return rows


# Modern template (matches heatmap-marlow26.html / heatmap-reading26.html). Uses
# __TOKEN__ placeholders filled via str.replace so the embedded JS braces stay
# literal (no f-string escaping). Poplar lanes have no per-crew "cat" band, so the
# renderHeatmap cell omits the .cc sub-label.
TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=0.55">
<title>__SEO_TITLE__</title>
<meta name="description" content="__DESC__">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0f0f0e;--bg2:#1a1a18;--bg3:#252523;--text:#f0f0ee;--text2:#9ca3af;--text3:#6b7280;--border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.14)}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);font-size:13px;padding:0 20px 2.5rem;max-width:1200px;margin:0 auto;line-height:1.6}
.topbar{position:fixed;top:0;left:0;width:100%;height:3px;background:#c8472b;z-index:9999;pointer-events:none}
.page-hdr{padding:2rem 0 1.25rem;border-bottom:1px solid var(--border);margin-bottom:1.5rem}
.back-nav{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text3);text-decoration:none;margin-bottom:10px;transition:color .15s;font-weight:500}
.back-nav:hover{color:var(--text2)}
.back-brand{font-family:'Fraunces',serif;font-weight:900;font-size:17px;letter-spacing:-0.03em;line-height:1}
.back-dot{color:#c8472b}
h1{font-size:20px;font-weight:700;letter-spacing:-0.4px;margin-bottom:4px}
.sub{color:var(--text3);font-size:12px;line-height:1.6;margin-bottom:0;max-width:820px}
input{background:var(--bg2);border:1.5px solid var(--border2);color:var(--text);padding:6px 11px;border-radius:8px;font-size:12px;margin-bottom:18px;width:220px;font-family:inherit;outline:none;transition:border-color .15s}
input:focus{border-color:#60a5fa}
table{border-collapse:collapse;font-size:11px;margin-bottom:28px}
caption{text-align:left;font-size:11px;font-weight:600;color:var(--text2);padding:0 0 6px;letter-spacing:.05em;text-transform:uppercase}
th{background:var(--bg2);color:var(--text3);font-weight:500;padding:5px 8px;border:1px solid rgba(255,255,255,0.05);text-align:center;white-space:nowrap;font-size:10px;letter-spacing:.04em;text-transform:uppercase}
th.rh{text-align:left;width:80px}
td{border:1px solid rgba(255,255,255,0.04);padding:0;vertical-align:top;min-width:80px;max-width:120px}
td.rnd{background:var(--bg2);color:var(--text3);font-size:11px;padding:5px 7px;white-space:nowrap;vertical-align:middle;font-weight:500}
.cell{padding:5px 6px;display:flex;flex-direction:column;align-items:center;gap:1px;transition:transform .15s}
td:not(.rnd):hover .cell{transform:scale(1.04)}
.cn{font-weight:600;font-size:10px;color:rgba(255,255,255,.85);white-space:normal;text-align:center;max-width:110px;word-break:break-word;line-height:1.3}
.cp{font-size:12px;font-weight:700}
.ct{font-size:10px;color:rgba(255,255,255,.4)}
.legend{display:flex;gap:14px;margin-bottom:18px;flex-wrap:wrap}
.li{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text3)}
.ls{width:10px;height:10px;border-radius:3px;flex-shrink:0}
.tabs{display:inline-flex;background:var(--bg3);border-radius:999px;padding:3px;gap:2px;margin-bottom:20px}
.tab{background:transparent;border:none;color:var(--text3);padding:7px 18px;border-radius:999px;font-size:12.5px;cursor:pointer;font-family:inherit;font-weight:500;transition:all .18s ease;white-space:nowrap}
.tab.active{background:var(--bg2);color:var(--text);box-shadow:0 1px 5px rgba(0,0,0,0.3)}
.tab:hover:not(.active){color:var(--text2)}
#lb-table,#clublb-table{width:100%;border-collapse:collapse;font-size:12px}
#lb-table th,#clublb-table th{background:var(--bg2);color:var(--text3);font-weight:500;padding:8px 10px;border-bottom:2px solid var(--border);text-align:left;white-space:nowrap;font-size:11px;letter-spacing:.04em;text-transform:uppercase;border-left:none;border-right:none;border-top:none}
#lb-table th.num,#clublb-table th.num{text-align:right}
#lb-table td,#clublb-table td{border:none;border-bottom:1px solid var(--border);padding:7px 10px;vertical-align:middle}
#lb-table td.num,#clublb-table td.num{text-align:right;font-variant-numeric:tabular-nums}
#lb-table tr:last-child td,#clublb-table tr:last-child td{border-bottom:none}
#lb-table tbody tr:hover td,#clublb-table tbody tr:hover td{background:var(--bg2)}
.rank-badge{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:700}
.rank-badge.gold{background:#3d2e00;color:#f0b030}
.rank-badge.silver{background:#1e2226;color:#a0aab4}
.rank-badge.bronze{background:#2d1800;color:#c87030}
.stat-card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 18px;min-width:170px}
.stat-card-name{font-weight:700;font-size:13px;margin-bottom:10px}
.stat-card-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;font-size:11px}
.stat-card-lbl{color:var(--text3)}
.stat-card-val{color:var(--text);font-weight:500}
.footer{margin-top:3rem;padding-top:1.25rem;border-top:1px solid var(--border);font-size:12px;color:var(--text3)}
.footer a{color:var(--text3);text-decoration:none;transition:color .15s}
.footer a:hover{color:var(--text2)}
@keyframes viewIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.view-in{animation:viewIn .35s ease}
@keyframes dotIn{from{fill-opacity:0}to{fill-opacity:0.75}}
</style>
</head>
<body>
<div class="topbar"></div>
<header class="page-hdr">
  <a href="/#leaderboards" class="back-nav"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7L9 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="back-brand">Rowing<span class="back-dot">.</span>Tools</span></a>
  <h1>__TITLE__</h1>
  <p class="sub">__SUB__</p>
</header>

<div class="tabs">
  <button class="tab active" onclick="showTab('heatmap',this)">Heatmap</button>
  <button class="tab" onclick="showTab('top100',this)">Result Leaderboard</button>
  <button class="tab" onclick="showTab('clublb',this)">Club Leaderboard</button>
  <button class="tab" onclick="showTab('compare',this)">Club Compare</button>
</div>
<div id="view-heatmap">
  <div class="legend">
    <div class="li"><div class="ls" style="background:#0a3d2a"></div>&#x2265;87% elite</div>
    <div class="li"><div class="ls" style="background:#0d2d4a"></div>80&#8211;87% high club</div>
    <div class="li"><div class="ls" style="background:#3d2200"></div>72&#8211;80% competitive</div>
    <div class="li"><div class="ls" style="background:#3d0e0a"></div>&lt;72% developing</div>
    <div class="li"><div class="ls" style="background:#252523"></div>no data</div>
  </div>
  <input type="text" id="ev-filter" placeholder="Filter events&#8230;" oninput="filterHeatmap(this.value)" style="margin-right:8px">
  <input type="text" id="club-filter-hm" list="cmp-clubs-list" placeholder="Filter by club&#8230;" oninput="filterClubHm(this.value)">
  <div id="heatmap-out"></div>
</div>
<div id="view-compare" style="display:none">
  <div style="margin-bottom:14px">
    <div id="cmp-inputs" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px"></div>
    <button onclick="addCmpClub()" style="background:#1e1e1e;border:1px solid #333;color:#888;padding:5px 14px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit">+ Add club</button>
    <button onclick="downloadCompare()" style="background:#c8472b;border:1px solid #c8472b;color:#fff;padding:5px 14px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit;font-weight:600;margin-left:8px">&#x2193; Save image</button>
  </div>
  <div id="cmp-stats" style="display:flex;gap:12px;margin-bottom:18px;flex-wrap:wrap"></div>
  <div id="cmp-chart"></div>
</div>
<datalist id="cmp-clubs-list"></datalist>
<div id="view-top100" style="display:none">
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:18px">
    <input type="text" id="lb-club-filter" list="cmp-clubs-list" placeholder="Filter by club&#8230;" oninput="renderTop100()" style="margin-bottom:0">
    <button onclick="downloadTop100CSV()" style="background:#1e1e1e;border:1px solid #333;color:#888;padding:5px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap">&#x2193; CSV</button>
  </div>
  <table id="lb-table">
    <thead><tr>
      <th class="num">#</th><th>Crew</th><th>Club</th><th>Event</th><th>Round</th>
      <th class="num">Time</th><th class="num">GMT%</th><th style="color:var(--text3);font-size:10px;text-align:center;text-transform:none;letter-spacing:0">share</th>
    </tr></thead>
    <tbody id="lb-body"></tbody>
  </table>
</div>
<div id="view-clublb" style="display:none">
  <label style="font-size:12px;color:#666;display:inline-block;margin-bottom:10px">Min entries: <input type="number" id="min-entries" value="2" min="1" style="width:52px;margin-left:4px" oninput="renderClubLB()"></label>
  <label style="font-size:12px;color:#666;display:inline-flex;align-items:center;gap:4px;margin-bottom:10px;margin-left:16px"><input type="checkbox" id="incl-composites" onchange="renderClubLB()" style="width:auto;margin-bottom:0;padding:0">Include composites</label>
  <button onclick="downloadClubLBCSV()" style="background:#1e1e1e;border:1px solid #333;color:#888;padding:5px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;margin-left:10px;margin-bottom:10px">&#x2193; CSV</button>
  <table id="clublb-table">
    <thead><tr>
      <th class="num">#</th><th>Club</th>
      <th class="num">Entries</th><th class="num">Events</th>
      <th class="num">Top 3 Avg</th><th class="num">Avg GMT%</th><th class="num">Best</th><th style="color:var(--text3);font-size:10px;text-transform:none;letter-spacing:0">share</th>
    </tr></thead>
    <tbody id="clublb-body"></tbody>
  </table>
</div>
<script>
const ROWS=__DATA__;
window.ROWS=ROWS;
window.META=__META__;
for(const r of ROWS)for(const l of r.lanes)if(l.pct!==null&&l.pct<50)l.pct=null;
function bg(p){return p===null?'#252523':p>=87?'#0a3d2a':p>=80?'#0d2d4a':p>=72?'#3d2200':'#3d0e0a'}
function fg(p){return p===null?'#555':p>=87?'#34d399':p>=80?'#60a5fa':p>=72?'#fb923c':'#f87171'}
function normClub(s){return(s||'').replace(/\s+[A-Z]$/,'').replace(/\s+(Rowing Club|Boat Club|RC|BC|ARC)\s*$/i,'').trim();}
function rankBadge(r){return r===1?'<span class="rank-badge gold">1</span>':r===2?'<span class="rank-badge silver">2</span>':r===3?'<span class="rank-badge bronze">3</span>':'<span style="color:var(--text3)">'+r+'</span>';}
function showTab(name,btn){
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  ['heatmap','top100','compare','clublb'].forEach(v=>{
    const el=document.getElementById('view-'+v);
    el.style.display=v===name?'':'none';
    if(v===name){el.classList.remove('view-in');void el.offsetWidth;el.classList.add('view-in');}
  });
  if(name==='heatmap')renderHeatmap(ROWS,document.getElementById('club-filter-hm').value);
  if(name==='top100') renderTop100();
  if(name==='clublb') renderClubLB();
}
function renderHeatmap(rows,clubQ){
  clubQ=normClub((clubQ||'').trim()).toLowerCase();
  const groups=new Map();
  for(const r of rows){if(!groups.has(r.event))groups.set(r.event,[]);groups.get(r.event).push(r);}
  let h='',tIdx=0;
  for(const[ev,races] of groups){
    const maxP=Math.min(Math.max(...races.map(r=>r.lanes.length)),8);
    let th='<th class="rh">Round</th>';
    for(let i=1;i<=maxP;i++)th+=`<th>P${i}</th>`;
    let tb='';
    for(const r of races){
      let cells=`<td class="rnd">${r.round}</td>`;
      for(let i=0;i<maxP;i++){
        const l=r.lanes[i];
        if(!l){cells+='<td></td>';continue;}
        const b=bg(l.pct),f=fg(l.pct),p=l.pct!==null?l.pct.toFixed(1)+'%':'&#x2014;';
        const dim=clubQ&&normClub(l.club).toLowerCase()!==clubQ?'opacity:0.12;':'';
        cells+=`<td style="background:${b};${dim}"><div class="cell"><span class="cn">${l.crew}</span><span class="cp" style="color:${f}">${p}</span><span class="ct">${l.time}</span></div></td>`;
      }
      tb+=`<tr>${cells}</tr>`;
    }
    h+=`<table style="animation:viewIn .55s ease ${Math.min(tIdx,25)*0.08}s both"><caption>${ev}</caption><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;tIdx++;
  }
  document.getElementById('heatmap-out').innerHTML=h||'<p style="color:#555">No results.</p>';
}
function filterHeatmap(q){
  q=q.toLowerCase().trim();
  const rows=q?ROWS.filter(r=>r.event.toLowerCase().includes(q)||r.boat.toLowerCase().includes(q)):ROWS;
  renderHeatmap(rows,document.getElementById('club-filter-hm').value);
}
function filterClubHm(q){
  const evQ=(document.getElementById('ev-filter').value||'').toLowerCase().trim();
  const rows=evQ?ROWS.filter(r=>r.event.toLowerCase().includes(evQ)||r.boat.toLowerCase().includes(evQ)):ROWS;
  renderHeatmap(rows,q);
}
function renderTop100(){
  const clubQ=normClub((document.getElementById('lb-club-filter').value||'').trim()).toLowerCase();
  const entries=[];
  for(const r of ROWS)for(const l of r.lanes)
    if(l.pct!==null)entries.push({crew:l.crew,club:l.club,event:r.event,round:r.round,time:l.time,pct:l.pct});
  entries.sort((a,b)=>b.pct-a.pct);
  entries.forEach((e,i)=>e.rank=i+1);
  const filtered=clubQ?entries.filter(e=>normClub(e.club).toLowerCase()===clubQ):entries;
  let h='';
  filtered.forEach(e=>{
    const f=fg(e.pct);
    h+=`<tr><td class="num">${rankBadge(e.rank)}</td><td><strong>${e.crew}</strong></td><td style="color:var(--text2)"><a href="clubs.html?club=${encodeURIComponent(normClub(e.club))}" style="color:inherit;text-decoration:none" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${e.club}</a></td><td style="color:var(--text3)">${e.event}</td><td style="color:var(--text3)">${e.round}</td><td class="num" style="color:var(--text2)">${e.time}</td><td class="num"><strong style="color:${f}">${e.pct.toFixed(1)}%</strong></td><td class="num"><button onclick="shareResult(this)" data-club="${e.club.replace(/"/g,'&quot;')}" data-event="${e.event.replace(/"/g,'&quot;')}" data-round="${e.round}" data-time="${e.time}" data-pct="${e.pct.toFixed(1)}" data-rank="${e.rank}" data-total="${entries.length}" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:14px;padding:2px 6px;border-radius:4px" title="Download result card">&#x2197;</button></td></tr>`;
  });
  document.getElementById('lb-body').innerHTML=h||'<tr><td colspan="8" style="color:#555;text-align:center;padding:20px">No results.</td></tr>';
}
const ALL_CLUBS=[...new Set(ROWS.flatMap(r=>r.lanes.map(l=>normClub(l.club)).filter(c=>c&&!c.includes('/'))))].sort((a,b)=>a.localeCompare(b));
document.getElementById('cmp-clubs-list').innerHTML=ALL_CLUBS.map(c=>'<option value="'+c.replace(/"/g,'&quot;')+'">').join('');
let cmpClubs=['',''];
const CMP_COLS=['#7bbfff','#f0b030','#4ee8b0','#ff7050','#c084fc','#fb923c'];
function renderClubInputs(){
  let h='';
  cmpClubs.forEach((q,i)=>{
    const col=CMP_COLS[i%CMP_COLS.length];
    const rm=cmpClubs.length>1?'<button onclick="removeCmpClub('+i+')" style="background:none;border:1px solid #2a2a2a;color:#555;cursor:pointer;font-size:13px;padding:1px 6px;border-radius:4px">&#x2715;</button>':'';
    h+='<div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:50%;background:'+col+';flex-shrink:0"></div><input type="text" list="cmp-clubs-list" value="'+q.replace(/"/g,'&quot;')+'" placeholder="Club name&#8230;" oninput="updateCmpClub('+i+',this.value)" style="margin-bottom:0;width:220px">'+rm+'</div>';
  });
  document.getElementById('cmp-inputs').innerHTML=h;
}
function addCmpClub(){if(cmpClubs.length>=6)return;cmpClubs.push('');renderClubInputs();}
function removeCmpClub(i){cmpClubs.splice(i,1);renderClubInputs();renderCompare();}
function updateCmpClub(i,v){cmpClubs[i]=v;renderCompare();}
function renderCompare(){
  const active=cmpClubs.map((q,i)=>{return{q:normClub(q.trim()),col:CMP_COLS[i%CMP_COLS.length]}}).filter(c=>c.q);
  if(!active.length){
    document.getElementById('cmp-stats').innerHTML='';
    document.getElementById('cmp-chart').innerHTML='<p style="color:#555;margin-top:8px">Enter one or more club names above.</p>';
    return;
  }
  const all=[];
  for(const r of ROWS)for(const l of r.lanes)
    if(l.pct!==null)all.push({crew:l.crew,club:normClub(l.club),event:r.event,round:r.round,time:l.time,pct:l.pct});
  const clubs=active.map(c=>{return{...c,entries:all.filter(e=>!e.club.includes('/')&&e.club.toLowerCase()===c.q.toLowerCase())}});
  function mkStat(c){
    if(!c.entries.length)return'<div class="stat-card"><div class="stat-card-name" style="color:'+c.col+'">'+c.q+'</div><div class="stat-card-lbl" style="margin-top:6px">No results found</div></div>';
    const pcts=c.entries.map(e=>e.pct);
    const avg=pcts.reduce((a,b)=>a+b,0)/pcts.length;
    const best=Math.max(...pcts);
    const top3=pcts.slice().sort((a,b)=>b-a).slice(0,3).reduce((a,b)=>a+b,0)/Math.min(3,pcts.length);
    const evts=new Set(c.entries.map(e=>e.event)).size;
    return'<div class="stat-card"><div class="stat-card-name" style="color:'+c.col+'">'+c.q+'</div><div class="stat-card-grid"><span class="stat-card-lbl">Entries</span><span class="stat-card-val">'+c.entries.length+'</span><span class="stat-card-lbl">Events</span><span class="stat-card-val">'+evts+'</span><span class="stat-card-lbl">Avg GMT%</span><span class="stat-card-val" style="color:'+c.col+'">'+avg.toFixed(1)+'%</span><span class="stat-card-lbl">Top 3 avg</span><span class="stat-card-val" style="color:'+c.col+'">'+top3.toFixed(1)+'%</span><span class="stat-card-lbl">Best</span><span class="stat-card-val" style="font-weight:700">'+best.toFixed(1)+'%</span></div></div>';
  }
  document.getElementById('cmp-stats').innerHTML=clubs.map(mkStat).join('');
  const allPcts=clubs.flatMap(c=>c.entries.map(e=>e.pct));
  if(!allPcts.length){document.getElementById('cmp-chart').innerHTML='';return;}
  const minP=Math.max(50,Math.floor(Math.min(...allPcts))-3);
  const maxP=Math.min(100,Math.ceil(Math.max(...allPcts))+2);
  const n=clubs.length;
  const BAND_H=Math.max(44,Math.min(70,Math.floor(280/n)));
  const PL=96,PR=20,PT=14,PB=36,W=720;
  const H=PT+n*BAND_H+PB;
  const cW=W-PL-PR;
  function xOf(p){return PL+(p-minP)/(maxP-minP)*cW;}
  let s='';
  for(let p=Math.ceil(minP/5)*5;p<=maxP;p+=5){const x=xOf(p).toFixed(1);s+='<line x1="'+x+'" y1="'+PT+'" x2="'+x+'" y2="'+(PT+n*BAND_H)+'" stroke="#1e1e1e" stroke-width="1"/>';}
  const axY=PT+n*BAND_H;
  s+='<line x1="'+PL+'" y1="'+axY+'" x2="'+(W-PR)+'" y2="'+axY+'" stroke="#2a2a2a" stroke-width="1"/>';
  for(let p=Math.ceil(minP/5)*5;p<=maxP;p+=5){const x=xOf(p).toFixed(1);s+='<line x1="'+x+'" y1="'+axY+'" x2="'+x+'" y2="'+(axY+5)+'" stroke="#333" stroke-width="1"/><text x="'+x+'" y="'+(axY+16)+'" text-anchor="middle" fill="#444" font-size="10">'+p+'%</text>';}
  clubs.forEach((c,bi)=>{
    const bY=PT+bi*BAND_H;
    if(bi%2===0)s+='<rect x="'+PL+'" y="'+bY+'" width="'+cW+'" height="'+BAND_H+'" fill="#161616"/>';
    s+='<text x="'+(PL-8)+'" y="'+(bY+BAND_H/2+4)+'" text-anchor="end" fill="'+c.col+'" font-size="11" font-weight="600">'+c.q.substring(0,16)+'</text>';
    if(c.entries.length){const avg=c.entries.map(e=>e.pct).reduce((a,b)=>a+b,0)/c.entries.length;const ax=xOf(avg).toFixed(1);s+='<line x1="'+ax+'" y1="'+bY+'" x2="'+ax+'" y2="'+(bY+BAND_H)+'" stroke="'+c.col+'" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.5"/><text x="'+ax+'" y="'+(bY+10)+'" text-anchor="middle" fill="'+c.col+'" font-size="9" opacity="0.7">'+avg.toFixed(1)+'%</text>';}
    const sorted=[...c.entries].sort((a,b)=>a.pct-b.pct);
    sorted.forEach((e,j)=>{
      const jy=(bY+BAND_H/2-BAND_H*0.3+((j*7+3)%11)/10*BAND_H*0.6).toFixed(1);
      const tip=e.crew+' ('+e.club+')&#10;'+e.event+' '+e.round+'&#10;'+e.time+' ('+e.pct.toFixed(1)+'%)';
      s+='<circle cx="'+xOf(e.pct).toFixed(1)+'" cy="'+jy+'" r="4" fill="'+c.col+'" fill-opacity="0" stroke="#111" stroke-width="0.5" style="animation:dotIn 1.0s ease '+(j*0.06).toFixed(2)+'s forwards"><title>'+tip+'</title></circle>';
    });
  });
  document.getElementById('cmp-chart').innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;max-width:'+W+'px;height:'+H+'px;display:block;overflow:visible">'+s+'</svg>';
}
function buildClubMap(){
  const inclComp=document.getElementById('incl-composites').checked;
  const minN=Math.max(1,parseInt(document.getElementById('min-entries').value)||1);
  const map={};
  for(const r of ROWS)for(const l of r.lanes){
    if(l.pct===null||(!inclComp&&l.club.includes('/')))continue;
    const cn=normClub(l.club);if(!cn)continue;
    if(!map[cn])map[cn]={pcts:[],events:new Set()};
    map[cn].pcts.push(l.pct);map[cn].events.add(r.event);
  }
  return Object.entries(map).map(([name,c])=>{
    const s=c.pcts.slice().sort((a,b)=>b-a);
    return{name,count:c.pcts.length,events:c.events.size,avg:c.pcts.reduce((a,b)=>a+b,0)/c.pcts.length,top3avg:s.slice(0,3).reduce((a,b)=>a+b,0)/Math.min(3,s.length),best:s[0]};
  }).filter(c=>c.count>=minN).sort((a,b)=>b.top3avg-a.top3avg);
}
function renderClubLB(){
  const ranked=buildClubMap();
  let h='';
  ranked.forEach((c,i)=>{
    const f=fg(c.avg),ft=fg(c.top3avg);
    h+='<tr><td class="num">'+rankBadge(i+1)+'</td><td><a href="clubs.html?club='+encodeURIComponent(c.name)+'" style="color:inherit;text-decoration:none;font-weight:700" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">'+c.name+'</a></td><td class="num" style="color:var(--text2)">'+c.count+'</td><td class="num" style="color:var(--text2)">'+c.events+'</td><td class="num"><strong style="color:'+ft+'">'+c.top3avg.toFixed(1)+'%</strong></td><td class="num" style="color:var(--text3)">'+c.avg.toFixed(1)+'%</td><td class="num" style="color:var(--text2)">'+c.best.toFixed(1)+'%</td><td class="num"><button onclick="shareClub(this)" data-club="'+c.name.replace(/"/g,'&quot;')+'" data-rank="'+(i+1)+'" data-total="'+ranked.length+'" data-top3="'+c.top3avg.toFixed(1)+'" data-avg="'+c.avg.toFixed(1)+'" data-best="'+c.best.toFixed(1)+'" data-entries="'+c.count+'" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:14px;padding:2px 6px;border-radius:4px" title="Download club card">&#x2197;</button></td></tr>';
  });
  document.getElementById('clublb-body').innerHTML=h||'<tr><td colspan="8" style="color:#555;text-align:center;padding:20px">No data.</td></tr>';
}
function dlCSV(rows,fn){
  const blob=new Blob([rows.map(r=>r.map(c=>(typeof c==='string'&&(c.includes(',')||c.includes('"')))?'"'+c.replace(/"/g,'""')+'"':c).join(',')).join('\n')],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=fn;a.click();
}
function downloadTop100CSV(){
  const clubQ=normClub((document.getElementById('lb-club-filter').value||'').trim()).toLowerCase();
  const entries=[];
  for(const r of ROWS)for(const l of r.lanes)if(l.pct!==null)entries.push({crew:l.crew,club:normClub(l.club),event:r.event,round:r.round,time:l.time,pct:l.pct});
  entries.sort((a,b)=>b.pct-a.pct);
  const filtered=clubQ?entries.filter(e=>e.club.toLowerCase()===clubQ):entries;
  dlCSV([['Crew','Club','Event','Round','Time','GMT%'],...filtered.map(e=>[e.crew,e.club,e.event,e.round,e.time,e.pct.toFixed(1)])],'heatmap-__COMP__-top250.csv');
}
function downloadClubLBCSV(){
  const ranked=buildClubMap();
  dlCSV([['#','Club','Entries','Events','Top 3 Avg %','Avg GMT%','Best %'],...ranked.map((c,i)=>[i+1,c.name,c.count,c.events,c.top3avg.toFixed(1),c.avg.toFixed(1),c.best.toFixed(1)])],'heatmap-__COMP__-clubs.csv');
}
function downloadCompare(){
  const svg=document.querySelector('#cmp-chart svg');
  if(!svg){alert('Nothing to download.');return;}
  const vb=svg.getAttribute('viewBox').split(' ').map(Number);
  const W=vb[2]||720,H=vb[3]||400,PL=20,HEADER=54,PB=44;
  const TW=W+PL*2,TH=H+HEADER+PB;
  const full='<svg xmlns="http://www.w3.org/2000/svg" width="'+TW+'" height="'+TH+'"><rect width="'+TW+'" height="'+TH+'" fill="#111"/><text x="'+PL+'" y="28" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="700" fill="#e8e8e6">__JS_TITLE__</text><text x="'+PL+'" y="46" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="11" fill="#c8472b" font-weight="600">rowingtools.co.uk</text><g transform="translate('+PL+','+HEADER+')">'+svg.innerHTML+'</g></svg>';
  const blob=new Blob([full],{type:'image/svg+xml'});
  const url=URL.createObjectURL(blob);
  const img=new Image();
  img.onload=()=>{const c=document.createElement('canvas');c.width=TW*2;c.height=TH*2;const ctx=c.getContext('2d');ctx.scale(2,2);ctx.drawImage(img,0,0);c.toBlob(b=>{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='heatmap-__COMP__-compare.png';a.click();},'image/png');URL.revokeObjectURL(url);};
  img.src=url;
}
renderClubInputs();
renderHeatmap(ROWS,'');
</script>

<div class="footer"><a href="/">← rowingtools.co.uk</a></div>
<script src="rowingtools-share.js"></script>
<script src="conditions.js"></script>
</body>
</html>"""


def generate_html(rows, comp, title):
    sub = ("GMT% vs WBT. Heats excluded (Finals only). J14 and J15 events excluded. "
           "<strong style=\"color:#c8a030\">Conditions:</strong> there was a strong "
           "headwind throughout the day, with conditions getting significantly worse "
           "for the last races of the day.")
    return (TEMPLATE
            .replace("__SEO_TITLE__", f"{title} Results - GMT% Analysis | RowingTools")
            .replace("__DESC__", f"{title} results with GMT% analysis, club and crew "
                                 "rankings, and top performers. Compare every crew's time "
                                 "against world benchmarks.")
            .replace("__TITLE__", title)
            .replace("__SUB__", sub)
            .replace("__JS_TITLE__", title.replace("'", "\\'"))
            .replace("__COMP__", comp)
            .replace("__META__", json.dumps({"venue": VENUE, "date": RACE_DATE}))
            .replace("__DATA__", json.dumps(rows)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate a GMT%% heatmap HTML from Poplar Regatta 2026 results."
    )
    parser.add_argument("--comp",  default="poplar26",             help="Competition code for CSV filenames")
    parser.add_argument("--title", default="Poplar Regatta 2026",  help="Page title")
    parser.add_argument("--out",   default=None,                   help="Output HTML path (default: ../../heatmap-<comp>.html)")
    args = parser.parse_args()

    wbt  = load_wbt()
    rows = build_races(wbt)
    html = generate_html(rows, args.comp, args.title)

    out_name = args.out or f"../../heatmap-{args.comp}.html"
    out = (Path(__file__).parent / out_name).resolve()
    out.write_text(html, encoding="utf-8")
    print(f"\nWritten: {out}  ({len(rows)} races)")
