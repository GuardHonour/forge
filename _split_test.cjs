/* SPLIT + SWAP test suite */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const m = src.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
const js = m[1];

let failures = 0, passes = 0;
const ok = (c, l) => { if (c) { passes++; console.log('  PASS', l); } else { failures++; console.log('* FAIL', l); } };
const section = t => console.log('\n== ' + t + ' ==');

function makeEl(id) {
  return {
    id: id || '', innerHTML: '', textContent: '', value: '', style: { setProperty() {}, cssText: '' },
    dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, addEventListener() {}, removeEventListener() {}, remove() {},
    querySelectorAll: () => [], querySelector: () => null,
    getContext: () => ({ clearRect() {}, fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {} }),
    setAttribute() {}, width: 0, height: 0, scrollTop: 0, isConnected: false, click() {}
  };
}
function makeStorage() { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; }
function bootApp(storage) {
  const els = {};
  const mainEl = makeEl('main');
  Object.defineProperty(mainEl, 'innerHTML', { get() { return this._h || ''; }, set(v) { this._h = v; this._writes = (this._writes || 0) + 1; } });
  const sb = {
    console,
    document: {
      querySelector(sel) {
        if (sel === 'main') return mainEl;
        if (sel && sel.indexOf('[data-row=') === 0) {
          return { isConnected: true, querySelector: s => { if (s === '[data-w]' || s === '[data-r]') { const sp = makeEl(s); sp.isConnected = true; return sp; } return null; } };
        }
        return (els[sel] = els[sel] || makeEl(sel));
      },
      querySelectorAll: () => [], createElement: () => makeEl(), getElementById: () => null,
      documentElement: makeEl('html'), body: makeEl('body'), addEventListener() {}
    },
    localStorage: storage, navigator: {}, location: { reload() {} },
    URL: { createObjectURL: () => 'blob:x' }, Blob: function () {},
    confirm: () => true, alert() {}, prompt: () => '',
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, parseInt, parseFloat, isNaN,
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false }), innerWidth: 500, innerHeight: 900,
    setTimeout, clearTimeout, setInterval, clearInterval, Function, Error, TypeError,
    getComputedStyle: () => ({ getPropertyValue: p => ({ '--volt': '#cbf33a', '--dim': '#5f6873' }[p] || '') })
  };
  sb.window = sb; sb.globalThis = sb;
  const run = new Function('window','document','localStorage','navigator','location','URL','Blob','confirm','alert','prompt',
    'requestAnimationFrame','cancelAnimationFrame','matchMedia','innerWidth','innerHeight','getComputedStyle',
    'setTimeout','clearTimeout','setInterval','clearInterval','console',
    js + '\n;return{G,S:(typeof S!=="undefined"?S:null),EXS,EXBY,ANIMS,SPLITS,ROUTINES,progIndex,fns:{vTrain,vLib,vProg,vHist,vPlan,suggest,startAnimLoop}};');
  return run(sb.window, sb.document, sb.localStorage, sb.navigator, sb.location, sb.URL, sb.Blob, sb.confirm, sb.alert, sb.prompt,
    sb.requestAnimationFrame, sb.cancelAnimationFrame, sb.matchMedia, 500, 900, sb.getComputedStyle,
    setTimeout, clearTimeout, setInterval, clearInterval, console);
}

const storage = makeStorage();
let app = bootApp(storage);

section('SPLIT DATA · six splits defined');
ok(Object.keys(app.SPLITS).length === 6, '6 splits: ' + Object.keys(app.SPLITS).map(s => app.SPLITS[s].name).join(', '));
for (const [id, sp] of Object.entries(app.SPLITS)) {
  ok(sp.days.length >= 4 && sp.days.every(d => app.ROUTINES[d.rid]), sp.name + ': ' + sp.days.length + ' valid days');
}
// every routine in every split references real exercises
let badRefs = [];
for (const [rid, r] of Object.entries(app.ROUTINES)) {
  for (const px of r.ex) if (!app.EXBY[px.id]) badRefs.push(rid + ':' + px.id);
}
ok(badRefs.length === 0, 'all 33 routines reference real exercises' + (badRefs.length ? ' BAD: ' + badRefs.join(',') : ''));
ok(app.EXS.length === 48, 'library grew to 48 exercises (' + app.EXS.length + ')');

section('CALISTHENICS SPLIT · purity check');
{
  const cali = app.SPLITS.cali6;
  const allIds = cali.days.flatMap(d => app.ROUTINES[d.rid].ex.map(p => p.id));
  const nonBW = allIds.filter(id => app.EXBY[id].cat !== 'Calisthenic');
  ok(nonBW.length === 0, 'cali days use only calisthenic movements' + (nonBW.length ? ' BAD: ' + nonBW.join(',') : ''));
}

section('BBL SPLIT · three glute sessions');
{
  const gluteDays = app.SPLITS.bbl5.days.filter(d => d.label.toLowerCase().includes('glute')).length;
  ok(gluteDays === 3, 'Booty Builder hits glutes 3x/week (' + gluteDays + ')');
}

section('SWITCHING · rotation follows active split');
(async () => {
  ok((app.S.split || 'ul4') === 'ul4', 'default split Upper/Lower');
  ok(app.progIndex().next.rid === 'upper-a', 'UL4 starts at Upper A');
  // complete an UL4 day
  await new Promise(r => setTimeout(r, 450)); // clear anti-double-fire window between identical actions
  app.G.startNext();
  app.G.save();
  ok(app.progIndex().next.rid === 'lower-a', 'after Upper A -> Lower A');
  // switch to Arnold mid-program
  await new Promise(r => setTimeout(r, 450));
  app.G.setSplit('arnold6');
  ok(app.S.split === 'arnold6', 'split switch stored');
  ok(app.progIndex().next.rid === 'arn-cb1', 'Arnold rotation starts clean at Chest & Back (UL history ignored)');
  await new Promise(r => setTimeout(r, 450));
  app.G.startNext(); app.G.save(); // complete Chest & Back
  ok(app.progIndex().next.rid === 'arn-sa1', 'after C&B -> Shoulders & Arms');
  await new Promise(r => setTimeout(r, 450));
  app.G.setSplit('ppl6');
  ok(app.progIndex().next.rid === 'ppl-push', 'PPL rotation independent');

  section('PERSISTENCE · split survives reopen');
  {
    const app2 = bootApp(storage);
    ok(app2.S.split === 'ppl6', 'active split restored after close/reopen');
    ok(app2.progIndex().next.rid === 'ppl-push' && !app2.progIndex().last, 'new split starts its own fresh rotation (no cross-split leakage)');
    // switching back to Arnold must remember where Arnold left off
    await new Promise(r => setTimeout(r, 450));
    app2.G.setSplit('arnold6');
    ok(app2.progIndex().last && app2.progIndex().last.routineId === 'arn-cb1' && app2.progIndex().next.rid === 'arn-sa1', 'Arnold rotation remembered across close/reopen');
  }

  section('EXERCISE SWAP · same muscle group only');
  {
    const app3 = bootApp(storage);
    await new Promise(r => setTimeout(r, 450));
    app3.G.setSplit('bro5');
    // bro-chest: bench, incline-db, machine-press, cable-fly, pecdec, pushup
    // valid target: db-bench (Chest group, NOT already in the day)
    const before = app3.ROUTINES['bro-chest'].ex.map(p => p.id).join(',');
    app3.G.doSwap('bro-chest', 0, 'db-bench');
    const ids = app3.ROUTINES['bro-chest'].ex.map(p => p.id);
    ok(ids[0] === 'db-bench' && ids.join(',') !== before, 'bench -> Dumbbell Bench Press swapped in');
    // duplicate guard: try swapping slot 1 to db-bench while slot 0 already is -> blocked
    app3.G.doSwap('bro-chest', 1, 'db-bench');
    const ids2 = app3.ROUTINES['bro-chest'].ex.map(p => p.id);
    ok(new Set(ids2).size === ids2.length && ids2[1] !== 'db-bench', 'duplicate swap attempt rejected');
    // persistence
    const app4 = bootApp(storage);
    ok(app4.ROUTINES['bro-chest'].ex[0].id === 'db-bench', 'day customization survives close/reopen');
    // group integrity: chest slot must only ever offer chest moves
    const chestPool = app4.EXS.filter(e => e.g === app4.EXBY[app4.ROUTINES['bro-chest'].ex[0].id].g);
    ok(chestPool.every(e => e.g === 'Chest'), 'swap pool filtered to Chest (' + chestPool.length + ' options)');
    // plan view renders for ALL splits without crashing
    let crashed = '';
    for (const sid of Object.keys(app4.SPLITS)) { app4.S.split = sid; try { app4.fns.vPlan(); } catch (e) { crashed += sid + ':' + e.message + '; '; } }
    ok(!crashed, 'Plan view renders for all 6 splits' + (crashed ? ' CRASH: ' + crashed : ''));
    const trHtml = app4.fns.vTrain();
    ok(trHtml.includes('Bro Split'), 'Train home shows active split name');
    ok(trHtml.includes('Customize this day'), 'per-day customize affordance present');
    // CRITICAL: Train home must list ONLY the active split's days
    const countCards = html => (html.match(/Customize this day/g) || []).length;
    for (const [sid, sp] of Object.entries(app4.SPLITS)) {
      app4.S.split = sid;
      const h = app4.fns.vTrain();
      const n = countCards(h);
      ok(n === sp.days.length, sid + ': Train shows exactly ' + sp.days.length + ' days, got ' + n);
      ok(!h.includes('Upper A') || sid === 'ul4', sid + ': no Upper/Lower leakage' + (sid === 'ul4' ? ' (expected here)' : ''));
    }
    finish();
  }
})().catch(e => { console.log('* FATAL', e.message); process.exit(1); });

function finish() {
  console.log('\n==============================');
  console.log(passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
}
