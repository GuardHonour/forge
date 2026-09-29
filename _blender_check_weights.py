"""_blender_check_weights.py — measure what each bone actually drives.

A fitted rig with bad weights renders exactly like a badly fitted rig, so the two
must be separated by measurement. For each bone: how many vertices it drives
(weight > 0.5), the world bounding box of those vertices, and the greatest distance
from those vertices to the bone's own segment. For a healthy arm bone that distance
is roughly the limb's radius; if it is half a metre, the weights are leaking.

Then the inverse view: for a region of the body, which bones own it. That is what
says "the arm is being driven by the spine".

Run: blender.exe --background --factory-startup --python _blender_check_weights.py -- <rigged.blend>
"""
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
bpy.ops.wm.open_mainfile(filepath=argv[0])
body = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('GEO-body')][0]
meta = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
for m in list(body.modifiers):
    if m.type == 'MULTIRES':
        body.modifiers.remove(m)

gi = {g.name: g.index for g in body.vertex_groups}
gi_name = {v: k for k, v in gi.items()}
W = {}
for v in body.data.vertices:
    W[v.index] = {gi_name[g.group]: g.weight for g in v.groups if g.weight > 0.0}
CO = [v.co.copy() for v in body.data.vertices]

def seg_dist(p, a, b):
    ab = b - a
    t = 0.0 if ab.length_squared == 0 else max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length

print('%-14s %7s %10s %s' % ('bone', 'n>0.5', 'max_seg_d', 'bbox of driven verts (world)'))
for name in ('upper_arm.L', 'forearm.L', 'hand.L', 'thigh.L', 'shin.L', 'foot.L',
             'shoulder.L', 'spine.002', 'spine.006', 'breast.L', 'pelvis.L'):
    bn = meta.data.bones.get(name)
    if not bn:
        print('%-14s MISSING' % name)
        continue
    a = meta.matrix_world @ bn.head_local
    b = meta.matrix_world @ bn.tail_local
    idx = [i for i, w in W.items() if w.get(name, 0.0) > 0.5]
    if not idx:
        print('%-14s %7d' % (name, 0))
        continue
    pts = [CO[i] for i in idx]
    md = max(seg_dist(p, a, b) for p in pts)
    print('%-14s %7d %10.3f x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]'
          % (name, len(idx), md,
             min(p.x for p in pts), max(p.x for p in pts),
             min(p.y for p in pts), max(p.y for p in pts),
             min(p.z for p in pts), max(p.z for p in pts)))

def region(label, pred):
    tot = {}
    n = 0
    for i, p in enumerate(CO):
        if pred(p):
            n += 1
            for k, w in W[i].items():
                tot[k] = tot.get(k, 0.0) + w
    top = sorted(tot.items(), key=lambda kv: -kv[1])[:6]
    s = sum(tot.values()) or 1.0
    print('REGION %-22s verts=%-6d top bones: %s'
          % (label, n, ', '.join('%s %.0f%%' % (k, 100 * v / s) for k, v in top)))

# the arm, away from the shoulder
region('left arm x>0.16', lambda p: p.x > 0.16 and 0.95 < p.z < 1.45)
region('left forearm/hand z<1.05', lambda p: p.x > 0.20 and p.z < 1.05)
region('torso centre', lambda p: abs(p.x) < 0.10 and 0.95 < p.z < 1.40)
region('left thigh', lambda p: p.x > 0.03 and 0.45 < p.z < 0.80)
region('head', lambda p: p.z > 1.60)
