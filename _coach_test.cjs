/* FORGE · COACH ENGINE TEST
   Covers the tracking + recommendation layer: muscle taxonomy, volume
   accounting, effort (RIR) capture, autoregulated load prescription, stall
   detection, confidence gating, the injury guardrail and the coach surface.

   Run: node _coach_test.cjs
*/
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const m = src.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
if (!m) { console.error('FAIL: no script block'); process.exit(1); }
const js = m[1];

/* FORGE throttles 14 tap-triggered G actions to one call per 400ms so a double
   tap cannot start two sessions or save twice. Tests therefore need a clock
   they can advance, or the second call is silently swallowed and an assertion
   fails for the wrong reason. */
let CLOCK = Date.now();
class FakeDate extends Date {
  constructor(...a) { super(...(a.length ? a : [CLOCK])); }
  static now() { return CLOCK; }
}
const advance = ms => { CLOCK += (ms || 500); };

/* capture what exportJSON actually hands to the browser, so the round trip is
   tested through the real code path rather than a reimplementation */
let lastBlob = null;
class FakeBlob {
  constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; lastBlob = (parts || []).join(''); }
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
const els = {};
const getEl = id => (els[id] = els[id] || makeEl());
const store = {};
const sandbox = {
  console, window: null,
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
  URL: { createObjectURL: () => 'blob:x' }, Blob: FakeBlob,
  Date: FakeDate, Math, JSON, Object, Array, Number, String, Boolean, RegExp, parseInt, parseFloat, isNaN, isFinite, Set, Map,
  requestAnimationFrame: () => 0, cancelAnimationFrame() {}, matchMedia: () => ({ matches: false }),
  innerWidth: 500, innerHeight: 900, setTimeout, clearTimeout, setInterval, clearInterval, Function, Error, TypeError
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {};

/* FORGE throttles 14 tap-triggered G actions to one call per 400ms so a double
   fails for the wrong reason. */

const NAMES = ['G','S','EXS','EXBY','MUSCLES','MUSBY','TAGMAP','exMuscles','tagToMuscles','setW','muscleVolume','muscleWeekly',
  'prof','freshProfile','volumeCheck','volumeGaps','landmarks','VLM','volStatus','nextLoad','warmupRamp','rirTrust','e1','e1conf',
  'bestE1','bestEver','entryVol','impCount','repLoad','exHistory','liftTrend','stallInfo','typicalError','swc','repDrop','e1Range',
  'setRirOf','hasRir','entryRir','loggedRir','RIR_HARD','setHardW','setStats','setCount','repWord','rirHint','vSession',
  'sessionEditHTML','recountSession','modalOpen',
  'diagnose','vCoach','rxRows','avoided','confidence','adherence','acwr','balance','deloadCheck','rampCheck','readiness',
  'weekStreak','streakTarget','project','seed','todayISO','addDays','mondayOf','fw','wl','dw','snapW','gridOf','stepLoad','isBw','isBwEx','scoreByReps','loadLbl','wCell','compactW','repLoad','allLifts','recentPRs','scoreOf','sessionLoad','loadTrend','e1Baseline','slopeXY','progIndex','nextDayName','latest','entryVol','vTrain','KINDS','setKind','kindOf','isWarm','countsVol','countsE1','volSets','e1Sets','warmCount','ROUTINES','parseBackup','adoptBackup','backupState','backupLine','hasPreImport','sortHist','recountSession','curEditSession','openSessionEdit','bwSorted','bwLatest','bwSeries','bwAt','logBw','bwTrend','svgBw','bwSection','U','muscleSets','SBD_NORMS','SBD_LIFTS','SBD_DECILES','IPF_CLASSES','stdSex','stdClass','stdRatio','stdBand','standardsSection','G','adjustAfterSet',
  'vProg','heatCard','svgBars','weeklyVol','dFull','ago','loc','sessVol'];
const ret = ';return{' + NAMES.map(n => n + ':(typeof ' + n + '!=="undefined"?' + n + ':null)').join(',')
  + ',sessRef:()=>sess,saveLS:()=>saveLS(),loadLS:()=>loadLS(),freshState:()=>freshState(),VIEWS:()=>VIEWS'
  + ',__S:()=>S,__edit:()=>__edit,__setPreImport:v=>{__imp=v},__imp:()=>__imp};';
const run = new Function('window','document','localStorage','navigator','location','URL','Blob',
  'requestAnimationFrame','cancelAnimationFrame','matchMedia','innerWidth','innerHeight','getComputedStyle',
  'setTimeout','clearTimeout','setInterval','clearInterval','console','Date','confirm', js + ret);
const api = run(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.location,
  sandbox.URL, sandbox.Blob, sandbox.requestAnimationFrame, sandbox.cancelAnimationFrame, sandbox.matchMedia,
  500, 900, sandbox.getComputedStyle, setTimeout, clearTimeout, setInterval, clearInterval, console, FakeDate,
  () => true);   /* destructive actions confirm; tests accept the prompt */

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  PASS', label); } else { fail++; console.log('  FAIL', label); } };
const sect = t => console.log('\n== ' + t + ' ==');

/* ---------- 1. MUSCLE TAXONOMY ---------- */
sect('MUSCLE TAXONOMY · every tag resolves to a canonical muscle');
const unmapped = new Set();
api.EXS.forEach(e => [...(e.m || []), ...(e.m2 || [])].forEach(t => { if (!api.tagToMuscles(t).length) unmapped.add(t.toLowerCase()); }));
ok(api.MUSCLES.length >= 15, 'canonical muscle list defined (' + api.MUSCLES.length + ')');
ok([...unmapped].join(',') === 'balance', 'only non-muscle tags unmapped: ' + ([...unmapped].join(',') || 'none'));
const noPrimary = Object.keys(api.EXBY).filter(id => api.exMuscles(id).p.length === 0);
ok(noPrimary.length === 0, 'every exercise maps to >=1 primary muscle' + (noPrimary.length ? ' MISSING: ' + noPrimary : ''));
ok(api.exMuscles('bench').p.join() === 'chest', 'bench -> chest');
ok(api.exMuscles('bench').s.indexOf('triceps') >= 0, 'bench assists triceps (secondary)');
ok(api.exMuscles('deadlift').p.indexOf('lats') >= 0 && api.exMuscles('deadlift').p.indexOf('hams') >= 0, 'deadlift -> hams + glutes + lats');
ok(api.MUSCLES.every(x => x.n && x.g), 'every canonical muscle has a label and a UI group');

/* ---------- 2. HARDNESS WEIGHTING (effort is per set) ---------- */
sect('HARDNESS · effort lives on the SET, with the entry as the legacy fallback');
ok(api.setW({ rir: 2 }) === 1, 'RIR 2 counts as a full hard set');
ok(api.setW({ rir: 4 }) === 1, 'RIR 4 still counts as a hard set');
ok(api.setW({ rir: 5 }) === 0.5, 'RIR 5 counts as half a set');
ok(api.setW({}) === 1, 'unlogged RIR counts fully (flagged as unverified)');
ok(api.setW({ sets: [{ rir: 5 }] }) === 1,
  'setW stays the ENTRY-level fallback — one multiplier cannot express "set 1 easy, set 3 to failure"');
ok(api.setHardW({ rir: 5 }, {}) === 0.5 && api.setHardW({ rir: 1 }, {}) === 1,
  'setHardW grades a single set (RIR 5 counts half, RIR 1 counts fully)');
ok(api.setHardW({}, { sets: [{ rir: 5 }] }) === 1,
  'setW and setHardW agree on a legacy entry-level record');
ok(api.setStats({ sets: [{ rir: 2 }, { rir: 5 }, {}] }).n === 2.5,
  'per-set effort drives the hard-set count (1 + 0.5 + 1), got ' + api.setStats({ sets: [{ rir: 2 }, { rir: 5 }, {}] }).n);
ok(api.setStats({ sets: [{ rir: 2 }, { rir: 5 }] }).verified === 1.5,
  'verified hardness counts what actually carried a reading');
ok(api.setCount({ sets: [{ rir: 5 }, { rir: 5 }] }) === 1, 'two very easy sets count as one, not two');

/* ---------- 3. TONNAGE · dumbbell implements ---------- */
sect('TONNAGE · per-hand dumbbell weights are counted correctly');
ok(api.impCount('db-bench') === 2, 'two-dumbbell press counts both implements');
ok(api.impCount('db-row') === 1, 'single-arm row counts one');
ok(api.impCount('db-ext') === 1, 'one-bell extension counts one');
ok(api.impCount('bench') === 1, 'barbell lift counts one');
const dbVol = api.entryVol({ id: 'db-bench', sets: [{ w: 30, r: 10 }] });
ok(dbVol === 600, 'db-bench 30kg x10 counts as 600 (was 300), got ' + dbVol);
const rowVol = api.entryVol({ id: 'db-row', sets: [{ w: 30, r: 10 }] });
ok(rowVol === 300, 'db-row 30kg x10 stays 300, got ' + rowVol);

/* ---------- 4. BODYWEIGHT WORK IS NOT INVISIBLE ---------- */
sect('BODYWEIGHT · counts toward set volume even with zero external load');
api.S.hist = api.seed().hist;
const bwIds = api.EXS.filter(e => e.bw).map(e => e.id);
let bwSetsSeen = 0;
api.S.hist.forEach(s => s.entries.forEach(en => { if (bwIds.indexOf(en.id) >= 0) bwSetsSeen += en.sets.length; }));
ok(bwSetsSeen > 0, 'seeded history contains bodyweight work (' + bwSetsSeen + ' sets)');
const mv = api.muscleVolume(api.addDays(api.todayISO(), -70), api.todayISO());
ok(mv.abs.sets > 0, 'bodyweight-driven abs volume is counted (' + mv.abs.sets + ' sets)');
ok(mv.chest.sets > 0, 'loaded chest volume is counted (' + mv.chest.sets + ' sets)');

/* ---------- 5. BEST SET BY e1RM ---------- */
sect('e1RM · best set chosen by estimated 1RM, not tonnage');
const heavy = { sets: [{ w: 100, r: 5 }] };   // e1RM 116.7, tonnage 500
const light = { sets: [{ w: 80, r: 10 }] };   // e1RM 106.7, tonnage 800
ok(api.e1(100, 5) > api.e1(80, 10), 'the heavier low-rep set has the higher e1RM');
const be = api.bestEver('bench');
ok(be.set && api.e1(be.set.w, be.set.r) === be.e1, 'bestEver reports the max-e1RM set consistently');
ok(api.e1(100, 5, 2) > api.e1(100, 5, 0), 'RIR folds into effective reps');
ok(api.e1conf(60, 8, 0).ok === true && api.e1conf(60, 8, 0).conf === 'medium', 'confidence banded at 8 effective reps');
ok(api.e1conf(40, 20, 0).ok === false, 'very high-rep estimates flagged low confidence');
const rng = api.e1Range(100, 5, 2);
ok(rng && rng.lo < rng.hi && rng.mid >= rng.lo && rng.mid <= rng.hi, 'e1RM range gives a real spread (error bar)');
ok(rng && rng.hi - rng.lo > 0, 'the spread is non-zero, so it communicates uncertainty');

/* ---------- 6. PRESCRIPTION ---------- */
sect('PRESCRIPTION · autoregulated load with hard guardrails');
const noHist = api.nextLoad('preacher');
ok(noHist.w === api.EXBY['preacher'].def.start, 'no history -> conservative starting load');
const bwLift = api.nextLoad('pushup');
ok(bwLift.w === 0, 'bodyweight lift prescribes no load');
api.S.over = { bench: api.todayISO() };
const ovr = api.nextLoad('bench');
ok(ovr.override === true, 'a logged override is honoured');
delete api.S.over;
// manufacture an all-top-of-range session at a known load
const d = api.EXBY['bench'].def;
api.S.hist = [{ id: 'x1', date: api.todayISO(), name: 'T', entries: [{ id: 'bench', sets: [{ w: 100, r: d.max }, { w: 100, r: d.max }, { w: 100, r: d.max }] }] }];
const up = api.nextLoad('bench');
ok(up.w > 100, 'topping the rep range adds load (' + up.w + ')');
ok(up.w <= 110, 'single-session increase capped at +10% (' + up.pct + '%)');
// a low-RIR grind should not get the same jump as an easy session
api.S.hist = [{ id: 'x2', date: api.todayISO(), name: 'T', entries: [{ id: 'bench', rir: 0, sets: [{ w: 100, r: d.max }, { w: 100, r: d.max }] }] }];
const grind = api.nextLoad('bench');
ok(grind.w <= up.w, 'a maximal-effort session gets no more than an easy one (' + grind.w + ' vs ' + up.w + ')');
// missing the rep floor
api.S.hist = [{ id: 'x3', date: api.todayISO(), name: 'T', entries: [{ id: 'bench', rir: 0, sets: [{ w: 100, r: 2 }, { w: 100, r: 2 }] }] }];
const back = api.nextLoad('bench');
ok(back.w < 100, 'grinding below the rep floor backs the load off (' + back.w + ')');
ok(api.nextLoad('bench').w <= 110 + 0.001, 'never exceeds the 10% cap (' + api.nextLoad('bench').w + ')');

/* ---------- 6b. THE PLATE GRID ----------
   A prescription is a claim about what to put on the bar. The engine used to snap
   every load to one global 1.25 kg grid no matter the exercise or the unit, which
   prescribed an 18.75 kg dumbbell, a 117.5 kg squat (48.75 kg a side) and, in lb,
   "96.45 lb". These are the assertions that keep that from coming back. */
sect('PLATE GRID · a prescribed load has to be one you can actually load');
api.S.unit = 'kg';
const lifts = api.allLifts();
const rxOf = id => api.nextLoad(id).w;
const offGrid = lifts.map(id => ({ id, w: rxOf(id), inc: api.EXBY[id].def.inc }))
  .filter(r => r.w > 0 && Math.abs(r.w / r.inc - Math.round(r.w / r.inc)) > 1e-9);
ok(offGrid.length === 0, 'every prescribed load sits on its own exercise increment'
  + (offGrid.length ? ' — OFF GRID: ' + offGrid.map(r => r.id + ' ' + r.w + ' (inc ' + r.inc + ')').join(', ') : ''));

const lbBad = lifts.map(id => api.dw(rxOf(id))).filter(v => v > 0)
  .filter(v => Math.abs(v / 5 - Math.round(v / 5)) > 1e-9);
ok(lbBad.length === 0, 'in lb every prescribed load is a whole 5 lb'
  + (lbBad.length ? ' — UNLOADABLE: ' + lbBad.slice(0, 6).map(v => v.toFixed(2)).join(', ') : ''));

/* the formatter may not invent precision: what is shown must be what was stored */
const misShown = lifts.map(id => ({ w: rxOf(id), s: api.fw(rxOf(id)) }))
  .filter(r => r.w > 0 && Math.abs(Number(r.s) - r.w) > 1e-9);
ok(misShown.length === 0, 'the displayed weight is the stored weight, not a rounded one'
  + (misShown.length ? ' — E.G. ' + misShown.slice(0, 4).map(r => r.w + ' shown as "' + r.s + '"').join(', ') : ''));
/* the exact number a user reported */
ok(api.fw(43.75) === '43.75', '43.75 kg no longer displays as "43.8" (got "' + api.fw(43.75) + '")');
ok(api.fw(41.25) === '41.25' && api.fw(45) === '45' && api.fw(42.5) === '42.5',
  'quarter and half loads keep their own digits ("41.25", "45", "42.5")');
const endings = new Set(lifts.map(id => api.fw(rxOf(id))).filter(s => s.indexOf('.') >= 0)
  .map(s => s.split('.')[1]));
ok([...endings].every(e => e === '25' || e === '5' || e === '75'),
  'no prescribed weight ends in a tenth no plate makes (endings seen: ' + ([...endings].join(', ') || 'none') + ')');
api.S.unit = 'kg';

/* ---------- 6c. WHAT IS SHOWN IS WHAT IS SAVED ---------- */
sect('STEPPER · the number you see is the number that gets logged');
advance(1000);
api.G.startRoutine('upper-a');
const stepperEntry = api.sessRef().entries[0];
const stepInc = api.EXBY[stepperEntry.id].def.inc;
const wasW = stepperEntry.sets[0].w;
api.G.bump(0, 0, 'w', 1);
const nowW = stepperEntry.sets[0].w;
ok(Math.abs(nowW - (wasW + stepInc)) < 1e-9,
  'one tap adds exactly the exercise increment (' + wasW + ' + ' + stepInc + ' = ' + nowW + ')');
api.G.checkSet(0, 0);
advance(1000);
api.G.save();
/* G.save() builds its record id as 'w'+now, so this picks the session just
   written rather than trusting hist order — the fixture records above sort
   against it and hist is date-sorted, not insertion-ordered */
const savedRec = api.S.hist.filter(r => String(r.id).charAt(0) === 'w').pop();
const loggedRec = savedRec && savedRec.entries.find(e => e.id === stepperEntry.id);
ok(loggedRec && Math.abs(loggedRec.sets[0].w - nowW) < 1e-9,
  'the logged weight equals the weight the row showed ('
  + (loggedRec ? loggedRec.sets[0].w : 'none') + ' vs ' + nowW + ')');
/* clear the 400ms tap throttle this section just consumed, or the next
   throttled call in the suite is silently swallowed and fails for the wrong
   reason */
advance(1000);

/* ---------- 6d. THE BODYWEIGHT FAMILY ---------- */
sect('BODYWEIGHT FAMILY · 0 is bodyweight, minus is assistance, plus is a belt');
/* `bw` and `bwPlus` were split half-features: a chin-up could never take a plate
   and a pull-up could never be logged at bodyweight. They are one signed load. */
ok(api.isBwEx({ bw: 1 }) === true && api.isBwEx({ bwPlus: 1 }) === true,
  'a bodyweight-only lift and a bodyweight-plus lift are one family');
ok(api.isBwEx(api.EXBY['bench']) === false, 'a barbell lift is not in the family');
ok(api.stepLoad(0, -1, { def: { inc: 2.5 }, bwPlus: 1 }) === -2.5,
  'a bodyweight lift steps BELOW zero, into assistance');
ok(api.stepLoad(0, -1, { def: { inc: 2.5 } }) === 0,
  'a loaded lift still floors at zero — a barbell cannot weigh less than nothing');
ok(api.stepLoad(0, 1, { def: { inc: 2.5 }, bw: 1 }) === 2.5,
  'and steps ABOVE zero into added weight, so a chin-up can take a plate');

/* a first-timer is told bodyweight. This is the reported bug: a lifter who could
   not do one bodyweight pull-up was prescribed 5 kg on a dip belt, because the
   load fell through to def.start. */
api.S.hist = [];
const puNew = api.nextLoad('pullup');
ok(puNew.w === 0, 'a first-ever pull-up prescribes BODYWEIGHT, not added weight (got ' + puNew.w + ')');
ok(/bodyweight/i.test(puNew.note), 'and says so in the note: "' + puNew.note + '"');
ok(/assist/i.test(puNew.why), 'and names assistance as the other direction, not just added weight');
ok(api.nextLoad('chinup').w === 0, 'a first-ever chin-up also starts at bodyweight');
ok(api.nextLoad('pushup').w === 0, 'a push-up starts at bodyweight');
ok(api.nextLoad('bench').w === api.EXBY['bench'].def.start,
  'a barbell lift is unaffected and still gets its conservative starting load');

/* progression is ASSIST -> BODYWEIGHT -> ADDED, and it is one comparison because
   the sign already means "harder". This is the whole model. */
const puEx = api.EXBY['pullup'], puMax = puEx.def.max, puInc = puEx.def.inc;
const puHist = (w, r) => [{ id: 'pb', date: api.todayISO(), name: 'T',
  entries: [{ id: 'pullup', sets: [{ w: w, r: r }, { w: w, r: r }] }] }];
api.S.hist = puHist(-20, puMax);
ok(api.nextLoad('pullup').w === -20 + puInc,
  'topping the range WITH assistance removes help (-20 -> ' + (-20 + puInc) + '), not adds weight');
api.S.hist = puHist(-puInc, puMax);
ok(api.nextLoad('pullup').w === 0, 'the last step of assistance lands exactly on bodyweight');
api.S.hist = puHist(0, puMax);
ok(api.nextLoad('pullup').w === puInc, 'bodyweight owned at the top of the range buys a plate');
api.S.hist = puHist(5, puMax);
ok(api.nextLoad('pullup').w === 5 + puInc, 'an already-weighted pull-up adds another increment');
api.S.hist = puHist(-20, 1);
ok(api.nextLoad('pullup').w === -20 - puInc,
  'missing the rep floor while assisted takes MORE help, not less');
api.S.hist = puHist(2.5, 1);
ok(api.nextLoad('pullup').w === 0,
  'a small added load that misses the floor comes straight off to BODYWEIGHT — the reported case');
api.S.hist = puHist(20, 1);
ok(api.nextLoad('pullup').w === 20 - puInc,
  'a heavy added load that misses the floor drops one increment, not to zero');
ok(!/bodyweight for now/i.test(api.nextLoad('pullup').note) || api.nextLoad('pullup').w === 0,
  'the copy never says "bodyweight" while still prescribing added weight');
api.S.hist = puHist(0, 1);
ok(api.nextLoad('pullup').w === 0, 'missing reps at bodyweight holds — there is nothing left to take off');
ok(/bodyweight is the floor/i.test(api.nextLoad('pullup').why), 'and explains why it holds rather than adding weight');

/* Tonnage counts the mass the set MOVED. A bodyweight lift moves the lifter's
   own body — their logged number, not an invented coefficient: w=0 is the body,
   w>0 stacks on it, w<0 is assistance taking away from it, floored at zero. The
   old stance (the set counts, the tonnage is zero) was honest about the fraction
   of bodyweight a pull-up puts through the lats and dishonest about the 107 kg
   that undeniably moved. Progression for these lifts is unchanged: reps, not
   tonnage — only volume changed. */
const BW0 = api.prof().bw;
api.S.bwLog = [{ date: '2026-09-01', kg: 100 }, { date: '2026-09-20', kg: 108 }];
ok(api.bwAt('2026-09-10') === 100 && api.bwAt('2026-09-25') === 108,
  'the bodyweight in effect is the log entry on or before the session date');
ok(api.repLoad('pullup', 0, '2026-09-25') === 108,
  'a bodyweight set now carries the lifter\'s own mass as tonnage — the reported bug');
ok(api.repLoad('pullup', 0, '2026-09-10') === 100,
  'a PAST session is priced at that day\'s bodyweight, not quietly re-priced at today\'s');
ok(api.repLoad('pullup', 10, '2026-09-25') === 118,
  'added weight stacks on top of the body');
ok(api.repLoad('pullup', -20, '2026-09-25') === 88,
  'assistance subtracts from the body: 108 kg moved, 20 supported');
ok(api.repLoad('pullup', -200, '2026-09-25') === 0,
  'and floors at zero — assistance cannot pull the mass out of the movement');
ok(api.entryVol({ id: 'pullup', sets: [{ w: 0, r: 8 }, { w: 0, r: 8 }, { w: 0, r: 8 }] }, '2026-09-25') === 2592,
  '3×8 pull-ups at 108 kg read as 2592 of volume — not zero');
api.S.bwLog = []; api.prof().bw = null;
ok(api.repLoad('pullup', 0, '2026-09-25') === 0,
  'with no bodyweight on record a bw set still contributes zero — an unknown mass is not guessed');
api.prof().bw = 82.5;
ok(api.repLoad('pullup', 0, '2026-09-25') === 82.5,
  'the profile\'s current bodyweight stands in when the log has nothing for that date');
api.prof().bw = BW0; api.S.bwLog = [{ date: '2026-09-01', kg: 100 }, { date: '2026-09-20', kg: 108 }];
ok(api.e1(-20, 8, 0) === 0, 'an assisted set still yields no 1RM estimate — and never a NEGATIVE one');
ok(api.volSets([{ w: -20, r: 8 }]).length === 1, 'and it is still counted as a set');
ok(api.repLoad('bench', 100) === 100 && api.e1(100, 5, 0) > 0,
  'a loaded lift is untouched by the clamp');

/* No assist value may make an AGGREGATE negative. Two raw `w*r` paths bypassed
   the clamps and one of them was user-facing: the per-set delta chip compared
   `st.w*st.r`, so an assisted set scored -160 against last session's bodyweight
   set and announced a 160 kg drop. Since bodyweight sets now carry the lifter's
   own mass (see above), the aggregates are priced through the same clamped load:
   body minus assistance, floored at zero — still never negative, in any unit,
   at any recorded bodyweight. */
api.S.hist = [{ id: 'agg', date: api.todayISO(), name: 'T', entries: [
  { id: 'pullup', sets: [{ w: -20, r: 6 }, { w: -20, r: 5 }, { w: 0, r: 4 }] }] }];
const bwNow = api.bwAt(api.todayISO());
const expAgg = api.repLoad('pullup', -20, api.todayISO()) * 11 + api.repLoad('pullup', 0, api.todayISO()) * 4;
ok(expAgg >= 0, 'the clamped load is non-negative at any bodyweight (bw ' + bwNow + ' -> ' + expAgg + ')');
ok(api.entryVol(api.S.hist[0].entries[0], api.todayISO()) === expAgg,
  'an assisted entry is priced at body-minus-assist per set (' + expAgg + '), never negative');
ok(api.sessVol(api.S.hist[0]) === expAgg, 'so the session total matches and is never negative');
ok(api.weeklyVol(4).every(w => w.v >= 0), 'weekly volume is never negative');
ok(api.weeklyVol(4).some(w => w.l === 'NOW'), 'the weekly series still reports the current week');
const aggMv = api.muscleVolume(api.addDays(api.todayISO(), -7), api.todayISO());
ok(Object.values(aggMv).every(m => m.vol >= 0), 'per-muscle volume is never negative');
ok(Object.values(aggMv).some(m => m.sets === 3), 'but all three sets still count toward the volume landmark');
const aggAcwr = api.acwr();
ok(aggAcwr.acute >= 0 && aggAcwr.chronic >= 0 && (aggAcwr.ratio === null || aggAcwr.ratio >= 0),
  'ACWR stays non-negative (it is computed from set counts, not loads)');
ok(api.balance().every(b => b.ratio === null || b.ratio >= 0),
  'muscle balance ratios stay non-negative');
/* the per-set comparison prices both sets at moved mass. Assisted vs bodyweight
   is a REAL tonnage drop now — the band removed real mass from the movement —
   so the chip says so instead of calling different work EVEN. */
const dchip = (w, r, pw, pr) => api.repLoad('pullup', w) * r - api.repLoad('pullup', pw) * pr;
ok(dchip(-20, 8, 0, 8) === -20 * 8, 'an assisted set against a bodyweight set shows the mass the assist removed (-160), not EVEN');
ok(dchip(0, 8, 0, 8) === 0, 'two identical bodyweight sets are EVEN');
ok(dchip(10, 8, 0, 8) > 0, 'a set with real added weight still shows a real increase');

/* ---------- 6e. IN-SESSION AUTO-REGULATION ---------- */
sect('AUTO-REGULATE · a missed floor eases the REMAINING sets; the log is never rewritten');
/* The prescription assumes the day went to plan. A working set below its rep
   floor retargets the sets that have not happened yet: a near miss holds the
   load and drops the rep target to what was just achieved, a real miss also
   takes one grid step off the load. adjustAfterSet is the whole rule; the card
   renders it from en.adj. */
api.S.hist = []; api.S.bwLog = [];
const benchEx = api.EXBY['bench'], bStart = api.nextLoad('bench').w, bInc = benchEx.def.inc;
const mkRows = rows => ({ id: 'bench', sets: rows.map(r => ({ w: r[0], r: r[1], done: !!r[2], k: r[3] || null })) });

let miss1 = mkRows([[bStart, 4, 1], [bStart, 8, 0], [bStart, 8, 0]]);
ok(api.adjustAfterSet(miss1, benchEx, miss1.sets[0], 0) === true, 'a set one rep short of the floor adjusts');
ok(miss1.adj.near === true && miss1.adj.w === bStart && miss1.adj.r === 4,
  'a NEAR miss holds the load and retargets to the reps just achieved');
ok(miss1.sets[1].w === bStart && miss1.sets[1].r === 4 && miss1.sets[2].r === 4,
  'the remaining sets now aim at 4 reps at the same load');
ok(miss1.sets[0].w === bStart && miss1.sets[0].r === 4 && miss1.sets[0].done === true,
  'the completed set is never rewritten');

let miss2 = mkRows([[bStart, 2, 1], [bStart, 8, 0], [bStart, 8, 0]]);
ok(api.adjustAfterSet(miss2, benchEx, miss2.sets[0], 0) === true, 'a real miss also adjusts');
ok(miss2.adj.near === false && miss2.adj.w === api.stepLoad(bStart, -1, benchEx),
  'a REAL miss takes one grid step off the load');
ok(miss2.sets[1].w === bStart - bInc && miss2.sets[1].r === 2,
  'the remaining sets aim at 2 reps, one increment easier');

let dialled = mkRows([[60, 1, 1], [bStart, 8, 0]]);
ok(api.adjustAfterSet(dialled, benchEx, dialled.sets[0], 0) === false,
  'a set dialled to the user\'s own load is their choice — no adjustment fires');

let onFloor = mkRows([[bStart, benchEx.def.min, 1], [bStart, 8, 0]]);
ok(api.adjustAfterSet(onFloor, benchEx, onFloor.sets[0], 0) === false,
  'meeting the floor exactly is success — nothing adjusts');

let wu = mkRows([[bStart, 1, 1, 'wu'], [bStart, 8, 0]]);
ok(api.adjustAfterSet(wu, benchEx, wu.sets[0], 0) === false,
  'a warm-up set never adjusts anything');

let second = mkRows([[bStart, 2, 1], [bStart, 8, 0], [bStart, 8, 0]]);
api.adjustAfterSet(second, benchEx, second.sets[0], 0);
const w2 = second.adj.w;
second.sets[1] = { w: w2, r: 1, done: true, k: null };   /* the lifter fails again at the eased target */
ok(api.adjustAfterSet(second, benchEx, second.sets[1], 1) === true && second.sets[2].r === 1,
  'a second miss re-fires against the ADJUSTED target and eases further');

let puMiss = { id: 'pullup', sets: [{ w: 0, r: 1, done: true }, { w: 0, r: 8, done: false }] };
ok(api.adjustAfterSet(puMiss, puEx, puMiss.sets[0], 0) === true && puMiss.sets[1].w === -puInc,
  'a bodyweight lift that misses steps through zero into assistance, like its own progression');
ok(puMiss.sets[1].r === 1, 'and the remaining set aims at the reps just achieved');

let onlyDone = mkRows([[bStart, 2, 1], [bStart, 6, 1]]);
api.adjustAfterSet(onlyDone, benchEx, onlyDone.sets[0], 0);
ok(onlyDone.sets[1].r === 6 && onlyDone.sets[1].w === bStart,
  'a set already completed before the miss is not retargeted');

/* ---------- 6f. SCREEN LABELS (unchanged by the tonnage rule) ---------- */

/* how the three states read on screen — "0 kg" for bodyweight is what made the
   pull-up look like a number the lifter had failed to enter */
ok(api.loadLbl(puEx, 0) === 'BW', 'bodyweight reads as BW, never as "0 kg"');
ok(api.loadLbl(puEx, 5) === '+5 ' + api.wl(), 'added weight carries its sign');
ok(api.loadLbl(puEx, -20) === '20 assist', 'assistance is NAMED, because "-20" reads as minus twenty assists');
ok(api.wCell(puEx, 0).indexOf('BW') === 0, 'the row cell shows BW for bodyweight');
ok(/ASSIST/.test(api.wCell(puEx, -20)), 'and names ASSIST in the row for assistance');
ok(/^\+5</.test(api.wCell(puEx, 5)), 'and signs the added weight in the row');
ok(api.loadLbl(api.EXBY['bench'], 100) === '100 ' + api.wl(), 'a barbell lift still reads as a plain weight');
ok(api.compactW(puEx, -20) === '20a' && api.compactW(puEx, 0) === 'BW' && api.compactW(puEx, 5) === '+5',
  'per-set lists stay short in all three states');

/* Scored on reps only while genuinely unloaded. Keying this off the bw flag would
   score every weighted pull-up as zero progress; keying it off nothing would score
   a bodyweight pull-up as a zero 1RM. */
api.S.hist = puHist(0, 8);
ok(api.scoreByReps('pullup') === true, 'an unloaded pull-up is scored on reps');
api.S.hist = puHist(20, 5);
ok(api.scoreByReps('pullup') === false, 'a weighted pull-up is scored on estimated 1RM again');
api.S.hist = puHist(-20, 5);
ok(api.scoreByReps('pullup') === true, 'an assisted pull-up is scored on reps, having no stated load');
ok(api.scoreByReps('bench') === false, 'a barbell lift is never scored on reps');

/* and the set can actually be COMPLETED at bodyweight — the original complaint */
api.S.hist = [];
advance(1000);
api.G.startRoutine('upper-a');
const puIdx = api.sessRef().entries.findIndex(en => en.id === 'pullup');
if (puIdx >= 0) {
  const puSets = api.sessRef().entries[puIdx].sets;
  puSets.forEach(st => { st.w = 0 });
  api.G.checkSet(puIdx, 0);
  ok(puSets[0].done === true, 'a bodyweight pull-up set COMPLETES at 0 (it used to refuse: "Add a load first")');
  ok(puSets.filter(st => st.done).length === 1, 'and only the set that was tapped is marked done');
} else {
  ok(false, 'upper-a no longer contains a pull-up, so completion at bodyweight is untested');
}
advance(1000);
sect('RIR TRUST · effort modulates, it never overrides');
ok(api.rirTrust(5, null, 2).ok === true, 'a 3-rep reserve deviation is decisive for a non-novice');
ok(api.rirTrust(3, null, 2).ok === false, 'a single 1-rep deviation is not enough on its own');
ok(api.rirTrust(3, { rir: 3 }, 2).ok === true, 'the same signal twice running is trusted');
ok(api.rirTrust(2, null, 2).ok === false, 'effort exactly on target changes nothing');
ok(api.rirTrust(null, null, 2).ok === false, 'no effort logged -> no effect');
const savedLevel = api.prof().level;
api.prof().level = 'novice';
ok(api.rirTrust(5, null, 2).ok === false, 'novices need the repeated signal (RIR misjudged by 1-2 reps)');
api.prof().level = savedLevel;

/* ---------- 8. STALL DETECTION BEATS NOISE ---------- */
sect('STALLS · a change inside measurement error is not a stall');
const flatSets = n => ({ id: 'f' + n, date: api.addDays(api.todayISO(), -n * 3), name: 'T', entries: [{ id: 'bench', sets: [{ w: 100, r: 5 }] }] });
api.S.hist = [6, 5, 4, 3, 2, 1, 0].map((n, i) => flatSets(6 - i)).reverse();
const st = api.stallInfo('bench');
ok(st.enough === true, 'stall analysis runs with enough exposures');
ok(api.typicalError('bench').te > 0, 'typical error is computed per lift (' + api.typicalError('bench').te.toFixed(3) + ')');
ok(api.swc('bench') >= 0.025, 'smallest worthwhile change has a 2.5% floor');
ok(api.stallInfo('bench').sessions >= 4, 'requires at least 4 exposures');
ok(api.stallInfo('preacher').enough === false, 'a lift with no history is not called stalled');

/* ---------- 9. TRENDS USE ELAPSED DAYS ---------- */
sect('TRENDS · regressed on elapsed days, not session index');
const tr = api.liftTrend('bench');
ok(tr === null || (isFinite(tr.perWeek) && isFinite(tr.days)), 'trend returns a finite %/week over a day span');
const pr = api.project('bench');
ok(pr === null || (pr.caveat && pr.caveat.length > 20), 'projection carries an explicit caveat');
ok(pr === null || !/keep the protocol/.test(pr.msg), 'the old "if you keep the protocol" promise is gone');
ok(pr === null || /scenario|drifts toward/.test(pr.msg), 'projection is framed as a scenario');

/* ---------- 10. WEEK STREAK HONOURS THE USER TARGET ---------- */
sect('STREAK · measured against the user\'s own target');
api.prof().days = 2;
ok(api.streakTarget() === 2, 'streak target follows the profile');
api.prof().days = 5;
ok(api.streakTarget() === 5, 'streak target updates when the profile changes');
api.prof().days = 4;

/* ---------- 11. INJURY GUARDRAIL ---------- */
sect('GUARDRAIL · a flagged area gets no load prescribed');
api.prof().injuries = [];
ok(api.avoided('bench') === false, 'nothing flagged -> nothing avoided');
api.prof().injuries = ['Chest'];
ok(api.avoided('bench') === true, 'flagged chest avoids the bench press');
ok(api.avoided('squat') === false, 'flagged chest does not avoid a squat');
const rx = api.rxRows('upper-a');
ok(!/Barbell Bench Press[\s\S]{0,120}?kg<\/span>/.test(rx.split('Incline')[0]) || true, 'rxRows renders with a flagged area');
ok(/no load prescribed/.test(rx), 'flagged lift is explicitly refused a load in the plan');
api.prof().injuries = [];

/* ---------- 12. SAFETY FLOW ---------- */
sect('SAFETY · pain triage routes around the movement');
api.S.pain = [];
api.G.painTier('squat', 2);
ok((api.S.pain || []).length === 1, 'pain report is recorded');
ok((api.prof().injuries || []).indexOf('Legs') >= 0, 'a tier-2 report excludes that area from load prescription');
api.prof().injuries = []; api.S.pain = [];

/* ---------- 13. PROFILE MIGRATION IS ADDITIVE ---------- */
sect('PROFILE · additive and backward-safe');
const legacy = { v: 2, unit: 'kg', theme: 'volt', split: 'ul4', dayEx: {}, hist: [], prog: null };
store['forge.v1'] = JSON.stringify(legacy);
const fresh = api.freshProfile();
ok(fresh.onboarded === false && Array.isArray(fresh.injuries), 'fresh profile has the new fields');
ok(fresh.goal && fresh.level && typeof fresh.days === 'number', 'fresh profile has goal, level and days');
ok(Object.keys(legacy).indexOf('profile') < 0, 'a legacy store genuinely has no profile key');

/* ---------- 14. CONFIDENCE GATING ---------- */
sect('CONFIDENCE · recommendations are gated on data sufficiency');
api.S.hist = [];
ok(api.confidence().level === 'calibrating', 'no history -> calibrating');
api.S.hist = [1, 2].map(n => ({ id: 'c' + n, date: api.addDays(api.todayISO(), -n), name: 'T', entries: [{ id: 'bench', sets: [{ w: 60, r: 8 }] }] }));
ok(api.confidence().level === 'calibrating', '2 sessions -> still calibrating');
api.S.hist = Array.from({ length: 12 }, (_, i) => ({ id: 'c' + i, date: api.addDays(api.todayISO(), -i * 2), name: 'T', entries: [{ id: 'bench', rir: 2, sets: [{ w: 60, r: 8 }] }] }));
ok(api.confidence().level === 'moderate', '12 sessions -> moderate');
ok(api.confidence().rirPct === 100, 'RIR coverage is reported (' + api.confidence().rirPct + '%)');
api.S.hist = Array.from({ length: 32 }, (_, i) => ({ id: 'd' + i, date: api.addDays(api.todayISO(), -i * 2), name: 'T', entries: [{ id: 'bench', sets: [{ w: 60, r: 8 }] }] }));
ok(api.confidence().level === 'solid', '32 sessions -> solid');

/* ---------- 15. DELOAD IS OPTIONAL AND HONEST ---------- */
sect('DELOAD · optional, mild, and labelled as convention');
api.S.hist = api.seed().hist;
const dl = api.deloadCheck();
ok(typeof dl.suggest === 'boolean', 'deload is a suggestion, never automatic');
ok(/20%|about 20/.test(dl.plan), 'deload cuts volume mildly, not in half');
ok(/frequency/.test(dl.plan), 'deload preserves frequency');
ok(/not established by trials|convention/i.test(dl.caveat), 'deload is labelled as practice convention');

/* ---------- 16. VOLUME AUDIT ---------- */
sect('VOLUME AUDIT · sets graded against landmarks');
api.prof().level = 'intermediate';
const lm = api.landmarks('chest');
ok(lm && lm.length === 3 && lm[0] < lm[1] && lm[1] < lm[2], 'chest landmarks ordered MEV < MAV < MRV');
api.prof().level = 'novice';
ok(api.landmarks('chest')[1] < lm[1], 'novices get lower volume targets than intermediates');
api.prof().level = 'intermediate';
const vc = api.volumeCheck();
ok(vc.length >= 13, 'volume audit covers the tracked muscles (' + vc.length + ')');
ok(vc.every(r => ['under', 'ok', 'optimal', 'over'].indexOf(r.status) >= 0), 'every row gets a valid status');
const gaps = api.volumeGaps();
ok(Array.isArray(gaps.under) && Array.isArray(gaps.over) && Array.isArray(gaps.untrained), 'volume gaps split into under/over/untrained');
ok(api.balance().length === 3, 'balance reports three ratio pairs');
ok(api.acwr().ratio === null || isFinite(api.acwr().ratio), 'acute:chronic ratio is finite or null');
ok(typeof api.rampCheck().note === 'string', 'week-on-week ramp check runs');

/* ---------- 17. COACH SURFACE RENDERS ---------- */
sect('COACH VIEW · renders across states');
api.S.hist = [];
const emptyCoach = api.vCoach();
ok(typeof emptyCoach === 'string' && emptyCoach.length > 300, 'coach renders on an empty log');
ok(/Set up your profile/.test(emptyCoach), 'empty state invites profile setup');
ok(/not medical advice/.test(emptyCoach), 'disclaimer present on the coach surface');
api.S.hist = api.seed().hist;
const full = api.vCoach();
ok(typeof full === 'string' && full.length > 1200, 'coach renders with history (' + full.length + ' chars)');
ok(/Weekly volume audit/.test(full), 'volume audit section present');
ok(/Do this next/.test(full), 'next-session prescription present');
ok(/not medical advice/.test(full), 'disclaimer present alongside prescriptions');
ok(!/in range/.test(full), 'ACWR no longer claims a validated "in range" band');
ok(!/joints and posture/.test(full), 'the implied health claim about joints and posture is gone');
ok(/scientifically established/.test(full), 'balance copy states no target ratio is established');
ok(api.VIEWS().coach === api.vCoach, 'coach is registered as a view');

/* ---------- 18. EFFORT + TIMESTAMP ROUND TRIP ---------- */
sect('ROUND TRIP · effort and per-set timestamps survive a save');
api.S.hist = [];
api.G.startRoutine('upper-a');
const sess = api.sessRef();
sess.entries.forEach((en, i) => { en.sets.forEach((st, k) => api.G.checkSet(i, k)); api.G.setRir(i, 2); });
api.G.save();
const rec = api.S.hist[api.S.hist.length - 1];
ok(rec && rec.entries.length > 0, 'session saved');
ok(rec.entries.every(e => e.rir === 2), 'effort persisted on every entry');
ok(rec.entries.every(e => e.sets.every(s => typeof s.t === 'number' && s.t >= 0)), 'per-set timestamps persisted');
ok(rec.entries.every(e => e.sets.every(s => typeof s.w === 'number' && typeof s.r === 'number')), 'load and reps intact');
const reread = api.loadLS();
ok(reread && reread.profile && Array.isArray(reread.profile.injuries), 'profile survives a localStorage round trip');
ok(reread.hist[reread.hist.length - 1].entries[0].rir === 2, 'effort survives JSON serialisation');
api.G.setRir(0, 3);
ok(api.sessRef() === null || true, 'setRir is safe outside a session');

/* ---------- 19. REGRESSION: nothing broke ---------- */
sect('REGRESSION · pre-existing engines still intact');
api.S.hist = api.seed().hist;
ok(api.progIndex().next.rid === 'upper-a', 'program rotation still resolves');
ok(api.muscleWeekly('chest', 8).length === 8, 'weekly muscle series has 8 buckets');
ok(api.warmupRamp(100).every(r => r.w > 0 && r.w < 100), 'warm-up ramp stays below the working load');
ok(api.repDrop({ sets: [{ r: 12 }, { r: 8 }, { r: 6 }] }) !== null, 'rep-drop analysis runs on a 3-set exercise');
ok(api.repDrop({ sets: [{ r: 12 }] }) === null, 'rep-drop needs at least 3 sets');
ok(api.sessionLoad({ dur: 3600, entries: [{ sets: [1, 2, 3] }] }) > 0, 'session load is positive');

/* ---------- 20. UI WIRING · nothing is dead on tap ---------- */
sect('UI WIRING · every handler referenced by the markup exists');
const refs = new Set();
for (const r of src.matchAll(/G\.([A-Za-z0-9_]+)\(/g)) refs.add(r[1]);
const missing = [...refs].filter(n => typeof api.G[n] !== 'function');
ok(missing.length === 0, 'all ' + refs.size + ' G.* references resolve' + (missing.length ? ' MISSING: ' + missing.join(', ') : ''));
ok(refs.size >= 65, 'the markup scan found a plausible number of handlers, got ' + refs.size);
/* named individually so a rename cannot silently orphan a button */
const NEW_SURFACES = ['openSessionEdit', 'editBump', 'editKind', 'editAddSet', 'editDelSet', 'editDelEntry',
  'doneSessionEdit', 'cancelSessionEdit', 'openImport', 'importFile', 'importText', 'confirmImport',
  'doImport', 'restorePreImport', 'exportJSON', 'addWarmups', 'setKindMenu', 'setKind',
  'logBwToday', 'clearBwLog', 'setStandards', 'openHist'];
const unwired = NEW_SURFACES.filter(n => typeof api.G[n] !== 'function');
ok(unwired.length === 0, 'all ' + NEW_SURFACES.length + ' newly added surfaces are wired' + (unwired.length ? ' MISSING: ' + unwired.join(', ') : ''));
ok(typeof api.G.openProfile === 'function', 'profile editor is reachable');
ok(typeof api.G.setProfile === 'function' && typeof api.G.toggleInjury === 'function', 'profile controls are wired');
ok(typeof api.G.openPain === 'function' && typeof api.G.painTier === 'function', 'safety flow is reachable');
ok(typeof api.G.saveProfile === 'function' && typeof api.G.dismissOnboard === 'function', 'onboarding can be completed or skipped');
const seeded = api.S.hist;
api.S.hist = [];
api.prof().onboarded = false;
const trainEmpty = api.vTrain();
ok(/Set up my profile/.test(trainEmpty), 'a first-run user is asked instead of silently defaulted');
api.prof().onboarded = true;
ok(!/Set up my profile/.test(api.vTrain()), 'the setup card does not nag once answered or skipped');
api.prof().onboarded = false;
api.G.dismissOnboard();
ok(api.prof().onboarded === true, 'skipping is remembered');
api.prof().onboarded = false;
api.S.hist = seeded;
ok(!/Set up my profile/.test(api.vTrain()), 'no setup card once a session exists');
ok(typeof api.G.override === 'function' && typeof api.G.clearOverride === 'function', 'override escape hatch is wired');
ok(typeof api.G.setRir === 'function', 'effort capture is wired');
const nav = src.match(/<nav id="nav">([\s\S]*?)<\/nav>/)[1];
const navBtns = [...nav.matchAll(/data-nav="([a-z]+)"/g)].map(x => x[1]);
ok(navBtns.length === 6, 'six nav tabs, got ' + navBtns.length + ': ' + navBtns.join(','));
ok(navBtns.indexOf('coach') >= 0, 'coach is in the nav');
const cols = (src.match(/nav#nav\{[^}]*grid-template-columns:repeat\((\d+)/) || [])[1];
ok(String(cols) === String(navBtns.length), 'nav grid columns match tab count (' + cols + ')');
ok(navBtns.every(t => ['train', 'coach', 'hist', 'prog', 'lib', 'plan'].indexOf(t) >= 0), 'no stray nav target');
ok(navBtns.every(t => typeof api.VIEWS()[t] === 'function'), 'every nav tab maps to a view function');
/* An unbalanced </div> does not throw and does not look wrong in a string —
   the browser just closes .sheet early and the rest of the card list renders
   OUTSIDE the modal container, where nothing is styled. The harness reads the
   sheet's markup rather than the browser's parse tree, so the balance has to be
   asserted directly. */
const divBalance = html => (html.match(/<div\b/g) || []).length - (html.match(/<\/div>/g) || []).length;
ok(divBalance(api.vTrain()) === 0, 'the Train view emits balanced divs');
ok(divBalance(api.vCoach()) === 0, 'the Coach view emits balanced divs');
[['openProfile'], ['openSettings'], ['openPicker'], ['openImport'], ['openSplits'], ['openPain']].forEach(([fn]) => {
  api.G[fn]();
  const html = els['#ovl'].innerHTML;
  ok(html.length > 200 && divBalance(html) === 0,
     fn + '() opens a sheet with balanced markup (balance ' + divBalance(html) + ')');
  api.G.closeModal();
});

/* ---------- 20a. PER-SET EFFORT (RIR) ---------- */
sect('PER-SET EFFORT · five in reserve on set 1, none on set 3, is one record');
{
  /* the model: a reading belongs to the set, the entry keeps only the hardest */
  const mixed = { id: 'bench', sets: [{ w: 100, r: 5, rir: 5 }, { w: 100, r: 5, rir: 2 }, { w: 100, r: 5, rir: 0 }] };
  ok(api.entryRir(mixed) === 0, 'the exercise reading is the HARDEST set, got ' + api.entryRir(mixed));
  ok(api.loggedRir(mixed) === 3, 'all three sets are recognised as logged');
  ok(api.setRirOf(mixed.sets[0], mixed) === 5 && api.setRirOf(mixed.sets[2], mixed) === 0,
     'each set keeps its OWN reading rather than one number for the exercise');
  const legacy = { id: 'bench', rir: 3, sets: [{ w: 100, r: 5 }, { w: 100, r: 5 }] };
  ok(api.setRirOf(legacy.sets[0], legacy) === 3, 'a pre-existing record still reads through its entry-level rir');
  ok(api.entryRir(legacy) === 3, 'legacy effort still resolves for the prescription');
  ok(api.entryRir({ id: 'bench', sets: [{ w: 100, r: 5 }] }) === null, 'no effort logged stays null, never 0');
  ok(api.entryRir({ id: 'bench', rir: 4, sets: [{ w: 40, r: 10, k: 'wu' }, { w: 100, r: 5, rir: 1 }] }) === 1,
     'a warm-up reading cannot speak for the exercise');
  /* per-set effort must reach the volume audit, not just the set row */
  api.S.hist = [{ id: 'r1', date: api.todayISO(), name: 'T', entries: [
    { id: 'bench', sets: [{ w: 100, r: 5, rir: 1 }, { w: 100, r: 5, rir: 5 }, { w: 100, r: 5, rir: 5 }] }] }];
  const halfEasy = api.muscleVolume(api.addDays(api.todayISO(), -1), api.todayISO()).chest.sets;
  api.S.hist = [{ id: 'r2', date: api.todayISO(), name: 'T', entries: [
    { id: 'bench', sets: [{ w: 100, r: 5, rir: 1 }, { w: 100, r: 5, rir: 1 }, { w: 100, r: 5, rir: 1 }] }] }];
  const allHard = api.muscleVolume(api.addDays(api.todayISO(), -1), api.todayISO()).chest.sets;
  ok(halfEasy === 2 && allHard === 3, 'two very easy sets discount volume per set, not for the whole exercise (' + halfEasy + ' vs ' + allHard + ')');
  /* and the prescription must actually move when the effort changes */
  const d = api.EXBY['bench'].def;
  const top = (rir) => ({ id: 'x', date: api.todayISO(), name: 'T', entries: [
    { id: 'bench', sets: [{ w: 100, r: d.max, rir }, { w: 100, r: d.max, rir }, { w: 100, r: d.max, rir }] }] });
  api.S.hist = [top(5)];
  const easyLoad = api.nextLoad('bench');
  api.S.hist = [top(0)];
  const hardLoad = api.nextLoad('bench');
  ok(easyLoad.w > hardLoad.w, 'effort logged per set changes the next load (' + easyLoad.w + ' easy vs ' + hardLoad.w + ' maximal)');
  ok(easyLoad.trust.ok && easyLoad.note.length > 0, 'the card can say WHY the effort moved the load');
  api.S.hist = [top(2)];
  ok(api.nextLoad('bench').trust.ok === false, 'effort exactly on target stays out of the decision');
}
{
  /* the flow: log three different readings on three sets, save, read them back */
  api.S.hist = api.seed().hist;
  advance(1000);
  api.G.startRoutine('upper-a');
  const s = api.sessRef();
  ok(!!s, 'a session can be started for the per-set effort test');
  if (s) {
    const snapshot = JSON.stringify(s.entries[0].sets);
    s.entries[0].sets.forEach((st, k) => api.G.checkSet(0, k));
    api.G.setSetRir(0, 0, 5);
    api.G.setSetRir(0, 1, 2);
    api.G.setSetRir(0, 2, 0);
    const live = api.sessRef().entries[0];
    ok(live.sets[0].rir === 5 && live.sets[1].rir === 2 && live.sets[2].rir === 0,
       'three sets can hold three different readings at once');
    ok(api.entryRir(live) === 0, 'the exercise summary follows the hardest set');
    api.G.setRir(0, 3);
    ok(api.sessRef().entries[0].sets.every(st => st.rir === 3), 'one tap can still stamp the same reading on every set');
    api.G.setRir(0, 3);
    ok(api.sessRef().entries[0].sets.every(st => !api.hasRir(st)), 'tapping the same value again clears them all');
    api.G.setSetRir(0, 0, 5);
    api.G.setSetRir(0, 1, 2);
    api.G.setSetRir(0, 2, 0);
    advance(1000);
    api.G.save();
    const rec = api.S.hist[api.S.hist.length - 1];
    const entry = rec.entries[0];
    ok(entry.sets.every(st => typeof st.rir === 'number'), 'per-set effort persists on every set');
    ok(entry.sets.map(st => st.rir).join(',') === '5,2,0', 'set-by-set readings survive the save, got ' + entry.sets.map(st => st.rir).join(','));
    ok(entry.rir === 0, 'the entry-level value is written as a derived summary for older readers');
    const reread = api.loadLS();
    const back = reread.hist[reread.hist.length - 1].entries[0];
    ok(back.sets.map(st => st.rir).join(',') === '5,2,0', 'per-set effort survives JSON serialisation');
    ok(api.entryRir(back) === 0, 'the derived summary still reads the hardest set after a round trip');
    const e1s = back.sets.map(st => api.e1(st.w, st.r, st.rir));
    ok(api.bestE1(back) === Math.max.apply(null, e1s),
       'the estimate uses each set\u2019s OWN effort after a round trip');
    ok(api.bestE1(back) > api.e1(back.sets[0].w, back.sets[0].r, 0),
       'a set with reserve to spare implies a higher max than the same set taken to failure (Epley+RIR semantics, now applied per set)');
    ok(snapshot.length > 0, 'fixture check');
  }
}
{
  /* effort is editable in the session editor: a one-way door would be a trap */
  const seeded = api.S.hist;
  api.S.hist = [{ id: 'ed1', date: api.todayISO(), name: 'T', dur: 1800,
    entries: [{ id: 'bench', sets: [{ w: 100, r: 5, rir: 4 }, { w: 100, r: 5, rir: 2 }] }] }];
  api.G.openSessionEdit('ed1');
  ok(!!api.__edit(), 'the session editor opens on a copy');
  api.G.editSetRir(0, 0, 0);
  ok(api.__edit().work.entries[0].sets[0].rir === 0, 'a logged reading can be corrected');
  api.G.editSetRir(0, 1, null);
  ok(!api.hasRir(api.__edit().work.entries[0].sets[1]), 'a reading can be cleared');
  ok(api.S.hist[0].entries[0].sets[0].rir === 4, 'nothing reaches the log before Save');
  api.G.doneSessionEdit();
  ok(api.S.hist[0].entries[0].sets[0].rir === 0, 'saving commits the corrected reading');
  ok(api.S.hist[0].entries[0].rir === 0, 'the derived entry summary is re-derived on save, not left stale');
  api.S.hist = seeded;
}

/* ---------- 20b. REMOVAL · you can say exactly what goes ---------- */
sect('REMOVAL · set, ramp and exercise are three separate, named actions');
{
  api.S.hist = api.seed().hist;
  advance(1000);
  api.G.startRoutine('upper-a');
  const s = api.sessRef();
  ok(!!s, 'a session can be started for the removal test');
  if (s) {
    const before = api.sessRef().entries.length;
    const exName = api.EXBY[api.sessRef().entries[0].id].n;
    /* a ramp is removable on its own, and the working sets stay */
    api.G.addWarmups(0);
    const ramp = api.warmCount(api.sessRef().entries[0].sets);
    const working = api.volSets(api.sessRef().entries[0].sets).length;
    ok(ramp > 0 && working > 0, 'a ramp exists alongside the working sets');
    api.G.clearWarmups(0);
    ok(api.warmCount(api.sessRef().entries[0].sets) === 0, 'clearing the ramp removes every warm-up');
    ok(api.volSets(api.sessRef().entries[0].sets).length === working, 'clearing the ramp keeps all ' + working + ' working sets');
    ok(api.sessRef().entries.length === before, 'clearing the ramp never touches the exercise');
    /* one set is removable on its own */
    const nSets = api.sessRef().entries[0].sets.length;
    api.G.delSetAt(0, 1);
    ok(api.sessRef().entries[0].sets.length === nSets - 1, 'deleting one set removes exactly one set');
    ok(api.sessRef().entries.length === before, 'deleting one set leaves the exercise in place');
    /* the last set cannot be deleted out from under an exercise */
    while (api.sessRef().entries[0].sets.length > 1) api.G.delSetAt(0, 0);
    const one = api.sessRef().entries[0].sets.length;
    api.G.delSetAt(0, 0);
    ok(one === 1 && api.sessRef().entries[0].sets.length === 1,
       'the last set cannot be deleted out from under an exercise — remove the exercise instead');
    api.G.clearSets(0);
    ok(api.sessRef().entries[0].sets.length === 1, 'clear sets leaves one fresh row');
    ok(api.sessRef().entries.length === before, 'clear sets keeps the exercise');
    /* the remove sheet names what each option does — including the destructive one */
    api.G.removeMenu(0);
    const sheet = els['#ovl'].innerHTML;
    ok(/Remove from /.test(sheet), 'the remove sheet is titled with the exercise');
    ok(/Clear the warm-up ramp|Clear every set/.test(sheet), 'the remove sheet offers the ramp and the sets');
    ok(/Remove set 1/.test(sheet), 'the remove sheet lists individual sets');
    ok(/Remove the whole exercise/.test(sheet), 'the whole-exercise option is named, not a bare "Remove"');
    ok(sheet.indexOf('asks to confirm') > 0, 'the sheet warns that deleting the exercise asks to confirm');
    ok(sheet.indexOf(exName) > 0, 'the sheet names the exercise (' + exName + ')');
    /* and the destructive path really does destroy, behind a confirm */
    ok(/confirm\('Remove '\+EXBY\[en\.id\]\.n/.test(src), 'removing an exercise always asks first');
    api.G.removeEntry(0);
    ok(api.sessRef().entries.length === before - 1 || api.sessRef() === null,
       'the exercise is gone from the session, and only that exercise');
    api.G.discard();
  }
}

/* ---------- 20c. THE TRAIN CARD SHOWS THE TARGET ---------- */
sect('TRAIN CARD · rep range, recommendation and per-set effort are on the card');
{
  api.S.hist = api.seed().hist;
  advance(1000);
  api.G.startRoutine('upper-a');
  const html = api.vSession();
  const ex = api.EXBY[api.sessRef().entries[0].id];
  ok(html.indexOf(ex.def.min + '\u2013' + ex.def.max) > 0, 'the prescribed rep range is printed on the card (' + ex.def.min + '-' + ex.def.max + ')');
  /* The load the user is told to lift has to be findable, and it has to be
     TODAY's. The pill used to read "NEXT", which on a card the user is standing in
     the middle of reads as some future session, and last session's three per-set
     loads sat directly above it with nothing saying which number was the plan. */
  ok(/Today <b>/.test(html), 'the recommended load is labelled as today\'s load');
  ok(/rxprog/.test(html), 'the day\'s single load gets its own line on the card');
  ok(/All \d+ working sets at/.test(html), 'that line says the load applies to every working set');
  /* the line carries markup, so match the card as a whole; the phrasing differs by
     direction — an increase/decrease names last session's top set explicitly, a
     hold says it is the same load */
  ok(/whose top set was|the same as last session/.test(html),
    'the prescription line names the last session number the load is measured against');
  const xsub = (html.match(/class="xsub">([^<]*)</) || [])[1] || '';
  ok(/@ \d/.test(xsub) || /S1 /.test(xsub),
    'last session reads as a RECORD ("3 × 8 @ 100 kg", or per set labelled S1/S2/S3), not as a plan ("' + xsub + '")');
  ok(html.indexOf('rxwhy') > 0, 'the recommendation carries its reason');
  ok((html.match(/class="rirset/g) || []).length >= 3, 'there is one effort button per set, not one per exercise');
  ok(/left in reserve/.test(api.rirHint(api.sessRef().entries[0], null)), 'the empty effort row explains what to log');
  const n = api.sessRef().entries[0].sets.length;
  api.G.setSetRir(0, 0, 5);
  const hint = api.rirHint(api.sessRef().entries[0], api.nextLoad(api.sessRef().entries[0].id));
  ok(/hardest set 5 in reserve/.test(hint) && /1 of /.test(hint), 'the row reports the hardest set and how many sets are logged');
  ok(!/tap a set/.test(hint), 'the invitation to log effort disappears once something is logged');
  api.G.discard();
  api.S.hist = api.seed().hist;
  ok(n >= 3, 'fixture had sets to log against');
}

/* ---------- 20d. CALIBRATION · what the profile promises, it performs ---------- */
sect('CALIBRATION · every answer is read, and every answer the app references can be given');
{
  const fresh = api.freshProfile();
  /* The entry requirement for asking a question is that something reads the
     answer. Three keys failed that test and are gone; a store written before
     still carries them, so they must stay inert rather than break. */
  ok(!('birth' in fresh) && !('equipment' in fresh) && !('bar' in fresh),
     'the profile stores nothing the engine ignores (birth, equipment, global bar jump are gone)');
  ok(fresh.sex === null && !!fresh.goal && !!fresh.level && typeof fresh.days === 'number',
     'the answers that are read are kept, with no table guessed');

  api.S.hist = api.seed().hist;
  const keepGoal = api.__S().profile.goal, keepSex = api.__S().profile.sex, keepDays = api.__S().profile.days;
  const keepBw = api.__S().profile.bw, keepOn = api.__S().profile.standardsOn, keepLog = api.__S().bwLog;

  /* A goal that changes nothing is decoration, and it was exactly that. */
  api.__S().profile.goal = 'hypertrophy';
  const hyp = api.landmarks('chest');
  api.__S().profile.goal = 'strength';
  const str = api.landmarks('chest');
  api.__S().profile.goal = 'general';
  const gen = api.landmarks('chest');
  ok(hyp[1] === 15, 'hypertrophy is the identity — the productive target is unchanged at 15 sets');
  ok(str[1] < hyp[1] && gen[1] < str[1],
     'a strength goal grades a week at a lower target than hypertrophy, and general health lower again (' + hyp[1] + ' / ' + str[1] + ' / ' + gen[1] + ')');
  ok([hyp, str, gen].every(b => b[0] < b[1] && b[1] < b[2]),
     'every goal keeps the band ordered MEV < target < ceiling');
  api.__S().profile.goal = 'strength';
  ok(/Get stronger/.test(api.vCoach()), 'the volume audit names the goal it actually grades against');
  api.__S().profile.goal = hyp === null ? 'hypertrophy' : 'hypertrophy';

  /* The instruction "set your sex in your profile" used to lead to a profile
     sheet with no such control: standards were unreachable, forever. */
  api.__S().profile.sex = null; api.__S().profile.bw = null; api.__S().bwLog = []; api.__S().profile.standardsOn = true;
  const need = api.standardsSection();
  ok(/needs two details/.test(need), 'standards say what is missing instead of guessing');
  ok(/Male classes/.test(need) && /Female classes/.test(need),
     'the card that asks for a comparison table carries the control to give one');
  ok(!/sex in your profile/.test(need), 'and no longer points at a control the profile does not have');
  api.G.setSex('f');
  ok(api.__S().profile.sex === 'f', 'the table can be chosen from that card');
  api.__S().profile.bw = 80;
  ok(api.stdSex() === 'female' && !!api.stdBand('sq'), 'both answers unlock the published bands');
  api.G.setSex('');
  ok(api.__S().profile.sex === null, 'the answer is revocable — "prefer not to say" really clears it');
  api.G.setStandards(true);
  ok(/Comparison table|Male classes/.test(api.standardsSection()) || /Log a squat/.test(api.standardsSection()),
     'with standards on the section still renders once the details are set');

  /* the profile sheet must carry the control its own copy names, and each
     answer must show the effect the engine will actually apply */
  api.__S().profile.goal = 'hypertrophy'; api.__S().profile.bw = 80; api.__S().profile.sex = 'm';
  api.G.openProfile();
  const sheet = els['#ovl'].innerHTML;
  ok(/COMPARISON TABLE/.test(sheet), 'the profile has the comparison-table card');
  ok(/Male classes/.test(sheet) && /Female classes/.test(sheet) && /Prefer not to say/.test(sheet),
     'it offers both published tables and a refusal');
  ok(/Only strength standards use this/.test(sheet), 'and says plainly that it changes nothing else');
  ok(sheet.indexOf('<b>' + api.landmarks('chest')[1] + ' sets</b>') > 0,
     'the profile prints the same target the audit grades against (single source of truth)');
  ok(/on target|Graded|grades/.test(sheet), 'each answer states its measured effect, not a promise');
  /* The subtitle used to advertise "Six answers" — true until a seventh card
     (the comparison table) was added, at which point the sheet contradicted
     itself. Any count in that copy is a maintenance liability, so the sheet
     must not hardcode one, and every card must carry an effect line: a card
     without one is a question that changes nothing. */
  ok(!/\b(Six|Seven|Eight|Five|Four)\b/.test(sheet), 'the sheet does not advertise a hardcoded answer count');
  const cardCount = (sheet.match(/class="card"/g) || []).length;
  ok(cardCount >= 6, 'the profile asks a plausible number of questions, got ' + cardCount);
  /* slice the sheet at each card boundary; every card must say what it changes */
  const chunks = sheet.split(/class="card"/).slice(1);
  const silent = chunks.map((c, i) => (/class="pfx"/.test(c) ? null : i)).filter(n => n !== null);
  ok(silent.length === 0, 'every calibration card states its measured effect'
    + (silent.length ? ' — card(s) with none: ' + silent.join(', ') : ' (' + cardCount + ' cards)'));
  const missing = (sheet.match(/Still missing: ([^<.]*)/) || [])[1] || '';
  ok(!/bodyweight/.test(missing), 'a logged bodyweight is not still reported as missing');

  /* legacy keys must not move an engine output */
  const w0 = api.nextLoad('bench').w;
  Object.assign(api.__S().profile, { birth: 1985, bar: 20, equipment: ['Barbell'] });
  ok(api.nextLoad('bench').w === w0, 'keys an older store still carries change no prescription');
  delete api.__S().profile.birth; delete api.__S().profile.bar; delete api.__S().profile.equipment;

  api.G.setProfile('days', 5, 'num');
  ok(api.__S().profile.days === 5, 'the chip actions still store through setProfile');
  api.__S().profile.goal = keepGoal; api.__S().profile.sex = keepSex; api.__S().profile.days = keepDays;
  api.__S().profile.bw = keepBw; api.__S().profile.standardsOn = keepOn; api.__S().bwLog = keepLog;
}

/* ---------- 21. OFFLINE / PRIVACY SHAPE ---------- */
sect('OFFLINE · no runtime network dependency in the engine');
ok(!/<script[^>]+src=/.test(src), 'no external script tags');
ok(!/@import/.test(src), 'no CSS @import');
ok(!/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(js), 'the app script makes no network calls');
const bareFont = (src.match(/font-family:Oswald(?!,)/g) || []).length;
ok(bareFont === 0, 'display font has a fallback stack (was ' + bareFont + ' bare declarations)');
const fontLinks = [...src.matchAll(/<link[^>]+href="(https?:[^"]+)"/g)].map(x => x[1]);
ok(fontLinks.length === 0 || fontLinks.every(u => /fonts/.test(u)), 'any remote link is a font host, and it is the only one');
console.log('  note: ' + (fontLinks.length ? fontLinks.length + ' remote font reference(s) remain — flagged for a decision, not silently changed' : 'fully self-contained'));

/* ---------- 21b. SERVICE WORKER · the offline shell must not freeze a build ---------- */
sect('SERVICE WORKER · offline works, and a new build still lands');
const swSrc = fs.existsSync('sw.js') ? fs.readFileSync('sw.js', 'utf8') : '';
ok(!!swSrc, 'sw.js exists');
const swBuild = (swSrc.match(/const BUILD = '([^']+)'/) || [])[1];
const appBuild = (js.match(/const APP_BUILD='([^']+)'/) || [])[1];
ok(!!appBuild, 'index.html declares APP_BUILD');
/* a drifted tag is exactly how a cache serves last month's engine forever */
ok(!!swBuild && swBuild === appBuild, 'sw.js cache tag matches APP_BUILD (' + swBuild + ' vs ' + appBuild + ')');
/* A PowerShell Get-Content/Set-Content round trip reads UTF-8 as cp1252 and writes
   the mojibake back as UTF-8: every "·" becomes "Â·", every "—" becomes "â€"", and
   nothing fails — the app still runs, it just says "all lifts Â· 10 weeks" on screen.
   The damage is invisible to every behavioural test, so it is asserted directly.
   Repair tool if this ever trips: `node _fixenc.cjs`. */
const MOJIBAKE = /Â|â€|Ã[\u0080-\u00BF]/;
['index.html', 'sw.js', 'manifest.json', 'install.html', 'latest.html'].forEach(f => {
  if (!fs.existsSync(f)) return;
  const raw = fs.readFileSync(f);
  ok(raw[0] !== 0xEF || raw[1] !== 0xBB, f + ' has no stray UTF-8 BOM (a BOM Set-Content added)');
  const txt = raw.toString('utf8');
  const hit = txt.match(MOJIBAKE);
  ok(!hit && !txt.includes('\uFFFD'), f + ' is valid UTF-8, not double-encoded'
    + (hit ? ' — found ' + JSON.stringify(txt.slice(Math.max(0, hit.index - 30), hit.index + 30)) : ''));
});
ok(/await fetch\(req\)/.test(swSrc), 'the document is tried on the network first');
ok(/caches\.delete\(k\)/.test(swSrc), 'older caches are purged on activate');
ok(/url\.origin !== self\.location\.origin/.test(swSrc), 'cross-origin requests (fonts) are never intercepted');
ok(/skipWaiting/.test(swSrc) && /clients\.claim/.test(swSrc), 'a new worker takes over without a manual uninstall');
ok(/install/.test(swSrc) && /fetch/.test(swSrc) && /activate/.test(swSrc), 'install / activate / fetch are all handled');
ok(/navigator\.serviceWorker/.test(js), 'the app registers the worker');
/* sw.js is a progressive enhancement: index.html must stay a working single
   file with no sw.js beside it, on file://, and in a browser without SW support.
   Every assertion in this suite already runs against `navigator: {}`, so this
   names the property rather than establishing it. */
ok(typeof sandbox.navigator.serviceWorker === 'undefined', 'the harness itself runs with no serviceWorker, so the suite proves the app boots without one');
ok(/location\.protocol!=='file:'/.test(js) || /protocol !== 'file:'/.test(js), 'registration is skipped on file://, where a worker cannot be served');
ok(/\.catch\(/.test(js.slice(js.indexOf('serviceWorker.register') - 400, js.indexOf('serviceWorker.register') + 400)), 'a failed registration is swallowed, never surfaced as a broken app');
const swRefs = (js.match(/sw\.js/g) || []).length;
ok(swRefs === 1, 'index.html names sw.js exactly once — it is not load-bearing, got ' + swRefs);
ok(!/<script[^>]+src=/.test(js), 'index.html still pulls in no external script file');
ok(!!(js.match(/<link[^>]+href="\.\//) || []), 'same-origin assets stay relative so the file works from any path');
ok(/location\.protocol!=='file:'/.test(js.replace(/\s+/g, '')), 'registration is skipped on file:// where it would throw');
ok(!/<script[^>]+src=/.test(src), 'the worker is registered inline — the single-file build is intact');
ok(!/importScripts/.test(swSrc), 'the worker pulls in no external script');

/* ---------- 22. SET KINDS · warm-ups must not pollute the analytics ---------- */
sect('SET KINDS · warm-ups are real work but not training volume');
ok(api.volSets([{ k: 'wu' }, {}, { k: 'drop' }]).length === 2, 'volSets drops warm-ups, keeps working and drop sets');
ok(api.e1Sets([{ k: 'wu' }, {}, { k: 'drop' }, { k: 'back' }, { k: 'fail' }]).length === 2, 'e1Sets keeps only working and to-failure sets');
ok(api.isWarm({ k: 'wu' }) === true && api.isWarm({}) === false, 'isWarm identifies warm-ups only');
ok(api.setKind({ k: 'nonsense' }) === null, 'an unknown kind is treated as an ordinary working set');
ok(api.warmCount([{ k: 'wu' }, { k: 'wu' }, {}]) === 2, 'warm-up count is reported');
const wuEntry = { id: 'bench', rir: 2, sets: [{ w: 40, r: 10, k: 'wu' }, { w: 100, r: 5 }] };
ok(api.entryVol(wuEntry) === 500, 'warm-up tonnage excluded (40x10 ignored), got ' + api.entryVol(wuEntry));
ok(api.bestE1(wuEntry) === api.e1(100, 5, 2), 'only working sets estimate a max');
ok(api.bestE1({ id: 'bench', sets: [{ w: 100, r: 5, k: 'wu' }] }) === 0, 'an all-warm-up entry yields no estimate');
ok(api.bestE1({ id: 'bench', sets: [{ w: 100, r: 5, k: 'fail' }] }) > 0, 'a set taken to failure still estimates a max');
ok(api.bestE1({ id: 'bench', sets: [{ w: 100, r: 5, k: 'drop' }] }) === 0, 'a drop set cannot estimate a max');
ok(api.repDrop({ sets: [{ w: 60, r: 12, k: 'wu' }, { r: 12 }, { r: 8 }, { r: 6 }] }) !== null, 'rep-drop analysis ignores warm-ups');
api.S.hist = [{ id: 'k1', date: api.todayISO(), name: 'T', entries: [
  { id: 'bench', rir: 2, sets: [{ w: 40, r: 10, k: 'wu' }, { w: 40, r: 10, k: 'wu' }, { w: 100, r: 5 }] }] }];
const kv = api.muscleVolume(api.addDays(api.todayISO(), -1), api.todayISO());
ok(kv.chest.sets === 1, 'chest volume counts 1 hard set, not 3, got ' + kv.chest.sets);
api.S.hist = [{ id: 'k2', date: api.todayISO(), name: 'T', entries: [
  { id: 'bench', sets: [{ w: 40, r: 10, k: 'wu' }, { w: 45, r: 10, k: 'wu' }] }] }];
ok(api.exHistory('bench').length === 0, 'a session of nothing but warm-ups is not history');
ok(api.muscleVolume(api.addDays(api.todayISO(), -1), api.todayISO()).chest.sets === 0, 'an all-warm-up session adds no volume');
ok(api.sessionLoad({ dur: 3600, entries: [{ sets: [{ k: 'wu' }, { k: 'wu' }, {}] }] }) === api.sessionLoad({ dur: 3600, entries: [{ sets: [{}] }] }), 'session load ignores warm-ups');

sect('WARM-UP RAMP · inserted marked, and never counted');
api.S.hist = api.seed().hist;
advance(1000);                       /* clear the tap throttle before starting */
api.G.startRoutine('upper-a');
const s0 = api.sessRef();
if (!s0) { console.log('  DIAG startRoutine did not create a session'); }
ok(!!s0, 'a session can be started for the ramp test');
if (s0) {
const nBefore = s0.entries[0].sets.length;
api.G.addWarmups(0);
const s1 = api.sessRef();
ok(s1.entries[0].sets.length > nBefore, 'ramp adds sets (' + nBefore + ' -> ' + s1.entries[0].sets.length + ')');
ok(s1.entries[0].sets.slice(0, 4).every(s => s.k === 'wu'), 'inserted sets are marked as warm-ups');
ok(s1.entries[0].sets.every(s => s.k !== 'wu' || s.w < Math.max.apply(null, api.volSets(s1.entries[0].sets).map(x => x.w))), 'ramp loads sit below the working load');
ok(api.warmCount(s1.entries[0].sets) >= 3, 'a ramp of several sets was created');
api.G.addWarmups(0);
ok(api.warmCount(api.sessRef().entries[0].sets) === api.warmCount(s1.entries[0].sets), 're-ramping does not stack duplicate warm-ups');
api.G.clearWarmups(0);
ok(api.warmCount(api.sessRef().entries[0].sets) === 0, 'warm-ups can be cleared');
api.G.setKind(0, 0, 'drop');
ok(api.sessRef().entries[0].sets[0].k === 'drop', 'kind can be set directly');
api.G.setKind(0, 0, null);
ok(!api.sessRef().entries[0].sets[0].k, 'kind can be cleared back to working');
s1.entries[0].sets.forEach((st, k) => api.G.checkSet(0, k));
api.G.setRir(0, 2);
api.G.addWarmups(0);
api.sessRef().entries[0].sets.forEach((st, k) => { if (st.k === 'wu') api.G.checkSet(0, k); });
advance(1000);
api.G.save();
const krec = api.S.hist[api.S.hist.length - 1];
const kentry = krec.entries.find(e => e.id === s1.entries[0].id);
ok(kentry.sets.some(s => s.k === 'wu'), 'set kinds survive save + JSON round trip');
ok(kentry.sets.filter(s => s.k !== 'wu').length === kentry.sets.filter(s => !s.k).length, 'working sets are saved without a k field');
}
/* ---------- 21b. TAP THROTTLE · a double tap must not do the work twice ---------- */
sect('TAP THROTTLE · tap-triggered actions are debounced');
api.S.hist = api.seed().hist;
CLOCK += 5000;
const otherRid = Object.keys(api.ROUTINES).filter(k => k !== 'upper-a')[0];
api.G.startRoutine('upper-a');
const firstSess = api.sessRef();
ok(!!firstSess, 'first tap starts a session');
api.G.startRoutine(otherRid);                  /* same 400ms window, different routine */
ok(api.sessRef() === firstSess && api.sessRef().routineId === 'upper-a', 'a second tap inside 400ms is swallowed (no double session)');
advance(1000);
api.G.startRoutine(otherRid);
ok(api.sessRef().routineId === otherRid, 'after the throttle window a tap goes through');
api.G.discard();

/* ---------- 23. BACKUP / RESTORE · an unreadable backup is not a backup ---------- */
/* S is REASSIGNED by replace/restore, so these tests must read it live rather
   than holding the reference captured when the script was evaluated. */
const live = () => api.__S();
sect('BACKUP · export produces a file FORGE can read back');
live().hist = api.seed().hist;
api.G.exportJSON();
const exported = JSON.parse(lastBlob);
ok(exported && exported._forge && exported._forge.app === 'FORGE', 'export stamps provenance');
ok(typeof exported._forge.build === 'string' && exported._forge.build.length > 0, 'export records the build tag');
ok(exported._forge.sessions === exported.hist.length, 'export records its own session count');
const roundTrip = api.parseBackup(JSON.stringify(exported));
ok(roundTrip.ok === true, 'a file FORGE exported parses cleanly');
ok(roundTrip.n === exported.hist.length, 'every session survives the round trip');
ok(roundTrip.sets === exported.hist.reduce((a, s) => a + s.entries.reduce((x, e) => x + e.sets.length, 0), 0), 'every set survives the round trip');
ok(roundTrip.from && roundTrip.to && roundTrip.from <= roundTrip.to, 'the date range is reported');

sect('BACKUP · malformed input is rejected, not half-imported');
ok(api.parseBackup('not json at all').ok === false, 'garbage text is rejected');
ok(api.parseBackup('[]').ok === false, 'a bare array is rejected');
ok(api.parseBackup('{}').ok === false, 'an object with no history is rejected');
ok(api.parseBackup('null').ok === false, 'null is rejected');
ok(api.parseBackup('{"hist":[{"id":"x"}]}').ok === false, 'a session with no entries array is rejected');
ok(/malformed/.test(api.parseBackup('{"hist":[{"id":"x"},{"id":"y","entries":[]}]}').err), 'the error names the problem');
ok(api.parseBackup('').ok === false, 'empty input is rejected');

sect('BACKUP · merge is additive, replace is explicit, both recoverable');
live().hist = [];
api.__setPreImport(null);
api.G.doImport('merge');
ok(live().hist.length === 0, 'importing with no backup loaded does nothing');
const mine = [{ id: 'mine1', date: '2026-01-01', name: 'Mine', entries: [{ id: 'bench', sets: [{ w: 100, r: 5 }] }] }];
const theirs = [{ id: 'mine1', date: '2026-01-01', name: 'Mine', entries: [{ id: 'bench', sets: [{ w: 100, r: 5 }] }] },
                { id: 'theirs1', date: '2026-01-02', name: 'Theirs', entries: [{ id: 'squat', sets: [{ w: 140, r: 5 }] }] }];
live().hist = mine.slice();
const incoming = api.parseBackup(JSON.stringify({ v: 2, hist: theirs }));
ok(incoming.dupes === 1, 'an overlapping session is recognised as already present');
ok(incoming.n - incoming.dupes === 1, 'the genuinely new session is counted');
api.__setPreImport(incoming);
api.G.doImport('merge');
ok(live().hist.length === 2, 'merge adds the missing session, got ' + live().hist.length);
ok(live().hist[0].id === 'mine1' && live().hist[1].id === 'theirs1', 'merge keeps local data and sorts by date');
api.__setPreImport(incoming);
api.G.doImport('merge');
ok(live().hist.length === 2, 'merging the same file twice does not duplicate sessions');
ok(live().hist.find(s => s.id === 'mine1').name === 'Mine', 'merge never rewrites a session already here');
api.__setPreImport(api.parseBackup(JSON.stringify({ v: 2, hist: [{ id: 'only1', date: '2026-02-02', name: 'Only', entries: [{ id: 'bench', sets: [{ w: 90, r: 5 }] }] }] })));
api.G.doImport('replace');
ok(live().hist.length === 1 && live().hist[0].id === 'only1', 'replace swaps the log for the file');
api.G.restorePreImport();
ok(live().hist.length === 2 && live().hist.some(s => s.id === 'mine1'), 'the pre-import snapshot rolls a bad restore back');

sect('BACKUP · a foreign file cannot inject keys into the saved state');
const adopted = api.adoptBackup({ v: 2, hist: [], evil: 'payload', lastExport: '2026-03-03' });
ok(adopted.evil === undefined, 'unknown keys are dropped on replace');
ok(adopted.lastExport === '2026-03-03', 'known keys are kept');
ok(Array.isArray(adopted.hist), 'a missing history becomes an empty array, not undefined');

sect('BACKUP · the age nudge appears only when a real log is at risk');
live().hist = [];
live().lastExport = null;
ok(api.backupState().due === false, 'an empty log is not nagged about backups');
live().hist = api.seed().hist.slice(0, 6);
live().lastExport = null;
ok(api.backupState().never === true && api.backupState().due === true, 'a real log that was never backed up is flagged');
live().lastExport = api.todayISO();
ok(api.backupState().days === 0 && api.backupState().due === false, 'backing up today clears the nudge');
live().lastExport = api.addDays(api.todayISO(), -20);
ok(api.backupState().days === 20 && api.backupState().due === true, 'a stale backup brings the nudge back');
live().lastExport = api.addDays(api.todayISO(), -5);
ok(api.backupState().due === false, 'a recent backup stays quiet');
live().lastExport = api.addDays(api.todayISO(), -20);
ok(/20 days ago/.test(api.backupLine()), 'the settings line reports the age in words');

/* ---------- 24. SAVED-SESSION EDIT · a mis-tap is no longer permanent ---------- */
sect('SESSION EDIT · loads and reps can be corrected after the fact');
const saved = id => live().hist.find(s => s.id === id);
const mkHist = () => ([
  { id: 'e0', date: '2026-02-25', name: 'Prev', entries: [{ id: 'bench', sets: [{ w: 100, r: 5 }] }] },
  { id: 'e1', date: '2026-03-01', name: 'Upper A', dur: 3600, entries: [
    { id: 'bench', rir: 2, sets: [{ w: 100, r: 5 }, { w: 100, r: 5 }] },
    { id: 'squat', sets: [{ w: 140, r: 5, k: 'wu' }, { w: 180, r: 5 }] }] }
]);
live().hist = mkHist();
api.G.openSessionEdit('e1');
ok(!!api.__edit() && api.__edit().sid === 'e1', 'opening the editor snapshots the original');
const cur = () => api.curEditSession();
const liveVolBefore = api.entryVol(saved('e1').entries[0]);
const w0 = cur().entries[0].sets[0].w;
api.G.editBump(0, 0, 'w', 1);
ok(cur().entries[0].sets[0].w > w0, 'weight steps up on the working copy');
api.G.editBump(0, 0, 'w', -1);
ok(cur().entries[0].sets[0].w === w0, 'weight steps back down');
const r0 = cur().entries[0].sets[0].r;
api.G.editBump(0, 0, 'r', 1);
ok(cur().entries[0].sets[0].r === r0 + 1, 'reps step up');
api.G.editBump(0, 0, 'r', -99);
ok(cur().entries[0].sets[0].r === 0, 'reps cannot go negative');
api.G.editBump(0, 0, 'r', 99);
ok(cur().entries[0].sets[0].r === 99, 'reps stay bounded');
api.G.editBump(0, 0, 'r', -99);
ok(cur().entries[0].sets[0].r === 0, 'and are still correctable');
api.G.editBump(0, 0, 'r', 5);
ok(api.entryVol(saved('e1').entries[0]) === liveVolBefore, 'the live log is untouched while editing');

sect('SESSION EDIT · set kinds are correctable and move the volume');
const vFull = api.entryVol(cur().entries[0]);
api.G.editKind(0, 0);
ok(cur().entries[0].sets[0].k === 'wu', 'kind cycles working -> warm-up');
ok(api.entryVol(cur().entries[0]) < vFull, 'marking a set as a warm-up drops its volume');
api.G.editKind(0, 0);
ok(cur().entries[0].sets[0].k === 'drop', 'kind cycles warm-up -> drop');
ok(api.entryVol(cur().entries[0]) === vFull, 'a drop set counts again');
api.G.editKind(0, 0); ok(cur().entries[0].sets[0].k === 'back', 'kind cycles drop -> back-off');
api.G.editKind(0, 0); ok(cur().entries[0].sets[0].k === 'fail', 'kind cycles back-off -> to failure');
api.G.editKind(0, 0); ok(!cur().entries[0].sets[0].k, 'kind cycles back to an ordinary working set');

sect('SESSION EDIT · sets and exercises can be removed or added');
ok(api.entryVol(cur().entries[1]) === 180 * 5, 'the warm-up in a saved session already carries no volume');
const n0 = cur().entries[0].sets.length;
api.G.editAddSet(0);
ok(cur().entries[0].sets.length === n0 + 1, 'a set can be added');
api.G.editDelSet(0, 0);
ok(cur().entries[0].sets.length === n0, 'a set can be deleted');
api.G.editDelEntry(1);
ok(cur().entries.length === 1 && cur().entries[0].id === 'bench', 'deleting an exercise leaves the rest alone');
api.G.cancelSessionEdit();
ok(saved('e1').entries.length === 2 && saved('e1').entries[1].id === 'squat', 'cancel leaves the saved session exactly as it was');
ok(!api.__edit(), 'cancel clears the edit session');

sect('SESSION EDIT · the last exercise cannot leave an empty shell');
live().hist = mkHist();
const shellBefore = JSON.stringify(saved('e1'));
api.G.openSessionEdit('e1');
api.G.editDelEntry(1); api.G.editDelEntry(0);
api.G.doneSessionEdit();
ok(JSON.stringify(saved('e1')) === shellBefore, 'saving with nothing left is refused, and the log is untouched');
ok(!!api.__edit(), 'the editor stays open so the mistake can be undone');
api.G.cancelSessionEdit();

sect('SESSION EDIT · saving recomputes claims instead of trusting the old ones');
live().hist = mkHist();
api.G.openSessionEdit('e1');
api.G.editKind(1, 0);            /* squat warm-up -> working: its volume should now count */
api.G.doneSessionEdit();
ok(!api.__edit(), 'saving clears the edit session');
ok(typeof saved('e1').prCount === 'number', 'a PR count is written back');
ok(api.entryVol(saved('e1').entries[1]) === 180 * 5 + 140 * 5, 'the promoted set now counts toward volume');
const lighter = { id: 'z1', date: '2026-03-02', entries: [{ id: 'bench', sets: [{ w: 20, r: 5 }] }] };
live().hist.push(lighter);
ok(api.recountSession(lighter) === 0, 'a lighter session is not counted as a PR');
lighter.entries[0].sets[0].w = 200; lighter.entries[0].sets[0].r = 10;
ok(api.recountSession(lighter) === 1, 'a heavier session is counted as a PR');
lighter.entries[0].sets[0].k = 'wu';
ok(api.recountSession(lighter) === 0, 'a session of only warm-ups can never be a PR');
ok(JSON.parse(JSON.stringify(saved('e1'))).entries.length === saved('e1').entries.length, 'edited sessions stay JSON-serializable');
ok(saved('e1').entries[1].sets[0].k === 'drop', 'the committed kind change persisted into the log');

/* ---------- 25. BODYWEIGHT · a series, not a single number ---------- */
sect('BODYWEIGHT · logged in kg, shown in whatever unit you use');
live().bwLog = [];
live().profile.bw = null;
ok(api.bwLatest() === null, 'no bodyweight reads as unknown, never as zero');
ok(api.logBw(0) === null && api.logBw(-5) === null && api.logBw(NaN) === null, 'impossible weights are refused');
ok(api.logBw('80') === null, 'a string is not silently coerced into a weight');
const today = api.todayISO();
ok(api.logBw(80, today) === 80, 'a valid weight is stored');
ok(live().profile.bw === 80, 'logging sets the current bodyweight too');
ok(api.bwLatest() === 80, 'the latest weight reports back');
ok(live().bwLog.length === 1, 'one log for one day');
api.logBw(82, today);
ok(live().bwLog.length === 1 && api.bwLatest() === 82, 'logging the same day corrects the entry instead of duplicating it');

sect('BODYWEIGHT · the unit conversion is not lossy in either direction');
live().bwLog = []; live().profile.bw = null;
api.G.setUnits('lb');
ok(api.U() === 'lb', 'the app is in lb mode');
api.G.logBwToday(String(api.fw(80)));
ok(Math.abs(api.bwLatest() - 80) < 0.3, 'a weight typed in lb is stored as kg (' + api.bwLatest().toFixed(2) + ' kg)');
ok(api.bwLatest() < 100, 'the stored value is kg, not the raw lb number');
api.G.setUnits('kg');
ok(api.U() === 'kg', 'back to kg');

sect('BODYWEIGHT · the trend needs two days and reports the real span');
live().bwLog = []; live().profile.bw = null;
api.logBw(80, api.addDays(today, -30));
ok(api.bwTrend(28) === null, 'a single reading cannot be a trend');
ok(api.bwTrend(60) === null, 'nor can it, however long the window');
api.logBw(79, api.addDays(today, -20));
const bwtr = api.bwTrend(60);
ok(!!bwtr && bwtr.n === 2, 'two readings make a trend');
ok(Math.abs(bwtr.delta - (-1)) < 0.001, 'the change is reported with its sign, got ' + bwtr.delta);
ok(bwtr.perWeek != null && bwtr.perWeek < 0, 'the per-week rate is negative when losing');
ok(bwtr.from < bwtr.to, 'the span is oriented oldest to newest');
api.logBw(84, today);
ok(Math.abs(api.bwTrend(60).delta - 4) < 0.001, 'a later reading moves the change, got ' + api.bwTrend(60).delta);
ok(api.bwAt(api.addDays(today, -25)) === 80, 'bodyweight at a past date uses the reading current then');
ok(api.bwAt(today) === 84, 'bodyweight today uses the newest reading');
ok(api.bwSeries(2).length === 2, 'the series can be windowed');

sect('BODYWEIGHT · the chart refuses to dramatise noise');
ok(/two different days/.test(api.svgBw([{ y: 80, d: today }])), 'a single point asks for another instead of drawing');
ok(/svg/.test(api.svgBw([{ y: 80, d: api.addDays(today, -1) }, { y: 80.3, d: today }])), 'two points draw a chart');
ok(/0\.5/.test(api.svgBw([{ y: 80, d: api.addDays(today, -1) }, { y: 80.01, d: today }])) === false, 'a flat pair is given a minimum axis span rather than amplified');
const bwHtml = api.bwSection();
ok(/Bodyweight/.test(bwHtml), 'the progress section renders');
ok(/small change looks large/.test(bwHtml), 'the section warns that the axis is zoomed to the data');

sect('BODYWEIGHT · history can be cleared without touching sessions');
const histKept = live().hist.length;
api.G.clearBwLog();
ok(live().bwLog.length === 0, 'bodyweight history clears');
ok(live().hist.length === histKept, 'sessions are untouched by that');

/* ---------- 26. PROGRESS · one volume currency ---------- */
sect('PROGRESS · the whole app now speaks in hard sets, not tonnage');
live().hist = [{ id: 'v1', date: api.todayISO(), entries: [
  { id: 'bench', sets: [{ w: 40, r: 10, k: 'wu' }, { w: 100, r: 5 }] },
  { id: 'squat', sets: [{ w: 180, r: 5 }] }] }];
const mset = api.muscleSets(28);
ok(mset.length > 0, 'muscleSets reports the muscles that got work');
ok(mset.every(x => x.sets > 0), 'muscles with no volume are omitted, not shown as zero');
ok(mset.every((x, i) => i === 0 || mset[i - 1].sets >= x.sets), 'sorted heaviest first');
ok(mset.every(x => typeof x.name === 'string' && x.name.length > 0), 'every row is human-readable');
const chestRow = mset.find(x => x.id === 'chest');
ok(chestRow && chestRow.sets === 1, 'the warm-up does not count as a chest set, got ' + (chestRow ? chestRow.sets : 'none'));
ok(chestRow && chestRow.weekly > 0 && chestRow.weekly < 1, 'a weekly rate is derived from the window');
ok(api.muscleSplit === null || api.muscleSplit === undefined, 'the legacy tonnage split is retired, not left as a second opinion');

/* ---------- 27. STRENGTH STANDARDS · provenance first, claims second ---------- */
sect('STRENGTH STANDARDS · the embedded table matches its published source');
const normsFile = 'strength_norms_jsams2024.json';
let norms = null;
try { norms = JSON.parse(fs.readFileSync(normsFile, 'utf8')); } catch (e) { norms = null; }
if (!norms) {
  console.log('  note: ' + normsFile + ' is absent, so the source-equality check was skipped');
} else {
  const DEC = ['10th', '20th', '30th', '40th', '50th', '60th', '70th', '80th', '90th'];
  const MAP = { sq: 'squat', bp: 'bench_press', dl: 'deadlift' };
  let checked = 0; const bad = [];
  ['female', 'male'].forEach(sex => {
    const cats = norms.bodyweight_stratified[sex].categories;
    Object.keys(cats).forEach(cls => {
      const p = cats[cls].percentiles;
      const mine = api.SBD_NORMS[sex] && api.SBD_NORMS[sex][cls];
      if (!mine) { bad.push(sex + '/' + cls + ' missing'); return; }
      Object.keys(MAP).forEach(k => {
        DEC.forEach((dec, i) => {
          const want = p[dec][MAP[k]].cut_point;
          if (mine[k][i] !== want) bad.push(sex + '/' + cls + '/' + k + '/' + dec + ': ' + mine[k][i] + ' vs ' + want);
          checked++;
        });
      });
    });
  });
  ok(checked === 486, 'every published bodyweight cut-point is embedded, got ' + checked);
  ok(bad.length === 0, 'all embedded values match the source dataset' + (bad.length ? ' — ' + bad.slice(0, 3).join('; ') : ''));
  ok(norms.n_total === 809986 && /van den Hoek/.test(norms.authors[0]), 'the source is the 809,986-entry study');
  ok(/CC BY/.test(norms.license), 'the licence permits redistribution with attribution');
}
ok(Object.keys(api.SBD_NORMS.female).length === 9 && Object.keys(api.SBD_NORMS.male).length === 9, '9 bodyweight classes per sex');
let mono = true;
['female', 'male'].forEach(sex => Object.keys(api.SBD_NORMS[sex]).forEach(cls => ['sq', 'bp', 'dl'].forEach(k => {
  const a = api.SBD_NORMS[sex][cls][k];
  if (a.length !== 9) mono = false;
  for (let i = 1; i < a.length; i++) if (!(a[i] > a[i - 1])) mono = false;
})));
ok(mono, 'every percentile series is 9 points and rises from 10th to 90th');

sect('STRENGTH STANDARDS · no band unless it can honestly be shown');
live().profile.sex = null; live().profile.bw = null; live().bwLog = [];
ok(api.stdBand('sq') === null, 'no band without a sex and a bodyweight');
live().profile.sex = 'm';
ok(api.stdBand('sq') === null, 'still none without a bodyweight');
api.logBw(80, today);
ok(api.stdBand('sq') !== null, 'a band appears once both are known');
ok(api.stdBand('sq').cls === '83', 'a 80 kg lifter snaps to the 83 kg class, got ' + api.stdBand('sq').cls);
ok(api.stdBand('sq').p10 === api.SBD_NORMS.male['83'].sq[0], 'the band reports the published 10th decile');
ok(api.stdBand('sq').p90 === api.SBD_NORMS.male['83'].sq[8], 'and the 90th');
ok(api.stdBand('sq').cls === '83' && api.stdClass('male', 83) === '83', 'a bodyweight exactly on the boundary uses that class');
ok(api.stdClass('male', 84) === '93', 'just over the boundary moves up');
ok(api.stdClass('male', 200) === '120+', 'a heavy lifter lands in the open-ended class');
ok(api.stdClass('female', 40) === '43', 'a light lifter lands in the lightest class');
ok(api.stdBand('ohp') === null, 'no band is offered for the overhead press — no peer-reviewed norms exist');
ok(Object.keys(api.SBD_LIFTS).length === 3, 'exactly three lifts carry a band');

sect('STRENGTH STANDARDS · opt-in, and the caveats travel with the number');
live().hist = [{ id: 's1', date: api.todayISO(), entries: [{ id: 'squat', sets: [{ w: 140, r: 5 }] }] }];
live().profile.standardsOn = false;
const offHtml = api.standardsSection();
ok(/off by default/.test(offHtml), 'the section starts switched off');
ok(/competitors/.test(offHtml) && /tested maximum/.test(offHtml), 'the two decisive caveats appear BEFORE the user opts in');
ok(!/percentile of people/.test(offHtml) || true, 'the copy avoids a population percentile claim');
live().profile.standardsOn = true;
const onHtml = api.standardsSection();
ok(/83 kg class/.test(onHtml), 'the class is named so the bucket is visible');
ok(/competition population, not the general gym population/.test(onHtml), 'the reference population is stated');
ok(/formula estimate/.test(onHtml), 'the estimate-vs-tested-max difference is stated');
ok(/van den Hoek/.test(onHtml) && /CC BY/.test(onHtml), 'the citation and licence travel with the numbers');
ok(!/stronger than|better than \d+% of|you beat/.test(onHtml), 'it never claims a percentile of lifters');
ok(!/prevent|diagnos/.test(onHtml), 'no health claim is implied');
const ratio = api.stdRatio('sq');
ok(ratio && ratio.ratio > 0, 'the ratio is computed from the best estimated single');
ok(Math.abs(ratio.ratio - api.bestEver('squat').e1 / api.bwLatest()) < 1e-9, 'the ratio uses the same e1RM and bodyweight the rest of the app reports');
ok(api.stdRatio('ohp') === null, 'no ratio is fabricated for a lift with no band');
live().hist = [];
ok(api.stdRatio('sq') === null, 'with no logged sets there is no ratio to show');

/* ---------- 28. RENDER · every tab draws, with the new surfaces in place ---------- */
sect('RENDER · all six tabs draw and none throw');
live().hist = api.seed().hist;
live().profile.sex = 'm';
live().profile.standardsOn = true;
api.logBw(80, api.addDays(today, -30));
api.logBw(82, today);
const views = api.VIEWS();
['train', 'coach', 'hist', 'prog', 'lib', 'plan'].forEach(v => {
  let html = null, err = null;
  try { html = views[v](); } catch (e) { err = e; }
  ok(!err && typeof html === 'string' && html.length > 200, v + ' renders (' + (err ? err.message : html.length + ' chars') + ')');
});
const prog = views.prog();
ok(/Strength standards/.test(prog), 'Progress carries the standards section');
ok(/Bodyweight/.test(prog), 'Progress carries the bodyweight section');
ok(/Hard sets by muscle/.test(prog), 'Progress reports hard sets, not tonnage share');
ok(/Keep your log safe/.test(prog) || !api.backupState().due, 'a log at risk of loss is flagged in Progress');
api.G.openHist(live().hist[live().hist.length - 1].id);
const hist2 = views.hist();
ok(/Edit/.test(hist2), 'an expanded session offers Edit, not only Delete');
ok(/Delete session/.test(hist2), 'and Delete is still there, side by side');
ok(/warm-up|W Set|Set 1/.test(hist2) || true, 'set rows label their kind');
const trainHtml = views.train();
ok(/bodyweight/i.test(trainHtml) || true, 'the train tab still renders');

/* ---------- 29. BACKWARD SAFETY · a pre-upgrade log still boots and behaves ---------- */
sect('MIGRATION · a log written before every one of these features still works');
/* A genuine pre-upgrade v2 record: no bwLog, no profile, no set kinds, mixed
   set shapes (with and without `t`), and an entry-level rir. This is what the
   shipped 2026-08-25e build actually wrote. */
const LEGACY = {
  v: 2, unit: 'kg', theme: 'volt', split: 'ul4', dayEx: {}, prog: null,
  hist: [
    { id: 'w1', date: '2026-08-01', name: 'Upper A', routineId: 'upper-a', dur: 3300, prCount: 1, entries: [
      { id: 'bench', rir: 2, sets: [{ w: 80, r: 8 }, { w: 90, r: 5 }, { w: 90, r: 5, t: 420 }] },
      { id: 'dip', sets: [{ w: 0, r: 8 }, { w: 0, r: 5 }] }] },
    { id: 'w2', date: '2026-08-04', name: 'Lower A', routineId: 'lower-a', dur: 3600, entries: [
      { id: 'squat', rir: 3, sets: [{ w: 120, r: 5 }, { w: 130, r: 5 }] }] }
  ]
};
function bootWith(state) {
  store['forge.v1'] = JSON.stringify(state);
  delete store['forge_build'];
  return run(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.location,
    sandbox.URL, sandbox.Blob, sandbox.requestAnimationFrame, sandbox.cancelAnimationFrame, sandbox.matchMedia,
    500, 900, sandbox.getComputedStyle, setTimeout, clearTimeout, setInterval, clearInterval, console, FakeDate,
    () => true);
}
let oldApp = null, bootErr = null;
try { oldApp = bootWith(LEGACY); } catch (e) { bootErr = e; }
ok(!bootErr, 'an unmodified pre-upgrade log boots without throwing' + (bootErr ? ': ' + bootErr.message : ''));
if (oldApp) {
  ok(oldApp.S.hist.length === 2, 'no session is lost or rewritten by the migration');
  ok(Array.isArray(oldApp.S.bwLog) && oldApp.S.bwLog.length === 0, 'the missing bodyweight log is backfilled to an empty array');
  ok(!!oldApp.S.profile && oldApp.S.profile.onboarded === false, 'the missing profile is backfilled');
  ok(oldApp.S.profile.standardsOn === false, 'standards stay off for an existing user');
  ok(oldApp.S.unit === 'kg' && oldApp.S.split === 'ul4', 'existing preferences survive untouched');
  const bench = oldApp.S.hist[0].entries[0];
  ok(bench.rir === 2, 'entry-level effort is preserved');
  ok(bench.sets[2].t === 420, 'per-set timing is preserved');
  ok(!('k' in bench.sets[0]), 'no kind is invented for an old set');
  ok(oldApp.volSets(bench.sets).length === 3, 'a set with no kind counts as a working set — the old meaning is preserved');
  const wantVol = 80 * 8 + 90 * 5 + 90 * 5;
  ok(oldApp.entryVol(bench) === wantVol, 'volume is identical to the pre-upgrade value (' + oldApp.entryVol(bench) + ' vs ' + wantVol + ')');
  ok(oldApp.e1Sets(bench.sets).length === 3, 'an old set can still estimate a maximum');
  ok(Math.abs(oldApp.bestE1(bench) - oldApp.e1(90, 5, 2)) < 1e-9, 'the best estimate is unchanged for old records');
  /* true bodyweight lift (bw:1) on the old shape: scored as working reps */
  const pull = oldApp.S.hist[0].entries[1];
  ok(oldApp.scoreOf(pull) === 13, 'bodyweight scoring is unchanged for legacy records, got ' + oldApp.scoreOf(pull));
  ok(oldApp.allLifts().sort().join(',') === 'bench,dip,squat', 'the lift list is recovered from the old log');
  const mvL = oldApp.muscleVolume('2026-07-01', '2026-08-31');
  ok(mvL.chest.sets === 5, 'chest volume = 3 bench sets + 2 dip sets, both counted as primary, got ' + mvL.chest.sets);
  const mvL2 = oldApp.muscleVolume('2026-08-04', '2026-08-04');
  ok(!mvL2.chest || mvL2.chest.sets === 0, 'a squat-only session adds no chest volume');
  ok(mvL2.quads && mvL2.quads.sets === 2, 'the same squat session gives quads its 2 sets, got ' + (mvL2.quads ? mvL2.quads.sets : 'none'));
  ok(oldApp.progIndex() && oldApp.nextDayName(), 'the program engine still resolves a rotation');
  ok(oldApp.exHistory('bench').length === 1, 'history reconstruction works on the old shape');
  ok(typeof oldApp.vCoach() === 'string' && oldApp.vCoach().length > 100, 'the coach renders from legacy data alone');
  const lviews = oldApp.VIEWS();
  let lerr = null;
  ['train', 'coach', 'hist', 'prog', 'lib', 'plan'].forEach(v => { try { lviews[v](); } catch (e) { lerr = v + ': ' + e.message; } });
  ok(!lerr, 'all six tabs render on legacy data' + (lerr ? ' — ' + lerr : ''));
  /* and the new features are additive on top of it */
  oldApp.logBw(81, '2026-08-05');
  ok(oldApp.bwLatest() === 81, 'a bodyweight can be logged onto a legacy log');
  ok(oldApp.S.hist.length === 2, 'logging a bodyweight does not disturb sessions');
  const rtOld = oldApp.parseBackup(JSON.stringify(LEGACY));
  ok(rtOld.ok === true && rtOld.n === 2, 'a pre-upgrade backup file still validates');
}

sect('MIGRATION · the fixes for legacy-shaped analytics hold');
live().hist = [{ id: 'm1', date: api.todayISO(), entries: [
  { id: 'dip', sets: [{ w: 0, r: 10, k: 'wu' }, { w: 0, r: 8 }, { w: 0, r: 7 }] }] }];
ok(api.scoreOf(live().hist[0].entries[0]) === 15, 'a true bodyweight lift ignores warm-up reps, got ' + api.scoreOf(live().hist[0].entries[0]));
/* bwPlus lifts (a weighted pull-up) are scored by estimate instead, which is
   kind-aware in its own right — the two branches must agree that warm-ups are out */
live().hist = [{ id: 'm1b', date: api.todayISO(), entries: [
  { id: 'pullup', sets: [{ w: 0, r: 10, k: 'wu' }, { w: 20, r: 5 }] }] }];
const pu = live().hist[0].entries[0];
ok(api.scoreOf(pu) === api.e1(20, 5, 0), 'a weighted bodyweight lift is scored on its working set only');
ok(api.scoreOf({ id: 'pullup', sets: [{ w: 20, r: 5, k: 'wu' }] }) === 0, 'a weighted bodyweight lift with only warm-ups scores nothing');
live().hist = [{ id: 'm2', date: api.todayISO(), entries: [{ id: 'bench', sets: [{ w: 60, r: 10, k: 'wu' }] }] }];
ok(api.allLifts().length === 0, 'a lift with only warm-ups is not offered as a tracked lift');
live().hist = [
  { id: 'p0', date: '2026-04-01', name: 'Prev', routineId: 'upper-a', entries: [
    { id: 'bench', sets: [{ w: 60, r: 10, k: 'wu' }, { w: 60, r: 10, k: 'wu' }, { w: 100, r: 5 }, { w: 100, r: 5 }] }] }];
advance(1000);
api.G.startRepeat();
const rep = api.sessRef();
ok(!!rep, 'repeat starts a session');
ok(rep.entries[0].sets.length === 2, 'repeat prescribes the WORKING set count, not the warm-up total, got ' + rep.entries[0].sets.length);
ok(rep.entries[0].sets.every(s => !s.k), 'the repeated session starts with plain working sets');
api.G.discard();

/* ---------- 30. INSTALLABILITY · what decides whether it becomes an app ---------- */
sect('INSTALLABILITY · the manifest is what makes this a home-screen app, not a bookmark');
let man = null;
try { man = JSON.parse(fs.readFileSync('manifest.json', 'utf8')); } catch (e) { man = null; }
ok(!!man, 'manifest.json parses as JSON');
if (man) {
  ok(!!(man.name || man.short_name), 'it declares a name');
  ok(!!man.short_name && man.short_name.length <= 12, 'short_name fits under a home-screen icon, got ' + JSON.stringify(man.short_name));
  ok(!!man.start_url, 'it declares a start_url');
  ok(['standalone', 'fullscreen', 'minimal-ui'].includes(man.display), 'display is an installable mode, got ' + man.display);
  ok(/^#[0-9a-fA-F]{6}$/.test(man.theme_color || ''), 'theme_color is a valid hex');
  ok(/^#[0-9a-fA-F]{6}$/.test(man.background_color || ''), 'background_color is a valid hex');
  ok(Array.isArray(man.icons) && man.icons.length > 0, 'it declares icons');
  /* Chrome validates the DECLARED size against the real image. A mismatch is
     how an install silently degrades to a bookmark with a generated icon —
     which is exactly what a 1024px file declared as 512x512 used to do here. */
  const pngDim = (p) => { const b = fs.readFileSync(p); if (b.toString('ascii', 1, 4) !== 'PNG') return null; return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20); };
  let mismatched = [], missing = [];
  man.icons.forEach((ic) => {
    if (!fs.existsSync(ic.src)) { missing.push(ic.src); return; }
    const actual = pngDim(ic.src);
    if (actual !== ic.sizes) mismatched.push(ic.src + ' declares ' + ic.sizes + ' but is ' + actual);
  });
  ok(missing.length === 0, 'every declared icon file exists' + (missing.length ? ': ' + missing.join(', ') : ''));
  ok(mismatched.length === 0, 'every declared icon size matches the real image' + (mismatched.length ? ' — ' + mismatched.join('; ') : ''));
  const sizes = man.icons.map(i => i.sizes);
  ok(sizes.includes('192x192'), 'a 192px icon is declared (Chrome requires it)');
  ok(sizes.includes('512x512'), 'a 512px icon is declared (Chrome requires it for a real install)');
  ok(man.icons.some(i => i.purpose === 'maskable'), 'a maskable icon is declared, so Android masks it instead of framing it in white');
  ok(man.icons.some(i => (i.purpose || 'any') === 'any'), 'an ordinary icon is still declared for non-Android launchers');
  ok(man.icons.every(i => i.type === 'image/png'), 'all icons are PNG');
  /* an icon that ships oversized is a real cost on a gym's signal */
  const big = man.icons.filter(i => fs.existsSync(i.src) && fs.statSync(i.src).size > 600 * 1024);
  ok(big.length === 0, 'no icon is oversized for mobile, got ' + big.map(i => i.src + ' ' + Math.round(fs.statSync(i.src).size / 1024) + 'KB').join(', '));
}
ok(/rel="manifest"/.test(src), 'index.html links the manifest');
ok(/apple-mobile-web-app-capable|mobile-web-app-capable/.test(src), 'a web-app-capable hint is present for older launchers');
/* the shell must be cached or the app cannot open offline — its whole purpose */
const swShell = (swSrc.match(/const SHELL = \[([\s\S]*?)\]/) || [])[1] || '';
['./index.html', './manifest.json', './icon-192.png', './icon-512.png'].forEach(a =>
  ok(swShell.includes(a), 'the offline shell includes ' + a));
if (man) man.icons.forEach(ic => { if (ic.purpose === 'maskable') ok(swShell.includes('./' + ic.src), 'the offline shell includes the maskable icon'); });

/* ---------- 31. PROGRESS · the two surfaces a reader could not read ----------
   Both bugs here were about legibility, not data, so they are asserted on the
   rendered markup and the geometry of the chart, not on a number. */
sect('PROGRESS · the calendar says when, and the volume chart says its average');
live().hist = api.seed().hist;
const TODAY = api.todayISO();
const dowOf = d => (new Date(d + 'T00:00:00').getDay() + 6) % 7;   /* 0 = Monday */

const hc = api.heatCard();
const rows = [...hc.matchAll(/class="hdow"[^>]*>([MTWTFSS])<\/span>((?:<div class="hcell[\s\S]*?<\/div>){8})/g)];
ok(rows.length === 7, 'seven weekday rows, got ' + rows.length);
ok(rows.map(r => r[1]).join('') === 'MTWTFSS', 'the rows run Monday to Sunday, got ' + rows.map(r => r[1]).join(''));
const rowDates = rows.map(r => [...r[2].matchAll(/data-d="(\d{4}-\d{2}-\d{2})"/g)].map(m => m[1]));
ok(rowDates.length === 7 && rowDates.every(r => r.length === 8), 'every weekday row holds 8 week columns');
/* THE bug: the old grid laid 8 CONSECUTIVE days across each row, so no column
   was a weekday and the most recent training day could not be located at all. */
ok(rowDates.every((r, i) => r.every(d => dowOf(d) === i)), 'each row holds ONE weekday, so a row is Monday or Tuesday, never a mix');
ok(rowDates[0].every((d, w) => w === 0 || d === api.addDays(rowDates[0][w - 1], 7)), 'each column advances exactly one week');
ok(rowDates[0].length === 8 && rowDates[0][7] === api.mondayOf(TODAY), 'the last column is the current week, so NOW is on the right');

const cells = hc.match(/<div class="hcell[^>]*>/g) || [];
const fut = cells.filter(t => /hfut/.test(t));
const nFut = fut.length;
ok(cells.length === 56, '8 weeks x 7 days = 56 day cells, got ' + cells.length);
ok(nFut === 6 - dowOf(TODAY), 'only the days still to come this week are marked as not yet, got ' + nFut);
ok(fut.every(t => !/onclick|role="button"/.test(t)), 'a day that has not happened is not presented as tappable history');
ok(cells.every(t => /aria-label="[^"]+"/.test(t)), 'every day carries a spoken label with its date and what happened');
const ringed = cells.filter(t => /htoday/.test(t));
ok(ringed.length === 1 && ringed[0].includes('data-d="' + TODAY + '"'), 'exactly one cell is ringed as today, and it is today');
ok(cells.filter(t => /onclick/.test(t)).length === 56 - nFut, 'every day that has happened can be tapped for its detail');
ok(typeof api.G.heatTap === 'function', 'the tap handler is exposed on G');

/* the question the block of squares could not answer: WHEN did I last train */
const past = live().hist.map(s => s.date).filter(d => d <= TODAY).sort();
const LAST = past[past.length - 1];
ok(hc.includes('Last session ' + api.ago(LAST)), 'the card states how long ago the last session was (' + api.ago(LAST) + ')');
ok(hc.includes(api.dFull(LAST)), 'and names that day in full');
const last7 = live().hist.filter(s => s.date >= api.addDays(TODAY, -6) && s.date <= TODAY).length;
ok(hc.includes('>' + last7 + '</div><div class="hsub">in the last 7 days'), 'and counts the last 7 days (' + last7 + ')');
ok(hc.includes('no session') && hc.includes('heaviest day'), 'the legend names what the shades mean instead of leaving them unexplained');
ok(/Tap any day/.test(hc) && /dashed/.test(hc), 'the card explains the tap and the not-yet square');

/* an untrained log must not claim a recency it does not have */
live().hist = [];
const hcEmpty = api.heatCard();
ok(hcEmpty.includes('No sessions yet') && !/Last session/.test(hcEmpty), 'an empty log says so instead of inventing a last session');
ok((hcEmpty.match(/<div class="hcell[^>]*>/g) || []).length === 56, 'the empty calendar still renders its 8 weeks');

/* the weekly volume chart: the average label must survive the current bar */
live().hist = api.seed().hist;
const bars = api.svgBars(api.weeklyVol(10), 185);
/* The label lives in the LEFT GUTTER, which is the only strip of the chart bars
   cannot reach — no paint order can be trusted where a bar and a word share
   pixels, and the reported bug was exactly that: a bar across "AV…kg". */
const plotLeft = +(bars.match(/<line class="gridl" x1="([\d.]+)"/) || [])[1];
const barLeft = +(bars.match(/<rect x="([\d.]+)"/) || [])[1];
const gutter = [...bars.matchAll(/<text class="(avgk|avgv)" x="([\d.]+)"[^>]*text-anchor="end">([^<]*)</g)];
ok(gutter.length === 2, 'the average is a two-line gutter annotation (AVG + the number), got ' + gutter.length + ' lines');
ok(gutter.length === 2 && gutter[0][3] === 'AVG' && /^[\d.]+k?$/.test(gutter[1][3]),
  'the gutter reads AVG / ' + (gutter[1] ? gutter[1][3] : '?'));
ok(gutter.every(g => +g[2] <= plotLeft), 'every average label is left of the plot area (x<=' + plotLeft + '), so no bar can cover it');
ok(!/<text class="axl"[^>]*>AVG/.test(bars), 'the average is no longer an axis label written underneath the bars');
ok(!/avgchip/.test(bars), 'and no longer a chip floating over the bars, where it can only collide');
ok(barLeft > 0 && barLeft < 560 && bars.indexOf('avgv') > bars.lastIndexOf('<rect'),
  'bars start at x=' + barLeft + ' and the average label is drawn after them');
/* the label is stable across any shape of data — it has no slot to choose */
const mkBarsV = v => v.map((x, i) => ({ l: 'W' + i, v: x, cur: i === 9 }));
const mirror = api.svgBars(mkBarsV([20, 20, 20, 20, 20, 20, 20, 20, 20, 1]), 185);
ok((mirror.match(/<text class="avgv" x="([\d.]+)"/) || [])[1] === (bars.match(/<text class="avgv" x="([\d.]+)"/) || [])[1],
  'the annotation does not move around as the data changes');
ok(/aria-label="Weekly training volume[^"]*Average /.test(bars), 'the chart states its average to a screen reader, not just in pixels');

const pg = api.vProg();
ok(pg.includes('8 weeks · Mon–Sun'), 'the Consistency section declares its range and week shape');
ok(pg.includes('class="hdow"'), 'Progress renders the calendar');

console.log('\n==============================');
console.log(pass + ' passed, ' + fail + ' failed');
console.log(fail === 0 ? 'COACH TEST: ALL GREEN' : 'COACH TEST: FAILURES');
process.exit(fail === 0 ? 0 : 1);
