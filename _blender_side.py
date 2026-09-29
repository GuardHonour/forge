"""_blender_side.py — render the press extremes from the SIDE, which is the view the app itself
uses for the overhead press (`view:'side'` in the demo table).

A 9-column front-ish filmstrip cannot settle whether the elbows sit FORWARD of the bar (what the
cue asks: "elbows under it") or flare out to the SIDES (what the reference lifter does). Those two
are nearly the same silhouette from the front and completely different from the side, so the side
view is the only one that can answer it.

Run: blender.exe --background --factory-startup --python _blender_side.py -- <anim.blend> <outdir>
"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
anim, outdir = argv[0], argv[1]
bpy.ops.wm.open_mainfile(filepath=anim)
sc = bpy.context.scene
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]

for a in bpy.data.actions:
    if 'press' in a.name.lower():
        if not arm.animation_data:
            arm.animation_data_create()
        arm.animation_data.action = a
        print('ACTION %s range %s' % (a.name, tuple(a.frame_range)))
        break

sc.render.resolution_x, sc.render.resolution_y = 520, 760
sc.render.film_transparent = False
sc.render.image_settings.file_format = 'PNG'

# The figure faces -Y, so a side view is a camera on the X axis looking back along it.
cam_data = bpy.data.cameras.new('sidecam')
cam = bpy.data.objects.new('sidecam', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.3
DIST = 6.0
cam.location = Vector((DIST, 0.0, 0.95))
cam.rotation_euler = (math.radians(90), 0.0, math.radians(90))

for f, tag in ((0, 'lockout'), (60, 'racked')):
    sc.frame_set(f)
    bpy.context.view_layer.update()
    sc.render.filepath = os.path.join(outdir, 'side_%s.png' % tag)
    bpy.ops.render.render(write_still=True)
    # where did the hands actually end up, from the posed rig rather than from my arithmetic?
    hl = arm.pose.bones['hand.L'].matrix.translation
    sh = arm.pose.bones['upper_arm.L'].matrix.translation
    el = arm.pose.bones['forearm.L'].matrix.translation
    print('RENDERED %s frame=%d  hand=(%.3f,%.3f,%.3f) elbow=(%.3f,%.3f,%.3f) shoulder=(%.3f,%.3f,%.3f)'
          % (tag, f, hl.x, hl.y, hl.z, el.x, el.y, el.z, sh.x, sh.y, sh.z))
    print('   hand vs shoulder: fore/aft %+.3f m (-Y is forward), lateral %+.3f m, height %+.3f m'
          % (hl.y - sh.y, hl.x - sh.x, hl.z - sh.z))
    print('   elbow vs shoulder: fore/aft %+.3f m  (negative = elbow FORWARD, the cue)  lateral %+.3f m'
          % (el.y - sh.y, el.x - sh.x))
print('SIDE_OK')
