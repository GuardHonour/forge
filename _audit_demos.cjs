/* Demo audit: coverage, uniqueness, reachability and framing for all 48 rigs.
   This is the geometric safety net — it proves every authored pose is actually
   achievable by the skeleton, and reports the bounding box the whole set needs so
   the shared viewBox can be chosen from data instead of guessed. */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const m = src.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
if (!m) { console.error('FAIL: no script block'); process.exit(1); }

function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', style: { setProperty() {}, cssText: '' }, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {},
    querySelectorAll: () => [], querySelector: () => null,
    getContext: () => ({ clearRect() {}, fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {} }),
    setAttribute() {}, width: 0, height: 0, scrollTop: 0, click() {}
  };
}
const sandbox = {
  console,
  document: { querySelector: () => makeEl(), querySelectorAll: () => [], createElement: () => makeEl(),
    getElementById: () => null, documentElement: makeEl(), body: makeEl(), addEventListener() {} },
  getComputedStyle: () => ({ getPropertyValue: p => ({ '--volt': '#cbf33a', '--dim': '#5f6873' }[p] || '') }),
  localStorage: (() => { let s = {}; return { getItem: k => s[k] ?? null, setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
  navigator: {}, location: { reload() {} }, URL: { createObjectURL: () => 'blob:x' }, Blob: function () {},
  Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, parseInt, parseFloat, isNaN,
  requestAnimationFrame: () => 0, cancelAnimationFrame() {}, matchMedia: () => ({ matches: false }),
  innerWidth: 500, innerHeight: 900, setTimeout, clearTimeout, setInterval, clearInterval, Function, Error, TypeError
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
sandbox.window.addEventListener = () => {};
sandbox.document.addEventListener = () => {};

const run = new Function('window', 'document', 'localStorage', 'navigator', 'location', 'URL', 'Blob',
  'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getComputedStyle',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'console',
  m[1] + '\n;return{EXS:(typeof EXS!=="undefined"?EXS:[]),ANIMS:(typeof ANIMS!=="undefined"?ANIMS:{}),'
  + 'DEMOS:(typeof DEMOS!=="undefined"?DEMOS:{}),BONE:(typeof BONE!=="undefined"?BONE:null),GY:(typeof GY!=="undefined"?GY:0),'
  + 'solve:(typeof solve!=="undefined"?solve:null),normPose:(typeof normPose!=="undefined"?normPose:null),'
  + 'normDemo:(typeof normDemo!=="undefined"?normDemo:null),TEMPO:(typeof TEMPO!=="undefined"?TEMPO:null),CYCLE:(typeof CYCLE!=="undefined"?CYCLE:0)};');
const api = run(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.location,
  sandbox.URL, sandbox.Blob, sandbox.requestAnimationFrame, sandbox.cancelAnimationFrame, sandbox.matchMedia,
  sandbox.getComputedStyle, setTimeout, clearTimeout, setInterval, clearInterval, console);

let bad = 0;
const fail = msg => { bad++; console.log('  FAIL ' + msg); };

const ids = api.EXS.map(e => e.id);
const demoIds = Object.keys(api.DEMOS);

console.log('exercises: ' + ids.length + '   demos: ' + demoIds.length + '   rigs: ' + Object.keys(api.ANIMS).length);
const missing = ids.filter(id => !api.DEMOS[id]);
if (missing.length) fail('no demo for: ' + missing.join(', '));
const extra = demoIds.filter(id => !ids.includes(id));
if (extra.length) fail('demo with no exercise: ' + extra.join(', '));
const oneToOne = ids.every(id => api.DEMOS[id]);
console.log(oneToOne ? 'PASS every exercise has its OWN demo (1:1, no sharing)' : 'FAIL demo mapping is not 1:1');

/* reachability + finiteness + bounding box across every frame of every rep */
const box = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
const unreachable = [];
const nonfinite = [];
const STEP = 48;
ids.forEach(id => {
  const a = api.ANIMS[id];
  if (!a || typeof a.gen !== 'function') { fail(id + ': no gen()'); return; }
  for (let i = 0; i <= STEP; i++) {
    let P;
    try { P = a.gen(i / STEP); } catch (e) { fail(id + ': gen threw ' + e.message); break; }
    if (P.over && P.over.length) unreachable.push(id + '@' + (i / STEP).toFixed(2) + ':' + P.over.join('/'));
    for (const k of Object.keys(P)) {
      if (k === 'over' || k === 'torso') continue;   // torso is a scalar angle, not a point
      const v = P[k];
      if (!Array.isArray(v) || v.some(z => typeof z !== 'number' || !isFinite(z))) { nonfinite.push(id + '@' + (i / STEP).toFixed(2) + ':' + k); continue; }
      if (k === 'head') { box.x0 = Math.min(box.x0, v[0] - api.BONE.head); box.x1 = Math.max(box.x1, v[0] + api.BONE.head);
        box.y0 = Math.min(box.y0, v[1] - api.BONE.head); box.y1 = Math.max(box.y1, v[1] + api.BONE.head); }
      else { box.x0 = Math.min(box.x0, v[0]); box.x1 = Math.max(box.x1, v[0]); box.y0 = Math.min(box.y0, v[1]); box.y1 = Math.max(box.y1, v[1]); }
    }
  }
});
if (nonfinite.length) fail('non-finite joints: ' + nonfinite.slice(0, 8).join(' '));
else console.log('PASS all joints finite across ' + STEP + ' frames x ' + ids.length + ' demos');

/* The strict reachability check runs on the AUTHORED extremes. A frame in the middle
   of a rep is interpolated, and the interpolator clamps, so a mid-rep excursion is
   not an authoring error — but an authored hand or foot the skeleton cannot reach
   always is, and would otherwise be hidden by that clamp. */
const authoredBad = [];
const clamped = [];
ids.forEach(id => {
  const raw = api.DEMOS[id];
  const d = api.normDemo(Object.assign({}, raw));
  ['home', 'away'].forEach(k => {
    const p = api.normPose(d[k]);
    if (p.toeN === undefined) p.toeN = d.toeN;
    if (p.toeF === undefined) p.toeF = d.toeF;
    const P = api.solve(p, d, d);
    if (P.over && P.over.length) authoredBad.push(id + '.' + k + ':' + P.over.join('/'));
  });
});
ids.forEach(id => {
  const a = api.ANIMS[id];
  for (let i = 0; i <= STEP; i++) {
    const P = a.gen(i / STEP);
    if (P.over && P.over.length) clamped.push(id + '@' + (i / STEP).toFixed(2) + ':' + P.over.join('/'));
  }
});
if (authoredBad.length) fail('authored pose out of the skeleton\'s reach: ' + authoredBad.slice(0, 10).join(' '));
else console.log('PASS every AUTHORED pose (home and away) is within the skeleton\'s reach');
if (clamped.length) fail('a rendered frame needed clamping: ' + clamped.slice(0, 6).join(' '));
else console.log('PASS no rendered frame needs clamping at any of ' + (STEP + 1) + ' points in the rep');

/* Uniformity: one tempo, one skeleton, one viewBox, for every exercise. */
const tempos = new Set();
const phases = [];
ids.forEach(id => {
  const d = api.DEMOS[id];
  if (!Array.isArray(d.ph) || d.ph.length !== 2 || !d.ph[0] || !d.ph[1]) phases.push(id);
  if (typeof d.label !== 'string' || !d.label) phases.push(id + '(label)');
});
if (phases.length) fail('demo missing its uniform phase labels: ' + phases.join(', '));
else console.log('PASS all ' + ids.length + ' demos carry the same two-phase label contract');
console.log('  tempo: ' + api.TEMPO.map(t => t[0] + ' ' + t[1] + 'ms').join(' + ') + ' = ' + api.CYCLE + 'ms, identical for all ' + ids.length);

console.log('\nbounding box of all 48 demos, all frames: x ' + box.x0.toFixed(1) + '..' + box.x1.toFixed(1)
  + '   y ' + box.y0.toFixed(1) + '..' + box.y1.toFixed(1));
console.log('shared viewBox candidate: "' + Math.floor(box.x0 - 6) + ' ' + Math.floor(box.y0 - 6) + ' '
  + Math.ceil(box.x1 - box.x0 + 12) + ' ' + Math.ceil(box.y1 - box.y0 + 12) + '"');

/* Contact travel: how far each hand and foot moves between the two authored extremes.
   Reachability cannot see this, and it is the bug class that actually reads as "wrong
   form": a hand or foot that is supposed to be PLANTED — feet in a squat, hands on a
   fixed bar, toes on the floor — but slides between the two poses. Equally, a hand that
   SHOULD travel (a rowing hand, a calf-raise heel) will show a big number, so this is a
   report to eyeball, not a pass/fail. Anything over ~10 units is worth a look. */
const T = ids.map(id => {
  const d = api.normDemo(Object.assign({}, api.DEMOS[id]));
  const a = api.normPose(d.home), b = api.normPose(d.away);
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  return { id: id, anN: dist(a.anN, b.anN), anF: dist(a.anF, b.anF), wrN: dist(a.wrN, b.wrN), wrF: dist(a.wrF, b.wrF) };
});
T.sort((x, y) => Math.max(y.anN, y.anF, y.wrN, y.wrF) - Math.max(x.anN, x.anF, x.wrN, x.wrF));
console.log('\ncontact travel home -> away, in canvas units (feet anN/anF, hands wrN/wrF):');
console.log('  a PLANTED contact should be near 0; a moving limb should not be.');
T.slice(0, 16).forEach(t => {
  console.log('    ' + t.id.padEnd(15) + ' an ' + t.anN.toFixed(1).padStart(5) + ' /' + t.anF.toFixed(1).padStart(5)
    + '    wr ' + t.wrN.toFixed(1).padStart(5) + ' /' + t.wrF.toFixed(1).padStart(5));
});
const still = T.filter(t => Math.max(t.anN, t.anF, t.wrN, t.wrF) < 1.5).map(t => t.id);
console.log('  ' + still.length + ' demos hold every contact within 1.5 units: ' + still.join(', '));

console.log(bad ? '\n' + bad + ' AUDIT FAILURES' : '\nDEMO AUDIT CLEAN');
process.exit(bad ? 1 : 0);
