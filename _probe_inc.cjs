/* What grid can a lifter actually reach for each exercise?
   Prints the real inc/db/bw/bwPlus per exercise and, for the light-dumbbell
   question, the reachable weights around 4 and 6 kg. */
const fs = require('fs');
const lines = fs.readFileSync('index.html', 'utf8').split('\n');
const rows = [];
for (const L of lines) {
  const m = L.match(/^\s*\{id:'([^']+)',n:'([^']+)'/);
  if (!m) continue;
  const g = k => { const r = new RegExp(k + ":\\s*(?:'([^']*)'|([0-9.]+)|(true|false))").exec(L); return r ? (r[1] !== undefined ? r[1] : r[2] !== undefined ? r[2] : r[3]) : ''; };
  rows.push({ id: m[1], n: m[2], eq: g('eq'), inc: g('inc'), db: g('db'), bw: g('bw'), bwPlus: g('bwPlus'), start: g('start') });
}
console.log('parsed ' + rows.length + ' exercises');
const show = r => console.log('  ' + r.n.padEnd(26) + ' inc=' + String(r.inc || '(none)').padEnd(8) + ' db=' + String(r.db || '-').padEnd(4) + ' bw=' + String(r.bw || '-').padEnd(4) + ' bwPlus=' + String(r.bwPlus || '-').padEnd(4) + ' eq=' + r.eq);

console.log('\n--- notable dumbbell exercises (db>0) ---');
rows.filter(r => Number(r.db) > 0).slice(0, 20).forEach(show);
console.log('\n--- inc 1 ---'); rows.filter(r => r.inc === '1').forEach(show);
console.log('\n--- bodyweight (bw) / bodyweight-plus (bwPlus) ---');
rows.filter(r => r.bw || r.bwPlus).forEach(show);
console.log('\n--- how many have no inc at all (2.5 fallback): ' + rows.filter(r => !r.inc).length + ' of ' + rows.length);

/* inc distribution by equipment word, since that is what the fix keys off */
const by = {};
for (const r of rows) { const k = (r.eq || 'unknown').split('·')[0].trim(); (by[k] = by[k] || {})[r.inc || '(none)'] = ((by[k] = by[k] || {})[r.inc || '(none)'] || 0) + 1; }
console.log('\n--- inc by equipment ---');
for (const [eq, m] of Object.entries(by)) console.log('  ' + eq.padEnd(28) + JSON.stringify(m));