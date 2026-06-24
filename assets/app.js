// ── BENCHMARK DATA ────────────────────────────────────────────────────────────
// Fetched from data/benchmarks_v2.json at load time.
// Single source of truth - edit the JSON file, never this script.

const BOAT_ORDER=["M8+","M4-","M4x","M4+","M2-","M2x","M2+","M1x","LM4-","LM2x","LM1x","W8+","W4-","W4x","W4+","W2-","W2x","W1x","LW2x","LW1x"];
const ALL_YEARS_HRR=[2021,2022,2023,2024,2025];
const ALL_YEARS_HWR=[2022,2023,2024,2025];
const HF=2000/2112;
const HF_HWR=2000/1500;

// These are populated after the fetch resolves
let WBT={}, MET_RAW={}, MET_AVG={}, MET_A_AVG={}, MET_B_AVG={}, MET_C_AVG={},
    HRR={}, HRR_OPTS=[], HWR={}, HWR_OPTS=[], BENCHMARK_VERSION='';

function _avgMetSection(raw){
  const out={};
  for(const[k,v]of Object.entries(raw||{})){
    const years={};
    for(const[yr,vals]of Object.entries(v.years)) years[parseInt(yr)]=vals;
    const vals=[];
    for(const yr of Object.values(years)){if(yr.sat)vals.push(yr.sat);if(yr.sun)vals.push(yr.sun);}
    if(vals.length)out[k]={label:v.label,avg:vals.reduce((a,b)=>a+b,0)/vals.length,n:vals.length};
  }
  return out;
}

function buildBenchmarks(data){
  BENCHMARK_VERSION=data._meta?.version||'v1';
  WBT={};
  for(const[k,v]of Object.entries(data.wbt)) WBT[k]={label:v.label,t:v.time};
  MET_RAW={};
  for(const[k,v]of Object.entries(data.met_raw)){
    const years={};
    for(const[yr,vals]of Object.entries(v.years)) years[parseInt(yr)]=vals;
    MET_RAW[k]={label:v.label,years};
  }
  MET_AVG=_avgMetSection(data.met_raw);
  MET_A_AVG=_avgMetSection(data.met_a_slowest||{});
  MET_B_AVG=_avgMetSection(data.met_b_slowest||{});
  MET_C_AVG=_avgMetSection(data.met_c_slowest||{});
  HRR={};
  for(const[k,d]of Object.entries(data.hrr_raw)){
    const years={};
    for(const[yr,t]of Object.entries(d.years)) years[parseInt(yr)]=t;
    const vals=Object.values(years);
    const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
    HRR[k]={label:d.label,boatClass:d.boat,avgH:avg,t2k:avg*HF,n:vals.length,years};
  }
  HRR_OPTS=[["","- no Henley benchmark -"],...Object.entries(HRR).map(([k,d])=>[k,d.label])];
  HWR={};
  for(const[k,d]of Object.entries(data.hwr_raw||{})){
    const years={};
    for(const[yr,t]of Object.entries(d.years)) years[parseInt(yr)]=t;
    const vals=Object.values(years);
    const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
    HWR[k]={label:d.label,boatClass:d.boat,avgH:avg,t2k:avg*HF_HWR,n:vals.length,years};
  }
  HWR_OPTS=[["","- no HWR benchmark -"],...Object.entries(HWR).map(([k,d])=>[k,d.label])];
}

function parseT(s){
  if(!s)return null;s=s.trim().replace(',','.');
  const m=s.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if(!m)return null;return parseInt(m[1])*60+parseFloat(m[2]);
}
function fmtT(s){const m=Math.floor(s/60),r=s-m*60;return m+':'+r.toFixed(2).padStart(5,'0');}
function pctColor(p){return p>=87?'#0F6E56':p>=80?'#185FA5':p>=72?'#BA7517':'#993C1D';}
function boatOpts(sel){return BOAT_ORDER.map(k=>`<option value="${k}"${k===sel?' selected':''}>${k} — ${WBT[k]?.label||''}</option>`).join('');}
function hrrOpts(sel){return HRR_OPTS.map(([k,l])=>`<option value="${k}"${k===sel?' selected':''}>${l}</option>`).join('');}
function hwrOpts(sel){return HWR_OPTS.map(([k,l])=>`<option value="${k}"${k===sel?' selected':''}>${l}</option>`).join('');}

const bench={wbt:true,met:true,hrr:true,hwr:true};
const bCfg={wbt:{c:'var(--c-wbt)',bg:'var(--c-wbt-bg)'},met:{c:'var(--c-met)',bg:'var(--c-met-bg)'},hrr:{c:'var(--c-hrr)',bg:'var(--c-hrr-bg)'},hwr:{c:'var(--c-hwr)',bg:'var(--c-hwr-bg)'}};
function applyToggleStyle(b){
  const btn=document.getElementById('tog-'+b);
  if(bench[b]){btn.style.borderColor=bCfg[b].c;btn.style.background=bCfg[b].bg;btn.style.color=bCfg[b].c;}
  else{btn.style.borderColor='';btn.style.background='';btn.style.color='';}
}

function toggleBench(b){
  bench[b]=!bench[b];applyToggleStyle(b);
  renderHeader();rows.forEach(r=>renderRow(r.id));
}

function renderHeader(){
  let h='<tr><th style="width:32px"></th><th style="min-width:130px">Label</th><th style="min-width:72px">Time</th><th style="min-width:150px">Boat class</th>';
  if(bench.wbt)h+=`<th colspan="2" style="min-width:110px;color:var(--c-wbt)">vs WBT</th>`;
  if(bench.met)h+=`<th colspan="2" style="min-width:110px;color:var(--c-met)">vs Met avg winning</th>`;
  if(bench.hrr)h+=`<th style="min-width:170px">HRR event</th><th colspan="2" style="min-width:110px;color:var(--c-hrr)">vs HRR qual.</th>`;
  if(bench.hwr)h+=`<th style="min-width:170px">HWR event</th><th colspan="2" style="min-width:110px;color:var(--c-hwr)">vs HWR avg winning</th>`;
  h+='</tr>';
  document.getElementById('tbl-head').innerHTML=h;
}
// renderHeader and addRow called by startApp() after fetch resolves

let rowId=0;
const rows=[];

function getScore(r,metric){
  const s=parseT(r.time);if(!s)return null;
  if(metric==='wbt'){const w=WBT[r.boat];return w?(parseT(w.t)/s)*100:null;}
  if(metric==='met'){const m=MET_AVG[r.boat];return m?(m.avg/s)*100:null;}
  if(metric==='hrr'){const h=HRR[r.hrrKey];return h?(h.t2k/s)*100:null;}
  if(metric==='hwr'){const h=HWR[r.hwrKey];return h?(h.t2k/s)*100:null;}
  if(metric==='time')return s;
  return null;
}

function sortRows(){
  const metric=document.getElementById('sort-by').value;
  rows.sort((a,b)=>{
    const sa=getScore(a,metric),sb=getScore(b,metric);
    if(sa===null&&sb===null)return 0;
    if(sa===null)return 1;if(sb===null)return-1;
    // For time, lower is better (sort ascending); for %, higher is better (sort descending)
    return metric==='time'?sa-sb:sb-sa;
  });
  rebuildBody();
}

function addRow(){
  const id=rowId++;
  rows.push({id,label:'',time:'',boat:'M8+',hrrKey:'',hwrKey:''});
  rebuildBody();
  const el=document.getElementById('row-'+id);
  if(el)el.classList.add('row-new');
  setTimeout(()=>document.getElementById('label-'+id)?.focus(),30);
}

function removeRow(id){
  const i=rows.findIndex(r=>r.id===id);if(i>-1)rows.splice(i,1);rebuildBody();
}
function rebuildBody(){
  document.getElementById('empty-msg').style.display=rows.length?'none':'block';
  document.getElementById('results-body').innerHTML=rows.map(r=>rowHTML(r)).join('');
  rows.forEach(r=>refreshScores(r.id));
}
function rowHTML(r){
  let tr=`<tr id="row-${r.id}">
    <td class="act" style="white-space:nowrap"><button class="ghost" onclick="removeRow(${r.id})">×</button><button onclick="openChart(${r.id})" style="font-size:12px;padding:3px 8px;height:auto;color:var(--c-wbt);border-color:var(--c-wbt)">Progression Chart</button></td>
    <td data-label="Label"><input type="text" class="lin" id="label-${r.id}" placeholder="e.g. Men's 8+" value="${r.label}" oninput="upd(${r.id},'label',this.value)"></td>
    <td data-label="Time"><input type="text" class="tin" id="time-${r.id}" placeholder="6:45.2" value="${r.time}" oninput="upd(${r.id},'time',this.value)"></td>
    <td data-label="Boat class"><select id="boat-${r.id}" onchange="upd(${r.id},'boat',this.value)">${boatOpts(r.boat)}</select></td>`;
  if(bench.wbt)tr+=`<td data-label="vs WBT" id="wv-${r.id}">—</td><td class="barcell" id="wb-${r.id}"></td>`;
  if(bench.met)tr+=`<td data-label="vs Met avg" id="mv-${r.id}">—</td><td class="barcell" id="mb-${r.id}"></td>`;
  if(bench.hrr)tr+=`<td data-label="HRR event"><select id="hrr-${r.id}" class="hrr-sel" onchange="upd(${r.id},'hrrKey',this.value)">${hrrOpts(r.hrrKey)}</select></td><td data-label="vs HRR qual." id="hv-${r.id}">—</td><td class="barcell" id="hb-${r.id}"></td>`;
  if(bench.hwr)tr+=`<td data-label="HWR event"><select id="hwr-${r.id}" class="hrr-sel" onchange="upd(${r.id},'hwrKey',this.value)">${hwrOpts(r.hwrKey)}</select></td><td data-label="vs HWR avg" id="hwv-${r.id}">—</td><td class="barcell" id="hwb-${r.id}"></td>`;
  return tr+'</tr>';
}
function renderRow(id){
  const r=rows.find(r=>r.id===id);if(!r)return;
  const el=document.getElementById('row-'+id);if(!el)return;
  el.outerHTML=rowHTML(r);refreshScores(id);
}
function upd(id,field,val){const r=rows.find(r=>r.id===id);if(!r)return;r[field]=val;refreshScores(id);}
const countUpTimers={};
function animatePct(el,target,color){
  if(countUpTimers[el.id])cancelAnimationFrame(countUpTimers[el.id]);
  const cur=el.querySelector&&el.querySelector('.pv');
  const from=cur?parseFloat(cur.textContent)||0:0;
  const dur=700,start=performance.now();
  function step(now){
    const p=Math.min((now-start)/dur,1),ease=1-Math.pow(1-p,3);
    const val=from+(target-from)*ease;
    el.innerHTML=`<span class="pv" style="color:${color}">${val.toFixed(1)}%</span>`;
    if(p<1)countUpTimers[el.id]=requestAnimationFrame(step);else countUpTimers[el.id]=null;
  }
  countUpTimers[el.id]=requestAnimationFrame(step);
}
function sc(vid,bid,pct){
  const v=document.getElementById(vid),b=document.getElementById(bid);if(!v||!b)return;
  if(pct===null){
    if(countUpTimers[vid])cancelAnimationFrame(countUpTimers[vid]);
    v.textContent='—';v.style.color='';b.innerHTML='';return;
  }
  const c=pctColor(pct),w=Math.min(100,pct).toFixed(1);
  animatePct(v,pct,c);
  b.innerHTML=`<div class="bar-bg"><div class="bar" style="width:${w}%;background:${c}"></div></div>`;
}
function refreshScores(id){
  const r=rows.find(r=>r.id===id);if(!r)return;
  const s=parseT(r.time);
  if(bench.wbt){const w=WBT[r.boat];sc('wv-'+id,'wb-'+id,s&&w?(parseT(w.t)/s)*100:null);}
  if(bench.met){const m=MET_AVG[r.boat];sc('mv-'+id,'mb-'+id,s&&m?(m.avg/s)*100:null);}
  if(bench.hrr){const h=HRR[r.hrrKey];sc('hv-'+id,'hb-'+id,s&&h?(h.t2k/s)*100:null);}
  if(bench.hwr){const h=HWR[r.hwrKey];sc('hwv-'+id,'hwb-'+id,s&&h?(h.t2k/s)*100:null);}
}
// addRow() called by startApp() after fetch resolves

// ── BENCHMARK CHART ───────────────────────────────────────────────────────────
function openChart(id){
  const r=rows.find(r=>r.id===id);if(!r)return;
  const s=parseT(r.time);if(!s)return;
  const wbt=WBT[r.boat];if(!wbt)return;
  const wbtT=parseT(wbt.t);if(!wbtT)return;
  const userPct=(wbtT/s)*100;
  const userC=pctColor(userPct);
  const cs=getComputedStyle(document.documentElement);
  const BG=cs.getPropertyValue('--bg').trim()||'#fff';
  const BG3=cs.getPropertyValue('--bg3').trim()||'#ebebea';
  const TEXT2=cs.getPropertyValue('--text2').trim()||'#666';
  const TEXT3=cs.getPropertyValue('--text3').trim()||'#999';
  const C={wbt:cs.getPropertyValue('--c-wbt').trim()||'#185FA5',met:cs.getPropertyValue('--c-met').trim()||'#6D2E46',hrr:cs.getPropertyValue('--c-hrr').trim()||'#0F6E56',hwr:cs.getPropertyValue('--c-hwr').trim()||'#B45309'};
  const bmarks=[{key:'wbt',label:'WBT',pct:100,color:C.wbt,dash:false,bmTime:wbtT}];
  const met=MET_AVG[r.boat];
  if(bench.met&&met)bmarks.push({key:'met',label:'Met A win avg',pct:(wbtT/met.avg)*100,color:C.met,dash:true,bmTime:met.avg});
  const metA=MET_A_AVG[r.boat];
  if(bench.met&&metA)bmarks.push({key:'metA',label:'Met A final',pct:(wbtT/metA.avg)*100,color:'#9B4465',dash:true,bmTime:metA.avg,listOnly:true});
  const metB=MET_B_AVG[r.boat];
  if(bench.met&&metB)bmarks.push({key:'metB',label:'Met B final',pct:(wbtT/metB.avg)*100,color:'#B56A85',dash:true,bmTime:metB.avg,listOnly:true});
  const metC=MET_C_AVG[r.boat];
  if(bench.met&&metC)bmarks.push({key:'metC',label:'Met C final',pct:(wbtT/metC.avg)*100,color:'#CE91A8',dash:true,bmTime:metC.avg,listOnly:true});
  const hrr=HRR[r.hrrKey];
  if(hrr)bmarks.push({key:'hrr',label:'HRR qual.',pct:(wbtT/hrr.t2k)*100,color:C.hrr,dash:true,bmTime:hrr.t2k});
  const hwr=HWR[r.hwrKey];
  if(hwr)bmarks.push({key:'hwr',label:'HWR winning',pct:(wbtT/hwr.t2k)*100,color:C.hwr,dash:true,bmTime:hwr.t2k});
  const allPcts=[userPct,...bmarks.map(b=>b.pct)];
  const scaleMin=Math.max(55,Math.floor((Math.min(...allPcts)-3)/5)*5);
  const scaleMax=103;
  const W=480,H=100,pL=28,pR=28,cW=W-pL-pR;
  const TRACK_Y=42,TRACK_H=10;
  const toX=p=>pL+((p-scaleMin)/(scaleMax-scaleMin))*cW;
  const ta=x=>x<pL+30?'start':x>W-pR-30?'end':'middle';
  const clx=x=>Math.max(pL,Math.min(W-pR,x));
  const sorted=[...bmarks].filter(b=>!b.listOnly).sort((a,b)=>a.pct-b.pct);
  let prevX=-999,prevStagger=0;
  for(const bm of sorted){
    bm.x=toX(bm.pct);
    const gap=bm.x-prevX;
    bm.stagger=gap<44?Math.min(prevStagger+1,2):0;
    prevX=bm.x;prevStagger=bm.stagger;
  }
  const userX=toX(userPct);
  let svg=`<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">`;
  svg+=`<rect x="${pL}" y="${TRACK_Y}" width="${cW}" height="${TRACK_H}" rx="5" fill="${BG3}"/>`;
  const fw=Math.max(0,Math.min(userX-pL,cW));
  svg+=`<rect x="${pL}" y="${TRACK_Y}" width="${fw}" height="${TRACK_H}" rx="5" fill="${userC}" opacity=".22"/>`;
  for(const bm of sorted){
    const{x,stagger,pct,color,label,dash}=bm;
    const ly=stagger===2?28:stagger===1?18:8;
    const da=dash?'stroke-dasharray="3,2"':'';
    svg+=`<line x1="${x}" x2="${x}" y1="${ly+2}" y2="${TRACK_Y}" stroke="${color}" stroke-width="1.2" ${da} opacity=".8"/>`;
    svg+=`<text x="${clx(x)}" y="${ly}" text-anchor="${ta(x)}" style="fill:${color};font-size:9.5px;font-weight:500;font-family:inherit">${label} ${pct.toFixed(1)}%</text>`;
    svg+=`<circle cx="${x}" cy="${TRACK_Y+TRACK_H/2}" r="3.5" fill="${color}"/>`;
  }
  svg+=`<circle cx="${userX}" cy="${TRACK_Y+TRACK_H/2}" r="8" fill="${userC}" stroke="${BG}" stroke-width="2.5"/>`;
  svg+=`<line x1="${userX}" x2="${userX}" y1="${TRACK_Y+TRACK_H}" y2="${TRACK_Y+TRACK_H+16}" stroke="${userC}" stroke-width="1.5"/>`;
  const nl=(r.label||r.boat).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  const ux=clx(userX);
  svg+=`<text x="${ux}" y="${TRACK_Y+TRACK_H+30}" text-anchor="${ta(userX)}" style="fill:${userC};font-size:13px;font-weight:600;font-family:inherit">${userPct.toFixed(1)}% of WBT</text>`;
  svg+=`<text x="${ux}" y="${TRACK_Y+TRACK_H+44}" text-anchor="${ta(userX)}" style="fill:${TEXT2};font-size:10px;font-family:inherit">${nl}</text>`;
  svg+=`</svg>`;
  // Progression list: slowest benchmark (easiest) first, fastest (hardest) last
  const prog=[...bmarks].sort((a,b)=>b.bmTime-a.bmTime);
  let progHtml='<div class="prog-list">';
  for(const bm of prog){
    const delta=bm.bmTime-s;
    const sign=delta>=0?'+':'';
    const cls=delta>=0?'prog-pos':'prog-neg';
    const note=delta>=0?'already faster':'to reach';
    progHtml+=`<div class="prog-row"><span class="prog-label" style="color:${bm.color}">${bm.label}</span><span class="prog-delta ${cls}">${sign}${delta.toFixed(1)}s</span><span class="prog-note">${note}</span></div>`;
  }
  progHtml+='</div>';
  document.getElementById('chart-ttl').textContent=r.label||r.boat||'Entry';
  document.getElementById('chart-sub').textContent=[r.time,WBT[r.boat]?.label].filter(Boolean).join(' · ');
  document.getElementById('chart-svg-wrap').innerHTML=`<p style="font-size:11px;color:${TEXT3};margin-bottom:6px">All positions shown as % of World Best Time</p>`+svg;
  document.getElementById('chart-next').innerHTML=progHtml;
  document.getElementById('chart-overlay').classList.add('open');
}
function closeChart(e){
  if(!e||e.target===document.getElementById('chart-overlay'))
    document.getElementById('chart-overlay').classList.remove('open');
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeChart();});

// ── CSV DOWNLOAD ──────────────────────────────────────────────────────────────
function downloadCSV(){
  const hdr=['Label','Time','Boat class'];
  if(bench.wbt)hdr.push('WBT %');
  if(bench.met)hdr.push('Met avg winning %');
  if(bench.hrr)hdr.push('HRR event','HRR qual. %');
  if(bench.hwr)hdr.push('HWR event','HWR avg winning %');
  const lines=[hdr.join(',')];
  for(const r of rows){
    const s=parseT(r.time);
    const wbt=WBT[r.boat];
    const met=MET_AVG[r.boat];
    const hrr=HRR[r.hrrKey];
    const wbtP=s&&wbt?((parseT(wbt.t)/s)*100).toFixed(1):'';
    const metP=s&&met?((met.avg/s)*100).toFixed(1):'';
    const hrrP=s&&hrr?((hrr.t2k/s)*100).toFixed(1):'';
    const hrrLbl=hrr?hrr.label:'';
    const row=[
      `"${r.label.replace(/"/g,'""')}"`,
      r.time,
      r.boat,
    ];
    if(bench.wbt)row.push(wbtP);
    if(bench.met)row.push(metP);
    if(bench.hrr)row.push(`"${hrrLbl}"`,hrrP);
    if(bench.hwr){const hw=HWR[r.hwrKey];row.push(`"${hw?hw.label:''}"`,s&&hw?((hw.t2k/s)*100).toFixed(1):'');}
    lines.push(row.join(','));
  }
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='rowing-gmt-results.csv';
  a.click();URL.revokeObjectURL(a.href);
}

// ── BENCHMARK TABLES ──────────────────────────────────────────────────────────
function renderWBT(q=''){
  q=q.toLowerCase();
  const rs=BOAT_ORDER.filter(k=>WBT[k]&&(k.toLowerCase().includes(q)||WBT[k].label.toLowerCase().includes(q)))
    .map(k=>`<tr><td><strong>${k}</strong></td><td>${WBT[k].label}</td><td>${WBT[k].t}</td></tr>`).join('');
  document.getElementById('wbt-wrap').innerHTML=`<table class="rtbl"><thead><tr>
    <th class="hd-dim">Code</th><th class="hd-dim">Event</th><th class="hd-wbt">WBT (2000m)</th>
  </tr></thead><tbody>${rs}</tbody></table>`;
}
// called by startApp()

function renderMET(q=''){
  q=q.toLowerCase();
  const rs=Object.entries(MET_AVG).filter(([k,v])=>k.toLowerCase().includes(q)||v.label.toLowerCase().includes(q))
    .map(([k,v])=>{
      const yc=[2021,2022,2023,2025].map(yr=>{
        const d=MET_RAW[k]?.years[yr];if(!d)return`<td style="color:var(--text3)">—</td>`;
        const p=[];if(d.sat)p.push('Sat '+fmtT(d.sat));if(d.sun)p.push('Sun '+fmtT(d.sun));
        return`<td style="font-size:12px">${p.join('<br>')}</td>`;
      }).join('');
      return`<tr><td><strong>${k}</strong></td><td>${v.label}</td><td><strong>${fmtT(v.avg)}</strong><br><span style="font-size:11px;color:var(--text3)">${v.n} data pts</span></td>${yc}</tr>`;
    }).join('');
  document.getElementById('met-wrap').innerHTML=`<div style="overflow-x:auto"><table class="rtbl"><thead><tr>
    <th class="hd-dim">Class</th><th class="hd-dim">Event</th><th class="hd-met">Avg (2000m)</th>
    <th class="hd-dim">2021</th><th class="hd-dim">2022</th><th class="hd-dim">2023</th><th class="hd-dim">2025</th>
  </tr></thead><tbody>${rs}</tbody></table></div>`;
}
// called by startApp()

function renderHRR(q=''){
  q=q.toLowerCase();
  const rs=Object.entries(HRR).filter(([k,d])=>d.label.toLowerCase().includes(q)||d.boatClass.toLowerCase().includes(q))
    .map(([k,d])=>{
      const yc=ALL_YEARS_HRR.map(yr=>{
        const t=d.years[yr];
        return`<td style="font-size:12px">${t?fmtT(t):'—'}</td>`;
      }).join('');
      return`<tr><td>${d.label}</td><td>${d.boatClass}</td>
        <td><strong>${fmtT(d.t2k)}</strong><br><span style="font-size:11px;color:var(--text3)">${d.n}-yr avg</span></td>
        ${yc}</tr>`;
    }).join('');
  document.getElementById('hrr-wrap').innerHTML=`<div style="overflow-x:auto"><table class="rtbl"><thead><tr>
    <th class="hd-dim">Henley event</th><th class="hd-dim">Class</th><th class="hd-hrr">Qual. benchmark (2000m)</th>
    <th class="hd-dim">2021</th><th class="hd-dim">2022</th><th class="hd-dim">2023</th><th class="hd-dim">2024</th><th class="hd-dim">2025</th>
  </tr></thead><tbody>${rs}</tbody></table></div>`;
}
// called by startApp()

function renderHWR(){
  const rs=Object.entries(HWR)
    .map(([k,d])=>{
      const yc=ALL_YEARS_HWR.map(yr=>{
        const t=d.years[yr];
        return`<td style="font-size:12px">${t?fmtT(t):'—'}</td>`;
      }).join('');
      return`<tr><td><strong>${k}</strong></td><td>${d.boatClass}</td><td>${d.label}</td>
        <td><strong>${fmtT(d.t2k)}</strong><br><span style="font-size:11px;color:var(--text3)">${d.n}-yr avg</span></td>
        ${yc}</tr>`;
    }).join('');
  document.getElementById('hwr-wrap').innerHTML=`<div style="overflow-x:auto"><table class="rtbl"><thead><tr>
    <th class="hd-dim">Event</th><th class="hd-dim">Class</th><th class="hd-dim">Description</th><th class="hd-hwr">Avg (2000m equiv.)</th>
    <th class="hd-dim">2022 (1500m)</th><th class="hd-dim">2023 (1500m)</th><th class="hd-dim">2024 (1500m)</th><th class="hd-dim">2025 (1500m)</th>
  </tr></thead><tbody>${rs}</tbody></table></div>`;
}

// ── FETCH BENCHMARKS AND START ────────────────────────────────────────────────
function startApp(){
  if(!document.getElementById('tbl-head'))return; // not on the calculator page
  Object.keys(bench).forEach(applyToggleStyle);
  renderHeader();
  addRow();
  renderWBT();
  renderMET();
  renderHRR();
  renderHWR();
}

// Lazily-loaded club aliases (used by the leaderboards By-Club view).
var _aliasesPromise=null;
function getAliases(){return _aliasesPromise||(_aliasesPromise=fetch('/data/club_aliases.json').then(r=>r.json()));}

// Boot the GMT calculator. Called explicitly by /gmt/ only.
function bootGmt(){
  document.body.classList.add('loading');
  fetch('/data/benchmarks_v3.json?v=1')
    .then(r=>{if(!r.ok)throw new Error(r.status);return r.json();})
    .then(data=>{document.body.classList.remove('loading');buildBenchmarks(data);startApp();})
    .catch(err=>{
      document.body.classList.remove('loading');
      var em=document.getElementById('empty-msg');
      if(em)em.textContent='Could not load benchmark data. Check data/benchmarks_v3.json exists in the repo.';
      console.error('Benchmark fetch failed:',err);
    });
}


function go(name){
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',TABS[i]===name));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
}
const TABS=['calc','benchmarks','about'];
const SECTIONS=['calc','leaderboards','clubs'];
function goSection(name){
  document.querySelectorAll('.sec-tab').forEach((b,i)=>b.classList.toggle('active',SECTIONS[i]===name));
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+name).classList.add('active');
  document.getElementById('sub-calc').style.display=name==='calc'?'':'none';
  document.getElementById('sub-leaderboards').style.display=name==='leaderboards'?'':'none';
  document.getElementById('sub-clubs').style.display=name==='clubs'?'':'none';
  history.replaceState(null,'',name==='calc'?window.location.pathname:'#'+name);
  if(name==='leaderboards'){
    document.querySelectorAll('.lb-grid .lb-card').forEach((card,i)=>{
      card.classList.remove('lb-anim');
      void card.offsetWidth;
      card.style.animationDelay=(0.04+i*0.06)+'s';
      card.classList.add('lb-anim');
    });
  }
  if(name==='clubs')loadClubsSection();
}
function goLbTab(name,btn){
  document.querySelectorAll('.lbtab').forEach(b=>b.classList.toggle('active',b===btn));
  document.querySelectorAll('.lbpanel').forEach(p=>p.classList.toggle('active',p.id==='lbpanel-'+name));
  if(name==='clubs')loadClubAnalysis();
}
// Shared club normalisation helpers
(function(){
  function normClub(n){return(n||'').replace(/`/g,"'").replace(/\s*\/\s*/g,'/').replace(/\s*\([A-Za-z]\)\s*$/,'').replace(/\s+(Rowing Club|Boat Club|RC|BC|ARC)\s*$/i,'').trim();}
  function canonDisplay(n){return normClub(n).replace(/\bUniv\b/g,'University').replace(/\bColl\b/g,'College').replace(/\bSch\b/g,'School').trim();}
  function canon(n){return canonDisplay(n).toLowerCase();}
  var AL={};
  function resolve(n){var d=canonDisplay(n),k=canon(n);if(AL[k]){d=AL[k];k=canon(d);}return{disp:d,key:k};}
  window._clubHelpers={normClub,canonDisplay,canon,resolve,AL};
})();
function _fgVal(p){return p>=87?'#34d399':p>=80?'#60a5fa':p>=72?'#fb923c':'#f87171';}

function loadCached(url){
  var key='rt:'+url;
  var cached=sessionStorage.getItem(key);
  if(cached){try{return Promise.resolve(JSON.parse(cached));}catch(e){sessionStorage.removeItem(key);}}
  var ctl=new AbortController();
  var t=setTimeout(function(){ctl.abort();},10000);
  return fetch(url,{signal:ctl.signal}).then(function(r){clearTimeout(t);if(!r.ok)throw new Error(r.status);return r.json();}).then(function(d){try{sessionStorage.setItem(key,JSON.stringify(d));}catch(e){}return d;});
}
var _clubsLoaded=false;
function loadClubAnalysis(){
  if(_clubsLoaded)return;
  _clubsLoaded=true;
  var el=document.getElementById('lb-clubs-content');
  var resolve=window._clubHelpers.resolve;
  var fgVal=_fgVal;
  function buildClubs(regs){
    var map={};
    regs.forEach(reg=>{
      reg.results.forEach(r=>{
        if(!window._lbcShowComp&&r.club.includes('/'))return;
        var {disp,key}=resolve(r.club);
        if(!key)return;
        if(!map[key])map[key]={disp,entries:0,sumPct:0,bestPct:0,regattas:new Set(),pcts:[]};
        map[key].entries++;map[key].sumPct+=r.pct;map[key].pcts.push(r.pct);
        if(r.pct>map[key].bestPct)map[key].bestPct=r.pct;
        map[key].regattas.add(reg.comp);
      });
    });
    return Object.entries(map).map(([key,c])=>{
      var s=c.pcts.slice().sort((a,b)=>b-a);
      var top10=s.slice(0,10).reduce((a,b)=>a+b,0)/Math.min(10,s.length);
      return{name:c.disp,entries:c.entries,avg:c.sumPct/c.entries,best:c.bestPct,regattas:c.regattas.size,top10avg:top10};
    }).filter(c=>c.entries>=10).sort((a,b)=>b.top10avg-a.top10avg);
  }
  Promise.all([loadCached('/data/all_results.json'),getAliases()])
    .then(([data,aliases])=>{
      Object.assign(window._clubHelpers.AL,aliases);
      var byYear={};
      data.forEach(reg=>{
        var y='20'+reg.comp.slice(-2);
        if(!byYear[y])byYear[y]=[];
        byYear[y].push(reg);
      });
      var years=Object.keys(byYear).sort((a,b)=>b-a);
      var tabHtml='<div class="lbtab-wrap" style="margin-bottom:1.5rem">'
        +'<button class="lbtab active" onclick="filterLbYear(\'all\',this)">All years</button>';
      years.forEach(y=>{tabHtml+='<button class="lbtab" onclick="filterLbYear(\''+y+'\',this)">'+y+'</button>';});
      tabHtml+='</div>';
      var controls='<div style="margin-bottom:1.25rem;display:flex;align-items:center;gap:16px;flex-wrap:wrap">'
        +'<input type="text" id="lb-clubs-search" placeholder="Search clubs&#8230;" oninput="filterLbClubs()" style="max-width:360px;margin:0">'
        +'<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text3);cursor:pointer"><input type="checkbox" id="lbc-show-comp" '+(window._lbcShowComp?'checked':'')+' onchange="lbcToggleComp(this.checked)" style="width:auto;margin:0">Include composite crews</label>'
        +'</div>';
      el.innerHTML=tabHtml+controls+'<div id="lbc-sections"></div>';
      window._renderLbcSections=function(){
        // "All years" is a single combined leaderboard aggregating every regatta;
        // each year tab shows that year's own leaderboard.
        var sections=[['all','All years',data]];
        years.forEach(function(year){sections.push([year,year,byYear[year]]);});
        var h='';
        sections.forEach(function(sec){
          var key=sec[0],label=sec[1],clubs=buildClubs(sec[2]);
          h+='<div data-year="'+key+'" style="margin-bottom:2rem"><div class="lb-year">'+label+'</div>'
            +'<div class="tbl-wrap" style="margin-top:0.75rem"><table class="tbl"><thead><tr>'
            +'<th>#</th><th>Club</th><th>Regattas</th><th>Entries</th><th>Top 10 Avg</th><th>Avg GMT%</th><th>Best</th>'
            +'</tr></thead><tbody class="lb-clubs-tbody">';
          clubs.forEach((c,i)=>{
            var f=fgVal(c.top10avg);
            h+='<tr data-n="'+c.name.toLowerCase()+'">'
              +'<td data-label="#" style="color:var(--text3)">'+(i+1)+'</td>'
              +'<td data-label="Club"><a href="/clubs/?club='+encodeURIComponent(c.name)+'" style="color:var(--text);text-decoration:none;font-weight:600" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">'+c.name+'</a></td>'
              +'<td data-label="Regattas" style="color:var(--text2)">'+c.regattas+'</td>'
              +'<td data-label="Entries" style="color:var(--text2)">'+c.entries+'</td>'
              +'<td data-label="Top 10 Avg"><strong style="color:'+f+'">'+c.top10avg.toFixed(1)+'%</strong></td>'
              +'<td data-label="Avg GMT%" style="color:var(--text3)">'+c.avg.toFixed(1)+'%</td>'
              +'<td data-label="Best" style="color:var(--text2)">'+c.best.toFixed(1)+'%</td>'
              +'</tr>';
          });
          h+='</tbody></table></div></div>';
        });
        document.getElementById('lbc-sections').innerHTML=h;
        var y=window._lbcYear||'all';
        document.querySelectorAll('#lbc-sections [data-year]').forEach(s=>{s.style.display=(s.dataset.year===y)?'':'none';});
        filterLbClubs();
      };
      window._renderLbcSections();
    })
    .catch(()=>{el.innerHTML='<p style="color:var(--text3)">Failed to load data. <a href="#" onclick="this.parentElement.parentElement.innerHTML=\'Loading&#8230;\';_clubsLoaded=false;loadClubAnalysis();return false">Try again</a></p>';_clubsLoaded=false;});
}
window.filterLbClubs=function(){
  var q=(document.getElementById('lb-clubs-search').value||'').toLowerCase().trim();
  document.querySelectorAll('.lb-clubs-tbody tr').forEach(r=>r.style.display=(!q||r.dataset.n.includes(q))?'':'none');
};
window.filterLbYear=function(year,btn){
  window._lbcYear=year;
  document.querySelectorAll('#lb-clubs-content .lbtab').forEach(b=>b.classList.toggle('active',b===btn));
  document.querySelectorAll('#lb-clubs-content [data-year]').forEach(s=>s.style.display=(s.dataset.year===year)?'':'none');
};
window.lbcToggleComp=function(on){window._lbcShowComp=on;if(window._renderLbcSections)window._renderLbcSections();};
var _clubsSectionLoaded=false;
function loadClubsSection(){
  if(_clubsSectionLoaded)return;
  _clubsSectionLoaded=true;
  var el=document.getElementById('sec-clubs-content');
  var resolve=window._clubHelpers.resolve;
  Promise.all([loadCached('/data/all_results.json'),getAliases()])
    .then(([data,aliases])=>{
      Object.assign(window._clubHelpers.AL,aliases);
      var map={};
      data.forEach(reg=>{
        reg.results.forEach(r=>{
          if(r.club.includes('/'))return;
          var{disp,key}=resolve(r.club);
          if(!key)return;
          if(!map[key])map[key]={disp,entries:0,bestPct:0,regattas:new Set()};
          map[key].entries++;
          if(r.pct>map[key].bestPct)map[key].bestPct=r.pct;
          map[key].regattas.add(reg.comp);
        });
      });
      var clubs=Object.entries(map).map(([key,c])=>{
        return{name:c.disp,entries:c.entries,bestPct:c.bestPct,regattas:c.regattas.size};
      }).sort((a,b)=>a.name.localeCompare(b.name));
      var cards='';
      clubs.forEach(c=>{
        cards+='<a class="lb-clubs-card" href="/clubs/?club='+encodeURIComponent(c.name)+'" data-n="'+c.name.toLowerCase()+'">'
          +'<div style="font-weight:600;font-size:14px;margin-bottom:3px">'+c.name+'</div>'
          +'<div style="font-size:12px;color:var(--text3)">'+c.regattas+' '+(c.regattas===1?'regatta':'regattas')+'&nbsp;&nbsp;&middot;&nbsp;&nbsp;best '+c.bestPct.toFixed(1)+'%</div>'
          +'</a>';
      });
      el.innerHTML=
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:1.25rem">'
        +'<input type="text" id="clubs-sec-search" placeholder="Search clubs&#8230;" oninput="filterClubsSec()" style="max-width:360px">'
        +'<span style="font-size:13px;color:var(--text3)">'+clubs.length+' clubs</span>'
        +'</div>'
        +'<div id="clubs-sec-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">'+cards+'</div>';
    })
    .catch(()=>{el.innerHTML='<p style="color:var(--text3)">Failed to load data. <a href="#" onclick="this.parentElement.parentElement.innerHTML=\'Loading&#8230;\';_clubsSectionLoaded=false;loadClubsSection();return false">Try again</a></p>';_clubsSectionLoaded=false;});
}
window.filterClubsSec=function(){
  var q=(document.getElementById('clubs-sec-search').value||'').toLowerCase().trim();
  document.querySelectorAll('#clubs-sec-grid a').forEach(c=>c.style.display=(!q||c.dataset.n.includes(q))?'':'none');
};
const BTABS=['wbt','met','hrr','hwr'];
function gob(name){
  document.querySelectorAll('.btab').forEach((t,i)=>t.classList.toggle('active',BTABS[i]===name));
  document.querySelectorAll('.bpanel').forEach(p=>p.classList.remove('active'));
  document.getElementById('bpanel-'+name).classList.add('active');
}

// ── EMAIL SUBSCRIBE (shared across all pages) ─────────────────────────────────
(function(){
  var form=document.getElementById('sib-form');
  if(!form)return;
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var btn=form.querySelector('button[type=submit]');
    btn.disabled=true;
    btn.textContent='Submitting…';
    fetch(form.action,{method:'POST',mode:'no-cors',body:new FormData(form)})
      .then(function(){
        document.getElementById('success-message').style.display='block';
        document.getElementById('sib-container').style.display='none';
      })
      .catch(function(){
        document.getElementById('error-message').style.display='block';
        btn.disabled=false;
        btn.textContent='Notify me';
      });
  });
})();
