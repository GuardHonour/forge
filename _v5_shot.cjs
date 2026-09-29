/* glm5.3-flash set: filmstrip renderer. Renders MY demo table through the exact
   production engine in headless Chrome — one row per exercise, one column per
   point in the rep.
   node _v5_shot.cjs <Chest|Back|Shoulders|Arms|Legs|Core|all> [frames] [cell] */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadEngine, engineSource } = require('./_v5_engine.cjs');
const MINE = require('./_v5_demos.cjs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9357;
const TMP = '_gifwork';
const WHICH = (process.argv[2] || 'all');
const FRAMES = parseInt(process.argv[3] || '9', 10);
const CELL = parseInt(process.argv[4] || '150', 10);

/* exercise names + groups come from the real EXS via the sandbox */
const api0 = loadEngine(null);
const META = {};
api0.EXS.forEach(e => META[e.id] = { n: e.n, g: e.g });
const CATS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core'];
const cats = WHICH === 'all' ? CATS : [WHICH];

fs.mkdirSync(TMP, { recursive: true });

function pageFor(cat) {
  const ids = api0.EXS.filter(e => e.g === cat).map(e => e.id);
  const engine = engineSource();
  return '<!doctype html><html><head><meta charset="utf-8"><style>'
    + ':root{--bg:#08090b;--bg2:#0a0b0d;--card:#14161a;--card2:#1a1d23;--card3:#20242b;'
    + '--line:#242830;--line2:#30353e;--ink:#f2f4f7;--mut:#98a1ac;--dim:#5f6873;--volt:#cbf33a}'
    + 'body{margin:0;background:var(--bg);font-family:Archivo,system-ui,sans-serif}'
    + '</style></head><body><script>'
    + engine
    + '\n;Object.keys(DEMOS).forEach(function(k){delete DEMOS[k];});'
    + 'Object.assign(DEMOS,' + JSON.stringify(MINE) + ');'
    + 'const EXS=' + JSON.stringify(ids.map(id => ({ id, n: META[id].n, g: cat }))) + ';'
    + 'const EXBY={};EXS.forEach(function(e){EXBY[e.id]=e});'
    + 'buildAnims();'
    + 'window.__PROBE=(' + probe.toString() + ')(' + JSON.stringify(ids) + ',' + FRAMES + ',' + CELL + ');'
    + '<\/script></body></html>';
}

function probe(ids, FRAMES, CELL) {
  let html = '<div style="display:flex;flex-direction:column;gap:12px;padding:10px">';
  ids.forEach(function (id) {
    var e = EXBY[id], d = DEMOS[id];
    if (!d) return;
    html += '<div style="background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px">'
      + '<div style="display:flex;gap:10px;align-items:baseline;margin-bottom:5px">'
      + '<span style="font-weight:700;font-size:13px;color:var(--ink);min-width:230px">' + e.n + '</span>'
      + '<span style="font-weight:600;font-size:9px;color:var(--dim);letter-spacing:.07em">'
      + d.ph[0] + ' \u2192 ' + d.ph[1] + ' \u00b7 ' + d.scene + ' / ' + d.view + '</span></div>'
      + '<div style="display:flex;gap:5px">';
    for (var f = 0; f < FRAMES; f++) {
      html += '<div><svg viewBox="0 0 200 200" width="' + CELL + '" height="' + CELL
        + '" style="display:block;background:color-mix(in srgb,var(--card3) 55%,transparent);border-radius:7px"><g id="g_' + id + '_' + f + '"></g></svg>'
        + '<div style="font-weight:700;font-size:8px;color:var(--mut);text-align:center;margin-top:2px">' + Math.round(f / FRAMES * 3140) + 'ms</div></div>';
    }
    html += '</div></div>';
  });
  html += '</div>';
  document.body.innerHTML = html;
  var errs = [];
  ids.forEach(function (id) {
    var d = DEMOS[id];
    for (var f = 0; f < FRAMES; f++) {
      var g = document.getElementById('g_' + id + '_' + f);
      if (!g || !d) continue;
      try { var P = ANIMS[id].gen(f / FRAMES); g.innerHTML = drawFigure(d, P, loadFor(d, P)); }
      catch (err) { errs.push(id + '@' + f); }
    }
  });
  var r = document.body.firstChild.getBoundingClientRect();
  return { w: Math.ceil(r.width) + 20, h: Math.ceil(r.height) + 20, errs: errs };
}

(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (const cat of cats) {
    const out = 'FORGE-motion-v5-' + cat.toLowerCase() + '.png';
    fs.writeFileSync(path.join(TMP, 'v5strip.html'), pageFor(cat));
    const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.cwd() + '\\' + TMP + '\\p_v5', 'about:blank'], { stdio: 'ignore' });
    let ws = null, id = 0; const pending = new Map();
    const send = (m, p) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p || {} })); });
    for (let i = 0; i < 80; i++) {
      try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); const pg = l.find(t => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; } } catch (e) {}
      await sleep(250);
    }
    if (!ws) { console.log('FAIL: no CDP'); chrome.kill(); process.exit(1); }
    await new Promise(r => ws.addEventListener('open', r));
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'file:///' + process.cwd().replace(/\\/g, '/') + '/' + TMP + '/v5strip.html' });
    await sleep(1800);
    const size = (await send('Runtime.evaluate', { expression: 'window.__PROBE', returnByValue: true })).result.value;
    if (!size) { console.log('FAIL: probe did not run for ' + cat); chrome.kill(); process.exit(1); }
    await send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('wrote ' + out + '  ' + size.w + 'x' + size.h + '  (' + size.errs + ' errors)');
    chrome.kill();
    await sleep(1200);
    for (let i = 0; i < 5; i++) { try { fs.rmSync(TMP + '/p_v5', { recursive: true, force: true }); break; } catch (e) { await sleep(500); } }
  }
  process.exit(0);
})();
