/* _check_clips_all.cjs — independent verification of every measured clip.

   WHY THIS EXISTS SEPARATELY FROM EACH CLIP'S OWN CHECK
   Each clip file ships a `_check_clip_<name>.cjs` written by whoever authored it. Those are useful
   but they are the author marking their own work, and they were written alongside the clip, so they
   tend to encode the same misunderstanding twice. This script re-derives everything from scratch:

   - it recomputes every joint angle from `ev.fk.p` (the posed WORLD POSITIONS), never from the
     rotations the clip authored, and never by reading a number the clip reports about itself;
   - it compares against the REFERENCE numbers hardcoded here, taken from the measured records, so a
     clip cannot pass by having quietly redefined its own target;
   - it checks the properties a plausible-looking wrong clip would still satisfy — direction of
     travel, the bar invariants, phase alignment, smoothness.

   THE TRAP THIS IS BUILT AROUND
   `_s3d_core.js` ships SANDBOX clips of its own, one of them also called `squat`. That clip is
   smooth, anatomically plausible, and NOT the measured squat — measured against the reference, its
   hip reaches 110.9 deg at the bottom where the reference reaches 70.4. A "verification" that only
   asked whether a clip named `squat` exists and animates would pass it. So this script requires the
   measured record, exactly as the app does, and then asserts outright that the sandbox clip FAILS
   the measured targets — if it ever passed, this check could not tell measured motion from invented
   motion, which is the one thing it exists to do.

   The other worst failure is a clip that runs BACKWARDS: every angle present, everything smooth,
   the figure moving convincingly through the rep in the wrong direction. `home` is the
   shortened-muscle position, so the primary joint angle must be LARGER at home (t=0) than at away
   (t=1.5). Asserted per clip, and the negative control proves the assertion can fail.
*/
'use strict';
const S3D = require('./_s3d_core.js');

/* Snapshot the core's sandbox squat BEFORE the measured clips load and overwrite it under that name. */
const SANDBOX_SQUAT = S3D.CLIPS.squat ? JSON.parse(JSON.stringify(S3D.CLIPS.squat)) : null;

/* Load the measured clips (their own modules register onto S3D.CLIPS and S3D.MEASURED). */
try { require('./_s3d_clips_measured.js'); } catch (e) { console.log('note: could not load the clip set: ' + e.message); }

/* The measured reference values. These are the anchors: absolute, external numbers that the clips
   must reproduce. Deliberately duplicated here rather than read from the clip files, so that a clip
   editing its own target cannot edit this check. */
const SPEC = {
  squat:        { joint: 'knee',  home: 176.8, away: 66.7,  tol: 2,
                  hip: { home: 172.7, away: 70.4 }, bar: true,
                  note: 'Commons commons_squat.webm, CC BY 3.0, FitnessScape' },
  press:        { joint: 'elbow', home: 163.7, away: null,  tol: 2,
                  wristAboveShoulder: 43.9, bar: true,
                  note: 'YouTube CC-BY "Barbell Shoulder Press - Military Press - Best Barbells"' },
  legext:       { joint: 'knee',  home: 162.8, away: 108.7, tol: 2, seated: true,
                  note: 'CDC exercise video, public domain' },
  machinepress: { joint: 'elbow', home: 130.5, away: 86.4,  tol: 2, seated: true,
                  reach: { home: 41.6, away: 31.4 },
                  note: 'CDC chest press video, public domain' }
};

/* Tempo: the app derives its phase label from its own 3140 ms clock, so the keys must sit here. */
const KEY_T = [0, 1.5, 1.82, 2.82, 3.14];

const D = 180 / Math.PI;
function interior(P, a, b, c) {
  const u = S3D.sub(P[a], P[b]), v = S3D.sub(P[c], P[b]);
  const lu = S3D.len(u), lv = S3D.len(v);
  if (!(lu > 1e-9) || !(lv > 1e-9)) return NaN;
  return Math.acos(Math.max(-1, Math.min(1, S3D.dot(u, v) / (lu * lv)))) * D;
}
const kneeA = (P, s) => interior(P, 'hip' + s, 'knee' + s, 'ankle' + s);
const elbowA = (P, s) => interior(P, 'sh' + s, 'elb' + s, 'wr' + s);
const hipA = (P, s) => interior(P, 'chest', 'hip' + s, 'knee' + s);

let fails = 0, checked = 0;
const missing = [];
function ok(cond, msg) { checked++; if (!cond) { fails++; console.log('    FAIL: ' + msg); } else console.log('    ok   ' + msg); }

const ch = S3D.buildCharacter();
const results = {};

console.log('clip          joint   home(target)      away(target)     verdict');
console.log('---------------------------------------------------------------------------');
for (const name of Object.keys(SPEC)) {
  const spec = SPEC[name];
  const clip = S3D.CLIPS[name];
  const rec = (S3D.MEASURED && S3D.MEASURED[name]) || null;
  if (!clip || !rec) {
    missing.push(name + (clip ? ' (sandbox clip only; no measured targets recorded)' : ''));
    console.log(`  ${name.padEnd(13)} -      ${clip ? 'SANDBOX CLIP ONLY - not measured' : 'NOT REGISTERED'}`);
    continue;
  }
  const val = (ev) => spec.joint === 'knee' ? kneeA(ev.fk.p, 'L') : elbowA(ev.fk.p, 'L');
  const h = val(S3D.sample(ch, name, 0)), a = val(S3D.sample(ch, name, 1.5));
  const hOK = Math.abs(h - spec.home) <= spec.tol;
  const aOK = spec.away === null ? (a > 40 && a < 150) : Math.abs(a - spec.away) <= spec.tol;
  const dir = h > a;
  console.log(`  ${name.padEnd(13)} ${spec.joint.padEnd(7)} ${(h.toFixed(1) + ' (' + spec.home + ')').padEnd(18)} ` +
              `${(a.toFixed(1) + ' (' + (spec.away === null ? 'authored' : spec.away) + ')').padEnd(18)} ` +
              `${hOK && aOK && dir ? 'ok' : 'BAD'}`);
  results[name] = { h, a, hOK, aOK, dir, spec, clip, ch };
}

console.log('\nDETAIL');
for (const name of Object.keys(results)) {
  const r = results[name], spec = r.spec;
  console.log('  ' + name + '  (' + spec.note + ')');
  ok(r.hOK, `${name}: ${spec.joint} at home is ${r.h.toFixed(1)} vs measured ${spec.home} (tol ${spec.tol})`);
  if (spec.away !== null) ok(r.aOK, `${name}: ${spec.joint} at away is ${r.a.toFixed(1)} vs measured ${spec.away}`);
  else ok(r.aOK, `${name}: the AUTHORED racked elbow is ${r.a.toFixed(1)}, plausible for a rack (40-150)`);
  ok(r.dir, `${name}: phase 1 travels home -> away, so the angle DECREASES (${r.h.toFixed(1)} -> ${r.a.toFixed(1)}). ` +
             'Reversed here would mean the whole animation runs backwards while every number still looks right');

  if (spec.hip) {
    const hv = hipA(S3D.sample(ch, name, 0).fk.p, 'L'), av = hipA(S3D.sample(ch, name, 1.5).fk.p, 'L');
    ok(Math.abs(hv - spec.hip.home) <= spec.tol, `${name}: hip at home is ${hv.toFixed(1)} vs measured ${spec.hip.home}`);
    ok(Math.abs(av - spec.hip.away) <= spec.tol, `${name}: hip at away is ${av.toFixed(1)} vs measured ${spec.hip.away}`);
  }
  if (spec.wristAboveShoulder) {
    const P = S3D.sample(ch, name, 0).fk.p, d = P.wrL[1] - P.shL[1];
    ok(Math.abs(d - spec.wristAboveShoulder) <= 2,
       `${name}: wrist sits ${d.toFixed(1)} above the shoulder at lockout vs measured ${spec.wristAboveShoulder}`);
  }
  if (spec.reach) {
    /* THE REACH HAS A HARD CEILING, and checking it naively produces a false failure.
       A forward reach is the z-component of the shoulder->wrist vector, so it can never exceed that
       vector's LENGTH -- and the measured elbow angle fixes that length. With this rig's bones (upper
       arm 24, forearm 19.5) an elbow of 130.5 deg gives a chord of 39.55, so the reference's
       extension reach of 41.6 is unreachable. The reference's own two reach numbers imply a forearm
       of 21.8 units; this rig's is 19.5. Reaching 41.6 would need an elbow of 145.8 deg, i.e. giving
       up a MEASURED angle to satisfy a DERIVED distance. The clip correctly honours the angles.
       So the bound is applied here -- and REPORTED, because a quietly relaxed tolerance is exactly
       how a real miss hides. */
    const U = S3D.BONE.upper, F = S3D.BONE.fore;
    for (const pair of [[0, 'home'], [1.5, 'away']]) {
      const P = S3D.sample(ch, name, pair[0]).fk.p;
      const fwd = P.wrL[2] - P.shL[2], dh = Math.abs(P.wrL[1] - P.shL[1]);
      const el = elbowA(P, 'L');
      const chord = Math.sqrt(U * U + F * F - 2 * U * F * Math.cos(el / D));
      const eff = Math.min(spec.reach[pair[1]], chord);
      const bounded = eff < spec.reach[pair[1]] - 0.01;
      ok(Math.abs(fwd - eff) <= 2,
         `${name}: at ${pair[1]} the wrist is ${fwd.toFixed(1)} forward vs ` +
         (bounded ? `the RIG BOUND ${eff.toFixed(2)}` : `measured ${eff.toFixed(1)}`) +
         (bounded ? ` (target ${spec.reach[pair[1]]} is unreachable at elbow ${el.toFixed(1)} deg, whose ` +
                    `shoulder-to-wrist chord is only ${chord.toFixed(2)})` : ''));
      ok(dh <= 6, `${name}: at ${pair[1]} the wrist stays near shoulder height (${dh.toFixed(1)} off)`);
    }
  }
  if (spec.seated) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 40; i++) { const y = S3D.sample(ch, name, 3.14 * i / 40).fk.p.hips[1]; lo = Math.min(lo, y); hi = Math.max(hi, y); }
    ok(hi - lo < 6, `${name}: the pelvis stays put while seated (range ${(hi - lo).toFixed(2)} units)`);
  }
  if (spec.bar) {
    let maxLvl = 0, maxSq = 0, minG = Infinity, maxG = -Infinity;
    for (let i = 0; i <= 40; i++) {
      const P = S3D.sample(ch, name, 3.14 * i / 40).fk.p;
      maxLvl = Math.max(maxLvl, Math.abs(P.wrL[1] - P.wrR[1]));
      maxSq = Math.max(maxSq, Math.abs(P.wrL[2] - P.wrR[2]));
      const g = S3D.vdist(P.wrL, P.wrR); minG = Math.min(minG, g); maxG = Math.max(maxG, g);
    }
    ok(maxLvl < 0.5, `${name}: the bar is LEVEL - worst wrist height mismatch ${maxLvl.toFixed(4)} units`);
    ok(maxSq < 0.5, `${name}: the bar is SQUARE - worst wrist depth mismatch ${maxSq.toFixed(4)} units`);
    ok(maxG - minG < 0.5, `${name}: the grip is RIGID - width ${minG.toFixed(3)}..${maxG.toFixed(3)} ` +
       `(delta ${(maxG - minG).toFixed(4)}). A real bar cannot stretch`);
  }
  const ts = (r.clip.keys || []).map(k => +k.t);
  ok(ts.length === KEY_T.length && KEY_T.every(t => ts.some(x => Math.abs(x - t) < 1e-9)),
     `${name}: keys sit exactly at the app's four phase boundaries (${KEY_T.join(', ')})`);
  ok(Math.abs(r.clip.duration - 3.14) < 1e-6, `${name}: duration is 3.14 s so the HUD label matches the motion`);
  let prev = null, worst = 0, nan = 0;
  for (let i = 0; i <= 80; i++) {
    const P = S3D.sample(ch, name, 3.14 * i / 80).fk.p;
    const v = spec.joint === 'knee' ? kneeA(P, 'L') : elbowA(P, 'L');
    if (!isFinite(v)) nan++;
    if (prev !== null) worst = Math.max(worst, Math.abs(v - prev));
    prev = v;
  }
  ok(nan === 0, `${name}: no non-finite angle across 81 sampled frames`);
  ok(worst < 18, `${name}: no discontinuity - largest frame-to-frame change ${worst.toFixed(1)} deg`);
}

/* ------------------------------------------------------- the sandbox clip must NOT look measured */
console.log('\nDISCRIMINATION (the core\'s own sandbox squat must not pass as measured)');
if (SANDBOX_SQUAT) {
  S3D.CLIPS.__sandbox = SANDBOX_SQUAT;      /* register under a spare name so it can be sampled */
  const sp = SPEC.squat;
  const h = kneeA(S3D.sample(ch, '__sandbox', 0).fk.p, 'L');
  const a = kneeA(S3D.sample(ch, '__sandbox', 1.5).fk.p, 'L');
  const hh = hipA(S3D.sample(ch, '__sandbox', 0).fk.p, 'L');
  const ah = hipA(S3D.sample(ch, '__sandbox', 1.5).fk.p, 'L');
  console.log(`  sandbox squat : knee ${h.toFixed(1)} / ${a.toFixed(1)}, hip ${hh.toFixed(1)} / ${ah.toFixed(1)}`);
  console.log(`  measured squat: knee ${sp.home} / ${sp.away}, hip ${sp.hip.home} / ${sp.hip.away}`);
  const off = [Math.abs(h - sp.home), Math.abs(a - sp.away), Math.abs(hh - sp.hip.home), Math.abs(ah - sp.hip.away)];
  const worst = Math.max.apply(null, off);
  ok(worst > sp.tol,
     `the sandbox squat FAILS the measured targets (worst miss ${worst.toFixed(1)} deg), so this check can ` +
     'tell measured motion from a plausible invented one. If this ever passes, the check is worthless');
  delete S3D.CLIPS.__sandbox;
} else {
  console.log('  (no sandbox squat in the core to discriminate against)');
}

/* ---------------------------------------------------------------- NEGATIVE CONTROL
   Both of the assertions above must be capable of failing. Reverse a clip's phases and confirm the
   direction check reports FAIL; tilt one arm and confirm the bar-level check reports FAIL. */
console.log('\nNEGATIVE CONTROL');
const anyName = Object.keys(results)[0];
if (anyName) {
  const spec = SPEC[anyName], base = S3D.CLIPS[anyName];
  /* Registered under a NEW name on purpose, and this is not cosmetic. An earlier version of this
     control edited the clip's keys in place -- and reported the angle UNCHANGED, because sample()
     memoises the evaluated clip, so an in-place edit is silently ignored and the control "passed"
     while proving nothing at all. A fresh name forces a fresh evaluation. */
  const rev = JSON.parse(JSON.stringify(base));
  rev.name = '__reversed';
  const k0 = rev.keys[0], k1 = rev.keys[1];
  rev.keys[0] = Object.assign({}, k1, { t: k0.t });
  rev.keys[1] = Object.assign({}, k0, { t: k1.t });
  S3D.CLIPS.__reversed = rev;
  const v = (t) => spec.joint === 'knee' ? kneeA(S3D.sample(ch, '__reversed', t).fk.p, 'L')
                                         : elbowA(S3D.sample(ch, '__reversed', t).fk.p, 'L');
  const h2 = v(0), a2 = v(1.5);
  console.log(`  home/away exchanged in a copy of ${anyName} -> home ${h2.toFixed(1)}, away ${a2.toFixed(1)}`);
  ok(!(h2 > a2), 'the direction check correctly reports FAIL on a clip that runs backwards');
  ok(!(Math.abs(h2 - spec.home) <= spec.tol), 'and the home-vs-target check correctly reports FAIL');
  delete S3D.CLIPS.__reversed;
}
const barName = Object.keys(results).find(n => results[n].spec.bar);
if (barName) {
  const base = S3D.CLIPS[barName];
  const tilt = JSON.parse(JSON.stringify(base));
  tilt.name = '__tilted';
  /* Tilt ONE arm. This has to move whatever actually drives the hand: rotating a joint does nothing
     at all to a clip that positions its arms by IK, because the wrist comes from the `ik` target and
     not from the shoulder rotation. An earlier version of this control did exactly that and passed
     while proving nothing, on an IK-driven clip. So: move the IK target if there is one. */
  const k1 = tilt.keys[1];
  const ikArm = k1.ik && (k1.ik.armL || k1.ik.armR);
  if (ikArm && ikArm.t) {
    ikArm.t = [ikArm.t[0], ikArm.t[1] + 6, ikArm.t[2]];
    console.log('  (moving the arm IK target; this clip drives its arms by IK, so joint rotations are inert)');
  } else {
    k1.p = k1.p || {};
    k1.p.shL = S3D.qA([1, 0, 0], 25);
  }
  S3D.CLIPS.__tilted = tilt;
  let lvl = 0;
  for (let i = 0; i <= 40; i++) { const P = S3D.sample(ch, '__tilted', 3.14 * i / 40).fk.p; lvl = Math.max(lvl, Math.abs(P.wrL[1] - P.wrR[1])); }
  console.log(`  tilted one arm in a copy of ${barName} -> worst wrist height mismatch ${lvl.toFixed(2)} units`);
  ok(lvl > 0.5, 'the level check correctly reports FAIL on a tilted bar (a real bar is rigid and straight)');
  delete S3D.CLIPS.__tilted;
} else {
  console.log('  (no measured bar clip yet, so the bar-tilt control cannot run)');
}

console.log('\n' + (missing.length ? 'NOT MEASURED YET: ' + missing.join('; ') + '\n' : '') +
  (fails ? `CLIPS INDEPENDENT CHECK: ${fails} FAILURE(S) of ${checked}`
         : `CLIPS INDEPENDENT CHECK CLEAN - ${checked} assertions`));
process.exitCode = fails ? 1 : 0;
