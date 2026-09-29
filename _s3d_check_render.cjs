/* _s3d_check_render.cjs — drive the refactored renderer in a real browser, over CDP.
   node _s3d_check_render.cjs [page.html]

   The pixel comparison against the pre-split viewer proves drawCell still draws what it drew.
   It cannot prove the things this checks, because the viewer never calls them:
     1. the module is reachable as window.S3D_RENDER when loaded by a plain <script src>;
     2. draw() renders the whole canvas — clear colour at the corners, geometry where the
        figure is, skeleton overlay included — with no scissor and no padding;
     3. drawCell's scissor really does isolate a cell: a second cell drawn to the right must
        not erase the first one, which is what the side-by-side still in _s3d_app.js needs;
     4. the page still exposes window.S3DVIEW and the query-parameter paths still work
        (live mode sets __LIVE_READY; a mode= sheet sets __SHEET with a size).
   Port 9364 and its own profile dir, so it can never collide with _s3d_shot.cjs. */
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9364;
const TMP = '_gifwork';
const PAGE = process.argv[2] || '_s3d_view.html';

fs.mkdirSync(TMP, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Counts lit pixels and reads the four corners of a canvas, via a 2D copy of it. */
const probe = (sel, label) => `(function(){
  var c = ${sel};
  if(!c) return {err:'no canvas for ${label}'};
  var t=document.createElement('canvas'); t.width=c.width; t.height=c.height;
  var g=t.getContext('2d'); g.drawImage(c,0,0);
  var d=g.getImageData(0,0,t.width,t.height).data, W=t.width, H=t.height;
  var lit=0, maxc=0;
  for(var i=0;i<d.length;i+=4){
    if(d[i]>45||d[i+1]>45||d[i+2]>45) lit++;
    if(d[i]>maxc) maxc=d[i];
  }
  var px=function(x,y){ var o=(y*W+x)*4; return [d[o],d[o+1],d[o+2]]; };
  return { size:W+'x'+H, lit:lit, maxRed:maxc, maxPossible:W*H,
           corners:[px(0,0),px(W-1,0),px(0,H-1),px(W-1,H-1)].map(function(p){return p.join(',');}).join(' | ') };
})()`;

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--force-device-scale-factor=1', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + process.cwd() + '\\' + TMP + '\\p_s3d_chk', 'about:blank'], { stdio: 'ignore' });

  let ws = null, id = 0;
  const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method: m, params: p || {} }));
  });
  const evaluate = async (expression, awaitPromise) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  let fails = 0;
  const check = (name, ok, detail) => {
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined ? '   ' + detail : ''));
    if (!ok) fails++;
  };

  try {
    for (let i = 0; i < 100; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
        const pg = list.find(t => t.type === 'page');
        if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; }
      } catch (e) { /* not up yet */ }
      await sleep(250);
    }
    if (!ws) throw new Error('no CDP target');
    await new Promise(r => ws.addEventListener('open', r));
    const errors = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        errors.push(d.text + ' ' + ((d.exception && d.exception.description) || ''));
      }
    });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });

    const base = 'file:///' + process.cwd().replace(/\\/g, '/') + '/' + PAGE;

    /* ---- live mode: module reachable, draw() and drawCell() exercised ---- */
    await send('Page.navigate', { url: base + '?clip=squat' });
    for (let i = 0; i < 40; i++) { await sleep(250); if (await evaluate('!!window.__LIVE_READY')) break; }
    check('live mode set window.__LIVE_READY', await evaluate('!!window.__LIVE_READY'));
    check('window.S3DVIEW is exported', await evaluate('typeof window.S3DVIEW === "object" && typeof window.S3DVIEW.build === "function"'));
    const api = await evaluate('(function(){var R=window.S3D_RENDER||{};return ["makeCtx","drawCell","draw","camera","sh","prog"].map(function(k){return k+":"+typeof R[k];}).join(" ");})()');
    check('window.S3D_RENDER API via <script src>', api.indexOf(':function') >= 0 && api.split(':function').length === 7, api);

    await evaluate(`window.__t = {}; window.__t.ch = S3D.buildCharacter(); window.__t.geo = S3D.packGeometry(window.__t.ch);`);
    if (await evaluate('!!(window.__t && window.__t.ch && window.__t.geo)')) {
      const ev = "S3D.sample(window.__t.ch,'squat',1.8)";

      /* draw(): fresh 240x240 canvas, full-canvas */
      await evaluate(`window.__t.a = document.createElement('canvas'); window.__t.a.width=240; window.__t.a.height=240;
        document.body.appendChild(window.__t.a);
        window.__t.ctxA = S3D_RENDER.makeCtx(window.__t.a, window.__t.ch, window.__t.geo);
        S3D_RENDER.draw(window.__t.ctxA, ${ev}, S3D_RENDER.camera('persp',1,30,10,430), {skeleton:true});`);
      const A = await evaluate(probe('window.__t.a', 'draw canvas'));
      check('draw() renders the whole canvas (no padding, corners = clear colour)',
        A.lit > 800 && A.corners.split(' | ').every(c => c === '13,15,19'), JSON.stringify(A));

      /* drawCell(): two cells side by side in ONE canvas; the second must not erase the first */
      await evaluate(`window.__t.b = document.createElement('canvas'); window.__t.b.width=480; window.__t.b.height=240;
        document.body.appendChild(window.__t.b);
        window.__t.ctxB = S3D_RENDER.makeCtx(window.__t.b, window.__t.ch, window.__t.geo);
        S3D_RENDER.drawCell(window.__t.ctxB, 0, 0, 240, ${ev}, S3D_RENDER.camera('persp',1,30,10,430), {skeleton:true});
        S3D_RENDER.drawCell(window.__t.ctxB, 240, 0, 240, ${ev}, S3D_RENDER.camera('persp',1,0,10,430), {skeleton:true});`);
      const B = await evaluate(`(function(){
        var c=window.__t.b, t=document.createElement('canvas'); t.width=480; t.height=240;
        var g=t.getContext('2d'); g.drawImage(c,0,0);
        function lit(x0,w){ var d=g.getImageData(x0,0,w,240).data, n=0;
          for(var i=0;i<d.length;i+=4){ if(d[i]>45||d[i+1]>45||d[i+2]>45) n++; } return n; }
        var d=g.getImageData(0,0,480,240).data, seam=0;
        for(var y=0;y<240;y++){ for(var x=237;x<244;x++){ var o=(y*480+x)*4;
          if(d[o]>45||d[o+1]>45||d[o+2]>45) seam++; } }
        return { left:lit(0,240), right:lit(240,240), seamPixels:seam };
      })()`);
      check('drawCell() cell 1 survives cell 2 (scissor isolation)', B.left > 800 && B.right > 800, JSON.stringify(B));
      check('drawCell() pads the cell by 3 px (clear seam between cells)', B.seamPixels === 0, 'lit pixels in the 237..243 column band: ' + B.seamPixels);

      /* the ctx carries what draw needs, and nothing reaches for a page global */
      const keys = await evaluate('Object.keys(window.__t.ctxA).sort().join(",")');
      check('ctx is self-contained (has gl/ch/geo/nb/canvas)', ['gl', 'ch', 'geo', 'nb', 'canvas'].every(k => keys.split(',').indexOf(k) >= 0), keys);
      check('bone slots = max(24, joint count)', await evaluate('window.__t.ctxA.nb === Math.max(24, window.__t.ch.sk.order.length)'),
        'nb=' + await evaluate('window.__t.ctxA.nb'));
    } else check('character + geometry built in page', false);

    /* ---- sheet mode: ?mode= path and __SHEET ---- */
    await send('Page.navigate', { url: base + '?mode=threeview&clips=twist&cell=180&skeleton=1' });
    await sleep(3000);
    const sheet = await evaluate(`(function(){
      var cs=document.querySelectorAll('canvas');
      return { w:window.__SHEET&&window.__SHEET.w, h:window.__SHEET&&window.__SHEET.h,
               canvases:cs.length,
               sizes:[].map.call(cs,function(c){return c.width+'x'+c.height;}).join(' ') };
    })()`);
    /* mode=threeview legitimately builds TWO canvases: the per-clip filmstrip row (cell*frames)
       and the three ortho views (cell*3). The pre-split viewer produced exactly this for this
       query — _s3d_shot.cjs reported "canvases 2" against the original page too. */
    check('?mode=threeview builds the sheet and sets window.__SHEET',
      !!sheet && sheet.w > 0 && sheet.canvases === 2, JSON.stringify(sheet));

    const S = await evaluate(probe('document.querySelectorAll("canvas")[1]', 'ortho row'));
    check('?mode= sheet actually rendered geometry', S.lit > 1000, JSON.stringify(S));

    /* ---- ?live=1: live mode selected because no `mode` key is present ---- */
    await send('Page.navigate', { url: base + '?live=1&clip=squat' });
    for (let i = 0; i < 40; i++) { await sleep(250); if (await evaluate('!!window.__LIVE_READY')) break; }
    check('?live=1 selects live mode (__LIVE_READY set, no __SHEET)',
      await evaluate('!!window.__LIVE_READY && typeof window.__SHEET === "undefined"'),
      'liveReady=' + await evaluate('!!window.__LIVE_READY') + ' sheet=' + await evaluate('typeof window.__SHEET'));

    console.log(errors.length ? '  page errors: ' + errors.slice(0, 3).join(' | ') : '  page errors: none');
    console.log(fails ? 'RESULT: ' + fails + ' check(s) FAILED' : 'RESULT: all checks passed');
    process.exitCode = fails ? 1 : 0;
  } catch (e) {
    console.log('FAILED: ' + e.message);
    process.exitCode = 1;
  } finally {
    try { chrome.kill(); } catch (e) {}
    await sleep(900);
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(TMP + '/p_s3d_chk', { recursive: true, force: true }); break; } catch (e) { await sleep(400); }
    }
    process.exit(process.exitCode || 0);
  }
})();
