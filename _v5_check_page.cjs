/* loads FORGE-demo-compare.html in headless Chrome, asserts both sets drew,
   collects page errors, and screenshots the top at a mid-rep moment. */
const fs = require('fs');
const { spawn } = require('child_process');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9359;
const TMP = '_gifwork';
fs.mkdirSync(TMP, { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.cwd() + '\\' + TMP + '\\p_chk', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let ws = null, id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p || {} })); });
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); const pg = l.find(t => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; } } catch (e) {}
    await sleep(250);
  }
  if (!ws) { console.log('FAIL: no CDP'); chrome.kill(); process.exit(1); }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
  const errors = [];
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || '')); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1200, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + process.cwd().replace(/\\/g, '/') + '/FORGE-demo-compare.html' });
  await sleep(2500);
  const stat = (await send('Runtime.evaluate', {
    expression: '({cells:CELLS.length, filledA:[...document.querySelectorAll("[id^=A_]")].filter(g=>g.childElementCount>0).length,'
      + 'filledB:[...document.querySelectorAll("[id^=B_]")].filter(g=>g.childElementCount>0).length,'
      + 'cards:document.querySelectorAll(".excard").length})', returnByValue: true
  })).result.value;
  console.log('grid:', JSON.stringify(stat));
  // freeze mid-rep (eccentric of rep 1) for the screenshot
  await send('Runtime.evaluate', { expression: 'playing=false; acc=900; draw(acc); document.getElementById("pp").textContent="PLAY";' });
  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync('_v5_compare_top.png', Buffer.from(shot.data, 'base64'));
  console.log('page errors:', errors.length ? errors.slice(0, 4).join(' | ') : 'none');
  console.log('wrote _v5_compare_top.png');
  const ok = stat.cells === 48 && stat.filledA === 48 && stat.filledB === 48 && stat.cards === 48 && errors.length === 0;
  console.log(ok ? 'COMPARE PAGE OK' : 'COMPARE PAGE BROKEN');
  chrome.kill(); await sleep(800);
  for (let i = 0; i < 5; i++) { try { fs.rmSync(TMP + '/p_chk', { recursive: true, force: true }); break; } catch (e) { await sleep(400); } }
  process.exit(ok ? 0 : 1);
})();
