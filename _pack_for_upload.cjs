/* FORGE · PACK THE COMMITTED BUILD FOR A LAPTOP UPLOAD
 *
 * The person deploying this works on a LAPTOP and the repo lives on the KILAM PC, so
 * "git push" is not available to them and the app's files are not reachable from where they
 * sit. What they do have is a browser that can reach this machine over the tailnet. So this
 * packages the files that deploy — `index.html`, `sw.js` and `fix-guide.html` — as byte-identical
 * downloads, with a page that hands them over and the sha256 of each, and verifies over HTTP that
 * what the tailnet actually serves is those bytes and nothing else.
 *
 * WHY IT READS FROM GIT, NOT FROM DISK. `_publish_forge.cjs` publishes the WORKING TREE, which
 * is right for eyeballing a build in progress — but this workspace is edited concurrently, and a
 * working tree mid-edit is the one thing that must never reach a phone that holds somebody's only
 * training log. `git show HEAD:<file>` is the frozen, gated, committed build. If HEAD is dirty the
 * page says so, loudly, because an uploaded file must be the build that was tested.
 *
 * Run: node _pack_for_upload.cjs        → <dsh>/apps/web/dist/forge/deploy/
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DIST = 'C:\\Users\\Admin\\deepseek-harness\\apps\\web\\dist\\forge';
const OUT = path.join(DIST, 'deploy');
const LOCAL_PORT = 3080;
const FILES = [['index.html', 'index.html.txt'], ['sw.js', 'sw.js.txt'], ['fix-guide.html', 'fix-guide.html.txt']];

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const gitBytes = spec => { try { return execFileSync('git', ['show', spec], { maxBuffer: 64 * 1024 * 1024 }); } catch (e) { return null; } };
const marker = (s, re) => (s.match(re) || [])[1] || null;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  /* is the tree clean? a dirty tree means "this commit is not what is on disk" */
  let dirty = '';
  try { dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(); } catch (e) {}
  const head = (() => { try { return execFileSync('git', ['log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim(); } catch (e) { return 'unknown'; } })();

  const packed = [];
  for (const [name, asTxt] of FILES) {
    const bytes = gitBytes('HEAD:' + name);
    if (!bytes) { console.error('FAIL: HEAD:' + name + ' not readable'); process.exit(1); }
    fs.writeFileSync(path.join(OUT, asTxt), bytes);
    packed.push({ name, asTxt, bytes: bytes.length, sha: sha(bytes) });
    console.log('  packed ' + name.padEnd(11) + bytes.length.toLocaleString().padStart(9) + ' bytes  sha256 ' + sha(bytes).slice(0, 24) + '...');
  }

  const appBuild = marker(gitBytes('HEAD:index.html').toString('utf8'), /const APP_BUILD='([^']+)'/);
  const swBuild = marker(gitBytes('HEAD:sw.js').toString('utf8'), /const BUILD = '([^']+)'/);
  console.log('  committed build ' + appBuild + ' (sw ' + swBuild + ')  from ' + head);

  /* what is live right now, so the page can say what the upload will actually change */
  let liveBuild = 'unreachable';
  try {
    const r = await fetch('https://guardhonour.github.io/forge/index.html?cb=' + Date.now(), { cache: 'no-store' });
    liveBuild = marker(await r.text(), /const APP_BUILD='([^']+)'/) || 'unknown';
  } catch (e) {}
  console.log('  live build now  ' + liveBuild);

  /* ---- verify the tailnet serves exactly these bytes ---- */
  let verified = 0, failed = [];
  for (const f of packed) {
    try {
      const r = await fetch('http://127.0.0.1:' + LOCAL_PORT + '/forge/deploy/' + f.asTxt + '?cb=' + Date.now(), { cache: 'no-store' });
      const got = Buffer.from(await r.arrayBuffer());
      if (r.status === 200 && sha(got) === f.sha) verified++;
      else failed.push(f.name + ' (status ' + r.status + ', ' + got.length + ' bytes, sha ' + sha(got).slice(0, 16) + ')');
    } catch (e) { failed.push(f.name + ' (' + e.message + ')'); }
  }
  const url = (() => { try {
    const s = execFileSync('tailscale', ['serve', 'status'], { encoding: 'utf8' });
    const m = s.match(/https:\/\/([a-z0-9.-]+\.ts\.net)/i);
    return m ? 'https://' + m[1] : null;
  } catch (e) { return null; } })() || 'http://127.0.0.1:' + LOCAL_PORT;

  const page = `<!doctype html><meta charset="utf-8"><title>FORGE · deploy ${appBuild}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#0a0b0d;color:#e8eaed;font-family:Archivo,system-ui,sans-serif;padding:26px 22px 70px;line-height:1.6}
h1{font-size:21px;margin:0 0 4px}
h2{font-size:13px;letter-spacing:.09em;text-transform:uppercase;color:#8b939d;margin:26px 0 8px}
p,li{color:#a8aeb6;font-size:13.5px;max-width:72ch}
a.btn{display:block;background:#d7f04a;color:#0a0b0d;font-weight:800;text-decoration:none;padding:16px;border-radius:11px;margin:0 0 11px;max-width:440px}
a.btn small{display:block;font-weight:600;font-size:11.5px;opacity:.72;margin-top:3px}
code{background:#16181c;padding:2px 6px;border-radius:5px;font-size:12.5px;word-break:break-all}
.ok{color:#8ee06a;font-weight:700}.bad{color:#ff6b6b;font-weight:700}
.warn{background:#2a1d10;border-left:3px solid #d7a04a;padding:11px 13px;border-radius:7px;color:#e2c79a;font-size:13px;max-width:72ch}
ol{padding-left:20px}li{margin-bottom:9px}
.sha{font-family:ui-monospace,monospace;font-size:10.5px;color:#6f7681;word-break:break-all}
</style>
<h1>Deploy FORGE build <code>${appBuild}</code></h1>
<p>Byte-identical copies of the committed build on the KILAM PC, served over the tailnet
so you can save them here on the laptop. Live site is currently <code>${liveBuild}</code>.</p>
${dirty ? `<div class="warn"><b>The working tree has uncommitted changes.</b> That is expected — this page ships the
COMMITTED build <code>${head.split(' ')[0]}</code>, not what is on disk. Never upload a working tree that is mid-edit.</div>` : ''}
<h2>1. Download each</h2>
${packed.map(f => `<a class="btn" href="${f.asTxt}" data-src="${f.asTxt}" data-name="${f.name}">Save as <b>${f.name}</b><small>${f.bytes.toLocaleString()} bytes &middot; sha256 ${f.sha.slice(0, 24)}&hellip;</small></a>`).join('\n')}
<p><b>These buttons download the file already named correctly.</b> They fetch the bytes and hand them
to the browser as a <code>blob:</code> download, so the filename comes from this page and not from the
URL. That matters: the files are <i>stored</i> with a <code>.txt</code> suffix
because <code>…/deploy/index.html</code> is this page — and a plain link, a right-click &rarr; <b>Save
link as</b>, or pasting the raw URL all save it under the stored name, which uploads as
<code>index.html.txt</code> and <b>replaces nothing</b>. That is exactly what happened on the first
attempt. If you save by hand, rename it on disk before uploading.</p>
<script>
document.querySelectorAll('a.btn').forEach(a => a.addEventListener('click', async e => {
  e.preventDefault();
  try {
    const b = await (await fetch(a.dataset.src, { cache: 'no-store' })).blob();
    const u = URL.createObjectURL(b);
    const t = document.createElement('a');
    t.href = u; t.download = a.dataset.name;
    document.body.appendChild(t); t.click(); t.remove();
    setTimeout(() => URL.revokeObjectURL(u), 30000);
  } catch (err) { alert('download failed: ' + err.message + '\\nOpen ' + a.dataset.src + ' and rename it to ' + a.dataset.name); }
}));
</script>
<h2>2. Upload the files to GitHub</h2>
<ol>
<li>Open <code>github.com/GuardHonour/forge</code> &mdash; sign in if needed.</li>
<li><b>Add file</b> &rarr; <b>Upload files</b> (or go straight to <code>github.com/GuardHonour/forge/upload/main</code>).</li>
<li>Drag in <b>all</b> the saved files. Same names, so they replace the old ones.</li>
<li>Commit straight to <code>main</code>.</li>
</ol>
<h2>3. Confirm</h2>
<p>Pages rebuilds in about a minute. Then the KILAM PC verifies it end to end with
<code>node _verify_live.cjs</code>: the served bytes must hash-match the files below, both markers must
read <code>${appBuild}</code>, and the app must render the fixed Progress surfaces.</p>
<p class="sha">${packed.map(f => f.name + ' sha256 ' + f.sha).join('<br>')}</p>
<p>Tailnet copy served at <code>${url}/forge/deploy/index.html</code> &mdash; verified: <span class="${failed.length ? 'bad' : 'ok'}">${failed.length ? 'FAILED ' + failed.join(', ') : verified + '/' + packed.length + ' byte-identical'}</span></p>
${dirty ? '<h2>Heads up</h2><p>' + dirty.split('\n').map(l => '<code>' + l.replace(/</g, '&lt;') + '</code>').join('<br>') + '</p>' : ''}`;
  fs.writeFileSync(path.join(OUT, 'index.html'), page);

  console.log('  packaged to ' + OUT);
  if (failed.length) { console.log('  SERVE CHECK FAILED: ' + failed.join(', ')); process.exit(1); }
  console.log('  serve check: ' + verified + '/' + packed.length + ' byte-identical over HTTP');
  /* the static seat serves NO directory index — /forge/deploy/ is a 404, the file URL is the link */
  console.log('\n  ' + url + '/forge/deploy/index.html');
})();
