"""_blender_preview.py — append a base mesh from the CC0 bundle and render a
turntable contact sheet in ONE image, by placing rotated copies side by side and
shooting them with an orthographic camera. That avoids needing any image tooling
to stitch frames: Blender composites by simple geometry.

Run:
  blender.exe --background --factory-startup --python _blender_preview.py -- <src.blend> <out.png> [object] [angles]
"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src_blend = argv[0]
out = argv[1]
name = argv[2] if len(argv) > 2 else 'GEO-body_male_realistic'
angles = [float(a) for a in argv[3].split(',')] if len(argv) > 3 else [0.0, 40.0, 90.0, 180.0]
samples = int(argv[4]) if len(argv) > 4 else 48

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# ---- bring in the mesh ------------------------------------------------------
with bpy.data.libraries.load(src_blend) as (src, dst):
    dst.objects = [name]
obj = dst.objects[0]
if obj is None:
    print('APPEND_FAIL no object named %s' % name)
    raise SystemExit(1)
sc.collection.objects.link(obj)
mods = []
for m in obj.modifiers:
    if m.type == 'MULTIRES':
        mods.append('MULTIRES(base=%d render=%d)' % (m.levels, m.render_levels))
    else:
        mods.append(m.type)
print('APPENDED %s verts=%d polys=%d mods=%s materials=%s uv_layers=%d'
      % (obj.name, len(obj.data.vertices), len(obj.data.polygons), mods,
         [m.name for m in obj.data.materials], len(obj.data.uv_layers)))

if not obj.data.materials:
    mat = bpy.data.materials.new('BodyMat')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (0.82, 0.83, 0.85, 1.0)
        bsdf.inputs['Roughness'].default_value = 0.42
    obj.data.materials.append(mat)
    print('ADDED neutral material (the base mesh ships without one)')

# ---- lay out rotated copies along X, feet on z=0 ---------------------------
span = 0.0
cursor = 0.0
pad = 0.22
copies = []
for i, a in enumerate(angles):
    c = obj if i == 0 else obj.copy()
    if i:
        sc.collection.objects.link(c)
    c.rotation_euler = (0.0, 0.0, math.radians(a))
    c.location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    pts = [c.matrix_world @ Vector(v) for v in c.bound_box]
    minx = min(p.x for p in pts); maxx = max(p.x for p in pts)
    minz = min(p.z for p in pts); maxz = max(p.z for p in pts)
    c.location = (cursor - minx, 0.0, -minz)
    bpy.context.view_layer.update()
    w = maxx - minx
    copies.append(c)
    print('  view %3.0fdeg  width=%.3f  height=%.3f' % (a, w, maxz - minz))
    cursor += w + pad
    span = max(span, maxz - minz)

total_w = cursor - pad
mid_x = total_w / 2.0
print('SHEET world width=%.3f height=%.3f' % (total_w, span))

# ---- ground, lights, camera ------------------------------------------------
bpy.ops.mesh.primitive_plane_add(size=total_w * 3.0, location=(mid_x, 0.0, 0.0))
floor = bpy.context.active_object
fm = bpy.data.materials.new('Floor')
fm.use_nodes = True
fb = fm.node_tree.nodes.get('Principled BSDF')
if fb:
    fb.inputs['Base Color'].default_value = (0.10, 0.11, 0.13, 1.0)
    fb.inputs['Roughness'].default_value = 0.85
floor.data.materials.append(fm)

world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.035, 0.04, 0.05, 1.0)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
sc.world = world

key = bpy.data.lights.new('Key', 'AREA'); key.energy = 900; key.size = 3.0
ko = bpy.data.objects.new('Key', key); sc.collection.objects.link(ko)
ko.location = (mid_x - total_w * 0.45, -total_w * 0.5, span * 1.25)
ko.rotation_euler = (math.radians(52), 0, math.radians(-38))

fill = bpy.data.lights.new('Fill', 'AREA'); fill.energy = 260; fill.size = 5.0
fo = bpy.data.objects.new('Fill', fill); sc.collection.objects.link(fo)
fo.location = (mid_x + total_w * 0.55, -total_w * 0.45, span * 0.8)
fo.rotation_euler = (math.radians(68), 0, math.radians(48))

rim = bpy.data.lights.new('Rim', 'AREA'); rim.energy = 420; rim.size = 2.5
ro = bpy.data.objects.new('Rim', rim); sc.collection.objects.link(ro)
ro.location = (mid_x + total_w * 0.1, total_w * 0.5, span * 1.1)
ro.rotation_euler = (math.radians(118), 0, math.radians(8))

cam_data = bpy.data.cameras.new('Cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = total_w * 1.06
cam = bpy.data.objects.new('Cam', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
cam.location = (mid_x, -total_w * 1.6, span * 0.52)
cam.rotation_euler = (math.radians(90), 0, 0)

res_x = 1800
world_h = span * 1.16
res_y = int(round(res_x * world_h / (total_w * 1.06)))
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = samples
sc.cycles.use_denoising = True
sc.render.resolution_x = res_x
sc.render.resolution_y = res_y
sc.render.image_settings.file_format = 'PNG'
sc.render.filepath = os.path.abspath(out)
sc.view_settings.view_transform = 'Filmic' if 'Filmic' in [v.name for v in sc.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Standard'

bpy.ops.render.render(write_still=True)
size = os.path.getsize(sc.render.filepath) if os.path.exists(sc.render.filepath) else 0
print('RENDER_OK bytes=%d res=%dx%d path=%s' % (size, res_x, res_y, sc.render.filepath))
