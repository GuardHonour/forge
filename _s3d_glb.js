/* _s3d_glb.js — export the S3D character as a glTF 2.0 binary (.glb).
   Works in the browser (window.S3DGLB) and in node, so the viewer can offer a
   download and the build can write a file with one source of truth.

   Why this exists: it is the bridge that keeps Blender a *quality lever* rather
   than a dependency. The rig, mesh, skin weights and clips stay text in
   _s3d_core.js; the .glb is a disposable build artifact you can drop into
   Blender, three.js, Godot or Unreal and inspect. Nothing here is authored by
   hand, so nothing here can drift from the core that the audit checks.

   glTF details that matter and are easy to get wrong:
   - quaternions are xyzw, which is already this engine's order;
   - matrices are column-major, matching m4 here;
   - LINEAR interpolation on a rotation channel means SLERP per spec, so the
     sampled keys reproduce the engine's eased motion instead of flattening it;
   - POSITION requires min/max or validators reject the file;
   - the BIN chunk must be 4-byte aligned, and buffer.byteLength must match it. */
(function (root, factory) {
  var S3D = (typeof module !== 'undefined' && module.exports) ? require('./_s3d_core.js') : root.S3D;
  var api = factory(S3D);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.S3DGLB = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S3D) {
'use strict';

var FPS = 40;                      /* sampling rate for exported clips */

function buildGLB(opts) {
  opts = opts || {};
  var ch = opts.character || S3D.buildCharacter(opts.mode);
  var GEO = S3D.packGeometry(ch);
  var sk = ch.sk;

  var parts = [], offset = 0, bufferViews = [], accessors = [];
  function align() { while (offset % 4) { parts.push(new Uint8Array(1)); offset++; } }
  function addView(ta, target) {
    align();
    var bytes = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
    var bv = { buffer: 0, byteOffset: offset, byteLength: bytes.length };
    if (target) bv.target = target;
    bufferViews.push(bv);
    parts.push(bytes);
    offset += bytes.length;
    return bufferViews.length - 1;
  }
  function addAcc(view, componentType, count, type, min, max) {
    var a = { bufferView: view, componentType: componentType, count: count, type: type };
    if (min) { a.min = min; a.max = max; }
    accessors.push(a);
    return accessors.length - 1;
  }

  /* --- mesh --- */
  var i, n = GEO.pos.length / 3;
  var pmin = [1e9, 1e9, 1e9], pmax = [-1e9, -1e9, -1e9];
  for (i = 0; i < n; i++) {
    for (var a = 0; a < 3; a++) {
      var v = GEO.pos[i * 3 + a];
      if (v < pmin[a]) pmin[a] = v;
      if (v > pmax[a]) pmax[a] = v;
    }
  }
  var matPos = addAcc(addView(GEO.pos, 34962), 5126, n, 'VEC3', pmin, pmax);
  var matNrm = addAcc(addView(GEO.nrm, 34962), 5126, n, 'VEC3');
  var joints16 = new Uint16Array(GEO.bi.length);
  for (i = 0; i < GEO.bi.length; i++) joints16[i] = GEO.bi[i];
  var matJ = addAcc(addView(joints16, 34962), 5123, n, 'VEC4');
  var matW = addAcc(addView(GEO.bw, 34962), 5126, n, 'VEC4');
  var matIdx = addAcc(addView(GEO.idx, 34963), 5125, GEO.idx.length, 'SCALAR');

  /* --- nodes: one per joint, rest offset as translation, then the mesh node --- */
  var nodes = sk.order.map(function (j) {
    var off = sk.off[j];
    var node = { name: j, translation: [off[0], off[1], off[2]] };
    var kids = sk.order.filter(function (c) { return sk.parent[c] === j; }).map(function (c) { return sk.index[c]; });
    if (kids.length) node.children = kids;
    return node;
  });
  var meshNode = nodes.length;
  nodes.push({ name: 'Body', mesh: 0, skin: 0 });

  /* --- skin: inverse bind is a pure translation, because rest has no rotation --- */
  var ibm = new Float32Array(sk.order.length * 16);
  sk.order.forEach(function (j, k) {
    var inv = S3D.m4T([-sk.rest[j][0], -sk.rest[j][1], -sk.rest[j][2]]);
    ibm.set(inv, k * 16);
  });
  var skin = {
    joints: sk.order.map(function (j, k) { return k; }),
    skeleton: sk.index.hips,
    inverseBindMatrices: addAcc(addView(ibm), 5126, sk.order.length, 'MAT4')
  };

  /* --- animations --- */
  var animations = [];
  Object.keys(S3D.CLIPS).forEach(function (name) {
    var clip = S3D.CLIPS[name];
    var N = Math.round(clip.duration * FPS) + 1;
    var times = new Float32Array(N);
    var rots = sk.order.map(function () { return new Float32Array(N * 4); });
    var roots = new Float32Array(N * 3);
    for (var f = 0; f < N; f++) {
      var t = clip.duration * f / (N - 1);
      times[f] = t;
      var ev = S3D.evalClip(sk, clip, t);
      sk.order.forEach(function (j, k) {
        var q = ev.localQ[j] || [0, 0, 0, 1];
        rots[k][f * 4] = q[0]; rots[k][f * 4 + 1] = q[1]; rots[k][f * 4 + 2] = q[2]; rots[k][f * 4 + 3] = q[3];
      });
      var ho = sk.off.hips;
      roots[f * 3] = ho[0] + ev.root[0]; roots[f * 3 + 1] = ho[1] + ev.root[1]; roots[f * 3 + 2] = ho[2] + ev.root[2];
    }
    var tAcc = addAcc(addView(times), 5126, N, 'SCALAR', [0], [clip.duration]);
    var samplers = [], channels = [];
    sk.order.forEach(function (j, k) {
      var rAcc = addAcc(addView(rots[k]), 5126, N, 'VEC4');
      samplers.push({ input: tAcc, output: rAcc, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: k, path: 'rotation' } });
    });
    var trAcc = addAcc(addView(roots), 5126, N, 'VEC3');
    samplers.push({ input: tAcc, output: trAcc, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: sk.index.hips, path: 'translation' } });
    animations.push({ name: name, samplers: samplers, channels: channels });
  });

  var binLen = offset, pad = (4 - binLen % 4) % 4;
  var bin = new Uint8Array(binLen + pad);
  var cur = 0;
  parts.forEach(function (p) { bin.set(p, cur); cur += p.length; });

  var json = {
    asset: { version: '2.0', generator: 'S3D — FORGE 3D sandbox (procedural, no DCC)' },
    scene: 0,
    scenes: [{ nodes: [sk.index.hips, meshNode] }],
    nodes: nodes,
    meshes: [{ name: 'S3DBody', primitives: [{
      attributes: { POSITION: matPos, NORMAL: matNrm, JOINTS_0: matJ, WEIGHTS_0: matW },
      indices: matIdx, material: 0
    }] }],
    materials: [{ name: 'S3DMat', pbrMetallicRoughness: {
      baseColorFactor: [0.90, 0.92, 0.94, 1], metallicFactor: 0, roughnessFactor: 0.55
    } }],
    skins: [skin],
    animations: animations,
    accessors: accessors,
    bufferViews: bufferViews,
    buffers: [{ byteLength: bin.length }]
  };

  var jsonStr = JSON.stringify(json);
  var enc = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
  var jsonBytes = enc ? enc.encode(jsonStr) : (function () {
    var b = []; for (var q = 0; q < jsonStr.length; q++) b.push(jsonStr.charCodeAt(q) & 255); return new Uint8Array(b);
  })();
  var jpad = (4 - jsonBytes.length % 4) % 4;
  var jsonChunk = new Uint8Array(jsonBytes.length + jpad);
  jsonChunk.set(jsonBytes);
  for (var z = 0; z < jpad; z++) jsonChunk[jsonBytes.length + z] = 0x20;   /* spaces per spec */

  var total = 12 + 8 + jsonChunk.length + 8 + bin.length;
  var out = new Uint8Array(total);
  var dv = new DataView(out.buffer);
  out[0] = 0x67; out[1] = 0x6C; out[2] = 0x54; out[3] = 0x46;               /* 'glTF' */
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonChunk.length, true);
  dv.setUint32(16, 0x4E4F534A, true);                                       /* 'JSON' */
  out.set(jsonChunk, 20);
  dv.setUint32(20 + jsonChunk.length, bin.length, true);
  dv.setUint32(24 + jsonChunk.length, 0x004E4942, true);                    /* 'BIN\0' */
  out.set(bin, 28 + jsonChunk.length);

  return { bytes: out, json: json, stats: {
    verts: n, tris: GEO.idx.length / 3, joints: sk.order.length,
    clips: animations.length, frames: Math.round(S3D.CLIPS.twist.duration * FPS) + 1,
    accessors: accessors.length, bufferViews: bufferViews.length, bytes: total
  } };
}

return { buildGLB: buildGLB, FPS: FPS };
});
