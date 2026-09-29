"""_blender_video.py — render each rep cycle to a playable MP4.

A filmstrip proves the poses; only motion proves the MOTION, and a still cannot. Blender
writes H.264/MPEG4 directly, so this needs no ffmpeg step and the result plays in a browser.

The animated .blend also contains the filmstrip's 18 figure copies, so this deletes
everything except the original body and armature first -- otherwise the video would render
18 overlapping figures.

Run:
  blender.exe --background --factory-startup --python _blender_video.py -- <anim.blend> <outdir> [samples] [w] [h]
"""
import bpy, sys, os, math, time
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
anim_blend, outdir = argv[0], argv[1]
samples = int(argv[2]) if len(argv) > 2 else 20
res_x = int(argv[3]) if len(argv) > 3 else 960
res_y = int(argv[4]) if len(argv) > 4 else 540

KEEP = ('GEO-body_male_realistic', 'Metarig')
bpy.ops.wm.open_mainfile(filepath=anim_blend)
sc = bpy.context.scene

# strip the filmstrip copies and any previous lighting/camera
for o in list(bpy.data.objects):
    if o.name not in KEEP:
        bpy.data.objects.remove(o, do_unlink=True)
body = bpy.data.objects['GEO-body_male_realistic']
meta = bpy.data.objects['Metarig']
body.hide_render = False
meta.hide_render = False
print('SCENE kept body=%s meta=%s actions=%s other_objects=%d'
      % (body.name, meta.name, [a.name for a in bpy.data.actions], len(bpy.data.objects) - 2))

world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.035, 0.04, 0.05, 1.0)
sc.world = world

def add_area(nm, energy, size, loc, rot):
    ld = bpy.data.lights.new(nm, 'AREA'); ld.energy = energy; ld.size = size
    o = bpy.data.objects.new(nm, ld); sc.collection.objects.link(o)
    o.location = loc; o.rotation_euler = [math.radians(a) for a in rot]
add_area('Key', 260, 3.0, (-2.0, -2.6, 3.0), (52, 0, -36))
add_area('Fill', 80, 5.0, (2.6, -2.2, 1.8), (66, 0, 46))
add_area('Rim', 140, 2.0, (0.3, 3.0, 2.6), (118, 0, 6))

bpy.ops.mesh.primitive_plane_add(size=14.0, location=(0.0, 0.0, 0.0))
floor = bpy.context.active_object
fm = bpy.data.materials.new('Floor'); fm.use_nodes = True
fb = fm.node_tree.nodes.get('Principled BSDF')
if fb:
    fb.inputs['Base Color'].default_value = (0.09, 0.10, 0.12, 1.0)
    fb.inputs['Roughness'].default_value = 0.9
floor.data.materials.append(fm)

# perspective 3/4 view: a straight-on ortho view hides how far the knees travel
target = bpy.data.objects.new('Target', None)
sc.collection.objects.link(target)
target.location = (0.0, 0.0, 0.85)
cam_data = bpy.data.cameras.new('Cam')
cam_data.lens = 55
cam = bpy.data.objects.new('Cam', cam_data)
sc.collection.objects.link(cam)
cam.location = (2.6, -3.4, 1.55)
c = cam.constraints.new('TRACK_TO')
c.target = target
c.track_axis = 'TRACK_NEGATIVE_Z'
c.up_axis = 'UP_Y'
sc.camera = cam

sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = samples
sc.cycles.use_denoising = True
sc.render.resolution_x = res_x
sc.render.resolution_y = res_y
sc.render.resolution_percentage = 100
sc.render.fps = 40
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Base Contrast'
sc.render.image_settings.file_format = 'FFMPEG'
sc.render.ffmpeg.format = 'MPEG4'
sc.render.ffmpeg.codec = 'H264'
sc.render.ffmpeg.constant_rate_factor = 'HIGH'
sc.render.ffmpeg.audio_codec = 'NONE'
sc.render.use_file_extension = True

for act in sorted(bpy.data.actions, key=lambda a: a.name):
    # Optional 6th argument: render ONLY this action. Without it every action in the blend is
    # re-rendered, which is ~5 minutes each -- fine for one clip, wasteful when four exist and only
    # the newest has changed. Re-rendering the unchanged ones is not just slow: it rewrites their
    # files, which destroys the byte-size comparison that catches a silently stale video.
    if len(argv) > 5 and act.name != argv[5]:
        print('SKIPPING action %s (only %s was requested)' % (act.name, argv[5]))
        continue
    meta.animation_data_create()
    meta.animation_data.action = act
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    sc.frame_start, sc.frame_end = f0, f1
    base = os.path.join(os.path.abspath(outdir), 'FORGE-blender-%s' % act.name)
    sc.render.filepath = base
    t0 = time.time()
    bpy.ops.render.render(animation=True)
    # Blender appends the frame range to the filename for FFMPEG output
    # (FORGE-blender-squat0000-0126.mp4), so checking base + '.mp4' reports a false zero.
    import glob, os as _os
    out = base + '.mp4'
    # EXCLUDE the destination from the glob. "FORGE-blender-squat.mp4" matches base+'*.mp4' too, and
    # because '.' (0x2E) sorts before '0' (0x30) it sorted FIRST, so made[0] == out, the guard below
    # skipped the replace, and the fresh render was left sitting beside a stale video that the run
    # then reported as OK. The giveaway was the byte size being identical to the previous render's.
    made = [p for p in sorted(glob.glob(base + '*.mp4')) if p != out]
    if made:
        # os.replace, NOT shutil.move: shutil.move falls back to os.rename, which on Windows RAISES
        # if the destination already exists.
        _os.replace(made[0], out)
    if _left := [p for p in glob.glob(base + '*.mp4') if p != out]:
        print('WARNING stray video left behind: %s' % _left)
    size = os.path.getsize(out) if os.path.exists(out) else 0
    print('VIDEO %-6s frames=%d..%d %.1fs -> %s bytes=%d (%.2f MB) %s'
          % (act.name, f0, f1, time.time() - t0, out, size, size / 1024 / 1024,
             'OK' if size > 10000 else 'FAIL — no video written'))
