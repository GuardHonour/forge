/* glm5.3-flash session: publishes the two-set comparison into the same public
   subdirectory the v4.1 work uses (<dsh>/apps/web/dist/forge/), plus the six
   filmstrip sheets of the new set. Reuses the Tailscale-serve URL detection. */
const fs = require('fs');
const path = require('path');

const DIST = 'C:\\Users\\Admin\\deepseek-harness\\apps\\web\\dist';
const OUT = path.join(DIST, 'forge');
const SRC = process.cwd();

fs.mkdirSync(OUT, { recursive: true });
const copied = [];
function put(from, to) {
  if (!fs.existsSync(from)) { console.log('  MISSING ' + from); return; }
  fs.copyFileSync(from, path.join(OUT, to));
  copied.push(to + ' (' + Math.round(fs.statSync(path.join(OUT, to)).size / 1024) + ' KB)');
}

put(path.join(SRC, 'FORGE-demo-compare.html'), 'compare.html');
for (const cat of ['chest', 'back', 'shoulders', 'arms', 'legs', 'core']) {
  put(path.join(SRC, 'FORGE-motion-v5-' + cat + '.png'), 'FORGE-motion-v5-' + cat + '.png');
}
console.log('published:');
copied.forEach(c => console.log('  ' + c));

function publicBase() {
  try {
    const ts = 'C:\\Program Files\\Tailscale\\tailscale.exe';
    const out = require('child_process').execFileSync(ts, ['serve', 'status'], { encoding: 'utf8' });
    const blocks = out.split(/\r?\n(?=https:\/\/)/);
    for (const b of blocks) if (/:3080\b/.test(b)) return b.split(/\s+/)[0].replace(/\/$/, '');
  } catch (e) { /* fall back to loopback */ }
  return 'http://127.0.0.1:3080';
}
const base = publicBase();
console.log('');
console.log('  ' + base + '/forge/compare.html   <- v4.1 flash vs glm5.3 flash, side by side');
if (base === 'http://127.0.0.1:3080') {
  console.log('  NOTE: no Tailscale mapping found; loopback only.');
}
process.exit(0);
