/* _s3d_render.js — S3D renderer: the WebGL2 concern, extracted from _s3d_view.html.
   FORGE 3D sandbox. Runs unchanged in the browser (window.S3D_RENDER) and loads in node
   (module.exports) so the module can be required by a script without a DOM. Only the
   RENDERER lives here — the rig, the clips, the IK and the geometry stay in _s3d_core.js,
   which this file never modifies and never re-derives.

   Why the split exists: the viewer page had the GLSL sources, the program builder, the
   context builder, the camera and the draw path tangled into page-level state, so a second
   consumer of the same renderer meant a copy of it and the copies would drift. Nothing in
   here closes over a page global. What `drawCell`/`draw` need beyond the GL state is stashed
   on the ctx object that `makeCtx` returns: the character (`ch`, for the skeleton overlay's
   joint tree), the packed geometry (`geo`, for the index count) and the bone-array size
   (`nb`, which the shader source itself depends on).

   Two entry points, one code path:
     drawCell(ctx, vx, vy, cell, ev, cam, opts) — one SCISSORED cell, inset by 3 px. Insetting
       matters: a multi-cell sheet draws each frame into its own cell, and the scissor is what
       stops a later cell from clearing an earlier one. A second cell may be drawn beside the
       first in the same canvas, so the inset is also the seam.
     draw(ctx, ev, cam, opts) — the same scene over the whole canvas, no scissor, no padding.
       This is what a single-canvas viewer wants; it is NOT pixel-equal to
       drawCell(ctx,0,0,w,ev,cam,opts), because the padded cell renders through a viewport of
       (w-6)x(h-6) and is therefore 6 px smaller and inset.

   opts.props (optional) adds EQUIPMENT — a barbell, a seat, a back pad — as [{geo, matrix}] from
   _s3d_props.js. Both entry points accept it; it is drawn with the body's own program into spare
   bone slots. See the equipment section below.

   GL calls cannot run in node; loading this file there must not throw, so nothing at module
   top level touches a canvas. `core()` resolves S3D lazily for the same reason.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.S3D_RENDER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

var TARGET = [0, 78, 0];

/* ------------------------------------------------------------------ core */
/* Resolved on first use, not at load: this file must be requireable in node (no DOM, and the
   core may not be in the module cache), and in a browser whose script order puts the renderer
   before the core it must not throw at parse time either. */
var _core = null;
function core() {
  if (_core) return _core;
  var g = typeof globalThis !== 'undefined' ? globalThis : null;
  if (g && g.S3D) return (_core = g.S3D);
  if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
    try { return (_core = require('./_s3d_core.js')); } catch (e) { /* not resolvable here */ }
  }
  throw new Error('S3D_RENDER: _s3d_core.js is not loaded');
}

/* ------------------------------------------------------------------ shaders */
/* VERT is a function of the bone-array size because the array declaration is part of the
   source: the page used to interpolate its page-level NB into this string. Same string for
   the same count — uBones[NB], NB = max(24, joint count). */
function VERT(nb) {
  return `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec4 aBone; in vec4 aWgt;
uniform mat4 uBones[${nb}]; uniform mat4 uProj; uniform mat4 uView;
out vec3 vNrm; out vec3 vPos;
void main(){
  mat4 sk = aWgt.x*uBones[int(aBone.x)] + aWgt.y*uBones[int(aBone.y)]
          + aWgt.z*uBones[int(aBone.z)] + aWgt.w*uBones[int(aBone.w)];
  vec4 wp = sk*vec4(aPos,1.0);
  vNrm = mat3(sk)*aNrm; vPos = wp.xyz;
  gl_Position = uProj*uView*wp;
}`;
}
var FRAG = `#version 300 es
precision highp float;
in vec3 vNrm; in vec3 vPos;
uniform vec3 uEye, uBase, uAccent;
out vec4 o;
void main(){
  vec3 N = normalize(vNrm);
  if(!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vPos);
  vec3 L1 = normalize(vec3(-0.42,0.86,0.50));
  vec3 L2 = normalize(vec3( 0.66,0.20,0.42));
  float d1 = max(dot(N,L1),0.0), d2 = max(dot(N,L2),0.0);
  float rim = pow(1.0 - max(dot(N,V),0.0), 2.6);
  o = vec4(uBase*(0.22 + 0.72*d1 + 0.34*d2) + uAccent*rim*0.30, 1.0);
}`;
var LVERT = `#version 300 es
in vec3 aPos; uniform mat4 uProj, uView;
void main(){ gl_Position = uProj*uView*vec4(aPos,1.0); }`;
var LFRAG = `#version 300 es
precision highp float; uniform vec3 uColor; uniform float uAlpha; out vec4 o;
void main(){ o = vec4(uColor, uAlpha); }`;

function sh(gl, type, src){
  var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function prog(gl, vs, fs){
  var p = gl.createProgram();
  gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

/* ------------------------------------------------------------------ context */
/* ch and GEO are arguments, not page globals. Everything drawCell/draw read off the ctx is
   stashed here, so a ctx is self-contained and two ctxs can coexist. */
function makeCtx(canvas, ch, GEO){
  if(!canvas || typeof canvas.getContext !== 'function')
    throw new Error('S3D_RENDER.makeCtx(canvas, ch, geo): needs a canvas (there is no DOM in node)');
  var gl = canvas.getContext('webgl2', {antialias:true, alpha:false, preserveDrawingBuffer:true});
  if(!gl) throw new Error('no webgl2');
  var NB = Math.max(24, ch.sk.order.length);
  var P = prog(gl, VERT(NB), FRAG), L = prog(gl, LVERT, LFRAG);
  var A = { pos: gl.getAttribLocation(P,'aPos'), nrm: gl.getAttribLocation(P,'aNrm'),
            bone: gl.getAttribLocation(P,'aBone'), wgt: gl.getAttribLocation(P,'aWgt') };
  var U = { bones: gl.getUniformLocation(P,'uBones'), proj: gl.getUniformLocation(P,'uProj'),
            view: gl.getUniformLocation(P,'uView'), eye: gl.getUniformLocation(P,'uEye'),
            base: gl.getUniformLocation(P,'uBase'), accent: gl.getUniformLocation(P,'uAccent') };
  var LU = { proj: gl.getUniformLocation(L,'uProj'), view: gl.getUniformLocation(L,'uView'),
             color: gl.getUniformLocation(L,'uColor'), alpha: gl.getUniformLocation(L,'uAlpha') };
  var LA = gl.getAttribLocation(L,'aPos');

  function buf(target, data){ var b = gl.createBuffer(); gl.bindBuffer(target,b); gl.bufferData(target,data,gl.STATIC_DRAW); return b; }
  var vPos = buf(gl.ARRAY_BUFFER, GEO.pos), vNrm = buf(gl.ARRAY_BUFFER, GEO.nrm);
  var vBi = buf(gl.ARRAY_BUFFER, GEO.bi), vBw = buf(gl.ARRAY_BUFFER, GEO.bw);
  var iBuf = buf(gl.ELEMENT_ARRAY_BUFFER, GEO.idx);
  // grid + skeleton line buffers
  var grid = [], sg = 22, ext = 110;
  for(var i=-ext;i<=ext;i+=sg){
    grid.push(i,0,-ext, i,0,ext, -ext,0,i, ext,0,i);
  }
  var lGrid = buf(gl.ARRAY_BUFFER, new Float32Array(grid));
  var lDyn = gl.createBuffer();
  return { gl:gl, P:P, L:L, A:A, U:U, LU:LU, LA:LA, vPos:vPos, vNrm:vNrm, vBi:vBi, vBw:vBw, iBuf:iBuf,
           lGrid:lGrid, lDyn:lDyn, gridCount: grid.length/3, boneMats: new Float32Array(NB*16),
           nb:NB, ch:ch, geo:GEO, canvas:canvas };
}

/* ------------------------------------------------------------------ camera */
function camera(view, aspect, yaw, pitch, dist){
  var S3D = core();
  yaw = yaw||0; pitch = (pitch===undefined?10:pitch); dist = dist||335;
  if(view==='front')  return { proj:S3D.m4Ortho(80*aspect,80,-800,800), view:S3D.m4LookAt([0,78,500],[0,78,0],[0,1,0]), eye:[0,78,500] };
  if(view==='side')   return { proj:S3D.m4Ortho(80*aspect,80,-800,800), view:S3D.m4LookAt([500,78,0],[0,78,0],[0,1,0]), eye:[500,78,0] };
  if(view==='top')    return { proj:S3D.m4Ortho(80*aspect,80,-800,800), view:S3D.m4LookAt([0,520,0],[0,78,0],[0,0,-1]), eye:[0,520,0] };
  var yr = yaw*Math.PI/180, pr = pitch*Math.PI/180;
  var eye = [TARGET[0]+dist*Math.cos(pr)*Math.sin(yr), TARGET[1]+dist*Math.sin(pr), TARGET[2]+dist*Math.cos(pr)*Math.cos(yr)];
  return { proj:S3D.m4Persp(30,aspect,1,3000), view:S3D.m4LookAt(eye,TARGET,[0,1,0]), eye:eye };
}

/* ------------------------------------------------------------------ equipment */
/* Props — a barbell, a seat, a back pad — arrive in opts.props as [{geo, matrix}] from
   _s3d_props.js. They ride the BODY's program and the body's uniform array instead of getting a
   program of their own: `geo` is packed exactly like the body's geometry, so all a prop needs is a
   matrix, and uBones already has a place to put one.

   THE SLOT RULE. The body's skin data occupies slots 0..joints-1, so prop i takes the i-th spare
   slot above them: `joints + i` (21, 22, 23 on the default 21-joint rig, whose ctx.nb is
   max(24, joints) = 24). Its matrix is written into ctx.boneMats at that slot after the body's skin
   copy and before the single uBones upload, so the body's own matrices are never overwritten and
   one upload serves the figure and every prop.
   _s3d_props.js authors every prop vertex on slot 0 as a placeholder. Left alone that would skin
   the seat to the HIPS and drag it around with the body instead of its own matrix, so the prop's
   vertex buffer is built with that index pointed at the prop's own slot. Weight 1 on one matrix is
   also what keeps a prop rigid — a bar that cannot stretch to follow the hands. The matrix is in
   fk()'s convention: column-major, translation in 12/13/14, rotation and translation only, never
   scale, which is what keeps the normals correct.

   THE BOUND IS GUARDED. More props than spare slots means the ones that fit are drawn and the rest
   are skipped and counted (ctx.propsDropped, warned once), because writing past the end of boneMats
   would corrupt the BODY's matrices — a missing seat is a far smaller failure than a broken figure.
   A prop with a missing or malformed geo/matrix is skipped the same way and never thrown: equipment
   is scenery, and it must never take the figure down. */
function jointCount(ctx){
  /* packGeometry records this, and makeCtx sized ctx.nb from the same number. A geo without the
     field falls back to the skeleton rather than to NaN — NaN would land on slot 0 and overwrite
     the body's hips matrix. */
  var j = ctx.geo && ctx.geo.joints;
  return (typeof j === 'number' && j >= 0 && j === Math.floor(j)) ? j : ctx.ch.sk.order.length;
}

/* Shape check, not a try/catch: a plain Array where a Float32Array is required would throw inside
   bufferData and lose the whole frame, so it is rejected here as malformed instead. */
function propUsable(geo, matrix){
  if(!geo || !matrix) return false;
  if(!(Array.isArray(matrix) || ArrayBuffer.isView(matrix)) || matrix.length !== 16) return false;
  for(var k = 0; k < 16; k++) if(!isFinite(matrix[k])) return false;
  if(!(ArrayBuffer.isView(geo.pos) && ArrayBuffer.isView(geo.nrm) &&
       ArrayBuffer.isView(geo.bi) && ArrayBuffer.isView(geo.bw) && ArrayBuffer.isView(geo.idx))) return false;
  var n = geo.pos.length / 3;
  if(!(n > 0) || n !== Math.floor(n)) return false;
  if(geo.nrm.length !== geo.pos.length || geo.bi.length !== n * 4 || geo.bw.length !== n * 4) return false;
  return geo.idx.length >= 3;
}

/* Per-prop GL buffers, built on first use and cached on the geo, so a viewer that redraws every
   frame (or switches clip mid-set) does not mint a buffer set per frame. The cache is keyed by the
   context AND the slot: buffers belong to one context, and a prop re-drawn in an older context's
   slot must not be handed a dead buffer. */
function propBuffers(ctx, geo, slot){
  var c = geo.__buf;
  if(c && c.ctx === ctx && c.slot === slot) return c;
  var gl = ctx.gl, n = geo.pos.length / 3;
  function buf(target, data){
    var b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b;
  }
  var bi = new Float32Array(n * 4);
  bi.set(geo.bi.subarray(0, Math.min(geo.bi.length, n * 4)));
  for(var v = 0; v < n; v++) bi[v * 4] = slot;      /* the placeholder influence, pointed at this prop */
  c = { ctx: ctx, slot: slot, vPos: buf(gl.ARRAY_BUFFER, geo.pos), vNrm: buf(gl.ARRAY_BUFFER, geo.nrm),
        vBi: buf(gl.ARRAY_BUFFER, bi), vBw: buf(gl.ARRAY_BUFFER, geo.bw),
        iBuf: buf(gl.ELEMENT_ARRAY_BUFFER, geo.idx), count: geo.idx.length };
  geo.__buf = c;
  return c;
}

function reportProps(ctx, bad, over){
  if(!bad && !over) return;
  ctx.propsDropped = (ctx.propsDropped || 0) + bad + over;
  if(ctx.__propsWarned) return;                     /* once per context, not once per frame */
  ctx.__propsWarned = true;
  var why = [];
  if(over) why.push(over + ' prop(s) had no spare bone slot (' +
    (ctx.nb - jointCount(ctx)) + ' spare above the body\'s ' + jointCount(ctx) + ' joints)');
  if(bad) why.push(bad + ' prop(s) had a missing or malformed geo/matrix');
  if(typeof console !== 'undefined' && console.warn) console.warn('S3D_RENDER: not drawn — ' + why.join('; '));
}

/* Validate, assign slots and upload-plan the props. Called after the body's skin copy and before
   the body's uBones upload, because the matrices must be in the array before it is sent. */
function collectProps(ctx, opts){
  var props = opts.props;
  if(!props || !props.length) return null;
  var base = jointCount(ctx), spare = ctx.nb - base, out = [], bad = 0, over = 0;
  for(var i = 0; i < props.length; i++){
    var p = props[i];
    if(!propUsable(p && p.geo, p && p.matrix)){ bad++; continue; }
    if(out.length >= spare){ over++; continue; }
    var slot = base + out.length;
    ctx.boneMats.set(p.matrix, slot * 16);
    var buf;
    try { buf = propBuffers(ctx, p.geo, slot); }
    catch(e){ bad++; continue; }                    /* one prop's GL refusal must not cost the frame */
    out.push({ buf: buf, slot: slot });
  }
  reportProps(ctx, bad, over);
  return out.length ? out : null;
}

/* ------------------------------------------------------------------ draw */
/* The one GL sequence both entry points run. The caller has already set the scissor (or not)
   and the viewport; this does everything after that, in the order it has always been in. */
function paintScene(ctx, ev, cam, opts){
  var gl = ctx.gl;
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);

  ctx.boneMats.set(ev.skin.subarray(0, Math.min(ev.skin.length, ctx.nb*16)));
  /* Equipment matrices go into their spare slots HERE: after the body's skin copy, so they are not
     overwritten, and before the uBones upload below, which then carries the body and every prop
     in one pass. */
  var props = collectProps(ctx, opts);

  // floor grid
  gl.useProgram(ctx.L);
  gl.uniformMatrix4fv(ctx.LU.proj,false,new Float32Array(cam.proj));
  gl.uniformMatrix4fv(ctx.LU.view,false,new Float32Array(cam.view));
  gl.uniform3f(ctx.LU.color,0.13,0.15,0.19); gl.uniform1f(ctx.LU.alpha,1);
  gl.bindBuffer(gl.ARRAY_BUFFER, ctx.lGrid);
  gl.enableVertexAttribArray(ctx.LA); gl.vertexAttribPointer(ctx.LA,3,gl.FLOAT,false,0,0);
  gl.drawArrays(gl.LINES,0,ctx.gridCount);

  // figure
  gl.useProgram(ctx.P);
  gl.uniformMatrix4fv(ctx.U.proj,false,new Float32Array(cam.proj));
  gl.uniformMatrix4fv(ctx.U.view,false,new Float32Array(cam.view));
  gl.uniform3fv(ctx.U.eye,new Float32Array(cam.eye));
  gl.uniform3f(ctx.U.base,0.90,0.92,0.94);
  gl.uniform3f(ctx.U.accent,0.796,0.953,0.227);
  gl.uniformMatrix4fv(ctx.U.bones,false,ctx.boneMats);
  gl.bindBuffer(gl.ARRAY_BUFFER, ctx.vPos); gl.enableVertexAttribArray(ctx.A.pos); gl.vertexAttribPointer(ctx.A.pos,3,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER, ctx.vNrm); gl.enableVertexAttribArray(ctx.A.nrm); gl.vertexAttribPointer(ctx.A.nrm,3,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER, ctx.vBi); gl.enableVertexAttribArray(ctx.A.bone); gl.vertexAttribPointer(ctx.A.bone,4,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER, ctx.vBw); gl.enableVertexAttribArray(ctx.A.wgt); gl.vertexAttribPointer(ctx.A.wgt,4,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ctx.iBuf);
  gl.drawElements(gl.TRIANGLES, ctx.geo.idx.length, gl.UNSIGNED_INT, 0);

  // equipment: the same program and the same (already uploaded) uBones, drawn after the body so
  // depth testing composites the bar and the seat against the figure instead of over it
  if(props){
    for(var pi = 0; pi < props.length; pi++){
      var pb = props[pi].buf;
      gl.bindBuffer(gl.ARRAY_BUFFER, pb.vPos); gl.enableVertexAttribArray(ctx.A.pos); gl.vertexAttribPointer(ctx.A.pos,3,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, pb.vNrm); gl.enableVertexAttribArray(ctx.A.nrm); gl.vertexAttribPointer(ctx.A.nrm,3,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, pb.vBi); gl.enableVertexAttribArray(ctx.A.bone); gl.vertexAttribPointer(ctx.A.bone,4,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, pb.vBw); gl.enableVertexAttribArray(ctx.A.wgt); gl.vertexAttribPointer(ctx.A.wgt,4,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pb.iBuf);
      gl.drawElements(gl.TRIANGLES, pb.count, gl.UNSIGNED_INT, 0);
    }
  }

  // skeleton overlay: straight from the evaluated joint positions
  if(opts.skeleton){
    var segs = [], sk = ctx.ch.sk;
    sk.boneNames.forEach(function(j){
      var a = ev.fk.p[sk.parent[j]], b = ev.fk.p[j];
      segs.push(a[0],a[1],a[2], b[0],b[1],b[2]);
    });
    gl.useProgram(ctx.L);
    gl.uniform3f(ctx.LU.color,0.796,0.953,0.227); gl.uniform1f(ctx.LU.alpha,0.95);
    gl.bindBuffer(gl.ARRAY_BUFFER, ctx.lDyn);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(segs), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(ctx.LA); gl.vertexAttribPointer(ctx.LA,3,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.LINES,0,segs.length/3);
  }
}

/* One cell of a sheet: scissored, and inset by 3 px so neighbouring cells do not touch. */
function drawCell(ctx, vx, vy, cell, ev, cam, opts){
  var gl = ctx.gl;
  var pad = 3;
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(vx+pad, vy+pad, cell-2*pad, cell-2*pad);
  gl.clearColor(0.051,0.059,0.075,1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.viewport(vx+pad, vy+pad, cell-2*pad, cell-2*pad);
  paintScene(ctx, ev, cam, opts);
  gl.disable(gl.SCISSOR_TEST);
}

/* The whole canvas, no scissor and no padding. */
function draw(ctx, ev, cam, opts){
  var gl = ctx.gl, cv = ctx.canvas;
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0.051,0.059,0.075,1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.viewport(0,0,cv.width,cv.height);
  paintScene(ctx, ev, cam, opts);
}

return {
  VERT: VERT, FRAG: FRAG, LVERT: LVERT, LFRAG: LFRAG,
  sh: sh, prog: prog, core: core,
  TARGET: TARGET, makeCtx: makeCtx, camera: camera, drawCell: drawCell, draw: draw
};
});
