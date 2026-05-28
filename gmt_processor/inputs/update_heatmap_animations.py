#!/usr/bin/env python3
"""Add animations to all heatmap-*.html files."""

from pathlib import Path

ROOT = Path(__file__).parent.parent.parent

# ── CSS additions ─────────────────────────────────────────────────────────────

OLD_CSS_END = (
    "@keyframes viewIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}\n"
    ".view-in{animation:viewIn .2s ease}\n"
    "</style>"
)
NEW_CSS_END = (
    "@keyframes viewIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}\n"
    ".view-in{animation:viewIn .2s ease}\n"
    "@keyframes dotIn{from{fill-opacity:0}to{fill-opacity:0.75}}\n"
    "</style>"
)

# ── renderHeatmap: cell HTML — add data-p, start at 0.0% ─────────────────────

OLD_CELL = (
    "const b=bg(l.pct),f=fg(l.pct),p=l.pct!==null?l.pct.toFixed(1)+'%':'&#x2014;';\n"
    "        const dim=clubQ&&l.club.toLowerCase()!==clubQ?'opacity:0.12;':'';\n"
    "        cells+=`<td style=\"background:${b};${dim}\"><div class=\"cell\">"
    "<span class=\"cn\">${l.crew}</span>"
    "<span class=\"cp\" style=\"color:${f}\">${p}</span>"
    "<span class=\"ct\">${l.time}</span></div></td>`;"
)
NEW_CELL = (
    "const b=bg(l.pct),f=fg(l.pct);\n"
    "        const pDisp=l.pct!==null?'0.0%':'&#x2014;',pData=l.pct!==null?' data-p=\"'+l.pct+'\"':'';\n"
    "        const dim=clubQ&&l.club.toLowerCase()!==clubQ?'opacity:0.12;':'';\n"
    "        cells+=`<td style=\"background:${b};${dim}\"><div class=\"cell\">"
    "<span class=\"cn\">${l.crew}</span>"
    "<span class=\"cp\" style=\"color:${f}\"${pData}>${pDisp}</span>"
    "<span class=\"ct\">${l.time}</span></div></td>`;"
)

# ── renderHeatmap: table stagger ─────────────────────────────────────────────

OLD_H_INIT = "  let h='';\n  for(const[ev,races] of groups){"
NEW_H_INIT = "  let h='',tIdx=0;\n  for(const[ev,races] of groups){"

OLD_TABLE_LINE = (
    "h+=`<table><caption>${ev}</caption>"
    "<thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;"
)
NEW_TABLE_LINE = (
    "h+=`<table style=\"animation:viewIn .4s ease ${Math.min(tIdx,25)*0.05}s both\">"
    "<caption>${ev}</caption>"
    "<thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;tIdx++;"
)

# ── renderHeatmap: trigger cell count-up on first render ─────────────────────

OLD_INNER = (
    "document.getElementById('heatmap-out').innerHTML=h||'<p style=\"color:#555\">No results.</p>';\n"
    "}\n"
    "function filterHeatmap(q)"
)
NEW_INNER = (
    "document.getElementById('heatmap-out').innerHTML=h||'<p style=\"color:#555\">No results.</p>';\n"
    "  if(!hmInited){hmInited=true;setTimeout(animateCells,80);}\n"
    "}\n"
    "let hmInited=false;\n"
    "function animateCells(){\n"
    "  const cells=document.querySelectorAll('#heatmap-out .cp[data-p]');\n"
    "  if(!cells.length)return;\n"
    "  const dur=600,start=performance.now();\n"
    "  function step(now){\n"
    "    const p=Math.min((now-start)/dur,1),ease=1-Math.pow(1-p,3);\n"
    "    cells.forEach(el=>{el.textContent=(parseFloat(el.dataset.p)*ease).toFixed(1)+'%';});\n"
    "    if(p<1)requestAnimationFrame(step);\n"
    "  }\n"
    "  requestAnimationFrame(step);\n"
    "}\n"
    "function filterHeatmap(q)"
)

# ── renderClubLB: row stagger ─────────────────────────────────────────────────

OLD_CLB_ROW = (
    "h+='<tr><td class=\"num\">'+rankBadge(i+1)+'</td>"
    "<td><strong>'+c.name+'</strong></td>"
    "<td class=\"num\" style=\"color:var(--text2)\">'+c.count+'</td>"
    "<td class=\"num\" style=\"color:var(--text2)\">'+c.events+'</td>"
    "<td class=\"num\"><strong style=\"color:'+ft+'\">'+c.top3avg.toFixed(1)+'%</strong></td>"
    "<td class=\"num\" style=\"color:var(--text3)\">'+c.avg.toFixed(1)+'%</td>"
    "<td class=\"num\" style=\"color:var(--text2)\">'+c.best.toFixed(1)+'%</td></tr>';"
)
NEW_CLB_ROW = (
    "h+='<tr style=\"animation:viewIn .2s ease '+(Math.min(i,20)*0.025)+'s both\">"
    "<td class=\"num\">'+rankBadge(i+1)+'</td>"
    "<td><strong>'+c.name+'</strong></td>"
    "<td class=\"num\" style=\"color:var(--text2)\">'+c.count+'</td>"
    "<td class=\"num\" style=\"color:var(--text2)\">'+c.events+'</td>"
    "<td class=\"num\"><strong style=\"color:'+ft+'\">'+c.top3avg.toFixed(1)+'%</strong></td>"
    "<td class=\"num\" style=\"color:var(--text3)\">'+c.avg.toFixed(1)+'%</td>"
    "<td class=\"num\" style=\"color:var(--text2)\">'+c.best.toFixed(1)+'%</td></tr>';"
)

# ── renderCompare: SVG dot entrance ──────────────────────────────────────────

OLD_DOT = (
    "s+='<circle cx=\"'+xOf(e.pct).toFixed(1)+'\""
    " cy=\"'+jy+'\" r=\"4\" fill=\"'+c.col+'\" fill-opacity=\"0.75\""
    " stroke=\"#111\" stroke-width=\"0.5\"><title>'+tip+'</title></circle>';"
)
NEW_DOT = (
    "s+='<circle cx=\"'+xOf(e.pct).toFixed(1)+'\""
    " cy=\"'+jy+'\" r=\"4\" fill=\"'+c.col+'\" fill-opacity=\"0\""
    " stroke=\"#111\" stroke-width=\"0.5\""
    " style=\"animation:dotIn .4s ease '+(j*0.015).toFixed(2)+'s forwards\">"
    "<title>'+tip+'</title></circle>';"
)


def process(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    orig = text

    text = text.replace(OLD_CSS_END,    NEW_CSS_END)
    text = text.replace(OLD_CELL,       NEW_CELL)
    text = text.replace(OLD_H_INIT,     NEW_H_INIT)
    text = text.replace(OLD_TABLE_LINE, NEW_TABLE_LINE)
    text = text.replace(OLD_INNER,      NEW_INNER)
    text = text.replace(OLD_CLB_ROW,    NEW_CLB_ROW)
    text = text.replace(OLD_DOT,        NEW_DOT)

    if text == orig:
        print(f"  SKIP: {path.name}")
        return False
    path.write_text(text, encoding="utf-8")
    print(f"  OK:   {path.name}")
    return True


def main():
    files = sorted(ROOT.glob("heatmap-*.html"))
    print(f"Found {len(files)} files\n")
    n = sum(process(f) for f in files)
    print(f"\nDone — {n}/{len(files)} updated.")


if __name__ == "__main__":
    main()
