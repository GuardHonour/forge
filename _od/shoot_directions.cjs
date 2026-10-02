/* Screenshot each design direction section of the OD artifact.
 * Usage: node _od\shoot_directions.cjs  → _od\dir_a.png, _od\dir_b.png, _od\dir_c.png
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CHROME = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\Chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\Chrome.exe'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'C:/Users/Admin/AppData/Roaming/Open Design/namespaces/release-stable-win/data/projects/forge-ui-upgrade/forge-ui-upgrade.html';
const PORT = 9355;
const PROF = path.resolve('_od/_prof');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let chrome;
(async () => {
  fs.rmSync(PROF, { recursive: true, force: true });
  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, 'about:blank'], { stdio: 'ignore' });

  let ws = null, id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  if (!ws) { console.log('FAIL: no chrome'); chrome.kill(); process.exit(1); }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception && r.exceptionDetails.exception.description);
    return r.result.value;
  };

  await send('Emulation.setDeviceMetricsOverride', { width: 940, height: 1200, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(3500); /* fonts + layout */

  const dirs = await evaluate(`(function(){
    var out = {};
    ['a','b','c'].forEach(function(L){
      var el = document.querySelector('.dir-' + L);
      if (!el) return;
      var r = el.getBoundingClientRect();
      out[L] = { top: Math.round(r.top + window.scrollY), h: Math.round(r.height), w: Math.round(r.width) };
    });
    return out;
  })()`);
  console.log('sections:', JSON.stringify(dirs));

  for (const L of ['a', 'b', 'c']) {
    if (!dirs[L]) { console.log('MISSING dir-' + L); continue; }
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: dirs[L].top, width: Math.min(940, dirs[L].w), height: dirs[L].h, scale: 1 },
      captureBeyondViewport: true,
    });
    const out = path.resolve(`_od/dir_${L}.png`);
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('wrote', out, `${dirs[L].w}x${dirs[L].h}`);
  }
  chrome.kill();
  await sleep(800);
  fs.rmSync(PROF, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.log('ERR', e.message); try { chrome.kill(); } catch (_) {} process.exit(1); });
