/* Probe the two new themes on the real app: switch to crucible/caliper, assert the
 * computed custom properties (--font-display, --on-volt, --volt), and screenshot
 * the Train card in each. Usage: node _od/probe_themes.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
const PORT = 9361;
const PROF = path.resolve('_od/_prof_th');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let chrome;
(async () => {
  fs.rmSync(PROF, { recursive: true, force: true });
  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, 'about:blank'], { stdio: 'ignore' });
  let ws = null, id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p || {} })); });
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const pg = l.find(t => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; } } catch (e) {}
    await sleep(250);
  }
  if (!ws) { console.log('FAIL no chrome'); chrome.kill(); process.exit(1); }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
  await send('Page.enable'); await send('Runtime.enable');
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception && r.exceptionDetails.exception.description); return r.result.value; };

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: FILE });
  await sleep(2500);
  const errs = await ev('window.__errs ? window.__errs.join(";") : "none"');

  const expect = {
    volt:     { font: 'Oswald',        onvolt: /#[0-9a-f]{6}/i,          volt: '#cbf33a' },
    crucible: { font: 'Anton',         onvolt: '#16090b',                volt: '#ff2d3f' },
    caliper:  { font: 'Space Grotesk', onvolt: /#[0-9a-f]{6}/i,          volt: '#5dc5f2' },
  };
  let bad = 0;
  for (const [th, x] of Object.entries(expect)) {
    await ev(`G.setTheme('${th}')`); /* G throttles taps — one theme per 400ms window */
    await sleep(600);
    const r = await ev(`(function(){
      var cs = getComputedStyle(document.documentElement);
      return { font: cs.getPropertyValue('--font-display').trim(), onvolt: cs.getPropertyValue('--on-volt').trim(),
               volt: cs.getPropertyValue('--volt').trim(),
               stored: JSON.parse(localStorage.getItem('forge.v1')).theme };
    })()`);
    const fontOK = r.font === x.font || r.font === `'${x.font}'`;
    const onOK = x.onvolt instanceof RegExp ? x.onvolt.test(r.onvolt) : r.onvolt.toLowerCase() === x.onvolt.toLowerCase();
    const voltOK = r.volt.toLowerCase() === x.volt.toLowerCase();
    if (!fontOK || !onOK || !voltOK) bad++;
    console.log(`${th}: font=${r.font} (want ${x.font}) on-volt=${r.onvolt} volt=${r.volt} -> ${fontOK && onOK && voltOK ? 'OK' : 'MISMATCH'}`);
    /* screenshot the Train tab in this theme */
    await ev(`G.nav('train')`);
    await sleep(700);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.resolve(`_od/app_${th}.png`), Buffer.from(shot.data, 'base64'));
    console.log(`  wrote _od/app_${th}.png`);
  }
  await ev(`G.setTheme('volt')`);
  console.log(errs === 'none' ? 'JS errors: none' : 'JS ERRORS: ' + errs);
  console.log(bad ? `THEME PROBE: ${bad} MISMATCH(ES)` : 'THEME PROBE: ALL OK');
  chrome.kill(); await sleep(800); fs.rmSync(PROF, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); try { chrome.kill(); } catch (_) {} process.exit(1); });