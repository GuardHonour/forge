const S3D = require('./_s3d_core.js');
const P   = require('./_s3d_props.js');
const ch  = S3D.buildCharacter();
const G   = P.build(ch);
let bad = 0;
const ok = (c,m)=>{ if(!c){bad++;console.log('  FAIL: '+m);} else console.log('  ok   '+m); };

// ---- BAR: must lie along the line between the wrists, centred on it -------------------------
console.log('BAR placement (sandbox squat clip as stand-in):');
for (const t of [0, 0.6, 1.3, 2.2]) {
  const ev = S3D.sample(ch, 'squat', t);
  const out = P.frame(G, ch, S3D, ev, 'squat', S3D.sample);
  const bar = out.find(p => p.geo === G.bar);
  if (!bar) { console.log('  FAIL: no bar at t=' + t); bad++; continue; }
  const m = bar.matrix;
  const a = ev.fk.p.wrL, b = ev.fk.p.wrR;
  const mid = [(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
  const tvec = [m[12],m[13],m[14]];
  const dMid = Math.hypot(tvec[0]-mid[0], tvec[1]-mid[1], tvec[2]-mid[2]);
  // matrix column 0 is the bar's axis; it must equal the normalised wrist-to-wrist direction
  const ax = [m[0],m[1],m[2]];
  let axis = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const L = Math.hypot(...axis); axis = axis.map(v=>v/L);
  const dot = ax[0]*axis[0]+ax[1]*axis[1]+ax[2]*axis[2];
  const axLen = Math.hypot(...ax);
  console.log(`  t=${t.toFixed(1)}  midpoint err ${dMid.toExponential(1)}  |axis| ${axLen.toFixed(6)}  dot(axis,grip) ${dot.toFixed(6)}`);
  ok(dMid < 1e-9, `t=${t}: bar is centred between the wrists`);
  ok(Math.abs(axLen-1) < 1e-9, `t=${t}: axis column is unit length (no scale in the matrix)`);
  ok(Math.abs(dot-1) < 1e-6, `t=${t}: bar axis lies along the wrist-to-wrist line`);
  ok(G.bar.pos.length/3 === 314, `t=${t}: bar geometry is the baked mesh, not rescaled`);
}

// ---- SEAT: top surface must be derived from the clip's lowest pelvis ------------------------
console.log('\nSEAT placement (throwaway seated stub clip):');
S3D.CLIPS.__stub = { name:'__stub', duration:3.14, loop:true, desc:'test only',
  keys:[{t:0,p:{}},{t:1.5,p:{}},{t:1.82,p:{}},{t:2.82,p:{}},{t:3.14,p:{}}] };
const ys = []; for (let i=0;i<=24;i++) ys.push(S3D.sample(ch,'__stub',3.14*i/24).fk.p.hips[1]);
const minY = Math.min(...ys);
const seatY = P.seatYFor(G, ch, '__stub', S3D.sample);
const expect = minY - P.SEAT_M.pelvis_drop * G.scale;
console.log(`  lowest pelvis ${minY.toFixed(3)}  seat surface ${seatY.toFixed(3)}  expected ${expect.toFixed(3)}`);
ok(Math.abs(seatY-expect) < 1e-9, 'seat surface derives from the clip\'s lowest pelvis');
ok(seatY < minY, 'seat surface sits BELOW the pelvis, not through it');
ok((minY - seatY)/G.scale > 0.02 && (minY - seatY)/G.scale < 0.12, 'the pelvis drop is a plausible real distance');

// ---- NEGATIVE CONTROL: the bar check must be capable of failing ----------------------------
console.log('\nNEGATIVE CONTROL:');
const base = S3D.sample(ch, 'squat', 1.3);
const baseBar = P.frame(G, ch, S3D, base, 'squat', S3D.sample).find(p=>p.geo===G.bar).matrix;
console.log(`  baseline axis [${baseBar[0].toFixed(4)}, ${baseBar[1].toFixed(4)}, ${baseBar[2].toFixed(4)}]`);
ok(Math.abs(baseBar[1])<1e-9 && Math.abs(baseBar[2])<1e-9,
   'baseline bar is exactly level, because the two wrists are mirror images');

const ev2 = JSON.parse(JSON.stringify(base));
ev2.fk.p.wrL[1] += 25;   /* raise ONE wrist VERTICALLY. An earlier version of this test shifted a
                            wrist sideways and demanded a tilt -- which was wrong: mirrored wrists
                            mean a sideways shift leaves a rigid bar perfectly level. The control has
                            to be right for the anchor checks above to mean anything. */
const m2 = P.frame(G, ch, S3D, ev2, 'squat', S3D.sample).find(p=>p.geo===G.bar).matrix;
const a2 = ev2.fk.p.wrL, b2 = ev2.fk.p.wrR;
const wantMid = [(a2[0]+b2[0])/2,(a2[1]+b2[1])/2,(a2[2]+b2[2])/2];
const d2 = Math.hypot(m2[12]-wantMid[0], m2[13]-wantMid[1], m2[14]-wantMid[2]);
let ax2 = [b2[0]-a2[0], b2[1]-a2[1], b2[2]-a2[2]];
const L2 = Math.hypot(ax2[0],ax2[1],ax2[2]); ax2 = ax2.map(v=>v/L2);
const dot2 = m2[0]*ax2[0] + m2[1]*ax2[1] + m2[2]*ax2[2];
console.log(`  after raising wrL +25 units: midpoint err ${d2.toExponential(1)}  dot(axis,grip) ${dot2.toFixed(6)}  axis.y ${m2[1].toFixed(4)}`);
ok(d2 < 1e-9, 'bar follows the moved wrist exactly (so the anchor checks are not vacuous)');
ok(Math.abs(dot2-1) < 1e-6, 'bar still lies along the wrist-to-wrist line');
ok(Math.abs(m2[1]) > 0.05, 'bar TILTS when one wrist is raised, as a rigid bar must');

console.log('\n' + (bad ? 'PROPS PLACEMENT: ' + bad + ' FAILURE(S)' : 'PROPS PLACEMENT CLEAN'));
process.exitCode = bad ? 1 : 0;
