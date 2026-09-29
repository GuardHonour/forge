/* FORGE · LIVE DEPLOY VERIFICATION — is the app a human opens actually running this build?
 *
 * `_verify_served.cjs` proves the DSH-served copy boots; this proves the DEPLOYED app does —
 * the GitHub Pages origin the phone's installed PWA lives on. It answers the only question that
 * matters after a deploy, in two independent ways:
 *
 *   1. BYTES. It downloads the live document and `sw.js` and compares their sha256 and build
 *      markers against the files in this working copy. If those hashes match, what is served IS
 *      what was tested here — not a stale Pages cache, not last week's shell behind a service
 *      worker. It also asserts the two markers agree, because a doc served at one build with a
 *      worker tagged at another is exactly how an installed copy updates forever and never
 *      changes.
 *   2. RENDER. It drives the live URL in headless Chrome at 390px, seeds the app's own demo
 *      history IN THAT PAGE (a throwaway profile — the user's log is untouched), and measures the
 *      surfaces that were fixed: the consistency grid must be a real calendar with the average
 *      annotation in the chart's left gutter, sharing zero pixels with any bar.
 *
 * A browser check on an EMPTY log is also run first, because that is what a fresh visitor sees and
 * a crash there would be invisible to every other suite.
 *
 * Run: node _verify_live.cjs [url]     → _live_prog.png
 */
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const TARGET = process.argv[2] || 'https://guardhonour.github.io/forge/index.html';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const TEMP = '_live_shot';

const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
/* Compare the served bytes against the PUBLISHED COMMIT, never the working tree. The tree is
   routinely ahead of what was deployed — another agent edits `index.html` while a deploy is in
   flight — so a working-copy comparison calls a perfectly good deploy a mismatch. `origin/main`
   is the commit Pages builds from, which is the thing the served bytes must equal. */
const gitBlob = spec => { try { return execFileSync('git', ['show', spec], { maxBuffer: 64 * 1024 * 1024 }); } catch (e) { return null; } };
const REF = process.env.FORGE_REF || 'origin/main';
const local = gitBlob(REF + ':index.html') || fs.readFileSync('index.html');
const localSw = gitBlob(REF + ':sw.js') || fs.readFileSync('sw.js');
const marker = (s, re) => (s.match(re) || [])[1] || null;
const LOCAL_BUILD = marker(local.toString('utf8'), /const APP_BUILD='([^']+)'/);
const LOCAL_SW_BUILD = marker(localSw.toString('utf8'), /const BUILD = '([^']+)'/);

let bad = 0;
const ok = (cond, label) => { if (cond) console.log('  PASS ' + label); else { bad++; console.log('  FAIL ' + label); } };

const MEASURE = `(function(){
  function ov(a,b){var w=Math.min(a.right,b.right)-Math.max(a.left,b.left);var h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);return(w>0&&h>0)?Math.round(w*h):0}
  var out={w:window.innerWidth,scroll:document.documentElement.scrollWidth,errors:(window.__err||[]).slice(0,3),
    tabs:document.querySelectorAll('#nav button').length,inert:document.body.innerHTML.length};
  var dow=document.querySelectorAll('.hdow'), cells=document.querySelectorAll('.hcell');
  /* the Progress tab is not the landing tab, so on a fresh load these are absent — MEASURE must
     report that rather than throw, or the empty-log check dies before it says anything */
  var heatEl=document.querySelector('.heat');
  out.cal={present:!!heatEl,dows:dow.length,cells:cells.length,letters:[].map.call(dow,function(d){return d.textContent}).join(''),
    ringed:document.querySelectorAll('.hcell.htoday').length,
    future:document.querySelectorAll('.hcell.hfut').length,
    weekLabels:document.querySelectorAll('.hwl').length,
    overflow:heatEl?Math.round(heatEl.getBoundingClientRect().right-heatEl.parentElement.getBoundingClientRect().right):0};
  var svg=document.querySelector('.chart');
  out.chart=null;
  if(svg){
    var k=svg.querySelector('.avgk'),v=svg.querySelector('.avgv');
    /* MAP TO RECTS. These are SVG elements, not DOMRects: .left on an SVGRectElement is
       undefined, so every overlap computed from them came out NaN — which CDP hands back as
       null, making "covered === 0" pass vacuously on any app, broken or not. */
    var bars=[].slice.call(svg.querySelectorAll('rect.bar,rect.bar-cur')).map(function(r){return r.getBoundingClientRect()});
    if(k&&v&&bars.length){
      var svgBox=svg.getBoundingClientRect();
      var kB=k.getBoundingClientRect(),vB=v.getBoundingClientRect();
      var g={left:Math.min(kB.left,vB.left),right:Math.max(kB.right,vB.right),top:kB.top,bottom:vB.bottom};
      out.chart={label:k.textContent+' '+v.textContent,bars:bars.length,
        covered:bars.reduce(function(a,b){return a+ov(g,b)},0),
        gutterRight:Math.round(g.right-svgBox.left),firstBar:Math.round(bars[0].left-svgBox.left),
        clear:bars.every(function(b){return ov(g,b)===0})};
    } else { out.chart={label:(k&&v)?(k.textContent+' '+v.textContent):'none',bars:bars.length}; }
  }
  out.heat=document.querySelector('.heat')?document.querySelector('.heat').textContent.replace(/\\s+/g,' ').slice(0,90):'';
  out.head=(function(){var h=document.querySelector('.hsum');return h?h.textContent.replace(/\\s+/g,' ').slice(0,110):''})();
  return out;
})()`;

(async () => {
  console.log('FORGE · LIVE DEPLOY CHECK — ' + TARGET);
  console.log('  published ' + REF + ' build ' + LOCAL_BUILD + ' (sw ' + LOCAL_SW_BUILD + ')  sha ' + sha(local).slice(0, 16) + '...');

  /* ---------- 1. BYTES ---------- */
  let html = null, sw = null;
  try {
    const r = await fetch(TARGET + (TARGET.indexOf('?') < 0 ? '?cb=' + Date.now() : ''), { cache: 'no-store' });
    html = Buffer.from(await r.arrayBuffer());
    const r2 = await fetch(new URL('sw.js', TARGET).href + '?cb=' + Date.now(), { cache: 'no-store' });
    sw = Buffer.from(await r2.arrayBuffer());
  } catch (e) { console.log('  FAIL could not fetch the live app: ' + e.message); process.exit(1); }

  const liveBuild = marker(html.toString('utf8'), /const APP_BUILD='([^']+)'/);
  const liveSwBuild = marker(sw.toString('utf8'), /const BUILD = '([^']+)'/);
  console.log('  live  build ' + liveBuild + ' (sw ' + liveSwBuild + ')  sha ' + sha(html).slice(0, 16) + '...');
  ok(sha(html) === sha(local), 'the served document is byte-identical to the published commit (' + REF + ')');
  ok(sha(sw) === sha(localSw), 'the served sw.js is byte-identical to the published commit (' + REF + ')');
  ok(liveBuild === LOCAL_BUILD, 'the live APP_BUILD matches the published build (' + liveBuild + ')');
  ok(liveSwBuild === liveBuild, 'the served worker is tagged with the same build as the document (a mismatch pins installed copies forever)');

  /* THE CHECK THAT STOPS THIS FILE GIVING A FALSE CLEAN.
   *
   * Comparing live against `origin/main` answers "is what Pages serves the committed
   * code?" — which is NOT the question "did the build I just packaged get deployed?".
   * When a deploy is staged but not yet uploaded, `origin/main` and Pages BOTH still
   * hold the OLD build, so every assertion above passes and the run reports CLEAN
   * while the fix sits undeployed. That is a check that cannot fail in exactly the
   * situation it is needed, so the packaged build is compared against live directly.
   *
   * Set FORGE_REF=HEAD (or the deploy commit) to verify the bytes instead of the
   * published ref; the guard below is what makes the DEFAULT run honest. */
  try {
    if (fs.existsSync('_deploy/index.html')) {
      const stagedBuild = marker(fs.readFileSync('_deploy/index.html', 'utf8'), /const APP_BUILD='([^']+)'/);
      console.log('  packaged build ' + stagedBuild + ' (_deploy/, the bytes to be uploaded)');
      ok(liveBuild === stagedBuild,
        'the PACKAGED build (' + stagedBuild + ') is the one Pages serves, not just the '
        + 'published ref (' + REF + ' = ' + LOCAL_BUILD + ') — if this FAILS the fix is NOT live yet');
    } else {
      console.log('  (no _deploy/ staged — skipping the packaged-build guard)');
    }
  } catch (e) { console.log('  (packaged-build guard skipped: ' + e.message + ')'); }

  /* ---------- 2. RENDER ---------- */
  fs.mkdirSync(TEMP, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.cwd() + '\\' + TEMP + '\\prof', 'about:blank'], { stdio: 'ignore' });
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let ws = null, id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  for (let i = 0; i < 60; i++) {
    try { const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = list.find(t => t.type === 'page'); if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; } } catch (e) {}
    await sleep(250);
  }
  if (!ws) { console.log('  FAIL could not attach to Chrome'); chrome.kill(); process.exit(1); }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });
  await send('Page.enable'); await send('Runtime.enable');
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  /* no `__err` hook is injected here on purpose: this is the real deployed document, byte for
     byte, so the probe must not modify what it is verifying. Listen on the protocol instead. */
  const errs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.text || '') + ' ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || ''));
  });

  await send('Page.navigate', { url: TARGET });
  await sleep(3000);
  /* the app lands on Train; the surfaces under test live in Progress (G.nav is throttled, so
     this is called once and the sleep below absorbs the window) */
  await evaluate('(function(){if(window.G&&G.nav)G.nav("prog");return 1})()');
  await sleep(500);
  const empty = await evaluate(MEASURE);
  console.log('\n  EMPTY LOG (what a fresh visitor gets)');
  console.log('    tabs=' + empty.tabs + '  calendar ' + empty.cal.dows + 'x' + empty.cal.cells + ' letters "' + empty.cal.letters + '"  body ' + empty.inert + ' chars');
  ok(empty.tabs === 6, 'the shell rendered 6 tabs');
  ok(empty.cal.dows === 7 && empty.cal.cells === 56, 'the calendar rendered 56 cells on an empty log (' + empty.cal.dows + 'x' + empty.cal.cells + ')');
  ok(empty.cal.letters === 'MTWTFSS', 'the weekday column reads M T W T F S S (letters "' + empty.cal.letters + '")');
  ok(empty.cal.ringed === 1, 'today is ringed exactly once even with no data');

  /* the app's own demo generator, in a throwaway profile, to measure the fixed surfaces */
  await evaluate('(function(){window.confirm=function(){return true};G.regen();G.nav("prog");return 1})()');
  await sleep(600);
  const live = await evaluate(MEASURE);
  if (live.chart) {
    console.log('\n  PROGRESS WITH HISTORY');
    console.log('    calendar ' + live.cal.cells + ' cells, ' + live.cal.weekLabels + ' week columns, not-yet=' + live.cal.future + ', ringed=' + live.cal.ringed + ', grid overflow=' + live.cal.overflow + 'px');
    console.log('    average label "' + live.chart.label + '" over ' + live.chart.bars + ' bars: covered=' + (live.chart.covered === undefined ? 'n/a' : live.chart.covered + 'px\u00b2') + '  gutter right=' + live.chart.gutterRight + ' < first bar ' + live.chart.firstBar);
    console.log('    head: ' + live.head);
    ok(live.cal.dows === 7 && live.cal.cells === 56, 'the deployed calendar is a 7x8 grid');
    ok(live.cal.weekLabels === 8, 'the deployed calendar has 8 week columns');
    ok(live.cal.overflow <= 0, 'the deployed calendar does not overflow its card');
    if (live.chart.covered !== undefined) {
      ok(live.chart.bars > 0 && Number.isFinite(live.chart.firstBar), 'the chart\'s bars were measurable (' + live.chart.bars + ' bars)');
      ok(live.chart.covered === 0 && live.chart.clear, 'no bar shares a pixel with the average label on the live app');
      ok(live.chart.gutterRight <= live.chart.firstBar, 'the average label sits left of the first bar');
      ok(/^AVG /.test(live.chart.label), 'the average annotation reads AVG on the live app');
    } else { console.log('  note: no bars rendered, average-label geometry not measurable in this state'); }
    ok(/Last session/.test(live.head), 'the live card states when the last session was');
  } else { bad++; console.log('  FAIL the Progress surfaces did not render on the live app'); }
  await evaluate("(function(){var e=document.querySelector('.heat');if(e)e.scrollIntoView({block:'center'});return 1})()");
  await sleep(250);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_live_prog.png', Buffer.from(s.data, 'base64'));

  /* the mechanism that updates an installed copy */
  const swReg = await evaluate("navigator.serviceWorker.getRegistrations().then(function(r){return r.length})");
  ok(swReg >= 1, 'the deployed origin registered a service worker (' + swReg + ') — this is what replaces the phone\'s cached shell');

  ok(errs.length === 0, 'no uncaught exception on the live app' + (errs.length ? ': ' + errs.join(' | ') : ''));

  console.log(bad ? '\nLIVE DEPLOY CHECK FAILED (' + bad + ')' : '\nLIVE DEPLOY CHECK CLEAN — the app at ' + TARGET + ' is build ' + liveBuild + ', and it renders the fixed surfaces');
  chrome.kill();
  await sleep(1200);
  for (let i = 0; i < 5; i++) { try { fs.rmSync(TEMP, { recursive: true, force: true }); break; } catch (e) { await sleep(600); } }
  process.exit(bad ? 1 : 0);
})();
