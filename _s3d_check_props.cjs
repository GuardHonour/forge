/* _s3d_check_props.cjs — does equipment actually reach the pixels?
   node _s3d_check_props.cjs [page.html]

   "It did not throw" is not evidence that a barbell was drawn: a prop that silently fails to draw
   looks exactly like a clean run. So this drives the real renderer in Chrome, draws the same pose
   with and without props, and measures the difference — how many pixels changed, by how much, and
   WHERE. The where matters as much as the whether: the bar is checked against the projected
   midpoint of the wrists and the seat against the projected midpoint of the hips, and a prop is
   also checked against the projection of its OWN matrix translation, so a prop drawn through the
   wrong slot (skinned to the hips, say) fails here instead of looking plausible.

   Clips: the bar is placed from the core's real `squat` clip. The seated rigs are keyed by the
   MEASURED clip names (`legext`, `machinepress`), which the renderer check does not have, so a
   throwaway stub is registered under the name `legext` — the props module resolves equipment by
   clip name and takes the evaluated pose as an argument, so seat/back placement (seatYFor included)
   runs for real against that pose.

   It also drives the paths that must not take the figure down: more props than spare bone slots, a
   malformed geo, and a plain-Array geo (which would throw inside bufferData). And it re-draws with
   no props after prop draws, to prove the prop matrices did not leak into the body's slots. */
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9365;
const TMP = '_gifwork';
const PAGE = process.argv[2] || '_s3d_view.html';

fs.mkdirSync(TMP, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The experiment runs in the page on ONE canvas and one ctx: every draw() clears first, so each
   snapshot is independent, and one WebGL context stays well inside Chrome's context cap. */
const EXPERIMENT = `(function(){
  var R = window.S3D_RENDER, P = window.S3D_PROPS, S = window.S3D;
  var W = 240, H = 240;
  var out = { ok:true, notes:{}, diff:{} };
  try {
    window.__warn = [];
    var ow = console.warn;
    console.warn = function(){ window.__warn.push([].slice.call(arguments).join(' ')); };

    var ch = S.buildCharacter(), geo = S.packGeometry(ch);
    var G = P.build(ch);
    out.notes.api = ['scale','bar','seat','back'].map(function(k){ return k + ':' + typeof G[k]; }).join(' ');
    var shape = function(g){
      if (!g || !(g.pos instanceof Float32Array) || !(g.nrm instanceof Float32Array) ||
          !(g.bi instanceof Float32Array) || !(g.bw instanceof Float32Array) ||
          !(g.idx instanceof Uint32Array)) return false;
      var n = g.pos.length / 3;
      return n > 0 && n === Math.floor(n) && g.idx.length >= 3 &&
             g.nrm.length === n * 3 && g.bi.length === n * 4 && g.bw.length === n * 4;
    };
    var bound = function(g){                       /* the documented placeholder: slot 0, weight 1 */
      var n = g.pos.length / 3, bad = 0;
      for (var v = 0; v < n; v++) { if (g.bi[v*4] !== 0) bad++; if (g.bw[v*4] !== 1) bad++; }
      return bad;
    };
    out.notes.shape = 'bar:' + shape(G.bar) + ' seat:' + shape(G.seat) + ' back:' + shape(G.back);
    out.notes.boundPlaceholder = bound(G.bar) + bound(G.seat) + bound(G.back);

    var cv = document.createElement('canvas'); cv.width = W; cv.height = H; document.body.appendChild(cv);
    var ctx = R.makeCtx(cv, ch, geo);
    var cam = R.camera('persp', 1, 30, 10, 430);

    /* the seated rigs are keyed by measured clip names; a stub under that name gives the seat/back
       a real pose to be placed against without the measured clip file */
    S.CLIPS.legext = { name:'legext', duration:3.14, loop:true, desc:'renderer check stub',
                       keys:[{t:0,p:{}},{t:1.5,p:{}},{t:3.14,p:{}}] };

    var evQ = S.sample(ch, 'squat', 1.8), evL = S.sample(ch, 'legext', 1.8);
    var barProps  = P.frame(G, ch, S, evQ, 'squat', S.sample);
    var seatProps = P.frame(G, ch, S, evL, 'legext', S.sample);
    var twistProps= P.frame(G, ch, S, S.sample(ch, 'twist', 1.8), 'twist', S.sample);
    out.notes.frames = 'squat:' + barProps.length + ' legext:' + seatProps.length + ' twist:' + twistProps.length;
    out.notes.matrixLen = barProps[0].matrix.length;
    out.notes.matrixAffineRow = [barProps[0].matrix[3], barProps[0].matrix[7], barProps[0].matrix[11], barProps[0].matrix[15]].join(',');
    var m = barProps[0].matrix;
    var colLen = function(o){ return +Math.hypot(m[o], m[o+1], m[o+2]).toFixed(6); };
    out.notes.matrixColumnLens = [colLen(0), colLen(4), colLen(8)].join(',');   /* 1,1,1 => no scale */
    out.notes.joints = geo.joints;
    out.notes.spareSlots = ctx.nb - geo.joints;

    var shots = {};
    var snapOf = function(canvas, label){
      var t = document.createElement('canvas'); t.width = W; t.height = H;
      var g = t.getContext('2d'); g.drawImage(canvas, 0, 0);
      shots[label] = g.getImageData(0, 0, W, H).data;
    };
    var snap = function(label){ snapOf(cv, label); };
    var diff = function(a, b){
      var A = shots[a], B = shots[b], n = 0, max = 0, sum = 0;
      var minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
      for (var i = 0; i < A.length; i += 4) {
        var d = Math.max(Math.abs(A[i]-B[i]), Math.abs(A[i+1]-B[i+1]), Math.abs(A[i+2]-B[i+2]));
        if (d > 0) {
          var p = i / 4, x = p % W, y = (p / W) | 0;
          n++; sum += d; if (d > max) max = d;
          if (x < minx) minx = x; if (x > maxx) maxx = x;
          if (y < miny) miny = y; if (y > maxy) maxy = y;
        }
      }
      return { n:n, max:max, mean: n ? +(sum/n).toFixed(2) : 0, bbox: n ? [minx,miny,maxx,maxy] : null };
    };
    /* the same projection the shader performs, from the same matrices, for a full-canvas draw */
    var project = function(p3){
      var M = S.m4Mul(cam.proj, cam.view);
      var x = M[0]*p3[0]+M[4]*p3[1]+M[8]*p3[2]+M[12];
      var y = M[1]*p3[0]+M[5]*p3[1]+M[9]*p3[2]+M[13];
      var w = M[3]*p3[0]+M[7]*p3[1]+M[11]*p3[2]+M[15];
      if (!w) return null;
      return [ +((x/w + 1)/2*W).toFixed(1), +((1 - y/w)/2*H).toFixed(1) ];
    };
    var mid = function(a, b){ return [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2]; };

    /* ---- the draws that matter ---- */
    /* Buffer cache first, while nothing else has allocated yet: the wrap counts what the renderer
       really asks GL for, so "cached, not per frame" is measured rather than asserted. */
    var created = 0, realCreate = WebGL2RenderingContext.prototype.createBuffer;
    WebGL2RenderingContext.prototype.createBuffer = function(){ created++; return realCreate.apply(this, arguments); };
    R.draw(ctx, evQ, cam, { skeleton:false, props: barProps });
    out.notes.buffersFirstPropDraw = created;
    for (var rep = 0; rep < 4; rep++) R.draw(ctx, evQ, cam, { skeleton:false, props: barProps });
    out.notes.buffersFourMoreDraws = created - out.notes.buffersFirstPropDraw;
    WebGL2RenderingContext.prototype.createBuffer = realCreate;

    R.draw(ctx, evQ, cam, {});                                            snap('none');
    R.draw(ctx, evQ, cam, { skeleton:false, props: barProps });           snap('bar');
    R.draw(ctx, evQ, cam, { skeleton:false,
      props: [{ geo: G.bar, matrix: (function(){ var s = barProps[0].matrix.slice(); s[13] += 50; return s; })() }] });
                                                                         snap('barShifted');
    R.draw(ctx, evL, cam, { skeleton:false, props: seatProps });          snap('seat');
    R.draw(ctx, evQ, cam, { skeleton:false, props: barProps.concat(seatProps) });   snap('both');
    R.draw(ctx, evQ, cam, {});                                            snap('noneAgain');
    R.drawCell(ctx, 0, 0, W, evQ, cam, { skeleton:false });                        snap('cellNone');
    R.drawCell(ctx, 0, 0, W, evQ, cam, { skeleton:false, props: barProps });       snap('cellBar');

    /* over-capacity: 5 bars, only 3 spare slots — the ones that fit, nothing written past the array */
    R.draw(ctx, evQ, cam, { skeleton:false,
      props: [barProps[0], barProps[0], barProps[0], barProps[0], barProps[0]] }); snap('five');
    out.notes.droppedAfterFive = ctx.propsDropped || 0;

    /* malformed: null geo, a plain-Array geo (would throw inside bufferData if not rejected), a
       short matrix, a NaN matrix — each must be skipped, not thrown */
    var plain = { pos:[0,0,0, 1,0,0, 0,1,0], nrm:[0,0,1, 0,0,1, 0,0,1],
                  bi:[0,0,0,0, 0,0,0,0, 0,0,0,0], bw:[1,0,0,0, 1,0,0,0, 1,0,0,0], idx:[0,1,2] };
    var nan = new Array(16); for (var q = 0; q < 16; q++) nan[q] = NaN;
    var zero = new Array(16); for (var z = 0; z < 16; z++) zero[z] = 0;
    out.notes.badThrew = false;
    try {
      R.draw(ctx, evQ, cam, { skeleton:false, props: [
        { geo: null, matrix: null },
        { geo: plain, matrix: zero },
        { geo: G.bar, matrix: [1,2,3] },
        { geo: G.bar, matrix: nan }
      ] });
    } catch (e) { out.notes.badThrew = String((e && e.message) || e); }
    snap('bad');
    out.notes.droppedAfterBad = ctx.propsDropped || 0;
    out.notes.warns = window.__warn.slice(0, 3);

    /* A SECOND context on the same prop objects: in the app the sheet is closed and reopened with
       the same cached props, so the cache must not hand a new context the previous context's dead
       buffers. New buffers are expected here, and the picture must be identical to context one's. */
    var cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = H; document.body.appendChild(cv2);
    var created2 = 0;
    WebGL2RenderingContext.prototype.createBuffer = function(){ created2++; return realCreate.apply(this, arguments); };
    var ctx2 = R.makeCtx(cv2, ch, geo);
    var bodyOnly2 = created2;
    R.draw(ctx2, evQ, cam, { skeleton:false, props: barProps });
    out.notes.buffersSecondCtxProp = created2 - bodyOnly2;
    WebGL2RenderingContext.prototype.createBuffer = realCreate;
    snapOf(cv2, 'barCtx2');
    out.notes.secondCtxReusedFirst = barProps[0].geo.__buf.ctx === ctx;   /* the cache lives on the PROP's geo */

    out.diff.bar_vs_none         = diff('none', 'bar');
    out.diff.barShifted_vs_none  = diff('none', 'barShifted');
    out.diff.seat_vs_none        = diff('none', 'seat');
    out.diff.cellBar_vs_cellNone = diff('cellNone', 'cellBar');
    out.diff.five_vs_bar         = diff('bar', 'five');
    out.diff.bad_vs_none         = diff('none', 'bad');
    out.diff.noneAgain_vs_none   = diff('none', 'noneAgain');
    out.diff.ctx2_vs_ctx1        = diff('bar', 'barCtx2');
    out.notes.wristMid  = project(mid(evQ.fk.p.wrL, evQ.fk.p.wrR));
    out.notes.hipMid    = project(mid(evL.fk.p.hipL, evL.fk.p.hipR));
    out.notes.barMatrixAt  = project([barProps[0].matrix[12], barProps[0].matrix[13], barProps[0].matrix[14]]);
    out.notes.seatMatrixAt = project([seatProps[0].matrix[12], seatProps[0].matrix[13], seatProps[0].matrix[14]]);
    out.notes.bothBbox = diff('none', 'both').bbox;
    out.notes.bothChanged = diff('none', 'both').n;
    console.warn = ow;
  } catch (e) { out.ok = false; out.error = String((e && e.stack) || e); }
  return out;
})()`;

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--force-device-scale-factor=1', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + process.cwd() + '\\' + TMP + '\\p_s3d_props', 'about:blank'], { stdio: 'ignore' });

  let ws = null, id = 0;
  const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method: m, params: p || {} }));
  });
  const evaluate = async (expression, awaitPromise) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  let fails = 0;
  const check = (name, ok, detail) => {
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined ? '   ' + detail : ''));
    if (!ok) fails++;
  };
  const inside = (pt, box, pad) => !!pt && !!box &&
    pt[0] >= box[0] - pad && pt[0] <= box[2] + pad && pt[1] >= box[1] - pad && pt[1] <= box[3] + pad;

  try {
    for (let i = 0; i < 100; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
        const pg = list.find(t => t.type === 'page');
        if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; }
      } catch (e) { /* not up yet */ }
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
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });

    /* a light sheet mode: the page only has to load the core and the renderer */
    const url = 'file:///' + process.cwd().replace(/\\/g, '/') + '/' + PAGE + '?mode=filmstrip&clips=twist&frames=2&cell=40';
    await send('Page.navigate', { url });
    await sleep(2500);
    check('renderer reachable', await evaluate('typeof (window.S3D_RENDER||{}).draw === "function"'));

    const loaded = await evaluate(`new Promise(function(res){
      var s = document.createElement('script'); s.src = '_s3d_props.js';
      s.onload = function(){ res('loaded: ' + typeof window.S3D_PROPS); };
      s.onerror = function(){ res('script error'); };
      document.head.appendChild(s);
    })`, true);
    check('_s3d_props.js loads in the page', loaded === 'loaded: object', loaded);
    if (loaded !== 'loaded: object') throw new Error('props module did not load');

    const r = await evaluate(EXPERIMENT);
    if (!r || !r.ok) throw new Error('experiment failed: ' + JSON.stringify(r));
    console.log('  notes: ' + JSON.stringify(r.notes));
    Object.keys(r.diff).forEach(k => console.log('  diff ' + k.padEnd(22) + JSON.stringify(r.diff[k])));

    check('prop geo shape matches packGeometry',
      r.notes.shape === 'bar:true seat:true back:true', r.notes.shape);
    check('prop vertices carry the slot-0 / weight-1 placeholder', r.notes.boundPlaceholder === 0,
      'violations=' + r.notes.boundPlaceholder);
    check('frame() gives a bar for the barbell clip, seat+back for the seated clip, nothing for the rest',
      r.notes.frames === 'squat:1 legext:2 twist:0', r.notes.frames);
    check('matrix is a 16-entry translation-only, scale-free 4x4',
      r.notes.matrixLen === 16 && r.notes.matrixAffineRow === '0,0,0,1' && r.notes.matrixColumnLens === '1,1,1',
      'len=' + r.notes.matrixLen + ' row3=' + r.notes.matrixAffineRow + ' |col|=' + r.notes.matrixColumnLens);
    check('ctx has spare slots above the joints', r.notes.joints === 21 && r.notes.spareSlots === 3,
      'joints=' + r.notes.joints + ' spare=' + r.notes.spareSlots);

    const dBar = r.diff.bar_vs_none, dSeat = r.diff.seat_vs_none, dCell = r.diff.cellBar_vs_cellNone;
    check('BAR CHANGES THE IMAGE (draw)', dBar.n > 300 && dBar.max > 20,
      dBar.n + ' px changed, max delta ' + dBar.max + ', bbox ' + JSON.stringify(dBar.bbox));
    check('SEAT+BACK CHANGE THE IMAGE (draw)', dSeat.n > 300 && dSeat.max > 20,
      dSeat.n + ' px changed, max delta ' + dSeat.max + ', bbox ' + JSON.stringify(dSeat.bbox));
    check('BAR CHANGES THE IMAGE (drawCell)', dCell.n > 300 && dCell.max > 20,
      dCell.n + ' px changed, max delta ' + dCell.max);
    check('the bar sits at the grip (changed bbox covers the projected wrist midpoint)',
      inside(r.notes.wristMid, dBar.bbox, 12),
      'wrists=' + JSON.stringify(r.notes.wristMid) + ' bar bbox=' + JSON.stringify(dBar.bbox));
    check('the seat sits at the pelvis (changed bbox covers the projected hip midpoint)',
      inside(r.notes.hipMid, dSeat.bbox, 30),
      'hips=' + JSON.stringify(r.notes.hipMid) + ' seat bbox=' + JSON.stringify(dSeat.bbox));
    check('two props in one draw land at their OWN matrices, not a shared slot',
      inside(r.notes.barMatrixAt, r.notes.bothBbox, 12) && inside(r.notes.seatMatrixAt, r.notes.bothBbox, 12),
      'bar@' + JSON.stringify(r.notes.barMatrixAt) + ' seat@' + JSON.stringify(r.notes.seatMatrixAt) +
      ' combined bbox=' + JSON.stringify(r.notes.bothBbox) + ' (' + r.notes.bothChanged + ' px)');
    check('the prop follows its MATRIX, not the skeleton (translate the matrix, the prop moves)',
      r.diff.barShifted_vs_none.n > 300 && r.diff.barShifted_vs_none.bbox[1] < dBar.bbox[1] - 15,
      'bar top y=' + dBar.bbox[1] + ' -> shifted top y=' + r.diff.barShifted_vs_none.bbox[1] +
      ' (matrix translation +50 units in y)');

    check('props beyond the spare slots are dropped, nothing written past the array',
      r.diff.five_vs_bar.n === 0 && r.notes.droppedAfterFive === 2,
      '5 bars vs 1 bar: ' + r.diff.five_vs_bar.n + ' px differ; propsDropped=' + r.notes.droppedAfterFive);
    check('malformed props are skipped without throwing',
      r.notes.badThrew === false && r.diff.bad_vs_none.n === 0 && (r.notes.droppedAfterBad - r.notes.droppedAfterFive) === 4,
      'threw=' + r.notes.badThrew + ', image delta=' + r.diff.bad_vs_none.n + ' px, dropped in that draw=' +
      (r.notes.droppedAfterBad - r.notes.droppedAfterFive));
    check('the drops are reported (console.warn)', (r.notes.warns || []).length >= 1, JSON.stringify(r.notes.warns));
    check('prop matrices do not leak into the body (redraw with no props is identical)',
      r.diff.noneAgain_vs_none.n === 0, r.diff.noneAgain_vs_none.n + ' px differ');
    check('prop buffers are cached, not rebuilt every frame',
      r.notes.buffersFirstPropDraw === 5 && r.notes.buffersFourMoreDraws === 0,
      'first prop draw allocated ' + r.notes.buffersFirstPropDraw + ' buffers, four further draws allocated ' +
      r.notes.buffersFourMoreDraws);
    check('the cache is per context (a second ctx gets its own buffers and draws the same picture)',
      r.notes.buffersSecondCtxProp === 5 && r.diff.ctx2_vs_ctx1.n === 0 && r.notes.secondCtxReusedFirst === false,
      'second ctx allocated ' + r.notes.buffersSecondCtxProp + ' buffers, image delta vs ctx 1 = ' +
      r.diff.ctx2_vs_ctx1.n + ' px, cache still owned by ctx1 = ' + r.notes.secondCtxReusedFirst);

    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none');
    console.log(fails ? 'RESULT: ' + fails + ' check(s) FAILED' : 'RESULT: all prop checks passed');
    process.exitCode = fails ? 1 : 0;
  } catch (e) {
    console.log('FAILED: ' + e.message);
    process.exitCode = 1;
  } finally {
    try { chrome.kill(); } catch (e) {}
    await sleep(900);
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(TMP + '/p_s3d_props', { recursive: true, force: true }); break; } catch (e) { await sleep(400); }
    }
    process.exit(process.exitCode || 0);
  }
})();
