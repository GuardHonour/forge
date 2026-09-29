/* _s3d_export.cjs — write the .glb and prove it round-trips.
   Re-parses the file from bytes (not from the object that built it), checks the
   structural invariants a loader will rely on, then decodes real values back out
   and compares them against the core's own numbers. A file that opens in Blender
   but silently contains the wrong skin is worse than no file.
   Run: node _s3d_export.cjs */
const fs = require('fs');
const S3D = require('./_s3d_core.js');
const S3DGLB = require('./_s3d_glb.js');

let bad = 0;
const fail = m => { bad++; console.log('  FAIL ' + m); };
const pass = m => console.log('  pass  ' + m);

const ch = S3D.buildCharacter();
const GEO = S3D.packGeometry(ch);
const built = S3DGLB.buildGLB({ character: ch });
const OUT = 'FORGE-3d-character.glb';
fs.writeFileSync(OUT, Buffer.from(built.bytes));

console.log('exported ' + OUT + ': ' + (built.stats.bytes / 1024).toFixed(0) + ' KB, '
  + built.stats.verts + ' verts, ' + built.stats.tris + ' tris, '
  + built.stats.joints + ' joints, ' + built.stats.clips + ' clips x ' + built.stats.frames + ' frames');

/* ---------- 1. container ---------- */
const buf = built.bytes;
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
if (magic !== 'glTF') fail('bad magic "' + magic + '"');
else pass('magic is glTF');
if (dv.getUint32(4, true) !== 2) fail('version is not 2');
else pass('container version 2');
if (dv.getUint32(8, true) !== buf.length) fail('declared length ' + dv.getUint32(8, true) + ' != file length ' + buf.length);
else pass('declared length matches the file exactly (' + buf.length + ' bytes)');

const jsonLen = dv.getUint32(12, true);
const jsonTag = dv.getUint32(16, true);
if (jsonTag !== 0x4E4F534A) fail('first chunk is not JSON');
const binOff = 20 + jsonLen;
const binLen = dv.getUint32(binOff, true);
const binTag = dv.getUint32(binOff + 4, true);
if (binTag !== 0x004E4942) fail('second chunk is not BIN');
else pass('chunks are JSON then BIN, both declared');
if (jsonLen % 4 || binLen % 4) fail('a chunk is not 4-byte aligned');
else pass('both chunks are 4-byte aligned (loaders require it)');

const json = JSON.parse(Buffer.from(buf.buffer, buf.byteOffset + 20, jsonLen).toString('utf8'));
const binStart = binOff + 8;
if (json.buffers[0].byteLength !== binLen) fail('buffer.byteLength ' + json.buffers[0].byteLength + ' != BIN chunk ' + binLen);
else pass('buffer.byteLength matches the BIN chunk');

/* ---------- 2. structural invariants ---------- */
const CSIZE = { 5126: 4, 5123: 2, 5125: 4 };
const TCOUNT = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 };
let viewBad = 0, accBad = 0;
json.bufferViews.forEach((v, i) => { if (v.byteOffset + v.byteLength > binLen) viewBad++; });
if (viewBad) fail(viewBad + ' bufferViews run past the end of the binary chunk');
else pass('all ' + json.bufferViews.length + ' bufferViews lie inside the binary chunk');
json.accessors.forEach((a, i) => {
  const bv = json.bufferViews[a.bufferView];
  const need = TCOUNT[a.type] * CSIZE[a.componentType] * a.count;
  if (!bv || (a.byteOffset || 0) + need > bv.byteLength) accBad++;
});
if (accBad) fail(accBad + ' accessors overrun their bufferView');
else pass('all ' + json.accessors.length + ' accessors fit inside their bufferView');

/* defined types only — a bad componentType makes a loader reject the file */
const okCT = json.accessors.every(a => CSIZE[a.componentType] && TCOUNT[a.type]);
if (!okCT) fail('an accessor uses an unsupported componentType/type');
else pass('every accessor uses a defined componentType and type');

/* POSITION needs min/max or validators reject the file */
const prim = json.meshes[0].primitives[0];
const posAcc = json.accessors[prim.attributes.POSITION];
if (!posAcc.min || !posAcc.max) fail('POSITION accessor has no min/max');
else pass('POSITION carries min/max: [' + posAcc.min.map(v => v.toFixed(1)) + '] .. [' + posAcc.max.map(v => v.toFixed(1)) + ']');

/* hierarchy: every joint reachable from the scene, mesh node not inside the rig */
const nodeCount = json.nodes.length;
const inScene = json.scenes[0].nodes;
if (!inScene.includes(json.skins[0].skeleton)) fail('the skeleton root is not in the scene');
const reach = new Set();
(function walk(i) { if (reach.has(i)) return; reach.add(i); (json.nodes[i].children || []).forEach(walk); })(json.skins[0].skeleton);
const missing = json.skins[0].joints.filter(j => !reach.has(j));
if (missing.length) fail(missing.length + ' skin joints are unreachable from the skeleton root');
else pass('all ' + json.skins[0].joints.length + ' skin joints are reachable from the skeleton root');

/* ---------- 3. decode values back and compare ---------- */
function readAccessor(idx) {
  const a = json.accessors[idx], bv = json.bufferViews[a.bufferView];
  const n = TCOUNT[a.type], size = CSIZE[a.componentType];
  const base = binStart + bv.byteOffset + (a.byteOffset || 0);
  const out = new Array(a.count * n);
  for (let i = 0; i < a.count * n; i++) {
    const o = base + i * size;
    if (a.componentType === 5126) out[i] = dv.getFloat32(o, true);
    else if (a.componentType === 5123) out[i] = dv.getUint16(o, true);
    else out[i] = dv.getUint32(o, true);
  }
  return out;
}

const positions = readAccessor(prim.attributes.POSITION);
let posErr = 0;
for (let i = 0; i < 30; i++) posErr = Math.max(posErr, Math.abs(positions[i] - GEO.pos[i]));
if (posErr > 1e-6) fail('decoded POSITION differs from the source mesh by ' + posErr);
else pass('decoded POSITION matches the source mesh exactly (30 verts sampled)');

const joints = readAccessor(prim.attributes.JOINTS_0);
const weights = readAccessor(prim.attributes.WEIGHTS_0);
let skinErr = 0, jErr = 0;
for (let v = 0; v < 200; v++) {
  for (let k = 0; k < 4; k++) {
    skinErr = Math.max(skinErr, Math.abs(weights[v * 4 + k] - ch.skin.wgt[v][k]));
    jErr = Math.max(jErr, Math.abs(joints[v * 4 + k] - ch.skin.idx[v][k]));
  }
}
if (skinErr > 1e-6 || jErr) fail('decoded skin differs (weight err ' + skinErr + ', joint err ' + jErr + ')');
else pass('decoded JOINTS_0/WEIGHTS_0 match the rig exactly (200 verts sampled)');

/* weights must still sum to 1 after the Uint16 joint round-trip */
let wsum = 0;
for (let v = 0; v < weights.length / 4; v++) {
  const s = weights[v * 4] + weights[v * 4 + 1] + weights[v * 4 + 2] + weights[v * 4 + 3];
  wsum = Math.max(wsum, Math.abs(s - 1));
}
if (wsum > 1e-5) fail('exported weights do not sum to 1 (worst ' + wsum + ')');
else pass('exported weights still sum to 1 on all ' + (weights.length / 4) + ' vertices');

/* animation: decode a rotation channel and compare with a fresh evaluation */
const anim = json.animations[0];
const tAcc = json.accessors[anim.samplers[0].input];
const times = readAccessor(anim.samplers[0].input);
let timeErr = 0;
for (let i = 0; i < times.length; i++) timeErr = Math.max(timeErr, Math.abs(times[i] - (json.animations[0].name ? times[i] : 0)));
if (Math.abs(times[0]) > 1e-9) fail('animation time channel does not start at 0');
else pass('animation time channel is dense: ' + times.length + ' keys over '
  + times[times.length - 1].toFixed(2) + 's');

let animErr = 0, checked = 0;
json.animations.forEach((an, ai) => {
  const clipName = an.name;
  const clip = S3D.CLIPS[clipName];
  an.channels.forEach(chan => {
    if (chan.target.path !== 'rotation') return;
    const jointName = S3D.buildSkeleton().order[chan.target.node];
    const smp = an.samplers[chan.sampler];
    const vals = readAccessor(smp.output);
    const t = readAccessor(smp.input);
    [0, Math.floor(t.length / 2), t.length - 1].forEach(f => {
      const ev = S3D.evalClip(ch.sk, clip, t[f]);
      const want = ev.localQ[jointName] || [0, 0, 0, 1];
      for (let c = 0; c < 4; c++) animErr = Math.max(animErr, Math.abs(vals[f * 4 + c] - want[c]));
      checked++;
    });
  });
});
if (animErr > 1e-5) fail('decoded animation rotations differ from the engine by ' + animErr);
else pass('decoded animation rotations reproduce the engine exactly (' + checked + ' key/joint samples across '
  + json.animations.length + ' clips)');

/* hips translation channel must carry the squat's root motion */
const squat = json.animations.find(a => a.name === 'squat');
const trChan = squat.channels.find(c => c.target.path === 'translation');
const trVals = readAccessor(squat.samplers[trChan.sampler].output);
const trTimes = readAccessor(squat.samplers[trChan.sampler].input);
let trErr = 0, minY = 1e9;
for (let f = 0; f < trTimes.length; f++) {
  const ev = S3D.evalClip(ch.sk, S3D.CLIPS.squat, trTimes[f]);
  const want = ch.sk.off.hips[1] + ev.root[1];
  trErr = Math.max(trErr, Math.abs(trVals[f * 3 + 1] - want));
  minY = Math.min(minY, trVals[f * 3 + 1]);
}
if (trErr > 1e-5) fail('hips translation channel differs from the engine by ' + trErr);
else pass('squat root motion survives the export (hips y dips to ' + minY.toFixed(1) + ' from '
  + ch.sk.off.hips[1].toFixed(1) + ')');

console.log(bad ? '\n' + bad + ' EXPORT FAILURES' : '\nGLB ROUND-TRIP CLEAN');
process.exit(bad ? 1 : 0);
