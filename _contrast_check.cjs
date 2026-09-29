/* FORGE · contrast audit. WCAG AA needs 4.5:1 for normal-size text. --dim is
   used at 10-12px in ~40 places, so it must clear 4.5:1 against every surface it
   can sit on. Run: node _contrast_check.cjs */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const m = src.match(/const THEMES=\{[\s\S]*?\n\};/);
if (!m) { console.error('FAIL: could not locate THEMES'); process.exit(1); }
const THEMES = eval('(' + m[0].replace('const THEMES=', '').replace(/;\s*$/, '') + ')');

const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
const rel = h => {
  const c = hex2rgb(h).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const cr = (a, b) => { const x = rel(a), y = rel(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const SURFACES = ['bg', 'card', 'card2', 'card3'];
const FG = ['ink', 'mut', 'dim'];
let failures = 0;

console.log('WCAG AA needs 4.5:1 for normal text, 3:1 for large/bold text.\n');
for (const [id, t] of Object.entries(THEMES)) {
  const v = t.vars;
  const surfaces = SURFACES.filter(k => v[k]);
  const parts = [];
  for (const fg of FG) {
    if (!v[fg]) continue;
    const worst = Math.min(...surfaces.map(s => cr(v[fg], v[s])));
    const surface = surfaces.reduce((a, s) => (cr(v[fg], v[s]) < cr(v[fg], v[a]) ? s : a), surfaces[0]);
    const ok = worst >= 4.5;
    if (!ok) failures++;
    parts.push(fg + ' ' + worst.toFixed(2) + (ok ? '' : ' (worst on --' + surface + ')'));
  }
  // hierarchy: dim must stay visibly quieter than mut, which stays quieter than ink
  const bright = fg => rel(v[fg]) > 0.5 === rel(v.bg) < 0.5;
  const order = rel(v.bg) < 0.5
    ? rel(v.dim) < rel(v.mut) && rel(v.mut) < rel(v.ink)
    : rel(v.dim) > rel(v.mut) && rel(v.mut) > rel(v.ink);
  if (!order) { failures++; parts.push('HIERARCHY BROKEN (dim/mut/ink out of order)'); }
  console.log(id.padEnd(9), parts.join(' | '));
}
console.log('');
if (failures) { console.log('CONTRAST: ' + failures + ' FAILURE(S)'); process.exit(1); }
console.log('CONTRAST: ALL THEMES PASS AA for ink, mut and dim, with hierarchy intact');