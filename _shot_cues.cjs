/* Renders every SET UP cue into one still, using the app's own CSS for that row, so the
   copy can be proofread in a single look. Reads the live values out of index.html —
   nothing is duplicated here. */
const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const src = fs.readFileSync('index.html', 'utf8');

const exs = {};
const exBlock = src.slice(src.indexOf('const EXS=['), src.indexOf('];', src.indexOf('const EXS=[')));
for (const m of exBlock.matchAll(/id:'([a-z0-9-]+)',n:'([^']*)',g:'([^']*)'/g)) exs[m[1]] = { n: m[2], g: m[3] };

const cues = [];
for (const m of src.matchAll(/'([a-z0-9-]+)':\{setup:'([^']*)',label:'([^']*)'/g))
  cues.push({ id: m[1], cue: m[2], label: m[3], n: (exs[m[1]] || {}).n || m[3], g: (exs[m[1]] || {}).g || '?' });

/* order by the app's own group order, to match the Library */
const ORDER = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core'];
cues.sort((a, b) => ORDER.indexOf(a.g) - ORDER.indexOf(b.g) || a.n.localeCompare(b.n));

const css = (src.match(/\.demosetup\{[^}]*\}/) || [''])[0] + (src.match(/\.demosetup b\{[^}]*\}/) || [''])[0];

const rows = cues.map(c =>
  `<div class="row"><div class="hd"><b>${c.n}</b><span>${c.g}</span></div>` +
  `<div class="demosetup"><b>SET UP</b><span>${c.cue}</span></div>` +
  `<div class="len">${c.cue.length}</div></div>`).join('\n');

const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;background:#0a0b0d;color:#e8eaed;font-family:Archivo,system-ui,sans-serif;padding:26px 30px 30px}
h1{font-size:19px;margin:0 0 3px;letter-spacing:.01em}
.sub{font-size:12px;color:#8b9199;margin-bottom:20px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 34px}
.row{position:relative;border-left:2px solid #2a2d33;padding:7px 0 9px 12px}
.hd{display:flex;gap:9px;align-items:baseline}
.hd b{font-size:13px;font-weight:800}
.hd span{font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#6f7681}
.len{position:absolute;right:0;top:8px;font-size:9.5px;color:#4d525a;font-variant-numeric:tabular-nums}
${css}
.demosetup{margin-top:5px;color:#a8aeb6}
.demosetup b{color:#6f7681}
.row:nth-child(-n+0){} /* keep parity simple */
</style><h1>FORGE &middot; SET UP cues</h1>
<div class="sub">${cues.length} exercises &middot; one line each, shown under the animation controls in the Library &middot; number on the right is the character count (max 80)</div>
<div class="grid">${rows}</div>`;

const t = path.join(process.cwd(), '_cues.html');
fs.writeFileSync(t, html);
const out = path.join(process.cwd(), 'FORGE-setup-cues.png');
for (const f of [out]) { try { fs.rmSync(f); } catch (e) {} }
cp.execFileSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1500,1190', '--screenshot=' + out, 'file:///' + t.replace(/\\/g, '/')
], { stdio: 'ignore' });
fs.rmSync(t, { force: true });
console.log('wrote FORGE-setup-cues.png  (' + cues.length + ' cues, longest ' +
  Math.max(...cues.map(c => c.cue.length)) + ' chars)');
