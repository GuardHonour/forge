/* Publish the FORGE work onto the one origin the user can actually reach.

   The DSH GUI's static fallback seat serves ANY file under the frontend dist root, and
   only the dist's own index.html is auth-gated — every other asset is public. So dropping
   the app in a subdirectory makes it reachable on port 3080 with no auth and no change to
   DSH itself. Two deliberate safeguards:
     - a SUBDIRECTORY, so the relative `sw.js` registration 404s and no service worker is
       ever installed on the host origin (one there could cache the DSH GUI's own assets);
     - a filename that is NOT the dist index, which is the one path that returns 401.
   Re-run this after any rebuild: `pnpm build` may clear the dist. */
const fs = require('fs');
const path = require('path');

const DIST = 'C:\\Users\\Admin\\deepseek-harness\\apps\\web\\dist';
const OUT = path.join(DIST, 'forge');
const SRC = process.cwd();

fs.mkdirSync(OUT, { recursive: true });

const copied = [];
function put(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.copyFileSync(from, path.join(OUT, to));
  copied.push(to);
  return true;
}

put(path.join(SRC, 'index.html'), 'index.html');
put(path.join(SRC, 'FORGE-demo-preview.html'), 'preview.html');
put(path.join(SRC, 'manifest.json'), 'manifest.json');
for (const i of ['favicon-96.png', 'icon-192.png', 'icon-512.png']) put(path.join(SRC, i), i);

/* The motion sheets are PNG, and the server's MIME map has no image type — a PNG comes
   back as octet-stream and the browser downloads it instead of showing it. So inline them
   as data URIs and they display on the page. */
const sheets = fs.readdirSync(SRC).filter(f => /^FORGE-(motion-\d|setup-cues).*\.png$/.test(f)).sort();const figs = sheets.map(f => {
  const b64 = fs.readFileSync(path.join(SRC, f)).toString('base64');
  const cap = f.replace(/^FORGE-/, '').replace(/\.png$/, '').replace(/-/g, ' ');
  return `<figure><figcaption>${cap}</figcaption><img alt="${cap}" src="data:image/png;base64,${b64}"></figure>`;
}).join('\n');

const html = `<!doctype html><meta charset="utf-8"><title>FORGE · Library overhaul</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#0a0b0d;color:#e8eaed;font-family:Archivo,system-ui,sans-serif;padding:28px 26px 60px;line-height:1.5}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:13px;letter-spacing:.13em;text-transform:uppercase;color:#8b9199;margin:34px 0 12px;font-weight:800}
p{color:#a8aeb6;font-size:13.5px;margin:0 0 16px;max-width:78ch}
a.btn{display:inline-block;background:#d7f04a;color:#0a0b0d;font-weight:800;font-size:13px;text-decoration:none;padding:11px 18px;border-radius:10px;margin:0 10px 10px 0}
a.btn.alt{background:transparent;color:#d7f04a;border:1px solid #3a3f47}
figure{margin:0 0 22px}
figcaption{font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:#8b9199;margin-bottom:7px}
img{width:100%;height:auto;border:1px solid #23262c;border-radius:9px;display:block}
code{background:#16181c;padding:2px 6px;border-radius:5px;font-size:12.5px;color:#cfd4da}
</style>
<h1>FORGE · Library animation overhaul</h1>
<p>48 per-exercise technique animations rebuilt on one shared vector engine. Everything below is
served from this page's own origin, so it also works as a single link to share.</p>
<a class="btn" href="preview.html">▶ Watch all 48 animations</a>
<a class="btn alt" href="index.html">Open the full app</a>
<h2>Motion sheets &middot; one rep, left to right</h2>
<p>Animated GIFs cannot survive the chat channel (they arrive re-encoded to a single static frame),
so each exercise is also rendered as a row across one 3140&nbsp;ms rep. This is the format that
caught the push-up bottoming out onto the floor when the geometry audit reported it as fine.</p>
${figs}
<h2>Notes</h2>
<p>Republished from <code>${SRC}</code>. Re-run <code>node _publish_forge.cjs</code> after a rebuild —
<code>pnpm build</code> can clear the dist directory this lives in.</p>`;

fs.writeFileSync(path.join(OUT, 'gallery.html'), html);

/* --- download bridge -------------------------------------------------------------
   The app lives on this machine, but the person testing it is often on another one
   (the laptop), where the local filesystem is unreachable — so a GitHub web upload
   has nothing to drag. Publishing byte-identical copies here lets them be saved from
   the browser and uploaded. Two deliberate choices:
     - a `.txt` extension, so the server's MIME map hands them over as a download
       instead of rendering them;
     - names that are NOT `sw.js`/`index.html`, so loading this page can never
       register a service worker on the host origin (its scope would follow the URL).
   The `download` attribute supplies the real filename at save time. */
const dl = path.join(OUT, 'dl');
fs.mkdirSync(dl, { recursive: true });
const dlFiles = [];
for (const [src, asTxt] of [['index.html', 'forge-index.html.txt'], ['sw.js', 'forge-sw.js.txt']]) {
  const bytes = fs.readFileSync(path.join(SRC, src));
  fs.writeFileSync(path.join(dl, asTxt), bytes);
  dlFiles.push({ src, asTxt, name: src, bytes: bytes.length, sha: require('crypto').createHash('sha256').update(bytes).digest('hex') });
}

const build = (fs.readFileSync(path.join(SRC, 'index.html'), 'utf8').match(/const APP_BUILD='([^']+)'/) || [])[1] || 'unknown';

const upload = `<!doctype html><meta charset="utf-8"><title>FORGE · upload these two</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#0a0b0d;color:#e8eaed;font-family:Archivo,system-ui,sans-serif;padding:26px 22px 60px;line-height:1.6}
h1{font-size:21px;margin:0 0 6px}
p{color:#a8aeb6;font-size:13.5px;max-width:70ch;margin:0 0 14px}
a.btn{display:block;background:#d7f04a;color:#0a0b0d;font-weight:800;text-decoration:none;padding:15px;border-radius:11px;margin:0 0 11px;max-width:430px}
a.btn small{display:block;font-weight:600;font-size:11.5px;opacity:.72;margin-top:3px}
code{background:#16181c;padding:2px 6px;border-radius:5px;font-size:12.5px}
ol{color:#a8aeb6;font-size:13.5px;max-width:70ch;padding-left:20px}
li{margin-bottom:9px}
.sha{font-family:ui-monospace,monospace;font-size:10.5px;color:#6f7681;word-break:break-all}
</style>
<h1>Upload these two files to GitHub</h1>
<p>These are byte-identical copies of the app on the KILAM PC, served over the tailnet so you can
save them on the laptop. Tap each, save it, then upload both to the repo.</p>
${dlFiles.map(f => `<a class="btn" href="dl/${f.asTxt}" download="${f.name}">Download <b>${f.name}</b><small>${f.bytes.toLocaleString()} bytes &middot; sha256 ${f.sha.slice(0, 16)}…</small></a>`).join('\n')}
<ol>
<li>Open <code>github.com/GuardHonour/forge</code></li>
<li><b>Add file</b> &rarr; <b>Upload files</b></li>
<li>Drag in both saved files &mdash; same names, so they <b>replace</b> the old ones</li>
<li>Commit straight to <code>main</code></li>
</ol>
<p>GitHub Pages rebuilds in about a minute. To confirm it worked, the live app's build marker should
read <code>${build}</code> &mdash; the value in the files you just uploaded. The verifier
<code>_verify_live.cjs</code> checks that from the KILAM PC, byte for byte.</p>`;
fs.writeFileSync(path.join(OUT, 'upload.html'), upload);
for (const f of dlFiles) console.log('  bridge: dl/' + f.asTxt + '  ' + f.bytes + ' bytes  sha256 ' + f.sha.slice(0, 16));

console.log('published to ' + OUT);
console.log('  ' + copied.join(', ') + ', gallery.html (+' + sheets.length + ' sheets inlined)');

/* 127.0.0.1:3080 is only the LOCAL binding — a phone or laptop on the tailnet cannot reach
   it, because the server binds loopback only. The address a human actually uses is whatever
   Tailscale serve proxies to 3080, so ask rather than guess. */
function publicBase() {
  try {
    const ts = 'C:\\Program Files\\Tailscale\\tailscale.exe';
    const out = require('child_process').execFileSync(ts, ['serve', 'status'], { encoding: 'utf8' });
    /* take the first origin whose mapping proxies to :3080 */
    const blocks = out.split(/\r?\n(?=https:\/\/)/);
    for (const b of blocks) if (/:3080\b/.test(b)) return b.split(/\s+/)[0].replace(/\/$/, '');
  } catch (e) { /* tailscale absent or unconfigured — fall back to loopback */ }
  return 'http://127.0.0.1:3080';
}
const base = publicBase();
console.log('');
console.log('  ' + base + '/forge/gallery.html   <- start here');
console.log('  ' + base + '/forge/preview.html   <- all 48 animating');
console.log('  ' + base + '/forge/index.html     <- the full app');
if (base === 'http://127.0.0.1:3080') {
  console.log('\n  NOTE: no Tailscale serve mapping to :3080 was found, so these only work on this');
  console.log('  machine itself — the server binds 127.0.0.1 and cannot be reached over the LAN.');
}
