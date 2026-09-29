"""_blender_export.py — export the Blender-animated rig to GLB and verify it two ways.

Verification is the point of this file, not the export call:

1. STRUCTURAL, by parsing the GLB bytes directly (JSON chunk + BIN chunk): animation count
   and channel counts, keyframe time spans, skin joint count, and -- the one that actually
   catches a broken skin -- decoding WEIGHTS_0 and checking every vertex's weights sum to 1.

2. BEHAVIOURAL, by re-importing the GLB into Blender and comparing POSES against the source
   at matched times. Joint positions are compared as PAIRWISE DISTANCES, which are invariant
   under the Y-up conversion and any root transform the importer applies, so a match means
   the motion survived the round trip rather than the coordinate system happening to agree.

Run:
  blender.exe --background --factory-startup --python _blender_export.py -- <anim.blend> <out.glb>
"""
import bpy, sys, os, math, struct, json
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
anim_blend, glb_path = argv[0], argv[1]
FPS = 40

PAIRS = [('hand.L', 'hand.R'), ('hand.L', 'foot.L'), ('foot.L', 'foot.R'),
         ('spine.006', 'foot.L'), ('hand.L', 'spine.003'), ('toe.L', 'toe.R'),
         ('thigh.L', 'thigh.R'), ('hand.L', 'hand.R')]

bpy.ops.wm.open_mainfile(filepath=anim_blend)
sc = bpy.context.scene
body = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('GEO-body')][0]
meta = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
print('LOADED %s + %s, actions=%s' % (body.name, meta.name, [a.name for a in bpy.data.actions]))

def joint_world(arm, bone):
    return arm.matrix_world @ arm.pose.bones[bone].head

def sig(arm, frame):
    """a pose signature: pairwise joint distances, invariant under rigid transforms.
    Reads bpy.context.scene, not a captured scene: read_factory_settings() in this same
    script replaces the scene and any earlier reference becomes a dead StructRNA."""
    s = bpy.context.scene
    s.frame_set(frame)
    bpy.context.view_layer.update()
    P = {b: joint_world(arm, b) for b in set(sum((list(p) for p in PAIRS), []))}
    return [ (P[a] - P[b]).length for a, b in PAIRS ]

PROBE_FRAMES = [0, 25, 50, 63, 75, 100, 126]
source, source_var = {}, {}
for act in bpy.data.actions:
    meta.animation_data.action = act
    source[act.name] = {f: sig(meta, f) for f in PROBE_FRAMES}
    s = source[act.name]
    source_var[act.name] = max(max(s[f][i] for f in PROBE_FRAMES) - min(s[f][i] for f in PROBE_FRAMES)
                               for i in range(len(PAIRS)))
    print('SOURCE %-6s signature at frames %s  variation across frames = %.4f m %s'
          % (act.name, PROBE_FRAMES, source_var[act.name],
             'MOVES' if source_var[act.name] > 0.01 else 'STATIC'))

# ---- export ----------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
meta.select_set(True)
bpy.context.view_layer.objects.active = meta
meta.animation_data.action = bpy.data.actions[0]
kw = dict(filepath=os.path.abspath(glb_path), export_format='GLB', use_selection=True,
          export_animations=True, export_skins=True, export_yup=True)
try:
    bpy.ops.export_scene.gltf(export_animation_mode='ACTIONS', **kw)
except TypeError:
    bpy.ops.export_scene.gltf(**kw)
size = os.path.getsize(glb_path)
print('EXPORTED %s bytes=%d (%.1f MB)' % (glb_path, size, size / 1024 / 1024))

# ---- 1. structural verification from the bytes ------------------------------
data = open(glb_path, 'rb').read()
magic, version, length = struct.unpack('<III', data[:12])
assert magic == 0x46546C67, 'not a GLB'
assert length == len(data), 'header length %d != file length %d' % (length, len(data))
off, chunks = 12, []
while off < length:
    clen, ctype = struct.unpack('<II', data[off:off + 8])
    chunks.append((ctype, data[off + 8:off + 8 + clen]))
    off += 8 + clen
js = json.loads(chunks[0][1].decode('utf-8'))
binbuf = chunks[1][1] if len(chunks) > 1 else b''
print('GLB version=%d chunks=%d json=%d bytes bin=%d bytes' % (version, len(chunks), len(chunks[0][1]), len(binbuf)))

CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def read_accessor(i):
    acc = js['accessors'][i]
    bv = js['bufferViews'][acc['bufferView']]
    fmt, csz = CT[acc['componentType']]
    n = NC[acc['type']]
    stride = bv.get('byteStride') or (csz * n)
    start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    out = []
    for k in range(acc['count']):
        o = start + k * stride
        out.append(struct.unpack_from('<' + fmt * n, binbuf, o))
    return out

print('STRUCT animations=%d skins=%d meshes=%d nodes=%d materials=%d'
      % (len(js.get('animations', [])), len(js.get('skins', [])), len(js.get('meshes', [])),
         len(js.get('nodes', [])), len(js.get('materials', []))))
for a in js.get('animations', []):
    counts = [len(read_accessor(s['input'])) for s in a['samplers']]
    longest = max(range(len(counts)), key=lambda i: counts[i])
    times = read_accessor(a['samplers'][longest]['input'])
    paths = {}
    for ch in a['channels']:
        paths[ch['target']['path']] = paths.get(ch['target']['path'], 0) + 1
    tgt = set(ch['target']['node'] for ch in a['channels'])
    # report the SPREAD of key counts: the glTF exporter optimises per channel, so an
    # unmoving bone legitimately keeps 2 keys while a moving one keeps hundreds. Quoting
    # sampler 0 alone would say "keys=2" and look like a static animation.
    print('STRUCT anim %-6s channels=%-4d nodes=%-3d keys=%d..%d (median %d) t=[%.3f..%.3f]s paths=%s'
          % (a.get('name', '?'), len(a['channels']), len(tgt), min(counts), max(counts),
             sorted(counts)[len(counts) // 2], times[0][0], times[-1][0], paths))
    moving = sum(1 for c in counts if c > 10)
    print('STRUCT anim %-6s channels with real motion (>10 keys): %d of %d'
          % (a.get('name', '?'), moving, len(counts)))

sk = js['skins'][0]
print('STRUCT skin joints=%d inverseBindMatrices=%s' % (len(sk['joints']), 'yes' if 'inverseBindMatrices' in sk else 'no'))
ibm = read_accessor(sk['inverseBindMatrices']) if 'inverseBindMatrices' in sk else []
nonfinite = sum(1 for m in ibm for c in m if not math.isfinite(c))
print('STRUCT inverseBindMatrices count=%d nonfinite=%d' % (len(ibm), nonfinite))

prim = js['meshes'][0]['primitives'][0]
attrs = prim['attributes']
print('STRUCT mesh primitives=%d attrs=%s indices=%s verts=%d tris=%d'
      % (len(js['meshes'][0]['primitives']), sorted(attrs), 'yes' if 'indices' in prim else 'no',
         js['accessors'][attrs['POSITION']]['count'],
         js['accessors'][prim['indices']]['count'] // 3 if 'indices' in prim else 0))
W = read_accessor(attrs['WEIGHTS_0'])
J = read_accessor(attrs['JOINTS_0'])
bad, worst = 0, 0.0
for w in W:
    s = sum(w)
    worst = max(worst, abs(s - 1.0))
    if abs(s - 1.0) > 0.01:
        bad += 1
maxj = max(max(j) for j in J)
print('STRUCT weights: %d verts, worst |sum-1| = %.5f, out-of-tolerance = %d, max joint index = %d (joints=%d)'
      % (len(W), worst, bad, maxj, len(sk['joints'])))
pos = read_accessor(attrs['POSITION'])
print('STRUCT bbox x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f] (glTF Y-up)'
      % (min(p[0] for p in pos), max(p[0] for p in pos),
         min(p[1] for p in pos), max(p[1] for p in pos),
         min(p[2] for p in pos), max(p[2] for p in pos)))

# ---- 2. behavioural verification: re-import and compare poses ---------------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc2 = bpy.context.scene
sc2.render.fps = FPS          # match, so imported keyframe times land on the same frames
bpy.ops.import_scene.gltf(filepath=os.path.abspath(glb_path))
arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
print('REIMPORT armatures=%d actions=%s' % (len(arms), [a.name for a in bpy.data.actions]))
if not arms:
    print('ROUNDTRIP_FAIL no armature imported')
    raise SystemExit(1)
imp = arms[0]
imp.animation_data_create()
worst_all, worst_where, fails = 0.0, '', []
for act in bpy.data.actions:
    base = act.name.split('.')[0]
    if base not in source:
        continue
    imp.animation_data.action = act
    mine_all = {f: sig(imp, f) for f in PROBE_FRAMES}
    imp_var = max(max(mine_all[f][i] for f in PROBE_FRAMES) - min(mine_all[f][i] for f in PROBE_FRAMES)
                  for i in range(len(PAIRS)))
    print('REIMPORT %-6s variation across frames = %.4f m' % (base, imp_var))
    # A round-trip test that compares two STATIC animations agrees with itself and reports
    # CLEAN. That is exactly what happened when the bake produced constant curves: the
    # source was static, the import was static, and the mismatch was 1e-6. Require both
    # sides to actually move before believing any agreement between them.
    if source_var.get(base, 0.0) < 0.01:
        fails.append('%s: SOURCE animation is static — nothing to verify' % base)
        continue
    if imp_var < 0.01:
        fails.append('%s: imported animation is STATIC (motion lost in export)' % base)
        continue
    for f in PROBE_FRAMES:
        d = max(abs(x - y) for x, y in zip(mine_all[f], source[base][f]))
        if d > worst_all:
            worst_all, worst_where = d, '%s f%d' % (base, f)
print('ROUNDTRIP worst pairwise-joint-distance mismatch = %.6f m (%s)' % (worst_all, worst_where))
if fails:
    print('ROUNDTRIP FAIL — ' + '; '.join(fails))
elif worst_all < 0.005:
    print('ROUNDTRIP CLEAN — motion is present on both sides and matches')
else:
    print('ROUNDTRIP FAIL — motion did not survive the round trip (%.6f m)' % worst_all)
