/* _check_clip_machinepress.cjs — verification for _s3d_clip_machinepress.js.

   Runs the brief's six checks, the two requirements specific to this clip, and then renders the
   thing in headless Chrome and writes PNGs to look at:

     1. loads in node and registers S3D.CLIPS.machinepress          (exit non-zero if not)
     2. keys sit at exactly 0 / 1.5 / 1.82 / 2.82 / 3.14            (within 1e-9)
     3. every measured number is reproduced: elbow 86.4 / 130.5 deg, wrist +Z reach 41.6 / 31.4,
        wrist height offset ~0
     4. smooth motion: 60 frames, no NaN, no >15 deg frame-to-frame joint step, the arc monotone
        inside each of the four tempo phases, and no frame the IK had to clamp
     5. NEGATIVE CONTROLS: three deliberate breakages, each of which the check MUST report as FAIL
     6. the two machine requirements: the two handles level and square, and the wrist staying at
        shoulder height; plus pelvis stability and the feet staying planted
     then render and inspect.

   Usage:  node _check_clip_machinepress.cjs [--no-render]

   Nothing here compares against a second copy of the measured numbers: the targets come from the
   clip module's own `targets` (the record the app reads for its provenance line), and the rig's
   bone lengths come from the skeleton. A typo in the clip cannot agree with a typo in the test. */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const S3D = require('./_s3d_core.js');
const mod = require('./_s3d_clip_machinepress.js');

const NAME = 'machinepress';
const TARGETS = mod.targets;
const SK = S3D.buildSkeleton();
const T_KEYS = [0, 1.5, 1.82, 2.82, 3.14];
const TOL_ANG = 2;          /* the brief's tolerance, in degrees */
const TOL_REACH = 2;        /* the brief's tolerance, in engine units */
const TOL_EXACT = 1e-9;

/* THE REFERENCE NUMBERS, HARDCODED HERE ON PURPOSE.
   These are the measured values as given, duplicated rather than read from the clip. Every
   pass/fail below compares the posed skeleton against THESE, never against anything the clip says
   about itself, so a clip that quietly redefined its own target cannot pass. The clip's own record
   is additionally required to AGREE with these (see [3a]) — disagreement is itself a failure. */
const REF = {
  elbow_extended_deg: 130.5, elbow_flexed_deg: 86.4, tol_deg: 2,
  reach_extended: 41.6, reach_flexed: 31.4, tol_units: 2,
  wrist_height_rel_shoulder: 0, tol_height: 2,
  source: 'CDC chest press video', licence: 'Public domain (US Government work)'
};

let EXIT = 0;
function finish(code) { process.exitCode = code; }

/* ------------------------------------------------------------------ helpers */
function d2(x, n) { return (Math.round(x * Math.pow(10, n || 3)) / Math.pow(10, n || 3)).toFixed(n || 3); }
function pad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
function padR(s, n) { s = String(s); while (s.length < n) s = s + ' '; return s; }

/* interior angle at b, 180 = fully straight — the brief's convention */
function angAt(a, b, c) {
  const u = S3D.sub(a, b), v = S3D.sub(c, b);
  const d = S3D.dot(u, v) / ((S3D.len(u) * S3D.len(v)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
}

function state(clip, t) {
  const ev = S3D.evalClip(SK, clip, t);
  const p = ev.fk.p;
  return {
    ev: ev, p: p,
    elbowL: angAt(p.shL, p.elbL, p.wrL), elbowR: angAt(p.shR, p.elbR, p.wrR),
    reachL: p.wrL[2] - p.shL[2], reachR: p.wrR[2] - p.shR[2],
    dyL: p.wrL[1] - p.shL[1], dyR: p.wrR[1] - p.shR[1]
  };
}

function Reporter(tag) {
  this.tag = tag;
  this.lines = [];
  this.fails = [];
}
Reporter.prototype.head = function (s) { this.lines.push(s); };
Reporter.prototype.check = function (cond, msg, detail) {
  this.lines.push('  ' + (cond ? 'ok  ' : 'FAIL') + '  ' + padR(msg, 62)
    + (detail === undefined ? '' : '  [' + detail + ']'));
  if (!cond) this.fails.push(msg);
};
Reporter.prototype.note = function (s) { this.lines.push('        ' + s); };
Reporter.prototype.dump = function () { this.lines.forEach(l => console.log(l)); };

/* ------------------------------------------------------------------ the check itself
   Takes a clip OBJECT, not a global, so the negative controls below can run the identical code
   against a deliberately broken clip. A check that cannot be pointed at a bad input proves
   nothing. */
function runChecks(clip, tag) {
  const R = new Reporter(tag);

  /* ---- 2. the tempo keys */
  R.head('\n[2] KEY TIMES  (the app names the phase from its own 3140 ms clock)');
  R.check(clip.duration === 3.14, 'duration is exactly 3.14 s', 'duration = ' + clip.duration);
  R.check(clip.keys.length === T_KEYS.length,
    clip.keys.length + ' keys, the five the tempo requires', 'got ' + clip.keys.length);
  T_KEYS.forEach(function (t, i) {
    const k = clip.keys[i];
    const ok = !!k && Math.abs(k.t - t) <= TOL_EXACT;
    R.check(ok, 'key ' + i + ' sits at t = ' + t,
      k ? 't = ' + k.t + ', delta ' + (k.t - t).toExponential(2) : 'missing');
  });
  /* every key must carry the same chain names: evalClip() looks each chain of k0 up in k1 and
     silently drops the limb when it is absent. */
  if (clip.keys.length >= 2) {
    const names0 = Object.keys(clip.keys[0].ik || {}).sort().join(',');
    const same = clip.keys.every(k => Object.keys(k.ik || {}).sort().join(',') === names0);
    R.check(same, 'every key carries the same IK chains', 'chains: ' + names0);
  }

  /* ---- 3a. the clip's record must agree with the reference, hardcoded above */
  R.head('\n[3a] RECORD vs REFERENCE  (the clip may not redefine its own target)');
  R.head('        the recorded numbers are read from S3D.MEASURED / the clip module; the ones they are');
  R.head('        compared against are typed into this file. Disagreement is a failure, not a warning.');
  [['source', TARGETS.source, REF.source], ['licence', TARGETS.licence, REF.licence],
   ['elbow_extended_deg', TARGETS.elbow_extended_deg, REF.elbow_extended_deg],
   ['elbow_flexed_deg', TARGETS.elbow_flexed_deg, REF.elbow_flexed_deg],
   ['wrist_forward_at_extension', TARGETS.wrist_forward_at_extension, REF.reach_extended],
   ['wrist_forward_at_flexion', TARGETS.wrist_forward_at_flexion, REF.reach_flexed],
   ['wrist_height_rel_shoulder', TARGETS.wrist_height_rel_shoulder, REF.wrist_height_rel_shoulder]
  ].forEach(function (row) {
    R.check(row[1] === row[2], 'the clip records ' + row[0] + ' as the reference states it',
      'recorded ' + JSON.stringify(row[1]) + ', reference ' + JSON.stringify(row[2]));
  });

  /* ---- 3. the measured extremes */

  R.head('\n[3] MEASURED NUMBERS REPRODUCED  (computed from ev.fk.p, never from the authored rotations)');
  const HOME = [0, 2.82, 3.14], AWAY = [1.5, 1.82];
  const pairs = [
    { t: 0.00, kind: 'extended', elbow: REF.elbow_extended_deg, reach: REF.reach_extended },
    { t: 1.50, kind: 'flexed', elbow: REF.elbow_flexed_deg, reach: REF.reach_flexed },
    { t: 1.82, kind: 'flexed', elbow: REF.elbow_flexed_deg, reach: REF.reach_flexed },
    { t: 2.82, kind: 'extended', elbow: REF.elbow_extended_deg, reach: REF.reach_extended },
    { t: 3.14, kind: 'extended', elbow: REF.elbow_extended_deg, reach: REF.reach_extended }
  ];
  R.head('        ' + padR('t', 7) + padR('pose', 10) + padR('quantity', 26) + padR('measured', 10)
    + padR('target', 9) + padR('delta', 9) + 'tol');
  const st = {};
  pairs.forEach(function (row) {
    const s = state(clip, row.t);
    st[row.t] = s;
    const rows = [
      ['elbow L (deg)', s.elbowL, row.elbow, REF.tol_deg],
      ['elbow R (deg)', s.elbowR, row.elbow, REF.tol_deg],
      ['wrist +Z reach L', s.reachL, row.reach, REF.tol_units],
      ['wrist +Z reach R', s.reachR, row.reach, REF.tol_units],
      ['wrist height dY L', s.dyL, REF.wrist_height_rel_shoulder, REF.tol_height],
      ['wrist height dY R', s.dyR, REF.wrist_height_rel_shoulder, REF.tol_height]
    ];
    rows.forEach(function (r) {
      const delta = r[1] - r[2], ok = Math.abs(delta) <= r[3] + 1e-9;
      R.head('        ' + padR(row.t.toFixed(2), 7) + padR(row.kind, 10) + padR(r[0], 26)
        + padR(d2(r[1]), 10) + padR(d2(r[2]), 9)
        + padR((delta >= 0 ? '+' : '') + d2(delta), 9) + '\u00b1' + r[3]);
      R.check(ok, 't=' + row.t + ' ' + r[0] + ' within \u00b1' + r[3],
        'measured ' + d2(r[1]) + ' vs target ' + d2(r[2]) + ', delta ' + (delta >= 0 ? '+' : '') + d2(delta));
    });
  });
  /* ---- THE BOUND, MEASURED RATHER THAN ASSERTED.
     The claim "the forward reach can never exceed the shoulder-to-wrist chord" is the whole reason
     this clip cannot print the reference's 41.6. So it is not asserted — the arm is pointed in every
     direction on the sphere, the wrist is placed at the chord distance in each one, and the reach is
     measured. The maximum over the whole sweep is the bound, and it must appear at +Z exactly. */
  const CHORD_MEASURED = mod.derived.reach_extended_at_measured_angle;
  const CHORD_AUTHORED = mod.derived.reach_extended;
  R.head('\n        THE BOUND, measured by sweeping every arm direction at the authored elbow angle:');
  let bestReach = -1e9, bestDir = null, worstElbowErr = 0, nDirs = 0;
  /* i starts at 0 so that the +Z axis itself is sampled: a grid that only approaches it reaches
     cos(5 deg) * chord = 39.630 and would look like a failure of the bound rather than of the grid
     (it did, on the first run — which is the sweep doing its job). */
  for (let i = 0; i <= 36; i++) {                    /* polar angle from +Z, 0 = straight ahead */
    for (let j = 0; j < 36; j++) {                   /* azimuth */
      const th = (i * 180 / 36) * Math.PI / 180, ph = (j * 360 / 36) * Math.PI / 180;
      const dir = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      /* fresh q every time: the IK writes into it, and a reused q would be a different pose */
      const q = {}, W0 = S3D.fk(SK, q, [0, mod.derived.hipY - SK.rest.hips[1], 0]);
      const sh = W0.p.shL;
      const target = S3D.add(sh, S3D.mul(dir, CHORD_AUTHORED));
      S3D.ikTwoBone(SK, 'armL', target, [26, sh[1] - 20, 22], q, W0);
      const p = S3D.fk(SK, q, [0, mod.derived.hipY - SK.rest.hips[1], 0]).p;
      const reach = p.wrL[2] - p.shL[2];
      const el = angAt(p.shL, p.elbL, p.wrL);
      worstElbowErr = Math.max(worstElbowErr, Math.abs(el - mod.derived.elbow_ext_authored));
      nDirs++;
      if (reach > bestReach) { bestReach = reach; bestDir = dir; }
    }
  }
  R.head('          swept ' + nDirs + ' directions; the elbow angle stayed '
    + d2(mod.derived.elbow_ext_authored) + ' deg in all of them (max error ' + worstElbowErr.toExponential(1) + ' deg)');
  R.head('          maximum forward reach over the whole sweep: ' + d2(bestReach)
    + ' units, at direction [' + bestDir.map(v => d2(v, 3)).join(', ') + ']  (= +Z)');
  R.head('          shoulder-to-wrist chord at that angle:      ' + d2(CHORD_AUTHORED) + ' units');
  R.check(Math.abs(bestReach - CHORD_AUTHORED) < 1e-9,
    'no arm orientation reaches further forward than the chord (sweep max = chord)',
    d2(bestReach) + ' vs ' + d2(CHORD_AUTHORED));
  R.check(bestDir[2] > 0.9999, 'the furthest-forward direction is exactly +Z, hands level with the shoulder',
    'z-component ' + d2(bestDir[2], 6));

  /* ---- WHY the extended reach stops short, demonstrated rather than asserted. */
  const L1 = mod.derived.L_upper, L2 = mod.derived.L_fore;
  const reach41 = clone(CLIP);
  [0, 3, 4].forEach(function (i) {                 /* the three EXTENDED keys */
    reach41.keys[i].ik.armL.t[2] = REF.reach_extended;
    reach41.keys[i].ik.armR.t[2] = REF.reach_extended;
  });
  const s41 = state(reach41, 0);
  R.head('\n        WHAT THE REFERENCE\'S 41.6 WOULD COST (same clip, extension target moved forward):');
  R.head('          wrist +Z reach ' + d2(s41.reachL) + '  ->  elbow ' + d2(s41.elbowL) + ' deg'
    + '   (reference ' + d2(REF.elbow_extended_deg) + ' deg, delta '
    + (s41.elbowL - REF.elbow_extended_deg >= 0 ? '+' : '') + d2(s41.elbowL - REF.elbow_extended_deg)
    + ', i.e. ' + d2(Math.abs(s41.elbowL - REF.elbow_extended_deg) - REF.tol_deg) + ' deg outside \u00b12)');
  R.head('          the clip authors ' + d2(mod.derived.elbow_ext_authored) + ' deg instead, which reaches '
    + d2(CHORD_AUTHORED) + ' units');
  R.head('          forearm length implied by each reference reach, using this clip\'s own scale factor'
    + ' (' + d2(L1) + ' units = 0.289 m):');
  [['extension', REF.elbow_extended_deg, REF.reach_extended],
   ['flexion', REF.elbow_flexed_deg, REF.reach_flexed]].forEach(function (row) {
    const u = L1 / 0.289;                                       /* engine units per metre */
    const L1m = 0.289, reachM = row[2] / u;
    const c = Math.cos(row[1] * Math.PI / 180);
    const implied = L1m * c + Math.sqrt(L1m * L1m * c * c - L1m * L1m + reachM * reachM);
    R.head('            ' + padR(row[0], 10) + padR('reach ' + d2(row[2]) + ' u = ' + d2(reachM, 4) + ' m', 26)
      + 'implies forearm ' + d2(implied, 5) + ' m = ' + d2(implied * u) + ' units');
  });
  R.head('          this rig\'s forearm is ' + d2(L2) + ' units, so the reference\'s two reaches are not');
  R.head('          jointly reachable here; the clip spends 1.5 deg of the elbow\'s own \u00b12 deg budget on it.');
  R.check(s41.elbowL > REF.elbow_extended_deg + 5,
    'hitting 41.6 exactly would cost ' + d2(s41.elbowL - REF.elbow_extended_deg) + ' deg of elbow, far outside \u00b12 deg',
    'the elbow would read ' + d2(s41.elbowL) + ' deg, not ' + d2(REF.elbow_extended_deg));
  R.check(Math.abs(CHORD_AUTHORED - CHORD_MEASURED) > 0.2,
    'the authored elbow angle bought reach (the reason for the departure)',
    d2(CHORD_MEASURED) + ' at the measured 130.5 deg -> ' + d2(CHORD_AUTHORED) + ' at the authored '
    + d2(mod.derived.elbow_ext_authored) + ' deg, +' + d2(CHORD_AUTHORED - CHORD_MEASURED));

  /* the repeats must be IDENTICAL, not merely close: t=2.82/3.14 are the same authored pose as
     t=0, and t=1.82 the same as t=1.5. A drift here means an interpolation artefact between
     "identical" keys, which is exactly what a wrong key value looks like. */
  HOME.forEach(function (t) {
    R.check(Math.abs(st[t].elbowL - st[0].elbowL) < TOL_EXACT
      && Math.abs(st[t].reachL - st[0].reachL) < TOL_EXACT,
      't=' + t + ' is the same pose as t=0 (home is authored once, three times)');
  });
  AWAY.forEach(function (t) {
    R.check(Math.abs(st[t].elbowL - st[1.5].elbowL) < TOL_EXACT
      && Math.abs(st[t].reachL - st[1.5].reachL) < TOL_EXACT,
      't=' + t + ' is the same pose as t=1.5 (away is authored once, twice)');
  });

  /* ---- 4. smooth motion */
  R.head('\n[4] MOTION  (60 frames: finite, no teleport, monotone inside each phase)');
  const N = 60, frames = [];
  for (let i = 0; i < N; i++) frames.push(state(clip, clip.duration * i / (N - 1)));
  let bad = 0, worstJoint = 0;
  frames.forEach(function (f, i) {
    Object.keys(f.p).forEach(function (j) {
      const q = f.p[j];
      if (!q.every(v => isFinite(v))) { bad++; R.note('non-finite joint ' + j + ' at frame ' + i); }
    });
  });
  R.check(bad === 0, 'every joint position is finite in all 60 frames', bad + ' bad');
  let clamped = 0, worstOver = 0;
  frames.forEach(function (f) {
    if (f.ev.ik && f.ev.ik.clamped) {
      clamped += f.ev.ik.clamped;
      if (f.ev.ik.worst) worstOver = Math.max(worstOver, f.ev.ik.worst.over);
    }
  });
  R.check(clamped === 0, 'no frame needed the IK reach clamp', clamped + ' clamped, worst over ' + d2(worstOver));
  for (let i = 1; i < frames.length; i++) {
    const step = Math.abs(frames[i].elbowL - frames[i - 1].elbowL);
    worstJoint = Math.max(worstJoint, step);
  }
  R.check(worstJoint <= 15, 'largest frame-to-frame elbow step \u2264 15 deg', d2(worstJoint) + ' deg');

  /* the arc, phase by phase. dir -1 = flexing (elbow angle falling), +1 = extending, 0 = held. */
  const PHASES = [
    { name: '1 controlled lowering (eccentric)', a: 0.00, b: 1.50, dir: -1 },
    { name: '2 hold at flexion', a: 1.50, b: 1.82, dir: 0 },
    { name: '3 drive back to extension', a: 1.82, b: 2.82, dir: +1 },
    { name: '4 hold at extension', a: 2.82, b: 3.14, dir: 0 }
  ];
  PHASES.forEach(function (ph) {
    const M = 17, vals = [];
    for (let i = 0; i < M; i++) vals.push(state(clip, ph.a + (ph.b - ph.a) * i / (M - 1)).elbowL);
    let ok = true, why = '';
    for (let i = 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      if (ph.dir === 0 && Math.abs(d) > 1e-9) { ok = false; why = 'moved ' + d.toExponential(2) + ' during a hold'; break; }
      if (ph.dir < 0 && d > 1e-9) { ok = false; why = 'rose by ' + d.toExponential(2) + ' while lowering'; break; }
      if (ph.dir > 0 && d < -1e-9) { ok = false; why = 'fell by ' + d.toExponential(2) + ' while driving'; break; }
    }
    R.check(ok, 'phase ' + ph.name + ' is monotone (' + (ph.dir === 0 ? 'constant' : ph.dir < 0 ? 'falling' : 'rising') + ')',
      why || (d2(vals[0]) + ' -> ' + d2(vals[vals.length - 1])));
  });
  R.check(st[0].elbowL > st[1.5].elbowL,
    'home (t=0) is the EXTENDED pose, so phase 1 lowers',
    't=0 elbow ' + d2(st[0].elbowL) + ' -> t=1.5 elbow ' + d2(st[1.5].elbowL));

  /* ---- 6. the machine, the pelvis and the feet */
  R.head('\n[6] RIGID CARRIAGE, SHOULDER HEIGHT, PELVIS, FEET  (across all 60 frames)');
  let maxDy = 0, maxDz = 0, maxDx = 0, maxHeight = 0, maxHip = 0, maxAnkle = 0, maxToe = 0;
  frames.forEach(function (f) {
    const p = f.p;
    maxDy = Math.max(maxDy, Math.abs(p.wrL[1] - p.wrR[1]));
    maxDz = Math.max(maxDz, Math.abs(p.wrL[2] - p.wrR[2]));
    maxDx = Math.max(maxDx, Math.abs(p.wrL[0] + p.wrR[0]));
    maxHeight = Math.max(maxHeight, Math.abs(f.dyL), Math.abs(f.dyR));
    maxHip = Math.max(maxHip, Math.abs(p.hips[1] - frames[0].p.hips[1]),
      Math.abs(p.hips[0] - frames[0].p.hips[0]), Math.abs(p.hips[2] - frames[0].p.hips[2]));
    maxAnkle = Math.max(maxAnkle, Math.abs(p.ankleL[1] - 9), Math.abs(p.ankleR[1] - 9));
    maxToe = Math.max(maxToe, Math.abs(p.toeL[1] - 3), Math.abs(p.toeR[1] - 3));
  });
  R.check(maxDy < 1e-9, 'handles level: |wrL.y - wrR.y| \u2248 0', maxDy.toExponential(2));
  R.check(maxDz < 1e-9, 'handles square: |wrL.z - wrR.z| \u2248 0', maxDz.toExponential(2));
  R.check(maxDx < 1e-9, 'handles centred: |wrL.x + wrR.x| \u2248 0', maxDx.toExponential(2));
  R.check(maxHeight <= 1e-6, 'wrists stay at shoulder height across the whole rep',
    'max |wr.y - sh.y| = ' + d2(maxHeight, 6) + ' units');
  R.check(maxHip < 1e-9, 'pelvis does not rise, sink or drift',
    'pelvis range = ' + d2(maxHip, 9) + ' units (y = ' + d2(frames[0].p.hips[1]) + ')');
  R.check(maxAnkle < 1e-9 && maxToe < 1e-9, 'feet stay planted on the floor',
    'ankle y err ' + maxAnkle.toExponential(2) + ', toe y err ' + maxToe.toExponential(2));

  return { reporter: R, fails: R.fails, st: st };
}

/* ------------------------------------------------------------------ 1. does it load */
console.log('=== _check_clip_machinepress.cjs \u2014 seated machine chest press ===');
console.log('\n[1] LOAD');
const CLIP = S3D.CLIPS[NAME];
const loads = !!CLIP && CLIP === mod.clip;
console.log('  ' + (loads ? 'ok  ' : 'FAIL') + '  require(\'./_s3d_clip_machinepress.js\') returns a clip and registers S3D.CLIPS.' + NAME);
console.log('        S3D.CLIPS.' + NAME + ' = ' + (CLIP ? CLIP.name + ', ' + CLIP.duration + ' s, ' + CLIP.keys.length + ' keys' : 'MISSING'));
const rec = S3D.MEASURED && S3D.MEASURED[NAME];
console.log('  ' + (rec ? 'ok  ' : 'FAIL') + '  S3D.MEASURED.' + NAME + ' records source + licence');
console.log('        source  : ' + (rec && rec.source));
console.log('        licence : ' + (rec && rec.licence));
console.log('        targets : ' + JSON.stringify(rec && rec.targets));
if (!loads || !rec) EXIT = 1;

/* informational: does the assembled measured set pick this clip up? (other agents own that file
   and the three sibling clips, so a gap there is reported, never failed on.) */
try {
  const M = require('./_s3d_clips_measured.js');
  const t = M.TARGETS && M.TARGETS[NAME];
  console.log('  info  _s3d_clips_measured.js: clips ' + JSON.stringify(M.CLIPS)
    + ', phaseAligned ' + M.phaseAligned + ', skip ' + JSON.stringify(M.skip));
  console.log('        flattened ' + NAME + ' record: source=' + (t && t.source) + ' licence=' + (t && t.licence));
} catch (e) {
  console.log('  info  _s3d_clips_measured.js could not be loaded here: ' + e.message);
}

/* ------------------------------------------------------------------ run it, then break it */
const main = runChecks(CLIP, 'SHIPPED CLIP');
main.reporter.dump();

/* ---- 5. negative controls */
console.log('\n[5] NEGATIVE CONTROLS  (each must make the SAME check report FAIL)');
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function perturb(label, fn) {
  const bad = clone(CLIP);
  fn(bad);
  const res = runChecks(bad, label);
  const failed = res.fails.length > 0;
  console.log('\n  --- ' + label + ' ---');
  if (failed) {
    console.log('  first failures it reported:');
    res.fails.slice(0, 4).forEach(function (m) { console.log('    FAIL  ' + m); });
    console.log('  VERDICT: control behaved correctly \u2014 the check reported FAIL (' + res.fails.length + ' failures)');
  } else {
    console.log('  VERDICT: *** THE CHECK DID NOT NOTICE *** \u2014 this control proves nothing');
    EXIT = 1;
  }
  return failed;
}
const c1 = perturb('CONTROL 1: an authored quaternion \u2014 chest rotated 14 deg on the flexed keys (moves the shoulder, so the wrist reach changes)', function (c) {
  c.keys[1].p.chest = S3D.qA([1, 0, 0], 14);
  c.keys[2].p.chest = S3D.qA([1, 0, 0], 14);
});
const c2 = perturb('CONTROL 2: an authored IK target \u2014 the flexed hand shortened by 6 units (wrong elbow angle)', function (c) {
  [1, 2].forEach(function (i) { c.keys[i].ik.armL.t[2] -= 6; c.keys[i].ik.armR.t[2] -= 6; });
});
const c3 = perturb('CONTROL 3: one handle raised 3 units (a tilted carriage, the defect this clip must not have)', function (c) {
  c.keys.forEach(function (k) { k.ik.armR.t[1] += 3; });
});
const c4 = perturb('CONTROL 4: the tempo \u2014 key 2 moved from 1.82 to 1.90 (the HUD would name the wrong phase)', function (c) {
  c.keys[2].t = 1.90;
});
if (!(c1 && c2 && c3 && c4)) { /* EXIT already set */ }

/* ------------------------------------------------------------------ verdict */
const realFails = main.fails.length;
console.log('\n=== VERDICT ===');
console.log('  real checks failed: ' + realFails + (realFails ? '  ' + JSON.stringify(main.fails) : ''));
console.log('  negative controls that failed the check as required: '
  + [c1, c2, c3, c4].filter(Boolean).length + ' of 4');
if (realFails) EXIT = 1;

/* ================================================================== render
   (invoked at the very bottom of this file: the render constants below would still be in their
   temporal dead zone if this ran from here.) */
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9411;                       /* not 9361: _s3d_shot.cjs may be running too */
const TMP = '_gifwork';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The injected build code. It reuses the viewer page's own character (`ch`, `GEO`) rather than
   meshing a second one, and draws with the props the app draws with, which `_s3d_view.html`'s own
   sheet does not pass. The last row of the 'poses' sheet is a measurement rather than a picture:
   the same frame drawn WITH and WITHOUT the seat/back pad, read back with readPixels so the
   difference can be counted and located instead of assumed visible. */
function buildExpr(which) {
  return '(function(){'
    + 'var R = window.S3D_RENDER, PR = window.S3D_PROPS;'
    + 'var clip = S3D.CLIPS.machinepress;'
    + 'var G = PR.build(ch);'
    + 'var sheet = document.getElementById("sheet"); sheet.innerHTML = "";'
    + 'function persp(eye, tgt){ return { proj: S3D.m4Persp(30, 1, 1, 3000), view: S3D.m4LookAt(eye, tgt, [0,1,0]), eye: eye }; }'
    + 'function ortho(eye, tgt, half){ return { proj: S3D.m4Ortho(half, half, -800, 800), view: S3D.m4LookAt(eye, tgt, [0,1,0]), eye: eye }; }'
    + 'function mkrow(label){'
    + '  var d = document.createElement("div"); d.className = "line";'
    + '  var rl = document.createElement("div"); rl.className = "rl";'
    + '  var b = document.createElement("b"); b.textContent = label; rl.appendChild(b); d.appendChild(rl);'
    + '  var wrap = document.createElement("div"); wrap.className = "cv";'
    + '  var c = document.createElement("canvas");'
    + '  wrap.appendChild(c); d.appendChild(wrap); sheet.appendChild(d);'
    + '  return { canvas: c, wrap: wrap };'
    + '}'
    + 'function row(label, times, camFn, cellPx){'
    + '  var r = mkrow(label);'
    + '  r.canvas.width = cellPx * times.length; r.canvas.height = cellPx;'
    + '  var ctx = R.makeCtx(r.canvas, ch, GEO);'
    + '  times.forEach(function(t, i){'
    + '    var ev = S3D.sample(ch, "machinepress", t);'
    + '    var props = PR.frame(G, ch, S3D, ev, "machinepress", S3D.sample);'
    + '    R.drawCell(ctx, i * cellPx, 0, cellPx, ev, camFn(), { props: props });'
    + '  });'
    + '}'
    + 'var EYE3 = [128, 76, 186], TGT3 = [0, 40, 10];'
    + (which === 'strip'
      ? 'var ts = []; for (var i = 0; i < 9; i++) ts.push(clip.duration * i / 8);'
        + 'row("machinepress \u2014 9 frames over 3.14 s (persp, with the seat and back pad)", ts, function(){ return persp(EYE3, TGT3); }, 220);'
      : 'row("EXTENDED t=0 (persp / side / front)", [0], function(){ return persp(EYE3, TGT3); }, 240);'
        + 'row("FLEXED t=1.5 (persp / side / front)", [1.5], function(){ return persp(EYE3, TGT3); }, 240);'
        + 'row("extended t=0 \u2014 side, feet and seat", [0], function(){ return ortho([500, 44, 12], [0, 44, 12], 52); }, 240);'
        + 'row("flexed t=1.5 \u2014 side, feet and seat", [1.5], function(){ return ortho([500, 44, 12], [0, 44, 12], 52); }, 240);'
        + 'row("extended t=0 \u2014 front", [0], function(){ return ortho([0, 44, 500], [0, 44, 12], 52); }, 240);'
        + 'row("flexed t=1.5 \u2014 front", [1.5], function(){ return ortho([0, 44, 500], [0, 44, 12], 52); }, 240);'
        + 'var PP = mkrow("t=0 side \u2014 WITH the seat and back pad / WITHOUT them");'
        + 'var CELL = 240; PP.canvas.width = CELL * 2; PP.canvas.height = CELL;'
        + 'var pctx = R.makeCtx(PP.canvas, ch, GEO);'
        + 'var ev0 = S3D.sample(ch, "machinepress", 0);'
        + 'var cam0 = ortho([500, 44, 12], [0, 44, 12], 52);'
        + 'R.drawCell(pctx, 0, 0, CELL, ev0, cam0, { props: PR.frame(G, ch, S3D, ev0, "machinepress", S3D.sample) });'
        + 'R.drawCell(pctx, CELL, 0, CELL, ev0, cam0, {});'
        + 'var IN = 234, A = new Uint8Array(IN * IN * 4), B = new Uint8Array(IN * IN * 4);'
        + 'pctx.gl.readPixels(3, 3, IN, IN, pctx.gl.RGBA, pctx.gl.UNSIGNED_BYTE, A);'
        + 'pctx.gl.readPixels(CELL + 3, 3, IN, IN, pctx.gl.RGBA, pctx.gl.UNSIGNED_BYTE, B);'
        + 'var n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;'
        + 'for (var i = 0; i < IN * IN; i++) {'
        + '  var k = i * 4, d = Math.abs(A[k] - B[k]) + Math.abs(A[k+1] - B[k+1]) + Math.abs(A[k+2] - B[k+2]);'
        + '  if (d > 8) { n++; var px = i % IN, py = (IN - 1) - Math.floor(i / IN);'
        + '    if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }'
        + '}'
        + '/* canvas px -> world, for this ortho side camera (52 units half-height over 234 px): */'
        + 'var U = 2 * 52 / IN;'
        + 'window.__PROPDIFF = { pixels: n, bboxPx: [x0, y0, x1, y1],'
        + '  worldZ: [12 - (x1 + 3 - 120) * U, 12 - (x0 + 3 - 120) * U],'
        + '  worldY: [44 - (y1 + 3 - 120) * U, 44 - (y0 + 3 - 120) * U] };')
    + 'return { w: document.body.scrollWidth, h: document.body.scrollHeight, propDiff: window.__PROPDIFF || null };'
    + '})()';
}

async function renderAndShoot() {
  console.log('\n[RENDER] headless Chrome + WebGL2 (SwiftShader)');
  if (!fs.existsSync(CHROME)) { console.log('  FAIL  Chrome not found at ' + CHROME); return false; }
  fs.mkdirSync(TMP, { recursive: true });

  const clipSrc = fs.readFileSync(path.join(__dirname, '_s3d_clip_machinepress.js'), 'utf8');
  const propsSrc = fs.readFileSync(path.join(__dirname, '_s3d_props.js'), 'utf8');

  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(__dirname, TMP, 'p_clip_mp'), 'about:blank'], { stdio: 'ignore' });

  let ws = null, id = 0;
  const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method: m, params: p || {} }));
  });
  const pageErrors = [];

  try {
    for (let i = 0; i < 100; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
        const pg = list.find(t => t.type === 'page');
        if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; }
      } catch (e) { /* not up yet */ }
      await sleep(250);
    }
    if (!ws) throw new Error('no CDP target (Chrome did not start)');
    await new Promise(r => ws.addEventListener('open', r));
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        pageErrors.push(d.text + ' ' + ((d.exception && d.exception.description) || ''));
      }
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    const url = 'file:///' + path.join(__dirname, '_s3d_view.html').replace(/\\/g, '/');
    await send('Page.navigate', { url });
    await sleep(3000);                       /* the page meshes the whole body on load */

    /* Inject the clip and the props module exactly as the app would load them. */
    const inject = await send('Runtime.evaluate', {
      expression: clipSrc + '\n' + propsSrc
        + '\n;({ clip: !!(S3D.CLIPS && S3D.CLIPS.machinepress), props: !!window.S3D_PROPS,'
        + ' target: !!(window.S3D_CLIP_MACHINEPRESS && S3D_CLIP_MACHINEPRESS.clip) })',
      returnByValue: true
    });
    const iv = inject.result.value || {};
    if (!iv.clip || !iv.props) throw new Error('injection failed: ' + JSON.stringify(iv));
    console.log('  ok    clip + props injected into the page (browser build of the same files)');

    const shots = [
      ['strip', '_s3d_machinepress_filmstrip.png', '9 frames across the rep, with the seat and back pad'],
      ['poses', '_s3d_machinepress_poses.png', 'both extremes, persp + side + front, with the seat and back pad']
    ];
    for (const [which, out, what] of shots) {
      const info = (await send('Runtime.evaluate', { expression: buildExpr(which), returnByValue: true })).result.value;
      await sleep(700);
      await send('Emulation.setDeviceMetricsOverride',
        { width: info.w, height: info.h, deviceScaleFactor: 1, mobile: false });
      await sleep(500);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(__dirname, out), Buffer.from(shot.data, 'base64'));
      console.log('  ok    wrote ' + out + '  (' + info.w + 'x' + info.h + ') \u2014 ' + what);
      if (info.propDiff) {
        const pd = info.propDiff;
        const r = v => [d2(v[0], 2), d2(v[1], 2)].join(' .. ');
        console.log('  info  seat + back pad, measured not assumed: ' + pd.pixels
          + ' px of the side view differ from the identical frame drawn without them');
        console.log('        their visible extent: y ' + r(pd.worldY) + ' units, z ' + r(pd.worldZ)
          + ' units   (pelvis y = ' + d2(mod.derived.hipY, 1) + ')');
        if (pd.pixels === 0) console.log('        *** the props drew NOTHING visible: they are inside the body mesh ***');
      }
    }
    if (pageErrors.length) {
      console.log('  FAIL  page errors: ' + pageErrors.slice(0, 3).join(' | '));
      return false;
    }
    console.log('  ok    no JS error fired in the page');
    return true;
  } finally {
    try { chrome.kill(); } catch (e) { }
    await sleep(900);
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(path.join(__dirname, TMP, 'p_clip_mp'), { recursive: true, force: true }); break; }
      catch (e) { await sleep(400); }
    }
  }
}

/* ------------------------------------------------------------------ 6. render it (last) */
if (process.argv.indexOf('--no-render') < 0) {
  renderAndShoot().then(function (ok) { finish(ok ? EXIT : (EXIT || 1)); })
    .catch(function (e) { console.log('RENDER FAILED: ' + e.message); finish(EXIT || 1); });
} else {
  finish(EXIT);
}
