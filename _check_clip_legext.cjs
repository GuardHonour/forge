/* _check_clip_legext.cjs — verification for _s3d_clip_legext.js (seated leg extension).

   Six checks, exactly as _CLIP_BRIEF.md's verification section requires:
     1. the module loads in node and registers S3D.CLIPS['legext']
     2. keys sit at the required tempo times, within 1e-9
     3. the measured extremes are reproduced: angles recomputed from ev.fk.p, printed against the
        targets with their deltas (tolerance +/- 2 deg)
     4. smooth motion: ~60 frames, no NaN, no >15 deg frame-to-frame joint jump, monotonic within
        each phase
     5. NEGATIVE CONTROL: perturbed clips must FAIL the same assertions
     6. render and LOOK at it (`--shot` writes the PNGs; the images are inspected by eye)

   Usage:  node _check_clip_legext.cjs [--shot] */
'use strict';
const fs = require('fs');
const { spawn } = require('child_process');

const S3D = require('./_s3d_core.js');
const mod = require('./_s3d_clip_legext.js');
const CLIP = S3D.CLIPS['legext'];
const NAME = 'legext';

const KEY_TIMES = [0, 1.5, 1.82, 2.82, 3.14];
const T_FLEX = 108.7, T_EXT = 162.8, TOL = 2;
const D2R = Math.PI / 180;

let fails = 0, checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (!cond) fails++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail === undefined ? '' : '   ' + detail));
  return cond;
}

/* ------------------------------------------------------------------ measuring helpers
   Angles are recomputed from ev.fk.p: the rotations are the input, the angles are the thing being
   measured, and only the second is comparable to the reference. */
function ang(p, a, b, c) {
  const u = S3D.sub(p[a], p[b]), v = S3D.sub(p[c], p[b]);
  const c2 = S3D.dot(u, v) / ((S3D.len(u) * S3D.len(v)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, c2))) * 180 / Math.PI;
}
function knees(ev) {
  return { L: ang(ev.fk.p, 'hipL', 'kneeL', 'ankleL'), R: ang(ev.fk.p, 'hipR', 'kneeR', 'ankleR') };
}
/* The impossible fold as a number. The knee is the top-front corner of a bent leg, so it must sit
   ABOVE the straight line from the hip to the ankle; a knee that bends backwards drops BELOW that
   line, and a wrong IK pole does exactly that while every interior angle stays inside tolerance.
   Returns the knee's signed height above the hip->ankle line, in rig units. Mirroring a leg across
   x=0 leaves this quantity unchanged (only y and z enter), so the two sides are directly
   comparable and both must be positive. */
function kneeAboveLine(ev, s) {
  const hip = ev.fk.p['hip' + s], knee = ev.fk.p['knee' + s], ankle = ev.fk.p['ankle' + s];
  const toAnkle = S3D.sub(ankle, hip), toKnee = S3D.sub(knee, hip);
  const u = S3D.mul(toAnkle, 1 / (S3D.len(toAnkle) || 1));
  const perp = S3D.sub(toKnee, S3D.mul(u, S3D.dot(toKnee, u)));
  return perp[1];
}
/* The one tolerance predicate, so the negative controls below run the SAME check the clip does. */
function tolVerdict(label, measured, target, tol) {
  const d = measured - target, pass = Math.abs(d) <= tol;
  return { pass: pass, line: (pass ? '  PASS  ' : '  FAIL  ') + label + '   measured ' +
    measured.toFixed(3) + ' vs target ' + target + '   (delta ' + d.toFixed(3) + ', tolerance +/-' + tol + ')' };
}
function angles(ev) {
  const p = ev.fk.p;
  return {
    kneeL: ang(p, 'hipL', 'kneeL', 'ankleL'), kneeR: ang(p, 'hipR', 'kneeR', 'ankleR'),
    hipL: ang(p, 'chest', 'hipL', 'kneeL'), hipR: ang(p, 'chest', 'hipR', 'kneeR'),
    ankL: ang(p, 'kneeL', 'ankleL', 'toeL'), ankR: ang(p, 'kneeR', 'ankleR', 'toeR'),
    elbL: ang(p, 'shL', 'elbL', 'wrL'), elbR: ang(p, 'shR', 'elbR', 'wrR'),
    shL: ang(p, 'chest', 'shL', 'elbL'), shR: ang(p, 'chest', 'shR', 'elbR')
  };
}
const cloneClip = (c, name) => { const o = JSON.parse(JSON.stringify(c)); o.name = name; return o; };

/* ------------------------------------------------------------------ 1. loads */
console.log('\n=== 1. module loads and registers =========================================');
ok(!!mod && !!mod.clip, 'require() returned { clip, targets }');
ok(!!CLIP, "S3D.CLIPS['" + NAME + "'] exists");
ok(!!CLIP && CLIP.name === NAME, 'clip.name === ' + NAME, CLIP && CLIP.name);
const M = S3D.MEASURED && S3D.MEASURED[NAME];
ok(!!M, 'S3D.MEASURED[' + NAME + '] recorded');
ok(!!M && M.source === 'CDC exercise video', 'provenance source recorded', M && M.source);
ok(!!M && /public domain/i.test(M.licence || ''), 'provenance licence recorded', M && M.licence);
ok(!!M && !!M.targets && M.targets.knee_extended_deg === T_EXT && M.targets.knee_flexed_deg === T_FLEX,
  'recorded targets are the given numbers, unedited',
  M && M.targets && (M.targets.knee_extended_deg + ' / ' + M.targets.knee_flexed_deg));

/* ------------------------------------------------------------------ 2. key times */
console.log('\n=== 2. keys sit at the tempo times ========================================');
const ch = S3D.buildCharacter();
const times = CLIP.keys.map(k => k.t);
ok(CLIP.duration === 3.14, 'duration is exactly 3.14', CLIP.duration);
ok(times.length === KEY_TIMES.length, times.length + ' keys', times.join(', '));
KEY_TIMES.forEach((t, i) => {
  const d = Math.abs((times[i] === undefined ? NaN : times[i]) - t);
  ok(d <= 1e-9, 'key ' + i + ' at t=' + t, 'got ' + times[i] + ' (delta ' + d + ')');
});

/* ------------------------------------------------------------------ 3. measured extremes */
console.log('\n=== 3. the measured extremes are reproduced ===============================');
function measureAt(t, name) {
  const ev = S3D.sample(ch, name || NAME, t);
  return { ev, k: knees(ev), sL: kneeAboveLine(ev, 'L'), sR: kneeAboveLine(ev, 'R'), clamped: ev.ik.clamped };
}
function report(t, label, target) {
  const m = measureAt(t);
  console.log('  t=' + t.toFixed(2) + '   ' + label);
  console.log('        target knee ' + target.toFixed(2) + ' deg   measured   L ' + m.k.L.toFixed(3) +
    '  (delta ' + (m.k.L - target).toFixed(3) + ')    R ' + m.k.R.toFixed(3) +
    '  (delta ' + (m.k.R - target).toFixed(3) + ')');
  return m;
}
const homeM = report(0, 'home — knee EXTENDED', T_EXT);
report(2.82, 'home — knee EXTENDED (end of phase 3)', T_EXT);
report(3.14, 'home — knee EXTENDED (phase 4 hold)', T_EXT);
const awayM = report(1.5, 'away — knee FLEXED', T_FLEX);
report(1.82, 'away — knee FLEXED (phase 2 hold)', T_FLEX);

ok(Math.abs(homeM.k.L - T_EXT) <= TOL, 'extended knee within +/-' + TOL + ' deg, left',
  homeM.k.L.toFixed(3) + ' vs ' + T_EXT);
ok(Math.abs(homeM.k.R - T_EXT) <= TOL, 'extended knee within +/-' + TOL + ' deg, right',
  homeM.k.R.toFixed(3) + ' vs ' + T_EXT);
ok(Math.abs(awayM.k.L - T_FLEX) <= TOL, 'flexed knee within +/-' + TOL + ' deg, left',
  awayM.k.L.toFixed(3) + ' vs ' + T_FLEX);
ok(Math.abs(awayM.k.R - T_FLEX) <= TOL, 'flexed knee within +/-' + TOL + ' deg, right',
  awayM.k.R.toFixed(3) + ' vs ' + T_FLEX);
ok(homeM.k.L > 152.0, 'extension passes the old Blender rig ceiling of 152.0 deg',
  'achieved ' + homeM.k.L.toFixed(3) + ' (target ' + T_EXT + ')');

ok(homeM.sL > 0 && awayM.sL > 0, 'left knee bends FORWARD (sits above the hip->ankle line)',
  'knee ' + homeM.sL.toFixed(1) + ' units above the line when extended / ' + awayM.sL.toFixed(1) + ' when flexed');
ok(homeM.sR > 0 && awayM.sR > 0, 'right knee bends FORWARD (mirror of the left)',
  'knee ' + homeM.sR.toFixed(1) + ' units above the line when extended / ' + awayM.sR.toFixed(1) + ' when flexed');
ok(homeM.clamped === 0 && awayM.clamped === 0, 'no IK chain out of reach at either extreme',
  'clamped ' + homeM.clamped + ' / ' + awayM.clamped);
ok(Math.abs(homeM.k.L - awayM.k.L) > 40, 'the arc is a real movement, not a wobble',
  'range ' + (homeM.k.L - awayM.k.L).toFixed(1) + ' deg');

/* the pelvis — the whole point of "seated": it must not move at all */
const pel = { x: [1e9, -1e9], y: [1e9, -1e9], z: [1e9, -1e9] };
for (let i = 0; i <= 200; i++) {
  const p = S3D.sample(ch, NAME, CLIP.duration * i / 200).fk.p.hips;
  ['x', 'y', 'z'].forEach((ax, k) => {
    pel[ax][0] = Math.min(pel[ax][0], p[k]); pel[ax][1] = Math.max(pel[ax][1], p[k]);
  });
}
const span = a => pel[a][1] - pel[a][0];
console.log('  pelvis (hips joint) over 201 frames of the whole rep:');
console.log('        x ' + pel.x[0].toFixed(9) + ' .. ' + pel.x[1].toFixed(9) +
            '    y ' + pel.y[0].toFixed(9) + ' .. ' + pel.y[1].toFixed(9) +
            '    z ' + pel.z[0].toFixed(9) + ' .. ' + pel.z[1].toFixed(9));
console.log('        range  x ' + span('x').toExponential(3) + '  y ' + span('y').toExponential(3) +
            '  z ' + span('z').toExponential(3) + '  (rig units; 1 unit ~= 1.46 cm)');
ok(span('x') < 1e-9 && span('y') < 1e-9 && span('z') < 1e-9, 'pelvis is fixed in space for the whole rep');

let minY = 1e9;
for (let i = 0; i <= 200; i++) {
  const p = S3D.sample(ch, NAME, CLIP.duration * i / 200).fk.p;
  ['ankleL', 'ankleR', 'toeL', 'toeR'].forEach(j => { minY = Math.min(minY, p[j][1]); });
}
const FOOT_R = 3.0;   /* the foot capsule's end radius in the rig's own table */
console.log('  lowest foot joint over the rep: y = ' + minY.toFixed(2) +
            '; the foot capsule (radius ' + FOOT_R + ') clears the floor grid at y=0 by ' +
            (minY - FOOT_R).toFixed(2) + ' units (' + ((minY - FOOT_R) / 68.17 * 100).toFixed(1) + ' cm)');
ok(minY - FOOT_R > 0, 'the free foot never reaches the floor (there is no floor contact in this movement)',
  'clearance ' + (minY - FOOT_R).toFixed(2) + ' units');

/* ------------------------------------------------------------------ 4. smooth motion */
console.log('\n=== 4. smooth motion =====================================================');
const N = 60, F = [];
for (let i = 0; i < N; i++) F.push({ t: CLIP.duration * i / N, ev: S3D.sample(ch, NAME, CLIP.duration * i / N) });
let nan = 0;
F.forEach(f => Object.keys(f.ev.fk.p).forEach(j => f.ev.fk.p[j].forEach(v => { if (!isFinite(v)) nan++; })));
ok(nan === 0, 'no NaN / non-finite joint position in any of the ' + N + ' frames', nan + ' bad values');
let worst = 0, worstAt = '', worstJ = '';
for (let i = 1; i < N; i++) {
  const a = angles(F[i - 1].ev), b = angles(F[i].ev);
  Object.keys(a).forEach(k => {
    const d = Math.abs(b[k] - a[k]);
    if (d > worst) { worst = d; worstAt = F[i].t.toFixed(3); worstJ = k; }
  });
}
ok(worst <= 15, 'largest frame-to-frame joint-angle jump <= 15 deg over ' + N + ' frames',
  worst.toFixed(3) + ' deg on ' + worstJ + ' at t=' + worstAt);

const phases = [[0, 1.5, 'down'], [1.5, 1.82, 'hold'], [1.82, 2.82, 'up'], [2.82, 3.14, 'hold']];
phases.forEach(([a, b, dir]) => {
  const seq = [];
  for (let i = 0; i <= 400; i++) {
    const t = Math.min(a + (b - a) * i / 400, CLIP.duration - 1e-9);
    seq.push(knees(S3D.sample(ch, NAME, t)).L);
  }
  let bad = null;
  for (let i = 1; i < seq.length; i++) {
    const d = seq[i] - seq[i - 1];
    const at = (a + (b - a) * i / 400).toFixed(3);
    if (dir === 'down' && d > 1e-9) { bad = 'rose by ' + d.toExponential(2) + ' at t=' + at; break; }
    if (dir === 'up' && d < -1e-9) { bad = 'fell by ' + d.toExponential(2) + ' at t=' + at; break; }
    if (dir === 'hold' && Math.abs(d) > 1e-9) { bad = 'moved by ' + d.toExponential(2) + ' at t=' + at; break; }
  }
  const what = dir === 'hold' ? 'constant' : 'monotonic (' + dir + ')';
  ok(bad === null, 'knee angle ' + what + ' through t=' + a + '..' + b + ' (401 sub-samples)',
    bad === null ? (seq[0].toFixed(2) + ' -> ' + seq[seq.length - 1].toFixed(2)) : bad);
});
let loK = 1e9, hiK = -1e9;
for (let i = 0; i < N; i++) { const k = knees(F[i].ev).L; loK = Math.min(loK, k); hiK = Math.max(hiK, k); }
console.log('  knee arc across the ' + N + '-frame sample: ' + loK.toFixed(3) + ' .. ' + hiK.toFixed(3) + ' deg');
ok(Math.abs(loK - awayM.k.L) < 1e-9 && Math.abs(hiK - homeM.k.L) < 1e-9,
  'the arc reached between keys never overshoots the extremes at the keys',
  'loop span ' + loK.toFixed(6) + '..' + hiK.toFixed(6) + ' vs key values ' +
  awayM.k.L.toFixed(6) + '..' + homeM.k.L.toFixed(6));

/* ------------------------------------------------------------------ 5. negative controls
   Each one runs THE SAME predicate the checks above run, on a deliberately broken clip, and prints
   the verdict that predicate produces. The assertion here is that the verdict is FAIL — a check
   that cannot fail proves nothing. */
console.log('\n=== 5. NEGATIVE CONTROLS (the check must be able to fail) =================');
/* NC1 — the extension keys carry the OLD Blender rig ceiling (152.0 deg) instead of the measured
   162.8, by pulling each extension key's ankle target to the distance that yields 152.0. */
const SK = S3D.buildSkeleton();
const L1 = S3D.vdist(SK.rest.kneeL, SK.rest.hipL), L2 = S3D.vdist(SK.rest.ankleL, SK.rest.kneeL);
function forceKnee(clip, idxs, theta) {
  const p = S3D.sample(ch, NAME, 0).fk.p;
  const d = Math.sqrt(L1 * L1 + L2 * L2 - 2 * L1 * L2 * Math.cos(theta * D2R));
  idxs.forEach(i => ['L', 'R'].forEach(s => {
    const node = clip.keys[i].ik['leg' + s], hip = p['hip' + s];
    node.t = S3D.add(hip, S3D.mul(S3D.norm(S3D.sub(node.t, hip)), d));
  }));
}
const nc1 = cloneClip(CLIP, 'legext_nc1');
forceKnee(nc1, [0, 3, 4], 152.0);
S3D.CLIPS['legext_nc1'] = nc1;
const e1 = measureAt(0, 'legext_nc1');
const v1 = tolVerdict('NC1: extended knee within +/-' + TOL + ' deg (left)', e1.k.L, T_EXT, TOL);
console.log('  NC1 — the extension keys authored at 152.0 deg, the old rig ceiling:');
console.log(v1.line);
ok(!v1.pass, 'NC1 : the tolerance check reports FAIL on a clip that misses the target',
  'verdict ' + (v1.pass ? 'PASS' : 'FAIL') + ', |delta| ' + Math.abs(e1.k.L - T_EXT).toFixed(3) + ' > ' + TOL);
delete S3D.CLIPS['legext_nc1'];

/* NC2 — the IK pole mirrored: the knee folds BACKWARDS through the thigh while the ANGLE still
   passes. This is the failure the brief warns about: a clean numeric table, an impossible limb. */
const nc2 = cloneClip(CLIP, 'legext_nc2');
nc2.keys.forEach(k => Object.keys(k.ik).forEach(n => { k.ik[n].pole = S3D.mul(k.ik[n].pole, -1); }));
S3D.CLIPS['legext_nc2'] = nc2;
const e2 = measureAt(0, 'legext_nc2'), f2 = measureAt(1.5, 'legext_nc2');
const v2a = tolVerdict('NC2: extended knee within +/-' + TOL + ' deg (left)', e2.k.L, T_EXT, TOL);
const v2b = tolVerdict('NC2: flexed knee within +/-' + TOL + ' deg (left)', f2.k.L, T_FLEX, TOL);
console.log('  NC2 — pole mirrored (the knee folds backwards through the thigh):');
console.log(v2a.line);
console.log(v2b.line);
console.log('  ' + (e2.sL > 0 && f2.sL > 0 ? '  PASS  ' : '  FAIL  ') +
  'NC2: left knee bends FORWARD (sits above the hip->ankle line)   knee is ' +
  e2.sL.toFixed(1) + ' units above the line when extended / ' + f2.sL.toFixed(1) + ' flexed');
ok(!(e2.sL > 0 && f2.sL > 0), 'NC2 : the direction check reports FAIL on a backwards-bending knee',
  'the ANGLE checks above both passed (' + e2.k.L.toFixed(3) + ' / ' + f2.k.L.toFixed(3) +
  ' deg), which is exactly why the direction check exists');
delete S3D.CLIPS['legext_nc2'];

/* NC3 — a tempo key moved off its boundary must fail check 2. */
const nc3 = cloneClip(CLIP, 'legext_nc3');
nc3.keys[1].t = 1.5000001;
ok(!(Math.abs(nc3.keys[1].t - 1.5) <= 1e-9), 'NC3 : the key-time check fails on a key moved by 1e-7 s',
  'delta ' + Math.abs(nc3.keys[1].t - 1.5).toExponential(1) + ' > 1e-9');

/* ------------------------------------------------------------------ 6. render */
if (process.argv.includes('--shot')) {
  console.log('\n=== 6. render =============================================================');
  render().then(finish).catch(e => { console.log('  RENDER FAILED: ' + e.message); fails++; finish(); });
} else {
  console.log('\n(render skipped: pass --shot)');
  finish();
}

function finish() {
  console.log('\n=== result ===============================================================');
  console.log(checks + ' assertions, ' + fails + ' failed  ->  ' + (fails ? 'FAIL' : 'PASS'));
  process.exitCode = fails ? 1 : 0;
}

/* Headless-Chrome render of this ONE clip. _s3d_view.html loads no clip file, so the clip and the
   equipment props are injected after load and the sheet rebuilt — same viewer, same renderer,
   same props _s3d_app.js uses, so what is inspected is what the app draws (a seat under the
   pelvis and a back pad behind it, positioned exactly as _s3d_props.js positions them). */
async function render() {
  const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const PORT = 9367, TMP = '_gifwork';
  fs.mkdirSync(TMP, { recursive: true });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--force-device-scale-factor=1', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + process.cwd() + '\\' + TMP + '\\p_legext', 'about:blank'], { stdio: 'ignore' });
  let ws = null, id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method: m, params: p || {} }));
  });
  try {
    for (let i = 0; i < 120; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
        const pg = list.find(t => t.type === 'page');
        if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; }
      } catch (e) {}
      await sleep(250);
    }
    if (!ws) throw new Error('no CDP target');
    await new Promise(r => ws.addEventListener('open', r));
    const errors = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate', { url: 'file:///' + process.cwd().replace(/\\/g, '/') + '/_s3d_view.html' });
    await sleep(2600);

    const inject = '(function(){return new Promise(function(res){' +
      'var s=document.createElement("script");s.src="_s3d_props.js";' +
      's.onload=function(){var s2=document.createElement("script");s2.src="_s3d_clip_legext.js";' +
      's2.onload=function(){var PR=window.S3D_PROPS,ch=window.ch,R=window.S3D_RENDER;' +
      'var G=PR.build(ch),orig=R.drawCell;' +
      'R.drawCell=function(ctx,x,y,cell,ev,cam,opts){opts=opts||{};' +
      'try{opts.props=PR.frame(G,ch,window.S3D,ev,"legext",window.S3D.sample);}catch(e){}' +
      'return orig(ctx,x,y,cell,ev,cam,opts);};' +
      'res(window.__build=function(o){return S3DVIEW.build(o);});};' +
      'document.head.appendChild(s2);};document.head.appendChild(s);});})()';
    const r = await send('Runtime.evaluate', { expression: inject, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('inject failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));

    async function sheet(query, out) {
      const built = await send('Runtime.evaluate', {
        expression: 'JSON.stringify(__build(' + query + '))', awaitPromise: true, returnByValue: true
      });
      if (built.exceptionDetails) throw new Error('build failed: ' + JSON.stringify(built.exceptionDetails).slice(0, 400));
      const size = JSON.parse(built.result.value);
      await send('Emulation.setDeviceMetricsOverride', {
        width: Math.ceil(size.w), height: Math.ceil(size.h), deviceScaleFactor: 1, mobile: false });
      await sleep(1500);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
      console.log('  wrote ' + out + '   ' + Math.ceil(size.w) + 'x' + Math.ceil(size.h));
    }

    /* the whole arc from the app's own default camera (yaw 30, pitch 8, dist 430) */
    await sheet('{mode:"filmstrip",clips:"legext",frames:11,cell:190,view:"persp",yaw:30,pitch:8,dist:430}',
                '_legext_filmstrip.png');
    /* the sagittal plane — the view in which a knee bending the wrong way is unmistakable */
    await sheet('{mode:"filmstrip",clips:"legext",frames:11,cell:190,view:"side",dist:430}',
                '_legext_side.png');
    /* the two extremes large, from the app's camera, with the solved skeleton drawn over the mesh */
    await sheet('{mode:"filmstrip",clips:"legext",frames:3,cell:440,view:"persp",yaw:30,pitch:8,dist:430,skeleton:1}',
                '_legext_extremes.png');
    /* the same two extremes from the front — the check that the two legs are symmetric */
    await sheet('{mode:"filmstrip",clips:"legext",frames:3,cell:440,view:"front"}',
                '_legext_front.png');
    /* the FLEXED (away) pose in all three orthographic views, large — the pose a knee that folds
       the wrong way, or a limb through the body, would be unmistakable in */
    await sheet('{mode:"threeview",clips:"legext",cell:330,t:0.5096,skeleton:1}',
                '_legext_threeview_flexed.png');
    console.log('  page errors: ' + (errors.length ? errors.slice(0, 3).join(' | ') : 'none'));
  } finally {
    try { chrome.kill(); } catch (e) {}
    await sleep(900);
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(TMP + '/p_legext', { recursive: true, force: true }); break; } catch (e) { await sleep(400); }
    }
  }
}
