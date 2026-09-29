#!/usr/bin/env node
/* _blender_publish.cjs — put the Blender results where a human can actually open them.
 *
 * Same delivery route as the rest of the FORGE artifacts: publish into a SUBDIRECTORY of
 * the DSH frontend dist (<dsh>/apps/web/dist/forge/), which the GUI's static seat serves
 * without auth and which keeps a relative sw.js 404ing, so no service worker is ever
 * installed on the host origin. The address handed to a human is the Tailscale one, read
 * from `tailscale serve status` at runtime -- never 127.0.0.1, which resolves to the
 * reader's own machine.
 *
 * That server returns PNG and MP4 as application/octet-stream (no image/video types in its
 * MIME map), so images and videos are inlined as data URIs instead of linked.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DSH = 'C:\\Users\\Admin\\deepseek-harness';
const DIST = path.join(DSH, 'apps', 'web', 'dist', 'forge');
const WORK = 'C:\\Users\\Admin\\workout-app';

function publicBase() {
  try {
    const out = execSync('tailscale serve status', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/https:\/\/[a-z0-9-]+\.[a-z0-9.-]*ts\.net/i);
    if (m) return m[0].replace(/\/+$/, '');
  } catch (e) { /* ignore */ }
  return null;
}

const IMAGES = [
  ['FORGE-blender-motion.png', 'One row per exercise, one column per point in the rep. Tempo is the app\'s own: 1500 ms eccentric, 320 hold, 1000 concentric, 320 hold.'],
  ['FORGE-blender-rig-poses.png', 'Four poses from the one rig: rest, arms out with bent elbows, overhead reach, squat.'],
  ['FORGE-blender-male-base.png', 'The CC0 base mesh, four views, straight out of the asset bundle.'],
];
const VIDEOS = [
  ['FORGE-blender-squat.mp4', 'squat', 'Squat rep cycle, 127 frames at 40 fps. Feet pinned in all three axes: the hips travel back, the foot does not slide. Knee and hip targets measured from a CC BY 3.0 reference clip by pose estimation, not chosen by eye.'],
  ['FORGE-blender-press.mp4', 'press', 'Overhead press rep cycle, 127 frames at 40 fps. Lockout to racked and back, elbows tracking out. Targets measured from a CC BY 3.0 reference clip.'],
  ['FORGE-blender-legext.mp4', 'legext', 'Seated leg extension, 127 frames at 40 fps, driven by the CDC public-domain reference: seated knee 109.0 deg against a measured 108.7. The rig knee cannot straighten past its own rest pose (152.0 deg), so the bottom 10.8 deg of the reference\'s extension is absent -- a limit of the rig, not a disagreement with the reference.'],
  ['FORGE-blender-machinepress.mp4', 'machinepress', 'Seated machine chest press, 127 frames at 40 fps, driven by the CDC public-domain reference. The elbow range is MEASURED: 86.4 deg at the chest to 130.5 deg extended, and the rig lands on 87.0 and 131.3, deltas +0.6 and +0.8. Earlier figures of 126.4/116.0 were WITHDRAWN: those extremes had been selected by wrist height, which reports a 10 deg range for a movement whose range is 44 deg.'],
];

(async () => {
  fs.mkdirSync(DIST, { recursive: true });
  const base = publicBase();
  const blocks = [];
  const videos = [];

  for (const [file, caption] of IMAGES) {
    const src = path.join(WORK, file);
    if (!fs.existsSync(src)) { console.log('SKIP missing ' + file); continue; }
    const buf = fs.readFileSync(src);
    fs.writeFileSync(path.join(DIST, file), buf);
    blocks.push(`<figure><img alt="${caption}" src="data:image/png;base64,${buf.toString('base64')}"><figcaption>${caption} <span class="dim">(${file}, ${(buf.length / 1024).toFixed(0)} KB)</span></figcaption></figure>`);
    console.log('COPIED ' + file + '  ' + (buf.length / 1024).toFixed(0) + ' KB');
  }

  for (const [file, name, caption] of VIDEOS) {
    const src = path.join(WORK, file);
    if (!fs.existsSync(src)) { console.log('SKIP missing ' + file); continue; }
    const buf = fs.readFileSync(src);
    fs.writeFileSync(path.join(DIST, file), buf);
    videos.push(`<figure><video controls loop muted playsinline preload="metadata" src="data:video/mp4;base64,${buf.toString('base64')}"></video><figcaption><strong>${name}</strong> — ${caption} <span class="dim">(${file}, ${(buf.length / 1024).toFixed(0)} KB)</span></figcaption></figure>`);
    console.log('COPIED ' + file + '  ' + (buf.length / 1024).toFixed(0) + ' KB');
  }

  const glb = path.join(WORK, 'FORGE-blender-rig.glb');
  let glbLine = '<span class="dim">GLB not present</span>';
  if (fs.existsSync(glb)) {
    const buf = fs.readFileSync(glb);
    fs.writeFileSync(path.join(DIST, 'FORGE-blender-rig.glb'), buf);
    glbLine = `<a href="FORGE-blender-rig.glb" download>FORGE-blender-rig.glb</a> — ${(buf.length / 1024).toFixed(0)} KB, 2 animations, 65 joints, 12,010 verts / 21,160 tris`;
    console.log('COPIED FORGE-blender-rig.glb  ' + (buf.length / 1024).toFixed(0) + ' KB');
  }

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FORGE · Blender 3D rig + animation</title>
<style>
:root{--bg:#08090b;--card:#14161a;--line:#242830;--ink:#f2f4f7;--mut:#98a1ac;--dim:#5f6873;--volt:#cbf33a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:26px;margin:0 0 6px;letter-spacing:-.02em}
h2{font-size:15px;margin:36px 0 10px;color:var(--volt);text-transform:uppercase;letter-spacing:.08em}
p{margin:0 0 12px;color:var(--mut);max-width:80ch}
.dim{color:var(--dim)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 18px}
figure{margin:0 0 26px}
img,video{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:10px;background:#0d0f12}
figcaption{margin-top:8px;color:var(--mut);font-size:13.5px}
ul{margin:0 0 12px;padding-left:20px;color:var(--mut)}
li{margin:0 0 8px}
code{background:#0d0f12;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:13px;color:#d8e0ea}
table{border-collapse:collapse;width:100%;font-size:14px;margin:0 0 12px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);color:var(--mut)}
th{color:var(--ink);font-weight:600}
a{color:var(--volt)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:760px){.grid2{grid-template-columns:1fr}}
.bad{color:#ff8a6a}
.good{color:var(--volt)}
</style></head><body><main>
<h1>Blender 4.5.14 LTS — rigged, animated and exported, on a machine with no GPU</h1>
<p>A second 3D path alongside the dependency-free <code>S3D</code> engine. Everything here came out of
<code>blender.exe --background --python &lt;script&gt;</code>: no GUI, no interaction, no GPU, no ffmpeg step.</p>

<div class="card">
<h2>Licensing</h2>
<table>
<tr><th>Piece</th><th>Source</th><th>Licence</th></tr>
<tr><td>Blender 4.5.14 LTS</td><td>download.blender.org, portable ZIP, SHA256 verified</td><td>GPL — free, no cost, no obligation on exported art</td></tr>
<tr><td>Male body mesh</td><td>Blender Studio <em>Human Base Meshes v1.4.1</em></td><td><strong>CC0</strong> — public domain, no attribution required</td></tr>
<tr><td>Rig</td><td>Rigify human metarig (bundled), face bones pruned</td><td>GPL tool; the rig it produces is not encumbered</td></tr>
</table>
<p><code>GEO-body_male_realistic</code>: 10,582 verts, 1.690 m, athletic build, A-pose, hands and feet modelled.
Nothing in the bundle is rigged — zero vertex groups on every mesh — so the rigging is the work.</p>
</div>

${videos.length ? `<h2>Motion</h2>${videos.join('\n')}` : ''}

<h2>Rep cycles</h2>
${blocks[0] ? blocks[0] : ''}

<h2>The rig</h2>
${blocks[1] ? blocks[1] : ''}

<h2>The source mesh</h2>
${blocks[2] ? blocks[2] : ''}

<div class="card">
<h2>Verification, not vibes</h2>
<ul>
<li>All three render engines work headless with no GPU: Cycles CPU (0.2 s), Workbench (1.0 s), and EEVEE
(software, 14.4 s at 480²) — the EEVEE-on-a-software-driver question is settled.</li>
<li>Bone fit tested by nearest-surface normal on every deform bone endpoint: worst meaningful error
<strong>3.9 cm</strong>, every limb inside the body.</li>
<li>Bone heat solved for all 65 bones: <strong>0 of 10,582 vertices unweighted</strong>.</li>
<li>Per-bone drive measured: <code>upper_arm.L</code> drives 267 verts in x[0.15,0.31] z[1.09,1.39];
<code>forearm.L</code> 263 in x[0.26,0.39] z[0.90,1.13]; <code>spine.006</code> 2,771 in z[1.51,1.69].
The head region is 100% <code>spine.006</code>.</li>
<li>My own forward kinematics is checked against Blender's pose evaluation before anything is baked:
worst joint disagreement <strong>0.000001 m</strong>.</li>
<li>Animation audit: lowest mesh vertex z = -0.0001 (no floor penetration), 0 quaternion sign flips
(a flip would make LINEAR interpolation spin the long way), 140 fcurves and 17,780 keys per clip with a
maximum value spread of 0.60.</li>
<li>Exported GLB parsed from its own bytes: 2 animations, 1 skin, 65 joints, 67 nodes;
<strong>every vertex's weights sum to 1.00000</strong> (0 out of tolerance), max joint index 64 of 65,
65 inverse bind matrices all finite, Y-up bbox x[-0.44,0.44] y[0,1.69] z[-0.15,0.15].</li>
<li>Round trip: the GLB re-imported into Blender and compared against the source at matched times, as
pairwise joint distances (invariant under the Y-up conversion). Worst mismatch
<strong>0.000002 m</strong> — with a precondition that both sides actually move, which is what caught the
false pass below.</li>
</ul>
</div>

<div class="card">
<h2>What went wrong on the way</h2>
<ul>
<li><strong>Mesh collapsed to a blob</strong> when any bone rotated. The appended asset object carried a location
its vertex data compensated for, so world geometry looked right while the object origin sat <strong>2.264 m</strong>
from the armature. Bone heat solved weights in world space and the armature modifier conjugated by that offset.
<span class="dim">Invisible at rest, because the rest skin matrix is identity whatever the offset.</span></li>
<li><strong>Both arms aimed across the body.</strong> In Blender a -Y-facing character's <code>.L</code> bones are at
+X; pairing <code>upper_arm.L</code> with the min-X hand aims each arm diagonally across the chest.</li>
<li><strong>Whole skeleton ~9% undersized.</strong> A stock metarig's total bone extent is taller than its body
(face bones sit above the skull), so scaling by mesh_height / total_extent shortens every limb.</li>
<li><strong>Arms folded into the torso.</strong> Rotating about a world axis converted through a bone's <em>rest</em>
matrix is only valid when the parent is unposed; and the sign was guessed. The measured arm direction is
(0.42,-0.18,-0.89), so +75° about Y points it at (-0.77,0,-0.64). The correct raise is -65°, overhead -155°.</li>
<li><strong>Every bone read "outside" the body</strong> — a broken probe, not a broken rig, which is why the probe now
self-tests against a vertex known to be on the surface first.</li>
<li><strong>A 10-minute timeout with no output.</strong> Setting <code>pose_bone.matrix</code> needs a depsgraph update
per bone to see the parent's pose, and each update re-evaluates a 10,582-vertex deform: ~2,500 updates per clip.
Replaced with analytic FK, which then had to be verified against Blender to be trusted.</li>
<li><strong>Saved .blend contained no actions.</strong> The filmstrip clears the active action, and Blender does not write
a zero-user datablock to disk, so the export silently had nothing to export. Fake user required.</li>
<li><strong class="bad">The exported GLB animated nothing.</strong> <code>sc.frame_set()</code> evaluates the action and
<em>overwrites</em> the pose, so calling it after posing keyed the same evaluated pose on all 127 frames. The action had
17,780 keys and no motion in it; the exporter then optimised those constant channels down to 2 keys. Fixed by moving
the playhead <em>before</em> posing.</li>
<li><strong class="bad">My own round-trip test false-passed.</strong> With a static bake, the source was static, the import
was static, and the mismatch was 1e-6 — so it reported CLEAN. A comparison of two wrong things agrees with itself. The
test now requires both sides to move before any agreement between them counts, and the bake reports the maximum fcurve
value spread so a constant action cannot pass silently.</li>
<li><strong class="bad">A green number that measured nothing.</strong> <code>foot_travel=0.0000</code> looked like a
perfectly planted foot; it was an artefact of the frozen bake. With real motion the same check reported 0.35 m, because
the root correction only fixed the ankle's z and the leg swing slid it forward. Now pinned in all three axes.</li>
<li><strong>Filmstrip layout.</strong> The frame width was taken from the last row only, so the wider row ran off the edge
of the ortho camera; rows were also stacked in reverse. Both fixed, and the row widths are now printed so the frame can
be checked against the widest row.</li>
</ul>
</div>

<div class="card">
<h2>Downloads</h2>
<p>${glbLine}</p>
<p class="dim">Generated by _blender_rig.py, _blender_pose.py, _blender_anim.py, _blender_export.py,
_blender_video.py and _blender_publish.cjs. FORGE's index.html was not touched.</p>
</div>
</main></body></html>`;

  fs.writeFileSync(path.join(DIST, 'blender.html'), html);
  console.log('WROTE blender.html  ' + (html.length / 1024 / 1024).toFixed(2) + ' MB');

  if (base) {
    const url = base + '/forge/blender.html';
    console.log('PUBLIC ' + url);
    try {
      const r = await fetch(url);
      const body = await r.text();
      console.log('VERIFY status=' + r.status + ' bytes=' + body.length +
        ' images=' + (body.match(/data:image\/png;base64/g) || []).length +
        ' videos=' + (body.match(/data:video\/mp4;base64/g) || []).length);
    } catch (e) {
      console.log('VERIFY_FAIL ' + e.message);
    }
  } else {
    console.log('NO_PUBLIC_BASE — dist copy still written');
  }
  process.exit(0);
})();
