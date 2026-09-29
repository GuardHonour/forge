/* _check_clip_squat.cjs — verification for _s3d_clip_squat.js (barbell back squat).

   Six checks, in the order the brief lists them:
     1. loads in node and registers S3D.CLIPS['squat'] + S3D.MEASURED['squat']
     2. keys sit at exactly the app's four phase boundaries (1e-9)
     3. the four MEASURED numbers are reproduced at the key times (tolerance +/- 2 deg)
     4. smooth motion: no NaN, no frame-to-frame jump > 15 deg, monotonic within each phase
     5. NEGATIVE CONTROL — the same assertions, run against deliberately broken copies
     6. render in headless Chrome and LOOK at it (--shot)

   It also asserts the two bar invariants the task named: the bar is LEVEL and SQUARE, and the grip
   width is CONSTANT across the rep. Those are printed as raw numbers, not just pass/fail.

   Every angle is computed from `ev.fk.p` — the posed WORLD POSITIONS — never from the rotations the
   clip authored. The rotations are the input; the angles are the thing being measured. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const S3D = require('./_s3d_core.js');

const NAME = 'squat';
const D = 180 / Math.PI;
let checks = 0, fails = 0;
function ok(cond, msg, detail) {
  checks++;
  if (!cond) fails++;
  console.log('  ' + (cond ? 'ok  ' : 'FAIL') + '  ' + msg + (detail !== undefined ? '   [' + detail + ']' : ''));
}

/* ---- the reference numbers, typed here rather than read from the clip: a clip must not be able to
   pass by editing its own target. These are the measured truth from the task prompt. ---- */
const TARGET = { kneeTop: 176.8, kneeBot: 66.7, hipTop: 172.7, hipBot: 70.4, tol: 2.0 };
const KEY_T = [0, 1.5, 1.82, 2.82, 3.14];

function ang(P, a, b, c) {
  const u = S3D.sub(P[a], P[b]), v = S3D.sub(P[c], P[b]);
  const lu = S3D.len(u), lv = S3D.len(v);
  if (!(lu > 1e-9) || !(lv > 1e-9)) return NaN;
  return Math.acos(Math.max(-1, Math.min(1, S3D.dot(u, v) / (lu * lv)))) * D;
}
const kneeOf = P => ang(P, 'hipL', 'kneeL', 'ankleL');
const hipOf = P => ang(P, 'chest', 'hipL', 'kneeL');
const elbowOf = P => ang(P, 'shL', 'elbL', 'wrL');

/* ------------------------------------------------------------------ 1. load */
console.log('=== 1. load ==============================================================');
let mod = null, loadErr = null;
try { mod = require('./_s3d_clip_squat.js'); } catch (e) { loadErr = e; }
const CLIP = S3D.CLIPS[NAME];
ok(!loadErr, "require('./_s3d_clip_squat.js') succeeds", loadErr ? loadErr.message : 'ok');
ok(!!CLIP, "S3D.CLIPS['" + NAME + "'] is registered",
   CLIP ? CLIP.name + ', ' + CLIP.duration + ' s, ' + CLIP.keys.length + ' keys' : 'MISSING');
ok(!!(S3D.MEASURED && S3D.MEASURED[NAME]), "S3D.MEASURED['" + NAME + "'] records the provenance",
   S3D.MEASURED && S3D.MEASURED[NAME] ? S3D.MEASURED[NAME].source + ' / ' + S3D.MEASURED[NAME].licence : 'MISSING');
ok(!!(S3D.MEASURED && S3D.MEASURED[NAME] && /commons_squat\.webm/.test(S3D.MEASURED[NAME].source)),
   'the source string names the reference file it was measured from',
   S3D.MEASURED && S3D.MEASURED[NAME] && S3D.MEASURED[NAME].source);
ok(/CC BY 3\.0/.test((S3D.MEASURED[NAME] || {}).licence || ''), 'the licence is the real one (CC BY 3.0)',
   (S3D.MEASURED[NAME] || {}).licence);
if (!CLIP) { console.log('\nRESULT: FAIL (no clip to check)'); process.exit(1); }

const ch = S3D.buildCharacter();

/* ------------------------------------------------------------------ 2. key times */
console.log('\n=== 2. key times =========================================================');
const ts = CLIP.keys.map(k => +k.t);
ok(ts.length === KEY_T.length, 'exactly ' + KEY_T.length + ' keys', ts.join(', '));
KEY_T.forEach(t => {
  const hit = ts.some(x => Math.abs(x - t) < 1e-9);
  const near = ts.reduce((b, x) => Math.abs(x - t) < Math.abs(b - t) ? x : b, ts[0]);
  ok(hit, 'a key sits at t = ' + t + ' s within 1e-9', 'nearest ' + near + ' (delta ' + Math.abs(near - t).toExponential(1) + ')');
});
ok(Math.abs(CLIP.duration - 3.14) < 1e-9, 'duration is exactly 3.14 s so the app HUD names the right phase',
   CLIP.duration);

/* ------------------------------------------------------------------ 3. the measured extremes */
console.log('\n=== 3. measured extremes (tolerance +/- ' + TARGET.tol + ' deg) ================');
const at = t => S3D.sample(ch, NAME, t).fk.p;
const P0 = at(0), P15 = at(1.5), P182 = at(1.82), P282 = at(2.82), P314 = at(3.14);

function cmp(label, got, want) {
  const d = got - want;
  ok(Math.abs(d) <= TARGET.tol, label + ': measured ' + got.toFixed(2) + ' deg vs target ' + want +
     ' -> delta ' + (d >= 0 ? '+' : '') + d.toFixed(2), 'within +/-' + TARGET.tol);
}
cmp('knee interior angle at t=0 (home, standing)', kneeOf(P0), TARGET.kneeTop);
cmp('knee interior angle at t=1.5 (away, bottom)', kneeOf(P15), TARGET.kneeBot);
cmp('hip  interior angle at t=0 (home, standing)', hipOf(P0), TARGET.hipTop);
cmp('hip  interior angle at t=1.5 (away, bottom)', hipOf(P15), TARGET.hipBot);
/* the holds must be IDENTICAL poses, or phase 2 and phase 4 are not holds at all */
ok(Math.abs(kneeOf(P15) - kneeOf(P182)) < 1e-9 && Math.abs(hipOf(P15) - hipOf(P182)) < 1e-9,
   'phase 2 is a true hold (t=1.5 and t=1.82 are the same pose)');
ok(Math.abs(kneeOf(P0) - kneeOf(P282)) < 1e-9 && Math.abs(kneeOf(P0) - kneeOf(P314)) < 1e-9,
   'phase 4 is a true hold (t=0, 2.82 and 3.14 are the same pose)');
ok(kneeOf(P0) > kneeOf(P15), 'phase 1 runs home -> away, so the knee FLEXES (the eccentric), not extends',
   kneeOf(P0).toFixed(1) + ' -> ' + kneeOf(P15).toFixed(1));

/* ---- the measured numbers the pose was BUILT from, and the one it deliberately is not ---- */
console.log('\n=== 3b. the rest of the measured record =================================');
/* The thigh's elevation from straight up. The reference records it under the name
   `thigh_from_vertical_deg`, but its own values (173.7 standing) are elevations from UP, not tilts
   from vertical, so that is how both this check and the clip read it. */
const thighUp = P => {
  const v = S3D.sub(P.kneeL, P.hipL);
  return Math.acos(Math.max(-1, Math.min(1, v[1] / S3D.len(v)))) * 180 / Math.PI;
};
console.log('  thigh elevation from UP — measured ' + thighUp(P0).toFixed(2) + ' deg standing (reference 173.7, delta ' +
            (thighUp(P0) - 173.7).toFixed(2) + '), ' + thighUp(P15).toFixed(2) + ' at the bottom (reference 91.7, delta ' +
            (thighUp(P15) - 91.7).toFixed(2) + ')');
ok(Math.abs(thighUp(P0) - 173.7) <= TARGET.tol && Math.abs(thighUp(P15) - 91.7) <= TARGET.tol,
   'both recorded thigh angles are reproduced within +/-' + TARGET.tol + ' deg — and neither was typed in');

/* THE ANCHOR ARGUMENT, recomputed here rather than trusted from the clip's comment. The knee angle
   fixes only the hip-to-ankle DISTANCE; the thigh angle then picks the point on that circle. The two
   recorded angles must therefore imply the same distance, or one of them is not measurements of the
   same rep. */
const L1 = S3D.vdist(S3D.buildSkeleton().rest.kneeL, S3D.buildSkeleton().rest.hipL);
const L2 = S3D.vdist(S3D.buildSkeleton().rest.ankleL, S3D.buildSkeleton().rest.kneeL);
const rad = 66.7 * Math.PI / 180, trad = 91.7 * Math.PI / 180;
const reachFromKnee = Math.sqrt(L1 * L1 + L2 * L2 - 2 * L1 * L2 * Math.cos(rad));
const phi = trad + Math.PI - rad;
const reachFromBoth = Math.hypot(L1 * Math.cos(trad) + L2 * Math.cos(phi), L1 * Math.sin(trad) + L2 * Math.sin(phi));
console.log('  hip-ankle reach implied by knee 66.7 alone            : ' + reachFromKnee.toFixed(4) + ' units');
console.log('  hip-ankle reach implied by knee 66.7 AND thigh 91.7   : ' + reachFromBoth.toFixed(4) + ' units');
console.log('  agreement                                             : ' + Math.abs(reachFromKnee - reachFromBoth).toFixed(4) +
            ' units (' + (Math.abs(reachFromKnee - reachFromBoth) * 1.467 / 100).toFixed(5) + ' m)');
ok(Math.abs(reachFromKnee - reachFromBoth) < 0.01,
   'the reference\'s two recorded ANGLES are mutually consistent, so they can pick the pelvis position');
/* The hip's height above the ankle is the vertical component of (hip -> ankle) = L1*cos(thigh) +
   L2*cos(shin), negated because that vector points DOWN. The descent is what is left of the
   standing hip height above the ankle. */
const hipAboveAnkle = -(L1 * Math.cos(trad) + L2 * Math.cos(phi));
const descentFromAngles = (71.18 - 9) - hipAboveAnkle;
console.log('  the two angles put the hip ' + hipAboveAnkle.toFixed(1) + ' units above the ankle, i.e. a descent of ' +
            descentFromAngles.toFixed(1) + ' units = ' + (descentFromAngles / 68.1667).toFixed(3) + ' m');
console.log('  the recorded hip_travel_m implies            : ' + (0.567 * 68.1667).toFixed(1) + ' units = 0.567 m');
ok(0.567 * 68.1667 > descentFromAngles + 1,
   'the recorded DISTANCE is inconsistent with both recorded angles (it buries the hip deeper than the ' +
   'angles permit), which is why it is not used to build the pose',
   (0.567 * 68.1667).toFixed(1) + ' vs ' + descentFromAngles.toFixed(1) + ' units');

/* THE CONVENTION QUESTION. The brief (and the shared grader) measure the hip at `hipL` between
   (hipL -> chest) and (hipL -> kneeL). The reference measured it as the angle between the TORSO
   direction (hips -> chest, i.e. the spine AXIS, not a vector from the pelvis centre to the knee) and
   the THIGH direction (hipL -> kneeL). If those disagreed on this rig the clip could satisfy one and
   not the other, so the disagreement is MEASURED here rather than assumed away. */
const refHip = P => ang(P, 'chest', 'hips', 'kneeL');   /* same three points as the reference's torso axis... */
const refHipAxis = P => {                               /* ...but with the THIGH direction, not hips->knee */
  const t = S3D.sub(P.chest, P.hips), g = S3D.sub(P.kneeL, P.hipL);
  return Math.acos(Math.max(-1, Math.min(1, S3D.dot(t, g) / (S3D.len(t) * S3D.len(g))))) * 180 / Math.PI;
};
console.log('  hip in the reference\'s own convention (spine axis vs thigh direction): ' +
            refHipAxis(P0).toFixed(2) + ' standing (measured 172.7), ' + refHipAxis(P15).toFixed(2) +
            ' at the bottom (measured 70.4)');
ok(Math.abs(refHipAxis(P0) - 172.7) <= TARGET.tol && Math.abs(refHipAxis(P15) - 70.4) <= TARGET.tol,
   'the pose satisfies the reference\'s OWN hip convention too, so the two definitions do not conflict here',
   'worst delta ' + Math.max(Math.abs(refHipAxis(P0) - 172.7), Math.abs(refHipAxis(P15) - 70.4)).toFixed(2));
console.log('  (the nearby but different "pelvis centre -> knee" angle would read ' + refHip(P0).toFixed(2) + '/' +
            refHip(P15).toFixed(2) + '; it is NOT what the reference computed, because it mixes the pelvis\'s own width into a hip angle)');
const torsoLean = P => Math.acos((P.chest[1] - P.hips[1]) / S3D.vdist(P.chest, P.hips)) * 180 / Math.PI;
console.log('  actual lean of the spine axis off vertical: ' + torsoLean(P0).toFixed(2) + ' standing, ' +
            torsoLean(P15).toFixed(2) + ' at the bottom (a plausible deep-squat trunk angle)');

/* THE STANCE DEVIATION, measured rather than asserted. The brief asks for the REST foot position;
   this shows what that costs, which is why the stance was solved instead. */
const restKey = JSON.parse(JSON.stringify(CLIP));
restKey.name = 'squat_reststance';
[TARGET.hipTop, TARGET.hipBot].forEach(() => {});
restKey.keys.forEach(k => {
  k.ik = { legL: { t: [8, 9, 0], pole: [8, 9, 70], level: 'toeL' },
           legR: { t: [-8, 9, 0], pole: [-8, 9, 70], level: 'toeR' } };
});
S3D.CLIPS[restKey.name] = restKey;
const Pr = S3D.sample(ch, restKey.name, 0).fk.p;
console.log('  with the rig\'s REST foot targets instead, the standing pose gives knee ' + kneeOf(Pr).toFixed(2) +
            ' (measured 176.8, MISS ' + (kneeOf(Pr) - TARGET.kneeTop).toFixed(2) + ' deg) and hip ' + hipOf(Pr).toFixed(2) +
            ' (measured 172.7, miss ' + (hipOf(Pr) - TARGET.hipTop).toFixed(2) + ' deg)');
ok(Math.abs(kneeOf(Pr) - TARGET.kneeTop) > TARGET.tol,
   'the rig\'s REST foot position CANNOT reach the measured knee angle — this is why the stance is solved, ' +
   'not a stylistic choice');
const hipAnkleRest = S3D.vdist(Pr.hipL, Pr.ankleL), maxReach = (function () {
  const sk = S3D.buildSkeleton();
  return S3D.vdist(sk.rest.kneeL, sk.rest.hipL) + S3D.vdist(sk.rest.ankleL, sk.rest.kneeL);
})();
console.log('  at that stance the hip-to-ankle distance is ' + hipAnkleRest.toFixed(2) + ' of a maximum reach of ' +
            maxReach.toFixed(2) + ' units = ' + (100 * hipAnkleRest / maxReach).toFixed(1) + '% extended — a 176.8 deg knee IS a straight leg');
delete S3D.CLIPS[restKey.name];

/* ------------------------------------------------------------------ feet planted */
console.log('\n=== feet planted, and the bar invariants =================================');
let maxAnkleDrift = 0, maxToeDrift = 0;
let minG = Infinity, maxG = -Infinity, maxLvl = 0, maxSq = 0, maxAsym = 0;
const GRIP = [];
for (let i = 0; i <= 80; i++) {
  const t = 3.14 * i / 80, P = at(t);
  maxAnkleDrift = Math.max(maxAnkleDrift, S3D.vdist(P.ankleL, P0.ankleL), S3D.vdist(P.ankleR, P0.ankleR));
  maxToeDrift = Math.max(maxToeDrift, S3D.vdist(P.toeL, P0.toeL));
  const g = S3D.vdist(P.wrL, P.wrR);
  minG = Math.min(minG, g); maxG = Math.max(maxG, g);
  maxLvl = Math.max(maxLvl, Math.abs(P.wrL[1] - P.wrR[1]));
  maxSq = Math.max(maxSq, Math.abs(P.wrL[2] - P.wrR[2]));
  maxAsym = Math.max(maxAsym, Math.abs(P.wrL[0] + P.wrR[0]));
  if (i % 10 === 0) GRIP.push(t.toFixed(2) + ':' + g.toFixed(4));
}
ok(maxAnkleDrift < 1e-9, 'the ankle targets never move: the feet are PLANTED (worst drift ' +
   maxAnkleDrift.toExponential(1) + ' units)');
ok(maxToeDrift < 1e-9, 'the toes are held level and never slide (worst drift ' + maxToeDrift.toExponential(1) + ')');
console.log('  bar invariant 1 — LEVEL and SQUARE:');
console.log('      worst |wrL.y - wrR.y| = ' + maxLvl.toExponential(3) + ' units');
console.log('      worst |wrL.z - wrR.z| = ' + maxSq.toExponential(3) + ' units');
console.log('      worst |wrL.x + wrR.x| = ' + maxAsym.toExponential(3) + ' units');
console.log('  bar invariant 2 — the grip cannot stretch:');
console.log('      |wrL - wrR| over 81 frames: min ' + minG.toFixed(6) + ', max ' + maxG.toFixed(6) +
            ', delta ' + (maxG - minG).toExponential(3) + ' units');
console.log('      (' + GRIP.join('  ') + ')');
ok(maxLvl < 1e-9 && maxSq < 1e-9, 'the bar is level and square at every frame');
ok(maxAsym < 1e-9, 'the grip is mirror-symmetric (wrL.x = -wrR.x)');
ok(maxG - minG < 1e-9, 'the grip width is CONSTANT — delta ' + (maxG - minG).toExponential(3) +
   ' units, i.e. the bar is rigid');

/* no frame needs the IK clamp: a clamped frame is a foot that has left its target */
let clamped = 0, worstOver = 0;
for (let i = 0; i <= 200; i++) {
  const ev = S3D.sample(ch, NAME, 3.14 * i / 200);
  if (ev.ik.clamped) { clamped++; worstOver = Math.max(worstOver, ev.ik.worst ? ev.ik.worst.over : 0); }
}
ok(clamped === 0, 'no frame out of 201 needs the reach clamp (the legs are never over-extended)',
   clamped ? clamped + ' clamped, worst over ' + worstOver.toFixed(3) : 'none');

/* the authored arm pose, reported so it is legible rather than buried */
console.log('  AUTHORED arm pose at t=0 (not measured — nothing in the reference constrains it):');
console.log('      shoulder ' + P0.shL.map(x => x.toFixed(2)).join(', ') +
            '   elbow ' + P0.elbL.map(x => x.toFixed(2)).join(', ') +
            '   wrist ' + P0.wrL.map(x => x.toFixed(2)).join(', '));
console.log('      elbow interior angle ' + elbowOf(P0).toFixed(1) + ' deg; wrist is ' +
            S3D.sub(P0.wrL, P0.shL).map(x => x.toFixed(2)).join(', ') + ' from the shoulder (x,y,z)');
console.log('      grip width ' + minG.toFixed(2) + ' units = ' + (minG / mod.solved.units_per_metre).toFixed(3) + ' m');

/* ------------------------------------------------------------------ 4. smoothness */
console.log('\n=== 4. smooth motion =====================================================');
const N = 60;
let nan = 0, worstJump = 0, worstAt = 0;
const arc = [];
for (let i = 0; i <= N; i++) {
  const t = 3.14 * i / N, P = at(t);
  const k = kneeOf(P), h = hipOf(P);
  if (!isFinite(k) || !isFinite(h)) nan++;
  arc.push({ t: t, k: k, h: h });
}
for (let i = 1; i < arc.length; i++) {
  const j = Math.abs(arc[i].k - arc[i - 1].k);
  if (j > worstJump) { worstJump = j; worstAt = arc[i].t; }
}
ok(nan === 0, 'no non-finite angle across ' + (N + 1) + ' frames');
ok(worstJump < 15, 'no frame-to-frame knee jump above 15 deg (worst ' + worstJump.toFixed(2) +
   ' deg at t=' + worstAt.toFixed(3) + ')');

/* monotonic inside each phase: the knee must only flex through phase 1 and only extend through
   phase 3. Sampled densely INSIDE the phases so the two holds are not counted as direction changes. */
function monotone(from, to, wantFalling) {
  let worst = 0, worstT = 0, prev = null;
  for (let i = 0; i <= 40; i++) {
    const tt = from + (to - from) * i / 40, k = kneeOf(at(tt));
    if (prev !== null) {
      const d = k - prev;
      const bad = wantFalling ? Math.max(0, d) : Math.max(0, -d);
      if (bad > worst) { worst = bad; worstT = tt; }
    }
    prev = k;
  }
  return { worst: worst, at: worstT };
}
const ph1 = monotone(0, 1.5, true), ph3 = monotone(1.82, 2.82, false);
ok(ph1.worst < 0.05, 'phase 1 is monotonic (knee only flexes; worst reversal ' + ph1.worst.toFixed(4) +
   ' deg at t=' + ph1.at.toFixed(2) + ')');
ok(ph3.worst < 0.05, 'phase 3 is monotonic (knee only extends; worst reversal ' + ph3.worst.toFixed(4) +
   ' deg at t=' + ph3.at.toFixed(2) + ')');
console.log('  knee arc (deg) at t = ' + arc.filter((_, i) => i % 6 === 0).map(a => a.t.toFixed(2) + ':' + a.k.toFixed(1)).join('  '));
console.log('  hip  arc (deg) at t = ' + arc.filter((_, i) => i % 6 === 0).map(a => a.t.toFixed(1) + ':' + a.h.toFixed(1)).join('  '));

/* ------------------------------------------------------------------ 5. negative control */
console.log('\n=== 5. NEGATIVE CONTROL ==================================================');
/* A check that cannot fail proves nothing. Each control registers a deliberately broken COPY under
   a NEW name — never an in-place edit, which would be ignored by any caching in sample(). */
function clone(name) { const c = JSON.parse(JSON.stringify(CLIP)); c.name = name; return c; }
function measure(name) {
  const A = S3D.sample(ch, name, 0).fk.p, B = S3D.sample(ch, name, 1.5).fk.p;
  let min = Infinity, max = -Infinity, lvl = 0;
  for (let i = 0; i <= 40; i++) {
    const P = S3D.sample(ch, name, 3.14 * i / 40).fk.p;
    const g = S3D.vdist(P.wrL, P.wrR); min = Math.min(min, g); max = Math.max(max, g);
    lvl = Math.max(lvl, Math.abs(P.wrL[1] - P.wrR[1]));
  }
  return { kt: kneeOf(A), kb: kneeOf(B), ht: hipOf(A), hb: hipOf(B), min: min, max: max, lvl: lvl };
}
const base = measure(NAME);
console.log('  baseline  knee ' + base.kt.toFixed(2) + '/' + base.kb.toFixed(2) +
            '  hip ' + base.ht.toFixed(2) + '/' + base.hb.toFixed(2) +
            '  grip delta ' + (base.max - base.min).toExponential(2) + '  level ' + base.lvl.toExponential(2));

/* NC1 — swap home and away: every angle still present, everything still smooth, the rep runs backwards */
const nc1 = clone('squat_nc1');
const k0 = nc1.keys[0], k1 = nc1.keys[1];
nc1.keys[0] = Object.assign({}, k1, { t: k0.t });
nc1.keys[1] = Object.assign({}, k0, { t: k1.t });
S3D.CLIPS[nc1.name] = nc1;
const m1 = measure('squat_nc1');
ok(!(m1.kt > m1.kb), 'NC1 (home/away exchanged) FAILS the direction check',
   'knee now ' + m1.kt.toFixed(1) + ' -> ' + m1.kb.toFixed(1));
ok(!(Math.abs(m1.kt - TARGET.kneeTop) <= TARGET.tol), 'NC1 FAILS the home-vs-target check',
   'home knee ' + m1.kt.toFixed(1) + ' vs ' + TARGET.kneeTop);
delete S3D.CLIPS[nc1.name];

/* NC2 — tilt ONE arm by 25 deg on one key: a rigid bar cannot stay level */
const nc2 = clone('squat_nc2');
nc2.keys[1].p.shL = S3D.qA([1, 0, 0], 25);
S3D.CLIPS[nc2.name] = nc2;
const m2 = measure('squat_nc2');
ok(m2.lvl > 0.5, 'NC2 (one arm tilted 25 deg) FAILS the bar-level check',
   'worst |wrL.y - wrR.y| ' + m2.lvl.toFixed(2) + ' units vs a 0.5 threshold');
delete S3D.CLIPS[nc2.name];

/* NC3 — slide a foot: move one leg target on one key, as if the lifter's foot had crept */
const nc3 = clone('squat_nc3');
nc3.keys[1].ik.legL = { t: [15.26, 9, 2.0], pole: [15.26, 9, 70], level: 'toeL' };
S3D.CLIPS[nc3.name] = nc3;
let drift3 = 0;
const a0 = S3D.sample(ch, 'squat_nc3', 0).fk.p;
for (let i = 0; i <= 40; i++) drift3 = Math.max(drift3, S3D.vdist(S3D.sample(ch, 'squat_nc3', 3.14 * i / 40).fk.p.ankleL, a0.ankleL));
ok(drift3 > 0.5, 'NC3 (a leg target moved 2 units between keys) FAILS the planted-feet check',
   'worst ankle drift ' + drift3.toFixed(2) + ' units vs the 1e-9 the real clip holds');
delete S3D.CLIPS[nc3.name];

/* NC4 — move a key time off the tempo by 1e-7 s: the HUD would name the wrong phase */
const nc4 = clone('squat_nc4');
nc4.keys[1].t = 1.5 + 1e-7;
const t4 = nc4.keys.map(k => +k.t);
ok(!KEY_T.every(t => t4.some(x => Math.abs(x - t) < 1e-9)),
   'NC4 (a key moved by 1e-7 s) FAILS the key-time check',
   'delta ' + Math.abs(nc4.keys[1].t - 1.5).toExponential(1));

/* NC5 — perturb the SOLVED stance by 3 units: the hip angle at the top must leave tolerance */
const nc5 = clone('squat_nc5');
nc5.keys[0].ik.legL = { t: [18.26, 9, 0], pole: [18.26, 9, 70], level: 'toeL' };
nc5.keys[0].ik.legR = { t: [-18.26, 9, 0], pole: [-18.26, 9, 70], level: 'toeR' };
S3D.CLIPS[nc5.name] = nc5;
const m5 = measure('squat_nc5');
console.log('  NC5 stance widened 3 units -> home knee ' + m5.kt.toFixed(2) + ', home hip ' + m5.ht.toFixed(2));
ok(Math.abs(m5.ht - TARGET.hipTop) > TARGET.tol,
   'NC5 (stance widened by 3 units) FAILS the standing hip check — the solve is load-bearing, not decoration',
   'home hip ' + m5.ht.toFixed(2) + ' vs ' + TARGET.hipTop);
delete S3D.CLIPS[nc5.name];

/* NC6 — perturb the SOLVED torso lean at the bottom: the bottom hip angle must leave tolerance */
const nc6 = clone('squat_nc6');
nc6.keys[1].p.spine = S3D.qA([1, 0, 0], mod.solved.lean_deg + 8);
S3D.CLIPS[nc6.name] = nc6;
const m6 = measure('squat_nc6');
console.log('  NC6 torso lean +8 deg -> bottom knee ' + m6.kb.toFixed(2) + ', bottom hip ' + m6.hb.toFixed(2));
ok(Math.abs(m6.hb - TARGET.hipBot) > TARGET.tol,
   'NC6 (torso lean perturbed 8 deg) FAILS the bottom hip check',
   'bottom hip ' + m6.hb.toFixed(2) + ' vs ' + TARGET.hipBot);
delete S3D.CLIPS[nc6.name];

/* and the baseline must still be intact after all that */
const after = measure(NAME);
ok(Math.abs(after.kt - base.kt) < 1e-12 && Math.abs(after.ht - base.ht) < 1e-12,
   'the controls left the real clip untouched');

/* ------------------------------------------------------------------ 6. render */
console.log('\n=== 6. render ============================================================');
if (process.argv.includes('--shot')) {
  render().then(finish).catch(e => { console.log('  RENDER FAILED: ' + e.message); fails++; finish(); });
} else {
  console.log('  (render skipped: pass --shot)');
  finish();
}

function finish() {
  console.log('\n=== result ===============================================================');
  console.log(checks + ' assertions, ' + fails + ' failed  ->  ' + (fails ? 'FAIL' : 'PASS'));
  process.exitCode = fails ? 1 : 0;
}

/* Headless-Chrome render of this ONE clip. _s3d_view.html loads no clip file and no props, so both
   are injected after load and the sheet is rebuilt — same viewer, same renderer, same props
   _s3d_app.js uses, so what is inspected here is what the app draws (a real 2.20 m bar through the
   two wrists). */
async function render() {
  const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const PORT = 9368, TMP = '_gifwork';
  fs.mkdirSync(TMP, { recursive: true });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--force-device-scale-factor=1', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(process.cwd(), TMP, 'p_squat'), 'about:blank'], { stdio: 'ignore' });
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
      } catch (e) { /* not up yet */ }
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
      'var s=document.createElement("script");s.src="_s3d_props.js";' +
      's.onload=function(){var s2=document.createElement("script");s2.src="_s3d_clip_squat.js";' +
      's2.onload=function(){var PR=window.S3D_PROPS,ch=window.ch,R=window.S3D_RENDER;' +
      'var G=PR.build(ch),orig=R.drawCell;' +
      'R.drawCell=function(ctx,x,y,cell,ev,cam,opts){opts=opts||{};' +
      'try{opts.props=PR.frame(G,ch,window.S3D,ev,"squat",window.S3D.sample);}catch(e){}' +
      'return orig(ctx,x,y,cell,ev,cam,opts);};' +
      'res(window.__build=function(o){return S3DVIEW.build(o);});};' +
      'document.head.appendChild(s2);};document.head.appendChild(s);});})()';
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

    /* the whole arc from the app's own default camera */
    await sheet('{mode:"filmstrip",clips:"squat",frames:11,cell:190,view:"persp",yaw:30,pitch:8,dist:430}',
                '_squat_filmstrip.png');
    /* the sagittal plane — the view in which a knee bending the wrong way is unmistakable */
    await sheet('{mode:"filmstrip",clips:"squat",frames:11,cell:190,view:"side",dist:430}',
                '_squat_side.png');
    /* the two extremes large, side view, skeleton drawn */
    await sheet('{mode:"filmstrip",clips:"squat",frames:3,cell:480,view:"side",skeleton:1}',
                '_squat_extremes.png');
    /* FROM ABOVE: the bar must be square to the shoulders, the knees must track OUT over the feet
       rather than collapsing inward — neither is visible in any other view. */
    await sheet('{mode:"filmstrip",clips:"squat",frames:3,cell:380,view:"top"}',
                '_squat_top.png');
    /* FRONT, zoomed on the upper body: the view in which the racked bar, the grip and the elbows
       are legible — and in which an arm sunk into the ribs would show. */
    await sheet('{mode:"filmstrip",clips:"squat",frames:3,cell:420,view:"persp",yaw:0,pitch:4,dist:250,skeleton:1}',
                '_squat_front.png');
    /* REAR 3/4, zoomed: the bar sits ON the upper back and the elbows hang behind it. */
    await sheet('{mode:"filmstrip",clips:"squat",frames:3,cell:420,view:"persp",yaw:150,pitch:14,dist:250,skeleton:1}',
                '_squat_rear.png');
    console.log('  page errors: ' + (errors.length ? errors.slice(0, 3).join(' | ') : 'none'));
  } finally {
    try { chrome.kill(); } catch (e) {}
    await sleep(900);
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(path.join(TMP, 'p_squat'), { recursive: true, force: true }); break; } catch (e) { await sleep(400); }
    }
  }
}
