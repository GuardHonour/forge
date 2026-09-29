/* _ref_compare.cjs — does the APP's animated joint motion match the MEASURED reference?

This closes the loop the whole exercise exists for. The reference measurements in _ref/*.json are
only worth anything if they are actually compared against what the app animates; an angle table
nobody checks is decoration.

It loads the app's own engine (same technique as _audit_demos.cjs, so there is no second copy of
the maths), samples each demo's full rep, and computes the interior angle at the knee from the
three joint positions the engine itself produces. Angles are scale-free and invariant to the y-down
SVG convention and to mirroring, so they compare directly with the reference measurements -- no
unit conversion, which is the kind of step that silently introduces a factor of two.

Run: node _ref_compare.cjs [targets.json] [id,id,...]
*/
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const m = src.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
if (!m) { console.error('FAIL: no script block in index.html'); process.exitCode = 1; return; }

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
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  localStorage: (() => { let s = {}; return { getItem: k => s[k] ?? null, setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
  navigator: {}, location: { reload() {} }, URL: { createObjectURL: () => 'blob:x' }, Blob: function () {},
  Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, parseInt, parseFloat, isNaN,
  requestAnimationFrame: () => 0, cancelAnimationFrame() {}, matchMedia: () => ({ matches: false }),
  innerWidth: 500, innerHeight: 900,
  // STUBBED, not the real timers: the app starts its own demo interval at load, so handing it a
  // real setInterval keeps the Node event loop alive forever and the script never exits (it ran to
  // a 300 s timeout on the first attempt with the real ones wired through).
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  Function, Error, TypeError
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
sandbox.window.addEventListener = () => {};
sandbox.document.addEventListener = () => {};

const run = new Function('window', 'document', 'localStorage', 'navigator', 'location', 'URL', 'Blob',
  'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getComputedStyle',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'console',
  m[1] + '\n;return{EXS:(typeof EXS!=="undefined"?EXS:[]),ANIMS:(typeof ANIMS!=="undefined"?ANIMS:{})};');
/* The timer arguments must be the STUBS. Stubbing them on the sandbox object alone is not enough:
   these positional arguments shadow it inside the evaluated script, so passing the real ones here
   keeps the app's demo interval alive and Node never exits. */
const noop = () => {};
const api = run(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.location,
  sandbox.URL, sandbox.Blob, sandbox.requestAnimationFrame, sandbox.cancelAnimationFrame, sandbox.matchMedia,
  sandbox.getComputedStyle, () => 0, noop, () => 0, noop, console);

const targetsFile = process.argv[2] || '_ref/cdc_leg_targets.json';
const onlyArg = (process.argv[3] || '').split(',').map(s => s.trim()).filter(Boolean);
const T = JSON.parse(fs.readFileSync(targetsFile, 'utf8'));

/* degrees between A->B and C->B: the interior angle at joint B. Invariant to y-down and mirroring. */
function angleAt(A, B, C) {
  const u = [A[0] - B[0], A[1] - B[1]], v = [C[0] - B[0], C[1] - B[1]];
  const nu = Math.hypot(u[0], u[1]), nv = Math.hypot(v[0], v[1]);
  if (!nu || !nv) return NaN;
  const c = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (nu * nv)));
  return Math.acos(c) * 180 / Math.PI;
}

const KEYS = ['knee', 'hip', 'ankle', 'thigh', 'shin', 'foot', 'leg'];
let printedKeys = false;
const STEP = 96;
let bad = 0;

for (const id of Object.keys(T.clips)) {
  if (onlyArg.length && !onlyArg.includes(id)) continue;
  const a = api.ANIMS[id];
  if (!a || typeof a.gen !== 'function') { console.log('  FAIL ' + id + ': no gen()'); bad++; continue; }

  // discover the engine's joint names for this rig rather than hardcoding them
  const sample = a.gen(0.5);
  const names = Object.keys(sample).filter(k => Array.isArray(sample[k]));
  if (!printedKeys) {
    console.log('engine joint keys: ' + names.join(', '));
    printedKeys = true;
  }
  // The engine names the limb joints by SIDE, not by joint: knN/knF knee, anN/anF ankle, hpN/hpF
  // hip, elN/elF elbow, wrN/wrF wrist (N=near, F=far). Matching on "knee"/"ankle" finds nothing.
  const find = (exact, re) => names.includes(exact) ? exact : names.find(n => re.test(n));
  const K = find('knN', /^(kn|knee)/i);
  const A = find('anN', /^(an|ank)/i);
  const H = find('hpN', /^(hp|hip)/i);
  if (!K || !A || !H) {
    console.log('  FAIL ' + id + ': cannot find hip/knee/ankle among ' + names.join(','));
    bad++; continue;
  }
  const KF = names.find(n => /^(kn)F$/.test(n)), AF = names.find(n => /^(an)F$/.test(n)),
        HF = names.find(n => /^(hp)F$/.test(n));

  // Arm exercises use the shoulder/elbow/wrist triple instead of hip/knee/ankle. The reference entry
  // says which it is: a leg entry carries knee_most_*_deg, an arm entry carries
  // targets.lockout.elbow_angle_deg. Reading a knee out of an arm entry would produce a confident
  // number for a joint the measurement never described -- the failure mode this whole exercise keeps
  // running into, so the choice is made from the data rather than assumed from the exercise id.
  const _refPeek = (T.clips[id] || {}).targets || {};
  const isArm = _refPeek.lockout && _refPeek.lockout.elbow_angle_deg !== undefined;
  const SH = names.find(n => n === 'shN') || names.find(n => /^sh$/i.test(n));
  const EL = names.find(n => n === 'elN');
  const WR = names.find(n => n === 'wrN');
  const SHF = names.find(n => n === 'shF'), ELF = names.find(n => n === 'elF'), WRF = names.find(n => n === 'wrF');
  let JK = K, JA = A, JH = H, JKF = KF, JAF = AF, JHF = HF, jointLabel = 'knee';
  if (isArm) {
    if (!SH || !EL || !WR) {
      console.log('  FAIL ' + id + ': arm reference but the engine has no shoulder/elbow/wrist triple ('
        + [SH, EL, WR].join(',') + ')');
      bad++; continue;
    }
    // The FAR side must move with the joint type too. Leaving it on hip/knee/ankle would print a
    // knee angle for an arm exercise under a heading that says "far side" -- a number for a joint
    // the reference never described, which is the failure this whole exercise keeps meeting.
    JK = EL; JA = WR; JH = SH; JKF = ELF; JAF = WRF; JHF = SHF; jointLabel = 'elbow';
  }

  // Measure BOTH sides. The rig is symmetric in principle, but a demo posed in 3/4 view can leave
  // the far leg in a different configuration, and then a single-side number says more about which
  // joint I happened to pick than about the animation. Reporting both turns that into evidence.
  const rangeOf = (h, k, an) => {
    if (!h || !k || !an) return null;
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i <= STEP; i++) {
      const P = a.gen(i / STEP);
      const ang = angleAt(P[h], P[k], P[an]);
      if (!isFinite(ang)) continue;
      lo = Math.min(lo, ang); hi = Math.max(hi, ang);
    }
    return [lo, hi];
  };
  const near = rangeOf(JH, JK, JA), far = rangeOf(JHF, JKF, JAF);
  const [lo, hi] = near;

  const ref = (T.clips[id] || {}).targets || {};
  const isArmRef = ref.lockout && ref.lockout.elbow_angle_deg !== undefined;
  // Leg entries store the extremes at the top level; arm entries store them under lockout/racked,
  // where the names mean most-extended/most-flexed (see extreme_selected_by) and NOT the press
  // positions. Reading the wrong pair silently compares against nothing.
  const refLo = isArmRef ? ref.racked.elbow_angle_deg : T.clips[id].knee_most_flexed_deg;
  const refHi = isArmRef ? ref.lockout.elbow_angle_deg : T.clips[id].knee_most_extended_deg;
  const refSel = isArmRef ? (ref.extreme_selected_by || 'elbow') : 'knee';
  const appSpan = hi - lo, refSpan = refHi - refLo;

  console.log('\n' + id + '   (' + jointLabel + ' angle; engine joints ' + JH + ' / ' + JK + ' / ' + JA + ')');
  console.log('  APP animates   : ' + jointLabel + ' ' + lo.toFixed(1) + '..' + hi.toFixed(1)
    + '  (span ' + appSpan.toFixed(1) + ' deg)');
  if (far) {
    const farSpan = far[1] - far[0];
    const asym = Math.abs(farSpan - appSpan);
    console.log('  APP far side   : ' + jointLabel + ' ' + far[0].toFixed(1) + '..' + far[1].toFixed(1)
      + '  (span ' + farSpan.toFixed(1) + ' deg)  range asymmetry ' + asym.toFixed(1) + ' deg'
      + (asym > 15 ? '  <-- the two sides do NOT animate alike; a single-side figure would be ' +
        'misleading and the verdict below uses the near side' : ''));
  }
  console.log('  REFERENCE says : ' + jointLabel + ' ' + refLo.toFixed(1) + '..' + refHi.toFixed(1)
    + '  (span ' + refSpan.toFixed(1) + ' deg)   [' + T.clips[id].licence + '; extremes selected by '
    + refSel + ']');
  const dExt = hi - refHi, dFlex = lo - refLo, dSpan = appSpan - refSpan;
  console.log('  delta          : most-extended ' + (dExt >= 0 ? '+' : '') + dExt.toFixed(1)
    + ' deg, most-flexed ' + (dFlex >= 0 ? '+' : '') + dFlex.toFixed(1)
    + ' deg, range ' + (dSpan >= 0 ? '+' : '') + dSpan.toFixed(1) + ' deg');
  // Deliberately generous: the reference is a real lifter on a real machine and the app rig is a
  // stylised 2D skeleton. The useful signal is a MISSING or INVERTED movement, not a few degrees.
  const ok = Math.abs(dSpan) <= 35 && Math.abs(dExt) <= 35 && Math.abs(dFlex) <= 35;
  console.log('  verdict        : ' + (ok ? 'comparable (within 35 deg)'
    : 'OUT OF RANGE -- the app does not animate this movement as measured'));
  if (!ok) bad++;
}

console.log('\nWhat this comparison can and cannot settle:');
console.log('  * Angles come from MediaPipe WORLD landmarks (3D), so a frontal reference view does not');
console.log('    foreshorten the knee the way a 2D projection would. Depth is still inferred, and the');
console.log('    reference rig is a real machine with a real occupant, so tens of degrees is signal');
console.log('    while a few degrees is noise.');
console.log('  * The app rig is a stylised 2D skeleton on a shared 200x200 viewBox with one bone-length');
console.log('    set for all 48 exercises. Some of any gap is that stylisation, not an authoring error.');
console.log('  * What it DOES settle: whether the app animates the right AMOUNT of joint travel. A');
console.log('    range falling 60-90 deg short is not stylisation, it is a shallow demo.');

console.log('\n' + (bad ? 'REF_COMPARE issues: ' + bad : 'REF_COMPARE CLEAN'));
if (bad) process.exitCode = 1;
