/* _check_clip_press.cjs — verification for _s3d_clip_press.js (standing barbell overhead press).

   Six checks, exactly as _CLIP_BRIEF.md's verification section requires:
     1. the module loads in node and registers S3D.CLIPS['press']
     2. keys sit at the required tempo times, within 1e-9
     3. the measured numbers are reproduced: angles AND the wrist height recomputed from ev.fk.p,
        printed against the targets with their deltas (tolerance +/- 2 deg / +/- 2 units)
     4. smooth motion: ~60 frames, no NaN, no >15 deg frame-to-frame joint jump, monotonic within
        each phase, and the SIGNED direction (the elbow angle must DECREASE from t=0 to t=1.5)
     5. NEGATIVE CONTROLS: perturbed clips must FAIL the same assertions
     6. render and LOOK at it (`--shot` writes the PNGs; the images are inspected by eye)

   Plus the two BARBELL INVARIANTS the project cares about, asserted and printed at every key time
   and over every sampled frame:
     A. level and square — |wrL.y - wrR.y|, |wrL.z - wrR.z| and wrL.x + wrR.x all ~ 0
     B. constant grip — |wrL - wrR| identical at every key time and every frame (min / max / delta)

   `--resolve` is the bake's drift-guard: the clip's poses are BAKED (the solvers no longer run at
   module load — they cost ~30 s of CPU per boot when inlined; see BAKED, NOT SOLVED AT LOAD in the
   module header). This mode re-runs `mod.solve()` on demand and asserts the baked literals still
   reproduce, so a rig change or an edited authored constant fails here instead of silently skewing
   the clip.

   Usage:  node _check_clip_press.cjs [--shot] [--resolve] */
'use strict';
const fs = require('fs');
const { spawn } = require('child_process');

const S3D = require('./_s3d_core.js');
const mod = require('./_s3d_clip_press.js');
const CLIP = S3D.CLIPS['press'];
const NAME = 'press';

const KEY_TIMES = [0, 1.5, 1.82, 2.82, 3.14];
const T_ELBOW = 163.7, T_HEIGHT = 43.9, TOL_A = 2, TOL_H = 2;
/* The height gets a STRICTER tolerance than the brief's +/-2 units, because +/-2 would not
   discriminate: the rig's absolute ceiling at a 163.7 deg elbow is 43.065 against a 43.9 target, so
   every pose this rig can produce clears +/-2 and the check would pass on garbage. 0.05 units is
   ~0.07 cm and is a real test of whether the wrist is where the clip says it is. */
const TOL_H_STRICT = 0.05;
const D2R = Math.PI / 180;

let fails = 0, checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (!cond) fails++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail === undefined ? '' : '   ' + detail));
  return cond;
}

/* ------------------------------------------------------------------ --resolve: the bake's drift-guard
   Re-runs both solvers and asserts the baked literals still reproduce. The solver is deterministic
   pure math over a fixed rig, so the numbers should match to float noise (1e-6); the candidate
   counts must match exactly. Run AFTER any change to _s3d_core.js, to BONE, or to this module's
   authored constants — and re-bake when it fails. */
if (process.argv.includes('--resolve')) {
  console.log('\n=== 0. --resolve: the baked constants reproduce from the solvers ==========');
  const t0 = Date.now();
  const s = mod.solve();
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const cmpNum = (label, baked, got) => ok(near(baked, got, 1e-6),
    label, 'baked ' + baked + '   solved ' + got + '   delta ' + (got - baked).toExponential(2));
  const cmpVec = (label, baked, got) => ok(baked.length === got.length &&
      baked.every((v, i) => near(v, got[i], 1e-6)),
    label, 'baked [' + baked.join(', ') + ']   solved [' + got.join(', ') + ']');
  cmpVec('wrist_lockout', mod.derived.wrist_lockout, s.wrist_lockout);
  cmpVec('wrist_rack', mod.derived.wrist_rack, s.wrist_rack);
  cmpVec('pole_rack', mod.derived.pole_rack, s.pole_rack);
  ok(s.rack_considered === mod.derived.rack_considered, 'rack_considered exact',
    'baked ' + mod.derived.rack_considered + '   solved ' + s.rack_considered);
  ok(s.rack_accepted === mod.derived.rack_accepted, 'rack_accepted exact',
    'baked ' + mod.derived.rack_accepted + '   solved ' + s.rack_accepted);
  Object.keys(mod.derived.rack_solved).forEach(k =>
    cmpNum('rack_solved.' + k, mod.derived.rack_solved[k], s.rack_solved[k]));
  ok(s.lockout_dy !== undefined && isFinite(s.lockout_dy), 'solver returned a finite lockout height', s.lockout_dy);
  console.log('  (solve took ' + dt + ' s — this is the boot cost the bake removed)');
  console.log('\n=== --resolve result ======================================================');
  console.log(checks + ' assertions, ' + fails + ' failed  ->  ' + (fails ? 'FAIL' : 'PASS'));
  process.exitCode = fails ? 1 : 0;
  return;
}

/* ------------------------------------------------------------------ measuring helpers
   Angles are recomputed from ev.fk.p: the rotations are the input, the angles are the thing being
   measured, and only the second is comparable to the reference data. */
function ang(p, a, b, c) {
  const u = S3D.sub(p[a], p[b]), v = S3D.sub(p[c], p[b]);
  const c2 = S3D.dot(u, v) / ((S3D.len(u) * S3D.len(v)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, c2))) * 180 / Math.PI;
}
/* elbow interior angle, per side */
function elbows(ev) {
  return { L: ang(ev.fk.p, 'shL', 'elbL', 'wrL'), R: ang(ev.fk.p, 'shR', 'elbR', 'wrR') };
}
function joints(ev) {
  return {
    elbL: ang(ev.fk.p, 'shL', 'elbL', 'wrL'), elbR: ang(ev.fk.p, 'shR', 'elbR', 'wrR'),
    shL: ang(ev.fk.p, 'chest', 'shL', 'elbL'), shR: ang(ev.fk.p, 'chest', 'shR', 'elbR'),
    kneeL: ang(ev.fk.p, 'hipL', 'kneeL', 'ankleL'), kneeR: ang(ev.fk.p, 'hipR', 'kneeR', 'ankleR'),
    hipL: ang(ev.fk.p, 'chest', 'hipL', 'kneeL'), hipR: ang(ev.fk.p, 'chest', 'hipR', 'kneeR')
  };
}
const wrH = ev => ev.fk.p.wrL[1] - ev.fk.p.shL[1];      /* the measured wrist height */

/* ---- the two barbell invariants, as one measurement of a frame ---- */
function bar(ev) {
  const L = ev.fk.p.wrL, R = ev.fk.p.wrR;
  return {
    dy: Math.abs(L[1] - R[1]), dz: Math.abs(L[2] - R[2]), xsum: L[0] + R[0],
    grip: S3D.vdist(L, R),
    L: L.slice(), R: R.slice()
  };
}
function tolVerdict(label, measured, target, tol) {
  const d = measured - target, pass = Math.abs(d) <= tol;
  return { pass: pass, line: (pass ? '  PASS  ' : '  FAIL  ') + label + '   measured ' +
    measured.toFixed(3) + ' vs target ' + target + '   (delta ' + d.toFixed(3) + ', tolerance +/-' + tol + ')' };
}
const cloneClip = (c, name) => { const o = JSON.parse(JSON.stringify(c)); o.name = name; return o; };

/* ------------------------------------------------------------------ 1. loads */
console.log('\n=== 1. module loads and registers =========================================');
ok(!!mod && !!mod.clip, 'require() returned { clip, targets }');
ok(!!CLIP, "S3D.CLIPS['" + NAME + "'] exists");
ok(!!CLIP && CLIP.name === NAME, 'clip.name === ' + NAME, CLIP && CLIP.name);
const M = S3D.MEASURED && S3D.MEASURED[NAME];
ok(!!M, 'S3D.MEASURED[' + NAME + '] recorded');
ok(!!M && /YouTube CC-BY/.test(M.source || ''), 'provenance source recorded', M && M.source);
ok(!!M && M.licence === 'CC BY', 'provenance licence recorded', M && M.licence);
ok(!!M && !!M.targets && M.targets.elbow_lockout_deg === T_ELBOW &&
   M.targets.wrist_above_shoulder_lockout === T_HEIGHT,
  'recorded targets are the given numbers, unedited',
  M && M.targets && (M.targets.elbow_lockout_deg + ' / ' + M.targets.wrist_above_shoulder_lockout));

/* ------------------------------------------------------------------ 2. key times */
console.log('\n=== 2. keys sit at the tempo times ========================================');
const ch = S3D.buildCharacter();
const times = CLIP.keys.map(k => k.t);
ok(CLIP.duration === 3.14, 'duration is exactly 3.14', CLIP.duration);
ok(times.length === KEY_TIMES.length, times.length + ' keys', times.join(', '));
KEY_TIMES.forEach((t, i) => {
  const d = Math.abs((times[i] === undefined ? NaN : times[i]) - t);
  ok(d <= 1e-9, 'key ' + i + ' at t=' + t, 'got ' + times[i] + ' (delta ' + d + ')');
});

/* ------------------------------------------------------------------ 3. the measured numbers */
console.log('\n=== 3. the measured numbers are reproduced ================================');
function measureAt(t, name) {
  const ev = S3D.sample(ch, name || NAME, t);
  return { ev: ev, e: elbows(ev), h: wrH(ev), bar: bar(ev), clamped: ev.ik.clamped };
}
function report(t, label, target) {
  const m = measureAt(t);
  console.log('  t=' + t.toFixed(2) + '   ' + label + (target === undefined ? '' : '   (measured target ' + target + ' deg)'));
  console.log('        elbow interior   L ' + m.e.L.toFixed(3) +
    (target === undefined ? '' : '  (delta ' + (m.e.L - target).toFixed(3) + ')') +
    '    R ' + m.e.R.toFixed(3) +
    (target === undefined ? '' : '  (delta ' + (m.e.R - target).toFixed(3) + ')') +
    '    [AUTHORED for the rack]');
  console.log('        wrist height wrL.y - shL.y = ' + m.h.toFixed(3) +
    '   wrL [' + m.bar.L.map(v => v.toFixed(3)).join(', ') + ']');
  return m;
}
const homeM = report(0, 'home — LOCKOUT', T_ELBOW);
report(2.82, 'home — LOCKOUT (end of phase 3)', T_ELBOW);
report(3.14, 'home — LOCKOUT (phase 4 hold)', T_ELBOW);
const awayM = report(1.5, 'away — RACKED (end of phase 1, the lowering)');
report(1.82, 'away — RACKED (phase 2 hold)');

console.log('\n  home — LOCKOUT wrist height (the second measured number):');
console.log('        wrL.y - shL.y   measured ' + homeM.h.toFixed(3) + ' vs target ' + T_HEIGHT +
  '   (delta ' + (homeM.h - T_HEIGHT).toFixed(3) + ')');
console.log('        the chord a 163.7 deg elbow fixes, and therefore the ceiling on this height: ' +
  mod.derived.chord_at_lockout_elbow.toFixed(3));

ok(Math.abs(homeM.e.L - T_ELBOW) <= TOL_A, 'lockout elbow within +/-' + TOL_A + ' deg, left',
  homeM.e.L.toFixed(3) + ' vs ' + T_ELBOW + '  (delta ' + (homeM.e.L - T_ELBOW).toFixed(3) + ')');
ok(Math.abs(homeM.e.R - T_ELBOW) <= TOL_A, 'lockout elbow within +/-' + TOL_A + ' deg, right',
  homeM.e.R.toFixed(3) + ' vs ' + T_ELBOW + '  (delta ' + (homeM.e.R - T_ELBOW).toFixed(3) + ')');
ok(Math.abs(awayM.e.L - T_ELBOW) > 20, 'the racked elbow is a genuinely different pose from the lockout',
  'racked ' + awayM.e.L.toFixed(3) + ' deg vs lockout ' + homeM.e.L.toFixed(3) + ' deg');

const hVerdict = tolVerdict('lockout wrist height within +/-' + TOL_H + ' units of the target',
  homeM.h, T_HEIGHT, TOL_H);
console.log('  ' + hVerdict.line.trim());
console.log('        ^ the deck\'s own tolerance. PASS is expected and is NOT evidence of accuracy.');

/* THE CEILING DEPENDS ON THE GRIP, and getting that wrong produces a false failure.
   The measured elbow angle fixes the shoulder->wrist chord at 43.065, but the wrist sits outboard of
   the shoulder joint by dx = gripHalf - 4.5, and only the chord's VERTICAL component is the measured
   height. So the tallest reachable wrist at this elbow angle is sqrt(chord^2 - dx^2), which the grip
   width reduces. With gripHalf 14 (a 28-unit grip) that ceiling is 42.004, and the clip hits it. */
const dx = mod.derived.grip_half_width - mod.derived.shoulder_rest[0];
const lockoutCeiling = Math.sqrt(mod.derived.chord_at_lockout_elbow * mod.derived.chord_at_lockout_elbow - dx * dx);
const ceiling = lockoutCeiling;
console.log('        grip-aware ceiling = sqrt(' + mod.derived.chord_at_lockout_elbow.toFixed(4) +
  '^2 - ' + dx.toFixed(2) + '^2) = ' + ceiling.toFixed(4) +
  '   (grip half-width ' + mod.derived.grip_half_width + ', so dx = ' + dx.toFixed(2) + ')');
const hStrict = tolVerdict('lockout wrist height matches the MAXIMUM reachable at 163.7 deg with this grip',
  homeM.h, ceiling, TOL_H_STRICT);
console.log('  ' + hStrict.line.trim());
ok(hStrict.pass, 'the wrist really is at the rig\'s ceiling for the measured elbow angle AND this grip',
  'height ' + homeM.h.toFixed(4) + ' vs ceiling ' + ceiling.toFixed(4) +
  ' (gap ' + Math.abs(homeM.h - ceiling).toExponential(2) + ')');
console.log('  REPORTED HONESTLY: the target is ' + T_HEIGHT + ', this clip achieves ' + homeM.h.toFixed(3) +
  ' — a shortfall of ' + (T_HEIGHT - homeM.h).toFixed(3) + ' units. ' +
  (T_HEIGHT - ceiling).toFixed(3) + ' of that is the elbow angle alone (no pose on this rig can close it); ' +
  (ceiling - homeM.h).toFixed(3) + ' is this clip\'s distance from its own ceiling. ' +
  'It is not restated as a pass.');

ok(homeM.clamped === 0 && awayM.clamped === 0, 'no IK chain out of reach at either extreme',
  'clamped ' + homeM.clamped + ' / ' + awayM.clamped);

/* ---- feet planted and knees near straight */
const foot = { minY: 1e9, maxY: -1e9, minKnee: 1e9, maxKnee: -1e9 };
for (let i = 0; i <= 200; i++) {
  const p = S3D.sample(ch, NAME, CLIP.duration * i / 200).fk.p;
  ['ankleL', 'ankleR'].forEach(j => { foot.minY = Math.min(foot.minY, p[j][1]); foot.maxY = Math.max(foot.maxY, p[j][1]); });
  const k = ang(p, 'hipL', 'kneeL', 'ankleL');
  foot.minKnee = Math.min(foot.minKnee, k); foot.maxKnee = Math.max(foot.maxKnee, k);
}
console.log('  ankles (201 frames): y ' + foot.minY.toFixed(4) + ' .. ' + foot.maxY.toFixed(4) +
            '   knee ' + foot.minKnee.toFixed(3) + ' .. ' + foot.maxKnee.toFixed(3) + ' deg');
ok(foot.maxY - foot.minY < 1e-9, 'both ankles are FIXED in space for the whole rep (feet planted)',
  'y range ' + (foot.maxY - foot.minY).toExponential(2));
ok(foot.minKnee > 170, 'knees stay near straight throughout (a standing press, legs not driving)',
  'knee ' + foot.minKnee.toFixed(2) + ' .. ' + foot.maxKnee.toFixed(2) + ' deg');

/* ---- legs symmetric: the two knees must be mirror images */
let legAsym = 0;
for (let i = 0; i <= 100; i++) {
  const p = S3D.sample(ch, NAME, CLIP.duration * i / 100).fk.p;
  legAsym = Math.max(legAsym, Math.abs(ang(p, 'hipL', 'kneeL', 'ankleL') - ang(p, 'hipR', 'kneeR', 'ankleR')));
}
ok(legAsym < 1e-6, 'the two legs are mirror-symmetric (stance symmetric)',
  'largest knee-angle difference ' + legAsym.toExponential(2) + ' deg');

/* ------------------------------------------------------------------ 3b. barbell invariants */
console.log('\n=== 3b. BARBELL INVARIANTS (a real 2.20 m bar cannot tilt or stretch) =====');
console.log('  at every key time:');
let gripMin = 1e9, gripMax = -1e9, dyMax = 0, dzMax = 0, xsumMax = 0;
CLIP.keys.forEach(k => {
  const b = bar(S3D.sample(ch, NAME, k.t));
  gripMin = Math.min(gripMin, b.grip); gripMax = Math.max(gripMax, b.grip);
  dyMax = Math.max(dyMax, b.dy); dzMax = Math.max(dzMax, b.dz); xsumMax = Math.max(xsumMax, Math.abs(b.xsum));
  console.log('    t=' + k.t.toFixed(2) + '  wrL [' + b.L.map(v => v.toFixed(4)).join(', ') + ']' +
              '  wrR [' + b.R.map(v => v.toFixed(4)).join(', ') + ']' +
              '  grip=' + b.grip.toFixed(6) + '  |dy|=' + b.dy.toExponential(2) +
              '  |dz|=' + b.dz.toExponential(2) + '  |xL+xR|=' + Math.abs(b.xsum).toExponential(2));
});
console.log('  over 202 sampled frames of the whole rep:');
let gMinF = 1e9, gMaxF = -1e9, dyF = 0, dzF = 0, xsF = 0;
for (let i = 0; i <= 200; i++) {
  const b = bar(S3D.sample(ch, NAME, CLIP.duration * i / 200));
  gMinF = Math.min(gMinF, b.grip); gMaxF = Math.max(gMaxF, b.grip);
  dyF = Math.max(dyF, b.dy); dzF = Math.max(dzF, b.dz); xsF = Math.max(xsF, Math.abs(b.xsum));
}
console.log('    grip |wrL-wrR| :  min ' + gMinF.toFixed(9) + '   max ' + gMaxF.toFixed(9) +
            '   delta ' + (gMaxF - gMinF).toExponential(3));
console.log('    level  |wrL.y-wrR.y| max ' + dyF.toExponential(3) +
            '   square |wrL.z-wrR.z| max ' + dzF.toExponential(3) +
            '   mirror |wrL.x+wrR.x| max ' + xsF.toExponential(3));
ok(dyF < 1e-9, 'BAR LEVEL: |wrL.y - wrR.y| is zero on every frame', dyF.toExponential(3));
ok(dzF < 1e-9, 'BAR SQUARE: |wrL.z - wrR.z| is zero on every frame', dzF.toExponential(3));
ok(xsF < 1e-9, 'BAR CENTRED: wrL.x = -wrR.x on every frame', xsF.toExponential(3));
ok(gMaxF - gMinF < 1e-9, 'GRIP WIDTH CONSTANT: |wrL - wrR| does not change on any frame',
  'min ' + gMinF.toFixed(9) + ' max ' + gMaxF.toFixed(9) + ' delta ' + (gMaxF - gMinF).toExponential(3) +
  ' (AUTHORED half-width ' + mod.derived.grip_half_width + ' -> ' + (2 * mod.derived.grip_half_width) + ' units)');
ok(Math.abs(gMinF - 2 * mod.derived.grip_half_width) < 1e-6, 'the grip is the authored width',
  gMinF.toFixed(6) + ' vs ' + (2 * mod.derived.grip_half_width));

/* ------------------------------------------------------------------ 4. smooth motion */
console.log('\n=== 4. smooth motion + the signed direction ===============================');
const N = 60, F = [];
for (let i = 0; i < N; i++) F.push({ t: CLIP.duration * i / N, ev: S3D.sample(ch, NAME, CLIP.duration * i / N) });
let nan = 0;
F.forEach(f => Object.keys(f.ev.fk.p).forEach(j => f.ev.fk.p[j].forEach(v => { if (!isFinite(v)) nan++; })));
ok(nan === 0, 'no NaN / non-finite joint position in any of the ' + N + ' frames', nan + ' bad values');
let worst = 0, worstAt = '', worstJ = '';
for (let i = 1; i < N; i++) {
  const a = joints(F[i - 1].ev), b = joints(F[i].ev);
  Object.keys(a).forEach(k => {
    const d = Math.abs(b[k] - a[k]);
    if (d > worst) { worst = d; worstAt = F[i].t.toFixed(3); worstJ = k; }
  });
}
ok(worst <= 15, 'largest frame-to-frame joint-angle jump <= 15 deg over ' + N + ' frames',
  worst.toFixed(3) + ' deg on ' + worstJ + ' at t=' + worstAt);

/* THE SIGNED DIRECTION. home = lockout, away = racked, so the elbow angle must FALL through phase 1
   and RISE through phase 3. If this is inverted the whole animation runs backwards — which every
   absolute-value check above would happily pass.

   PHASE_TOL is the one tolerance in this file that is not the brief's, and it is deliberate. The
   wrist is interpolated LINEARLY between keys while the elbow angle is a NONLINEAR function of that
   path, so a residual 5.5e-4 deg of non-monotonicity appears near the end of the descent as the arc
   flattens out. Demanding 1e-9 there tests floating-point noise, not the animation. But it cannot
   hide a reversed phase either: a genuinely inverted phase travels ~102 deg the wrong way, i.e.
   ~0.26 deg per sub-sample, five hundred times this bound. BOTH the tolerance and the total travel
   are asserted, so a wobble can never be mistaken for a direction. */
const PHASE_TOL = 0.01;
const phases = [[0, 1.5, 'down'], [1.5, 1.82, 'hold'], [1.82, 2.82, 'up'], [2.82, 3.14, 'hold']];
phases.forEach(([a, b, dir]) => {
  const seq = [];
  for (let i = 0; i <= 400; i++) {
    const t = Math.min(a + (b - a) * i / 400, CLIP.duration - 1e-9);
    seq.push(elbows(S3D.sample(ch, NAME, t)).L);
  }
  let bad = null, worstBack = 0;
  for (let i = 1; i < seq.length; i++) {
    const d = seq[i] - seq[i - 1];
    const at = (a + (b - a) * i / 400).toFixed(3);
    if (dir === 'down' && d > PHASE_TOL) { bad = 'rose by ' + d.toExponential(2) + ' at t=' + at; break; }
    if (dir === 'up' && d < -PHASE_TOL) { bad = 'fell by ' + d.toExponential(2) + ' at t=' + at; break; }
    if (dir === 'hold' && Math.abs(d) > 1e-9) { bad = 'moved by ' + d.toExponential(2) + ' at t=' + at; break; }
    if (dir === 'down') worstBack = Math.max(worstBack, d);
    if (dir === 'up') worstBack = Math.max(worstBack, -d);
  }
  const what = dir === 'hold' ? 'constant' : 'monotonic (' + dir + ')';
  ok(bad === null, 'elbow angle ' + what + ' through t=' + a + '..' + b + ' (401 sub-samples)',
    bad === null ? (seq[0].toFixed(2) + ' -> ' + seq[seq.length - 1].toFixed(2) +
      (dir === 'hold' ? '' : ', worst residual against the direction ' + worstBack.toExponential(2) + ' deg')) : bad);
});
console.log('  SIGNED: elbow ' + homeM.e.L.toFixed(3) + ' deg at t=0  ->  ' + awayM.e.L.toFixed(3) +
            ' deg at t=1.5   (signed change ' + (awayM.e.L - homeM.e.L).toFixed(3) +
            ' deg, i.e. the arm FLEXES and the bar is LOWERED through phase 1)');
ok(awayM.e.L - homeM.e.L < -20, 'DIRECTION: the elbow angle DECREASES from t=0 to t=1.5',
  'signed change ' + (awayM.e.L - homeM.e.L).toFixed(3) + ' deg');

let loK = 1e9, hiK = -1e9;
for (let i = 0; i < N; i++) { const k = elbows(F[i].ev).L; loK = Math.min(loK, k); hiK = Math.max(hiK, k); }
console.log('  elbow arc across the ' + N + '-frame sample: ' + loK.toFixed(3) + ' .. ' + hiK.toFixed(3) + ' deg');
/* The clip's lowest elbow must BE the rack key's, not merely near it: if the arm keeps folding past
   t=1.5 the hold twitches and the movement's true extreme sits outside its own keyframes.
   ARC_TOL is not the brief's, and it is small on purpose. The elbow angle is a nonlinear function of
   the linearly-interpolated wrist, so its minimum is a smooth quadratic bottom: at a quadratic
   minimum the angle is flat to second order, which makes the LOCATION of the minimum numerically
   ill-conditioned even when the angle there is exact. 0.01 deg is 0.006% of this rep's 85 deg of
   travel — far inside a rendered pixel — while a genuine overshoot (a rack key that is not the
   bottom) moves this by whole degrees. Both the amplitude and the frame-to-frame jump are checked,
   so a flat bottom cannot mask a real one. */
const ARC_TOL = 0.01;
console.log('  arc vs key extremes: ' + (awayM.e.L - loK).toExponential(2) + ' deg below the "away" key, ' +
  (homeM.e.L - hiK).toExponential(2) + ' above the "home" key   (tolerance ' + ARC_TOL + ' deg)');
ok(Math.abs(loK - awayM.e.L) < ARC_TOL && Math.abs(hiK - homeM.e.L) < ARC_TOL,
  'the arc reached between keys never overshoots the extremes at the keys',
  'loop span ' + loK.toFixed(6) + '..' + hiK.toFixed(6) + ' vs key values ' +
  awayM.e.L.toFixed(6) + '..' + homeM.e.L.toFixed(6));

/* the height arc, so the bar's range is on the record too */
let loH = 1e9, hiH = -1e9;
for (let i = 0; i < N; i++) { const h = wrH(F[i].ev); loH = Math.min(loH, h); hiH = Math.max(hiH, h); }
console.log('  bar height (wrL.y - shL.y) across the rep: ' + loH.toFixed(3) + ' .. ' + hiH.toFixed(3) +
            ' units   = a stroke of ' + (hiH - loH).toFixed(3) + ' units');

/* ------------------------------------------------------------------ 5. negative controls
   Each one runs THE SAME predicate the checks above run, on a deliberately broken clip, and prints
   the verdict that predicate produces. The assertion here is that the verdict is FAIL — a check
   that cannot fail proves nothing.
   Every mutated clip is a DEEP COPY registered under a NEW name: mutating a clip's `keys` in place
   can be silently ignored by a memoising sample(), which would make a negative control pass while
   proving nothing. */
console.log('\n=== 5. NEGATIVE CONTROLS (the check must be able to fail) =================');
/* NC1 — the lockout wrist pulled down onto the rig's max reach with a straight elbow: the classic
   "hit the height by straightening the arm" error, which breaks the measured ELBOW angle. */
const nc1 = cloneClip(CLIP, 'press_nc1');
[0, 3, 4].forEach(i => {
  nc1.keys[i].ik.armL.t = [5.5, 104.5 + 43.5, 0];
  nc1.keys[i].ik.armR.t = [-5.5, 104.5 + 43.5, 0];
});
S3D.CLIPS['press_nc1'] = nc1;
const e1 = measureAt(0, 'press_nc1');
const v1 = tolVerdict('NC1: lockout elbow within +/-' + TOL_A + ' deg (left)', e1.e.L, T_ELBOW, TOL_A);
console.log('  NC1 — the lockout arm driven to full extension to buy the last 1.4 units of height:');
console.log(v1.line);
console.log('        (that clip\'s height is ' + e1.h.toFixed(3) + ' vs target ' + T_HEIGHT + ')');
ok(!v1.pass, 'NC1 : the elbow tolerance check reports FAIL on a clip that misses the target',
  'verdict ' + (v1.pass ? 'PASS' : 'FAIL') + ', |delta| ' + Math.abs(e1.e.L - T_ELBOW).toFixed(3) + ' > ' + TOL_A);
delete S3D.CLIPS['press_nc1'];

/* NC2 — the direction inverted: home and away swapped, so phase 1 RAISES the bar. Every absolute
   value above still matches the targets; only the SIGN is wrong. */
const nc2 = cloneClip(CLIP, 'press_nc2');
const kk = nc2.keys, t0 = JSON.parse(JSON.stringify(kk[0].ik)), t1 = JSON.parse(JSON.stringify(kk[1].ik));
[0, 3, 4].forEach(i => { kk[i].ik = JSON.parse(JSON.stringify(t1)); });
[1, 2].forEach(i => { kk[i].ik = JSON.parse(JSON.stringify(t0)); });
S3D.CLIPS['press_nc2'] = nc2;
const n0 = S3D.sample(ch, 'press_nc2', 0), n15 = S3D.sample(ch, 'press_nc2', 1.5);
const d2 = elbows(n15).L - elbows(n0).L;
console.log('  NC2 — home and away swapped (phase 1 RAISES the bar instead of lowering it):');
console.log('        signed elbow change t=0 -> t=1.5 is ' + d2.toFixed(3) +
            ' deg  (the real clip\'s is ' + (awayM.e.L - homeM.e.L).toFixed(3) + ' deg)');
ok(!(d2 < -20), 'NC2 : the SIGNED direction check reports FAIL on an inverted clip',
  'verdict ' + (d2 < -20 ? 'PASS' : 'FAIL') + '; this is the check that catches an animation running backwards');
delete S3D.CLIPS['press_nc2'];

/* NC3 — the two wrists pulled to different heights: the bar tilts. Every elbow angle stays inside
   tolerance, so only the barbell invariants catch it. */
const nc3 = cloneClip(CLIP, 'press_nc3');
nc3.keys.forEach(k => { k.ik.armR.t = [k.ik.armR.t[0], k.ik.armR.t[1] - 3, k.ik.armR.t[2]]; });
S3D.CLIPS['press_nc3'] = nc3;
const b3 = bar(S3D.sample(ch, 'press_nc3', 0));
const e3 = measureAt(0, 'press_nc3');
console.log('  NC3 — the right wrist dropped 3 units (the bar is no longer level):');
console.log('        |wrL.y - wrR.y| = ' + b3.dy.toFixed(4) + '   grip |wrL-wrR| = ' + b3.grip.toFixed(4) +
            '   elbow L ' + e3.e.L.toFixed(3) + ' / R ' + e3.e.R.toFixed(3));
ok(!(b3.dy < 1e-9), 'NC3 : the BAR LEVEL check reports FAIL on a tilted bar',
  'verdict ' + (b3.dy < 1e-9 ? 'PASS' : 'FAIL') + ', |dy| ' + b3.dy.toFixed(4));
ok(Math.abs(e3.e.L - T_ELBOW) <= TOL_A, 'NC3 : ...while the elbow angle check still PASSES on it',
  'L ' + e3.e.L.toFixed(3) + ' — which is exactly why the bar invariants exist as separate checks');
delete S3D.CLIPS['press_nc3'];

/* NC4 — a stretched grip: the two wrists pulled apart on the rack keys only. */
const nc4 = cloneClip(CLIP, 'press_nc4');
[1, 2].forEach(i => {
  nc4.keys[i].ik.armL.t = [nc4.keys[i].ik.armL.t[0] + 2, nc4.keys[i].ik.armL.t[1], nc4.keys[i].ik.armL.t[2]];
  nc4.keys[i].ik.armR.t = [nc4.keys[i].ik.armR.t[0] - 2, nc4.keys[i].ik.armR.t[1], nc4.keys[i].ik.armR.t[2]];
});
S3D.CLIPS['press_nc4'] = nc4;
let g4min = 1e9, g4max = -1e9;
for (let i = 0; i <= 100; i++) {
  const g = bar(S3D.sample(ch, 'press_nc4', CLIP.duration * i / 100)).grip;
  g4min = Math.min(g4min, g); g4max = Math.max(g4max, g);
}
console.log('  NC4 — grip widened by 4 units on the rack keys only (the bar stretches):');
console.log('        grip min ' + g4min.toFixed(6) + ' max ' + g4max.toFixed(6) +
            ' delta ' + (g4max - g4min).toFixed(6));
ok(!(g4max - g4min < 1e-9), 'NC4 : the CONSTANT GRIP check reports FAIL on a stretching bar',
  'verdict ' + (g4max - g4min < 1e-9 ? 'PASS' : 'FAIL') + ', delta ' + (g4max - g4min).toFixed(6));
delete S3D.CLIPS['press_nc4'];

/* NC5 — a tempo key moved off its boundary must fail check 2. */
const nc5 = cloneClip(CLIP, 'press_nc5');
nc5.keys[1].t = 1.5000001;
ok(!(Math.abs(nc5.keys[1].t - 1.5) <= 1e-9), 'NC5 : the key-time check fails on a key moved by 1e-7 s',
  'delta ' + Math.abs(nc5.keys[1].t - 1.5).toExponential(1) + ' > 1e-9');

/* ------------------------------------------------------------------ 6. render */
if (process.argv.includes('--shot')) {
  console.log('\n=== 6. render =============================================================');
  render().then(finish).catch(e => { console.log('  RENDER FAILED: ' + e.message); fails++; finish(); });
} else {
  console.log('\n(render skipped: pass --shot)');
  finish();
}

function finish() {
  console.log('\n=== result ===============================================================');
  console.log(checks + ' assertions, ' + fails + ' failed  ->  ' + (fails ? 'FAIL' : 'PASS'));
  console.log('NOTE: ' + (T_HEIGHT - mod.derived.chord_at_lockout_elbow).toFixed(3) +
    ' units of the deck\'s ' + T_HEIGHT + ' wrist-height target is unreachable at a 163.7 deg elbow ' +
    'on this rig\'s bones (chord limit ' + mod.derived.chord_at_lockout_elbow.toFixed(3) +
    '), and a further ' + (mod.derived.chord_at_lockout_elbow - lockoutCeiling).toFixed(3) +
    ' is given up to the ' + (2 * mod.derived.grip_half_width) + '-unit grip, since the wrist sits outboard ' +
    'of the shoulder and only the chord\'s vertical component is the height. This clip reaches ' +
    lockoutCeiling.toFixed(3) + '. See the header of _s3d_clip_press.js.');
  process.exitCode = fails ? 1 : 0;
}

/* Headless-Chrome render of this ONE clip. _s3d_view.html loads no clip file, so the clip is
   injected after load and the sheet rebuilt — same viewer, same renderer the app uses. No props:
   a barbell press is a bare barbell, and _s3d_props.js places a seat and back pad for the seated
   clips only. */
async function render() {
  const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const PORT = 9369, TMP = '_gifwork';
  fs.mkdirSync(TMP, { recursive: true });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--force-device-scale-factor=1', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + process.cwd() + '\\' + TMP + '\\p_press', 'about:blank'], { stdio: 'ignore' });
  let ws = null, id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method: m, params: p || {} }));
  });
  try {
    for (let i = 0; i < 120; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
        const pg = list.find(t => t.type === 'page');
        if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; }
      } catch (e) {}
      await sleep(250);
    }
    if (!ws) throw new Error('no CDP target');
    await new Promise(r => ws.addEventListener('open', r));
    const errors = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate', { url: 'file:///' + process.cwd().replace(/\\/g, '/') + '/_s3d_view.html' });
    await sleep(2600);

    const inject = '(function(){return new Promise(function(res){' +
      'var s=document.createElement("script");s.src="_s3d_clip_press.js";' +
      's.onload=function(){res(window.__build=function(o){return S3DVIEW.build(o);});};' +
      'document.head.appendChild(s);});})()';
    const r = await send('Runtime.evaluate', { expression: inject, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('inject failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));

    async function sheet(query, out) {
      const built = await send('Runtime.evaluate', {
        expression: 'JSON.stringify(__build(' + query + '))', awaitPromise: true, returnByValue: true
      });
      if (built.exceptionDetails) throw new Error('build failed: ' + JSON.stringify(built.exceptionDetails).slice(0, 400));
      const size = JSON.parse(built.result.value);
      await send('Emulation.setDeviceMetricsOverride', {
        width: Math.ceil(size.w), height: Math.ceil(size.h), deviceScaleFactor: 1, mobile: false });
      await sleep(1500);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
      console.log('  wrote ' + out + '   ' + Math.ceil(size.w) + 'x' + Math.ceil(size.h));
    }

    await sheet('{mode:"filmstrip",clips:"press",frames:11,cell:190,view:"persp",yaw:30,pitch:8,dist:430}',
                '_press_filmstrip.png');
    await sheet('{mode:"filmstrip",clips:"press",frames:11,cell:190,view:"side",dist:430}',
                '_press_side.png');
    await sheet('{mode:"filmstrip",clips:"press",frames:3,cell:440,view:"persp",yaw:30,pitch:8,dist:430,skeleton:1}',
                '_press_extremes.png');
    await sheet('{mode:"filmstrip",clips:"press",frames:3,cell:440,view:"front"}',
                '_press_front.png');
    console.log('  page errors: ' + (errors.length ? errors.slice(0, 3).join(' | ') : 'none'));
  } finally {
    try { chrome.kill(); } catch (e) {}
    await sleep(900);
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(TMP + '/p_press', { recursive: true, force: true }); break; } catch (e) { await sleep(400); }
    }
  }
}