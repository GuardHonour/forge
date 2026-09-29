"""_blender_rig.py — fit a human metarig to the CC0 body, compute skin weights, and
PROVE the fit numerically before rendering.

Five things were learned the hard way and are now enforced:

1. BAKE THE OBJECT TRANSFORM. The asset library's object carries a location its vertex
   data compensates for, so world geometry looks right while the object origin sits
   metres away. Bone heat solves in world space and the armature modifier conjugates by
   the mesh-to-armature relative transform, so that offset yields garbage weights and a
   body that collapses as one blob the moment a bone rotates. At rest it is invisible:
   the rest skin matrix is identity whatever the offset.

2. VERIFY THE PROBE ITSELF. A wrong space conversion makes every bone read "outside",
   which is worse than no table. Sample a vertex off the surface and require ~0 first.

3. PAIR LIMBS BY AXIS, NOT BY "LEFT". In Blender a character facing -Y has its `.L`
   bones at +X, so `upper_arm.L` must be aimed at the hand at +X. Pairing `.L` with the
   min-X hand aims both arms diagonally across the body: the arms fold into the torso,
   and the chain also measures "too short" because it is reaching across the chest.

4. PRUNE BEFORE SCALING. A stock metarig's total bone extent is taller than its body
   (face/eye bones sit above the skull). Scaling by mesh_height / total_extent makes the
   whole skeleton ~9% undersized, so every limb comes up short. Delete the face rig
   first, then measure.

5. BORROW THE METARIG'S ANATOMY AS A PRIOR. Its foot bone already points the right way
   and its ankle sits at the right height. Deriving those from a sparse mesh by hunting a
   width minimum finds calf gaps, not ankles.

Run:
  blender.exe --background --factory-startup --python _blender_rig.py -- <src.blend> <mesh> <out.blend>
"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src_blend, mesh_name, out_blend = argv[0], argv[1], argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# ---- body ------------------------------------------------------------------
with bpy.data.libraries.load(src_blend) as (src, dst):
    dst.objects = [mesh_name]
body = dst.objects[0]
sc.collection.objects.link(body)
print('BODY %s verts=%d polys=%d' % (body.name, len(body.data.vertices), len(body.data.polygons)))

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

co = [v.co for v in body.data.vertices]
bb_min = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
bb_max = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
shift = Vector(((bb_min.x + bb_max.x) / 2.0, (bb_min.y + bb_max.y) / 2.0, bb_min.z))
for v in body.data.vertices:
    v.co -= shift
co = [v.co for v in body.data.vertices]
bb_min = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
bb_max = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
H = bb_max.z - bb_min.z
print('BODY canonical bbox x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f] height=%.3f'
      % (bb_min.x, bb_max.x, bb_min.y, bb_max.y, bb_min.z, bb_max.z, H))

mat = bpy.data.materials.new('BodyMat')
mat.use_nodes = True
_b = mat.node_tree.nodes.get('Principled BSDF')
if _b:
    _b.inputs['Base Color'].default_value = (0.72, 0.70, 0.67, 1.0)
    _b.inputs['Roughness'].default_value = 0.45
body.data.materials.append(mat)

# ---- metarig: add, prune the face rig, THEN scale --------------------------
bpy.ops.preferences.addon_enable(module='rigify')
bpy.ops.object.armature_human_metarig_add()
meta = bpy.context.active_object
meta.name = 'Metarig'
bpy.ops.object.select_all(action='DESELECT')
meta.select_set(True)
bpy.context.view_layer.objects.active = meta

FACE = ('face', 'nose', 'lip', 'jaw', 'chin', 'ear', 'brow', 'lid', 'forehead',
        'temple', 'cheek', 'eye', 'teeth', 'tongue', 'heel')
bpy.ops.object.mode_set(mode='EDIT')
eb = meta.data.edit_bones
before = len(eb)
for b in list(eb):
    if b.name.split('.')[0] in FACE:
        eb.remove(b)
bpy.ops.object.mode_set(mode='OBJECT')
# read the count back from data.bones: edit_bones is only valid IN edit mode, and
# reading it afterwards silently reports 0 (which looks like "deleted everything")
print('PRUNED %d face/heel bones (%d -> %d)' % (before - len(meta.data.bones), before, len(meta.data.bones)))

pts = []
for bn in meta.data.bones:
    pts.append(meta.matrix_world @ bn.head_local)
    pts.append(meta.matrix_world @ bn.tail_local)
mz0 = min(p.z for p in pts); mz1 = max(p.z for p in pts)
s = H / (mz1 - mz0)
meta.scale = (s, s, s)
meta.location = (0.0, 0.0, 0.0)
bpy.context.view_layer.update()
pts = []
for bn in meta.data.bones:
    pts.append(meta.matrix_world @ bn.head_local)
    pts.append(meta.matrix_world @ bn.tail_local)
meta.location.z += -min(p.z for p in pts)
bpy.context.view_layer.update()
print('METARIG pruned extent %.3f -> scale=%.4f -> height %.3f (body %.3f)'
      % (mz1 - mz0, s, H, H))

inv = meta.matrix_world.inverted()
def to_arm(p):
    return inv @ p
def to_world(p):
    return meta.matrix_world @ p

# ---- landmarks, using the metarig as the prior for anatomy -----------------
# Sides are paired by axis: Blender `.L` is +X for a -Y-facing character.
# side +1 -> .L, side -1 -> .R
land = {}
for side, tag in ((1, 'L'), (-1, 'R')):
    # object mode: bone.head_local/tail_local are armature-space positions
    _b = meta.data.bones
    foot = _b['foot.' + tag]
    toe_b = _b['toe.' + tag]
    # the metarig already knows which way the toes point
    toe_dir = (to_world(toe_b.tail_local) - to_world(foot.head_local)).y
    toe_sign = 1.0 if toe_dir > 0 else -1.0
    prior_z = to_world(foot.head_local).z
    # ankle: narrowest band near the metarig's own ankle, wide bands and a
    # minimum vertex count so a sparse gap cannot masquerade as an ankle
    prof = []
    z = prior_z - 0.07
    while z < prior_z + 0.07:
        pts = [c for c in co if z <= c.z < z + 0.025 and (c.x > 0) == (side > 0)]
        if len(pts) >= 12:
            prof.append((max(c.x for c in pts) - min(c.x for c in pts), z + 0.0125,
                         sum(c.x for c in pts) / len(pts), sum(c.y for c in pts) / len(pts), len(pts)))
        z += 0.025
    print('  ANKLE profile %s (width@z, n): %s' % (tag, ' '.join('%.3f@%.3f n%d' % (p[0], p[1], p[4]) for p in prof)))
    if not prof:
        raise SystemExit('no ankle profile for ' + tag)
    ank = min(prof, key=lambda p: p[0])
    tipv = max(co, key=lambda c: c.x) if side > 0 else min(co, key=lambda c: c.x)
    foot_pts = [c for c in co if c.z < 0.10 and (c.x > 0) == (side > 0)]
    toev = max(foot_pts, key=lambda c: c.y) if toe_sign > 0 else min(foot_pts, key=lambda c: c.y)
    land[side] = dict(hand_tip=Vector(tipv), ankle=Vector((ank[2], ank[3], ank[1])), toe=Vector(toev))
    print('LANDMARK %s hand_tip=(%.3f,%.3f,%.3f) ankle=(%.3f,%.3f,%.3f) w=%.3f n=%d toe=(%.3f,%.3f,%.3f) toesign=%+.0f'
          % (tag, tipv.x, tipv.y, tipv.z, ank[2], ank[3], ank[1], ank[0], ank[4], toev.x, toev.y, toev.z, toe_sign))

# ---- re-aim the limb chains at the measured landmarks ----------------------
bpy.ops.object.select_all(action='DESELECT')
meta.select_set(True)
bpy.context.view_layer.objects.active = meta
bpy.ops.object.mode_set(mode='EDIT')
eb = meta.data.edit_bones
for side, tag in ((1, 'L'), (-1, 'R')):
    L = land[side]
    ua, fa, hd = eb['upper_arm.' + tag], eb['forearm.' + tag], eb['hand.' + tag]
    sh = ua.head.copy()
    d = (to_arm(L['hand_tip']) - sh).normalized()
    ul = (ua.tail - ua.head).length
    fl = (fa.tail - fa.head).length
    hl = (hd.tail - hd.head).length
    reach = ul + fl + hl
    span = (to_arm(L['hand_tip']) - sh).length
    ua.tail = sh + d * ul
    fa.head = ua.tail; fa.tail = fa.head + d * fl
    hd.head = fa.tail; hd.tail = hd.head + d * hl
    print('AIM arm.%s dir=(%.2f,%.2f,%.2f) shoulder->fingertip=%.3f vs chain reach=%.3f %s'
          % (tag, d.x, d.y, d.z, span, reach,
             'OK' if span <= reach * 1.12 else 'SHORT by %.0f%%' % ((span / reach - 1) * 100)))
    th, sn, ft, to = eb['thigh.' + tag], eb['shin.' + tag], eb['foot.' + tag], eb['toe.' + tag]
    knee = th.tail.copy()
    ankle = to_arm(L['ankle'])
    toe = to_arm(L['toe'])
    sn.head = knee; sn.tail = ankle
    ft.head = ankle; ft.tail = ankle + (toe - ankle) * 0.62
    to.head = ft.tail; to.tail = toe
    print('AIM leg.%-2s knee=(%.3f,%.3f,%.3f) ankle=(%.3f,%.3f,%.3f) toe=(%.3f,%.3f,%.3f)'
          % (tag, knee.x, knee.y, knee.z, ankle.x, ankle.y, ankle.z, toe.x, toe.y, toe.z))
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()

# ---- 1. is every bone inside the body? -------------------------------------
def probe(p):
    ok, loc, nrm, _ = body.closest_point_on_mesh(p)
    if not ok:
        return None, None
    d = p - loc
    return d.length, d.dot(nrm.normalized())

_d0, _s0 = probe(body.data.vertices[0].co.copy())
print('PROBE_SELFTEST surface vertex -> dist=%.4f (expect ~0.000)' % (_d0 if _d0 else -1))
if _d0 is None or _d0 > 0.01:
    print('PROBE_BROKEN — refusing to report a fit table built on a broken probe')
    raise SystemExit(1)

KEY = ('spine', 'spine.001', 'spine.002', 'spine.003', 'spine.004', 'spine.006',
       'shoulder.L', 'upper_arm.L', 'forearm.L', 'hand.L',
       'shoulder.R', 'upper_arm.R', 'forearm.R', 'hand.R',
       'thigh.L', 'shin.L', 'foot.L', 'toe.L', 'thigh.R', 'shin.R', 'foot.R', 'toe.R')
print('%-14s %8s %6s %8s %6s' % ('bone', 'head_d', 'head', 'tail_d', 'tail'))
outs = []
for name in KEY:
    bn = meta.data.bones.get(name)
    if not bn:
        continue
    h = meta.matrix_world @ bn.head_local
    t = meta.matrix_world @ bn.tail_local
    hd, hs = probe(h); td, ts = probe(t)
    hi = 'IN' if (hs or 0) < 0 else 'OUT'
    ti = 'IN' if (ts or 0) < 0 else 'OUT'
    print('%-14s %8.3f %6s %8.3f %6s' % (name, hd or -1, hi, td or -1, ti))
    if hi == 'OUT' and (hd or 0) > 0.012:
        outs.append((hd, name + '.head'))
    if ti == 'OUT' and (td or 0) > 0.012:
        outs.append((td, name + '.tail'))
outs.sort(reverse=True)
print('FIT %d of %d key endpoints meaningfully outside (>12mm); worst: %s'
      % (len(outs), len(KEY) * 2, ', '.join('%s %.3f' % (n, d) for d, n in outs[:6]) or 'none'))

# ---- 2. automatic weights, then prove every vertex is weighted -------------
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
meta.select_set(True)
bpy.context.view_layer.objects.active = meta
try:
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    parented = True
except Exception as e:
    parented = False
    print('PARENT_FAIL %r' % (repr(e)[:200],))
print('PARENTED=%s vertex_groups=%d' % (parented, len(body.vertex_groups)))

_mw = body.matrix_world.copy()
body.parent = None
body.matrix_world = _mw

zero = 0
for v in body.data.vertices:
    if sum(g.weight for g in v.groups) <= 1e-6:
        zero += 1
print('WEIGHTS vertices=%d unweighted=%d %s'
      % (len(body.data.vertices), zero, 'OK' if zero == 0 else 'FAIL — bone heat missed bones'))

print('BONES ' + ', '.join(x.name for x in meta.data.bones))
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out_blend))
print('SAVED %s' % os.path.abspath(out_blend))
