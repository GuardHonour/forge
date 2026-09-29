/* glm5.3-flash session: builds FORGE-demo-compare.html — a standalone page (works
   from file://) that runs BOTH demo sets side by side through the SAME embedded
   production engine: left column = the shipped v4.1-flash set (extracted from
   index.html), right column = this session's fresh set (_v5_demos.cjs).
   One rAF loop drives all 96 cells in lockstep at the shared 3140ms tempo. */
const fs = require('fs');
const { loadEngine, engineSource } = require('./_v5_engine.cjs');
const V5 = require('./_v5_demos.cjs');

const api = loadEngine(null);
const V41 = JSON.parse(JSON.stringify(api.DEMOS));
const EXS = api.EXS.map(e => ({ id: e.id, n: e.n, g: e.g }));
const engine = engineSource();

const pageScript = `
/* ---- data ---- */
const V41_DEMOS=${JSON.stringify(V41)};
const V5_DEMOS=${JSON.stringify(V5)};
const EXS=${JSON.stringify(EXS)};
/* ---- compile BOTH sets with the engine, keep two ANIMS maps ---- */
const V41_ANIMS={}; Object.keys(ANIMS).forEach(function(k){V41_ANIMS[k]=ANIMS[k];});
Object.keys(DEMOS).forEach(function(k){delete DEMOS[k];});
Object.assign(DEMOS,V5_DEMOS);
buildAnims();
const V5_ANIMS={}; Object.keys(ANIMS).forEach(function(k){V5_ANIMS[k]=ANIMS[k];});
/* ---- build the grid ---- */
const CATS=[]; EXS.forEach(function(e){ if(CATS.indexOf(e.g)<0)CATS.push(e.g); });
let html="";
CATS.forEach(function(cat){
  html+='<h2>'+cat.toUpperCase()+'</h2>';
  EXS.filter(function(e){return e.g===cat}).forEach(function(e){
    const a=V41_DEMOS[e.id], b=V5_DEMOS[e.id]; if(!a||!b)return;
    html+='<div class="excard"><div class="exhead"><span class="exname">'+e.n+'</span>'
      +'<span class="excat">'+cat.toUpperCase()+'</span></div>'
      +'<div class="pair">'
      +'<div class="cellwrap"><div class="celltag a">SHIPPED SET \\u00b7 EARLIER SESSION</div><svg viewBox="0 0 200 200"><g id="A_'+e.id+'"></g></svg>'
      +'<div class="cellmeta">'+a.ph[0]+' \\u2192 '+a.ph[1]+' \\u00b7 '+a.scene+' / '+a.view+'</div></div>'
      +'<div class="cellwrap"><div class="celltag b">GLM-5.3 FLASH \\u00b7 AUTHORED 16:59</div><svg viewBox="0 0 200 200"><g id="B_'+e.id+'"></g></svg>'
      +'<div class="cellmeta">'+b.ph[0]+' \\u2192 '+b.ph[1]+' \\u00b7 '+b.scene+' / '+b.view+'</div></div>'
      +'</div>'
      +'<div class="setup"><b>NEW SET-UP CUE</b>'+b.setup+'</div></div>';
  });
});
document.getElementById('grid').innerHTML=html;
/* ---- one loop, both sets, same t ---- */
let frozen=-1, playing=true, last=performance.now(), acc=0;
const CELLS=[]; EXS.forEach(function(e){
  if(V41_ANIMS[e.id]&&V5_ANIMS[e.id]) CELLS.push({id:e.id,
    ga:document.getElementById('A_'+e.id), gb:document.getElementById('B_'+e.id)});
});
function draw(tms){
  const t=(tms%3140)/3140;
  document.getElementById('ms').textContent=Math.floor(tms%3140)+'ms / 3140ms';
  document.getElementById('scrub').value=Math.floor(tms%3140);
  CELLS.forEach(function(c){
    try{ const Pa=V41_ANIMS[c.id].gen(t), da=V41_DEMOS[c.id];
      c.ga.innerHTML=drawFigure(da,Pa,loadFor(da,Pa)); }catch(err){}
    try{ const Pb=V5_ANIMS[c.id].gen(t), db=V5_DEMOS[c.id];
      c.gb.innerHTML=drawFigure(db,Pb,loadFor(db,Pb)); }catch(err){}
  });
}
function loop(now){ if(playing){ acc+=now-last; } last=now; draw(acc); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
document.getElementById('pp').addEventListener('click',function(){
  playing=!playing; this.textContent=playing?'PAUSE':'PLAY'; });
document.getElementById('scrub').addEventListener('input',function(){
  playing=false; document.getElementById('pp').textContent='PLAY';
  acc=+this.value; draw(acc); });
window.addEventListener('keydown',function(ev){
  if(ev.code==='Space'){ev.preventDefault();document.getElementById('pp').click();} });
draw(0);
`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FORGE technique demos \u2014 v4.1 flash vs glm5.3 flash</title>
<style>
:root{--bg:#08090b;--bg2:#0a0b0d;--card:#14161a;--card2:#1a1d23;--card3:#20242b;
--line:#242830;--line2:#30353e;--ink:#f2f4f7;--mut:#98a1ac;--dim:#5f6873;--volt:#cbf33a;--hot:#ff6b4a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 Archivo,system-ui,sans-serif}
header{max-width:1060px;margin:0 auto;padding:26px 16px 8px}
h1{font-size:21px;margin:0 0 6px;letter-spacing:.02em}
h1 b{color:var(--volt)}
header p{color:var(--mut);font-size:12.5px;margin:4px 0}
.bar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 92%,transparent);
backdrop-filter:blur(6px);border-bottom:1px solid var(--line);max-width:1060px;margin:0 auto;
padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
button{background:var(--volt);color:#12150a;border:0;border-radius:9px;padding:8px 16px;
font:700 12px Archivo,system-ui;letter-spacing:.08em;cursor:pointer}
input[type=range]{flex:1;min-width:160px;accent-color:var(--volt)}
.ms{font:700 12px Archivo,system-ui;color:var(--mut);min-width:120px;font-variant-numeric:tabular-nums}
.legend{display:flex;gap:14px;align-items:center;font-size:11px;color:var(--dim);letter-spacing:.06em;font-weight:700}
.sw{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:-1px}
main{max-width:1060px;margin:0 auto;padding:14px 16px 60px}
h2{font-size:13px;letter-spacing:.18em;color:var(--volt);margin:26px 0 10px;border-bottom:1px solid var(--line);padding-bottom:7px}
.excard{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:12px}
.exhead{display:flex;align-items:baseline;gap:10px;margin-bottom:9px}
.exname{font-weight:700;font-size:14.5px}
.excat{margin-left:auto;font-size:9.5px;font-weight:700;letter-spacing:.12em;color:var(--dim)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:640px){.pair{grid-template-columns:1fr}}
.cellwrap{background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:8px 8px 6px}
.celltag{font-size:10px;font-weight:700;letter-spacing:.09em;margin-bottom:6px;color:var(--dim)}
.celltag.a{color:var(--mut)}
.celltag.b{color:var(--volt)}
.cellwrap svg{display:block;width:100%;height:auto;background:color-mix(in srgb,var(--card3) 55%,transparent);border-radius:8px}
.cellmeta{font-size:9.5px;color:var(--dim);margin-top:6px;letter-spacing:.05em;min-height:24px}
.setup{font-size:11px;color:var(--mut);border-top:1px dashed var(--line);margin-top:8px;padding-top:7px}
.setup b{color:var(--ink);font-size:9.5px;letter-spacing:.12em;margin-right:8px}
.foot{color:var(--dim);font-size:11px;max-width:1060px;margin:0 auto;padding:0 16px 40px}
</style></head><body>
<header><h1>FORGE technique demos \u2014 <b>v4.1 flash</b> vs <b>glm5.3 flash</b></h1>
<p>The same shared vector engine (one skeleton, two-link IK, one 3140&thinsp;ms tempo) animating two independently authored 48-demo sets, in lockstep. Left: the set shipped in <code>index.html</code>, authored in an earlier session. Right: a set authored from scratch in this session &#8212; its own poses, cues and phase verbs.</p>
<p><b>Provenance, read from the session log:</b> this session selected <code>z-ai/glm-5.3-flash</code> at 15:59, and that model served every request from 16:00 to 17:01 &#8212; the window in which the new set was written. The session's model was then switched to <code>deepseek/deepseek-v4.1-flash</code> at 21:50, <i>after</i> this set was finished. So the right-hand column is glm-5.3-flash's work; the 3D sandbox built later in the same session is deepseek-v4.1-flash's. The earlier session that authored the shipped set carries no model-selection record, so its author is not verifiable from the transcript.</p>
<p>Scrub the bar to freeze both athletes at any point in the rep; both cells always show the same millisecond. Space toggles play.</p></header>
<div class="bar"><button id="pp">PAUSE</button><input id="scrub" type="range" min="0" max="3140" value="0"><span class="ms" id="ms">0ms / 3140ms</span>
<span class="legend"><span><span class="sw" style="background:var(--mut)"></span>shipped set (earlier session)</span>
<span><span class="sw" style="background:var(--volt)"></span>glm-5.3 flash, authored 16:59</span></span></div>
<main id="grid"></main>
<div class="foot">Engine extracted verbatim from <code>index.html</code>; both sets are compiled by its own <code>buildAnims()</code>. Filmstrip sheets of the new set: FORGE-motion-v5-*.png (chest, back, shoulders, arms, legs, core).</div>
<script>${engine}
${pageScript}
<\/script></body></html>
`;

fs.writeFileSync('FORGE-demo-compare.html', html);
console.log('wrote FORGE-demo-compare.html  ' + (html.length / 1024).toFixed(1) + ' KB  ('
  + EXS.length + ' exercises x 2 sets)');
process.exit(0);
