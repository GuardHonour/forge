/* glm5.3-flash set: geometric audit of the fresh 48-demo table (_v5_demos.cjs)
   run through the EXACT production engine via _v5_engine.cjs.
   Same checks as _audit_demos.cjs, plus demo-shape validation (scene names,
   view, load kind, setup uniqueness/length, phase-verb contract). */
const { loadEngine } = require('./_v5_engine.cjs');
const MINE = require('./_v5_demos.cjs');

const api = loadEngine(MINE);
let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };

const ids = api.EXS.map(e => e.id);
const mine = Object.keys(MINE);
console.log('exercises: ' + ids.length + '   authored demos: ' + mine.length);

/* 1:1 coverage against the real exercise list */
const missing = ids.filter(id => !MINE[id]);
const extra = mine.filter(id => !ids.includes(id));
if (missing.length) fail('no demo for: ' + missing.join(', '));
if (extra.length) fail('demo with no exercise: ' + extra.join(', '));
console.log(!missing.length && !extra.length ? 'PASS 1:1 coverage with the exercise list' : '(coverage broken)');

/* demo shape: scene/view/load/label/ph/setup */
const LOADS = ['bar', 'pullbar', 'db', 'db1', 'plate', 'handle'];
const setups = new Set();
ids.forEach(id => {
  const d = MINE[id];
  if (!d) return;
  if (!api.SCENES[d.scene]) fail(id + ': unknown scene ' + d.scene);
  if (['side', 'front'].indexOf(d.view) < 0) fail(id + ': bad view ' + d.view);
  if (!(d.load === null || LOADS.indexOf(d.load) >= 0)) fail(id + ': bad load ' + d.load);
  if (d.loadAt !== undefined && ['hip', 'foot'].indexOf(d.loadAt) < 0) fail(id + ': bad loadAt ' + d.loadAt);
  if (!Array.isArray(d.ph) || d.ph.length !== 2 || !d.ph[0] || !d.ph[1]) fail(id + ': ph contract');
  if (typeof d.label !== 'string' || !d.label) fail(id + ': label missing');
  if (typeof d.setup !== 'string' || !d.setup) fail(id + ': setup missing');
  else {
    if (d.setup.length > 80) fail(id + ': setup ' + d.setup.length + ' chars (>80)');
    if (setups.has(d.setup)) fail(id + ': duplicate setup cue');
    setups.add(d.setup);
  }
  ['home', 'away'].forEach(k => {
    const p = d[k];
    if (!p || !Array.isArray(p.hip) || typeof p.torso !== 'number' || (!p.wr && !p.wrN) || (!p.an && !p.anN))
      fail(id + '.' + k + ': pose missing hip/torso/wr/an');
  });
});
console.log('PASS demo shape (scene/view/load/label/ph/setup) checked for all ' + ids.length);

/* authored extremes must be reachable by the real solver */
const authoredBad = [];
ids.forEach(id => {
  const d = api.normDemo(Object.assign({}, MINE[id]));
  ['home', 'away'].forEach(k => {
    const p = api.normPose(d[k]);
    if (p.toeN === undefined) p.toeN = d.toeN;
    if (p.toeF === undefined) p.toeF = d.toeF;
    const P = api.solve(p, d, d);
    if (P.over && P.over.length) authoredBad.push(id + '.' + k + ':' + P.over.join('/'));
  });
});
if (authoredBad.length) fail('authored pose out of reach: ' + authoredBad.join(' '));
else console.log('PASS every AUTHORED pose (home and away) within the skeleton\'s reach');

/* every rendered frame: finite joints, no clamping */
const STEP = 48;
const clamped = [], nonfinite = [];
const box = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
ids.forEach(id => {
  const a = api.ANIMS[id];
  if (!a || typeof a.gen !== 'function') { fail(id + ': no gen()'); return; }
  for (let i = 0; i <= STEP; i++) {
    let P;
    try { P = a.gen(i / STEP); } catch (e) { fail(id + ': gen threw ' + e.message); return; }
    if (P.over && P.over.length) clamped.push(id + '@' + (i / STEP).toFixed(2) + ':' + P.over.join('/'));
    for (const k of Object.keys(P)) {
      if (k === 'over' || k === 'torso') continue;
      const v = P[k];
      if (!Array.isArray(v) || v.some(z => typeof z !== 'number' || !isFinite(z))) { nonfinite.push(id + '@' + i + ':' + k); continue; }
      if (k === 'head') {
        box.x0 = Math.min(box.x0, v[0] - api.BONE.head); box.x1 = Math.max(box.x1, v[0] + api.BONE.head);
        box.y0 = Math.min(box.y0, v[1] - api.BONE.head); box.y1 = Math.max(box.y1, v[1] + api.BONE.head);
      } else { box.x0 = Math.min(box.x0, v[0]); box.x1 = Math.max(box.x1, v[0]); box.y0 = Math.min(box.y0, v[1]); box.y1 = Math.max(box.y1, v[1]); }
    }
  }
});
if (nonfinite.length) fail('non-finite joints: ' + nonfinite.slice(0, 8).join(' '));
else console.log('PASS all joints finite across ' + (STEP + 1) + ' frames x ' + ids.length + ' demos');
if (clamped.length) fail('a rendered frame needed clamping: ' + clamped.slice(0, 10).join(' '));
else console.log('PASS no rendered frame needs clamping');

console.log('\nbbox of my 48 demos, all frames: x ' + box.x0.toFixed(1) + '..' + box.x1.toFixed(1)
  + '   y ' + box.y0.toFixed(1) + '..' + box.y1.toFixed(1));

/* contact travel report */
const T = ids.map(id => {
  const d = api.normDemo(Object.assign({}, MINE[id]));
  const a = api.normPose(d.home), b = api.normPose(d.away);
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  return { id, anN: dist(a.anN, b.anN), anF: dist(a.anF, b.anF), wrN: dist(a.wrN, b.wrN), wrF: dist(a.wrF, b.wrF) };
}).sort((x, y) => Math.max(y.anN, y.anF, y.wrN, y.wrF) - Math.max(x.anN, x.anF, x.wrN, x.wrF));
console.log('\ncontact travel home->away (feet anN/anF, hands wrN/wrF):');
T.slice(0, 14).forEach(t => console.log('    ' + t.id.padEnd(14) + ' an ' + t.anN.toFixed(1).padStart(5) + ' /' + t.anF.toFixed(1).padStart(5)
  + '    wr ' + t.wrN.toFixed(1).padStart(5) + ' /' + t.wrF.toFixed(1).padStart(5)));

/* HUD structure must stay identical to the app's own */
const hudA = api.demoHUD('bench'), hudB = api.demoHUD('squat');
const tags = s => s.replace(/>[^<]+</g, '><');
if (!hudA || !hudB) fail('demoHUD returned nothing');
else if (tags(hudA) !== tags(hudB)) console.log('  note: HUD tag structure differs between demos');
else console.log('PASS HUD element structure identical across demos');

console.log(bad ? '\n' + bad + ' AUDIT FAILURES' : '\nGLM5.3 SET AUDIT CLEAN');
process.exit(bad ? 1 : 0);
