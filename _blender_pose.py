"""_blender_pose.py — pose the fitted rig into a motion contact sheet, rendered as ONE
image.

Two mistakes this file exists to avoid:

1. ROTATING ABOUT A WORLD AXIS THROUGH THE REST MATRIX IS ONLY VALID WHEN THE PARENT IS
   UNPOSED. Converting a world axis with bone.matrix_local and multiplying into
   rotation_quaternion is exact for a root bone and wrong for every child: once
   upper_arm.L has moved, forearm.L's converted axis no longer means what it did. The
   fix is to stop converting axes at all and set pose_bone.matrix (armature space)
   directly, which Blender back-solves into a basis and which is correct for posed
   parents. Poses must then be applied parents-first, with a depsgraph update between
   bones.

2. ROTATION SIGNS HAVE TO BE DERIVED, NOT GUESSED. Measured from the mesh: the arms hang
   at dir (0.42,-0.18,-0.89) and the toes point to -Y, so the figure faces -Y. Rotating
   that arm by +75 deg about Y gives (-0.77,0,-0.64) -- across the body and down, which
   renders as arms folded into the chest. The same arm raised to horizontal is -65 deg,
   and straight overhead is -155 deg.

A pose lives on the armature OBJECT, not its data, so N copies of the armature each hold
a different pose while sharing one skeleton definition; copy the mesh alongside each and
re-point its armature modifier, and a whole motion sequence renders in a single pass.

Run:
  blender.exe --background --factory-startup --python _blender_pose.py -- <rigged.blend> <out.png> [samples]
"""
import bpy, sys, os, math, time
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
rigged, out = argv[0], argv[1]
samples = int(argv[2]) if len(argv) > 2 else 40

bpy.ops.wm.open_mainfile(filepath=rigged)
sc = bpy.context.scene
body = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('GEO-body')][0]
meta = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
print('LOADED body=%s meta=%s bones=%d' % (body.name, meta.name, len(meta.data.bones)))
for m in list(body.modifiers):
    if m.type == 'MULTIRES':
        body.modifiers.remove(m)

AX = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}

def roton(arm, name, axis, deg):
    """Rotate a pose bone about a world axis through its own head, honouring posed
    parents by writing pose_bone.matrix rather than a converted local axis."""
    pb = arm.pose.bones.get(name)
    if pb is None:
        print('  MISSING bone %s' % name)
        return
    bpy.context.view_layer.update()
    M = pb.matrix.copy()                      # armature space
    head = M.to_translation()
    R = Matrix.Rotation(math.radians(deg), 4, AX[axis])
    pb.matrix = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ M
    bpy.context.view_layer.update()

def drop_root_to(arm, root, ankle_name, target_z):
    """FK legs swing the feet off the floor; a real squat keeps them planted, so
    translate the root so the ankle returns to where it started."""
    bpy.context.view_layer.update()
    pb = arm.pose.bones.get(root)
    now = arm.pose.bones[ankle_name].matrix.translation.z
    dz = target_z - now
    M = pb.matrix.copy()
    M.translation.z += dz
    pb.matrix = M
    bpy.context.view_layer.update()
    return dz

# Parents before children. Signs derived from the measured arm direction (0.42,-0.18,-0.89)
# and a -Y facing.
POSES = [
    ('rest', [], None),
    ('arms_out_elbows', [('upper_arm.L', 'Y', -65), ('upper_arm.R', 'Y', 65),
                         ('forearm.L', 'Z', -80), ('forearm.R', 'Z', 80)], None),
    ('overhead_reach', [('spine.002', 'Z', 6), ('shoulder.L', 'Y', -10),
                        ('upper_arm.L', 'Y', -155), ('forearm.L', 'Z', -18)], None),
    ('deep_squat', [('spine.001', 'X', 10), ('spine.002', 'X', 8),
                    ('thigh.L', 'X', -62), ('thigh.R', 'X', -62),
                    ('shin.L', 'X', 78), ('shin.R', 'X', 78),
                    ('foot.L', 'X', -16), ('foot.R', 'X', -16),
                    ('upper_arm.L', 'X', -55), ('upper_arm.R', 'X', -55)],
     ('spine', 'foot.L')),
]

# rest ankle height, to re-plant the feet in the squat
bpy.context.view_layer.update()
rest_ankle_z = meta.pose.bones['foot.L'].matrix.translation.z
print('REST ankle z=%.3f' % rest_ankle_z)

copies = []
for nm, rots, rootfix in POSES:
    arm = meta.copy()                 # shares armature data, owns its own pose
    sc.collection.objects.link(arm)
    mesh = body.copy()                # shares mesh data, owns its own modifier stack
    sc.collection.objects.link(mesh)
    mesh.parent = None
    for m in mesh.modifiers:
        if m.type == 'ARMATURE':
            m.object = arm
    for bname, ax, deg in rots:
        roton(arm, bname, ax, deg)
    if rootfix:
        dz = drop_root_to(arm, rootfix[0], rootfix[1], rest_ankle_z)
        print('  %s: root dropped %.3f to keep the feet planted' % (nm, dz))
    copies.append((nm, arm, mesh))
meta.hide_render = True
body.hide_render = True

# ---- lay out along X using DEFORMED bounds so each figure stands on z=0 -------
cursor = 0.0
pad = 0.25
span = 0.0
for nm, arm, mesh in copies:
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    me = ev.to_mesh()
    pts = [mesh.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    minx = min(p.x for p in pts); maxx = max(p.x for p in pts)
    minz = min(p.z for p in pts); maxz = max(p.z for p in pts)
    dx = cursor - minx
    arm.location.x += dx
    mesh.location.x += dx
    mesh.location.z += -minz
    arm.location.z += -minz
    bpy.context.view_layer.update()
    w = maxx - minx
    print('  pose %-18s width=%.3f height=%.3f' % (nm, w, maxz - minz))
    cursor += w + pad
    span = max(span, maxz - minz)
total_w = cursor - pad
mid_x = total_w / 2.0
print('SHEET width=%.3f height=%.3f' % (total_w, span))

# ---- ground, lights, camera ---------------------------------------------------
bpy.ops.mesh.primitive_plane_add(size=total_w * 3.0, location=(mid_x, 0.0, 0.0))
floor = bpy.context.active_object
fm = bpy.data.materials.new('Floor')
fm.use_nodes = True
fb = fm.node_tree.nodes.get('Principled BSDF')
if fb:
    fb.inputs['Base Color'].default_value = (0.09, 0.10, 0.12, 1.0)
    fb.inputs['Roughness'].default_value = 0.9
floor.data.materials.append(fm)

world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.04, 0.045, 0.055, 1.0)
sc.world = world

def add_area(nm, energy, size, loc, rot):
    ld = bpy.data.lights.new(nm, 'AREA'); ld.energy = energy; ld.size = size
    o = bpy.data.objects.new(nm, ld); sc.collection.objects.link(o)
    o.location = loc; o.rotation_euler = [math.radians(a) for a in rot]
add_area('Key', 210, 3.0, (mid_x - total_w * 0.30, -total_w * 0.42, span * 1.30), (50, 0, -34))
add_area('Fill', 70, 5.0, (mid_x + total_w * 0.40, -total_w * 0.38, span * 0.75), (66, 0, 44))
add_area('Rim', 120, 2.0, (mid_x, total_w * 0.45, span * 1.05), (118, 0, 4))

cam_data = bpy.data.cameras.new('Cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = total_w * 1.06
cam = bpy.data.objects.new('Cam', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
cam.location = (mid_x, -total_w * 1.5, span * 0.5)
cam.rotation_euler = (math.radians(90), 0, 0)

res_x = 1900
res_y = int(round(res_x * (span * 1.16) / (total_w * 1.06)))
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = samples
sc.cycles.use_denoising = True
sc.render.resolution_x = res_x
sc.render.resolution_y = res_y
sc.render.image_settings.file_format = 'PNG'
sc.render.filepath = os.path.abspath(out)
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Base Contrast'

t = time.time()
bpy.ops.render.render(write_still=True)
print('RENDER_OK %.1fs bytes=%d res=%dx%d path=%s'
      % (time.time() - t, os.path.getsize(sc.render.filepath), res_x, res_y, sc.render.filepath))
