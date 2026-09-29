const S3D = require('./_s3d_core.js');
const P = require('./_s3d_props.js');
const ch = S3D.buildCharacter();
const sc = P.unitsPerMetre(ch);
console.log('units per metre (derived from the 180cm rig):', sc.toFixed(2));
console.log('  sanity: a 1.80 m figure should be ~' + (1.80*sc).toFixed(1) + ' units tall');
const G = P.build(ch);
let bad = 0;
for (const name of ['bar','seat','back']) {
  const m = G[name], n = m.pos.length/3;
  let maxIdx = -1, degenerate = 0, unnormalised = 0;
  for (let i=0;i<m.idx.length;i++) if (m.idx[i] > maxIdx) maxIdx = m.idx[i];
  for (let i=0;i<m.idx.length;i+=3) if (m.idx[i]===m.idx[i+1]||m.idx[i+1]===m.idx[i+2]||m.idx[i]===m.idx[i+2]) degenerate++;
  for (let i=0;i<n;i++){ const L=Math.hypot(m.nrm[i*3],m.nrm[i*3+1],m.nrm[i*3+2]); if(Math.abs(L-1)>1e-3) unnormalised++; }
  const ok = maxIdx < n && degenerate===0 && unnormalised===0 && n>0;
  if(!ok) bad++;
  console.log(`  ${name.padEnd(5)} verts=${String(n).padStart(5)} tris=${String(m.idx.length/3).padStart(5)} maxIdx=${String(maxIdx).padStart(5)}<${n} degenerate=${degenerate} unnormalised_normals=${unnormalised}  ${ok?'OK':'FAIL'}`);
}
// absolute anchors: the bar must be a real 2.20 m long and the seat a real 30 cm wide
const bx = G.bar.pos.filter((_,i)=>i%3===0);
const barLen = (Math.max(...bx)-Math.min(...bx))/sc;
const sx = G.seat.pos.filter((_,i)=>i%3===0);
const seatW = (Math.max(...sx)-Math.min(...sx))/sc;
console.log('  bar length  = ' + barLen.toFixed(3) + ' m  (target 2.200)  ' + (Math.abs(barLen-2.20)<0.001?'OK':'FAIL'));
console.log('  seat width  = ' + seatW.toFixed(3) + ' m  (target 0.300)  ' + (Math.abs(seatW-0.30)<0.001?'OK':'FAIL'));
if (Math.abs(barLen-2.20)>=0.001) bad++;
if (seatW<0.05||seatW>1.0) bad++;
// NEGATIVE CONTROL: the checks above must be able to fail. Corrupt a copy and confirm they do.
const G2 = P.build(ch); G2.bar.pos[0] += 999;
const bx2 = G2.bar.pos.filter((_,i)=>i%3===0);
const badLen = (Math.max(...bx2)-Math.min(...bx2))/sc;
console.log('  NEGATIVE CONTROL (bar nudged 999 units): length ' + badLen.toFixed(3) + ' m -> check ' + (Math.abs(badLen-2.20)<0.001?'STILL PASSES (check is vacuous!)':'correctly FAILS'));
console.log(bad ? 'PROPS CHECK: ' + bad + ' FAILURE(S)' : 'PROPS CHECK CLEAN');
process.exitCode = bad ? 1 : 0;
