#!/usr/bin/env python3
"""
generate_heatmap_wallingford.py
Generate a GMT% heatmap HTML by scraping a wallingford-regatta.org.uk results page.

Event naming on the Wallingford site:
  H2: "Challenge Eights (Challenge 8+) for the Theodosius Challenge Cup"
  H3: "Heat A" / "Final"
  Table: Pos | Lane | Crew | [splits] | Time | Verdict

Includes: Challenge, Club, Women's, Junior/School, J18/U18 events.
Excludes: U16, U15, J16, J15 (and any U14 and below).

Usage:
    python generate_heatmap_wallingford.py --url https://wallingford-regatta.org.uk/2025-results/ --comp wallingford25 --title "Wallingford Regatta 2025"
    python generate_heatmap_wallingford.py --url https://wallingford-regatta.org.uk/2025-results/ --comp wallingford25 --title "Wallingford Regatta 2025" --out ../../heatmap-wallingford25.html
"""

import argparse, json, re
from pathlib import Path

WBT_PATH = Path(__file__).parent.parent.parent / "data" / "benchmarks_v3.json"

# Exclude U16 and younger (U15, U14 ... U10; J10 ... J16)
EXCLUDE_RE = re.compile(r'\bU1[0-6]\b|\bJ1[0-6]\b', re.I)

TIME_RE = re.compile(r'^\d+:\d{2}\.\d+$')


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


def event_name_to_boat(h2_text):
    """Map Wallingford H2 event heading to WBT boat class key, or None if excluded."""
    if EXCLUDE_RE.search(h2_text):
        return None
    t = h2_text.lower()
    gender = 'W' if t.startswith("women") else 'M'
    is_lwt = 'lightweight' in t
    prefix = ('LW' if gender == 'W' else 'LM') if is_lwt else gender

    if 'eight' in t:           return prefix + '8+'
    if 'quadruple scull' in t: return prefix + '4x'
    if 'coxed four' in t:      return prefix + '4+'
    if 'coxless four' in t:    return prefix + '4-'
    if 'coxless pair' in t:    return prefix + '2-'
    if 'double scull' in t:    return prefix + '2x'
    if 'single scull' in t:    return prefix + '1x'
    return None


def event_display_name(h2_text):
    """Extract short display name using the parenthetical code in the H2."""
    m = re.search(r'\(([^)]+)\)\s*(?:for\b.*)?$', h2_text.strip(), re.I)
    if m:
        return m.group(1).strip()
    return re.sub(r'\s+for the .+$', '', h2_text.strip(), flags=re.I)


def parse_crew(raw):
    """Extract (club, crew_display) from 'Club Name - A (ID)' Wallingford format."""
    raw = raw.strip()
    # Strip trailing (NNN) entry number to get crew display name
    m = re.match(r'^(.+?)\s*\(\d+\)$', raw)
    crew = m.group(1).strip() if m else raw
    # Strip entry-letter suffix: "- A", "– B", "- C Stroke Name", "- L/E" etc.
    # Dash variants: hyphen, en-dash, em-dash, and � (replacement char from bad encoding)
    # Stroke name may follow the entry letter, so match to end-of-string greedily
    SUFFIX_RE = r'\s*[\-–—�]\s*(?:[A-Z](?:/E)?|L/E)(?:\s+\S.*?)?\s*$'
    club = re.sub(SUFFIX_RE, '', crew, flags=re.I).strip()
    # Handle double suffix e.g. "- A - L/E"
    club = re.sub(SUFFIX_RE, '', club, flags=re.I).strip()
    return club, crew


def parse_results_table(table_tag):
    """Parse a class='results' table, return list of {pos, crew, time} for valid finishers."""
    trs = table_tag.find_all('tr')
    if not trs:
        return []

    # Find header row (uses <th> or first <td> row with 'pos'/'lane')
    time_col = None
    crew_col = 2
    data_start = 0

    for i, tr in enumerate(trs):
        # Try <th> first, then <td>
        headers = tr.find_all('th') or tr.find_all('td')
        if not headers:
            continue
        lower = [h.get_text(strip=True).lower() for h in headers]
        if 'pos' in lower or 'lane' in lower:
            try:
                time_col = next(j for j, h in enumerate(lower) if h == 'time')
            except StopIteration:
                time_col = len(lower) - 2
            try:
                crew_col = next(j for j, h in enumerate(lower) if h == 'crew')
            except StopIteration:
                crew_col = 2
            data_start = i + 1
            break

    rows = []
    for tr in trs[data_start:]:
        cells = [td.get_text(strip=True) for td in tr.find_all('td')]
        if not cells:
            continue

        # Skip SCRATCHED / DNF / DSQ rows
        verdict = cells[-1].upper()
        if any(v in verdict for v in ('SCRATCH', 'DNF', 'DSQ', 'NRO', 'EXCL')):
            continue

        try:
            pos = int(cells[0])
        except (ValueError, IndexError):
            continue

        try:
            crew_raw = cells[crew_col]
        except IndexError:
            continue

        # Time: use header-mapped column; fall back to last valid mm:ss.xx from right
        time_str = None
        if time_col is not None and time_col < len(cells):
            candidate = cells[time_col].strip()
            if TIME_RE.match(candidate):
                time_str = candidate
        if not time_str:
            for cell in reversed(cells):
                if TIME_RE.match(cell.strip()):
                    time_str = cell.strip()
                    break

        rows.append({'pos': pos, 'crew': crew_raw, 'time': time_str or ''})

    return rows


def scrape_finals(url):
    """Fetch the results URL and return list of (event_name, rows) for Final sections only.

    Page structure: <h1> event name, then alternating <table class='race'> (round header)
    and <table class='results'> (data). A race table containing 'Final' signals we want
    the immediately following results table.
    """
    try:
        import requests
        from bs4 import BeautifulSoup
    except ImportError:
        raise ImportError("Install dependencies: pip install requests beautifulsoup4")

    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'html.parser')

    results = []
    current_event = None
    next_is_final = False

    for tag in soup.find_all(['h1', 'table']):
        if tag.name == 'h1':
            text = tag.get_text(' ', strip=True)
            text = re.sub(r'\s+for the .+$', '', text, flags=re.I).strip()
            # Skip the page title "2025 Results"
            if 'results' not in text.lower() or re.search(r'\(', text):
                current_event = text
            next_is_final = False

        elif tag.name == 'table':
            classes = tag.get('class') or []
            if 'race' in classes:
                round_text = tag.get_text(strip=True).lower()
                next_is_final = 'final' in round_text
            elif 'results' in classes and next_is_final and current_event:
                rows = parse_results_table(tag)
                if rows:
                    results.append((current_event, rows))
                next_is_final = False

    return results


def build_races(url, wbt):
    finals = scrape_finals(url)
    rows = []

    for h2_text, entries in finals:
        boat = event_name_to_boat(h2_text)
        if boat is None:
            continue
        wbt_t = wbt.get(boat)
        disp = event_display_name(h2_text)

        lanes = []
        for e in sorted(entries, key=lambda x: x['pos']):
            t = parse_time(e['time'])
            pct = round(wbt_t / t * 100, 1) if (wbt_t and t) else None
            club, crew = parse_crew(e['crew'])
            lanes.append({
                "crew": crew,
                "club": club,
                "time": fmt_time(t) if t else e['time'].strip(),
                "pct":  pct,
            })

        if lanes:
            rows.append({
                "event": disp,
                "round": "Final",
                "lanes": lanes,
                "boat":  boat,
            })

    rows.sort(key=lambda r: (0 if r["event"].startswith("W ") else 1, r["event"]))
    return rows


def generate_html(rows, comp, title):
    data_json = json.dumps(rows)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=0.55">
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
<p class="sub">GMT% vs WBT. Challenge, Club and Schools categories. U16/U15 excluded. Heats excluded.</p>
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
for(const r of ROWS)for(const l of r.lanes)if(l.pct!==null&&l.pct<50)l.pct=null;
function normClub(n){{return(n||'').replace(/\\s*\\([^)]+\\)\\s*$/,'').trim();}}
function bg(p){{return p===null?'#2a2a2a':p>=87?'#1a4d3e':p>=80?'#1a3a5c':p>=72?'#4a3200':'#4a1a0a'}}
function fg(p){{return p===null?'#555':p>=87?'#4ee8b0':p>=80?'#7bbfff':p>=72?'#f0b030':'#ff7050'}}
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
        const dim=clubQ&&l.club.toLowerCase()!==clubQ?'opacity:0.12;':'';
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
  const clubQ=(document.getElementById('lb-club-filter').value||'').toLowerCase().trim();
  const entries=[];
  for(const r of ROWS)for(const l of r.lanes)
    if(l.pct!==null)entries.push({{crew:l.crew,club:l.club,event:r.event,round:r.round,time:l.time,pct:l.pct}});
  entries.sort((a,b)=>b.pct-a.pct);
  entries.forEach((e,i)=>e.rank=i+1);
  const filtered=clubQ?entries.filter(e=>e.club.toLowerCase()===clubQ):entries;
  let h='';
  filtered.slice(0,250).forEach((e)=>{{
    const f=fg(e.pct);
    h+=`<tr><td class="num" style="color:#555">${{e.rank}}</td><td><strong>${{e.crew}}</strong></td><td style="color:#888">${{e.club}}</td><td style="color:#aaa">${{e.event}}</td><td style="color:#666">${{e.round}}</td><td class="num" style="color:#888">${{e.time}}</td><td class="num"><strong style="color:${{f}}">${{e.pct.toFixed(1)}}%</strong></td></tr>`;
  }});
  document.getElementById('lb-body').innerHTML=h||'<tr><td colspan="7" style="color:#555;text-align:center;padding:20px">No results.</td></tr>';
}}
const ALL_CLUBS=[...new Set(ROWS.flatMap(r=>r.lanes.map(l=>l.club).filter(c=>c&&!c.includes('/'))))].sort((a,b)=>a.localeCompare(b));
document.getElementById('cmp-clubs-list').innerHTML=ALL_CLUBS.map(c=>'<option value="'+c.replace(/"/g,'&quot;')+'">').join('');
let cmpClubs=['',''];
const CMP_COLS=['#7bbfff','#f0b030','#4ee8b0','#ff7050','#c084fc','#fb923c'];
function renderClubInputs(){{
  let h='';
  cmpClubs.forEach((q,i)=>{{
    const col=CMP_COLS[i%CMP_COLS.length];
    const rm=cmpClubs.length>1?'<button onclick="removeCmpClub('+i+')" style="background:none;border:1px solid #2a2a2a;color:#555;cursor:pointer;font-size:13px;padding:1px 6px;border-radius:4px">&#x2715;</button>':'';
    h+='<div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:50%;background:'+col+';flex-shrink:0"></div><input type="text" list="cmp-clubs-list" value="'+q.replace(/"/g,'&quot;')+'" placeholder="Club name&#8230;" oninput="updateCmpClub('+i+',this.value)" style="margin-bottom:0;width:200px">'+rm+'</div>';
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
      const tip=e.crew+' ('+e.club+')&#10;'+e.event+'&#10;'+e.time+' ('+e.pct.toFixed(1)+'%)';
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
    const cn=l.club;if(!cn)continue;
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
  const clubQ=(document.getElementById('lb-club-filter').value||'').toLowerCase().trim();
  const entries=[];
  for(const r of ROWS)for(const l of r.lanes)if(l.pct!==null)entries.push({{crew:l.crew,club:l.club,event:r.event,round:r.round,time:l.time,pct:l.pct}});
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
  const full='<svg xmlns="http://www.w3.org/2000/svg" width="'+TW+'" height="'+TH+'"><rect width="'+TW+'" height="'+TH+'" fill="#111"/><text x="'+PL+'" y="28" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="700" fill="#e8e8e6">{title}</text><text x="'+PL+'" y="46" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="11" fill="#c8472b" font-weight="600">rowingtools.co.uk</text><g transform="translate('+PL+','+HEADER+')">'+svg.innerHTML+'</g></svg>';
  const blob=new Blob([full],{{type:'image/svg+xml'}});
  const url=URL.createObjectURL(blob);
  const img=new Image();
  img.onload=()=>{{const c=document.createElement('canvas');c.width=TW*2;c.height=TH*2;const ctx=c.getContext('2d');ctx.scale(2,2);ctx.drawImage(img,0,0);c.toBlob(b=>{{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='heatmap-{comp}-compare.png';a.click();}},'image/png');URL.revokeObjectURL(url);}};
  img.src=url;
}}
renderClubInputs();
renderHeatmap(ROWS,'');
</script>
</body>
</html>"""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate GMT% heatmap HTML from a Wallingford Regatta results page.")
    parser.add_argument("--url",   required=True,                    help="Results page URL")
    parser.add_argument("--comp",  default="wallingford25",          help="Competition code for CSV filenames")
    parser.add_argument("--title", default="Wallingford Regatta 2025", help="Page title")
    parser.add_argument("--out",   default=None,                     help="Output HTML file path")
    args = parser.parse_args()

    wbt  = load_wbt()
    rows = build_races(args.url, wbt)
    html = generate_html(rows, args.comp, args.title)

    out = args.out or str((Path(__file__).parent / f"../../heatmap-{args.comp}.html").resolve())
    Path(out).write_text(html, encoding="utf-8")
    print(f"Written: {out}  ({len(rows)} events)")
