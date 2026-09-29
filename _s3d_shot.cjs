/* _s3d_shot.cjs — render S3D sheets to PNG in headless Chrome.
   node _s3d_shot.cjs "<query>" <out.png>
   e.g. node _s3d_shot.cjs "mode=filmstrip&clips=twist,squat,reach&frames=9&cell=175" out.png
   WebGL runs on SwiftShader (no GPU on this box) — verified working before this
   harness was written, so a blank PNG here means a scene bug, not a driver one. */
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9361;
const TMP = '_gifwork';
const QUERY = process.argv[2] || 'mode=filmstrip&clips=twist&frames=9&cell=175';
const OUT = process.argv[3] || '_s3d_sheet.png';

fs.mkdirSync(TMP, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + process.cwd() + '\\' + TMP + '\\p_s3d', 'about:blank'], { stdio: 'ignore' });

  let ws = null, id = 0;
  const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method: m, params: p || {} }));
  });

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

    const url = 'file:///' + process.cwd().replace(/\\/g, '/') + '/_s3d_view.html?' + QUERY;
    await send('Page.navigate', { url });
    await sleep(2600);

    const info = (await send('Runtime.evaluate', {
      expression: '({w:document.body.scrollWidth, h:document.body.scrollHeight,'
        + ' canvases:document.querySelectorAll("canvas").length,'
        + ' gl:!!document.querySelector("canvas") && !!document.querySelector("canvas").getContext("webgl2")})',
      returnByValue: true
    })).result.value;
    console.log('page: ' + info.w + 'x' + info.h + ', canvases ' + info.canvases);

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
      try { fs.rmSync(TMP + '/p_s3d', { recursive: true, force: true }); break; } catch (e) { await sleep(400); }
    }
    process.exit(process.exitCode || 0);
  }
})();
