/* _s3d_shot_live.cjs — deterministic screenshot of the viewer's LIVE mode.
   node _s3d_shot_live.cjs <page.html> <out.png> [clip]

   _s3d_shot.cjs screenshots the sheet modes, which are static. Live mode animates on a
   requestAnimationFrame loop, so two captures at different wall-clock moments differ for
   reasons that have nothing to do with the code. This runner freezes it first: click PAUSE,
   then drive the scrub bar to a fixed value, which sets st.t = value/1000 * duration and
   st.playing = false. Same pose, same camera, same pixels — every run.
   It also counts lit pixels on the canvas, so "both images are identical" can never mean
   "both are blank". */
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9362;
const TMP = '_gifwork';
const PAGE = process.argv[2] || '_s3d_view.html';
const OUT = process.argv[3] || '_s3d_live.png';
const CLIP = process.argv[4] || 'squat';

fs.mkdirSync(TMP, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + process.cwd() + '\\' + TMP + '\\p_s3d_live', 'about:blank'], { stdio: 'ignore' });

  let ws = null, id = 0;
  const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method: m, params: p || {} }));
  });
  const evaluate = async expr => (await send('Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

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

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });

    const url = 'file:///' + process.cwd().replace(/\\/g, '/') + '/' + PAGE + '?clip=' + CLIP;
    await send('Page.navigate', { url });

    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      if (await evaluate('!!window.__LIVE_READY')) { ready = true; break; }
    }
    if (!ready) throw new Error('__LIVE_READY never set (live mode did not start)');

    /* freeze: PAUSE, then a fixed scrub position */
    const froze = await evaluate(`(function(){
      var pp=document.getElementById('b-play');
      if(pp && pp.textContent==='PAUSE') pp.click();
      var s=document.getElementById('scrub');
      s.value=500; s.dispatchEvent(new Event('input'));
      return pp.textContent + ' scrub=' + s.value;
    })()`);
    await sleep(700);

    const info = await evaluate(`(function(){
      var c=document.querySelector('canvas');
      if(!c) return {err:'no canvas'};
      var t=document.createElement('canvas'); t.width=c.width; t.height=c.height;
      var g=t.getContext('2d'); g.drawImage(c,0,0);
      var d=g.getImageData(0,0,t.width,t.height).data;
      var bright=0; for(var i=0;i<d.length;i+=4){ if(d[i]>45||d[i+1]>45||d[i+2]>45) bright++; }
      var r=c.getBoundingClientRect();
      return { w:document.body.scrollWidth, h:document.body.scrollHeight,
               canvas:c.width+'x'+c.height, brightPixels:bright,
               rect:[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)].join(','),
               tread:document.getElementById('tread').textContent,
               ctxKeys:Object.keys(window.S3D_RENDER||{}).join(',') };
    })()`);
    console.log('page: ' + info.w + 'x' + info.h + ', canvas ' + info.canvas +
      ' at page rect ' + info.rect +
      ', lit pixels ' + info.brightPixels + ', pane ' + info.tread + ' (frozen: ' + froze + ')');
    console.log('S3D_RENDER keys: ' + info.ctxKeys);

    await send('Emulation.setDeviceMetricsOverride', { width: info.w, height: info.h, deviceScaleFactor: 1, mobile: false });
    await sleep(900);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

    if (errors.length) console.log('PAGE ERRORS: ' + errors.slice(0, 3).join(' | '));
    else console.log('page errors: none');
    console.log('wrote ' + OUT + '  (' + info.w + 'x' + info.h + ')');
  } catch (e) {
    console.log('FAILED: ' + e.message);
    process.exitCode = 1;
  } finally {
    try { chrome.kill(); } catch (e) {}
    await sleep(900);
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(TMP + '/p_s3d_live', { recursive: true, force: true }); break; } catch (e) { await sleep(400); }
    }
    process.exit(process.exitCode || 0);
  }
})();
