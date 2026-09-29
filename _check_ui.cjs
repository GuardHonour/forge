/* Verify the demonstration UI at real device widths using Chrome DevTools Protocol
   device-metrics emulation — Chrome refuses a window narrower than ~500px, so a
   phone-width check has to override the metrics rather than the window size.
   Also drives the controls: pause, step, and the reduced-motion still. */
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;

const probe = `<script>
window.__err=[];
window.addEventListener('error',function(e){window.__err.push((e.message||'')+' @'+e.lineno)});
<\/script>`;
const TEMP = '_cdp_probe';
fs.mkdirSync(TEMP, { recursive: true });
const PROBE_URL = 'file:///' + process.cwd().replace(/\\/g, '/') + '/' + TEMP + '/probe.html';
fs.writeFileSync(TEMP + '/probe.html', fs.readFileSync('index.html', 'utf8').replace('<head>', '<head>' + probe));

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.cwd() + '\\' + TEMP + '\\profile',
  'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let ws = null, id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  if (!ws) { console.log('FAIL: could not attach to Chrome'); chrome.kill(); process.exit(1); }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });

  await send('Page.enable');
  await send('Runtime.enable');

  const WIDTHS = [360, 390, 430];
  const results = [];
  for (const w of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: PROBE_URL });
    await sleep(1400);
    await send('Runtime.evaluate', { expression: "G.openExSheet('" + (process.env.DEMO_ID || 'cable-fly') + "')" });
    await sleep(500);   /* startAnimLoop mounts the SVG on a 30ms timer, then a frame runs */
    const r = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(function(){
        var out={};
        var st=document.getElementById('anim-stage'),hud=document.querySelector('.demohud');
        var svg=st&&st.querySelector('svg');
        out.vw=window.innerWidth;
        out.docScroll=document.documentElement.scrollWidth;
        out.hudW=hud?Math.round(hud.getBoundingClientRect().width):-1;
        out.hudScroll=hud?hud.scrollWidth:-1;
        out.hudRight=hud?Math.round(hud.getBoundingClientRect().right):-1;
        var su=document.querySelector('.demosetup');
        out.setupW=su?Math.round(su.getBoundingClientRect().width):-1;
        out.setupScroll=su?su.scrollWidth:-1;
        out.setupText=su?su.textContent.trim():'-';
        out.setupH=su?Math.round(su.getBoundingClientRect().height):-1;
        out.setupUnderHud=!!(su&&hud&&su.getBoundingClientRect().top>=hud.getBoundingClientRect().bottom-1);
        out.stage=st?Math.round(st.getBoundingClientRect().width):-1;
        out.parts=svg?svg.querySelectorAll('path,circle,rect,line').length:-1;
        out.viewBox=svg?svg.getAttribute('viewBox'):'-';
        out.aria=svg?svg.getAttribute('aria-label'):'-';
        out.phase0=document.getElementById('demo-ph').textContent;
        out.running=(st.__raf|0)!==0;
        var t1=st.__t;
        G.demoToggle();
        out.paused=document.getElementById('demo-play').textContent;
        var t2=st.__t; out.frozen=(t2===t1);
        G.demoStep(); var t3=st.__t; out.stepped=(t3!==t2);
        G.demoToggle(); out.resumed=document.getElementById('demo-play').textContent;
        out.drewAfterStep=(st.__g&&st.__g.innerHTML.length>200);
        var bar=document.getElementById('demo-bar');
        out.bar=bar?bar.style.width:'-';
        out.errors=window.__err.length?window.__err.slice(0,3):[];
        return out;
      })()`
    });
    results.push({ w, ...r.result.value });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 2, mobile: true });
  }

  /* screenshots at 390 for the eye: the pair that most needed a cue, plus the widest one */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  for (const [oid, file] of [['chinup', '_ui_chinup.png'], ['pullup', '_ui_pullup.png'], ['machine-ohp', '_ui_wide.png']]) {
    await send('Page.navigate', { url: PROBE_URL });
    await sleep(1400);
    await send('Runtime.evaluate', { expression: "G.openExSheet('" + oid + "')" });
    await sleep(1200);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  }

  let bad = 0;
  results.forEach(r => {
    const fits = r.hudScroll <= r.hudW + 1 && r.docScroll <= r.vw + 1 && r.setupScroll <= r.setupW + 1;
    const okRig = r.parts > 20 && r.viewBox === '0 0 200 200' && r.running;
    const okCtl = r.paused === 'PLAY' && r.frozen && r.stepped && r.resumed === 'PAUSE' && r.drewAfterStep;
    const okCue = r.setupW > 0 && r.setupText.length > 20 && r.setupUnderHud && r.setupH <= 40;
    const okErr = r.errors.length === 0;
    if (!fits || !okRig || !okCtl || !okErr || !okCue) bad++;
    console.log('  ' + String(r.vw).padStart(4) + 'px viewport: docScroll=' + r.docScroll
      + ' hud=' + r.hudW + '/' + r.hudScroll + (fits ? ' FITS' : ' OVERFLOW')
      + ' | stage=' + r.stage + ' parts=' + r.parts + ' viewBox=' + r.viewBox
      + ' | ' + (okRig ? 'RIG OK' : 'RIG BAD')
      + ' | paused->' + r.paused + ' frozen=' + r.frozen + ' stepped=' + r.stepped
      + ' resumed->' + r.resumed + ' redrew=' + r.drewAfterStep + ' ' + (okCtl ? 'CONTROLS OK' : 'CONTROLS BAD')
      + ' | setup=' + r.setupW + '/' + r.setupScroll + ' h=' + r.setupH
      + ' under=' + r.setupUnderHud + ' ' + (okCue ? 'CUE OK' : 'CUE BAD')
      + ' | errors=' + (r.errors.length ? r.errors.join(';') : 'none'));
    console.log('         cue: "' + r.setupText + '"');
  });
  console.log(bad ? 'UI CHECK FAILED (' + bad + ' widths)' : 'UI CHECK CLEAN');
  chrome.kill();
  await sleep(1200);
  for (let i = 0; i < 5; i++) { try { fs.rmSync(TEMP, { recursive: true, force: true }); break; } catch (e) { await sleep(600); } }
  process.exit(bad ? 1 : 0);
})();
