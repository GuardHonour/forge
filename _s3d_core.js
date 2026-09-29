/* _s3d_core.js — S3D: a dependency-free 3D character + animation core.
   FORGE 3D sandbox. Runs unchanged in the browser (window.S3D) and in node
   (module.exports), so the viewer and the numeric audit share one source.

   Deliberate design choices, all cheap to keep honest:
   - Right-handed, Y up, X right, Z toward the viewer. The figure stands on y=0.
   - Bone lengths come from FORGE's own BONE table, so the 3D athlete has the
     same anatomy as the 2D technique-demo engine.
   - Joints are rest-offset chains: worldJ = worldParent * T(restOff) * R(q).
     Skin matrix = worldJ * translate(-restWorldJ). The inverse bind is a pure
     translation because the rest pose has no rotation — exact, not approximated.
   - Poses are authored as axis-angle rotations. The right side is derived by
     mirroring the left across x=0 (q -> [x,-y,-z,w]), which is the 3D analogue
     of FORGE's normDemo auto-mirroring of poleF/toeF.
   - Two-bone IK is analytic with a pole POINT (3D analogue of the 2D engine's
     pole side). An out-of-reach target reports itself instead of silently
     stretching the limb — the same honesty fitTarget gives in 2D.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.S3D = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

var D2R = Math.PI / 180;
var QID = [0, 0, 0, 1];

/* ------------------------------------------------------------------ vec3 */
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function len(a) { return Math.sqrt(dot(a, a)); }
function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function vdist(a, b) { return len(sub(a, b)); }
function lerpV(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

/* ------------------------------------------------------------------ quat [x,y,z,w] */
function qId() { return [0, 0, 0, 1]; }
function qAxis(ax, deg) {
  var a = norm(ax), s = Math.sin(deg * D2R / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(deg * D2R / 2)];
}
function qMul(a, b) {
  var ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [aw * bx + ax * bw + ay * bz - az * by,
          aw * by - ax * bz + ay * bw + az * bx,
          aw * bz + ax * by - ay * bx + az * bw,
          aw * bw - ax * bx - ay * by - az * bz];
}
function qConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }
function qNorm(q) {
  var l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
function qRot(q, v) {
  var ux = q[0], uy = q[1], uz = q[2], w = q[3];
  var cx = uy * v[2] - uz * v[1], cy = uz * v[0] - ux * v[2], cz = ux * v[1] - uy * v[0];
  var tx = cx + w * v[0], ty = cy + w * v[1], tz = cz + w * v[2];
  return [v[0] + 2 * (uy * tz - uz * ty),
          v[1] + 2 * (uz * tx - ux * tz),
          v[2] + 2 * (ux * ty - uy * tx)];
}
/* shortest arc taking unit vector a to unit vector b */
function qFromTo(a, b) {
  var d = dot(a, b);
  if (d > 0.999999) return qId();
  if (d < -0.999999) {
    var alt = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    var p = norm(cross(a, alt));
    return [p[0], p[1], p[2], 0];
  }
  var c = cross(a, b);
  return qNorm([c[0], c[1], c[2], 1 + d]);
}
function qSlerp(a, b, t) {
  var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  var bb = b;
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) {
    return qNorm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t,
                  a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
  }
  var th = Math.acos(clamp(d, -1, 1)), s = Math.sin(th);
  var wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb,
          a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
}
/* mirror across x=0: derived from R' = M R M^-1 with M = diag(-1,1,1),
   which gives axis M*n with negated angle -> (x,-y,-z,w). Verified on the
   +90 about Z (-> -90 about Z) and +90 about X (-> unchanged) cases. */
function qMirror(q) { return [q[0], -q[1], -q[2], q[3]]; }

/* ------------------------------------------------------------------ mat4, column major */
function m4Id() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function m4Mul(a, b) {
  var o = new Array(16);
  for (var c = 0; c < 4; c++) {
    for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
                   + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
function m4FromQ(q) {
  var x = q[0], y = q[1], z = q[2], w = q[3];
  var x2 = x + x, y2 = y + y, z2 = z + z;
  var xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  var wx = w * x2, wy = w * y2, wz = w * z2;
  return [1 - (yy + zz), xy + wz, xz - wy, 0,
          xy - wz, 1 - (xx + zz), yz + wx, 0,
          xz + wy, yz - wx, 1 - (xx + yy), 0,
          0, 0, 0, 1];
}
function m4TR(q, t) { var m = m4FromQ(q); m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; return m; }
function m4T(t) { var m = m4Id(); m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; return m; }
function m4Xf(m, p) {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
          m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
          m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}
function m4Persp(fovyDeg, aspect, near, far) {
  var f = 1 / Math.tan(fovyDeg * D2R / 2);
  return [f / aspect, 0, 0, 0,
          0, f, 0, 0,
          0, 0, (far + near) / (near - far), -1,
          0, 0, (2 * far * near) / (near - far), 0];
}
function m4Ortho(halfW, halfH, near, far) {
  return [1 / halfW, 0, 0, 0,
          0, 1 / halfH, 0, 0,
          0, 0, -2 / (far - near), 0,
          0, 0, -(far + near) / (far - near), 1];
}
function m4LookAt(eye, ctr, up) {
  var z = norm(sub(eye, ctr));
  var x = norm(cross(up, z));
  var y = cross(z, x);
  return [x[0], y[0], z[0], 0,
          x[1], y[1], z[1], 0,
          x[2], y[2], z[2], 0,
          -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}

/* ------------------------------------------------------------------ skeleton */
var BONE = { torso: 36, neck: 6.5, head: 8.4, upper: 24, fore: 19.5, thigh: 32.5, shin: 30.3, foot: 9 };

function buildSkeleton() {
  var ANKLE_Y = 9;
  var kneeY = ANKLE_Y + BONE.shin;               /* 39.3 */
  var hipY = kneeY + BONE.thigh;                 /* 71.8 */
  var neckY = hipY + BONE.torso;                 /* 107.8 */
  var headY = neckY + BONE.neck;                 /* 114.3 */
  var chestY = hipY + BONE.torso * 2 / 3;        /* 95.8 */
  var spineY = hipY + BONE.torso / 3;            /* 83.8 */

  var shPos = [4.5, neckY - 3.3, 0];
  /* A-pose rest: 42 degrees of shoulder abduction. This is not cosmetic. With
     the arms hanging straight down the forearm lies against the thigh and the
     elbow against the waist, the smooth-min union fuses arm to torso down its
     whole side, and the blend zone then drags the torso with every arm swing.
     Riggers model an A-pose for exactly this reason. The clips author arm
     angles relative to this rest, so their abduction is offset by A_POSE. */
  var A_POSE = 42;
  var upDir = norm([Math.sin(A_POSE * D2R), -Math.cos(A_POSE * D2R), 0.05]);
  var foreDir = norm([Math.sin((A_POSE - 8) * D2R), -Math.cos((A_POSE - 8) * D2R), 0.12]);
  var elb = add(shPos, mul(upDir, BONE.upper));
  var wr = add(elb, mul(foreDir, BONE.fore));
  var hand = add(wr, mul(foreDir, 7));

  var P = {
    hips: [0, hipY, 0], spine: [0, spineY, 0], chest: [0, chestY, 0],
    neck: [0, neckY, 0], head: [0, headY, 0]
  };
  var parent = { hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck' };
  [['L', 1], ['R', -1]].forEach(function (sd) {
    var s = sd[0], k = sd[1];
    P['sh' + s] = [shPos[0] * k, shPos[1], shPos[2]];
    P['elb' + s] = [elb[0] * k, elb[1], elb[2]];
    P['wr' + s] = [wr[0] * k, wr[1], wr[2]];
    P['hand' + s] = [hand[0] * k, hand[1], hand[2]];
    P['hip' + s] = [6.5 * k, hipY, 0];
    P['knee' + s] = [7.5 * k, kneeY, 0];
    P['ankle' + s] = [8 * k, ANKLE_Y, 0];
    P['toe' + s] = [8 * k, 3.0, 9];
    parent['sh' + s] = 'chest'; parent['elb' + s] = 'sh' + s;
    parent['wr' + s] = 'elb' + s; parent['hand' + s] = 'wr' + s;
    parent['hip' + s] = 'hips'; parent['knee' + s] = 'hip' + s;
    parent['ankle' + s] = 'knee' + s; parent['toe' + s] = 'ankle' + s;
  });

  var order = [];
  (function walk(j) {
    order.push(j);
    Object.keys(parent).forEach(function (c) { if (parent[c] === j) walk(c); });
  })('hips');

  var rest = {}, off = {};
  order.forEach(function (j) {
    rest[j] = P[j];
    off[j] = parent[j] ? sub(P[j], P[parent[j]]) : P[j];
  });

  var R = {
    torsoLo: [11.0, 12.0], torsoMid: [12.0, 13.0], torsoUp: [13.0, 6.4],
    neck: [4.6, 4.4], clav: [5.2, 4.4], upper: [4.4, 3.7], fore: [3.7, 2.9],
    hand: [2.9, 2.3], thigh: [6.9, 5.2], shin: [5.2, 3.4], foot: [3.4, 3.0]
  };
  var segs = [];
  segs.push({ a: 'hips', b: 'spine', r: R.torsoLo, region: 'torsoLo' });
  segs.push({ a: 'spine', b: 'chest', r: R.torsoMid, region: 'torsoMid' });
  segs.push({ a: 'chest', b: 'neck', r: R.torsoUp, region: 'torsoUp' });
  segs.push({ a: 'neck', b: 'head', r: R.neck, region: 'neckC' });
  [['L', 1], ['R', -1]].forEach(function (sd) {
    var s = sd[0];
    segs.push({ a: 'chest', b: 'sh' + s, r: R.clav, region: 'clav' + s });
    segs.push({ a: 'sh' + s, b: 'elb' + s, r: R.upper, region: 'arm' + s });
    segs.push({ a: 'elb' + s, b: 'wr' + s, r: R.fore, region: 'fore' + s });
    segs.push({ a: 'wr' + s, b: 'hand' + s, r: R.hand, region: 'hand' + s });
    segs.push({ a: 'hip' + s, b: 'knee' + s, r: R.thigh, region: 'thigh' + s });
    segs.push({ a: 'knee' + s, b: 'ankle' + s, r: R.shin, region: 'shin' + s });
    segs.push({ a: 'ankle' + s, b: 'toe' + s, r: R.foot, region: 'foot' + s });
  });
  /* A segment binds to its PROXIMAL joint — the joint it hangs from. Binding to
     the distal joint is subtly wrong: skin(v) = worldJ * invBind(J) and worldJ
     contains J's own rotation, so a distal bind makes the thigh rotate *about
     the knee* when the knee bends, and drags the thigh backwards through a
     squat. The clavicle falls out of this rule correctly: proximal = chest, so
     a raised arm no longer sweeps the shoulder yoke into a wing. */
  segs.forEach(function (sg) { sg.bind = sg.a; });

  var index = {};
  order.forEach(function (j, i) { index[j] = i; });

  return {
    order: order, parent: parent, rest: rest, off: off, segs: segs, index: index,
    head: { center: add(P.head, [0, BONE.head * 1.05, 0.4]), radii: [7.6, 9.6, 8.6] },
    boneNames: order.filter(function (j) { return parent[j]; })
  };
}

/* ------------------------------------------------------------------ geometry */
function distPointSeg(p, a, b) {
  var ab = sub(b, a), t = dot(sub(p, a), ab) / (dot(ab, ab) || 1);
  return vdist(p, add(a, mul(ab, clamp(t, 0, 1))));
}

function ringsToMesh(A, axis, u, v, rings, segs) {
  var pos = [], idx = [], rowIdx = [], r, i;
  for (r = 0; r < rings.length; r++) {
    var t = rings[r][0], rad = rings[r][1];
    if (rad < 1e-6) {
      rowIdx.push([pos.length]);
      pos.push(add(A, mul(axis, t)));
    } else {
      var row = [];
      for (i = 0; i < segs; i++) {
        var a = 2 * Math.PI * i / segs;
        var radial = add(mul(u, Math.cos(a) * rad), mul(v, Math.sin(a) * rad));
        row.push(pos.length);
        pos.push(add(add(A, mul(axis, t)), radial));
      }
      rowIdx.push(row);
    }
  }
  for (r = 0; r < rowIdx.length - 1; r++) {
    var ra = rowIdx[r], rb = rowIdx[r + 1];
    if (ra.length === 1) { for (i = 0; i < segs; i++) idx.push(ra[0], rb[i], rb[(i + 1) % segs]); }
    else if (rb.length === 1) { for (i = 0; i < segs; i++) idx.push(ra[i], rb[0], ra[(i + 1) % segs]); }
    else {
      for (i = 0; i < segs; i++) {
        var i2 = (i + 1) % segs;
        idx.push(ra[i], rb[i], ra[i2], ra[i2], rb[i], rb[i2]);
      }
    }
  }
  return { pos: pos, idx: idx };
}

function capsule(A, B, rA, rB, segs, capRings, bodyRings) {
  var axis = norm(sub(B, A)), L = vdist(A, B);
  var t1 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  var u = norm(cross(axis, t1)), v = cross(axis, u);
  var rings = [], i, f, ph;
  for (i = 0; i <= capRings; i++) {
    f = i / capRings; ph = -Math.PI / 2 + f * (Math.PI / 2);
    rings.push([rA * Math.sin(ph), rA * Math.cos(ph)]);
  }
  for (i = 1; i < bodyRings; i++) {
    f = i / bodyRings; rings.push([L * f, rA + (rB - rA) * f]);
  }
  for (i = 0; i <= capRings; i++) {
    f = i / capRings; ph = f * (Math.PI / 2);
    rings.push([L + rB * Math.sin(ph), rB * Math.cos(ph)]);
  }
  return ringsToMesh(A, axis, u, v, rings, segs);
}

function ellipsoid(center, radii, segs, rings) {
  var pos = [], idx = [], i, j, rowIdx = [];
  for (j = 0; j <= rings; j++) {
    var phi = Math.PI * j / rings, sy = Math.cos(phi), rr = Math.sin(phi);
    var row = [];
    if (rr < 1e-6) {
      row.push(pos.length);
      pos.push([center[0], center[1] + radii[1] * sy, center[2]]);
    } else {
      for (i = 0; i < segs; i++) {
        var th = 2 * Math.PI * i / segs;
        row.push(pos.length);
        pos.push([center[0] + radii[0] * rr * Math.sin(th),
                  center[1] + radii[1] * sy,
                  center[2] + radii[2] * rr * Math.cos(th)]);
      }
    }
    rowIdx.push(row);
  }
  for (j = 0; j < rowIdx.length - 1; j++) {
    var a = rowIdx[j], b = rowIdx[j + 1];
    if (a.length === 1) { for (i = 0; i < segs; i++) idx.push(a[0], b[i], b[(i + 1) % segs]); }
    else if (b.length === 1) { for (i = 0; i < segs; i++) idx.push(a[i], b[0], a[(i + 1) % segs]); }
    else {
      for (i = 0; i < segs; i++) {
        var i2 = (i + 1) % segs;
        idx.push(a[i], b[i], a[i2], a[i2], b[i], b[i2]);
      }
    }
  }
  return { pos: pos, idx: idx };
}

function computeNormals(pos, idx) {
  var n = [], i;
  for (i = 0; i < pos.length; i++) n.push([0, 0, 0]);
  for (var t = 0; t < idx.length; t += 3) {
    var a = pos[idx[t]], b = pos[idx[t + 1]], c = pos[idx[t + 2]];
    var f = cross(sub(b, a), sub(c, a));
    n[idx[t]] = add(n[idx[t]], f);
    n[idx[t + 1]] = add(n[idx[t + 1]], f);
    n[idx[t + 2]] = add(n[idx[t + 2]], f);
  }
  for (i = 0; i < n.length; i++) {
    var l = len(n[i]);
    n[i] = l > 1e-9 ? mul(n[i], 1 / l) : [0, 1, 0];
  }
  return n;
}

/* Limb-aware masking. Pure distance bleeds across the whole body — measured on
   the first build: torso vertices took up to 0.52 of their weight from arm
   bones, and thigh vertices up to 0.55 from the hand bones, because a hand at
   rest hangs beside the thigh. Each mesh region may therefore only be driven by
   its own local bones. This is the cheap, honest substitute for the bone-heat
   diffusion a real DCC tool ships; it is not as good, and that is the point of
   measuring it rather than assuming it. */
var REGION = {
  torsoLo: ['hips', 'spine'],
  torsoMid: ['spine', 'chest', 'hips'],
  torsoUp: ['chest', 'spine', 'neck'],
  neckC: ['neck', 'head'],
  head: ['head', 'neck'],
  clavL: ['chest'], clavR: ['chest'],
  armL: ['shL', 'elbL', 'chest'], armR: ['shR', 'elbR', 'chest'],
  foreL: ['elbL', 'wrL'], foreR: ['elbR', 'wrR'],
  handL: ['wrL'], handR: ['wrR'],
  thighL: ['hipL', 'kneeL', 'hips'], thighR: ['hipR', 'kneeR', 'hips'],
  shinL: ['kneeL', 'ankleL'], shinR: ['kneeR', 'ankleR'],
  footL: ['ankleL'], footR: ['ankleR']
};

/* envelope weights: nearby bones own the vertex, scaled by bone thickness */
function computeWeights(sk, mesh) {
  var segInfo = sk.segs.map(function (sg) {
    return { a: sk.rest[sg.a], b: sk.rest[sg.b], bind: sk.index[sg.bind], name: sg.bind,
             r: (sg.r[0] + sg.r[1]) / 2 };
  });
  var idx4 = [], w4 = [];
  for (var i = 0; i < mesh.pos.length; i++) {
    var p = mesh.pos[i], byJoint = {};
    var allowed = (mesh.allowed && mesh.allowed[i]) || REGION[mesh.part[i]];
    for (var j = 0; j < segInfo.length; j++) {
      var sg = segInfo[j];
      if (allowed && allowed.indexOf(sg.name) < 0) continue;
      var d = distPointSeg(p, sg.a, sg.b);
      var w = Math.pow(sg.r / (d + 0.5), 3);
      byJoint[sg.bind] = (byJoint[sg.bind] || 0) + w;
    }
    var cand = Object.keys(byJoint).map(function (k) { return { idx: +k, w: byJoint[k] }; });
    if (!cand.length) {                       /* defensive: never leave a vertex unbound */
      for (var j2 = 0; j2 < segInfo.length; j2++) {
        var s2 = segInfo[j2];
        var d2 = distPointSeg(p, s2.a, s2.b);
        byJoint[s2.bind] = (byJoint[s2.bind] || 0) + Math.pow(s2.r / (d2 + 0.5), 3);
      }
      cand = Object.keys(byJoint).map(function (k) { return { idx: +k, w: byJoint[k] }; });
    }
    cand.sort(function (a, b) { return b.w - a.w; });
    cand = cand.slice(0, 4);
    var tot = 0;
    cand.forEach(function (c) { tot += c.w; });
    tot = tot || 1;
    var I = [0, 0, 0, 0], Wv = [0, 0, 0, 0];
    for (var k = 0; k < cand.length; k++) { I[k] = cand[k].idx; Wv[k] = cand[k].w / tot; }
    idx4.push(I); w4.push(Wv);
  }
  return { idx: idx4, wgt: w4 };
}

/* Neighbour smoothing — the cheapest honest way to kill hard weight seams.
   It deliberately does NOT diffuse across a region boundary. Where a hanging
   arm touches the waist, both the arm and the torso legitimately own the
   surface, so a cross-region average quietly painted 0.22 of arm onto torso
   vertices that the envelope had given 0.02 — the wing, rebuilt by the
   smoother after the mask had removed it. Within a region it still softens
   every seam, which is all it was for. */
function smoothWeights(mesh, W, iterations, alpha) {
  var adj = [], i;
  for (i = 0; i < mesh.pos.length; i++) adj.push({});
  for (var t = 0; t < mesh.idx.length; t += 3) {
    var a = mesh.idx[t], b = mesh.idx[t + 1], c = mesh.idx[t + 2];
    adj[a][b] = 1; adj[b][a] = 1; adj[b][c] = 1; adj[c][b] = 1; adj[a][c] = 1; adj[c][a] = 1;
  }
  var cur = W;
  for (var it = 0; it < iterations; it++) {
    var oi = [], ow = [];
    for (var v = 0; v < mesh.pos.length; v++) {
      var acc = {}, k, nb = [], n2;
      for (k = 0; k < 4; k++) if (cur.wgt[v][k] > 0) acc[cur.idx[v][k]] = (acc[cur.idx[v][k]] || 0) + cur.wgt[v][k] * (1 - alpha);
      var nbs = Object.keys(adj[v]);
      for (n2 = 0; n2 < nbs.length; n2++) {
        var uu = +nbs[n2];
        if (mesh.part && mesh.part[uu] === mesh.part[v]) nb.push(uu);
      }
      for (n2 = 0; n2 < nb.length; n2++) {
        var u = nb[n2];
        for (k = 0; k < 4; k++) {
          if (cur.wgt[u][k] > 0) acc[cur.idx[u][k]] = (acc[cur.idx[u][k]] || 0) + cur.wgt[u][k] * alpha / nb.length;
        }
      }
      var arr = Object.keys(acc).map(function (kk) { return { idx: +kk, w: acc[kk] }; });
      arr.sort(function (x, y) { return y.w - x.w; });
      arr = arr.slice(0, 4);
      var tot = 0;
      arr.forEach(function (o) { tot += o.w; });
      tot = tot || 1;
      var I = [0, 0, 0, 0], Wv = [0, 0, 0, 0];
      for (var m = 0; m < arr.length; m++) { I[m] = arr[m].idx; Wv[m] = arr[m].w / tot; }
      oi.push(I); ow.push(Wv);
    }
    cur = { idx: oi, wgt: ow };
  }
  return cur;
}

/* ------------------------------------------------------------------ SDF body
   Overlapping capsules look like overlapping capsules: every joint shows a seam
   where two primitives cross. Meshing one smooth surface out of the same
   primitives fixes that at the source. The field is a smooth-min union of the
   very same capsules, meshed by marching TETRAHEDRA — which needs no 256-entry
   edge/tri tables (nothing to mistype, and it is watertight by construction
   because all six tetrahedra in a cube share the main diagonal).
   The field is reused for skinning: a vertex is allowed to be driven by exactly
   the regions whose primitives reach it, so the welded surface and the weights
   come from one source of truth. */
function sdfSeg(p, a, b, ra, rb) {
  var ab = sub(b, a), ap = sub(p, a);
  var t = clamp(dot(ap, ab) / (dot(ab, ab) || 1), 0, 1);
  return vdist(p, add(a, mul(ab, t))) - (ra + (rb - ra) * t);
}
function sdfEllipsoid(p, c, r) {
  var q = [(p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]];
  return (len(q) - 1) * Math.min(r[0], r[1], r[2]);
}
function smin(a, b, k) {
  var h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return b * (1 - h) + a * h - k * h * (1 - h);
}

function fieldPrims(sk) {
  var prims = sk.segs.map(function (sg) {
    return { a: sk.rest[sg.a], b: sk.rest[sg.b], ra: sg.r[0], rb: sg.r[1],
             region: sg.region, bind: sg.bind };
  });
  prims.push({ head: true, c: sk.head.center, r: sk.head.radii, region: 'head', bind: 'head' });
  return prims;
}
function primDist(pr, p) {
  return pr.head ? sdfEllipsoid(p, pr.c, pr.r) : sdfSeg(p, pr.a, pr.b, pr.ra, pr.rb);
}

function buildSDFMesh(sk, opt) {
  opt = opt || {};
  var res = opt.res || 1.3, K = opt.k === undefined ? 0.9 : opt.k;
  var lo = [-46, -4, -42], hi = [46, 158, 42];
  var NX = Math.ceil((hi[0] - lo[0]) / res) + 1;
  var NY = Math.ceil((hi[1] - lo[1]) / res) + 1;
  var NZ = Math.ceil((hi[2] - lo[2]) / res) + 1;
  var prims = fieldPrims(sk);
  var IDX = function (i, j, k) { return (i * NY + j) * NZ + k; };

  var vals = new Float32Array(NX * NY * NZ);
  var p = [0, 0, 0], i, j, k, m;
  for (i = 0; i < NX; i++) {
    p[0] = lo[0] + i * res;
    for (j = 0; j < NY; j++) {
      p[1] = lo[1] + j * res;
      for (k = 0; k < NZ; k++) {
        p[2] = lo[2] + k * res;
        var d = primDist(prims[0], p);
        for (m = 1; m < prims.length; m++) d = smin(d, primDist(prims[m], p), K);
        vals[IDX(i, j, k)] = d;
      }
    }
  }

  var OFF = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  var TETS = [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]];
  var pos = [], idx = [], part = [], allowed = [];
  var cv = new Float64Array(8), cp = new Array(8);

  function vert(c0, c1) {
    var v0 = cv[c0], v1 = cv[c1];
    var s = v0 / (v0 - v1 || 1e-9);
    var a = cp[c0], b = cp[c1];
    pos.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]);
    return pos.length - 1;
  }

  for (i = 0; i < NX - 1; i++) {
    for (j = 0; j < NY - 1; j++) {
      for (k = 0; k < NZ - 1; k++) {
        var allIn = true, allOut = true;
        for (var c = 0; c < 8; c++) {
          var o = OFF[c];
          var v = vals[IDX(i + o[0], j + o[1], k + o[2])];
          cv[c] = v;
          cp[c] = [lo[0] + (i + o[0]) * res, lo[1] + (j + o[1]) * res, lo[2] + (k + o[2]) * res];
          if (v < 0) allOut = false; else allIn = false;
        }
        if (allIn || allOut) continue;
        for (var t = 0; t < 6; t++) {
          var tt = TETS[t], ins = [], outs = [];
          for (var n = 0; n < 4; n++) (cv[tt[n]] < 0 ? ins : outs).push(tt[n]);
          if (!ins.length || !outs.length) continue;
          if (ins.length === 1) {
            var a0 = ins[0];
            idx.push(vert(a0, outs[0]), vert(a0, outs[1]), vert(a0, outs[2]));
          } else if (ins.length === 3) {
            var o0 = outs[0];
            idx.push(vert(o0, ins[0]), vert(o0, ins[1]), vert(o0, ins[2]));
          } else {
            var i1 = ins[0], i2 = ins[1], o1 = outs[0], o2 = outs[1];
            var q1 = vert(i1, o1), q2 = vert(i1, o2), q3 = vert(i2, o2), q4 = vert(i2, o1);
            idx.push(q1, q2, q3, q1, q3, q4);
          }
        }
      }
    }
  }

  /* weights straight from the field: a vertex may be driven by the regions of
     the primitives that actually REACH it. The gate is relative to the nearest
     primitive, not an absolute distance — an absolute one licensed arm bones
     across 15k torso vertices, because the arm capsule genuinely passes close
     to the torso all the way down. Relativity is the right question: which
     primitives contribute to this point's blend of the union. */
  for (var v2 = 0; v2 < pos.length; v2++) {
    var pp = pos[v2], best = 1e9, bestRegion = 'torsoMid';
    var ds = new Array(prims.length);
    for (var m2 = 0; m2 < prims.length; m2++) {
      var d2 = primDist(prims[m2], pp);
      ds[m2] = d2;
      if (d2 < best) { best = d2; bestRegion = prims[m2].region; }
    }
    var allow = {}, gate = best + 2.2;
    for (var m3 = 0; m3 < prims.length; m3++) {
      if (ds[m3] > gate) continue;
      var reg = REGION[prims[m3].region] || [];
      for (var r3 = 0; r3 < reg.length; r3++) allow[reg[r3]] = 1;
    }
    part.push(bestRegion);
    allowed.push(Object.keys(allow));
  }
  return { pos: pos, idx: idx, part: part, allowed: allowed };
}

/* Smoothing runs across mesh neighbours, and on a welded body it freely crosses
   regions — it put 0.31 of the chest bone into a head vertex. So the region
   contract is re-asserted AFTER smoothing: a vertex may redistribute only among
   its own allowed bones, falling back to its pre-smoothing weights if the
   smoothed neighbourhood left it nothing legal to hold. Without this the whole
   limb-masking scheme is decorative. */
function filterW(src, i, sk, allowed) {
  var I = [0, 0, 0, 0], V = [0, 0, 0, 0], tot = 0;
  for (var k = 0; k < 4; k++) {
    var j = src.idx[i][k], w = src.wgt[i][k];
    if (w <= 0) continue;
    if (allowed && allowed.indexOf(sk.order[j]) < 0) continue;
    I[k] = j; V[k] = w; tot += w;
  }
  return { idx: I, w: V, tot: tot };
}
function maskWeights(sk, mesh, raw, W) {
  var idx4 = [], w4 = [];
  for (var i = 0; i < mesh.pos.length; i++) {
    var allowed = (mesh.allowed && mesh.allowed[i]) || REGION[mesh.part[i]] || null;
    var out = filterW(W, i, sk, allowed);
    if (out.tot <= 1e-9) out = filterW(raw, i, sk, allowed);
    if (out.tot <= 1e-9) out = filterW(raw, i, sk, null);
    var I = [0, 0, 0, 0], V = [0, 0, 0, 0];
    for (var k = 0; k < 4; k++) { I[k] = out.idx[k]; V[k] = out.w[k] / out.tot; }
    idx4.push(I); w4.push(V);
  }
  return { idx: idx4, wgt: w4 };
}

function buildCharacter(mode) {
  var sk = buildSkeleton();
  var mesh;
  if (mode === 'capsules') {
    var pos = [], idx = [], part = [], allow = [];
    sk.segs.forEach(function (sg) {
      var m = capsule(sk.rest[sg.a], sk.rest[sg.b], sg.r[0], sg.r[1], 12, 4, 6);
      var base = pos.length;
      m.pos.forEach(function (p) { pos.push(p); part.push(sg.region); allow.push(REGION[sg.region]); });
      m.idx.forEach(function (i) { idx.push(base + i); });
    });
    var hm = ellipsoid(sk.head.center, sk.head.radii, 14, 10);
    var hbase = pos.length;
    hm.pos.forEach(function (p) { pos.push(p); part.push('head'); allow.push(REGION.head); });
    hm.idx.forEach(function (i) { idx.push(hbase + i); });
    mesh = { pos: pos, idx: idx, part: part, allowed: allow };
  } else {
    mesh = buildSDFMesh(sk);
  }
  mesh.nrm = computeNormals(mesh.pos, mesh.idx);
  var raw = computeWeights(sk, mesh);
  var W = maskWeights(sk, mesh, raw, smoothWeights(mesh, raw, 2, 0.3));
  return { sk: sk, mesh: mesh, skin: W };
}

/* pack for WebGL: one interleaved set of typed arrays. Indices are 32-bit
   because the welded surface passes 65k vertices — WebGL2 takes UNSIGNED_INT
   natively, no extension needed. */
function packGeometry(ch) {
  var n = ch.mesh.pos.length;
  var pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  var bi = new Float32Array(n * 4), bw = new Float32Array(n * 4);
  for (var i = 0; i < n; i++) {
    pos[i * 3] = ch.mesh.pos[i][0]; pos[i * 3 + 1] = ch.mesh.pos[i][1]; pos[i * 3 + 2] = ch.mesh.pos[i][2];
    nrm[i * 3] = ch.mesh.nrm[i][0]; nrm[i * 3 + 1] = ch.mesh.nrm[i][1]; nrm[i * 3 + 2] = ch.mesh.nrm[i][2];
    for (var k = 0; k < 4; k++) { bi[i * 4 + k] = ch.skin.idx[i][k]; bw[i * 4 + k] = ch.skin.wgt[i][k]; }
  }
  return { pos: pos, nrm: nrm, bi: bi, bw: bw, idx: new Uint32Array(ch.mesh.idx),
           joints: ch.sk.order.length, bones: ch.sk.boneNames.length };
}

/* ------------------------------------------------------------------ forward kinematics */
function fk(sk, q, rootPos) {
  var worldQ = {}, worldM = {}, worldP = {}, root = rootPos || [0, 0, 0];
  sk.order.forEach(function (j) {
    var lq = q[j] || QID;
    var p = sk.parent[j];
    if (!p) {
      worldQ[j] = lq;
      worldM[j] = m4TR(lq, add(sk.off[j], root));
    } else {
      worldQ[j] = qMul(worldQ[p], lq);
      var wp = m4Xf(worldM[p], sk.off[j]);
      worldM[j] = m4TR(worldQ[j], wp);
    }
    worldP[j] = [worldM[j][12], worldM[j][13], worldM[j][14]];
  });
  return { q: worldQ, m: worldM, p: worldP };
}

function skinMatrices(sk, W) {
  var out = new Float32Array(sk.order.length * 16);
  sk.order.forEach(function (j, i) {
    var inv = m4T([-sk.rest[j][0], -sk.rest[j][1], -sk.rest[j][2]]);
    var sm = m4Mul(W.m[j], inv);
    for (var k = 0; k < 16; k++) out[i * 16 + k] = sm[k];
  });
  return out;
}

/* ------------------------------------------------------------------ two-bone IK */
var CHAINS = {
  armL: ['shL', 'elbL', 'wrL'], armR: ['shR', 'elbR', 'wrR'],
  legL: ['hipL', 'kneeL', 'ankleL'], legR: ['hipR', 'kneeR', 'ankleR']
};

function ikTwoBone(sk, chainName, target, polePoint, q, W) {
  var chain = CHAINS[chainName];
  var A = chain[0], B = chain[1], C = chain[2];
  var L1 = vdist(sk.rest[B], sk.rest[A]);
  var L2 = vdist(sk.rest[C], sk.rest[B]);
  var WpA = W.q[sk.parent[A]];
  var Apos = W.p[A];
  var toT = sub(target, Apos);
  var d = len(toT);
  var dmax = L1 + L2, dmin = Math.abs(L1 - L2);
  var dc = clamp(d, dmin + 0.01, dmax - 0.01);
  /* A target is only "out of reach" if it genuinely exceeds the limb. Sitting
     on the fully-extended limit is legitimate (a straight leg at the top of a
     squat), so it must not be reported as a failure — the same distinction
     FORGE's 2D engine draws between an authored error and hitting full
     extension. dc stays clamped for numeric stability either way. */
  var over = Math.max(0, d - dmax) + Math.max(0, dmin - d);
  var clamped = over > 1e-4;
  var u = d > 1e-6 ? mul(toT, 1 / d) : [0, -1, 0];
  var pv = sub(polePoint, Apos);
  var pp = sub(pv, mul(u, dot(pv, u)));
  if (len(pp) < 1e-5) {
    var alt = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    pp = sub(alt, mul(u, dot(alt, u)));
  }
  pp = norm(pp);
  var cosA = (L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc);
  var a1 = Math.acos(clamp(cosA, -1, 1));
  var E = add(Apos, add(mul(u, L1 * Math.cos(a1)), mul(pp, L1 * Math.sin(a1))));

  /* aim the first bone at the solved joint position, then the second at the target */
  var dirA = norm(sub(sk.rest[B], sk.rest[A]));
  var RA = qFromTo(qRot(WpA, dirA), norm(sub(E, Apos)));
  q[A] = qMul(qMul(qConj(WpA), RA), WpA);

  var WA = qMul(WpA, q[A]);
  var dirB = norm(sub(sk.rest[C], sk.rest[B]));
  var RB = qFromTo(qRot(WA, dirB), norm(sub(target, E)));
  q[B] = qMul(qMul(qConj(WA), RB), WA);

  return { clamped: clamped, over: over, joint: E, reach: d, maxReach: dmax, minReach: dmin };
}

/* keep a foot pointing the way it points at rest (flat on the floor) while the
   shin tilts — the ankle angle absorbs the difference, as it does in life */
function levelFoot(sk, ankle, toe, q, W) {
  var Wp = W.q[sk.parent[ankle]];
  var dir = norm(sub(sk.rest[toe], sk.rest[ankle]));
  var R = qFromTo(qRot(Wp, dir), dir);
  q[ankle] = qMul(qMul(qConj(Wp), R), Wp);
}

/* ------------------------------------------------------------------ clips */
function qA(axis, deg) { return qAxis(axis, deg); }
/* author the left side; the right side is the mirror of it */
function both(p) {
  var o = {};
  Object.keys(p).forEach(function (k) {
    o[k] = p[k];
    if (/L$/.test(k)) o[k.slice(0, -1) + 'R'] = qMirror(p[k]);
  });
  return o;
}

var CLIPS = {};

CLIPS.twist = {
  name: 'twist', duration: 3.2, loop: true,
  desc: 'standing torso twist, arms held out \u2014 skin-deformation stress test',
  keys: [
    { t: 0.0, p: {} },
    { t: 0.9, p: both({ spine: qA([0, 1, 0], 34), chest: qA([0, 1, 0], 20), neck: qA([0, 1, 0], 10), head: qA([0, 1, 0], -16), shL: qA([0, 0, 1], 48), elbL: qA([1, 0, 0], -38) }) },
    { t: 1.7, p: both({ spine: qA([0, 1, 0], -34), chest: qA([0, 1, 0], -20), neck: qA([0, 1, 0], -10), head: qA([0, 1, 0], 16), shL: qA([0, 0, 1], 48), elbL: qA([1, 0, 0], -38) }) },
    { t: 2.5, p: both({ spine: qA([0, 1, 0], 12), chest: qA([0, 1, 0], 8), head: qA([0, 1, 0], -6), shL: qA([0, 0, 1], 14), elbL: qA([1, 0, 0], -20) }) },
    { t: 3.2, p: {} }
  ]
};

CLIPS.squat = {
  name: 'squat', duration: 3.6, loop: true,
  desc: 'hip translation with planted feet solved by two-bone IK',
  keys: [
    { t: 0.0, p: {}, root: [0, 0, 0],
      ik: { legL: { t: [8, 9, 0], pole: [6, 42, 70], level: 'toeL' },
            legR: { t: [-8, 9, 0], pole: [-6, 42, 70], level: 'toeR' } } },
    { t: 1.3, p: both({ spine: qA([1, 0, 0], 18), chest: qA([1, 0, 0], 9), head: qA([1, 0, 0], -22),
                        shL: qA([1, 0, 0], -52), elbL: qA([1, 0, 0], -26) }), root: [0, -34, 0],
      ik: { legL: { t: [8, 9, 0], pole: [6, 46, 74], level: 'toeL' },
            legR: { t: [-8, 9, 0], pole: [-6, 46, 74], level: 'toeR' } } },
    { t: 1.9, p: both({ spine: qA([1, 0, 0], 20), chest: qA([1, 0, 0], 10), head: qA([1, 0, 0], -24),
                        shL: qA([1, 0, 0], -56), elbL: qA([1, 0, 0], -28) }), root: [0, -37, 0],
      ik: { legL: { t: [8, 9, 0], pole: [6, 46, 76], level: 'toeL' },
            legR: { t: [-8, 9, 0], pole: [-6, 46, 76], level: 'toeR' } } },
    { t: 3.6, p: {}, root: [0, 0, 0],
      ik: { legL: { t: [8, 9, 0], pole: [6, 42, 70], level: 'toeL' },
            legR: { t: [-8, 9, 0], pole: [-6, 42, 70], level: 'toeR' } } }
  ]
};

CLIPS.reach = {
  name: 'reach', duration: 3.0, loop: true,
  desc: 'asymmetric overhead reach \u2014 shoulder taken to its extreme',
  keys: [
    { t: 0.0, p: {} },
    { t: 1.1, p: { shL: qA([0, 0, 1], 138), elbL: qA([1, 0, 0], -14), shR: qA([0, 0, 1], 30),
                   chest: qA([0, 0, 1], 7), head: qA([0, 0, 1], 9) } },
    { t: 1.8, p: { shL: qA([0, 0, 1], 144), elbL: qA([1, 0, 0], -10), shR: qA([0, 0, 1], 34),
                   chest: qA([0, 0, 1], 9), head: qA([0, 0, 1], 11) } },
    { t: 3.0, p: {} }
  ]
};

/* ------------------------------------------------------------------ clip evaluation */
function evalClip(sk, clip, time) {
  var dur = clip.duration;
  var t = clip.loop ? ((time % dur) + dur) % dur : clamp(time, 0, dur);
  var keys = clip.keys, k0 = keys[0], k1 = keys[keys.length - 1];
  for (var i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) { k0 = keys[i]; k1 = keys[i + 1]; break; }
  }
  var span = Math.max(1e-6, k1.t - k0.t);
  var f = clamp((t - k0.t) / span, 0, 1);
  f = f * f * (3 - 2 * f);                       /* smoothstep ease */

  var q = {}, names = {};
  Object.keys(k0.p || {}).forEach(function (n) { names[n] = 1; });
  Object.keys(k1.p || {}).forEach(function (n) { names[n] = 1; });
  Object.keys(names).forEach(function (n) {
    q[n] = qSlerp((k0.p && k0.p[n]) || QID, (k1.p && k1.p[n]) || QID, f);
  });

  var r0 = k0.root || [0, 0, 0], r1 = k1.root || [0, 0, 0];
  var root = lerpV(r0, r1, f);

  var W = fk(sk, q, root);
  var ikInfo = { clamped: 0, worst: null };

  if (k0.ik && k1.ik) {
    Object.keys(k0.ik).forEach(function (name) {
      var a = k0.ik[name], b = k1.ik[name];
      if (!a || !b) return;
      var target = lerpV(a.t, b.t, f);
      var pole = lerpV(a.pole || [0, 0, 1], b.pole || [0, 0, 1], f);
      var res = ikTwoBone(sk, name, target, pole, q, W);
      if (res.clamped) {
        ikInfo.clamped++;
        if (!ikInfo.worst || res.over > ikInfo.worst.over) {
          ikInfo.worst = { chain: name, over: res.over, reach: res.reach, max: res.maxReach };
        }
      }
    });
    W = fk(sk, q, root);
    Object.keys(k0.ik).forEach(function (name) {
      var a = k0.ik[name];
      if (a && a.level) levelFoot(sk, CHAINS[name][2], a.level, q, W);
    });
    W = fk(sk, q, root);
  }

  return { q: q, fk: W, skin: skinMatrices(sk, W), root: root, ik: ikInfo, localQ: q };
}

function sample(ch, clipName, time) {
  var clip = CLIPS[clipName];
  if (!clip) throw new Error('unknown clip ' + clipName);
  return evalClip(ch.sk, clip, time);
}

/* does a bone keep its authored length in every pose? (sanity, used by audit) */
function boneLengths(sk, W) {
  var out = {};
  sk.boneNames.forEach(function (j) {
    out[j] = { rest: vdist(sk.rest[sk.parent[j]], sk.rest[j]), posed: vdist(W.p[sk.parent[j]], W.p[j]) };
  });
  return out;
}

return {
  D2R: D2R, BONE: BONE, CHAINS: CHAINS, CLIPS: CLIPS, REGION: REGION,
  add: add, sub: sub, mul: mul, dot: dot, cross: cross, len: len, norm: norm,
  vdist: vdist, lerpV: lerpV, clamp: clamp,
  qId: qId, qAxis: qAxis, qMul: qMul, qConj: qConj, qNorm: qNorm, qRot: qRot,
  qFromTo: qFromTo, qSlerp: qSlerp, qMirror: qMirror, both: both, qA: qA,
  m4Id: m4Id, m4Mul: m4Mul, m4FromQ: m4FromQ, m4TR: m4TR, m4T: m4T, m4Xf: m4Xf,
  m4Persp: m4Persp, m4Ortho: m4Ortho, m4LookAt: m4LookAt,
  buildSkeleton: buildSkeleton, buildCharacter: buildCharacter, packGeometry: packGeometry,
  buildSDFMesh: buildSDFMesh, smin: smin,
  computeWeights: computeWeights, smoothWeights: smoothWeights,
  fk: fk, skinMatrices: skinMatrices, ikTwoBone: ikTwoBone, levelFoot: levelFoot,
  evalClip: evalClip, sample: sample, boneLengths: boneLengths
};
});
