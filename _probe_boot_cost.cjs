/* _probe_boot_cost.cjs — the app script's boot cost, asserted.
 *
 * WHY THIS EXISTS: the FORGE-3D press clip shipped with two pose solvers running at module
 * load — a 12,480-candidate rack grid whose accepted candidates each sampled a 241-point arc,
 * roughly two million full FK+IK pose evaluations per boot. The module is inlined into the app's
 * single <script> block, so that cost sat inside the parser-blocking script: an installed PWA sat
 * on its splash screen for tens of seconds on EVERY open before anything rendered. No suite
 * measured boot cost, so the gate was green while the phone was unusable. This probe is the check
 * that would have failed that build: it boots the app script in the same node sandbox
 * _runtime_test.cjs uses and asserts the whole thing is fast.
 *
 * The sandbox is deliberately the runtime test's (DOM stubs, file:// location so the service
 * worker registration path is skipped). What it measures is CPU: parse + top-level execution of
 * everything the app runs before first paint. It does not measure network (see _probe_sw_http.cjs
 * for the deploy path over HTTP).
 *
 * Run: node _probe_boot_cost.cjs
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

const LIMIT_S = 1.0;   /* a desktop-class core should boot the app in well under a second */

const src = fs.readFileSync('index.html', 'utf8');
const m = src.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
if (!m) { console.error('FAIL: no script block'); process.exit(1); }
const js = m[1];

/* --- the runtime test's sandbox, verbatim in behaviour --------------------------------- */
function makeEl() {
  const el = {
    innerHTML: '', textContent: '', value: '',
    style: { setProperty() {}, cssText: '' },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, addEventListener() {}, removeEventListener() {}, remove() {},
    querySelectorAll: () => [], querySelector: () => null,
    getContext: () => ({ clearRect() {}, fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {} }),
    setAttribute() {}, width: 0, height: 0,
    scrollTop: 0, click() {}
  };
  return el;
}
const els = {};
const getEl = id => (els[id] = els[id] || makeEl());
const sandbox = {
  console,
  document: {
    querySelector: sel => (sel === 'main' ? getEl('main') : getEl(sel)),
    querySelectorAll: () => [],
    createElement: () => makeEl(),
    getElementById: () => null,
    documentElement: makeEl(),
    body: makeEl(),
    addEventListener() {}
  },
  getComputedStyle: () => ({ getPropertyValue: p => ({ '--volt': '#cbf33a', '--dim': '#5f6873' }[p] || '') }),
  localStorage: (() => { let store = {}; return { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }; })(),
  navigator: {},
  location: { protocol: 'file:', reload() {}, search: '' },
  URL: { createObjectURL: () => 'blob:x' },
  Blob: function () {},
  Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, parseInt, parseFloat, isNaN,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  matchMedia: () => ({ matches: false }),
  innerWidth: 500, innerHeight: 900,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() },
  Function, Error, TypeError
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
sandbox.document.addEventListener = () => {};
sandbox.window.addEventListener = () => {};
sandbox.window.matchMedia = () => ({ matches: false });

/* --- boot it, twice: V8 caches nothing across contexts, so two runs catch a warm-run fluke --- */
let fails = 0;
for (let run = 1; run <= 2; run++) {
  const t0 = process.hrtime.bigint();
  let threw = null;
  try { vm.runInNewContext(js, makeSandbox(), { filename: 'index.html#boot' }); }
  catch (e) { threw = e; }
  const s = Number(process.hrtime.bigint() - t0) / 1e9;
  const ok = !threw && s <= LIMIT_S;
  if (!ok) fails++;
  console.log((ok ? '  PASS ' : '  FAIL ') + 'boot ' + run + ': ' + s.toFixed(2) + ' s (limit ' + LIMIT_S + ' s)' +
    (threw ? '   THREW: ' + threw.message.slice(0, 120) : ''));
}
if (fails) {
  console.log('\nBOOT COST FAIL — the app script is too slow to boot. Everything in the single inline');
  console.log('script runs before the PWA splash can dismiss, so this is what a phone feels on every open.');
  console.log('Prime suspect: top-level work in a _s3d_* module (see BAKED, NOT SOLVED AT LOAD in');
  console.log('_s3d_clip_press.js — the press solvers once cost ~30-50 s here).');
  process.exit(1);
}
console.log('\nBOOT COST OK');
process.exit(0);

function makeSandbox() {
  for (const k of Object.keys(els)) delete els[k];
  const s = Object.assign({}, sandbox);
  s.localStorage = (() => { let store = {}; return { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }; })();
  return s;
}