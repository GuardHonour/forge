/* Build a standalone preview page showing all 48 technique demos animating at once.
   It reuses the app's own engine (ANIMS / drawFigure / loadFor / CYCLE), so what you
   see is exactly what the Library draws — not a redrawing of it.
   node _preview_demos.cjs [out.html] */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const out = process.argv[2] || 'FORGE-demo-preview.html';

const probe = `
<script>
window.addEventListener('load', function(){
  setTimeout(function(){
    var groups=[], byG={};
    EXS.forEach(function(e){ (byG[e.g]=byG[e.g]||[]).push(e); });
    Object.keys(byG).forEach(function(g){ groups.push([g,byG[g]]); });

    var cells=[];
    function cell(e){
      var d=DEMOS[e.id];
      if(!d) return '<div style="padding:10px;color:#f88">no demo: '+e.id+'</div>';
      var i=cells.length; cells.push({id:e.id,d:d});
      return '<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:9px">'
        + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1px">'
          + '<span style="font:700 13px Archivo,system-ui;color:var(--ink)">'+e.n+'</span>'
          + '<span style="font:600 9px Archivo,system-ui;color:var(--dim);letter-spacing:.06em">'+e.cat+'</span>'
        + '</div>'
        + '<div style="font:600 9.5px Archivo,system-ui;color:var(--dim);letter-spacing:.05em;margin-bottom:6px">'
          + d.ph[0]+' &rarr; '+d.ph[1]+'</div>'
        + '<svg id="sv'+i+'" viewBox="0 0 200 200" width="100%" style="display:block;background:color-mix(in srgb,var(--card3) 55%,transparent);border-radius:9px">'
          + '<g id="g'+i+'"></g></svg>'
        + '<div style="height:5px;background:var(--card3);border-radius:99px;overflow:hidden;margin-top:6px">'
          + '<i id="b'+i+'" style="display:block;height:100%;width:0%;background:var(--volt)"></i></div>'
        + '<div id="p'+i+'" style="font:800 9px Archivo,system-ui;color:var(--volt);letter-spacing:.1em;margin-top:4px;text-align:center">'+d.ph[0]+'</div>'
        + '</div>';
    }

    var html='<div style="padding:16px;max-width:1500px;margin:0 auto">'
      +'<div style="font:800 20px Archivo,system-ui;color:var(--volt);letter-spacing:.02em">FORGE &middot; technique demos</div>'
      +'<div style="font:600 12px Archivo,system-ui;color:var(--mut);margin:5px 0 4px">All 48 exercises \\u00b7 one skeleton, one 200\\u00d7200 canvas, one 3140 ms four-phase tempo \\u00b7 every phase 1 is the lowering, every phase 3 the drive</div>'
      +'<div id="stat" style="font:600 11px Archivo,system-ui;color:var(--dim);margin-bottom:14px"></div>';
    groups.forEach(function(pair){
      html+='<div style="font:800 12px Archivo,system-ui;color:var(--mut);letter-spacing:.14em;margin:16px 0 8px">'
        + pair[0].toUpperCase() + ' &middot; ' + pair[1].length + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;align-items:start">'
        + pair[1].map(cell).join('') + '</div>';
    });
    html+='</div>';

    document.body.innerHTML=html;
    document.body.style.background='var(--bg)';
    document.body.style.margin='0';

    var errs=[];
    cells.forEach(function(c,i){
      c.g=document.getElementById('g'+i);
      c.bar=document.getElementById('b'+i);
      c.ph=document.getElementById('p'+i);
      try{ c.g.innerHTML=drawFigure(c.d, ANIMS[c.id].gen(0), loadFor(c.d, ANIMS[c.id].gen(0))); }
      catch(err){ errs.push(c.id+': '+err.message); }
    });

    var t0=null;
    function tick(ts){
      if(t0===null) t0=ts;
      var t=((ts-t0)%CYCLE)/CYCLE;
      cells.forEach(function(c,i){
        try{
          var P=ANIMS[c.id].gen(t);
          c.g.innerHTML=drawFigure(c.d,P,loadFor(c.d,P));
          c.bar.style.width=Math.round(t*100)+'%';
          c.ph.textContent = t<0.479 ? c.d.ph[0] : (t<0.798 ? c.d.ph[1] : 'SETUP');
        }catch(err){ if(errs.length<4) errs.push(c.id+'@'+t.toFixed(2)+': '+err.message); }
      });
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    document.getElementById('stat').textContent = cells.length+' demos rendering at once'
      + (errs.length ? '  \\u00b7  ERRORS: '+errs.join(' | ') : '  \\u00b7  no errors');
  }, 400);
});
<\/script>
`;
fs.writeFileSync(out, src.replace('</body>', probe + '</body>'));
console.log('wrote ' + out + '  (' + (fs.statSync(out).size / 1024).toFixed(0) + ' KB) — open it in a browser');
