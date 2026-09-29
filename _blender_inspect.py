"""_blender_inspect.py — inventory an asset .blend before trusting it.
Lists every mesh with its vertex count, modifiers, vertex groups and materials,
plus armatures and actions, so the rigging situation is read rather than
assumed. Run as:
  blender.exe --background --factory-startup --python _blender_inspect.py -- <file.blend>
"""
import bpy, sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
path = argv[0]
bpy.ops.wm.open_mainfile(filepath=path)

print('=== OBJECTS ===')
for o in sorted(bpy.data.objects, key=lambda x: (x.type, x.name)):
    verts = len(o.data.vertices) if o.type == 'MESH' else '-'
    polys = len(o.data.polygons) if o.type == 'MESH' else '-'
    mods = ','.join(m.type + (':' + getattr(m, 'object').name if m.type == 'ARMATURE' and getattr(m, 'object') else '') for m in o.modifiers)
    print('  %-42s %-9s verts=%-7s faces=%-7s vgroups=%-3d mods=[%s]'
          % (o.name, o.type, verts, polys, len(o.vertex_groups), mods))

print('=== ARMATURES ===')
for a in bpy.data.armatures:
    print('  %-30s bones=%d' % (a.name, len(a.bones)))
    for b in list(a.bones)[:60]:
        print('      bone %s parent=%s' % (b.name, b.parent.name if b.parent else '-'))

print('=== ACTIONS ===')
for a in bpy.data.actions:
    print('  %-30s frames=%s' % (a.name, a.frame_range[:]))

print('=== MATERIALS ===')
print('  ' + ', '.join(m.name for m in bpy.data.materials))
print('=== COLLECTIONS ===')
for c in bpy.data.collections:
    print('  %-30s objects=%d' % (c.name, len(c.objects)))
print('=== TOTALS === meshes=%d objects=%d armatures=%d actions=%d'
      % (len(bpy.data.meshes), len(bpy.data.objects), len(bpy.data.armatures), len(bpy.data.actions)))