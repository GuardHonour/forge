/* Verify the PUBLISHED pages actually work when served over http://127.0.0.1:3080 —
   loading is not the same as working. Drives the real URL in Chrome and checks that the
   app boots, a demo animates, the SET UP cue is present, and nothing 404s or throws.
   Also proves no service worker installed on the host origin (which could hijack the
   DSH GUI's own assets). */
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const BASE = process.env.BASE || 'http://127.0.0.1:3080/forge/';
const TEMP = '_cdp_served';

fs.rmSync(TEMP, { recursive: true, force: true });
fs.mkdirSync(TEMP, { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.cwd() + '\\' + TEMP + '\\profile',
  'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let ws = null, id = 0; const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const page = (await r.json()).find(t => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch (e) {}
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
  await send('Network.enable');

  const failed = [];
  const jsErrors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      failed.push(m.params.response.status + ' ' + m.params.response.url.replace('http://127.0.0.1:3080', ''));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      jsErrors.push((d.exception && d.exception.description) || d.text || 'unknown');
    }
  });

  const probe = `(function(){
    var out={};
    out.url=location.href;
    out.title=document.title;
    out.nav=!!document.querySelector('#nav');
    out.tabs=document.querySelectorAll('#nav > *').length;
    out.hasG=typeof G==='object';
    out.exercises=(typeof EXS!=='undefined')?EXS.length:-1;
    out.rigs=(typeof ANIMS!=='undefined')?Object.keys(ANIMS).length:-1;
    G.openExSheet('pullup');
    return out;
  })()`;

  async function visit(url, probeFn, wait) {
    await send('Page.navigate', { url });
    await sleep(wait);
    const r = await send('Runtime.evaluate', { returnByValue: true, expression: probeFn });
    return r.result.value;
  }

  const app = await visit(BASE + 'index.html', probe, 2200);
  /* startAnimLoop mounts the SVG on a ~30ms timer and the first frame lands after
     that — measuring immediately reports parts=-1 on a page that is perfectly fine. */
  await sleep(800);
  const after = await send('Runtime.evaluate', {
    returnByValue: true, expression: `(function(){
      var out={};
      var st=document.getElementById('anim-stage'), svg=st&&st.querySelector('svg');
      out.parts=svg?svg.querySelectorAll('path,circle,rect,line').length:-1;
      out.phase=document.getElementById('demo-ph')?document.getElementById('demo-ph').textContent:'-';
      var su=document.querySelector('.demosetup');
      out.cue=su?su.textContent.trim():'-';
      out.playing=(st&&st.__raf|0)!==0;
      var t1=st&&st.__t; G.demoStep(); var t2=st&&st.__t;
      out.stepped=(t1!==undefined&&t2!==t1);
      out.sheetOpen=!!document.querySelector('.demohud');
      return out;
    })()`
  });
  Object.assign(app, after.result.value);

  const appShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_served_app.png', Buffer.from(appShot.data, 'base64'));

  const prev = process.env.PREVIEW === '0' ? null : await visit(BASE + 'preview.html', `(function(){
    return { title:document.title, svgs:document.querySelectorAll('svg').length,
             bars:document.querySelectorAll('i').length,
             text:(document.body.innerText||'').slice(0,90).replace(/\\s+/g,' ') };
  })()`, 2500);

  const sw = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `navigator.serviceWorker.getRegistrations().then(r=>r.length)` , awaitPromise: true
  });

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_served_preview.png', Buffer.from(shot.data, 'base64'));

  console.log('APP   ' + BASE + (process.env.PAGE || 'index.html'));
  console.log('      nav=' + app.nav + ' tabs=' + app.tabs + ' G=' + app.hasG
    + ' exercises=' + app.exercises + ' rigs=' + app.rigs);
  console.log('      demo: sheetOpen=' + app.sheetOpen + ' parts=' + app.parts
    + ' playing=' + app.playing + ' stepped=' + app.stepped + ' phase="' + app.phase + '"');
  console.log('      cue: ' + app.cue);
  if (prev) {
    console.log('PREVIEW ' + BASE + 'preview.html');
    console.log('      svgs=' + prev.svgs + ' progressBars=' + prev.bars + ' title="' + prev.title + '"');
    console.log('      text: ' + prev.text);
  } else {
    console.log('PREVIEW skipped (this deployment has no preview.html)');
  }
  console.log('service workers registered on this origin: ' + sw.result.value
    + ' (expected ' + (process.env.EXPECT_SW || '0') + ')');
  console.log('failed requests: ' + (failed.length ? failed.join(', ') : 'none'));
  console.log('JS errors: ' + (jsErrors.length ? jsErrors.join(' | ') : 'none'));
  chrome.kill();
  await sleep(1200);
  for (let i = 0; i < 5; i++) { try { fs.rmSync(TEMP, { recursive: true, force: true }); break; } catch (e) { await sleep(600); } }
})();
