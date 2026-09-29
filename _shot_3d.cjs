/* _shot_3d.cjs — prove the in-app 3D technique view actually renders, in a real browser.

   WHY THIS IS SEPARATE FROM _check_ui.cjs
   `_check_ui.cjs` launches Chrome with `--disable-gpu`. Under that flag WebGL2 is normally
   unavailable, which is precisely the condition `_s3d_app.js` treats as "this device cannot do 3D"
   and falls back to the 2D demo. A probe built on that harness would therefore pass while proving
   nothing about the 3D path — it would be measuring the fallback. So this probe launches Chrome with
   software WebGL explicitly enabled (recent Chrome needs `--enable-unsafe-swiftshader` for that;
   without it the GL context request fails and, again, the app correctly falls back).

   WHAT IT CHECKS, AND WHY EACH ONE CAN FAIL
   - A canvas exists in #anim-stage AND has a live webgl2 context. A fallback to the 2D SVG would
     fail this.
   - The framebuffer has LIT pixels: counted with gl.readPixels against the known clear colour
     (13,15,19). A canvas that exists but renders nothing would fail this.
   - The phase label CHANGES over time. This is what proves the 3D loop drives the app's shared HUD
     rather than leaving it frozen on the last 2D frame.
   - An exercise with no measured clip still gets the 2D SVG and NO 3D toggle — the view must not
     claim measurement it does not have.
   - Repeated open/close releases the GL context instead of leaking one per view (browsers cap them).
*/
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
/* Port 9335, NOT 9333. `_check_ui.cjs` binds 9333, and this probe used to bind it too, so a leftover
   headless browser from here made `_check_ui.cjs` fail with "could not attach to Chrome" — a tooling
   collision that reads exactly like an app fault. Keep the two on different ports. */
const PORT = 9335;
const TEMP = '_shot3d_tmp';
const OUT = path.join(process.cwd(), TEMP);

const APP_URL = process.argv[3] || ('file:///' + process.cwd().replace(/\\/g, '/') + '/index.html');
const WIDTH = Number(process.argv[2] || 390);

let problems = [];
function must(cond, msg) { if (!cond) { problems.push(msg); console.log('  FAIL: ' + msg); } else console.log('  ok   ' + msg); return cond; }

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--hide-scrollbars', '--mute-audio',
  '--enable-unsafe-swiftshader',            /* software WebGL2: see the header */
  '--use-angle=swiftshader',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + path.join(OUT, 'profile'),
  '--window-size=' + WIDTH + ',900',
  'about:blank'
], { stdio: 'ignore' });

let ws = null, id = 0;
const waiting = new Map();
function send(method, params) {
  return new Promise((res, rej) => {
    const n = ++id;
    waiting.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method: method, params: params || {} }));
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page threw: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result && r.result.value;
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 60 && !ws; i++) {
    await sleep(250);
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = list.find(t => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      }
    } catch (e) { /* not up yet */ }
  }
  if (!ws) { console.log('FAIL: could not attach to Chrome'); chrome.kill(); process.exitCode = 1; return; }
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      const w = waiting.get(m.id); waiting.delete(m.id);
      if (m.error) w.rej(new Error(m.error.message)); else w.res(m.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');

  console.log('=== 3D technique view, real Chrome at ' + WIDTH + 'px, software WebGL2 ===');
  await send('Page.navigate', { url: APP_URL });
  await sleep(2500);

  /* Did the browser even give us a WebGL2 context? If not, everything below would be testing the
     fallback, so say so loudly rather than reporting a pass. */
  const gl = await evaluate(`(()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');
    return g?{ok:true,ver:g.getParameter(g.VERSION),renderer:g.getParameter(g.RENDERER)}:{ok:false};})()`);
  console.log('  browser WebGL2: ' + JSON.stringify(gl));
  must(gl && gl.ok, 'the browser exposes WebGL2 (otherwise this probe measures the 2D fallback)');
  if (!gl || !gl.ok) {
    console.log('\nCANNOT VERIFY: no WebGL2 in this browser, so the app would correctly fall back to 2D.');
    chrome.kill(); process.exitCode = 1; return;
  }

  const appReady = await evaluate(`typeof window.G==='object' && typeof window.S3D_APP==='object'`);
  must(appReady, 'the app booted and window.S3D_APP is present');

  const mapping = await evaluate(`JSON.stringify(S3D_APP.mapping())`);
  console.log('  exercise -> measured clip: ' + mapping);

  /* ---- 1. an exercise WITH a measured clip must render 3D --------------------------------- */
  for (const exId of ['squat', 'ohp', 'legext', 'machine-press']) {
    const has = await evaluate(`S3D_APP.has3D(${JSON.stringify(exId)})`);
    if (!has) { console.log('  note: ' + exId + ' has no measured clip in this build'); continue; }
    await evaluate(`G.openExAnim(${JSON.stringify(exId)})`);
    await sleep(1200);
    const r = await evaluate(`(()=>{
      const c=document.querySelector('#anim-stage canvas');
      if(!c) return {err:'no canvas in #anim-stage'};
      const g=c.getContext('webgl2');
      if(!g) return {err:'canvas has no webgl2 context'};
      const w=c.width,h=c.height,px=new Uint8Array(w*h*4);
      g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,px);
      let lit=0; const seen={};
      for(let i=0;i<px.length;i+=4){
        const R=px[i],G2=px[i+1],B=px[i+2];
        if(Math.abs(R-13)>6||Math.abs(G2-15)>6||Math.abs(B-19)>6) lit++;
        seen[R+','+G2+','+B]=1;
      }
      return {w:w,h:h,lit:lit,colours:Object.keys(seen).length};
    })()`);
    console.log('  ' + exId.padEnd(14) + ' ' + JSON.stringify(r));
    must(r && !r.err, exId + ': the 3D canvas exists with a webgl2 context');
    must(r && r.lit > 500, exId + ': the framebuffer has lit pixels (' + (r && r.lit) + ')');
    must(r && r.colours > 8, exId + ': it is shaded, not a flat fill (' + (r && r.colours) + ' distinct colours)');

    /* the phase HUD must be driven by the 3D loop, so it has to change on its own */
    const p1 = await evaluate(`(document.getElementById('demo-ph')||{}).textContent`);
    await sleep(1100);
    const p2 = await evaluate(`(document.getElementById('demo-ph')||{}).textContent`);
    const barW = await evaluate(`(document.getElementById('demo-bar')||{}).style.width`);
    console.log('           phase "' + p1 + '" -> "' + p2 + '", bar ' + barW);
    must(p1 !== p2 || (barW && barW !== '0%'), exId + ': the phase HUD is advancing, not frozen');

    const prov = await evaluate(`(document.getElementById('v3d-src')||{}).textContent`);
    must(prov && prov.indexOf('Measured from') === 0, exId + ': the provenance/attribution line is shown');
    console.log('           ' + JSON.stringify(prov));
    await shot('3d_' + exId + '.png');

    /* ---- 2. toggling to 2D must give back the SVG, and back again ------------------------ */
    await evaluate(`G.view3D(${JSON.stringify(exId)},0)`);
    await sleep(400);
    const svg = await evaluate(`!!document.querySelector('#anim-stage svg')`);
    must(svg, exId + ': toggling to 2D restores the SVG demo');
    await evaluate(`G.view3D(${JSON.stringify(exId)},1)`);
    await sleep(400);
    const back = await evaluate(`!!document.querySelector('#anim-stage canvas')`);
    must(back, exId + ': toggling back to 3D restores the canvas');

    await evaluate(`G.closeModal()`);
    await sleep(300);
  }

  /* ---- 3. an exercise with NO measurement must not pretend --------------------------------- */
  const no3d = await evaluate(`['legcurl','legpress','pulldown','curl'].filter(id=>!S3D_APP.has3D(id))[0]`);
  if (no3d) {
    await evaluate(`G.openExAnim(${JSON.stringify(no3d)})`);
    await sleep(900);
    const r = await evaluate(`({svg:!!document.querySelector('#anim-stage svg'),canvas:!!document.querySelector('#anim-stage canvas'),toggle:!!document.getElementById('v3d-3d')})`);
    console.log('  ' + no3d + ' (no measurement): ' + JSON.stringify(r));
    must(r.svg && !r.canvas, no3d + ': falls back to the 2D SVG and draws no 3D canvas');
    must(!r.toggle, no3d + ': offers no 3D toggle, so it cannot claim a measurement it lacks');
    await shot('3d_fallback_' + no3d + '.png');
    await evaluate(`G.closeModal()`);
    await sleep(300);
  }

  /* ---- 4. opening and closing must not leak GL contexts ----------------------------------- */
  const leak = await evaluate(`(async()=>{
    const errs=[]; window.onerror=function(e){errs.push(String(e))};
    for(let i=0;i<14;i++){ G.openExAnim('squat'); await new Promise(r=>setTimeout(r,120)); G.closeModal(); await new Promise(r=>setTimeout(r,60)); }
    const live=document.querySelectorAll('#anim-stage canvas').length;
    return {errors:errs.length, canvasesLeftInStage:live};
  })()`);
  console.log('  14 open/close cycles: ' + JSON.stringify(leak));
  must(leak.errors === 0, 'no page errors across 14 open/close cycles (a leaked context shows up here)');
  must(leak.canvasesLeftInStage === 0, 'the stage is empty after close, so no context is left mounted');

  await shot('3d_after_cycles.png');
  console.log('\n' + (problems.length ? 'SHOT_3D problems: ' + problems.length : 'SHOT_3D CLEAN'));
  console.log('screenshots in ' + OUT);
  chrome.kill();
  process.exitCode = problems.length ? 1 : 0;
})().catch(e => {
  console.log('PROBE ERROR: ' + (e && e.stack || e));
  try { chrome.kill(); } catch (x) {}
  process.exitCode = 1;
});
