#!/usr/bin/env python3
"""
generate_heatmap_reading26.py
Generate a GMT% heatmap HTML from Reading Amateur Regatta 2026 (Saturday) results.

Reading is a head-to-head (knockout) regatta over a ~1500m course. The results
site only publishes a time for the WINNER of each race - losing crews get no
time. So for each category we:

  1. Collect every crew that won at least one race, keyed by its entry number
     (entry numbers are stable across rounds).
  2. Keep that crew's fastest winning time across all its rounds.
  3. Convert the 1500m time to an equivalent 2000m time (x 2000/1500) and rate it
     as GMT% against the 2000m World Best Time.
  4. Sort the winning crews fastest -> slowest within each band.
  5. Mark the actual category winner (the crew that won the final). It is almost
     always the fastest, but occasionally not, so it carries a gold highlight.

All age groups except J14 and J15 are included (Senior, School/Junior, J18, J16),
each rated against the senior 2000m WBT, so junior GMT% sits lower.

Usage:
    python gmt_processor/inputs/generate_heatmap_reading26.py --out heatmap-reading26.html
"""

import argparse, json, re
from html import unescape
from urllib.parse import unquote
from collections import defaultdict
from pathlib import Path

WBT_PATH = Path(__file__).parent.parent.parent / "data" / "benchmarks_v3.json"
RESULTS_URL = "https://www.reading-amateur-regatta.org/RESULTS/regatta.php?id=26119&day=1"

# Course-distance conversion: Reading races over 1500m; benchmarks are 2000m.
DIST_FACTOR = 2000.0 / 1500.0
# Crews pace/fade differently over 2000m than 1500m, so a flat distance scaling
# slightly flatters them. Add ~2.5s per 500m over the 3 splits = 7.5s to the
# projected 2000m time before computing GMT%.
FADE_ADJUST = 7.5

# Display overrides for specific raw crew/club strings.
CLUB_RENAME = {
    "LEA/CUR/GLB": "Globe/ Lea",
}

# Boat-class display/sort order (smallest sort index first).
BOAT_ORDER = ["8+", "4x", "4x+", "4+", "4-", "2x", "2-", "1x"]

# Age-group ordering for the event tables: Senior, then School/Junior, J18, J16.
AGE_SENIOR, AGE_SCHOOL, AGE_J18, AGE_J16 = 0, 1, 2, 3

TIME_RE = re.compile(r'^\d+:\d{2}$')
ROW_RE = re.compile(r"<tr class='c'>(.*?)</tr>", re.S)
TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)


def load_wbt():
    bm = json.loads(WBT_PATH.read_text())
    wbt = {}
    for k, v in bm["wbt"].items():
        t = parse_wbt_time(v["time"])
        if t:
            wbt[k] = t
    return wbt


def parse_wbt_time(t):
    m = re.match(r'^(\d+):(\d{2})\.(\d+)$', str(t).strip())
    if not m:
        return None
    return int(m[1]) * 60 + int(m[2]) + float('0.' + m[3])


def parse_race_time(t):
    """Reading times are mm:ss whole seconds (e.g. '4:07'). Returns seconds or None."""
    if not TIME_RE.match(t):
        return None
    m, s = t.split(':')
    return int(m) * 60 + int(s)


def is_included(status):
    """Include every category except the youngest age groups (J14, J15)."""
    return bool(status) and not re.search(r'J1[45]', status)


def parse_category(status):
    """
    Split a Reading category into its parts. Categories look like
    '[Band.]<class...>.<boat>', where <class...> is one or more dot-separated
    tokens (gender and/or age), e.g.:
        'B1.Op.8+'      -> band B1, class ['Op'],          boat 8+
        'W.J16.4X'      -> band None, class ['W','J16'],   boat 4x
        'Op.Sch/Jun.4-' -> band None, class ['Op','Sch/Jun'], boat 4-
        'Sch.8+' / 'J16.8+' (no gender token) -> treated as Open (men's WBT).

    Returns (display, class_parts, women, boat, band, wbt_key) or None.
    """
    parts = status.split('.')
    band = None
    if re.fullmatch(r'B\d', parts[0]):
        band, parts = parts[0], parts[1:]
    if len(parts) < 2:
        return None
    boat = parts[-1].replace('X', 'x')
    class_parts = parts[:-1]
    women = class_parts[0] == 'W'
    wbt_key = ('W' if women else 'M') + boat
    display = ' '.join(class_parts + [boat])
    return display, class_parts, women, boat, band, wbt_key


def age_rank(class_parts):
    s = '.'.join(class_parts)
    if 'J16' in s:
        return AGE_J16
    if 'J18' in s:
        return AGE_J18
    if 'Sch' in s or 'Jun' in s:
        return AGE_SCHOOL
    return AGE_SENIOR


def event_sort_key(class_parts, women, boat):
    boat_rank = BOAT_ORDER.index(boat) if boat in BOAT_ORDER else len(BOAT_ORDER)
    return (age_rank(class_parts), 1 if women else 0, boat_rank)


def band_label(band):
    return f"Band {band[1]}" if band else "Open"


def band_sort(band):
    return int(band[1]) if band else 9


def parse_row(raw):
    rn = int(re.search(r"id='R(\d+)'>", raw).group(1))
    st = re.search(r"day=1&amp;s=([^']+)'", raw)
    status = unquote(st.group(1)) if st else None
    tds = TD_RE.findall(raw)
    return rn, status, tds


def winner_cell(tds):
    """The winning crew is the bold cell among the two competitor columns (td4/td5)."""
    for i in (4, 5):
        if i < len(tds) and '<b>' in tds[i]:
            return tds[i]
    return None


def crew_from_cell(cell):
    entry = re.search(r"e=(\d+)'", cell)
    text = unescape(re.sub(r'<[^>]+>', '', cell)).strip()
    text = re.sub(r'^\(\d+\)\s*', '', text)          # drop leading (entry no.)
    m = re.match(r'^(.*?)\s*(\([^)]*\))\s*$', text)  # split club from trailing (stroke)
    club, stroke = (m.group(1).strip(), m.group(2)) if m else (text.strip(), '')
    club = CLUB_RENAME.get(club, club)
    crew = f"{club} {stroke}".strip()
    return (entry.group(1) if entry else None), crew, club


def fetch_html(url):
    import requests
    sess = requests.Session()
    sess.headers.update({'User-Agent': 'Mozilla/5.0'})
    resp = sess.get(url, timeout=30)
    resp.raise_for_status()
    return resp.text


def build_rows(html, wbt):
    # Gather races per (banded) category.
    cats = defaultdict(list)  # status -> [(race_no, tds)]
    for raw in ROW_RE.findall(html):
        rn, status, tds = parse_row(raw)
        if is_included(status) and len(tds) >= 7:
            cats[status].append((rn, tds))

    # event display -> {'sort': key, 'boat': wbt_key, 'rows': [band-row dicts]}
    events = {}

    for status, races in cats.items():
        meta = parse_category(status)
        if meta is None:
            print(f"  skip unparseable category {status!r}")
            continue
        display, class_parts, women, boat, band, wbt_key = meta
        wbt_t = wbt.get(wbt_key)
        if wbt_t is None:
            print(f"  WARNING: no WBT for {wbt_key} ({status})")

        winners = {}        # entry -> {'crew','club','best_secs'}
        final_winner = None
        for rn, tds in races:
            cell = winner_cell(tds)
            if not cell:
                continue
            entry, crew, club = crew_from_cell(cell)
            secs = parse_race_time(re.sub(r'<[^>]+>', '', tds[6]).strip())
            is_final = not re.search(r'#R\d+', tds[3])  # final has no Next Race link
            if is_final:
                final_winner = entry
            w = winners.setdefault(entry, {'crew': crew, 'club': club, 'best': None})
            if secs is not None and (w['best'] is None or secs < w['best']):
                w['best'] = secs

        lanes = []
        for entry, w in winners.items():
            if w['best'] is None:
                continue
            t1500 = w['best']
            t2000 = t1500 * DIST_FACTOR + FADE_ADJUST
            pct = round(wbt_t / t2000 * 100, 1) if wbt_t else None
            lanes.append({
                "crew": w['crew'],
                "club": w['club'],
                "time": fmt_secs(t1500),
                "pct": pct,
                "win": entry == final_winner,
            })
        if not lanes:
            continue
        lanes.sort(key=lambda l: (l['pct'] is None, -(l['pct'] or 0)))

        ev = events.setdefault(display, {
            "sort": event_sort_key(class_parts, women, boat),
            "boat": wbt_key,
            "rows": [],
        })
        ev["rows"].append({"band": band, "round": band_label(band), "lanes": lanes})

    # Flatten, events ordered Senior -> School -> J18 -> J16, bands B1..B4 then Open.
    rows_out = []
    for display, ev in sorted(events.items(), key=lambda kv: kv[1]["sort"]):
        ev["rows"].sort(key=lambda r: band_sort(r['band']))
        for br in ev["rows"]:
            rows_out.append({
                "event": display,
                "round": br['round'],
                "lanes": br['lanes'],
                "boat": ev["boat"],
            })
            print(f"  {display} {br['round']}: {len(br['lanes'])} winning crews")
    return rows_out


def fmt_secs(s):
    return f"{s // 60}:{s % 60:02d}"


def generate_html(rows, comp, title):
    data_json = json.dumps(rows)
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
.sub{{color:#666;font-size:12px;margin-bottom:18px;max-width:760px;line-height:1.5}}
input{{background:#1e1e1e;border:1px solid #333;color:#e8e8e6;padding:5px 10px;border-radius:6px;font-size:12px;margin-bottom:18px;width:220px}}
table{{border-collapse:collapse;font-size:11px;margin-bottom:28px}}
caption{{text-align:left;font-size:12px;font-weight:600;color:#aaa;padding:0 0 6px;letter-spacing:.03em;text-transform:uppercase}}
th{{background:#1a1a1a;color:#555;font-weight:500;padding:4px 8px;border:1px solid #222;text-align:center;white-space:nowrap}}
th.rh{{text-align:left;width:80px}}
td{{border:1px solid #1e1e1e;padding:0;vertical-align:top;min-width:80px;max-width:120px}}
td.rnd{{background:#161616;color:#777;font-size:11px;padding:5px 7px;white-space:nowrap;vertical-align:middle}}
.cell{{padding:5px 6px;display:flex;flex-direction:column;align-items:center;gap:1px;position:relative}}
.cn{{font-weight:600;font-size:10px;color:rgba(255,255,255,.85);white-space:normal;text-align:center;max-width:110px;word-break:break-word;line-height:1.3}}
.cp{{font-size:12px;font-weight:700}}
.ct{{font-size:10px;color:rgba(255,255,255,.4)}}
.win{{position:absolute;top:2px;right:3px;font-size:10px;line-height:1}}
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
<p class="sub">GMT% vs 2000m WBT. Reading is a head-to-head knockout regatta over ~1500m, and only race winners are timed - so each band lists the crews that won at least one race (fastest of their rounds), sorted fastest to slowest. 1500m times are scaled to 2000m, with an adjustment made in the GMT calc to allow for the fact the race is over 1.5k (approx 7.5 seconds added to the time when calculating GMT, since crews fade more over the longer 2k). <span style="color:#f5c518">&#x1F3C6;</span> marks the crew that actually won the band final (usually, but not always, the fastest). Senior, School/Junior, J18 and J16 events are all rated against the senior 2000m WBT, so junior GMT% naturally sits lower. J14 and J15 events are excluded. Results via reading-amateur-regatta.org.</p>
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
      <th class="num">#</th><th>Crew</th><th>Club</th><th>Event</th><th>Band</th>
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
    const maxP=Math.max(...races.map(r=>r.lanes.length));
    let th='<th class="rh">Band</th>';
    for(let i=1;i<=maxP;i++)th+=`<th>${{i}}</th>`;
    let tb='';
    for(const r of races){{
      let cells=`<td class="rnd">${{r.round}}</td>`;
      for(let i=0;i<maxP;i++){{
        const l=r.lanes[i];
        if(!l){{cells+='<td></td>';continue;}}
        const b=bg(l.pct),f=fg(l.pct),p=l.pct!==null?l.pct.toFixed(1)+'%':'&#x2014;';
        const dim=clubQ&&normClub(l.club).toLowerCase()!==clubQ?'opacity:0.12;':'';
        const wb=l.win?'box-shadow:inset 0 0 0 2px #f5c518;':'';
        const wm=l.win?'<span class="win">&#x1F3C6;</span>':'';
        cells+=`<td style="background:${{b}};${{wb}}${{dim}}"><div class="cell">${{wm}}<span class="cn">${{l.crew}}</span><span class="cp" style="color:${{f}}">${{p}}</span><span class="ct">${{l.time}}</span></div></td>`;
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
  dlCSV([['Crew','Club','Event','Band','Time','GMT%'],...filtered.slice(0,250).map(e=>[e.crew,e.club,e.event,e.round,e.time,e.pct.toFixed(1)])],'heatmap-{comp}-top250.csv');
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
</body>
</html>"""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate GMT% heatmap HTML from Reading 2026 Saturday results.")
    parser.add_argument("--comp",  default="reading26", help="Competition code for CSV filenames")
    parser.add_argument("--title", default="Reading Amateur Regatta 2026 (Saturday)", help="Page title")
    parser.add_argument("--url",   default=RESULTS_URL, help="Results URL")
    parser.add_argument("--html",  default=None, help="Local HTML file to parse instead of fetching")
    parser.add_argument("--out",   default=None, help="Output HTML file path")
    args = parser.parse_args()

    html = Path(args.html).read_text(encoding="utf-8") if args.html else fetch_html(args.url)
    wbt = load_wbt()
    rows = build_rows(html, wbt)
    out_html = generate_html(rows, args.comp, args.title)

    out = args.out or str((Path(__file__).parent / f"../../heatmap-{args.comp}.html").resolve())
    Path(out).write_text(out_html, encoding="utf-8")
    print(f"\nWritten: {out}  ({len(rows)} band rows)")
