"""_blender_test.py — headless render smoke test.
The one thing I could not verify from documentation is whether Blender renders
at all on this box: it has no GPU, so EEVEE (a real-time GPU renderer) is the
risk and Cycles on CPU is the safe path. This settles it with evidence instead
of assumption. Run as:
  blender.exe --background --factory-startup --python _blender_test.py -- <ENGINE> <out.png>
"""
import bpy, sys, time, os

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
engine = argv[0] if argv else 'CYCLES'
out = argv[1] if len(argv) > 1 else 'test.png'

sc = bpy.context.scene
sc.render.engine = engine
sc.render.resolution_x = 480
sc.render.resolution_y = 480
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'PNG'
sc.render.filepath = os.path.abspath(out)

# Workbench needs no lighting setup and is the cheapest "does it draw" check.
if engine == 'CYCLES':
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    sc.cycles.use_denoising = False
elif engine == 'BLENDER_WORKBENCH':
    sc.display.shading.light = 'STUDIO'

t = time.time()
try:
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t
    size = os.path.getsize(sc.render.filepath) if os.path.exists(sc.render.filepath) else 0
    print('RESULT_OK engine=%s seconds=%.1f bytes=%d path=%s' % (engine, dt, size, sc.render.filepath))
except Exception as e:
    print('RESULT_FAIL engine=%s error=%s' % (engine, repr(e)[:300]))
