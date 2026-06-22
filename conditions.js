/* conditions.js - shared "race conditions" widget for RowingTools heatmaps.
   Self-contained: injects its own CSS + modal, then exposes wxOpen(clock,label,boat).
   Needs window.META = {venue:{name,lat,lon,bearing,lanes}, date:"YYYY-MM-DD"} on the
   page, and a button per race that calls wxOpen(...). Weather is fetched live from the
   Open-Meteo historical archive (no API key). */
(function(){
  if(!window.META||!window.META.venue) return;   // page didn't opt in

  /* ---- inject CSS ---- */
  const css=`
.wx-overlay{position:fixed;inset:0;background:rgba(5,5,5,.72);backdrop-filter:blur(6px);z-index:1000;display:none;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .2s}
.wx-overlay.show{display:flex;opacity:1}
.wx-modal{background:linear-gradient(180deg,#16181c,#101012);border:1px solid rgba(255,255,255,.14);border-radius:20px;width:100%;max-width:820px;max-height:92vh;overflow:auto;box-shadow:0 40px 100px rgba(0,0,0,.6);transform:translateY(10px) scale(.98);transition:transform .25s ease;color:#f0f0ee;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.wx-overlay.show .wx-modal{transform:none}
.wx-hdr{display:flex;align-items:flex-start;justify-content:space-between;padding:18px 22px 12px;gap:12px}
.wx-hdr .t{font-weight:700;font-size:15px}
.wx-hdr .s{font-size:11px;color:#6b7280;margin-top:2px}
.wx-close{background:#252523;border:1px solid rgba(255,255,255,.07);color:#9ca3af;width:30px;height:30px;border-radius:50%;font-size:16px;cursor:pointer;flex-shrink:0;line-height:1}
.wx-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:0}
@media(max-width:680px){.wx-grid{grid-template-columns:1fr}}
.wx-stage{position:relative;padding:8px 0 14px}
.wx-wrap{position:relative;width:100%;aspect-ratio:16/10}
.wx-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.wx-svg{position:absolute;inset:0;width:100%;height:100%}
.wx-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#6b7280}
.wx-rail{padding:8px 22px 20px;border-left:1px solid rgba(255,255,255,.07)}
@media(max-width:680px){.wx-rail{border-left:none;border-top:1px solid rgba(255,255,255,.07)}}
.wx-temprow{display:flex;align-items:center;gap:14px;margin-bottom:6px}
.wx-temp{font-family:'Fraunces',serif;font-weight:900;font-size:46px;line-height:1;letter-spacing:-2px}
.wx-temp span{font-size:20px;color:#6b7280;font-family:'Inter';font-weight:600}
.wx-icon{font-size:34px;line-height:1}
.wx-cond{font-size:12px;color:#9ca3af;font-weight:600;margin-bottom:16px}
.wx-verdict{border-radius:12px;padding:12px 14px;margin-bottom:14px;border:1px solid rgba(255,255,255,.07)}
.wx-verdict .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:3px}
.wx-verdict .big{font-weight:700;font-size:16px}
.wx-verdict .desc{font-size:11px;color:#9ca3af;margin-top:3px;line-height:1.5}
.wx-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.wx-stat{background:#1a1a18;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:9px 11px}
.wx-stat .k{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280}
.wx-stat .v{font-size:15px;font-weight:700;margin-top:2px}
.wx-stat .v small{font-size:11px;color:#6b7280;font-weight:500}
.wx-srcline{font-size:10px;color:#6b7280;margin-top:14px}
.wx-srcline a{color:#6b7280}
.wx-mini{margin-top:5px;display:inline-flex;align-items:center;gap:5px;background:rgba(200,71,43,0.16);border:1px solid rgba(200,71,43,0.55);color:#ef8268;padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:.02em;transition:all .15s;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25)}
.wx-mini:hover{background:#c8472b;color:#fff;border-color:#c8472b;transform:translateY(-1px)}
.wx-mini svg{flex-shrink:0}
.wx-banner{display:flex;align-items:center;gap:11px;background:linear-gradient(90deg,rgba(200,71,43,0.14),rgba(200,71,43,0.03));border:1px solid rgba(200,71,43,0.35);border-radius:12px;padding:11px 15px;margin-bottom:16px;font-size:12.5px;color:#d9d9d6;line-height:1.45}
.wx-banner svg{flex-shrink:0;color:#ef8268}
.wx-banner b{color:#f0f0ee;font-weight:700}`;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  /* ---- inject modal ---- */
  const modal=document.createElement('div');
  modal.className='wx-overlay';modal.id='wx-overlay';
  modal.innerHTML=`<div class="wx-modal" role="dialog" aria-modal="true">
    <div class="wx-hdr"><div><div class="t" id="wx-title">Race</div><div class="s" id="wx-sub"></div></div>
      <button class="wx-close" aria-label="Close">&times;</button></div>
    <div class="wx-grid">
      <div class="wx-stage"><div class="wx-wrap">
        <canvas class="wx-canvas" id="wx-canvas"></canvas>
        <svg class="wx-svg" id="wx-svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet"></svg>
        <div class="wx-loading" id="wx-loading">Loading conditions&hellip;</div>
      </div></div>
      <div class="wx-rail" id="wx-railbox" style="visibility:hidden">
        <div class="wx-temprow"><div class="wx-temp" id="wx-temp">--<span>&deg;C</span></div><div class="wx-icon" id="wx-iconel">&#9728;</div></div>
        <div class="wx-cond" id="wx-condel">&nbsp;</div>
        <div class="wx-verdict" id="wx-verdict"><div class="lbl">Effect on the course</div><div class="big" id="wx-vbig">&mdash;</div><div class="desc" id="wx-vdesc"></div></div>
        <div class="wx-stats">
          <div class="wx-stat"><div class="k">Wind speed</div><div class="v" id="wx-wspd">&mdash;</div></div>
          <div class="wx-stat"><div class="k">Gusts</div><div class="v" id="wx-wgust">&mdash;</div></div>
          <div class="wx-stat"><div class="k">Wind from</div><div class="v" id="wx-wdir">&mdash;</div></div>
          <div class="wx-stat"><div class="k">Humidity</div><div class="v" id="wx-hum">&mdash;</div></div>
        </div>
        <div class="wx-srcline" id="wx-srcel"></div>
      </div>
    </div></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target===modal)wxClose();});
  modal.querySelector('.wx-close').addEventListener('click',wxClose);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')wxClose();});

  /* ---- helpers ---- */
  const COMPASS=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  const toCompass=d=>COMPASS[Math.round(((d%360)/22.5))%16];
  function wmo(code){const m={0:["☀️","Clear"],1:["🌤️","Mainly clear"],2:["⛅","Partly cloudy"],3:["☁️","Overcast"],45:["🌫️","Fog"],48:["🌫️","Rime fog"],51:["🌦️","Light drizzle"],53:["🌦️","Drizzle"],55:["🌧️","Heavy drizzle"],61:["🌦️","Light rain"],63:["🌧️","Rain"],65:["🌧️","Heavy rain"],71:["🌨️","Light snow"],73:["🌨️","Snow"],75:["❄️","Heavy snow"],80:["🌦️","Showers"],81:["🌧️","Showers"],82:["⛈️","Violent showers"],95:["⛈️","Thunderstorm"],96:["⛈️","Thunderstorm"],99:["⛈️","Thunderstorm"]};return m[code]||["🌤️","Fair"];}

  let wxAnim=null,wxBoatClass='';
  window.wxOpen=async function(clock,label,boat,date){
    const v=window.META.venue;wxBoatClass=boat||'';
    const d=date||window.META.date;   // per-race date (multi-day events) falls back to META.date
    document.getElementById('wx-title').textContent=label;
    document.getElementById('wx-sub').textContent=`${v.name} · ${d} · ${clock}`;
    document.getElementById('wx-railbox').style.visibility='hidden';
    document.getElementById('wx-loading').style.display='flex';
    document.getElementById('wx-loading').textContent='Loading conditions…';
    document.getElementById('wx-overlay').classList.add('show');
    let wx;
    try{wx=await wxFetch(v,d,clock);}catch(e){wx=null;}
    if(!wx){document.getElementById('wx-loading').textContent='Conditions unavailable.';return;}
    wxRender(v,wx);
  };
  async function wxFetch(v,date,clock){
    const [hh,mm]=clock.split(':').map(Number);
    const hour=Math.min(23,hh+(mm>=30?1:0));
    const url=`https://archive-api.open-meteo.com/v1/archive?latitude=${v.lat}&longitude=${v.lon}`+
      `&start_date=${date}&end_date=${date}`+
      `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code`+
      `&wind_speed_unit=kmh&timezone=Europe%2FLondon`;
    const res=await fetch(url);if(!res.ok)throw new Error('fetch');
    const h=(await res.json()).hourly;const i=Math.max(0,Math.min(h.time.length-1,hour));
    return {temp:Math.round(h.temperature_2m[i]),hum:Math.round(h.relative_humidity_2m[i]),
      wspd:Math.round(h.wind_speed_10m[i]),wgust:Math.round(h.wind_gusts_10m[i]),
      wdir:Math.round(h.wind_direction_10m[i]),code:h.weather_code[i]};
  }
  function wxVsCourse(windFrom,bearing){
    const windTo=(windFrom+180)%360;let delta=((windTo-bearing+540)%360)-180;const a=Math.abs(delta);
    let label,desc;
    if(a<=25){label="Tailwind";desc="Blowing down the course toward the finish – expect fast times.";}
    else if(a>=155){label="Headwind";desc="Blowing straight into the boats – times will run slow.";}
    else if(a<90){label="Cross-tail wind";desc="Angled down the course – a mild helping effect, with some push across the lanes.";}
    else{label="Cross-head wind";desc="Angled into the boats – a mild slowing effect, with some push across the lanes.";}
    return {delta,label,desc};
  }
  function wxTone(k){return k<8?"rgba(78,232,176,.10)":k<18?"rgba(123,191,255,.10)":k<30?"rgba(240,176,48,.12)":"rgba(200,71,43,.14)";}
  function wxRender(v,wx){
    document.getElementById('wx-loading').style.display='none';
    const [icon,text]=wmo(wx.code);
    document.getElementById('wx-temp').innerHTML=`${wx.temp}<span>&deg;C</span>`;
    document.getElementById('wx-iconel').textContent=icon;
    document.getElementById('wx-condel').textContent=text;
    document.getElementById('wx-wspd').innerHTML=`${wx.wspd} <small>km/h</small>`;
    document.getElementById('wx-wgust').innerHTML=`${wx.wgust} <small>km/h</small>`;
    document.getElementById('wx-wdir').innerHTML=`${toCompass(wx.wdir)} <small>${wx.wdir}&deg;</small>`;
    document.getElementById('wx-hum').innerHTML=`${wx.hum} <small>%</small>`;
    const vc=wxVsCourse(wx.wdir,v.bearing);
    document.getElementById('wx-verdict').style.background=wxTone(wx.wspd);
    document.getElementById('wx-vbig').textContent=vc.label;
    document.getElementById('wx-vdesc').textContent=vc.desc;
    document.getElementById('wx-srcel').innerHTML='Source: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> historical archive.';
    document.getElementById('wx-railbox').style.visibility='visible';
    wxDrawCourse(v,wx);wxStartWind(v.bearing,wx.wdir,wx.wspd);
  }
  function wxDrawCourse(v,wx){
    const svg=document.getElementById('wx-svg'),cx=160,cy=100;
    const L=150,W=Math.max(44,Math.min(70,v.lanes*8)),laneW=W/v.lanes;
    const rad=d=>d*Math.PI/180;
    const proj=(lx,ly)=>{const c=Math.cos(rad(v.bearing)),s=Math.sin(rad(v.bearing));return [cx+lx*c-ly*s, cy+lx*s+ly*c];};
    let lanes='';for(let i=0;i<=v.lanes;i++){const x=-W/2+i*laneW;const[a,b]=proj(x,-L/2),[c,d]=proj(x,L/2);lanes+=`<line x1="${a.toFixed(1)}" y1="${b.toFixed(1)}" x2="${c.toFixed(1)}" y2="${d.toFixed(1)}" stroke="rgba(255,255,255,.10)" stroke-width="1"/>`;}
    let buoys='';for(let i=0;i<=v.lanes;i++){const x=-W/2+i*laneW;for(let ly=-L/2+6;ly<=L/2-6;ly+=22){const[bx,by]=proj(x,ly);buoys+=`<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="1.3" fill="rgba(255,255,255,.22)"/>`;}}
    const cor=[proj(-W/2,-L/2),proj(W/2,-L/2),proj(W/2,L/2),proj(-W/2,L/2)].map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
    const fs1=proj(-W/2,-L/2),fs2=proj(W/2,-L/2),ss1=proj(-W/2,L/2),ss2=proj(W/2,L/2);
    const fLab=proj(0,-L/2-14),sLab=proj(0,L/2+14);
    const sf=`<line x1="${fs1[0].toFixed(1)}" y1="${fs1[1].toFixed(1)}" x2="${fs2[0].toFixed(1)}" y2="${fs2[1].toFixed(1)}" stroke="rgba(123,191,255,.55)" stroke-width="1.5"/>`+
      `<line x1="${ss1[0].toFixed(1)}" y1="${ss1[1].toFixed(1)}" x2="${ss2[0].toFixed(1)}" y2="${ss2[1].toFixed(1)}" stroke="rgba(255,255,255,.18)" stroke-width="1.5"/>`+
      `<text x="${fLab[0].toFixed(1)}" y="${fLab[1].toFixed(1)}" text-anchor="middle" font-size="8" fill="#9ca3af" letter-spacing="1">FINISH</text>`+
      `<text x="${sLab[0].toFixed(1)}" y="${sLab[1].toFixed(1)}" text-anchor="middle" font-size="8" fill="#6b7280" letter-spacing="1">START</text>`;
    const bd=wxBoatSVG(wxBoatClass);
    const startY=(L/2-bd.HH-2).toFixed(1),endY=(-(L/2-bd.HH-2)).toFixed(1);
    const boat=`<g transform="translate(${cx},${cy}) rotate(${v.bearing})"><g id="wx-boat">${bd.svg}</g></g>`;
    const windTo=(wx.wdir+180)%360;
    const compass=`<g transform="translate(286,40)"><circle r="26" fill="rgba(0,0,0,.4)" stroke="rgba(255,255,255,.14)"/><text x="0" y="-17" text-anchor="middle" font-size="8" fill="#9ca3af" font-weight="700">N</text><line x1="0" y1="11" x2="0" y2="-11" stroke="rgba(255,255,255,.14)" stroke-width="1"/><g transform="rotate(${windTo})"><line x1="0" y1="13" x2="0" y2="-11" stroke="#7bbfff" stroke-width="2.4"/><path d="M0,-15 l-5,8 l10,0 Z" fill="#7bbfff"/></g></g>`;
    svg.innerHTML=`<defs><linearGradient id="wx-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d2438"/><stop offset="1" stop-color="#0a1a28"/></linearGradient></defs><polygon points="${cor}" fill="url(#wx-water)"/>${lanes}${buoys}${sf}${boat}${compass}<style>.wx-oar{stroke:#c8472b;stroke-width:1.4;stroke-linecap:round}#wx-boat{animation:wxRow 5s linear infinite}#wx-oars{animation:wxStroke 1.1s ease-in-out infinite}@keyframes wxRow{0%{transform:translateY(${startY}px);opacity:0}6%{opacity:1}80%{transform:translateY(${endY}px);opacity:1}90%{transform:translateY(${endY}px);opacity:0}100%{transform:translateY(${startY}px);opacity:0}}@keyframes wxStroke{0%,100%{opacity:.95}50%{opacity:.45}}</style>`;
  }
  function wxBoatSVG(boat){
    const seats=parseInt((String(boat).match(/\d+/)||['1'])[0],10);
    const scull=/x/i.test(boat),cox=/\+/.test(boat);
    const HH=Math.min(34,seats*3.4+7),span=HH-7;
    let oars='',seatsM='';
    for(let i=0;i<seats;i++){
      const y=seats>1?(span-i*(2*span/(seats-1))):0;
      seatsM+=`<circle cx="0" cy="${y.toFixed(1)}" r="1.2" fill="#c8472b"/>`;
      const sides=scull?[-1,1]:[(i%2===0?-1:1)];
      for(const sgn of sides){
        oars+=`<line class="wx-oar" x1="${sgn*2}" y1="${y.toFixed(1)}" x2="${sgn*13}" y2="${(y+3).toFixed(1)}"/>`+
              `<ellipse cx="${sgn*14}" cy="${(y+3.5).toFixed(1)}" rx="2" ry="3" fill="#c8472b" opacity="0.85"/>`;
      }
    }
    const coxM=cox?`<circle cx="0" cy="${(HH-3).toFixed(1)}" r="1.8" fill="#9ca3af"/>`:'';
    const w=Math.max(2.6,HH*0.12);
    const hull=`<path d="M0,${-HH} C${w},${-HH*0.55} ${w},${HH*0.55} 0,${HH} C${-w},${HH*0.55} ${-w},${-HH*0.55} 0,${-HH} Z" fill="#e8e4dc" stroke="#0f0f0e" stroke-width="1"/>`;
    return {svg:`<g id="wx-oars">${oars}</g>${hull}${seatsM}${coxM}`,HH};
  }
  let wxParticles=[],wxDX=0,wxDY=1,wxSpd=0;
  function wxStartWind(bearing,windFrom,spd){
    const windTo=(windFrom+180)*Math.PI/180;
    wxDX=Math.sin(windTo);wxDY=-Math.cos(windTo);wxSpd=Math.max(0.3,spd/14);
    const cv=document.getElementById('wx-canvas'),wrap=cv.parentElement;
    cv.width=wrap.clientWidth;cv.height=wrap.clientHeight;
    wxParticles=Array.from({length:Math.min(70,18+spd*2)},()=>wxSpawn(cv));
    if(wxAnim)cancelAnimationFrame(wxAnim);wxLoop();
  }
  function wxSpawn(cv){return {x:Math.random()*cv.width,y:Math.random()*cv.height,len:6+Math.random()*14,life:0,max:60+Math.random()*60};}
  function wxLoop(){
    const cv=document.getElementById('wx-canvas');
    if(!document.getElementById('wx-overlay').classList.contains('show'))return;
    const ctx=cv.getContext('2d');ctx.clearRect(0,0,cv.width,cv.height);
    const dx=wxDX,dy=wxDY,step=wxSpd*1.6;
    ctx.strokeStyle='rgba(123,191,255,0.28)';ctx.lineWidth=1;
    for(const p of wxParticles){
      ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-dx*p.len,p.y-dy*p.len);ctx.stroke();
      p.x+=dx*step;p.y+=dy*step;p.life++;
      if(p.life>p.max||p.x<-20||p.x>cv.width+20||p.y<-20||p.y>cv.height+20){
        Object.assign(p,wxSpawn(cv));
        if(dx>0)p.x=-10;else if(dx<0)p.x=cv.width+10;
        if(dy>0)p.y=-10;else if(dy<0)p.y=cv.height+10;
      }
    }
    wxAnim=requestAnimationFrame(wxLoop);
  }
  function wxClose(){document.getElementById('wx-overlay').classList.remove('show');if(wxAnim)cancelAnimationFrame(wxAnim);}

  /* ---- auto-inject a conditions button into every heatmap round cell ----
     Matches each rendered round cell (event from the table caption + round label)
     back to window.ROWS to find the race's clock time and boat class. Re-runs on
     re-render (filter/tab switch) via a MutationObserver. No template edits needed. */
  function injectButtons(){
    if(!window.ROWS) return;
    const map={};
    for(const r of window.ROWS) if(r.clock) map[r.event+'||'+r.round]={clock:r.clock,boat:r.boat||'',date:r.date||''};
    document.querySelectorAll('#heatmap-out td.rnd').forEach(cell=>{
      if(cell.querySelector('.wx-mini')) return;
      const round=cell.textContent.trim();
      const tbl=cell.closest('table');if(!tbl) return;
      const cap=tbl.querySelector('caption');const event=cap?cap.textContent.trim():'';
      const hit=map[event+'||'+round];if(!hit) return;
      const b=document.createElement('button');
      b.className='wx-mini';b.title='Weather & wind at race time';
      b.dataset.clock=hit.clock;b.dataset.label=event+' · '+round;b.dataset.boat=hit.boat;b.dataset.date=hit.date;
      b.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2"/><path d="M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2"/><path d="M12.59 19.41A2 2 0 1 0 14 16H2"/></svg>'+hit.clock;
      cell.appendChild(b);
    });
  }
  document.addEventListener('click',e=>{const b=e.target.closest('.wx-mini');if(b)window.wxOpen(b.dataset.clock,b.dataset.label,b.dataset.boat,b.dataset.date);});
  function ensureBanner(o){
    if(document.querySelector('.wx-banner')||!window.ROWS||!window.ROWS.some(r=>r.clock)) return;
    const div=document.createElement('div');div.className='wx-banner';
    div.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2"/><path d="M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2"/><path d="M12.59 19.41A2 2 0 1 0 14 16H2"/></svg><span><b>New &middot; Race conditions.</b> Tap the orange time chip on any race to replay the wind, water and weather on the day &ndash; and see whether it was a head, tail or cross wind down the course.</span>';
    o.parentNode.insertBefore(div,o);
  }
  function startObserve(){
    const o=document.getElementById('heatmap-out');if(!o){setTimeout(startObserve,200);return;}
    ensureBanner(o);injectButtons();
    new MutationObserver(()=>injectButtons()).observe(o,{childList:true,subtree:true});
  }
  if(document.readyState!=='loading')startObserve();else document.addEventListener('DOMContentLoaded',startObserve);
})();
