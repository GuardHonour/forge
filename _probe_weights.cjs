/* What weights can a lifter ACTUALLY reach, in the real UI?
   Answers two reported bugs by driving the app, not by reading the source:
     1. a light dumbbell (4 / 6 kg) — is it selectable at all?
     2. a pull-up with no added weight — can a bodyweight set be logged?
   Reads the rendered value out of the DOM, which is what the user sees. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9343;
const APP = 'file:///' + path.join(process.cwd(), 'index.html').replace(/\\/g, '/');
const TEMP = '_cdp_weights';

fs.rmSync(TEMP, { recursive: true, force: true });
fs.mkdirSync(TEMP, { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(process.cwd(), TEMP, 'profile'),
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
  if (!ws) { console.log('FAIL: no Chrome'); chrome.kill(); process.exit(1); }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });
  await send('Page.enable'); await send('Runtime.enable');

  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + expr + '})()', returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };

  await send('Page.navigate', { url: APP });
  await sleep(3500);

  console.log('app: ' + APP.replace(process.cwd().replace(/\\/g, '/'), '.'));
  console.log('booted: ' + JSON.stringify(await ev('return {G:typeof G, exs:(typeof EXS!=="undefined")?EXS.length:-1}')));

  /* list every exercise the app knows, with the increment it will actually step by */
  console.log('\n=== declared increments (from the app itself) ===');
  console.log(JSON.stringify(await ev(`
    var out={};
    (typeof EXS!=="undefined"?EXS:[]).forEach(function(e){ out[e.n]= (e.def&&e.def.inc)+''; });
    return out;`), null, 0));

  /* start a session that contains a dumbbell press and a pull-up */
  await ev("G.startRoutine('upper-a'); return 1");
  await sleep(1500);

  const dump = async label => {
    const s = await ev(`
      var rows=[];
      document.querySelectorAll('[data-row]').forEach(function(r){
        var card=r.closest('.card,.excard,[class*=ex]')||r.parentElement;
        var nm='';
        var h=card.querySelector('.xname,.exname,h3,.ttl,.ex-t')||card;
        nm=(h.textContent||'').trim().split('\\n')[0].slice(0,30);
        var w=r.querySelector('[data-w]'), rp=r.querySelector('[data-r]');
        rows.push({row:r.getAttribute('data-row'), ex:nm, w:w?w.textContent.trim():null, r:rp?rp.textContent.trim():null, done:!!r.querySelector('[class*=done],[aria-checked=true]')});
      });
      return rows;`);
    console.log('\n--- ' + label + ' ---');
    if (s && s.__err) { console.log('  ERR ' + s.__err); return []; }
    (s || []).slice(0, 10).forEach(x => console.log('  row ' + String(x.row).padEnd(5) + ' w=' + String(x.w).padEnd(12) + ' r=' + String(x.r).padEnd(8) + ' ' + x.ex));
    return s || [];
  };

  await dump('after startRoutine(upper-a)');

  /* ---- bug 1: can the dumbbell weight reach 4 and 6? ---- */
  const firstRow = await ev(`
    var rows=document.querySelectorAll('[data-row]');
    for(var i=0;i<rows.length;i++){
      var card=rows[i].closest('.card,.excard,[class*=ex]')||rows[i].parentElement;
      if(/dumbbell/i.test(card.textContent||'')) return rows[i].getAttribute('data-row');
    }
    var r=document.querySelector('[data-row]');
    return r?r.getAttribute('data-row'):null;`);
  if (!firstRow) { console.log('\nno rows rendered - cannot test'); chrome.kill(); process.exit(1); }
  const [ri, rk] = String(firstRow).split('-');

  console.log('\n=== stepping the weight DOWN on row ' + firstRow + ' (dumbbell, inc 2) ===');
  const seq = [];
  for (let n = 0; n < 24; n++) {
    await ev('G.bump(' + ri + ',' + rk + ',"w",-1); return 1');
    const w = await ev(`
      var r=document.querySelector('[data-row="${firstRow}"]');
      var e=r&&r.querySelector('[data-w]');
      return e?e.textContent.trim().replace(/[^0-9.]/g,''):null;`);
    seq.push(w);
  }
  console.log('  ' + seq.join(' -> '));
  console.log('  reaches 4: ' + seq.includes('4') + '   reaches 6: ' + seq.includes('6') + '   reaches 0: ' + seq.includes('0'));
  console.log('  distinct values: ' + JSON.stringify([...new Set(seq)]));

  /* the practical question: racks are often 2.5 kg steps (5, 7.5, 10...) or odd sizes. */
  console.log('\n=== stepping back UP, 30 clicks ===');
  const up = [];
  for (let n = 0; n < 30; n++) {
    await ev('G.bump(' + ri + ',' + rk + ',"w",1); return 1');
    const w = await ev(`
      var r=document.querySelector('[data-row="${firstRow}"]');
      var e=r&&r.querySelector('[data-w]');
      return e?e.textContent.trim().replace(/[^0-9.]/g,''):null;`);
    up.push(w);
  }
  const reach = new Set([...seq, ...up]);
  console.log('  ' + up.join(' -> '));
  console.log('\n  REACHABLE on a dumbbell exercise: ' + JSON.stringify([...reach].map(Number).sort((a, b) => a - b)));
  console.log('  a 2.5 kg-step rack needs:  5 reachable? ' + reach.has('5') + '   7.5 reachable? ' + reach.has('7.5') + '   12.5 reachable? ' + reach.has('12.5'));
  console.log('  common odd dumbbells:      7 reachable? ' + reach.has('7') + '   9 reachable? ' + reach.has('9') + '   11 reachable? ' + reach.has('11'));
  console.log('  is there any free-text weight entry? ' + await ev(`
    var r=document.querySelector('[data-row]');
    return !!(r&&r.querySelector('input'));`));

  /* ---- bug 2: can a pull-up set be logged at bodyweight (0 added)? ---- */
  console.log('\n=== pull-up at bodyweight ===');
  const pu = await ev(`
    var idx=-1;
    document.querySelectorAll('h3,.xname,.exname,.ttl').forEach(function(h,i){});
    var cards=document.querySelectorAll('[data-row]');
    for(var i=0;i<cards.length;i++){
      var card=cards[i].closest('.card,.excard,[class*=ex]')||cards[i].parentElement;
      if(/pull-?up/i.test(card.textContent||'')) return cards[i].getAttribute('data-row');
    }
    return null;`);
  console.log('  pull-up row: ' + JSON.stringify(pu));
  if (pu) {
    const [pi, pk] = String(pu).split('-');
    for (let n = 0; n < 12; n++) await ev('G.bump(' + pi + ',' + pk + ',"w",-1); return 1');
    const shown = await ev(`
      var r=document.querySelector('[data-row="${pu}"]');var e=r&&r.querySelector('[data-w]');
      return e?e.textContent.trim():null;`);
    console.log('  stepped down to: ' + JSON.stringify(shown));
    await ev('G.checkSet(' + pi + ',' + pk + '); return 1');
    await sleep(400);
    const after = await ev(`
      var t=document.querySelector('.toast,#toast,[class*=toast]');
      var r=document.querySelector('[data-row="${pu}"]');
      return {toast:t?t.textContent.trim():null, rowHTML:r?r.outerHTML.slice(0,240):null};`);
    console.log('  toast after tapping the set: ' + JSON.stringify(after.toast));
    console.log('  row after: ' + String(after.rowHTML).replace(/\s+/g, ' ').slice(0, 200));
  }

  chrome.kill();
  await sleep(400);
  fs.rmSync(TEMP, { recursive: true, force: true });
  process.exit(0);
})();