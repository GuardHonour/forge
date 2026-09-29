/* one-off repair: a PowerShell Get-Content/Set-Content round trip decoded these
   UTF-8 files as Windows-1252 and re-encoded them, so every non-ASCII character
   became mojibake. Reverse it exactly: strip the BOM Set-Content added, map each
   character back to the byte cp1252 would have produced, decode as UTF-8. */
const fs = require('fs');
const CP = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A,
  0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
  /* the five bytes cp1252 leaves undefined pass through unchanged */
  0x81: 0x81, 0x8D: 0x8D, 0x8F: 0x8F, 0x90: 0x90, 0x9D: 0x9D };

for (const f of ['index.html', 'sw.js']) {
  let s = fs.readFileSync(f, 'utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);            /* BOM Set-Content wrote */
  const bytes = Buffer.alloc(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const b = c <= 0xFF ? c : CP[c];
    if (b === undefined) { console.error('FAIL unmapped U+' + c.toString(16) + ' in ' + f + ' at ' + i); process.exit(1); }
    bytes[i] = b;
  }
  let out = bytes.toString('utf8');
  if (out.charCodeAt(0) === 0xFEFF) out = out.slice(1);      /* an original BOM would land here */
  if (out.includes('\uFFFD')) { console.error('FAIL: replacement char after decode in ' + f); process.exit(1); }
  fs.writeFileSync(f, out, 'utf8');
  console.log(f, 'repaired ->', out.length, 'chars, mojibake left:', (out.match(/â€|Â/g) || []).length);
}
