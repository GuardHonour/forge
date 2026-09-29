/* _s3d_audit.cjs — numeric contract for the S3D character.
   The 3D counterpart of FORGE's _audit_demos.cjs / _hard_test.cjs: asserts the
   things an image cannot be trusted to show, so the render loop is only asked
   about what only an image can answer (silhouette, deformation quality, read).
   Run: node _s3d_audit.cjs */
const S3D = require('./_s3d_core.js');

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };
const pass = m => console.log('  pass  ' + m);

const ch = S3D.buildCharacter();
const sk = ch.sk;
const FRAMES = 40;

/* ---------- 1. build sanity ---------- */
console.log('character: ' + ch.mesh.pos.length + ' verts, ' + (ch.mesh.idx.length / 3) + ' tris, '
  + sk.order.length + ' joints, ' + sk.boneNames.length + ' skin bones');

/* every bone's authored length must match FORGE's BONE table */
const want = { 'spine': S3D.BONE.torso / 3, 'chest': S3D.BONE.torso / 3, 'neck': S3D.BONE.torso / 3,
  'head': S3D.BONE.neck, 'elbL': S3D.BONE.upper, 'wrL': S3D.BONE.fore,
  'kneeL': S3D.BONE.thigh, 'ankleL': S3D.BONE.shin };
let lenBad = 0;
Object.keys(want).forEach(j => {
  const got = S3D.vdist(sk.rest[sk.parent[j]], sk.rest[j]);
  if (Math.abs(got - want[j]) > 0.02) { fail(j + ' length ' + got.toFixed(2) + ' != BONE ' + want[j]); lenBad++; }
});
if (!lenBad) pass('every limb segment is the BONE-table length (2D and 3D share one anatomy)');

/* mirror symmetry: right side is the exact mirror of left */
let asym = 0;
sk.order.forEach(j => {
  if (!/R$/.test(j)) return;
  const l = sk.rest[j.slice(0, -1) + 'L'], r = sk.rest[j];
  if (Math.abs(l[0] + r[0]) > 1e-6 || Math.abs(l[1] - r[1]) > 1e-6 || Math.abs(l[2] - r[2]) > 1e-6) asym++;
});
if (asym) fail(asym + ' right-side joints are not mirrored from the left');
else pass('skeleton is left/right symmetric by construction');

/* ---------- 2. skin weights ---------- */
let wSumBad = 0, wZero = 0, wOver = 0;
for (let i = 0; i < ch.skin.wgt.length; i++) {
  const w = ch.skin.wgt[i];
  const s = w[0] + w[1] + w[2] + w[3];
  if (Math.abs(s - 1) > 1e-4) wSumBad++;
  if (s <= 0) wZero++;
  if (w[3] > 1e-6) wOver++;
}
if (wSumBad) fail(wSumBad + ' vertices have weights that do not sum to 1');
else pass('skin weights sum to 1 on all ' + ch.skin.wgt.length + ' vertices');
if (wZero) fail(wZero + ' vertices have no bone influence');
else pass('every vertex is bound to at least one bone');
console.log('        (vertices using a 4th influence: ' + wOver + ' — the cap is 4)');

/* ---------- 2b. limb-aware masking: no bone may reach outside its region ----
   Pure distance weighting bled across the whole body on the first build (torso
   vertices took 0.52 of their weight from arm bones; thigh vertices 0.55 from
   the hand bones, which hang right beside them). The render showed it as a wing
   at the shoulder. This asserts the fix holds, because a weight table is
   invisible in every still image. */
const nameOf = j => sk.order[j];
let bleed = 0, worst = null;
for (let i = 0; i < ch.skin.wgt.length; i++) {
  const allowed = (ch.mesh.allowed && ch.mesh.allowed[i]) || S3D.REGION[ch.mesh.part[i]] || [];
  for (let k = 0; k < 4; k++) {
    const w = ch.skin.wgt[i][k];
    if (w <= 1e-6) continue;
    const nm = nameOf(ch.skin.idx[i][k]);
    if (allowed.indexOf(nm) < 0) {
      bleed++;
      if (!worst || w > worst.w) worst = { w: w, part: ch.mesh.part[i], bone: nm };
    }
  }
}
if (bleed) fail(bleed + ' vertex/bone influences fall outside their region'
  + (worst ? ' (worst ' + worst.bone + ' on a ' + worst.part + ' vertex at weight ' + worst.w.toFixed(3) + ')' : ''));
else pass('every vertex is driven only by its own region\'s bones (no cross-limb bleed)');

const ARMB = new Set(['shL', 'shR', 'elbL', 'elbR', 'wrL', 'wrR', 'handL', 'handR']);
let armOnHeadNeck = 0;
for (let i = 0; i < ch.skin.wgt.length; i++) {
  const p = ch.mesh.part[i];
  if (!/^neckC|^head/.test(p)) continue;
  for (let k = 0; k < 4; k++) if (ch.skin.wgt[i][k] > 1e-6 && ARMB.has(nameOf(ch.skin.idx[i][k]))) armOnHeadNeck++;
}
if (armOnHeadNeck) fail(armOnHeadNeck + ' head/neck vertices are driven by arm bones');
else pass('no arm bone reaches the head or neck (the shoulder-wing bug)');

/* A welded body NEEDS a little arm influence on the torso where the hanging arm
   lies against the waist, or the blend tears there — that is soft tissue, not a
   bug. The bug was MAGNITUDE: the original wing drove torso vertices down to hip
   height hard. So the contract is on weight, not mere presence. */
let farCount = 0, farMax = 0, farWorstD = 0, nearCount = 0, torsoTot = 0;
for (let i = 0; i < ch.skin.wgt.length; i++) {
  if (!/^torso/.test(ch.mesh.part[i])) continue;
  torsoTot++;
  let w = 0;
  for (let k = 0; k < 4; k++) if (ARMB.has(nameOf(ch.skin.idx[i][k]))) w += ch.skin.wgt[i][k];
  if (w <= 0.02) continue;
  const p = ch.mesh.pos[i];
  const d = Math.min(S3D.vdist(p, sk.rest.shL), S3D.vdist(p, sk.rest.shR));
  if (d <= 18) { nearCount++; continue; }
  farCount++;
  if (w > farMax) { farMax = w; farWorstD = d; }
}
if (farMax > 0.25) {
  fail('a torso vertex ' + farWorstD.toFixed(1) + ' units from a shoulder is driven ' + farMax.toFixed(2) + ' by an arm bone (a wing)');
} else {
  pass('arm influence on the torso is shoulder-local in MAGNITUDE (near-shoulder verts '
    + nearCount + '; beyond 18 units ' + farCount + ', peak weight only ' + farMax.toFixed(2) + ')');
}

/* ---------- 3. per-frame invariants across every clip ---------- */
const CLIPS = Object.keys(S3D.CLIPS);
const contactTracks = { squat: ['ankleL', 'ankleR', 'toeL', 'toeR'] };
let nanCount = 0, flipCount = 0, maxLenErr = 0, maxJump = 0, minY = 1e9, maxY = -1e9;
let clampTotal = 0, clampWorst = null;
const prevLocal = {};
const prevSkin = {};

function skinnedPositions(ev) {
  const M = ev.skin, n = ch.mesh.pos.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = ch.mesh.pos[i];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = ch.skin.wgt[i][k];
      if (w <= 0) continue;
      const o = ch.skin.idx[i][k] * 16;
      x += w * (M[o] * p[0] + M[o + 4] * p[1] + M[o + 8] * p[2] + M[o + 12]);
      y += w * (M[o + 1] * p[0] + M[o + 5] * p[1] + M[o + 9] * p[2] + M[o + 13]);
      z += w * (M[o + 2] * p[0] + M[o + 6] * p[1] + M[o + 10] * p[2] + M[o + 14]);
    }
    out[i] = [x, y, z];
  }
  return out;
}

const drift = {};
CLIPS.forEach(name => {
  const clip = S3D.CLIPS[name];
  for (let i = 0; i <= FRAMES; i++) {
    const t = clip.duration * i / FRAMES;
    const ev = S3D.sample(ch, name, t);

    if (ev.ik.clamped) {
      clampTotal += ev.ik.clamped;
      if (ev.ik.worst && (!clampWorst || ev.ik.worst.over > clampWorst.over)) clampWorst = ev.ik.worst;
    }
    for (const j of sk.order) {
      const p = ev.fk.p[j];
      if (p.some(v => !isFinite(v))) nanCount++;
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
    /* bone lengths are rigid in FK — any drift means the chain math is wrong */
    sk.boneNames.forEach(j => {
      const rest = S3D.vdist(sk.rest[sk.parent[j]], sk.rest[j]);
      const posed = S3D.vdist(ev.fk.p[sk.parent[j]], ev.fk.p[j]);
      maxLenErr = Math.max(maxLenErr, Math.abs(posed - rest));
    });
    /* quaternion continuity: local rotations must never take the long way round */
    if (prevLocal[name]) {
      for (const j of Object.keys(ev.localQ)) {
        const a = prevLocal[name][j], b = ev.localQ[j];
        if (a && b) {
          const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
          if (d < 0) flipCount++;
        }
      }
    }
    prevLocal[name] = ev.localQ;

    /* mesh-level: no vertex may teleport between adjacent frames */
    const sp = skinnedPositions(ev);
    for (let v = 0; v < sp.length; v++) {
      if (!isFinite(sp[v][0])) { nanCount++; continue; }
      minY = Math.min(minY, sp[v][1]);
    }
    if (prevSkin[name]) {
      let jump = 0;
      for (let v = 0; v < sp.length; v++) jump = Math.max(jump, S3D.vdist(sp[v], prevSkin[name][v]));
      maxJump = Math.max(maxJump, jump);
    }
    prevSkin[name] = sp;

    /* contact tracking for the planted-foot clip */
    if (contactTracks[name]) {
      contactTracks[name].forEach(j => {
        if (!drift[name]) drift[name] = {};
        if (!drift[name][j]) drift[name][j] = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
        for (let a = 0; a < 3; a++) {
          drift[name][j].min[a] = Math.min(drift[name][j].min[a], ev.fk.p[j][a]);
          drift[name][j].max[a] = Math.max(drift[name][j].max[a], ev.fk.p[j][a]);
        }
      });
    }
  }
});

if (nanCount) fail(nanCount + ' non-finite values across the sampled poses');
else pass('all joints finite across ' + CLIPS.length + ' clips x ' + (FRAMES + 1) + ' frames');
if (maxLenErr > 1e-6) fail('bone length drifted by ' + maxLenErr.toFixed(6) + ' (chain math bug)');
else pass('every bone keeps its length in every pose (max drift ' + maxLenErr.toExponential(1) + ')');
if (flipCount) fail(flipCount + ' quaternion sign flips (a joint would spin the long way)');
else pass('no quaternion sign flips between adjacent frames');

/* ---------- 4. IK honesty ---------- */
if (clampTotal) {
  fail(clampTotal + ' IK solutions clamped' + (clampWorst ? ' (worst ' + clampWorst.chain + ' over by ' + clampWorst.over.toFixed(2) + ')' : ''));
} else {
  pass('every IK target was reachable with no clamping');
}

/* ---------- 5. contacts ---------- */
if (drift.squat) {
  console.log('\n  squat contact travel (planted feet), home->away full clip:');
  Object.keys(drift.squat).forEach(j => {
    const d = drift.squat[j];
    const travel = Math.hypot(d.max[0] - d.min[0], d.max[1] - d.min[1], d.max[2] - d.min[2]);
    console.log('    ' + j.padEnd(8) + ' travel ' + travel.toFixed(3)
      + '   y ' + d.min[1].toFixed(2) + '..' + d.max[1].toFixed(2));
    if (travel > 0.01) fail(j + ' slides by ' + travel.toFixed(3) + ' while it should be planted');
  });
  if (Object.keys(drift.squat).every(j => {
    const d = drift.squat[j];
    return Math.hypot(d.max[0] - d.min[0], d.max[1] - d.min[1], d.max[2] - d.min[2]) <= 0.01;
  })) pass('planted feet do not slide (IK holds them exactly)');
}

/* ---------- 6. ground + smoothness ---------- */
if (minY < -1.0) fail('mesh dips ' + minY.toFixed(2) + ' below the floor');
else pass('mesh never sinks through the floor (lowest vertex y ' + minY.toFixed(2) + ')');
console.log('        y range of the mesh: ' + minY.toFixed(1) + ' .. ' + maxY.toFixed(1));
console.log('        largest per-vertex step between adjacent frames: ' + maxJump.toFixed(2) + ' units');

console.log(bad ? '\n' + bad + ' AUDIT FAILURES' : '\nS3D AUDIT CLEAN');
process.exit(bad ? 1 : 0);
