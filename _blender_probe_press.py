"""_blender_probe_press.py — measure the hand path of a clip, so "the motion is wrong" can be
answered with numbers instead of agreement.

For an overhead press the useful invariants are:
  * the hands stay at roughly SHOULDER WIDTH apart in X (a barbell does not narrow or widen)
  * the bar travels in a near-VERTICAL line in front of the face: the hand's forward offset
    from the shoulder changes little, and height rises monotonically
  * the elbows stay UNDER the bar, i.e. roughly beneath or in front of the hands, never
    flared out beyond them

Run: blender.exe --background --factory-startup --python _blender_probe_press.py -- <anim.blend> [clip]
"""
import bpy, sys, math

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
blend = argv[0]
clip = argv[1] if len(argv) > 1 else 'press'

bpy.ops.wm.open_mainfile(filepath=blend)
sc = bpy.context.scene
for o in list(bpy.data.objects):
    if o.name not in ('GEO-body_male_realistic', 'Metarig'):
        bpy.data.objects.remove(o, do_unlink=True)
meta = bpy.data.objects['Metarig']
act = bpy.data.actions[clip]
meta.animation_data_create()
meta.animation_data.action = act
f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])

def W(bone, tail=False):
    pb = meta.pose.bones[bone]
    return meta.matrix_world @ (pb.tail if tail else pb.head)

print('CLIP %s frames %d..%d' % (clip, f0, f1))
print('%5s | %-26s | %-26s | %s' % ('frame', 'hand relative to shoulder', 'elbow relative to shoulder', 'hand separation'))
print('%5s | %7s %7s %7s | %7s %7s %7s | %s' % ('', 'lat', 'fwd', 'up', 'lat', 'fwd', 'up', 'X between hands'))
rows = []
for f in range(f0, f1 + 1, 9):
    sc.frame_set(f)
    bpy.context.view_layer.update()
    sh = W('upper_arm.L')
    hd = W('hand.L', tail=True)
    el = W('forearm.L')
    shR = W('upper_arm.R')
    hdR = W('hand.R', tail=True)
    relH = hd - sh
    relE = el - sh
    sep = abs(hd.x - hdR.x)
    rows.append((f, relH, relE, sep, hd))
    print('%5d | %7.3f %7.3f %7.3f | %7.3f %7.3f %7.3f | %7.3f'
          % (f, relH.x, relH.y, relH.z, relE.x, relE.y, relE.z, sep))

# how straight is the bar path? a press is close to a vertical line
span_up = max(r[4].z for r in rows) - min(r[4].z for r in rows)
span_lat = max(r[4].x for r in rows) - min(r[4].x for r in rows)
span_fwd = max(r[4].y for r in rows) - min(r[4].y for r in rows)
path = sum((rows[i + 1][4] - rows[i][4]).length for i in range(len(rows) - 1))
print('PATH hand travel: up=%.3f lateral=%.3f fore/aft=%.3f straight-line=%.3f actual=%.3f (ratio %.2f)'
      % (span_up, span_lat, span_fwd, (rows[-1][4] - rows[0][4]).length, path,
         path / max(1e-6, (rows[-1][4] - rows[0][4]).length)))
print('PATH lateral vs vertical: lateral is %.0f%% of the vertical travel %s'
      % (100 * span_lat / max(1e-6, span_up),
         '<- for a press this should be a small fraction' if span_lat > 0.25 * span_up else '(plausible)'))
sep_spread = max(r[3] for r in rows) - min(r[3] for r in rows)
print('HANDS separation %.3f..%.3f (spread %.3f) — a barbell holds a constant width'
      % (min(r[3] for r in rows), max(r[3] for r in rows), sep_spread))
elbow_out = max(r[2].x for r in rows)
print('ELBOW max lateral offset from shoulder = %.3f (elbows should stay under the bar: %s)'
      % (elbow_out, 'OK' if elbow_out < max(r[1].x for r in rows) + 0.05 else 'FLARED WIDER THAN THE HANDS'))
