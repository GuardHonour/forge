/* Verify the DEPLOY over HTTP, which is the only place two things exist at all.
 *
 * Every other suite reads the build from file://, and the app deliberately skips
 * service-worker registration there. So the offline shell, the cache eviction that
 * makes an update land, and the `?fresh=1` redirect a phone takes when APP_BUILD
 * changes have NEVER been exercised by the gate — on the one deploy path that
 * actually reaches the phone. That is the gap this probe closes.
 *
 * It serves the FROZEN _deploy/ bytes on a throwaway localhost origin (NOT the DSH
 * dist subdirectory — a service worker must never be installed on the GUI's own
 * origin), then drives them in Chrome:
 *   1. boots, registers the SW, opens the cache named for THIS build
 *   2. an older cache is evicted on activate, so the new build actually lands
 *   3. a store carrying the OLD forge_build redirects to ?fresh=1 exactly once
 *      (the loop risk is real: the redirect target must not redirect again)
 *   4. with the server STOPPED, the app still boots from the SW cache
 *   5. the new behaviour is present in the served bytes, not just on disk
 *
 * Run: node _probe_sw_http.cjs [dir-with-index.html-and-sw.js]
 */
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\Chrome.exe';
const CHROME_ALT = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
const HTTP_PORT = 8099;
/* defaults to the frozen deploy; any directory holding index.html + sw.js works,
   so this can be pointed at the working tree or a candidate build */
const SRC = process.argv[2] || '_deploy';
const SERVE = '_swserve';
const PROFILE = '_swserve_profile';
const OLD_BUILD = '2026-08-25r';
/* The expected NEW build is read from the staged sw.js, not hardcoded: this probe runs against
   whatever build is being shipped next, and a hardcoded expectation failed every run the moment
   the deployed build moved past 2026-08-25s (4 cascade-failures on a build that was behaving
   exactly right). The OLD_BUILD above is the premise (a real phone's stale state), not an
   expectation — it stays. */
const NEW_BUILD = (fs.readFileSync(SRC + '/sw.js', 'utf8').match(/const BUILD = '([^']+)'/) || [])[1];
if (!NEW_BUILD) { console.log('FAIL: could not read the BUILD constant from ' + SRC + '/sw.js'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
let bad = 0;
const fail = m => { bad++; console.log('  FAIL: ' + m); };
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) bad++; };

/* ---- stage the frozen deploy under its real filenames, so the app's relative
   `sw.js` registration and the SW's `./index.html` both resolve as they will on
   Pages. The icons and manifest are copied too: sw.js tolerates a missing icon,
   but tolerating one is not the same as the shell being complete. ---- */
fs.rmSync(SERVE, { recursive: true, force: true });
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(SERVE, { recursive: true });
if (!fs.existsSync(SRC + '/index.html')) { console.log('FAIL: ' + SRC + '/index.html not found — run node _build_deploy.cjs first'); process.exit(1); }

const COPY = ['manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'favicon-96.png'];
fs.copyFileSync(SRC + '/index.html', SERVE + '/index.html');
fs.copyFileSync(SRC + '/sw.js', SERVE + '/sw.js');
for (const f of COPY) if (fs.existsSync(f)) fs.copyFileSync(f, SERVE + '/' + f);
/* A page on the same origin that does NOT register a service worker, so an old
   cache can be seeded before the real SW ever activates. */
fs.writeFileSync(SERVE + '/blank.html', '<!doctype html><meta charset="utf-8"><title>blank</title>ok');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = SERVE + (p === '/' ? '/index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
  const ext = file.slice(file.lastIndexOf('.'));
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store', 'Content-Length': body.length });
  res.end(body);
});

const CHROME_BIN = fs.existsSync(CHROME) ? CHROME : CHROME_ALT;
let chrome;

(async () => {
  await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));
  const ORIGIN = 'http://127.0.0.1:' + HTTP_PORT;
  console.log('serving the frozen deploy on ' + ORIGIN + ' (a throwaway origin — never the DSH dist root)');

  chrome = spawn(CHROME_BIN, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.cwd() + '\\' + PROFILE,
    'about:blank'], { stdio: 'ignore' });

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
  if (!ws) { console.log('FAIL: could not attach to Chrome'); chrome.kill(); server.close(); process.exit(1); }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });
  await send('Page.enable');
  await send('Runtime.enable');

  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const go = async url => { await send('Page.navigate', { url }); await sleep(2200); };

  try {
    /* ---------- 1. seed an OLD cache and an OLD build marker, then load ---------- */
    await go(ORIGIN + '/blank.html');
    const seeded = await evaluate(`(async function(){
      var c = await caches.open('forge-${OLD_BUILD}');
      await c.put('./index.html', new Response('STALE SHELL FROM THE OLD BUILD'));
      localStorage.setItem('forge_build','${OLD_BUILD}');
      var keys = await caches.keys();
      return {keys: keys, marker: localStorage.getItem('forge_build'),
        stale: (await c.match('./index.html')) !== undefined};
    })()`);
    ok(seeded.keys.includes('forge-' + OLD_BUILD), 'pre-seeded an old cache (' + seeded.keys.join(', ') + ')');
    ok(seeded.stale && seeded.marker === OLD_BUILD, 'and an old forge_build marker, as a real phone would carry');

    /* ---------- 2. load the app: the marker must bump and redirect ONCE ---------- */
    await go(ORIGIN + '/index.html');
    const after = await evaluate(`(function(){
      return {href: location.href, search: location.search,
        marker: localStorage.getItem('forge_build'),
        tabs: document.querySelectorAll('.navb').length,
        build: (document.body.innerHTML.match(new RegExp("${NEW_BUILD.replace(/[-]/g, '\\-')}[a-z]?")) || ['-'])[0],
        errs: (window.__err||[]).length};
    })()`);
    ok(/[?&]fresh=1/.test(after.search), 'an older marker redirects to ?fresh=1 (now at "' + after.search + '")');
    ok(after.marker === NEW_BUILD, 'and the marker is updated to ' + NEW_BUILD + ' (got ' + after.marker + ')');
    ok(after.tabs === 6, 'the app renders all six tabs over HTTP (' + after.tabs + ')');
    /* the loop risk: ?fresh=1 must not itself redirect, or the app never settles */
    await sleep(1200);
    const settled = await evaluate(`location.href`);
    ok(settled === after.href, 'the ?fresh=1 load does NOT redirect again — no loop (' + settled.replace(ORIGIN, '') + ')');

    /* ---------- 3. the service worker registers and owns the cache ---------- */
    const sw = await evaluate(`(async function(){
      if(!navigator.serviceWorker) return {supported:false};
      var regs = await navigator.serviceWorker.getRegistrations();
      var r = regs[0];
      if(r && !r.active) await new Promise(function(res){ r.addEventListener('updatefound',res); setTimeout(res,3000); });
      var keys = await caches.keys();
      var c = await caches.open('forge-${NEW_BUILD}');
      var shell = await c.match('./index.html');
      var doc = shell ? await shell.text() : '';
      return {supported:true, n:regs.length, scope:r?r.scope:'-', active:!!(r&&r.active),
        keys:keys, shellCached:!!shell, shellBytes:doc.length,
        shellBuild:(doc.match(/APP_BUILD='([^']+)'/)||[])[1],
        controllers:navigator.serviceWorker.controller?1:0};
    })()`);
    ok(sw.supported && sw.n >= 1, 'a service worker is registered over HTTP (' + sw.n + ')');
    ok(sw.active, 'and it is active (scope ' + String(sw.scope).replace(ORIGIN, '') + ')');
    ok(sw.keys.includes('forge-' + NEW_BUILD), 'it opened the cache named for THIS build (' + sw.keys.join(', ') + ')');
    ok(!sw.keys.includes('forge-' + OLD_BUILD), 'the OLD cache was evicted on activate — this is what makes an update land');
    ok(sw.shellCached && sw.shellBuild === NEW_BUILD,
      'the cached shell is the new build (' + sw.shellBytes + ' bytes, APP_BUILD ' + sw.shellBuild + ')');

    /* ---------- 4. the new behaviour is in the SERVED bytes ---------- */
    const ui = await evaluate(`(function(){
      S.hist=[{id:'pk1',date:addDays(todayISO(),-3),name:'Upper A',routineId:'upper-a',dur:3600,entries:[
        {id:'bench',sets:[{w:100,r:8},{w:100,r:8},{w:100,r:8}]}]}];
      saveLS(); G.startRoutine('upper-a');
      var pu=document.querySelector('[data-wedit]');
      var pw=null,i;
      for(i=0;i<sess.entries.length;i++) if(sess.entries[i].id==='pullup') pw=i;
      var row=pw===null?null:document.querySelector('[data-row="'+pw+'-0"]');
      var cell=row?row.querySelector('[data-w]'):null;
      /* the pill and the load line must be read from the PULL-UP's own card —
         querying document-wide returns the first card (bench) and asserts the
         wrong exercise's prescription */
      var card=row?row.closest('.xcard'):null;
      var pill=card?card.querySelector('.rxnext'):null;
      var prog=card?card.querySelector('.rxprog'):null;
      return {pullupRow:pw, cellTxt:cell?cell.textContent.trim():'-',
        tappable:cell?cell.getAttribute('data-wedit'):null,
        pill:pill?pill.textContent.trim():'-',
        prog:prog?prog.textContent.trim():'-'};
    })()`);
    ok(/BW/.test(ui.cellTxt), 'the pull-up row reads BW in the served app ("' + ui.cellTxt + '")');
    ok(ui.tappable !== null, 'the weight cell is tappable over HTTP (data-wedit="' + ui.tappable + '")');
    ok(/Today BW/.test(ui.pill), 'the pill says Today BW ("' + ui.pill + '")');
    ok(/All \d+ working sets at BW/.test(ui.prog), 'and the load line states it ("' + ui.prog + '")');
    const tap = await evaluate(`(function(){
      document.querySelector('[data-wedit="'+${JSON.stringify(ui.tappable)}+'"]').click();
      var inp=document.getElementById('wq');
      if(!inp) return {open:false};
      var hint=([].slice.call(document.querySelectorAll('#ovl .shsub'))[1]||{textContent:''}).textContent;
      inp.value='-12.5'; G.weightSet(${ui.pullupRow},0);
      var c=document.querySelector('[data-row="${ui.pullupRow}-0"]').querySelector('[data-w]');
      return {open:true, hintOk:/0 is bodyweight/i.test(hint), cell:c.textContent.trim()};
    })()`);
    ok(tap.open, 'tapping the number opens the weight sheet over HTTP');
    ok(tap.hintOk, 'and the sheet explains 0 = bodyweight / minus = assistance');
    ok(/ASSIST/.test(tap.cell), 'a typed assist renders in the row ("' + tap.cell + '")');

    /* ---------- 5. genuinely offline: stop the server, then reload ---------- */
    await new Promise(r => server.close(r));
    console.log('  (server stopped — the origin is now unreachable)');
    await send('Page.navigate', { url: ORIGIN + '/index.html' }).catch(() => {});
    await sleep(2600);
    const offline = await evaluate(`(function(){
      return {href:location.href, tabs:document.querySelectorAll('.navb').length,
        marker:localStorage.getItem('forge_build'),
        title:(document.querySelector('h1,.logo,.hd')||{textContent:''}).textContent.trim().slice(0,24),
        bodyLen:document.body.innerHTML.length};
    })()`);
    ok(offline.tabs === 6, 'OFFLINE: the app still boots from the service-worker cache (' + offline.tabs + ' tabs, ' + offline.bodyLen + ' bytes of DOM)');
    ok(offline.marker === NEW_BUILD, 'and it is still the ' + NEW_BUILD + ' build while offline');
  } catch (e) {
    fail('probe threw: ' + e.message);
  }

  console.log(bad ? '\nSERVICE WORKER / HTTP CHECK FAILED (' + bad + ')' : '\nSERVICE WORKER / HTTP CHECK CLEAN');
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  await sleep(900);
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(SERVE, { recursive: true, force: true }); fs.rmSync(PROFILE, { recursive: true, force: true }); break; }
    catch (e) { await sleep(600); }
  }
  process.exit(bad ? 1 : 0);
})();
