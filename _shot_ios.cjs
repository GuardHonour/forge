/* iOS safe-area probe.
   FORGE ships `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style:black-translucent`,
   so on a notched/Dynamic-Island iPhone in standalone mode the web content is laid out UNDER the
   status bar and the home indicator. Chrome DevTools Protocol has no way to emulate
   env(safe-area-inset-*) — it is always 0 on desktop — so the app exposes its insets as the
   custom properties `--sat` / `--sab`, and this probe overrides those to the real iPhone values
   and then MEASURES geometry, rather than reading strings.

   Two passes:
     A) real environment (insets 0): the layout at 360/390/430 must be exactly what it was, so the
        safe-area work cannot silently move the desktop/Android layout.
     B) simulated iPhone 15/16 Pro in standalone (sat=59, sab=34): the header must clear the status
        bar, the rest-timer pill and the toasts must clear the taller tab bar, and nothing may
        overflow horizontally.

   `node _shot_ios.cjs [file.html]`  — probes any build (default index.html), so the check can be
   shown to FAIL on the pre-fix build before it is trusted to pass on the fixed one. */
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
const TARGET = process.argv[2] || 'index.html';

/* the notch/Dynamic-Island iPhone values in standalone mode */
const SAT = 59, SAB = 34;

const probe = `<script>
window.__err=[];
window.addEventListener('error',function(e){window.__err.push((e.message||'')+' @'+e.lineno)});
<\/script>`;
const TEMP = '_cdp_probe';
fs.mkdirSync(TEMP, { recursive: true });
const PROBE_URL = 'file:///' + process.cwd().replace(/\\/g, '/') + '/' + TEMP + '/probe_ios.html';
fs.writeFileSync(TEMP + '/probe_ios.html', fs.readFileSync(TARGET, 'utf8').replace('<head>', '<head>' + probe));

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.cwd() + '\\' + TEMP + '\\profile_ios',
  'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* measured in the page: every element that is meant to sit inside the *safe* area, plus the
   fixed overlays that have to clear the tab bar. Reporting raw numbers, not a verdict, keeps
   the failure able to say which box moved. */
const MEASURE = `(function(){
  var out={};
  var px=v=>Math.round(v*10)/10;
  var de=document.documentElement;
  out.sat=(getComputedStyle(de).getPropertyValue('--sat')||'').trim();
  out.sab=(getComputedStyle(de).getPropertyValue('--sab')||'').trim();
  out.vw=window.innerWidth;
  out.docScroll=de.scrollWidth;

  var hdr=document.querySelector('header'), nav=document.getElementById('nav');
  out.hdrTop=px(hdr.getBoundingClientRect().top);
  out.hdrPadTop=getComputedStyle(hdr).paddingTop;
  out.hdrH=px(hdr.getBoundingClientRect().height);
  out.navH=px(nav.getBoundingClientRect().height);
  out.navTop=px(nav.getBoundingClientRect().top);

  /* the boxes the status bar would otherwise sit on top of */
  var boxes=['.logomark','.wordmark','.iconbtn','.streak-chip'];
  out.boxes={};
  boxes.forEach(function(s){
    var el=document.querySelector(s);
    if(!el) { out.boxes[s]=null; return; }
    var r=el.getBoundingClientRect();
    out.boxes[s]={top:px(r.top),bottom:px(r.bottom),h:px(r.height)};
  });

  /* the rest-timer pill, actually rendered, against the actual tab bar */
  var pill=document.getElementById('pill');
  pill.classList.add('on');
  var pr=pill.getBoundingClientRect();
  out.pill={top:px(pr.top),bottom:px(pr.bottom),h:px(pr.height)};
  out.pillOverNav=px(Math.max(0, pr.bottom-nav.getBoundingClientRect().top));
  pill.classList.remove('on');

  var toasts=document.getElementById('toasts');
  out.toastBottom=parseFloat(getComputedStyle(toasts).bottom)||0;
  if(typeof toast==='function') toast('probe');
  var tr=toasts.getBoundingClientRect();
  out.toastTop=px(tr.top);
  if(tr.height>0){ out.toastH=px(tr.height); out.toastOverNav=px(Math.max(0, tr.bottom-nav.getBoundingClientRect().top)); }
  else out.toastH=0;

  out.errors=window.__err.length?window.__err.slice(0,3):[];
  return out;
})()`;

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
      const page = (await r.json()).find(t => t.type === 'page');
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

  const at = async (w, h, sat, sab, extra) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 3, mobile: true });
    await send('Page.navigate', { url: PROBE_URL });
    await sleep(1500);
    if (sat) {
      await send('Runtime.evaluate', {
        expression: `document.documentElement.style.setProperty('--sat','${sat}px');` +
                    `document.documentElement.style.setProperty('--sab','${sab}px');` +
                    (extra || '')
      });
      await sleep(250);
    }
    const r = await send('Runtime.evaluate', { returnByValue: true, expression: MEASURE });
    return r.result.value;
  };

  let bad = 0;
  const fail = m => { bad++; console.log('    FAIL: ' + m); };

  /* ---- pass A: the real environment must be untouched ---- */
  console.log('\nA) real environment (env() = 0, as on desktop and Android) — layout must not move');
  for (const w of [360, 390, 430]) {
    const r = await at(w, 844, 0, 0);
    const hdrTopOK = Math.abs(r.hdrTop - 0) < 0.6;               /* header box still starts at 0 */
    const logoOK = r.hdrPadTop === '14px';                       /* and still carries only its own padding */
    const noOverflow = r.docScroll <= r.vw + 1;
    if (!hdrTopOK || !logoOK) fail(w + 'px: header moved without an inset (hdrTop=' + r.hdrTop + ' paddingTop=' + r.hdrPadTop + ', expected 0 / 14px)');
    if (!noOverflow) fail(w + 'px: horizontal overflow docScroll=' + r.docScroll + ' > vw=' + r.vw);
    if (r.errors.length) fail(w + 'px: JS errors ' + r.errors.join('; '));
    console.log('  ' + String(w).padStart(4) + 'px: hdrTop=' + r.hdrTop + ' paddingTop=' + r.hdrPadTop
      + ' navH=' + r.navH + ' docScroll=' + r.docScroll + '/' + r.vw
      + ' | ' + (hdrTopOK && logoOK && noOverflow && !r.errors.length ? 'CLEAN' : 'BROKEN'));
  }

  /* ---- pass B: a notched iPhone in standalone ---- */
  console.log('\nB) simulated iPhone 15/16 Pro standalone (--sat=' + SAT + 'px, --sab=' + SAB + 'px)');
  const b = await at(393, 852, SAT, SAB);
  console.log('  insets read back: --sat=' + b.sat + ' --sab=' + b.sab);
  console.log('  viewport 393x852  header: top=' + b.hdrTop + ' h=' + b.hdrH + '   nav: top=' + b.navTop + ' h=' + b.navH);
  for (const k of ['.logomark', '.wordmark', '.iconbtn', '.streak-chip']) {
    const x = b.boxes[k];
    console.log('    ' + k.padEnd(13) + (x ? 'top=' + x.top + ' bottom=' + x.bottom : 'MISSING'));
  }
  console.log('  rest-timer pill: top=' + b.pill.top + ' bottom=' + b.pill.bottom
    + '  overlap onto tab bar = ' + b.pillOverNav + 'px');
  console.log('  toasts: computed bottom=' + b.toastBottom + ' rendered top=' + b.toastTop
    + ' h=' + b.toastH + (b.toastOverNav ? '  overlap onto tab bar = ' + b.toastOverNav + 'px' : ''));

  /* the assertion that actually matters: no app control may share a pixel with the status bar */
  const statusBand = SAT;
  for (const k of ['.logomark', '.wordmark', '.iconbtn', '.streak-chip']) {
    const x = b.boxes[k];
    if (!x) { fail('B: ' + k + ' not found'); continue; }
    if (x.top < statusBand) fail('B: ' + k + ' top=' + x.top + 'px is inside the ' + statusBand + 'px status-bar band');
  }
  if (b.pillOverNav > 0.5) fail('B: rest-timer pill overlaps the tab bar by ' + b.pillOverNav + 'px (pill bottom=' + b.pill.bottom + ', nav top=' + b.navTop + ')');
  if (b.toastH > 0 && b.toastOverNav > 0.5) fail('B: toast overlaps the tab bar by ' + b.toastOverNav + 'px');
  if (b.docScroll > b.vw + 1) fail('B: horizontal overflow docScroll=' + b.docScroll + ' > vw=' + b.vw);
  if (b.errors.length) fail('B: JS errors ' + b.errors.join('; '));

  /* the low rim of the pill must still be on screen and above the home indicator */
  const pillInside = b.pill.top > 0 && b.pill.bottom < 852;
  if (!pillInside) fail('B: rest-timer pill is off-screen (top=' + b.pill.top + ', bottom=' + b.pill.bottom + ')');

  /* screenshots for the eye: with and without the simulated island */
  await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
  await send('Page.navigate', { url: PROBE_URL });
  await sleep(1600);
  const shotFlat = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_ios_393_noinset.png', Buffer.from(shotFlat.data, 'base64'));
  await send('Runtime.evaluate', {
    expression: `document.documentElement.style.setProperty('--sat','${SAT}px');document.documentElement.style.setProperty('--sab','${SAB}px');` +
                `document.getElementById('pill').classList.add('on');toast('Rest 1:30 — set 2 of 3 logged');`
  });
  await sleep(400);
  const shotIsland = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_ios_393_island.png', Buffer.from(shotIsland.data, 'base64'));

  console.log('\n' + (bad ? 'iOS SAFE-AREA CHECK FAILED (' + bad + ' problem' + (bad === 1 ? '' : 's') + ') on ' + TARGET
                        : 'iOS SAFE-AREA CHECK CLEAN on ' + TARGET));
  chrome.kill();
  await sleep(1200);
  for (let i = 0; i < 5; i++) { try { fs.rmSync(TEMP, { recursive: true, force: true }); break; } catch (e) { await sleep(600); } }
  process.exit(bad ? 1 : 0);
})();
