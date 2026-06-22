#!/usr/bin/env python3
"""
generate_heatmap_nsr26.py
Generate a GMT% heatmap HTML by scraping time-team.nl NSR 2026 results.

Covers Championship, 2nd 8+, 3rd 8+ (and all other non-junior) events.
Excludes J14, J15, J16 age-group events.

Usage:
    python gmt_processor/inputs/generate_heatmap_nsr26.py --out heatmap-nsr26.html
"""

import argparse, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from courses import COURSES

WBT_PATH = Path(__file__).parent.parent.parent / "data" / "benchmarks_v3.json"
BASE_URL = "https://regatta.time-team.nl/nsr/2026/results"

# Events to include: (uuid, display_name, boat_key)
# Ordered: 8+ first, then 4x, 4+, 4-, 2x, 2-, 1x; Girls before Open within each group
EVENTS = [
    ("edb78e5ac-8a70-445c-822b-df237936a912", "Ch 8+ (Girls)",  "W8+"),
    ("ea5694d44-a0f9-4f8b-95db-e93a14b7f243", "Ch 8+ (Open)",   "M8+"),
    ("ea6d48261-e328-4378-b9f0-637b83c3b0ac", "2nd 8+ (Girls)", "W8+"),
    ("e8458d414-45b3-401e-8c7e-917f727b7037", "2nd 8+ (Open)",  "M8+"),
    ("e60927bc7-be23-465d-bec2-9aecf817fdbb", "3rd 8+ (Open)",  "M8+"),
    ("e96e72d1e-2b4a-48b3-b77c-0449a1b23b46", "Ch 4x (Girls)",  "W4x"),
    ("ebe352f27-cbe5-43a7-a846-5fea491e432f", "Ch 4x (Open)",   "M4x"),
    ("ef83c814e-c4cf-47db-ab9e-914a050a64b7", "2nd 4x (Girls)", "W4x"),
    ("eeb011d63-14cb-4d48-b173-a54744a27a00", "2nd 4x (Open)",  "M4x"),
    ("e0f3d1a68-bb29-4306-8b94-533c980a6fa5", "Ch 4+ (Girls)",  "W4+"),
    ("ea2b5ee20-6b2d-4e1a-8700-f1bcb8bfaf11", "Ch 4+ (Open)",   "M4+"),
    ("e0ca4b57f-ee20-454e-8eb0-33afb6e9402e", "Ch 4- (Girls)",  "W4-"),
    ("ec3387d68-3c91-45af-9459-95671bcdaa6a", "Ch 4- (Open)",   "M4-"),
    ("e050d49da-ddf3-4a7b-a9f3-259a52226294", "Ch 2x (Girls)",  "W2x"),
    ("e73515cb5-57b1-4983-8473-5af1d3a87977", "Ch 2x (Open)",   "M2x"),
    ("e22e5e685-ea7d-490c-b159-876a35e4f889", "Ch 2- (Girls)",  "W2-"),
    ("ead9a02eb-126a-44ab-97b0-d7a3b1810856", "Ch 2- (Open)",   "M2-"),
    ("e3a73e8e0-376d-40c9-a095-eaef1b753b7e", "Ch 1x (Girls)",  "W1x"),
    ("e2557acef-ae56-4446-97b1-9e7832495b38", "Ch 1x (Open)",   "M1x"),
]

# Full club code -> name lookup (from regatta.time-team.nl/nsr/2026/results/clubs.php)
CLUBS = {
    "ABS":  "Abingdon School Boat Club",
    "ABV":  "AB Severn Boat Club",
    "ASL":  "American School In London Boat Club",
    "ASR":  "Aberdeen Schools Rowing Association",
    "BAE":  "Barn Elms Rowing Club",
    "BDS":  "Bedford School Boat Club",
    "BEB":  "Bewl Bridge Rowing Club",
    "BED":  "Bedford Rowing Club",
    "BGS":  "Bedford Girls' School Rowing Club",
    "BMS":  "Bedford Modern School Boat Club",
    "BRD":  "Bradford Amateur Rowing Club",
    "BRE":  "Brentford Boat Club",
    "BRG":  "Bradford Grammar School Boat Club",
    "BRY":  "Bryanston School Boat Club",
    "BUL":  "Burton Leander Rowing Club",
    "BUR":  "Burway Rowing Club",
    "CAB":  "Cantabrigian Rowing Club",
    "CAM":  "City of Cambridge Rowing Club",
    "CAN":  "Canford School Boat Club",
    "CBR":  "City of Bristol Rowing Club",
    "CBS":  "Cambois Rowing Club",
    "CCS":  "Claires Court School Boat Club",
    "CHE":  "Cheltenham College Boat Club",
    "CHR":  "Christchurch Rowing Club CIC",
    "CLS":  "Chester le Street Amateur Rowing Club",
    "COX":  "City of Oxford Rowing Club",
    "CSN":  "Sunderland, City of, Rowing Club",
    "DAT":  "Dart Totnes Amateur Rowing Club",
    "DBY":  "Derby Rowing Club",
    "DOS":  "Doncaster Schools' Rowing Association",
    "DUL":  "Dulwich College Boat Club",
    "DUR":  "Durham Amateur Rowing Club",
    "DUS":  "Durham School Boat Club",
    "EMA":  "Emanuel School Boat Club",
    "ETN":  "Eton College Boat Club",
    "ETX":  "Eton Excelsior Rowing Club",
    "EXE":  "Exeter Rowing Club",
    "FAL":  "Falcon Boat Club",
    "FUL":  "Fulham Reach Boat Club",
    "GGA":  "Glasgow Academy Rowing Club",
    "GHS":  "George Heriot's School Rowing Club",
    "GLR":  "Gloucester Rowing Club",
    "GLT":  "Godolphin & Latymer School Boat Club",
    "GLW":  "Glasgow Rowing Club",
    "GMS":  "Great Marlow School Boat Club",
    "GOR":  "Gorse, The, Boat Club",
    "GRN":  "Grange School, The Rowing Club",
    "GUI":  "Guildford Rowing Club",
    "GWC":  "George Watsons College RC",
    "HAB":  "Haberdashers Monmouth School Rowing Club",
    "HAM":  "Hampton School Boat Club",
    "HCS":  "Hereford Cathedral School Boat Club",
    "HED":  "Headington School Oxford Boat Club",
    "HEN":  "Henley Rowing Club",
    "HER":  "Hereford Rowing Club",
    "HEX":  "Hexham Rowing Club",
    "HIN":  "Hinksey Sculling School",
    "HPY":  "Hartpury University & College Boat Club",
    "HRD":  "Harrodian Boat Club",
    "HWG":  "Royal Grammar Sch. High Wycombe Boat Club",
    "IBP":  "Ibstock Place School Boat Club",
    "INF":  "Infinity Boat Club",
    "JAG":  "James Allen's Girls' School Boat Club",
    "KCA":  "King's School Canterbury, The, Boat Club",
    "KCH":  "King's School Chester, The, Rowing Club",
    "KCS":  "King's College School Boat Club",
    "KGS":  "Kingston Grammar School Boat Club",
    "KHS":  "Kew House School Boat Club",
    "KRC":  "Kingston Rowing Club",
    "KSE":  "King's School Ely, The, Boat Club",
    "KSR":  "King's Rochester Boat Club",
    "KSW":  "King's School Worcester, The, Boat Club",
    "LAM":  "Lambton Rowing Club",
    "LDR":  "Leander Club",
    "LEA":  "Lea Rowing Club",
    "LEE":  "Leeds Rowing Club",
    "LEH":  "Lady Eleanor Holles Boat Club",
    "LEY":  "Leys School Boat Club",
    "LLA":  "Llandaff Rowing Club",
    "LTU":  "Latymer Upper School Boat Club",
    "LYM":  "Lymington Amateur Rowing Club",
    "MAR":  "Marlow Rowing Club",
    "MBC":  "Molesey Boat Club",
    "MGN":  "Magdalen College School Boat Club",
    "MHD":  "Maidenhead Rowing Club",
    "MIL":  "Millfield School Boat Club",
    "MIN":  "Minerva Bath Rowing Club",
    "MNK":  "Monkton Combe School Boat Club",
    "MOC":  "Monmouth Comprehensive School Boat Club",
    "NCR":  "Nottinghamshire County Rowing Assn",
    "NHS":  "Norwich High School Rowing Club",
    "NOW":  "Northwich Rowing Club",
    "NSC":  "Norwich School Boat Club",
    "NTN":  "Northampton Rowing Club",
    "NUN":  "Nottingham and Union Rowing Club",
    "NWK":  "Newark Rowing Club",
    "ORA":  "Oratory School Boat Club",
    "OUN":  "Oundle School Boat Club",
    "PAN":  "Pangbourne College Boat Club",
    "PET":  "Peterborough City Rowing Club",
    "PHS":  "Putney High School Boat Club",
    "QEH":  "Queen Elizabeth High School Rowing Club",
    "QPC":  "Queen's Park Chester Rowing Club",
    "RAD":  "Radley College Boat Club",
    "RBL":  "Reading Blue Coat School Boat Club",
    "RCH":  "Royal Chester Rowing Club",
    "RDG":  "Reading Rowing Club",
    "RDH":  "Radnor House School Rowing Club",
    "ROB":  "Rob Roy Boat Club",
    "SAN":  "St Andrew Boat Club",
    "SBT":  "Surbiton High School Boat Club",
    "SCP":  "Strathclyde Park Rowing Club",
    "SES":  "St Edward's School Boat Club",
    "SGC":  "St George's College Boat Club",
    "SHO":  "Shoreham Rowing Club",
    "SHP":  "Shiplake College Boat Club",
    "SHR":  "Royal Shrewsbury School Boat Club",
    "SHS":  "Shanklin Sandown Rowing Club",
    "SMA":  "St Mary's School BC, Cambridge",
    "SNE":  "St Neots Rowing Club",
    "SPG":  "St Paul's Girls' School Boat Club",
    "SPS":  "St Paul's School Boat Club",
    "SPY":  "St Peter's School Boat Club",
    "STA":  "Star Club",
    "STC":  "Streatham and Clapham High School Boat Club",
    "STK":  "Trentham Boat Club",
    "STO":  "Stowe Sculling Club",
    "SUA":  "Stratford upon Avon Boat Club",
    "SWB":  "Sir William Borlase's Gram Sch Boat Club",
    "SWP":  "Sir William Perkins's School Rowing Club",
    "SYD":  "Sydenham & Dulwich Girls Rowing Club",
    "TEE":  "Tees Rowing Club",
    "TES":  "1863 Club, The",
    "TFN":  "Tiffin School Boat Club",
    "THS":  "Thames Scullers",
    "TMS":  "Tormead Rowing Club",
    "TRF":  "Trafford Rowing Club",
    "TSS":  "Tideway Scullers School",
    "TTA":  "Talkin Tarn Amateur Rowing Club",
    "TUN":  "Taunton Rowing Club",
    "TYN":  "Tyne Amateur Rowing Club",
    "WBK":  "Walbrook Rowing Club",
    "WBS":  "The Windsor Boys' School Boat Club",
    "WES":  "Westminster School Boat Club",
    "WEY":  "Weybridge Rowing Club",
    "WGS":  "Windsor Girls' School Boat Club",
    "WHS":  "Wimbledon High School Boat Club",
    "WIN":  "Winchester College Boat Club",
    "WLT":  "Walton Rowing Club",
    "WRC":  "Wallingford Rowing Club",
    "WRG":  "Royal Grammar School Worcester Boat Club",
    "WRR":  "Worcester Rowing Club",
    "WTN":  "Warrington Rowing Club",
    "WYC":  "Wycliffe College Boat Club",
    "YRK":  "York City Rowing Club",
    "YRM":  "Yarm School Boat Club",
    "ZAJS": "St Joseph College Rowing Club",
    "ZAMC": "Methodist College Belfast Rowing Club",
    "ZAPR": "Enniskillen Royal Boat Club",
    "ZASM": "St Michaels Rowing Club (Limerick)",
    "ZASN": "Shandon Boat Club",
    "ZHEN": "Pakistan National Schools Rowing Team",
    "ZLY":  "Lee Valley Rowing Club",
}

FINAL_RE = re.compile(r'\bFinal\s+([A-Z])\b')
TIME_RE   = re.compile(r'^\d+:\d{2}\.\d+$')
CLOCK_RE  = re.compile(r'\b(\d{1,2}:\d{2})\b')      # race start clock time in the h2 header
DAY_RE    = re.compile(r'^\s*([A-Za-z]{3,9}),')     # weekday at start of h2 text

# Course / venue config for the "race conditions" feature (see courses.py).
# NSR 2026 is at Dorney Lake; this event spans three days (Fri 22 - Sun 24 May 2026).
VENUE = COURSES["dorney"]

# Multi-day: map the weekday (as it appears in each h2 header) to its date.
DAY_DATES = {
    "Fri": "2026-05-22", "Sat": "2026-05-23", "Sun": "2026-05-24",
    "Friday": "2026-05-22", "Saturday": "2026-05-23", "Sunday": "2026-05-24",
}
RACE_DATE = "2026-05-22"   # META fallback = first day; per-race date overrides this


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


def scrape_event(session, uuid, display_name):
    """Fetch one event page and return list of (final_letter, rows) tuples."""
    from bs4 import BeautifulSoup

    url = f"{BASE_URL}/{uuid}.php"
    resp = session.get(url, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'html.parser')

    finals = []

    # Walk h2 headings (the site uses <h2> for race titles)
    seen_finals = set()
    for tag in soup.find_all('h2'):
        text = tag.get_text(' ', strip=True)
        m = FINAL_RE.search(text)
        if not m:
            continue
        letter = m.group(1).upper()
        if letter in seen_finals:
            continue

        cm = CLOCK_RE.search(text)
        clock = cm.group(1) if cm else None
        dm = DAY_RE.match(text)
        day = dm.group(1) if dm else None
        date = DAY_DATES.get(day)

        table = tag.find_next('table')
        if not table:
            continue

        rows = []
        for tr in table.find_all('tr'):
            cells = tr.find_all('td')
            if len(cells) < 5:
                continue

            # Skip sub-rows (stroke name / interval rows) which have empty pos
            pos_text = cells[0].get_text(strip=True).rstrip('.')
            try:
                pos = int(pos_text)
            except ValueError:
                continue

            code = cells[1].get_text(strip=True)

            # Finish time: scan cells right-to-left for the last TIME_RE match.
            # The table interleaves rank columns between splits, so header-based
            # indexing is unreliable. The finish time is always the last time cell.
            time_text = None
            for cell in reversed(cells):
                t = cell.get_text(strip=True)
                if TIME_RE.match(t):
                    time_text = t
                    break
            if time_text is None:
                continue

            # Use the code->name lookup so club names are consistent regardless
            # of whether the crew column holds a club name or an athlete name.
            club = CLUBS.get(code, code)
            rows.append({'pos': pos, 'club': club, 'time': time_text})

        if rows:
            finals.append((letter, rows, clock, date))
            seen_finals.add(letter)

    finals.sort(key=lambda x: x[0])  # A before B before C ...
    return finals


def build_races(session, wbt):
    rows_out = []

    for uuid, display_name, boat_key in EVENTS:
        wbt_t = wbt.get(boat_key)
        if wbt_t is None:
            print(f"  WARNING: no WBT for {boat_key} ({display_name})")

        finals = scrape_event(session, uuid, display_name)
        if not finals:
            print(f"  {display_name}: no finals found")
            continue

        event_lanes = []
        for letter, result_rows, clock, date in finals:
            round_label = f"Final {letter}"
            lanes = []
            for entry in sorted(result_rows, key=lambda x: x['pos']):
                t = parse_time(entry['time'])
                pct = round(wbt_t / t * 100, 1) if (wbt_t and t) else None
                lanes.append({
                    "crew": entry['club'],
                    "club": entry['club'],
                    "time": fmt_time(t) if t else entry['time'],
                    "pct":  pct,
                })
            event_lanes.append({
                "event": display_name,
                "round": round_label,
                "lanes": lanes,
                "boat":  boat_key,
                "clock": clock,
                "date":  date,
            })
            print(f"  {display_name} {round_label}: {len(lanes)} crews")

        rows_out.extend(event_lanes)

    return rows_out


def generate_html(rows, comp, title):
    data_json = json.dumps(rows)
    meta_json = json.dumps({"venue": VENUE, "date": RACE_DATE})
    js_title = title.replace("'", "\\'")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#111;color:#e8e8e6;font-size:13px;padding:24px 20px}}
h1{{font-size:17px;font-weight:600;margin-bottom:4px}}
.sub{{color:#666;font-size:12px;margin-bottom:18px}}
input{{background:#1e1e1e;border:1px solid #333;color:#e8e8e6;padding:5px 10px;border-radius:6px;font-size:12px;margin-bottom:18px;width:220px}}
table{{border-collapse:collapse;font-size:11px;margin-bottom:28px}}
caption{{text-align:left;font-size:12px;font-weight:600;color:#aaa;padding:0 0 6px;letter-spacing:.03em;text-transform:uppercase}}
th{{background:#1a1a1a;color:#555;font-weight:500;padding:4px 8px;border:1px solid #222;text-align:center;white-space:nowrap}}
th.rh{{text-align:left;width:80px}}
td{{border:1px solid #1e1e1e;padding:0;vertical-align:top;min-width:80px;max-width:120px}}
td.rnd{{background:#161616;color:#777;font-size:11px;padding:5px 7px;white-space:nowrap;vertical-align:middle}}
.cell{{padding:5px 6px;display:flex;flex-direction:column;align-items:center;gap:1px}}
.cn{{font-weight:600;font-size:10px;color:rgba(255,255,255,.85);white-space:normal;text-align:center;max-width:110px;word-break:break-word;line-height:1.3}}
.cp{{font-size:12px;font-weight:700}}
.ct{{font-size:10px;color:rgba(255,255,255,.4)}}
.legend{{display:flex;gap:14px;margin-bottom:18px;flex-wrap:wrap}}
.li{{display:flex;align-items:center;gap:5px;font-size:11px;color:#777}}
.ls{{width:12px;height:12px;border-radius:2px;flex-shrink:0}}
.tabs{{display:flex;gap:8px;margin-bottom:18px}}
.tab{{background:#1e1e1e;border:1px solid #333;color:#888;padding:6px 16px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit}}
.tab.active{{background:#2a2a2a;border-color:#555;color:#e8e8e6;font-weight:600}}
#lb-table,#clublb-table{{width:100%;border-collapse:collapse;font-size:12px}}
#lb-table th,#clublb-table th{{background:#1a1a1a;color:#555;font-weight:500;padding:6px 10px;border:1px solid #222;text-align:left;white-space:nowrap}}
#lb-table th.num,#clublb-table th.num{{text-align:right}}
#lb-table td,#clublb-table td{{border:1px solid #1e1e1e;padding:6px 10px;vertical-align:middle}}
#lb-table td.num,#clublb-table td.num{{text-align:right;font-variant-numeric:tabular-nums}}
#lb-table tr:hover td,#clublb-table tr:hover td{{background:#1a1a1a}}
</style>
</head>
<body>
<h1>{title}</h1>
<p class="sub">GMT% vs WBT. Championship, 2nd and 3rd eights categories. J14/J15/J16 excluded. Results via regatta.time-team.nl.</p>
<div class="tabs">
  <button class="tab active" onclick="showTab('heatmap',this)">Heatmap</button>
  <button class="tab" onclick="showTab('top100',this)">Top 250 Results</button>
  <button class="tab" onclick="showTab('clublb',this)">Club Leaderboard</button>
  <button class="tab" onclick="showTab('compare',this)">Club Compare</button>
</div>
<div id="view-heatmap">
  <div class="legend">
    <div class="li"><div class="ls" style="background:#1a4d3e"></div>&#x2265;87% elite</div>
    <div class="li"><div class="ls" style="background:#1a3a5c"></div>80&#8211;87% high club</div>
    <div class="li"><div class="ls" style="background:#4a3200"></div>72&#8211;80% competitive</div>
    <div class="li"><div class="ls" style="background:#4a1a0a"></div>&lt;72% developing</div>
    <div class="li"><div class="ls" style="background:#2a2a2a"></div>no data</div>
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
      <th class="num">Time</th><th class="num">GMT%</th>
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
      <th class="num">Top 3 Avg</th><th class="num">Avg GMT%</th><th class="num">Best</th>
    </tr></thead>
    <tbody id="clublb-body"></tbody>
  </table>
</div>
<script>
const ROWS={data_json};
window.ROWS=ROWS;
window.META={meta_json};
for(const r of ROWS)for(const l of r.lanes)if(l.pct!==null&&l.pct<50)l.pct=null;
function bg(p){{return p===null?'#2a2a2a':p>=87?'#1a4d3e':p>=80?'#1a3a5c':p>=72?'#4a3200':'#4a1a0a'}}
function fg(p){{return p===null?'#555':p>=87?'#4ee8b0':p>=80?'#7bbfff':p>=72?'#f0b030':'#ff7050'}}
function normClub(s){{return(s||'').replace(/\\s+[A-Z]$/,'').trim();}}
function showTab(name,btn){{
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('view-heatmap').style.display =name==='heatmap'?'':'none';
  document.getElementById('view-top100').style.display  =name==='top100' ?'':'none';
  document.getElementById('view-compare').style.display =name==='compare'?'':'none';
  document.getElementById('view-clublb').style.display  =name==='clublb' ?'':'none';
  if(name==='heatmap')renderHeatmap(ROWS,document.getElementById('club-filter-hm').value);
  if(name==='top100') renderTop100();
  if(name==='clublb') renderClubLB();
}}
function renderHeatmap(rows,clubQ){{
  clubQ=normClub((clubQ||'').trim()).toLowerCase();
  const groups=new Map();
  for(const r of rows){{if(!groups.has(r.event))groups.set(r.event,[]);groups.get(r.event).push(r);}}
  let h='';
  for(const[ev,races] of groups){{
    const maxP=Math.min(Math.max(...races.map(r=>r.lanes.length)),8);
    let th='<th class="rh">Round</th>';
    for(let i=1;i<=maxP;i++)th+=`<th>P${{i}}</th>`;
    let tb='';
    for(const r of races){{
      let cells=`<td class="rnd">${{r.round}}</td>`;
      for(let i=0;i<maxP;i++){{
        const l=r.lanes[i];
        if(!l){{cells+='<td></td>';continue;}}
        const b=bg(l.pct),f=fg(l.pct),p=l.pct!==null?l.pct.toFixed(1)+'%':'&#x2014;';
        const dim=clubQ&&normClub(l.club).toLowerCase()!==clubQ?'opacity:0.12;':'';
        cells+=`<td style="background:${{b}};${{dim}}"><div class="cell"><span class="cn">${{l.crew}}</span><span class="cp" style="color:${{f}}">${{p}}</span><span class="ct">${{l.time}}</span></div></td>`;
      }}
      tb+=`<tr>${{cells}}</tr>`;
    }}
    h+=`<table><caption>${{ev}}</caption><thead><tr>${{th}}</tr></thead><tbody>${{tb}}</tbody></table>`;
  }}
  document.getElementById('heatmap-out').innerHTML=h||'<p style="color:#555">No results.</p>';
}}
function filterHeatmap(q){{
  q=q.toLowerCase().trim();
  const rows=q?ROWS.filter(r=>r.event.toLowerCase().includes(q)||r.boat.toLowerCase().includes(q)):ROWS;
  renderHeatmap(rows,document.getElementById('club-filter-hm').value);
}}
function filterClubHm(q){{
  const evQ=(document.getElementById('ev-filter').value||'').toLowerCase().trim();
  const rows=evQ?ROWS.filter(r=>r.event.toLowerCase().includes(evQ)||r.boat.toLowerCase().includes(evQ)):ROWS;
  renderHeatmap(rows,q);
}}
function renderTop100(){{
  const clubQ=normClub((document.getElementById('lb-club-filter').value||'').trim()).toLowerCase();
  const entries=[];
  for(const r of ROWS)for(const l of r.lanes)
    if(l.pct!==null)entries.push({{crew:l.crew,club:l.club,event:r.event,round:r.round,time:l.time,pct:l.pct}});
  entries.sort((a,b)=>b.pct-a.pct);
  entries.forEach((e,i)=>e.rank=i+1);
  const filtered=clubQ?entries.filter(e=>normClub(e.club).toLowerCase()===clubQ):entries;
  let h='';
  filtered.slice(0,250).forEach((e)=>{{
    const f=fg(e.pct);
    h+=`<tr><td class="num" style="color:#555">${{e.rank}}</td><td><strong>${{e.crew}}</strong></td><td style="color:#888">${{e.club}}</td><td style="color:#aaa">${{e.event}}</td><td style="color:#666">${{e.round}}</td><td class="num" style="color:#888">${{e.time}}</td><td class="num"><strong style="color:${{f}}">${{e.pct.toFixed(1)}}%</strong></td></tr>`;
  }});
  document.getElementById('lb-body').innerHTML=h||'<tr><td colspan="7" style="color:#555;text-align:center;padding:20px">No results.</td></tr>';
}}
const ALL_CLUBS=[...new Set(ROWS.flatMap(r=>r.lanes.map(l=>normClub(l.club)).filter(c=>c&&!c.includes('/'))))].sort((a,b)=>a.localeCompare(b));
document.getElementById('cmp-clubs-list').innerHTML=ALL_CLUBS.map(c=>'<option value="'+c.replace(/"/g,'&quot;')+'">').join('');
let cmpClubs=['',''];
const CMP_COLS=['#7bbfff','#f0b030','#4ee8b0','#ff7050','#c084fc','#fb923c'];
function renderClubInputs(){{
  let h='';
  cmpClubs.forEach((q,i)=>{{
    const col=CMP_COLS[i%CMP_COLS.length];
    const rm=cmpClubs.length>1?'<button onclick="removeCmpClub('+i+')" style="background:none;border:1px solid #2a2a2a;color:#555;cursor:pointer;font-size:13px;padding:1px 6px;border-radius:4px">&#x2715;</button>':'';
    h+='<div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:50%;background:'+col+';flex-shrink:0"></div><input type="text" list="cmp-clubs-list" value="'+q.replace(/"/g,'&quot;')+'" placeholder="Club name&#8230;" oninput="updateCmpClub('+i+',this.value)" style="margin-bottom:0;width:220px">'+rm+'</div>';
  }});
  document.getElementById('cmp-inputs').innerHTML=h;
}}
function addCmpClub(){{if(cmpClubs.length>=6)return;cmpClubs.push('');renderClubInputs();}}
function removeCmpClub(i){{cmpClubs.splice(i,1);renderClubInputs();renderCompare();}}
function updateCmpClub(i,v){{cmpClubs[i]=v;renderCompare();}}
function renderCompare(){{
  const active=cmpClubs.map((q,i)=>{{return{{q:normClub(q.trim()),col:CMP_COLS[i%CMP_COLS.length]}}}}).filter(c=>c.q);
  if(!active.length){{
    document.getElementById('cmp-stats').innerHTML='';
    document.getElementById('cmp-chart').innerHTML='<p style="color:#555;margin-top:8px">Enter one or more club names above.</p>';
    return;
  }}
  const all=[];
  for(const r of ROWS)for(const l of r.lanes)
    if(l.pct!==null)all.push({{crew:l.crew,club:normClub(l.club),event:r.event,round:r.round,time:l.time,pct:l.pct}});
  const clubs=active.map(c=>{{return{{...c,entries:all.filter(e=>!e.club.includes('/')&&e.club.toLowerCase()===c.q.toLowerCase())}}}});
  function mkStat(c){{
    if(!c.entries.length)return'<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;min-width:160px"><div style="color:'+c.col+';font-weight:700;font-size:13px">'+c.q+'</div><div style="color:#555;font-size:11px;margin-top:6px">No results found</div></div>';
    const pcts=c.entries.map(e=>e.pct);
    const avg=pcts.reduce((a,b)=>a+b,0)/pcts.length;
    const best=Math.max(...pcts);
    const top3=pcts.slice().sort((a,b)=>b-a).slice(0,3).reduce((a,b)=>a+b,0)/Math.min(3,pcts.length);
    const evts=new Set(c.entries.map(e=>e.event)).size;
    return'<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;min-width:170px"><div style="color:'+c.col+';font-weight:700;font-size:13px;margin-bottom:8px">'+c.q+'</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;font-size:11px"><span style="color:#666">Entries</span><span style="color:#ccc">'+c.entries.length+'</span><span style="color:#666">Events</span><span style="color:#ccc">'+evts+'</span><span style="color:#666">Avg GMT%</span><span style="color:'+c.col+';font-weight:600">'+avg.toFixed(1)+'%</span><span style="color:#666">Top 3 avg</span><span style="color:'+c.col+';font-weight:600">'+top3.toFixed(1)+'%</span><span style="color:#666">Best</span><span style="color:#fff;font-weight:700">'+best.toFixed(1)+'%</span></div></div>';
  }}
  document.getElementById('cmp-stats').innerHTML=clubs.map(mkStat).join('');
  const allPcts=clubs.flatMap(c=>c.entries.map(e=>e.pct));
  if(!allPcts.length){{document.getElementById('cmp-chart').innerHTML='';return;}}
  const minP=Math.max(50,Math.floor(Math.min(...allPcts))-3);
  const maxP=Math.min(100,Math.ceil(Math.max(...allPcts))+2);
  const n=clubs.length;
  const BAND_H=Math.max(44,Math.min(70,Math.floor(280/n)));
  const PL=96,PR=20,PT=14,PB=36,W=720;
  const H=PT+n*BAND_H+PB;
  const cW=W-PL-PR;
  function xOf(p){{return PL+(p-minP)/(maxP-minP)*cW;}}
  let s='';
  for(let p=Math.ceil(minP/5)*5;p<=maxP;p+=5){{const x=xOf(p).toFixed(1);s+='<line x1="'+x+'" y1="'+PT+'" x2="'+x+'" y2="'+(PT+n*BAND_H)+'" stroke="#1e1e1e" stroke-width="1"/>';}}
  const axY=PT+n*BAND_H;
  s+='<line x1="'+PL+'" y1="'+axY+'" x2="'+(W-PR)+'" y2="'+axY+'" stroke="#2a2a2a" stroke-width="1"/>';
  for(let p=Math.ceil(minP/5)*5;p<=maxP;p+=5){{const x=xOf(p).toFixed(1);s+='<line x1="'+x+'" y1="'+axY+'" x2="'+x+'" y2="'+(axY+5)+'" stroke="#333" stroke-width="1"/><text x="'+x+'" y="'+(axY+16)+'" text-anchor="middle" fill="#444" font-size="10">'+p+'%</text>';}}
  clubs.forEach((c,bi)=>{{
    const bY=PT+bi*BAND_H;
    if(bi%2===0)s+='<rect x="'+PL+'" y="'+bY+'" width="'+cW+'" height="'+BAND_H+'" fill="#161616"/>';
    s+='<text x="'+(PL-8)+'" y="'+(bY+BAND_H/2+4)+'" text-anchor="end" fill="'+c.col+'" font-size="11" font-weight="600">'+c.q.substring(0,16)+'</text>';
    if(c.entries.length){{const avg=c.entries.map(e=>e.pct).reduce((a,b)=>a+b,0)/c.entries.length;const ax=xOf(avg).toFixed(1);s+='<line x1="'+ax+'" y1="'+bY+'" x2="'+ax+'" y2="'+(bY+BAND_H)+'" stroke="'+c.col+'" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.5"/><text x="'+ax+'" y="'+(bY+10)+'" text-anchor="middle" fill="'+c.col+'" font-size="9" opacity="0.7">'+avg.toFixed(1)+'%</text>';}}
    const sorted=[...c.entries].sort((a,b)=>a.pct-b.pct);
    sorted.forEach((e,j)=>{{
      const jy=(bY+BAND_H/2-BAND_H*0.3+((j*7+3)%11)/10*BAND_H*0.6).toFixed(1);
      const tip=e.crew+' ('+e.club+')&#10;'+e.event+' '+e.round+'&#10;'+e.time+' ('+e.pct.toFixed(1)+'%)';
      s+='<circle cx="'+xOf(e.pct).toFixed(1)+'" cy="'+jy+'" r="4" fill="'+c.col+'" fill-opacity="0.75" stroke="#111" stroke-width="0.5"><title>'+tip+'</title></circle>';
    }});
  }});
  document.getElementById('cmp-chart').innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;max-width:'+W+'px;height:'+H+'px;display:block;overflow:visible">'+s+'</svg>';
}}
function buildClubMap(){{
  const inclComp=document.getElementById('incl-composites').checked;
  const minN=Math.max(1,parseInt(document.getElementById('min-entries').value)||1);
  const map={{}};
  for(const r of ROWS)for(const l of r.lanes){{
    if(l.pct===null||(!inclComp&&l.club.includes('/')))continue;
    const cn=normClub(l.club);if(!cn)continue;
    if(!map[cn])map[cn]={{pcts:[],events:new Set()}};
    map[cn].pcts.push(l.pct);map[cn].events.add(r.event);
  }}
  return Object.entries(map).map(([name,c])=>{{
    const s=c.pcts.slice().sort((a,b)=>b-a);
    return{{name,count:c.pcts.length,events:c.events.size,avg:c.pcts.reduce((a,b)=>a+b,0)/c.pcts.length,top3avg:s.slice(0,3).reduce((a,b)=>a+b,0)/Math.min(3,s.length),best:s[0]}};
  }}).filter(c=>c.count>=minN).sort((a,b)=>b.top3avg-a.top3avg);
}}
function renderClubLB(){{
  const ranked=buildClubMap();
  let h='';
  ranked.forEach((c,i)=>{{
    const f=fg(c.avg),ft=fg(c.top3avg);
    h+='<tr><td class="num" style="color:#555">'+(i+1)+'</td><td><strong>'+c.name+'</strong></td><td class="num" style="color:#888">'+c.count+'</td><td class="num" style="color:#888">'+c.events+'</td><td class="num"><strong style="color:'+ft+'">'+c.top3avg.toFixed(1)+'%</strong></td><td class="num" style="color:#aaa">'+c.avg.toFixed(1)+'%</td><td class="num" style="color:#ccc">'+c.best.toFixed(1)+'%</td></tr>';
  }});
  document.getElementById('clublb-body').innerHTML=h||'<tr><td colspan="7" style="color:#555;text-align:center;padding:20px">No data.</td></tr>';
}}
function dlCSV(rows,fn){{
  const blob=new Blob([rows.map(r=>r.map(c=>(typeof c==='string'&&(c.includes(',')||c.includes('"')))?'"'+c.replace(/"/g,'""')+'"':c).join(',')).join('\\n')],{{type:'text/csv'}});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=fn;a.click();
}}
function downloadTop100CSV(){{
  const clubQ=normClub((document.getElementById('lb-club-filter').value||'').trim()).toLowerCase();
  const entries=[];
  for(const r of ROWS)for(const l of r.lanes)if(l.pct!==null)entries.push({{crew:l.crew,club:normClub(l.club),event:r.event,round:r.round,time:l.time,pct:l.pct}});
  entries.sort((a,b)=>b.pct-a.pct);
  const filtered=clubQ?entries.filter(e=>e.club.toLowerCase()===clubQ):entries;
  dlCSV([['Crew','Club','Event','Round','Time','GMT%'],...filtered.slice(0,250).map(e=>[e.crew,e.club,e.event,e.round,e.time,e.pct.toFixed(1)])],'heatmap-{comp}-top250.csv');
}}
function downloadClubLBCSV(){{
  const ranked=buildClubMap();
  dlCSV([['#','Club','Entries','Events','Top 3 Avg %','Avg GMT%','Best %'],...ranked.map((c,i)=>[i+1,c.name,c.count,c.events,c.top3avg.toFixed(1),c.avg.toFixed(1),c.best.toFixed(1)])],'heatmap-{comp}-clubs.csv');
}}
function downloadCompare(){{
  const svg=document.querySelector('#cmp-chart svg');
  if(!svg){{alert('Nothing to download.');return;}}
  const vb=svg.getAttribute('viewBox').split(' ').map(Number);
  const W=vb[2]||720,H=vb[3]||400,PL=20,HEADER=54,PB=44;
  const TW=W+PL*2,TH=H+HEADER+PB;
  const full='<svg xmlns="http://www.w3.org/2000/svg" width="'+TW+'" height="'+TH+'"><rect width="'+TW+'" height="'+TH+'" fill="#111"/><text x="'+PL+'" y="28" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="700" fill="#e8e8e6">{js_title}</text><text x="'+PL+'" y="46" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="11" fill="#c8472b" font-weight="600">rowingtools.co.uk</text><g transform="translate('+PL+','+HEADER+')">'+svg.innerHTML+'</g></svg>';
  const blob=new Blob([full],{{type:'image/svg+xml'}});
  const url=URL.createObjectURL(blob);
  const img=new Image();
  img.onload=()=>{{const c=document.createElement('canvas');c.width=TW*2;c.height=TH*2;const ctx=c.getContext('2d');ctx.scale(2,2);ctx.drawImage(img,0,0);c.toBlob(b=>{{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='heatmap-{comp}-compare.png';a.click();}},'image/png');URL.revokeObjectURL(url);}};
  img.src=url;
}}
renderClubInputs();
renderHeatmap(ROWS,'');
</script>
<script src="conditions.js"></script>
</body>
</html>"""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate GMT% heatmap HTML from NSR 2026 results.")
    parser.add_argument("--comp",  default="nsr26",                         help="Competition code for CSV filenames")
    parser.add_argument("--title", default="National Schools' Regatta 2026", help="Page title")
    parser.add_argument("--out",   default=None,                             help="Output HTML file path")
    args = parser.parse_args()

    import requests
    session = requests.Session()
    session.headers.update({'User-Agent': 'Mozilla/5.0'})

    wbt  = load_wbt()
    rows = build_races(session, wbt)
    html = generate_html(rows, args.comp, args.title)

    out = args.out or str((Path(__file__).parent / f"../../heatmap-{args.comp}.html").resolve())
    Path(out).write_text(html, encoding="utf-8")
    print(f"\nWritten: {out}  ({len(rows)} race rounds)")
