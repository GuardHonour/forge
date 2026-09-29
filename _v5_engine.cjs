/* glm5.3-flash session: reusable sandbox harness for the technique-demo engine.
   Loads the WHOLE app script from index.html (same stubbing pattern as
   _audit_demos.cjs) and exposes the engine API. Pass a demo table to REPLACE
   the shipped DEMOS before buildAnims() compiles ANIMS, so an alternative
   authoring set runs through the exact production engine.
   Used by _v5_audit.cjs / _v5_shot.cjs / _v5_compare.cjs. */
const fs = require('fs');

function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', style: { setProperty() {}, cssText: '' }, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {},
    querySelectorAll: () => [], querySelector: () => null,
    getContext: () => ({ clearRect() {}, fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {} }),
    setAttribute() {}, width: 0, height: 0, scrollTop: 0, click() {}
  };
}

function sandboxFor() {
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
  return sandbox;
}

const RETURN_STM = ';return{EXS:(typeof EXS!=="undefined"?EXS:[]),EXBY:(typeof EXBY!=="undefined"?EXBY:{}),'
  + 'DEMOS:(typeof DEMOS!=="undefined"?DEMOS:{}),ANIMS:(typeof ANIMS!=="undefined"?ANIMS:{}),'
  + 'BONE:(typeof BONE!=="undefined"?BONE:null),GY:(typeof GY!=="undefined"?GY:0),HIPY:(typeof HIPY!=="undefined"?HIPY:0),'
  + 'VIEW:(typeof VIEW!=="undefined"?VIEW:null),TEMPO:(typeof TEMPO!=="undefined"?TEMPO:null),CYCLE:(typeof CYCLE!=="undefined"?CYCLE:0),'
  + 'SCENES:(typeof SCENES!=="undefined"?SCENES:null),'
  + 'solve:(typeof solve!=="undefined"?solve:null),normPose:(typeof normPose!=="undefined"?normPose:null),'
  + 'normDemo:(typeof normDemo!=="undefined"?normDemo:null),stageAt:(typeof stageAt!=="undefined"?stageAt:null),'
  + 'mixPose:(typeof mixPose!=="undefined"?mixPose:null),drawFigure:(typeof drawFigure!=="undefined"?drawFigure:null),'
  + 'loadFor:(typeof loadFor!=="undefined"?loadFor:null),demoHUD:(typeof demoHUD!=="undefined"?demoHUD:null)};';

/* loadEngine(v5Demos?) -> api. v5Demos: {id: demoEntry} replaces DEMOS. */
function loadEngine(v5Demos) {
  const src = fs.readFileSync(__dirname + '/index.html', 'utf8');
  const m = src.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
  if (!m) throw new Error('no script block in index.html');
  const ANCHOR = 'Object.assign(DEMOS,DEMO_CHEST,DEMO_BACK,DEMO_SHOULDERS,DEMO_ARMS,DEMO_LEGS,DEMO_CORE);';
  const INJECT = ANCHOR
    + 'if(window.__V5_REPLACE__){Object.keys(DEMOS).forEach(function(k){delete DEMOS[k];});'
    + 'Object.assign(DEMOS, window.__V5_DEMOS__);}';
  const body = m[1].replace(ANCHOR, INJECT);
  if (body === m[1]) throw new Error('injection anchor not found');
  const sandbox = sandboxFor();
  sandbox.window.__V5_REPLACE__ = !!v5Demos;
  sandbox.window.__V5_DEMOS__ = v5Demos || null;
  const run = new Function('window', 'document', 'localStorage', 'navigator', 'location', 'URL', 'Blob',
    'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getComputedStyle',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'console',
    body + RETURN_STM);
  return run(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.location,
    sandbox.URL, sandbox.Blob, sandbox.requestAnimationFrame, sandbox.cancelAnimationFrame, sandbox.matchMedia,
    sandbox.getComputedStyle, setTimeout, clearTimeout, setInterval, clearInterval, console);
}

/* extract the engine source (color helpers .. buildAnims()) for standalone pages */
function engineSource() {
  const src = fs.readFileSync(__dirname + '/index.html', 'utf8');
  const a = src.indexOf('const D2R=Math.PI/180;');
  const b = src.indexOf('buildAnims();', a) + 'buildAnims();'.length;
  if (a < 0 || b < 14) throw new Error('engine bounds not found');
  return src.slice(a, b);
}

module.exports = { loadEngine, engineSource };
