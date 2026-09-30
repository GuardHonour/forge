/* FORGE · UPGRADE TEST — the last SHIPPED build's store must open in the working build.
 *
 * Why this exists. Pushing to the live app (GitHub Pages) updates a PWA that holds the only
 * copy of somebody's training log. Every other suite in this gate tests the working build in
 * isolation, with a store the working build itself wrote — which is exactly the store that
 * cannot expose an upgrade fault. This one is different: it boots the PREVIOUS SHIPPED BUILD
 * (`_legacy_build_k.html`, a byte-for-byte copy of what guardhonour.github.io/forge/ served,
 * snapshot taken 2026-09-24), makes a realistic history with THAT build's own seed generator,
 * then hands the resulting localStorage to the working build and asserts:
 *
 *   1. it boots and renders every tab without throwing,
 *   2. the history is not merely present but UNCHANGED — ids, dates, entry ids, set weights and
 *      reps, and a numeric fingerprint of every analytics surface the two builds share,
 *   3. the additive residue an old store carries (profile.birth / .equipment / .bar, which
 *      nothing reads any more) is preserved rather than silently rewritten,
 *   4. a store with NO profile key at all is backfilled from freshProfile() per key,
 *   5. a legacy ENTRY-level `rir` still reads through entryRir(), because per-set effort is
 *      additive and an entry-level reading is what every pre-existing record means,
 *   6. an in-progress session in KEY+'_sess' survives the upgrade,
 *   7. the build marker flips to the new APP_BUILD — that flip is the only thing that makes an
 *      already-installed phone copy pick the update up,
 *   8. it all round-trips through saveLS()/JSON without losing a top-level key.
 *
 * Run: node _upgrade_test.cjs            (hermetic — reads the checked-in fixture, no network)
 */
const fs = require('fs');
const path = require('path');

const LEGACY = path.join(__dirname, '_legacy_build_k.html');
const WORKING = path.join(__dirname, 'index.html');
if (!fs.existsSync(LEGACY)) { console.error('FAIL: fixture _legacy_build_k.html is missing'); process.exit(1); }

/* One clock for BOTH builds, so "today", mondayOf() and the seeded week grid line up and a
   difference in the data can never be a difference in the date. */
const CLOCK = Date.UTC(2026, 8, 24, 12, 0, 0);

function scriptOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
  if (!m) throw new Error('no script block in ' + file);
  return { js: m[1], src };
}
function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '',
    style: { setProperty() {}, cssText: '' }, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, addEventListener() {}, removeEventListener() {}, remove() {},
    querySelectorAll: () => [], querySelector: () => null,
    getContext: () => ({ clearRect() {}, fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, arc() {}, stroke() {}, fill() {} }),
    setAttribute() {}, removeAttribute() {}, width: 0, height: 0, scrollTop: 0, click() {}, remove() {}
  };
}

/* Boot a build against a given localStorage, and hand back its internals plus the store. */
function boot(file, preload) {
  const { js } = scriptOf(file);
  const els = {}, store = Object.assign({}, preload || {});
  const problems = [];
  const getEl = id => (els[id] = els[id] || makeEl());
  class FakeDate extends Date {
    constructor(...a) { super(...(a.length ? a : [CLOCK])); }
    static now() { return CLOCK; }
  }
  const sandbox = {
    console: Object.assign(Object.create(console), {
      error: (...a) => problems.push('console.error: ' + a.join(' ')),
      warn: () => {}
    }),
    window: null,
    document: {
      querySelector: s => (s === 'main' ? getEl('main') : getEl(s)),
      querySelectorAll: () => [], createElement: () => makeEl(), createElementNS: () => makeEl(),
      getElementById: () => null, documentElement: makeEl(), body: makeEl(), addEventListener() {}
    },
    getComputedStyle: () => ({ getPropertyValue: p => ({ '--volt': '#cbf33a', '--dim': '#5f6873', '--ink': '#f2f4f7', '--hot': '#ff5a5a' }[p] || '') }),
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    navigator: {}, location: { search: '', pathname: '/index.html', reload() {}, replace() {} },
    URL: { createObjectURL: () => 'blob:x' },
    Blob: class { constructor(parts, o) { this.parts = parts; this.type = o && o.type; } },
    Date: FakeDate, Math, JSON, Object, Array, Number, String, Boolean, RegExp, parseInt, parseFloat,
    isNaN, isFinite, Set, Map, encodeURIComponent, decodeURIComponent, escape, unescape,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, matchMedia: () => ({ matches: false }),
    innerWidth: 390, innerHeight: 844, setTimeout, clearTimeout, setInterval, clearInterval,
    Function, Error, TypeError, RangeError, requestIdleCallback: () => 0, alert() {}, scrollTo() {},
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {};

  /* A guard on every name either build might expose; missing ones come back null rather than
     throwing, so an assertion about a function a build does not have is a FAIL with a name,
     not a crash. */
  const NAMES = ['G', 'S', 'EXS', 'EXBY', 'ROUTINES', 'MUSCLES', 'prof', 'freshProfile', 'saveLS', 'loadLS',
    'freshState', 'seed', 'sortHist', 'sessVol', 'weeklyVol', 'muscleVolume', 'recentPRs', 'bestEver',
    'sessionLoad', 'entryRir', 'setRirOf', 'hasRir', 'setStats', 'volSets', 'e1Sets', 'recountSession',
    'heatCard', 'vProg', 'vTrain', 'vCoach', 'vHist', 'vLib', 'vPlan', 'svgBars', 'dFull', 'ago', 'loc',
    'parseBackup', 'adoptBackup', 'nextLoad', 'todayISO', 'mondayOf', 'addDays', 'weekKeys',
    'allLifts', 'e1', 'bestE1', 'entryVol', 'impCount', 'setW', 'setHardW', 'WSEC', 'scoreOf',
    'exMuscles', 'repLoad', 'isBwEx'];
  const ret = ';return{' + NAMES.map(n => n + ':(typeof ' + n + '!=="undefined"?' + n + ':null)').join(',')
    + ',KEY:KEY,APP_BUILD:APP_BUILD,__S:()=>S,saveLS:()=>saveLS(),loadLS:()=>loadLS(),loadSess:()=>loadSess()};';
  const run = new Function('window', 'document', 'localStorage', 'navigator', 'location', 'URL', 'Blob',
    'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'innerWidth', 'innerHeight', 'getComputedStyle',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'console', 'Date', 'confirm', js + ret);
  let api = null, bootError = null;
  try {
    api = run(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.location,
      sandbox.URL, sandbox.Blob, sandbox.requestAnimationFrame, sandbox.cancelAnimationFrame, sandbox.matchMedia,
      390, 844, sandbox.getComputedStyle, setTimeout, clearTimeout, setInterval, clearInterval, sandbox.console,
      FakeDate, () => true);
  } catch (e) { bootError = e; }
  return { api, store, problems, bootError };
}

/* Every number reachable in a structure, in order. Comparing this between two builds catches
   "the analytics changed meaning" without depending on a single field name surviving a rename —
   a renamed field still has to produce the same numbers. */
function numbers(x, out) {
  out = out || [];
  if (typeof x === 'number') { out.push(Number.isFinite(x) ? +x.toFixed(6) : String(x)); return out; }
  if (Array.isArray(x)) { x.forEach(v => numbers(v, out)); return out; }
  if (x && typeof x === 'object') { Object.keys(x).sort().forEach(k => numbers(x[k], out)); return out; }
  return out;
}
const fp = x => JSON.stringify(numbers(x));
const histShape = h => JSON.stringify((h || []).map(s => ({
  id: s.id, date: s.date, name: s.name, dur: s.dur,
  entries: (s.entries || []).map(e => ({ id: e.id, rir: e.rir === undefined ? null : e.rir, sets: (e.sets || []).map(t => ({ w: t.w, r: t.r, k: t.k === undefined ? null : t.k, rir: t.rir === undefined ? null : t.rir })) }))
})));

/* `require()`ing this file gives you the two builds' loaders, so an ad-hoc question about what
   an upgrade changes ("what happens to nextLoad?") is answered with the real code rather than a
   reimplementation. Running it directly runs the gate. */
module.exports = { boot, fp, numbers, histShape, CLOCK, LEGACY, WORKING };
if (require.main !== module) return;

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  PASS', label); } else { fail++; console.log('  FAIL', label); } };
const sect = t => console.log('\n== ' + t + ' ==');

console.log('FORGE · UPGRADE TEST — live build k -> working build');
console.log('  legacy fixture:', path.basename(LEGACY), fs.statSync(LEGACY).size, 'bytes');

/* ---------- 1. BUILD THE LEGACY STORE WITH THE LEGACY BUILD ---------- */
sect('LEGACY STORE · written by the build the live site is serving');
const legacyBoot = boot(LEGACY, {});
ok(!legacyBoot.bootError, 'legacy build boots in the harness' + (legacyBoot.bootError ? ': ' + legacyBoot.bootError.message : ''));
if (legacyBoot.bootError) { console.log('\n1 failed, cannot continue'); process.exit(1); }
const L = legacyBoot.api;
const LEGACY_BUILD = L.APP_BUILD;
console.log('  legacy build marker:', LEGACY_BUILD);
ok(LEGACY_BUILD && LEGACY_BUILD !== '2026-08-25o', 'fixture is genuinely an older build (' + LEGACY_BUILD + ')');

/* seed() is the app's own demo generator — a realistic 9-week history with the legacy store
   shape (no profile key at all, entry-level rir only, v:1). */
L.G.regen();
const legacyHist = L.loadLS().hist;
ok(legacyHist.length >= 20, 'legacy build produced a realistic history (' + legacyHist.length + ' sessions)');
ok(L.loadLS().profile === undefined, 'the seeded legacy store has NO profile key (the backfill case)');

/* Now make it the messiest realistic old store:
   - the three profile fields that were deled from the app but that old stores still carry,
   - a legacy ENTRY-level rir (per-set effort did not exist in k),
   - an in-progress session, and
   - the build marker the installed phone copy would be carrying. */
const legacyStore = JSON.parse(JSON.stringify(L.loadLS()));
legacyStore.profile = { onboarded: true, goal: 'strength', level: 'advanced', days: 5, bw: 82.5, sex: 'm', rir: 2, injuries: ['shoulders'], standardsOn: true, birth: 1991, equipment: 'full gym', bar: 20 };
legacyStore.hist.forEach((s, i) => { if (i % 3 === 0) s.entries[0].rir = 2; });
legacyStore.bwLog = [{ date: '2026-08-01', kg: 84.2 }, { date: '2026-09-01', kg: 82.5 }];
legacyStore.lastExport = '2026-09-10';
legacyStore.over = { bench: '2026-09-18' };
legacyStore.pain = [{ date: '2026-09-12', exId: 'ohp', tier: 2 }];
const legacySess = { t0: CLOCK - 600000, routineId: 'upper-a', name: 'Upper A', entries: [{ id: 'bench', sets: [{ w: 90, r: 5, done: true }, { w: 90, r: 5, done: false }] }] };
const preload = { 'forge.v1': JSON.stringify(legacyStore), 'forge.v1_sess': JSON.stringify(legacySess), forge_build: LEGACY_BUILD };
const legacyKeys = Object.keys(legacyStore).sort();
console.log('  legacy store keys:', legacyKeys.join(', '));

/* THE BASELINE MUST COME FROM THE SAME STORE. The first version of this file compared the new
   build's reading of the MUTATED store against the first legacy instance's reading of its own
   un-mutated in-memory state — so the entry-level `rir` the mutations add was visible to one side
   and not the other, and every difference it reported was an artefact of that. Boot a SECOND
   legacy instance on exactly the bytes the working build is about to receive. */
const L2 = boot(LEGACY, preload).api;
ok(JSON.stringify(L2.loadLS().hist) === JSON.stringify(legacyStore.hist),
  'the legacy baseline instance is loaded from the identical store the working build gets');
const legacyMeaning = {
  muscle: fp(L2.muscleVolume('2000-01-01', '2100-01-01')),
  weekly: fp(L2.weeklyVol(10)),
  prs: fp(L2.recentPRs(365)),
  load: fp(legacyStore.hist.map(s => L2.sessionLoad(s))),
  hist: histShape(legacyStore.hist)
};
ok(legacyMeaning.muscle.length > 100, 'captured the legacy build\'s reading of its own store');

/* ---------- 2. OPEN IT IN THE WORKING BUILD ---------- */
sect('UPGRADE · the working build opens the live store');
const W = boot(WORKING, preload);
ok(!W.bootError, 'working build boots on the legacy store' + (W.bootError ? ': ' + W.bootError.message : ''));
if (W.bootError) { console.log('\n1 failed, cannot continue: ' + W.bootError.stack); process.exit(1); }
ok(W.problems.length === 0, 'no console.error during boot' + (W.problems.length ? ': ' + W.problems.join(' | ') : ''));
console.log('  working build marker:', W.api.APP_BUILD);

const loaded = W.api.loadLS();
ok(!!loaded, 'the store parses');
ok(loaded.hist.length === legacyStore.hist.length, 'every session survived (' + loaded.hist.length + '/' + legacyStore.hist.length + ')');
ok(histShape(loaded.hist) === legacyMeaning.hist, 'NOTHING in the history changed — ids, dates, weights, reps, set kinds and effort are byte-identical');

/* ---------- 3. THE HISTORY STILL MEANS THE SAME THING ---------- */
sect('MEANING · the analytics read the same numbers');
const R = W.api;
const OLD = L2.muscleVolume('2000-01-01', '2100-01-01'), NEW = R.muscleVolume('2000-01-01', '2100-01-01');
const tot = (m, o) => Object.keys(o).reduce((s, k) => s + o[k][m], 0);
const drift = field => Object.keys(OLD).filter(k => OLD[k][field] !== NEW[k][field])
  .map(k => k + ' ' + OLD[k][field] + '->' + NEW[k][field]);

/* The volume contract, field by field, because a single blob fingerprint that fails tells you
   nothing about WHICH number moved. Since build 2026-09-30b one field shifts DELIBERATELY: a
   bodyweight set now carries the lifter's own mass (repLoad — sets count the mass they moved:
   body, plus added weight, minus assistance, floored at zero). The only shift any tonnage
   series is allowed is exactly that rule, computed here from first principles on the identical
   bytes: per working set, the two builds' repLoad difference, attributed to muscles by the same
   primary/full and secondary/WSEC weights the audit itself uses. Sets, effort, PR scoring and
   history bytes stay asserted byte-identical. */
const perEntryDelta = (s, en) => R.volSets(en.sets)
  .reduce((a, st) => a + st.r * (R.repLoad(en.id, st.w, s.date) - L2.repLoad(en.id, st.w, s.date)), 0);
const expMuscle = {}, expWeek = {};
loaded.hist.forEach(s => {
  const wk = R.mondayOf(s.date);
  s.entries.forEach(en => {
    const d = perEntryDelta(s, en);
    const mx = R.exMuscles(en.id);
    mx.p.forEach(m => { expMuscle[m] = (expMuscle[m] || 0) + d; });
    mx.s.forEach(m => { expMuscle[m] = (expMuscle[m] || 0) + d * R.WSEC; });
    expWeek[wk] = (expWeek[wk] || 0) + d;
  });
});
const bwSetsInHistory = R.volSets(loaded.hist.flatMap(s => s.entries).flatMap(e => e.sets)).length > 0
  && loaded.hist.some(s => s.entries.some(en => R.isBwEx(R.EXBY[en.id])));
ok(bwSetsInHistory, 'the store really contains bodyweight work, so the rule is actually exercised');

['sets', 'verified', 'unverified', 'sess', 'last'].forEach(f => {
  const d = drift(f);
  ok(d.length === 0, 'muscle ' + f + ' unchanged' + (d.length ? ' — DRIFT: ' + d.join(', ') : '')
    + (f === 'sets' ? ' (total ' + tot('sets', NEW).toFixed(1) + ' hard sets)' : '')
    + (f === 'verified' ? ' (verified ' + tot('verified', NEW).toFixed(1) + ' / unverified ' + tot('unverified', NEW).toFixed(1) + ')' : ''));
});
const volBad = Object.keys(NEW)
  .map(k => ({ k, d: NEW[k].vol - OLD[k].vol, e: expMuscle[k] || 0 }))
  .filter(x => Math.abs(x.d - x.e) > 0.1001);
ok(volBad.length === 0, 'muscle vol shifted by EXACTLY the bodyweight-tonnage rule'
  + (volBad.length ? ' — DRIFT: ' + volBad.map(x => x.k + ' ' + x.d.toFixed(1) + ' vs expected ' + x.e.toFixed(1)).join(', ') : ''));
const structOk = Object.keys(NEW).every(k =>
  NEW[k].sets === OLD[k].sets && NEW[k].verified === OLD[k].verified &&
  NEW[k].unverified === OLD[k].unverified && NEW[k].sess === OLD[k].sess &&
  NEW[k].last === OLD[k].last && Math.abs(NEW[k].vol - OLD[k].vol - (expMuscle[k] || 0)) <= 0.1001);
ok(structOk, 'the whole muscle-volume structure is the legacy reading plus exactly the bodyweight rule');
const WNEW = R.weeklyVol(10), WOLD = L2.weeklyVol(10);
ok(WNEW.length === WOLD.length && WNEW.every((w, i) => w.full === WOLD[i].full),
  'the weekly series still spans the same weeks');
ok(WNEW.every((w, i) => Math.abs(w.v - WOLD[i].v - (expWeek[w.full] || 0)) <= 0.1001),
  'weekly volume is the legacy series plus exactly the bodyweight-tonnage rule');
ok(fp(R.recentPRs(365).map(x => x.date + ':' + x.id + ':' + x.score.toFixed(3)))
  === fp(L2.recentPRs(365).map(x => x.date + ':' + x.id + ':' + x.score.toFixed(3))),
  'the same PRs, on the same dates, at the same scores');
ok(fp(loaded.hist.map(s => R.sessionLoad(s))) === legacyMeaning.load, 'session load identical');

/* The number that actually lands on the bar. If the upgrade silently re-prescribed today's
   weights, that is the worst possible regression and no other suite would see it.

   DELIBERATE CHANGE, and why this is no longer a "nothing may move" check: the engine used
   to round every load to one global 1.25 kg grid whatever the exercise, which prescribed an
   18.75 kg dumbbell and a 117.5 kg squat (48.75 kg a side). Snapping to each exercise's OWN
   def.inc is a bug fix, so some loads necessarily move — the upgrade cannot both stop
   prescribing unloadable weights and leave every number alone. What must still hold, and is
   what this asserts, is that the DECISION did not move: each new load is the old load
   re-snapped to something loadable, never a re-prescription. So every new load is on its own
   increment grid and sits within one increment of the load the old build prescribed. */
if (typeof R.nextLoad === 'function' && typeof L2.nextLoad === 'function') {
  const ids = R.allLifts();
  const wOf = (b, id) => { try { const r = b(id); return r && r.w !== undefined ? r.w : r && r.load; } catch (e) { return NaN; } };
  const moved = [], offGrid = [], jumped = [];
  ids.forEach(id => {
    const nw = wOf(R.nextLoad, id), ow = wOf(L2.nextLoad, id);
    if (typeof nw !== 'number' || typeof ow !== 'number') return;
    const inc = (R.EXBY && R.EXBY[id] && R.EXBY[id].def && R.EXBY[id].def.inc) || 0;
    if (nw > 0 && inc > 0 && Math.abs(nw / inc - Math.round(nw / inc)) > 1e-9) offGrid.push(id + ' ' + nw + ' (inc ' + inc + ')');
    if (Math.abs(nw - ow) > 1e-9) {
      moved.push(id + ' ' + ow + '->' + nw);
      if (inc > 0 && Math.abs(nw - ow) > inc + 1e-9) jumped.push(id + ' ' + ow + '->' + nw + ' (inc ' + inc + ')');
    }
  });
  ok(offGrid.length === 0, 'every prescribed load is now on a loadable grid (' + ids.length + ' lifts)'
    + (offGrid.length ? ' — STILL UNLOADABLE: ' + offGrid.join(', ') : ''));
  ok(jumped.length === 0, 'no load moved by more than one increment — the decision is unchanged, only the rounding'
    + (jumped.length ? ' — RE-PRESCRIBED: ' + jumped.join(', ') : ''));
  console.log('  note: ' + moved.length + ' of ' + ids.length + ' loads re-snapped to a loadable weight'
    + (moved.length ? ': ' + moved.join(', ') : ''));
} else { console.log('  note: nextLoad not exposed in both builds — prescription drift not checkable'); }
if (typeof R.sessVol === 'function' && typeof L2.sessVol === 'function') {
  const sessBad = loaded.hist.map((s, i) => ({
  i, d: R.sessVol(s) - L2.sessVol(legacyStore.hist[i]),
  e: s.entries.reduce((a, en) => a + perEntryDelta(s, en), 0)
})).filter(x => Math.abs(x.d - x.e) > 0.1001);
ok(sessBad.length === 0, 'per-session tonnage is the legacy reading plus exactly the bodyweight rule'
  + (sessBad.length ? ' — DRIFT at sessions ' + sessBad.slice(0, 5).map(x => x.i + ': ' + x.d.toFixed(1) + ' vs ' + x.e.toFixed(1)).join(', ') : ''));
} else { console.log('  note: sessVol not exposed in both builds — tonnage compared through muscle volume instead'); }

/* ---------- 4. THE RESIDUE IS KEPT, NOT REWRITTEN ---------- */
sect('RESIDUE · old keys are preserved, new keys are additive');
const p = R.prof();
ok(p.goal === 'strength' && p.level === 'advanced' && p.days === 5 && p.bw === 82.5 && p.sex === 'm',
  'the profile answers the user gave are intact');
ok(Array.isArray(p.injuries) && p.injuries.indexOf('shoulders') >= 0, 'reported injuries survived');
ok(typeof R.freshProfile === 'function' && Object.keys(R.freshProfile()).every(k => k in p),
  'every current profile key exists after the upgrade (backfilled, not required)');
ok(loaded.profile.birth === 1991 && loaded.profile.equipment === 'full gym' && loaded.profile.bar === 20,
  'the three deleted-but-still-stored profile fields are left inert, not rewritten or dropped');
ok(loaded.bwLog.length === 2 && loaded.lastExport === '2026-09-10' && loaded.pain.length === 1 && !!loaded.over,
  'bwLog / lastExport / pain / over all survive');
ok(legacyKeys.every(k => k in loaded), 'no top-level key was dropped by the upgrade');

/* ---------- 5. LEGACY ENTRY-LEVEL EFFORT STILL READS ---------- */
sect('EFFORT · a legacy entry-level rir is still read, per-set remains canonical');
const withRir = loaded.hist.filter(s => (s.entries || []).some(e => e.rir !== undefined));
ok(withRir.length > 0, 'the fixture carries legacy entry-level effort (' + withRir.length + ' sessions)');
if (typeof R.entryRir === 'function') {
  const e = withRir[0].entries.find(x => x.rir !== undefined);
  ok(R.entryRir(e) === 2, 'entryRir() reads the legacy entry-level reading (got ' + R.entryRir(e) + ')');
  ok(R.entryRir({ sets: [{ rir: 5 }, { rir: 1 }] }) === 1, 'entryRir() derives the HARDEST set when per-set readings exist');
} else { ok(false, 'entryRir() exists in the working build'); }

/* ---------- 6. THE IN-PROGRESS SESSION IS NOT LOST ---------- */
sect('IN PROGRESS · an unfinished session survives the upgrade');
const sess = W.api.loadSess();
ok(!!sess && !!sess.entries && sess.entries.length === 1, 'the in-progress session loads with its entries');
ok(sess && sess.entries[0].sets.length === 2 && sess.entries[0].sets[0].w === 90, 'its logged sets are intact');

/* ---------- 7. THE MARKER FLIPS (this is what updates an installed phone) ---------- */
sect('UPDATE MARKER · the installed copy is told to update');
ok(W.store.forge_build === R.APP_BUILD, 'forge_build was rewritten from ' + LEGACY_BUILD + ' to ' + W.store.forge_build);
ok(W.store.forge_build !== LEGACY_BUILD, 'the marker genuinely changed, so a cached shell is replaced');

/* ---------- 8. EVERY TAB RENDERS, AND THE NEW SURFACES SEE THE OLD DATA ---------- */
sect('RENDER · every tab draws the upgraded store');
let renderErr = null, views = {};
try { ['vTrain', 'vCoach', 'vHist', 'vProg', 'vLib', 'vPlan'].forEach(v => { views[v] = R[v] ? R[v]() : null; }); }
catch (e) { renderErr = e; }
ok(!renderErr, 'all six tabs render without throwing' + (renderErr ? ': ' + renderErr.message : ''));
ok(['vTrain', 'vCoach', 'vHist', 'vProg', 'vLib', 'vPlan'].every(v => typeof views[v] === 'string' && views[v].length > 50),
  'each tab produced real markup');
ok(!/undefined|NaN|\[object Object\]/.test(views.vProg || ''), 'no undefined / NaN leaked into the Progress markup');

if (typeof R.heatCard === 'function') {
  const card = R.heatCard();
  const cells = (card.match(/class="hcell/g) || []).length;
  const shaded = (loaded.hist ? loaded.hist : []).length;
  ok(cells === 56, 'the new calendar renders 56 day cells on an upgraded store (got ' + cells + ')');
  ok(/hdow/.test(card) && /hwl/.test(card), 'it is a real calendar (weekday rows + week axis)');
  ok(shaded > 0 && /Last session/.test(card), 'the recency headline describes the UPGRADED history');
  ok(!/undefined|NaN/.test(card), 'the calendar contains no undefined/NaN');
} else { ok(false, 'heatCard() exists in the working build'); }

/* ---------- 9. ROUND TRIP ---------- */
sect('ROUND TRIP · saving the upgraded store loses nothing');
const before = JSON.parse(W.store['forge.v1']);
W.api.saveLS();
const after = JSON.parse(W.store['forge.v1']);
ok(after.hist.length === before.hist.length, 'hist length stable through saveLS() (' + after.hist.length + ')');
ok(histShape(after.hist) === histShape(before.hist), 'no set row was altered by a save');
ok(Object.keys(before).every(k => k in after), 'saving added no loss of top-level keys');
ok(JSON.stringify(after).length > 1000, 'the store is JSON-serializable at size ' + JSON.stringify(after).length);
ok(loaded.profile.birth === 1991 && after.profile && after.profile.birth === 1991,
  'the inert legacy fields survive a full save round trip');

/* Re-boot on the SAVED store: the second open must be as clean as the first (the phone will
   do exactly this every launch). */
const W2 = boot(WORKING, W.store);
ok(!W2.bootError && histShape(W2.api.loadLS().hist) === histShape(after.hist), 'a second boot on the saved store is clean and identical');

console.log('\n' + (fail ? 'UPGRADE TEST: ' + fail + ' FAILED, ' + pass + ' passed' : 'UPGRADE TEST: ALL GREEN (' + pass + ' passed, 0 failed)'));
process.exit(fail ? 1 : 0);
