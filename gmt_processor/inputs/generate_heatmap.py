"""
generate_heatmap.py
Fetch results from rowresults.co.uk and generate a self-contained heatmap HTML.

Usage:
    python generate_heatmap.py --comp metsat25
    python generate_heatmap.py --comp metsun25 --out ../../heatmap-metsun25.html
"""
import argparse, json, re, sys, time
from pathlib import Path
try:
    import requests
except ImportError:
    print("pip install requests"); sys.exit(1)

BASE    = "https://rowresults.co.uk"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": BASE}

# ── DATA FETCH ────────────────────────────────────────────────────────────────

def fetch_races(comp):
    ts = int(time.time() * 1000)
    r  = requests.get(f"{BASE}/raceinfo.php?c={comp}&_={ts}", headers=HEADERS, timeout=15)
    return r.json()["data"]

def fetch_lanes(comp, race_num):
    url = f"{BASE}/results/{comp}/Race{race_num}.json"
    r   = requests.get(url, headers={**HEADERS, "Referer": f"{BASE}/{comp}"}, timeout=15)
    return r.json() if r.status_code == 200 else None

def clean_round(r):
    return re.sub(r'&nbsp;.*', '', r).strip()

# ── BOAT CLASS ────────────────────────────────────────────────────────────────

def to_boat_class(ev):
    n = ev.strip()
    if re.search(r'\bJ\d{2}\b|\bU23\b', n, re.I): return None
    is_w   = bool(re.match(r'W\b', n))
    is_lwt = bool(re.search(r'\bLwt\b', n, re.I))
    pfx    = ("L" if is_lwt else "") + ("W" if is_w else "M")
    for pat, sfx in [("8+","8+"),("4-","4-"),("4x","4x"),("4+","4+"),("2-","2-"),("2x","2x"),("2+","2+"),("1x","1x")]:
        if re.search(re.escape(pat), n): return pfx + sfx
    return None

# ── TIME ──────────────────────────────────────────────────────────────────────

def parse_t(t):
    if not t: return None
    m = re.match(r'^(\d+):(\d{2}\.\d+)$', str(t).strip())
    return float(m[1]) * 60 + float(m[2]) if m else None

def fmt_t(s):
    m = int(s // 60); r = s - m * 60
    return f"{m}:{r:05.2f}"

# ── MAIN ──────────────────────────────────────────────────────────────────────

def build_data(comp, bm_path):
    # Load WBT
    wbt = {}
    try:
        bm = json.loads(Path(bm_path).read_text())
        for k, v in bm["wbt"].items():
            t = parse_t(v["time"])
            if t: wbt[k] = t
        print(f"Loaded {len(wbt)} WBT entries")
    except Exception as e:
        print(f"Warning: could not load benchmarks: {e}")

    print(f"Fetching race list for {comp}…")
    all_races = fetch_races(comp)
    finals    = [r for r in all_races if re.match(r'Final\s+[A-Z]', clean_round(r.get("Round", "")))]
    print(f"{len(finals)} finals found")

    rows = []
    for i, race in enumerate(finals):
        ev    = race.get("Event") or race.get("RaceName") or ""
        round_ = clean_round(race.get("Round", ""))
        num   = race["Race"]
        print(f"  [{i+1}/{len(finals)}] Race {num}: {ev} {round_}", end=" ", flush=True)

        data = fetch_lanes(comp, num)
        time.sleep(0.1)

        if not data or "lanes" not in data:
            print("— no data")
            continue

        boat  = to_boat_class(ev)
        wbt_t = wbt.get(boat) if boat else None

        def safe_posn(l):
            try: return int(l.get("Posn") or 0)
            except (ValueError, TypeError): return 0
        lanes = sorted([l for l in data["lanes"] if safe_posn(l) > 0], key=safe_posn)
        finishers = []
        for l in lanes:
            t   = parse_t(l.get("Finish"))
            pct = round(wbt_t / t * 100, 1) if (wbt_t and t) else None
            finishers.append({
                "crew": l.get("CrewCode", "?"),
                "club": (l.get("ClubName") or "").strip(),
                "time": fmt_t(t) if t else "",
                "pct":  pct,
            })

        ev_clean = re.sub(r'\s*(Championship|Academic|Club|Sch/Jun)\s*$', '', ev, flags=re.I).strip()
        rows.append({"event": ev_clean, "round": round_, "lanes": finishers, "boat": boat or ""})
        print(f"— {len(finishers)} finishers" + ("" if wbt_t else " (no WBT)"))

    # Sort: men before women, then by event name, then final type A→B→C
    def sort_key(r):
        w = 1 if r["event"].startswith("W ") else 0
        ft = ord(re.search(r'Final ([A-Z])', r["round"]).group(1)) if re.search(r'Final ([A-Z])', r["round"]) else 999
        return (w, r["event"], ft)
    rows.sort(key=sort_key)
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
<p class="sub">GMT% vs WBT. Time trials excluded.</p>
<div class="tabs">
  <button class="tab active" onclick="showTab('heatmap',this)">Heatmap</button>
  <button class="tab" onclick="showTab('top100',this)">Top 250 Results</button>
  <button class="tab" onclick="showTab('clublb',this)">Club Leaderboard</button>
  <button class="tab" onclick="showTab('compare',this)">Club Compare</button>
</div>
<div id="view-heatmap">
  <div class="legend">
    <div class="li"><div class="ls" style="background:#1a4d3e"></div>≥87% elite</div>
    <div class="li"><div class="ls" style="background:#1a3a5c"></div>80–87% high club</div>
    <div class="li"><div class="ls" style="background:#4a3200"></div>72–80% competitive</div>
    <div class="li"><div class="ls" style="background:#4a1a0a"></div>&lt;72% developing</div>
    <div class="li"><div class="ls" style="background:#2a2a2a"></div>no WBT data</div>
  </div>
  <input type="text" id="ev-filter" placeholder="Filter events…" oninput="filterHeatmap(this.value)" style="margin-right:8px">
  <input type="text" id="club-filter-hm" placeholder="Filter by club…" oninput="filterClubHm(this.value)">
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
    <input type="text" id="lb-club-filter" placeholder="Filter by club…" oninput="renderTop100()" style="margin-bottom:0">
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
  <button onclick="downloadClubLBCSV()" style="background:#1e1e1e;border:1px solid #333;color:#888;padding:5px 12px;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;margin-bottom:10px">&#x2193; CSV</button>
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
function normClub(n){{return(n||'').replace(/\s*\([A-Za-z]\)\s*$/,'').trim();}}
function bg(p){{return p===null?'#2a2a2a':p>=87?'#1a4d3e':p>=80?'#1a3a5c':p>=72?'#4a3200':'#4a1a0a'}}
function fg(p){{return p===null?'#555':p>=87?'#4ee8b0':p>=80?'#7bbfff':p>=72?'#f0b030':'#ff7050'}}

function showTab(name, btn){{
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('view-heatmap').style.display  = name==='heatmap' ?'':'none';
  document.getElementById('view-top100').style.display   = name==='top100'  ?'':'none';
  document.getElementById('view-compare').style.display  = name==='compare' ?'':'none';
  document.getElementById('view-clublb').style.display   = name==='clublb'  ?'':'none';
  if(name==='heatmap') renderHeatmap(ROWS, document.getElementById('club-filter-hm').value);
  if(name==='top100')  renderTop100();
  if(name==='clublb')  renderClubLB();
}}

function renderHeatmap(rows, clubQ){{
  clubQ=(clubQ||'').toLowerCase().trim();
  const groups=new Map();
  for(const r of rows){{
    if(!groups.has(r.event))groups.set(r.event,[]);
    groups.get(r.event).push(r);
  }}
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
        const b=bg(l.pct),f=fg(l.pct),p=l.pct!==null?l.pct.toFixed(1)+'%':'—';
        const dim=clubQ&&!normClub(l.club).toLowerCase().includes(clubQ)?'opacity:0.12;':'';
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
  renderHeatmap(rows, document.getElementById('club-filter-hm').value);
}}

function filterClubHm(q){{
  const evQ=(document.getElementById('ev-filter').value||'').toLowerCase().trim();
  const rows=evQ?ROWS.filter(r=>r.event.toLowerCase().includes(evQ)||r.boat.toLowerCase().includes(evQ)):ROWS;
  renderHeatmap(rows, q);
}}

function renderTop100(){{
  const clubQ=(document.getElementById('lb-club-filter').value||'').toLowerCase().trim();
  const entries=[];
  for(const r of ROWS){{
    for(const l of r.lanes){{
      if(l.pct!==null) entries.push({{crew:l.crew,club:l.club,event:r.event,round:r.round,time:l.time,pct:l.pct}});
    }}
  }}
  entries.sort((a,b)=>b.pct-a.pct);
  const filtered=clubQ?entries.filter(e=>normClub(e.club).toLowerCase().includes(clubQ)):entries;
  const top=filtered.slice(0,250);
  let h='';
  top.forEach((e,i)=>{{
    const f=fg(e.pct);
    h+=`<tr>
      <td class="num" style="color:#555">${{i+1}}</td>
      <td><strong>${{e.crew}}</strong></td>
      <td style="color:#888">${{e.club}}</td>
      <td style="color:#aaa">${{e.event}}</td>
      <td style="color:#666">${{e.round}}</td>
      <td class="num" style="color:#888">${{e.time}}</td>
      <td class="num"><strong style="color:${{f}}">${{e.pct.toFixed(1)}}%</strong></td>
    </tr>`;
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
    h+='<div style="display:flex;align-items:center;gap:6px">'
      +'<div style="width:8px;height:8px;border-radius:50%;background:'+col+';flex-shrink:0"></div>'
      +'<input type="text" list="cmp-clubs-list" value="'+q.replace(/"/g,'&quot;')+'" placeholder="Club name…" oninput="updateCmpClub('+i+',this.value)" style="margin-bottom:0;width:200px">'
      +rm+'</div>';
  }});
  document.getElementById('cmp-inputs').innerHTML=h;
}}
function addCmpClub(){{
  if(cmpClubs.length>=6)return;
  cmpClubs.push('');
  renderClubInputs();
}}
function removeCmpClub(i){{
  cmpClubs.splice(i,1);
  renderClubInputs();
  renderCompare();
}}
function updateCmpClub(i,v){{
  cmpClubs[i]=v;
  renderCompare();
}}

function renderCompare(){{
  const active=cmpClubs.map((q,i)=>{{return{{q:q.trim(),col:CMP_COLS[i%CMP_COLS.length]}}}}).filter(c=>c.q);
  if(!active.length){{
    document.getElementById('cmp-stats').innerHTML='';
    document.getElementById('cmp-chart').innerHTML='<p style="color:#555;margin-top:8px">Enter one or more club names above.</p>';
    return;
  }}
  const all=[];
  for(const r of ROWS) for(const l of r.lanes)
    if(l.pct!==null) all.push({{crew:l.crew,club:l.club,event:r.event,round:r.round,time:l.time,pct:l.pct}});
  const clubs=active.map(c=>{{
    return{{...c,entries:all.filter(e=>!e.club.includes('/')&&normClub(e.club).toLowerCase()===c.q.toLowerCase())}};
  }});
  function mkStat(c){{
    if(!c.entries.length) return '<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;min-width:160px"><div style="color:'+c.col+';font-weight:700;font-size:13px">'+c.q+'</div><div style="color:#555;font-size:11px;margin-top:6px">No results found</div></div>';
    const pcts=c.entries.map(e=>e.pct);
    const avg=pcts.reduce((a,b)=>a+b,0)/pcts.length;
    const best=Math.max(...pcts);
    const top10=pcts.slice().sort((a,b)=>b-a).slice(0,10).reduce((a,b)=>a+b,0)/Math.min(10,pcts.length);
    const evts=new Set(c.entries.map(e=>e.event)).size;
    return '<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;min-width:170px">'
      +'<div style="color:'+c.col+';font-weight:700;font-size:13px;margin-bottom:8px">'+c.q+'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;font-size:11px">'
      +'<span style="color:#666">Entries</span><span style="color:#ccc">'+c.entries.length+'</span>'
      +'<span style="color:#666">Events</span><span style="color:#ccc">'+evts+'</span>'
      +'<span style="color:#666">Avg GMT%</span><span style="color:'+c.col+';font-weight:600">'+avg.toFixed(1)+'%</span>'
      +'<span style="color:#666">Top 10 avg</span><span style="color:'+c.col+';font-weight:600">'+top10.toFixed(1)+'%</span>'
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
    if(bi%2===0) s+='<rect x="'+PL+'" y="'+bY+'" width="'+cW+'" height="'+BAND_H+'" fill="#161616"/>';
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
      const tip=e.crew+' – '+e.club+'&#10;'+e.event+' '+e.round+'&#10;'+e.time+' ('+e.pct.toFixed(1)+'%)';
      s+='<circle cx="'+xOf(e.pct).toFixed(1)+'" cy="'+jy+'" r="4" fill="'+c.col+'" fill-opacity="0.75" stroke="#111" stroke-width="0.5"><title>'+tip+'</title></circle>';
    }});
  }});
  document.getElementById('cmp-chart').innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;max-width:'+W+'px;height:'+H+'px;display:block;overflow:visible">'+s+'</svg>';
}}

function buildClubMap(){{
  const map={{}};
  for(const r of ROWS) for(const l of r.lanes){{
    if(l.pct===null||l.club.includes('/')) continue;
    const cn=normClub(l.club);
    if(!cn) continue;
    if(!map[cn]) map[cn]={{pcts:[],events:new Set()}};
    map[cn].pcts.push(l.pct);
    map[cn].events.add(r.event);
  }}
  return Object.entries(map).map(([name,c])=>{{
    const sorted=c.pcts.slice().sort((a,b)=>b-a);
    const avg=c.pcts.reduce((a,b)=>a+b,0)/c.pcts.length;
    const top3avg=sorted.slice(0,3).reduce((a,b)=>a+b,0)/Math.min(3,sorted.length);
    return{{name,count:c.pcts.length,events:c.events.size,avg,top3avg,best:sorted[0]}};
  }}).sort((a,b)=>b.top3avg-a.top3avg);
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
  for(const r of ROWS) for(const l of r.lanes)
    if(l.pct!==null) entries.push({{crew:l.crew,club:l.club,event:r.event,round:r.round,time:l.time,pct:l.pct}});
  entries.sort((a,b)=>b.pct-a.pct);
  const filtered=clubQ?entries.filter(e=>normClub(e.club).toLowerCase()===clubQ):entries;
  dlCSV([['Crew','Club','Event','Round','Time','GMT%'],...filtered.slice(0,250).map((e,i)=>[e.crew,e.club,e.event,e.round,e.time,e.pct.toFixed(1)])],'heatmap-{comp}-top250.csv');
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
    +'<text x="'+PL+'" y="28" font-family="-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif" font-size="15" font-weight="700" fill="#e8e8e6">{title}</text>'
    +'<text x="'+PL+'" y="46" font-family="-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif" font-size="11" fill="#c8472b" font-weight="600">rowingtools.co.uk</text>'
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

renderHeatmap(ROWS, '');
</script>
</body>
</html>"""

def make_title(comp):
    m = re.match(r'met(sat|sun)(\d{2})$', comp, re.I)
    if m:
        day = 'Saturday' if m.group(1).lower() == 'sat' else 'Sunday'
        return f"Met Regatta 20{m.group(2)} - {day}"
    m = re.match(r'met(\d{2})(sat|sun)$', comp, re.I)
    if m:
        day = 'Saturday' if m.group(2).lower() == 'sat' else 'Sunday'
        return f"Met Regatta 20{m.group(1)} - {day}"
    return f"Heatmap -{comp}"

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate a GMT%% heatmap HTML from any rowresults.co.uk competition.\n\n"
                    "Examples:\n"
                    "  python generate_heatmap.py --comp metsat25\n"
                    "  python generate_heatmap.py --comp metsun23\n"
                    "  python generate_heatmap.py --comp metsat25 --out my-heatmap.html",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--comp", default="metsat25",
                        help="rowresults.co.uk competition code (default: metsat25)")
    parser.add_argument("--out",  default=None,
                        help="Output filename (default: ../../heatmap-<comp>.html)")
    args = parser.parse_args()

    bm_path = Path(__file__).parent.parent.parent / "data" / "benchmarks_v3.json"
    title   = make_title(args.comp)
    out_name = args.out or f"../../heatmap-{args.comp}.html"

    rows = build_data(args.comp, bm_path)
    html = generate_html(rows, args.comp, title)

    out = (Path(__file__).parent / out_name).resolve()
    out.write_text(html, encoding="utf-8")
    print(f"\nWritten to {out}")
