#!/usr/bin/env python3
"""
update_heatmap_styles.py
Apply the new visual design to all existing heatmap-*.html files.
Run once from the repo root.
"""

import re
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent

FONT_LINKS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">\n'
)

NEW_CSS = """<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0f0f0e;--bg2:#1a1a18;--bg3:#252523;--text:#f0f0ee;--text2:#9ca3af;--text3:#6b7280;--border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.14)}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);font-size:13px;padding:0 20px 2.5rem;max-width:1200px;margin:0 auto;line-height:1.6}
.topbar{position:fixed;top:0;left:0;width:100%;height:3px;background:linear-gradient(90deg,#1d4ed8,#7c3aed 50%,#059669);z-index:9999;pointer-events:none}
.page-hdr{padding:2rem 0 1.25rem;border-bottom:1px solid var(--border);margin-bottom:1.5rem}
.back-nav{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text3);text-decoration:none;margin-bottom:10px;transition:color .15s;font-weight:500}
.back-nav:hover{color:var(--text2)}
h1{font-size:20px;font-weight:700;letter-spacing:-0.4px;margin-bottom:4px}
.sub{color:var(--text3);font-size:12px;line-height:1.6;margin-bottom:0}
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
.view-in{animation:viewIn .2s ease}
</style>"""

BACK_NAV = (
    '  <a href="/" class="back-nav">'
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">'
    '<path d="M9 2L4 7L9 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
    '</svg>'
    'Rowing Tools</a>\n'
)

NEW_SHOW_TAB = """function rankBadge(r){return r===1?'<span class="rank-badge gold">1</span>':r===2?'<span class="rank-badge silver">2</span>':r===3?'<span class="rank-badge bronze">3</span>':'<span style="color:var(--text3)">'+r+'</span>';}
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
}"""

OLD_SHOW_TAB = """function showTab(name,btn){
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('view-heatmap').style.display =name==='heatmap'?'':'none';
  document.getElementById('view-top100').style.display  =name==='top100' ?'':'none';
  document.getElementById('view-compare').style.display =name==='compare'?'':'none';
  document.getElementById('view-clublb').style.display  =name==='clublb' ?'':'none';
  if(name==='heatmap')renderHeatmap(ROWS,document.getElementById('club-filter-hm').value);
  if(name==='top100') renderTop100();
  if(name==='clublb') renderClubLB();
}"""

OLD_LB_ROW = (
    'h+=`<tr><td class="num" style="color:#555">${e.rank}</td>'
    '<td><strong>${e.crew}</strong></td>'
    '<td style="color:#888">${e.club}</td>'
    '<td style="color:#aaa">${e.event}</td>'
    '<td style="color:#666">${e.round}</td>'
    '<td class="num" style="color:#888">${e.time}</td>'
    '<td class="num"><strong style="color:${f}">${e.pct.toFixed(1)}%</strong></td></tr>`;'
)

NEW_LB_ROW = (
    'h+=`<tr style="animation:viewIn .2s ease ${Math.min(i,20)*0.025}s both">'
    '<td class="num">${rankBadge(e.rank)}</td>'
    '<td><strong>${e.crew}</strong></td>'
    '<td style="color:var(--text2)">${e.club}</td>'
    '<td style="color:var(--text3)">${e.event}</td>'
    '<td style="color:var(--text3)">${e.round}</td>'
    '<td class="num" style="color:var(--text2)">${e.time}</td>'
    '<td class="num"><strong style="color:${f}">${e.pct.toFixed(1)}%</strong></td></tr>`;'
)

OLD_CLB_ROW = (
    "h+='<tr><td class=\"num\" style=\"color:#555\">'+(i+1)+'</td>"
    "<td><strong>'+c.name+'</strong></td>"
    "<td class=\"num\" style=\"color:#888\">'+c.count+'</td>"
    "<td class=\"num\" style=\"color:#888\">'+c.events+'</td>"
    "<td class=\"num\"><strong style=\"color:'+ft+'\">'+c.top3avg.toFixed(1)+'%</strong></td>"
    "<td class=\"num\" style=\"color:#aaa\">'+c.avg.toFixed(1)+'%</td>"
    "<td class=\"num\" style=\"color:#ccc\">'+c.best.toFixed(1)+'%</td></tr>';"
)

NEW_CLB_ROW = (
    "h+='<tr><td class=\"num\">'+rankBadge(i+1)+'</td>"
    "<td><strong>'+c.name+'</strong></td>"
    "<td class=\"num\" style=\"color:var(--text2)\">'+c.count+'</td>"
    "<td class=\"num\" style=\"color:var(--text2)\">'+c.events+'</td>"
    "<td class=\"num\"><strong style=\"color:'+ft+'\">'+c.top3avg.toFixed(1)+'%</strong></td>"
    "<td class=\"num\" style=\"color:var(--text3)\">'+c.avg.toFixed(1)+'%</td>"
    "<td class=\"num\" style=\"color:var(--text2)\">'+c.best.toFixed(1)+'%</td></tr>';"
)

OLD_MK_STAT = (
    "function mkStat(c){\n"
    "    if(!c.entries.length)return'<div style=\"background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;min-width:160px\">"
    "<div style=\"color:'+c.col+';font-weight:700;font-size:13px\">'+c.q+'</div>"
    "<div style=\"color:#555;font-size:11px;margin-top:6px\">No results found</div></div>';\n"
    "    const pcts=c.entries.map(e=>e.pct);\n"
    "    const avg=pcts.reduce((a,b)=>a+b,0)/pcts.length;\n"
    "    const best=Math.max(...pcts);\n"
    "    const top3=pcts.slice().sort((a,b)=>b-a).slice(0,3).reduce((a,b)=>a+b,0)/Math.min(3,pcts.length);\n"
    "    const evts=new Set(c.entries.map(e=>e.event)).size;\n"
    "    return'<div style=\"background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;min-width:170px\">"
    "<div style=\"color:'+c.col+';font-weight:700;font-size:13px;margin-bottom:8px\">'+c.q+'</div>"
    "<div style=\"display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;font-size:11px\">"
    "<span style=\"color:#666\">Entries</span><span style=\"color:#ccc\">'+c.entries.length+'</span>"
    "<span style=\"color:#666\">Events</span><span style=\"color:#ccc\">'+evts+'</span>"
    "<span style=\"color:#666\">Avg GMT%</span><span style=\"color:'+c.col+';font-weight:600\">'+avg.toFixed(1)+'%</span>"
    "<span style=\"color:#666\">Top 3 avg</span><span style=\"color:'+c.col+';font-weight:600\">'+top3.toFixed(1)+'%</span>"
    "<span style=\"color:#666\">Best</span><span style=\"color:#fff;font-weight:700\">'+best.toFixed(1)+'%</span>"
    "</div></div>';\n"
    "  }"
)

NEW_MK_STAT = (
    "function mkStat(c){\n"
    "    if(!c.entries.length)return'<div class=\"stat-card\">"
    "<div class=\"stat-card-name\" style=\"color:'+c.col+'\">'+c.q+'</div>"
    "<div class=\"stat-card-lbl\" style=\"margin-top:6px\">No results found</div></div>';\n"
    "    const pcts=c.entries.map(e=>e.pct);\n"
    "    const avg=pcts.reduce((a,b)=>a+b,0)/pcts.length;\n"
    "    const best=Math.max(...pcts);\n"
    "    const top3=pcts.slice().sort((a,b)=>b-a).slice(0,3).reduce((a,b)=>a+b,0)/Math.min(3,pcts.length);\n"
    "    const evts=new Set(c.entries.map(e=>e.event)).size;\n"
    "    return'<div class=\"stat-card\">"
    "<div class=\"stat-card-name\" style=\"color:'+c.col+'\">'+c.q+'</div>"
    "<div class=\"stat-card-grid\">"
    "<span class=\"stat-card-lbl\">Entries</span><span class=\"stat-card-val\">'+c.entries.length+'</span>"
    "<span class=\"stat-card-lbl\">Events</span><span class=\"stat-card-val\">'+evts+'</span>"
    "<span class=\"stat-card-lbl\">Avg GMT%</span><span class=\"stat-card-val\" style=\"color:'+c.col+'\">'+avg.toFixed(1)+'%</span>"
    "<span class=\"stat-card-lbl\">Top 3 avg</span><span class=\"stat-card-val\" style=\"color:'+c.col+'\">'+top3.toFixed(1)+'%</span>"
    "<span class=\"stat-card-lbl\">Best</span><span class=\"stat-card-val\" style=\"font-weight:700\">'+best.toFixed(1)+'%</span>"
    "</div></div>';\n"
    "  }"
)

OLD_BG = "function bg(p){return p===null?'#2a2a2a':p>=87?'#1a4d3e':p>=80?'#1a3a5c':p>=72?'#4a3200':'#4a1a0a'}"
NEW_BG = "function bg(p){return p===null?'#252523':p>=87?'#0a3d2a':p>=80?'#0d2d4a':p>=72?'#3d2200':'#3d0e0a'}"

OLD_FG = "function fg(p){return p===null?'#555':p>=87?'#4ee8b0':p>=80?'#7bbfff':p>=72?'#f0b030':'#ff7050'}"
NEW_FG = "function fg(p){return p===null?'#555':p>=87?'#34d399':p>=80?'#60a5fa':p>=72?'#fb923c':'#f87171'}"

FOOTER = '\n<div class="footer"><a href="/">← rowingtools.co.uk</a></div>\n'


def process_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    # 1. Replace <style> block with font links + new CSS
    text = re.sub(r'<style>.*?</style>', FONT_LINKS + NEW_CSS, text, flags=re.DOTALL)

    # 2. Add topbar + wrap h1/.sub in .page-hdr with back nav
    #    Match: <body>\n<h1>TITLE</h1>\n<p class="sub">TEXT</p>
    def wrap_header(m):
        h1 = m.group(1)
        sub = m.group(2)
        return (
            '<body>\n'
            '<div class="topbar"></div>\n'
            '<header class="page-hdr">\n'
            + BACK_NAV +
            f'  <h1>{h1}</h1>\n'
            f'  <p class="sub">{sub}</p>\n'
            '</header>\n'
        )
    text = re.sub(
        r'<body>\n<h1>(.*?)</h1>\n<p class="sub">(.*?)</p>',
        wrap_header,
        text,
        flags=re.DOTALL,
    )

    # 3. Update showTab + add rankBadge
    text = text.replace(OLD_SHOW_TAB, NEW_SHOW_TAB)

    # 4. Update leaderboard row HTML
    text = text.replace(OLD_LB_ROW, NEW_LB_ROW)

    # 5. Update club leaderboard row HTML
    text = text.replace(OLD_CLB_ROW, NEW_CLB_ROW)

    # 6. Update mkStat
    text = text.replace(OLD_MK_STAT, NEW_MK_STAT)

    # 7. Richer heatmap cell colours
    text = text.replace(OLD_BG, NEW_BG)
    text = text.replace(OLD_FG, NEW_FG)

    # 8. Add footer before </body>
    if FOOTER.strip() not in text:
        text = text.replace('</body>', FOOTER + '</body>')

    if text == original:
        print(f"  SKIP (no changes matched): {path.name}")
        return False

    path.write_text(text, encoding="utf-8")
    print(f"  OK: {path.name}")
    return True


def main():
    files = sorted(ROOT.glob("heatmap-*.html"))
    print(f"Found {len(files)} heatmap files\n")
    updated = sum(process_file(f) for f in files)
    print(f"\nDone — {updated}/{len(files)} files updated.")


if __name__ == "__main__":
    main()
