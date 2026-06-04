(function(){
  function normClub(n){return(n||'').replace(/\s*\([A-Za-z]\)\s*$/,'').trim();}

  window.shareResult=function(btn){
    function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
    var club=btn.dataset.club,event=btn.dataset.event,round=btn.dataset.round,
        time=btn.dataset.time,pct=parseFloat(btn.dataset.pct),
        rank=parseInt(btn.dataset.rank||0),total=parseInt(btn.dataset.total||0);
    var dc=normClub(club);
    var col=pct>=87?'#34d399':pct>=80?'#60a5fa':pct>=72?'#fb923c':'#f87171';
    var tier=pct>=87?'Elite':pct>=80?'High Club':pct>=72?'Competitive':'Developing';
    var regatta=(document.title||'').replace(/\s*Results\b.*/i,'').trim();
    var cl=dc.length>34?dc.substring(0,33)+'…':dc;
    var W=600,H=300;
    var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'">'
      +'<rect width="'+W+'" height="'+H+'" fill="#0f0f0e"/>'
      +'<rect width="'+W+'" height="4" fill="#c8472b"/>'
      +'<text x="24" y="36" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13" font-weight="700" fill="#c8472b">rowingtools.co.uk</text>'
      +'<text x="'+(W-24)+'" y="36" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="12" fill="#4b5563" text-anchor="end">'+esc(regatta)+'</text>'
      +'<line x1="24" y1="50" x2="'+(W-24)+'" y2="50" stroke="#1c1c1c" stroke-width="1"/>'
      +'<text x="24" y="106" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="28" font-weight="700" fill="#f0f0ee">'+esc(cl)+'</text>'
      +'<text x="24" y="134" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="14" fill="#9ca3af">'+esc(event)+' · '+esc(round)+'</text>'
      +'<text x="24" y="200" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="22" fill="#6b7280">'+esc(time)+'</text>'
      +(rank&&total?'<text x="24" y="224" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13" fill="#4b5563">#'+rank+' of '+total+' overall</text>':'')
      +'<text x="'+(W-24)+'" y="196" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="64" font-weight="800" fill="'+col+'" text-anchor="end">'+pct.toFixed(1)+'%</text>'
      +'<text x="'+(W-24)+'" y="222" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13" fill="'+col+'" text-anchor="end" opacity="0.8">'+tier+'</text>'
      +'<line x1="24" y1="244" x2="'+(W-24)+'" y2="244" stroke="#1c1c1c" stroke-width="1"/>'
      +'<text x="24" y="270" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="12" fill="#4b5563">GMT% = World Best Time ÷ your time × 100</text>'
      +'</svg>';
    var blob=new Blob([svg],{type:'image/svg+xml'});
    var url=URL.createObjectURL(blob);
    var img=new Image();
    img.onload=function(){
      var c=document.createElement('canvas');
      c.width=W*2;c.height=H*2;
      var ctx=c.getContext('2d');ctx.scale(2,2);ctx.drawImage(img,0,0);
      c.toBlob(function(b){
        var a=document.createElement('a');
        a.href=URL.createObjectURL(b);
        a.download='result-'+dc.replace(/[^a-z0-9]/gi,'-').toLowerCase()+'.png';
        a.click();
      },'image/png');
      URL.revokeObjectURL(url);
    };
    img.src=url;
  };

  window.shareClub=function(btn){
    function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
    var club=btn.dataset.club,rank=parseInt(btn.dataset.rank),total=parseInt(btn.dataset.total),
        top3=parseFloat(btn.dataset.top3),avg=parseFloat(btn.dataset.avg),
        best=parseFloat(btn.dataset.best),entries=parseInt(btn.dataset.entries);
    var col=top3>=87?'#34d399':top3>=80?'#60a5fa':top3>=72?'#fb923c':'#f87171';
    var regatta=(document.title||'').replace(/\s*Results\b.*/i,'').trim();
    var cl=club.length>34?club.substring(0,33)+'…':club;
    var W=600,H=300;
    var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'">'
      +'<rect width="'+W+'" height="'+H+'" fill="#0f0f0e"/>'
      +'<rect width="'+W+'" height="4" fill="#c8472b"/>'
      +'<text x="24" y="36" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13" font-weight="700" fill="#c8472b">rowingtools.co.uk</text>'
      +'<text x="'+(W-24)+'" y="36" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="12" fill="#4b5563" text-anchor="end">'+esc(regatta)+'</text>'
      +'<line x1="24" y1="50" x2="'+(W-24)+'" y2="50" stroke="#1c1c1c" stroke-width="1"/>'
      +'<text x="24" y="102" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="28" font-weight="700" fill="#f0f0ee">'+esc(cl)+'</text>'
      +'<text x="24" y="124" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13" fill="#4b5563">Club Leaderboard · #'+rank+' of '+total+' clubs</text>'
      +'<text x="24" y="176" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="14" fill="#9ca3af">Top 3 avg GMT%</text>'
      +'<text x="'+(W-24)+'" y="196" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="64" font-weight="800" fill="'+col+'" text-anchor="end">'+top3.toFixed(1)+'%</text>'
      +'<text x="24" y="212" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13" fill="#4b5563">Avg '+avg.toFixed(1)+'%  ·  Best '+best.toFixed(1)+'%  ·  '+entries+' entries</text>'
      +'<line x1="24" y1="244" x2="'+(W-24)+'" y2="244" stroke="#1c1c1c" stroke-width="1"/>'
      +'<text x="24" y="270" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="12" fill="#4b5563">GMT% = World Best Time ÷ your time × 100</text>'
      +'</svg>';
    var blob=new Blob([svg],{type:'image/svg+xml'});
    var url=URL.createObjectURL(blob);
    var img=new Image();
    img.onload=function(){
      var c=document.createElement('canvas');
      c.width=W*2;c.height=H*2;
      var ctx=c.getContext('2d');ctx.scale(2,2);ctx.drawImage(img,0,0);
      c.toBlob(function(b){
        var a=document.createElement('a');
        a.href=URL.createObjectURL(b);
        a.download='club-'+club.replace(/[^a-z0-9]/gi,'-').toLowerCase()+'.png';
        a.click();
      },'image/png');
      URL.revokeObjectURL(url);
    };
    img.src=url;
  };

  // Auto-apply ?club= URL param to Top 250 filter
  var club=new URLSearchParams(window.location.search).get('club');
  if(club){
    var input=document.getElementById('lb-club-filter');
    if(input){
      input.value=club;
      var tabs=document.querySelectorAll('.tab');
      for(var i=0;i<tabs.length;i++){
        if((tabs[i].getAttribute('onclick')||'').includes('top100')){tabs[i].click();break;}
      }
    }
  }
})();
