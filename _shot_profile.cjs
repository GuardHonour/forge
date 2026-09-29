/* Screenshot the calibration surfaces at real phone width: the profile sheet and
   the strength-standards card that asks for the comparison table. Both were
   reachable-but-unanswerable before, so this is the visual proof they are not.
   Run: node _shot_profile.cjs   → _profile.png, _profile_standards.png */
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const TEMP = '_profile_shot';

const probe = `<script>
window.__err=[];
window.addEventListener('error',function(e){window.__err.push((e.message||'')+' @'+e.lineno)});
<\/script>`;
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
  await send('Page.enable'); await send('Runtime.enable');
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  let bad = 0;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1400, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: PROBE_URL });
  await sleep(1400);

  /* the profile sheet */
  const profile = await evaluate(`(function(){
    G.openProfile();
    var o=document.getElementById('ovl');
    var box=o.querySelector('.sheet')||o;
    if(box.scrollHeight>box.clientHeight)box.scrollTop=box.scrollHeight;
    return {vw:window.innerWidth,scroll:box.scrollWidth,client:box.clientWidth,
      docScroll:document.documentElement.scrollWidth,
      copy:box.textContent,
      src:({len:openProfile.toString().length,inOvl:o.innerHTML.indexOf('EFFORT TARGET')>=0,inCmp:o.innerHTML.indexOf('COMPARISON TABLE')>=0}),
      copyLen:box.textContent.length,tail:box.textContent.slice(-160),
      ovlLen:o.innerHTML.length,sheets:o.querySelectorAll('.sheet').length,errors:(window.__err||[]).slice(0,3)};
  })()`);
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_profile.png', Buffer.from(shot.data, 'base64'));

  /* the standards card, with nothing set yet */
  const standards = await evaluate(`(function(){
    G.closeModal();
    prof().onboarded=true; prof().standardsOn=true; prof().sex=null; prof().bw=null; S.bwLog=[]; saveLS();
    G.nav('prog');
    var sec=document.querySelector('main');
    var html=sec.innerHTML;
    var chip=html.indexOf('Male classes')>=0&&html.indexOf('Female classes')>=0;
    /* tap the chip the way a user would, then check it took */
    var btns=sec.querySelectorAll('.fchip');
    var female=null;
    for(var i=0;i<btns.length;i++){if(/Female classes/.test(btns[i].textContent))female=btns[i]}
    if(female)female.click();
    var took=prof().sex;
    /* and now give it a bodyweight so the bands render */
    prof().bw=80; S.bwLog=[{date:todayISO(),kg:80}]; saveLS(); G.nav('prog');
    var chipEl=document.querySelector('.fchip');
    var card=chipEl?chipEl.closest('.card'):null;
    if(card)card.scrollIntoView({block:'center'});
    var after=document.querySelector('main').innerText;
    return {sex:took,chipsPresent:chip,docScroll:document.documentElement.scrollWidth,
      bands:/class · /.test(after) || /kg class/.test(after), cardFound:!!card, cardText:card?card.textContent.slice(0,420):'', text:after.slice(0,700), errors:(window.__err||[]).slice(0,3)};
  })()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 3000, deviceScaleFactor: 1, mobile: true });
  await evaluate("(function(){var m=document.querySelector('main');if(m)m.scrollTop=m.scrollHeight;return 1})()");
  await sleep(300);
  shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync('_profile_standards.png', Buffer.from(shot.data, 'base64'));

  console.log('  PROFILE SHEET');
  console.log('    width ' + profile.client + '/' + profile.scroll + ' docScroll=' + profile.docScroll + '/' + profile.vw
    + (profile.scroll > profile.client + 1 || profile.docScroll > profile.vw + 1 ? '  OVERFLOW' : '  FITS'));
  ['GOAL', 'EXPERIENCE', 'SESSIONS PER WEEK', 'EFFORT TARGET', 'BODYWEIGHT', 'COMPARISON TABLE', 'AREAS TO ROUTE AROUND']
    .forEach(k => console.log('    ' + (profile.copy.indexOf(k) >= 0 ? 'has ' : 'MISSING ') + k));
  const still = (profile.copy.match(/Still missing: [^\n]*/) || ['Still missing: (none)'])[0];
  console.log('    ' + still);
  console.log('    effect lines: ' + (profile.copy.match(/Graded|Scales|grades|Adds a point|Only strength/g) || []).length);
  console.log('    ovl has EFFORT TARGET=' + profile.src.inOvl + ' COMPARISON TABLE=' + profile.src.inCmp + ' srcLen=' + profile.src.len + ' ovlLen=' + profile.ovlLen + ' sheets=' + profile.sheets + ' copyLen=' + profile.copyLen);
  console.log('    tail: ' + JSON.stringify(profile.tail));
  console.log('  COMPARISON TABLE FROM THE STANDARDS CARD');
  console.log('    chips present=' + standards.chipsPresent + '  tapping "Female classes" stored sex=' + JSON.stringify(standards.sex)
    + '  bands render=' + standards.bands);
  console.log('    card found=' + standards.cardFound + '  docScroll=' + standards.docScroll + '/' + profile.vw);
  console.log('    ' + JSON.stringify(standards.cardText).slice(0,700));
  if (profile.errors.length || standards.errors.length) { bad++; console.log('    ERRORS: ' + profile.errors.concat(standards.errors).join('; ')); }
  if (!standards.chipsPresent || standards.sex !== 'f') { bad++; console.log('    FAIL: the comparison table is not settable from the card that asks for it'); }
  if (profile.scroll > profile.client + 1) { bad++; console.log('    FAIL: the profile sheet overflows horizontally'); }

  console.log(bad ? '\nPROFILE CHECK FAILED (' + bad + ')' : '\nPROFILE CHECK CLEAN');
  chrome.kill();
  await sleep(1200);
  for (let i = 0; i < 5; i++) { try { fs.rmSync(TEMP, { recursive: true, force: true }); break; } catch (e) { await sleep(600); } }
  process.exit(bad ? 1 : 0);
})();