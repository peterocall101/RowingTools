#!/usr/bin/env python3
"""
generate_heatmap_nottm26.py
Generate a GMT% heatmap HTML by scraping regatta.time-team.nl
for Nottingham City Regatta 2026.

Site structure:
  races.php - table listing all races, each with a link to r[UUID].php
  r[UUID].php - result page: table with pos, code, crew (stroke), event, lane, finish, diff

Includes: all Finals (A/B/C/D/E). Excludes: Time Trials.
Mixed Lwt/non-Lwt races (e.g. "Op, Op Lwt 1x") are resolved per-row from the event column.

Usage:
    python generate_heatmap_nottm26.py
    python generate_heatmap_nottm26.py --comp nottm26 --title "Nottingham City Regatta 2026" --out ../../heatmap-nottm26.html
"""

import argparse, json, re, time
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    raise SystemExit("Install dependencies: pip install requests beautifulsoup4")

BASE_URL  = "https://regatta.time-team.nl/nottingham-city-regatta/2026/results"
RACES_URL = f"{BASE_URL}/races.php"
WBT_PATH  = Path(__file__).parent.parent.parent / "data" / "benchmarks_v3.json"
HREF_RE   = re.compile(r'^r[0-9a-f\-]+\.php$', re.I)


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


EXCLUDE_ROW_RE = re.compile(r'\bJ(?!18)\d{2}\b|\bU23\b|\bAR\b|\bBeg\b', re.I)


def looks_like_club(text):
    """Return True if text looks like a club/school name rather than a person's name."""
    return bool(re.search(
        r'\b(?:Rowing|Sculling|Boat\s+Club|School|University|Academy|College)\b',
        text, re.I
    ))


def to_boat_class(ev):
    """Map a per-row event string to a WBT key. Returns None if no WBT applies.
    Does NOT handle J16/age-group exclusion - use EXCLUDE_ROW_RE for that.
    """
    n = ev.strip()
    is_w   = bool(re.match(r'W\b', n))
    is_lwt = bool(re.search(r'\bLwt\b', n, re.I))
    pfx    = ("L" if is_lwt else "") + ("W" if is_w else "M")
    for pat, sfx in [("8+","8+"), ("4-","4-"), ("4x","4x"), ("4+","4+"),
                     ("2-","2-"), ("2x","2x"), ("1x","1x")]:
        if re.search(re.escape(pat), n):
            return pfx + sfx
    return None


def race_boat_class(title):
    """Extract the primary boat class label from a race title (no WBT exclusion logic).
    Used as the 'boat' field for JS filtering and as the WBT fallback for single-event races.
    """
    n = title.strip()
    is_w = bool(re.match(r'W\b', n))
    pfx = "W" if is_w else "M"
    for pat, sfx in [("8+","8+"), ("4-","4-"), ("4x","4x"), ("4+","4+"),
                     ("2-","2-"), ("2x","2x"), ("1x","1x")]:
        if re.search(re.escape(pat), n):
            return pfx + sfx
    return None


def race_event_display(title):
    """Strip 'Final X' or 'Time Trial' suffix from race title to get the event display name."""
    return re.sub(r'\s+(?:Final\s+[A-Z]|Time\s+Trial)\s*$', '', title, flags=re.I).strip()


def race_round(title):
    """Extract the round label ('Final A', 'Final B', ...) from a race title."""
    m = re.search(r'(Final\s+[A-Z]|Time\s+Trial)\s*$', title, re.I)
    return m.group(1) if m else ''


def parse_crew_name(crew_raw, supp_raw=''):
    """Parse crew/club from main row and optional supplementary row.

    For scullers (1x): main row has person name, supp row has club name.
    For crew boats: main row has 'Club Name A' (stroke appended after ', '), supp row has stroke name.
    Returns (club, crew_display).
    """
    crew_raw = crew_raw.strip()
    supp_raw = (supp_raw or '').strip()

    if supp_raw and looks_like_club(supp_raw):
        # Sculler: main row = person name, supp row = club name (strip trailing entry letter)
        club = re.sub(r'\s+[A-Z]$', '', supp_raw).strip()
        return club, crew_raw

    # Crew boat: strip stroke name (after last ', ') and trailing entry letter
    if ', ' in crew_raw:
        crew_raw = crew_raw[:crew_raw.rfind(', ')].strip()
    crew_display = crew_raw
    club = re.sub(r'\s+[A-Z]$', '', crew_raw).strip()
    return club, crew_display


def scrape_races(session):
    """Fetch races.php and return list of (title, href) for Final races only."""
    resp = session.get(RACES_URL, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'html.parser')

    finals = []
    for a in soup.find_all('a', href=HREF_RE):
        title = a.get_text(strip=True)
        if not title:
            continue
        if not re.search(r'\bFinal\s+[A-Z]\b', title, re.I):
            continue
        finals.append((title, a['href']))

    return finals


def scrape_result(session, href):
    """Fetch a race result page and return list of row dicts: {pos, crew_raw, event_col, time_raw, supp_raw}.

    The site uses two rows per entry: a main row (with position and time) and a supplementary row
    (empty position cell) that holds either the stroke name (crew boats) or the club name (scullers).
    Both are captured; supp_raw is used by parse_crew_name to identify the club for scullers.
    """
    url = f"{BASE_URL}/{href}"
    resp = session.get(url, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'html.parser')

    for table in soup.find_all('table'):
        header_tr = table.find('tr')
        if not header_tr:
            continue
        headers = [c.get_text(strip=True).lower() for c in header_tr.find_all(['th', 'td'])]

        pos_col = next((i for i, h in enumerate(headers) if 'pos' in h), None)
        if pos_col is None:
            continue

        crew_col = next((i for i, h in enumerate(headers) if 'crew' in h or 'stroke' in h), None)
        if crew_col is None:
            continue

        event_col = next((i for i, h in enumerate(headers) if h == 'event'), None)

        time_col = next((i for i, h in enumerate(headers) if 'finish' in h or h == 'time'), None)
        if time_col is None:
            continue

        pending = None
        rows = []
        for tr in table.find_all('tr')[1:]:
            cells = [td.get_text(strip=True) for td in tr.find_all('td')]
            if len(cells) < 3:
                continue

            pos_raw = cells[pos_col].rstrip('.').strip() if pos_col < len(cells) else ''
            try:
                pos = int(pos_raw)
                # Main row: flush any previous pending entry first
                if pending is not None:
                    rows.append(pending)
                combined = ' '.join(cells).upper()
                if any(v in combined for v in ('DNF', 'DNS', 'DSQ', 'SCRATCH', 'NRO', 'EXCL', 'RET')):
                    pending = None
                    continue
                crew_raw  = cells[crew_col]  if crew_col  < len(cells) else ''
                event_raw = cells[event_col] if (event_col is not None and event_col < len(cells)) else ''
                time_raw  = cells[time_col]  if time_col  < len(cells) else ''
                pending = {'pos': pos, 'crew_raw': crew_raw, 'event_col': event_raw, 'time_raw': time_raw, 'supp_raw': ''}
            except (ValueError, IndexError):
                # Supplementary row: attach to the pending main row and commit
                if pending is not None:
                    pending['supp_raw'] = cells[crew_col] if crew_col < len(cells) else ''
                    rows.append(pending)
                    pending = None

        if pending is not None:
            rows.append(pending)

        if rows:
            return rows

    return []


def build_races(wbt):
    session = requests.Session()
    session.headers['User-Agent'] = 'Mozilla/5.0 (compatible; rowingtools-scraper/1.0)'

    race_list = scrape_races(session)
    print(f"Found {len(race_list)} finals")

    rows = []
    for i, (title, href) in enumerate(race_list):
        event_display = race_event_display(title)
        round_label   = race_round(title)
        boat_fallback = race_boat_class(event_display)
        print(f"  [{i+1}/{len(race_list)}] {title}", end=' ', flush=True)

        try:
            results = scrape_result(session, href)
            time.sleep(0.1)
        except Exception as e:
            print(f"- ERROR: {e}")
            continue

        if not results:
            print("- no results")
            continue

        lanes = []
        for entry in sorted(results, key=lambda x: x['pos']):
            ev_col = entry['event_col'].strip()

            if ev_col:
                boat = to_boat_class(ev_col)
            else:
                boat = boat_fallback

            wbt_t = wbt.get(boat) if boat else None
            t     = parse_time(entry['time_raw'])
            pct   = round(wbt_t / t * 100, 1) if (wbt_t and t) else None
            if pct is not None and pct > 100:
                pct = None  # time faster than WBT - non-standard distance or timing error

            club, crew = parse_crew_name(entry['crew_raw'], entry.get('supp_raw', ''))
            lanes.append({
                'crew': crew,
                'club': club,
                'time': fmt_time(t) if t else '',
                'pct':  pct,
            })

        if lanes:
            rows.append({
                'event': event_display,
                'round': round_label,
                'lanes': lanes,
                'boat':  boat_fallback or '',
            })
            print(f"- {len(lanes)} entries")
        else:
            print("- no valid entries")

    return rows


def generate_html(rows, comp, title):
    data_json = json.dumps(rows)
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
td{{border:1px solid #1e1e1e;padding:0;vertical-align:top;min-width:80px;max-width:110px}}
td.rnd{{background:#161616;color:#777;font-size:11px;padding:5px 7px;white-space:nowrap;vertical-align:middle}}
.cell{{padding:5px 6px;display:flex;flex-direction:column;align-items:center;gap:1px}}
.cn{{font-weight:600;font-size:11px;color:rgba(255,255,255,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:96px}}
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
<p class="sub">GMT% vs WBT. Time Trials excluded. <strong style="color:#c8a030">Caution:</strong> a number of timing errors occurred at this regatta &#8212; treat all times carefully. Events with the most obvious errors (W 4+ and W 4-) are shown without GMT%.</p>
<div class="tabs">
  <button class="tab active" onclick="showTab('heatmap',this)">Heatmap</button>
  <button class="tab" onclick="showTab('top100',this)">Top 250 Results</button>
  <button class="tab" onclick="showTab('clublb',this)">Club Leaderboard</button>
  <button class="tab" onclick="showTab('compare',this)">Club Compare</button>
</div>
<div id="view-heatmap">
  <div class="legend">
    <div class="li"><div class="ls" style="background:#1a4d3e"></div>&#x2265;87% elite</div>
    <div class="li"><div class="ls" style="background:#1a3a5c"></div>80&#x2013;87% high club</div>
    <div class="li"><div class="ls" style="background:#4a3200"></div>72&#x2013;80% competitive</div>
    <div class="li"><div class="ls" style="background:#4a1a0a"></div>&lt;72% developing</div>
    <div class="li"><div class="ls" style="background:#2a2a2a"></div>no WBT data</div>
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
<div id="view-top100" style="display:none;">
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
  <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:10px">
    <label style="font-size:12px;color:#666">Min entries: <input type="number" id="min-entries" value="2" min="1" style="width:52px;margin-left:4px;background:#1e1e1e;border:1px solid #333;color:#e8e8e6;padding:4px 8px;border-radius:6px;font-size:12px" oninput="renderClubLB()"></label>
    <label style="font-size:12px;color:#666;display:inline-flex;align-items:center;gap:4px"><input type="checkbox" id="incl-composites" onchange="renderClubLB()" style="width:auto;margin:0;padding:0">Include composites</label>
    <button onclick="downloadClubLBCSV()" style="background:#1e1e1e;border:1px solid #333;color:#888;padding:5px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap">&#x2193; CSV</button>
  </div>
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
for(const r of ROWS)for(const l of r.lanes)if(l.pct!==null&&l.pct<50)l.pct=null;
function normClub(n){{return(n||'').replace(/\\s*\\([A-Za-z]\\)\\s*$/,'').trim();}}
function bg(p){{return p===null?'#2a2a2a':p>=87?'#1a4d3e':p>=80?'#1a3a5c':p>=72?'#4a3200':'#4a1a0a'}}
function fg(p){{return p===null?'#555':p>=87?'#4ee8b0':p>=80?'#7bbfff':p>=72?'#f0b030':'#ff7050'}}
function showTab(name,btn){{
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('view-heatmap').style.display=name==='heatmap'?'':'none';
  document.getElementById('view-top100').style.display=name==='top100'?'':'none';
  document.getElementById('view-compare').style.display=name==='compare'?'':'none';
  document.getElementById('view-clublb').style.display=name==='clublb'?'':'none';
  if(name==='heatmap')renderHeatmap(ROWS,document.getElementById('club-filter-hm').value);
  if(name==='top100')renderTop100();
  if(name==='clublb')renderClubLB();
}}
function renderHeatmap(rows,clubQ){{
  clubQ=(clubQ||'').toLowerCase().trim();
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
        cells+=`<td style="background:${{b}};${{dim}}"><div class="cell" title="${{l.club}}"><span class="cn">${{l.crew}}</span><span class="cp" style="color:${{f}}">${{p}}</span><span class="ct">${{l.time}}</span></div></td>`;
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
  const clubQ=(document.getElementById('lb-club-filter').value||'').toLowerCase().trim();
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
const ALL_CLUBS=[...new Set(ROWS.flatMap(r=>r.lanes.map(l=>l.club).filter(c=>c&&!c.includes('/')).map(normClub)))].sort((a,b)=>a.localeCompare(b));
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
  const active=cmpClubs.map((q,i)=>{{return{{q:q.trim(),col:CMP_COLS[i%CMP_COLS.length]}}}}).filter(c=>c.q);
  if(!active.length){{
    document.getElementById('cmp-stats').innerHTML='';
    document.getElementById('cmp-chart').innerHTML='<p style="color:#555;margin-top:8px">Enter one or more club names above.</p>';
    return;
  }}
  const all=[];
  for(const r of ROWS)for(const l of r.lanes)
    if(l.pct!==null)all.push({{crew:l.crew,club:l.club,event:r.event,round:r.round,time:l.time,pct:l.pct}});
  const clubs=active.map(c=>{{
    return{{...c,entries:all.filter(e=>!e.club.includes('/')&&normClub(e.club).toLowerCase()===c.q.toLowerCase())}};
  }});
  function mkStat(c){{
    if(!c.entries.length)return'<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;min-width:160px"><div style="color:'+c.col+';font-weight:700;font-size:13px">'+c.q+'</div><div style="color:#555;font-size:11px;margin-top:6px">No results found</div></div>';
    const pcts=c.entries.map(e=>e.pct);
    const avg=pcts.reduce((a,b)=>a+b,0)/pcts.length;
    const best=Math.max(...pcts);
    const top3=pcts.slice().sort((a,b)=>b-a).slice(0,3).reduce((a,b)=>a+b,0)/Math.min(3,pcts.length);
    const evts=new Set(c.entries.map(e=>e.event)).size;
    return'<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;min-width:170px">'
      +'<div style="color:'+c.col+';font-weight:700;font-size:13px;margin-bottom:8px">'+c.q+'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;font-size:11px">'
      +'<span style="color:#666">Entries</span><span style="color:#ccc">'+c.entries.length+'</span>'
      +'<span style="color:#666">Events</span><span style="color:#ccc">'+evts+'</span>'
      +'<span style="color:#666">Avg GMT%</span><span style="color:'+c.col+';font-weight:600">'+avg.toFixed(1)+'%</span>'
      +'<span style="color:#666">Top 3 avg</span><span style="color:'+c.col+';font-weight:600">'+top3.toFixed(1)+'%</span>'
      +'<span style="color:#666">Best</span><span style="color:#fff;font-weight:700">'+best.toFixed(1)+'%</span>'
      +'</div></div>';
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
  for(let p=Math.ceil(minP/5)*5;p<=maxP;p+=5){{
    const x=xOf(p).toFixed(1);
    s+='<line x1="'+x+'" y1="'+PT+'" x2="'+x+'" y2="'+(PT+n*BAND_H)+'" stroke="#1e1e1e" stroke-width="1"/>';
  }}
  const axY=PT+n*BAND_H;
  s+='<line x1="'+PL+'" y1="'+axY+'" x2="'+(W-PR)+'" y2="'+axY+'" stroke="#2a2a2a" stroke-width="1"/>';
  for(let p=Math.ceil(minP/5)*5;p<=maxP;p+=5){{
    const x=xOf(p).toFixed(1);
    s+='<line x1="'+x+'" y1="'+axY+'" x2="'+x+'" y2="'+(axY+5)+'" stroke="#333" stroke-width="1"/>';
    s+='<text x="'+x+'" y="'+(axY+16)+'" text-anchor="middle" fill="#444" font-size="10">'+p+'%</text>';
  }}
  clubs.forEach((c,bi)=>{{
    const bY=PT+bi*BAND_H;
    if(bi%2===0)s+='<rect x="'+PL+'" y="'+bY+'" width="'+cW+'" height="'+BAND_H+'" fill="#161616"/>';
    s+='<text x="'+(PL-8)+'" y="'+(bY+BAND_H/2+4)+'" text-anchor="end" fill="'+c.col+'" font-size="11" font-weight="600">'+c.q.substring(0,16)+'</text>';
    if(c.entries.length){{
      const avg=c.entries.map(e=>e.pct).reduce((a,b)=>a+b,0)/c.entries.length;
      const ax=xOf(avg).toFixed(1);
      s+='<line x1="'+ax+'" y1="'+bY+'" x2="'+ax+'" y2="'+(bY+BAND_H)+'" stroke="'+c.col+'" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.5"/>';
      s+='<text x="'+ax+'" y="'+(bY+10)+'" text-anchor="middle" fill="'+c.col+'" font-size="9" opacity="0.7">'+avg.toFixed(1)+'%</text>';
    }}
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
  const inclComposites=document.getElementById('incl-composites').checked;
  const minN=Math.max(1,parseInt(document.getElementById('min-entries').value)||1);
  const map={{}};
  for(const r of ROWS)for(const l of r.lanes){{
    if(l.pct===null||(!inclComposites&&l.club.includes('/')))continue;
    const cn=normClub(l.club);if(!cn)continue;
    if(!map[cn])map[cn]={{pcts:[],events:new Set()}};
    map[cn].pcts.push(l.pct);map[cn].events.add(r.event);
  }}
  return Object.entries(map).map(([name,c])=>{{
    const sorted=c.pcts.slice().sort((a,b)=>b-a);
    const avg=c.pcts.reduce((a,b)=>a+b,0)/c.pcts.length;
    const top3avg=sorted.slice(0,3).reduce((a,b)=>a+b,0)/Math.min(3,sorted.length);
    return{{name,count:c.pcts.length,events:c.events.size,avg,top3avg,best:sorted[0]}};
  }}).filter(c=>c.count>=minN).sort((a,b)=>b.top3avg-a.top3avg);
}}
function renderClubLB(){{
  const ranked=buildClubMap();
  let h='';
  ranked.forEach((c,i)=>{{
    const f=fg(c.avg);const ft=fg(c.top3avg);
    h+='<tr>'
      +'<td class="num" style="color:#555">'+(i+1)+'</td>'
      +'<td><strong>'+c.name+'</strong></td>'
      +'<td class="num" style="color:#888">'+c.count+'</td>'
      +'<td class="num" style="color:#888">'+c.events+'</td>'
      +'<td class="num"><strong style="color:'+ft+'">'+c.top3avg.toFixed(1)+'%</strong></td>'
      +'<td class="num" style="color:#aaa">'+c.avg.toFixed(1)+'%</td>'
      +'<td class="num" style="color:#ccc">'+c.best.toFixed(1)+'%</td>'
      +'</tr>';
  }});
  document.getElementById('clublb-body').innerHTML=h||'<tr><td colspan="7" style="color:#555;text-align:center;padding:20px">No data.</td></tr>';
}}
function dlCSV(rows,fn){{
  const blob=new Blob([rows.map(r=>r.map(c=>(typeof c==='string'&&(c.includes(',')||c.includes('"')))?'"'+c.replace(/"/g,'""')+'"':c).join(',')).join('\\n')],{{type:'text/csv'}});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=fn;a.click();
}}
function downloadTop100CSV(){{
  const clubQ=(document.getElementById('lb-club-filter').value||'').toLowerCase().trim();
  const entries=[];
  for(const r of ROWS)for(const l of r.lanes)
    if(l.pct!==null)entries.push({{crew:l.crew,club:l.club,event:r.event,round:r.round,time:l.time,pct:l.pct}});
  entries.sort((a,b)=>b.pct-a.pct);
  const filtered=clubQ?entries.filter(e=>normClub(e.club).toLowerCase()===clubQ):entries;
  dlCSV([['Crew','Club','Event','Round','Time','GMT%'],...filtered.slice(0,250).map(e=>[e.crew,e.club,e.event,e.round,e.time,e.pct.toFixed(1)])],'heatmap-{comp}-top250.csv');
}}
function downloadClubLBCSV(){{
  const ranked=buildClubMap();
  dlCSV([['#','Club','Entries','Events','Top 3 Avg %','Avg GMT%','Best %'],
    ...ranked.map((c,i)=>[i+1,c.name,c.count,c.events,c.top3avg.toFixed(1),c.avg.toFixed(1),c.best.toFixed(1)])],'heatmap-{comp}-clubs.csv');
}}
function downloadCompare(){{
  const svg=document.querySelector('#cmp-chart svg');
  if(!svg){{alert('Nothing to download - add clubs and data first.');return;}}
  const vb=svg.getAttribute('viewBox').split(' ').map(Number);
  const W=vb[2]||720,H=vb[3]||400;
  const PL=20,HEADER=54,PB=44;
  const TW=W+PL*2,TH=H+HEADER+PB;
  const full='<svg xmlns="http://www.w3.org/2000/svg" width="'+TW+'" height="'+TH+'">'
    +'<rect width="'+TW+'" height="'+TH+'" fill="#111"/>'
    +'<text x="'+PL+'" y="28" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="700" fill="#e8e8e6">{title}</text>'
    +'<text x="'+PL+'" y="46" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="11" fill="#c8472b" font-weight="600">rowingtools.co.uk</text>'
    +'<g transform="translate('+PL+','+HEADER+')">'
    +svg.innerHTML
    +'</g>'
    +'</svg>';
  const blob=new Blob([full],{{type:'image/svg+xml'}});
  const url=URL.createObjectURL(blob);
  const img=new Image();
  img.onload=()=>{{
    const c=document.createElement('canvas');
    c.width=TW*2;c.height=TH*2;
    const ctx=c.getContext('2d');ctx.scale(2,2);ctx.drawImage(img,0,0);
    c.toBlob(b=>{{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='heatmap-{comp}-compare.png';a.click();}},'image/png');
    URL.revokeObjectURL(url);
  }};
  img.src=url;
}}
renderClubInputs();
renderHeatmap(ROWS,'');
</script>
</body>
</html>"""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate a GMT%% heatmap HTML from Nottingham City Regatta 2026 results."
    )
    parser.add_argument("--comp",  default="nottm26",                    help="Competition code for CSV filenames")
    parser.add_argument("--title", default="Nottingham City Regatta 2026", help="Page title")
    parser.add_argument("--out",   default=None,                         help="Output HTML path (default: ../../heatmap-<comp>.html)")
    args = parser.parse_args()

    wbt  = load_wbt()
    rows = build_races(wbt)
    html = generate_html(rows, args.comp, args.title)

    out_name = args.out or f"../../heatmap-{args.comp}.html"
    out = (Path(__file__).parent / out_name).resolve()
    out.write_text(html, encoding="utf-8")
    print(f"\nWritten: {out}  ({len(rows)} races)")
