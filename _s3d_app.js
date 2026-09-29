/* _s3d_app.js — FORGE's in-app 3D technique view.
   Inlined into index.html by _build_app3d.cjs. Consumes:
     window.S3D          — _s3d_core.js, the rigged-character engine (shared with the node audit)
     window.S3D_RENDER   — _s3d_render.js, the WebGL2 renderer extracted from the viewer
     window.S3D_MEASURED — _s3d_clips_measured.js, the clips derived from measured reference angles

   WHY THIS EXISTS
   The 48 library demos are a 2D vector engine: one skeleton, one 200x200 viewBox, authored as limb
   targets. That engine is stylised and it is NOT measured. A separate body of work measured real
   licensed reference video by pose estimation and produced joint angles that drive a 3D rig. Those
   measured angles were only viewable on a published page outside the app. This module puts the same
   3D character inside the app, driven by the same measured numbers.

   WHAT IT DELIBERATELY DOES NOT DO
   It does not put 3D on every exercise. Only exercises whose movement was actually measured from
   licensed reference video get a 3D clip, because the entire value of this view is that the motion
   is measured. Filling the rest would mean inventing motion and presenting it as measurement, which
   is the failure this project spent its effort eliminating. `has3D()` is the single gate, and the
   app falls back to its own 2D demo everywhere else.

   IT PLUGS INTO THE EXISTING LOOP CONTRACT
   `startAnimLoop` in index.html advances `el.__t` (0..1 over CYCLE) on `el.__raf` and honours the
   global `demoPlay`. This module reuses ALL THREE, so `demoToggle()` and `demoStep()` drive the 3D
   view with no changes at all, and `stopDemo()` (called by `closeModal()`) cancels the frame loop on
   every close path. The clip is sampled at `el.__t * clip.duration`; because every measured clip is
   3.14 s with keys on the app's own tempo boundaries (1500/320/1000/320 ms), that fraction lands on
   the same phase the HUD is naming. If a clip's duration ever drifts off 3.14 the pose and the phase
   label would disagree, so `phaseAligned` reports it rather than hiding it.
*/
(function (root) {
  'use strict';

  var S3D = root.S3D, R = root.S3D_RENDER, M = root.S3D_MEASURED, PR = root.S3D_PROPS;
  if (!S3D || !R || !M || !PR) return;           /* the app degrades to its 2D demos */

  /* App exercise id -> measured clip name.
     Every entry here is a mapping that was checked by hand against the reference that was measured:
     a squat is a squat, an overhead press is an overhead press, a leg extension is a leg extension,
     and a machine chest press is a machine chest press. Deliberately absent: `machine-ohp`, which
     looks close to the measured barbell overhead press but is a different machine and a different
     movement path, and the CDC arm-extension and bicep-machine clips, whose elbow range is shared by
     several exercises (a pushdown and an overhead extension have the same elbow angle) so the angles
     cannot say which exercise they belong to. Guessing either would be a wrong-variant reference,
     which is worse than none because it looks authoritative. */
  var CLIP_FOR_EX = {
    'squat': 'squat',
    'ohp': 'press',
    'legext': 'legext',
    'machine-press': 'machinepress'
  };

  var TEMPO_CYCLE_MS = 3140;                     /* index.html CYCLE, the app's shared tempo */
  var PHASE_DUR_S = 3.14;                        /* that tempo expressed in seconds */

  var _ch = null, _geo = null, _props = null, _gl3 = null;
  function character() {
    if (!_ch) {
      _ch = S3D.buildCharacter();
      _geo = S3D.packGeometry(_ch);
      _props = PR.build(_ch);
    }
    return _ch;
  }
  /* Equipment for this instant. Wrapped because a prop is scenery: if it ever fails it must not take
     the measured figure down with it. */
  function propsFor(ev, clipName) {
    try { return PR.frame(_props, _ch, S3D, ev, clipName, S3D.sample); }
    catch (e) { return []; }
  }

  function clipFor(id) {
    var n = CLIP_FOR_EX[id];
    if (!n || !S3D.CLIPS[n]) return null;
    /* A registered clip is not enough, and this guard is load-bearing. _s3d_core.js ships SANDBOX
       clips of its own, one of which is ALSO called 'squat' (duration 3.6 s, no measured targets,
       authored as a solver demo). Without this check, if the measured squat clip ever failed to
       arrive the app would render that sandbox motion under the measured badge and a genuine-looking
       provenance line: invented movement presented as measured, which is worse than offering no 3D
       at all, because it looks authoritative. Only a clip that records its measured targets counts. */
    if (!M || !M.TARGETS || !M.TARGETS[n]) return null;
    return n;
  }
  function has3D(id) { return !!clipFor(id); }

  /* Can this device actually run it? Asked once and cached, because a failed webgl2 request is
     expensive and because the answer must be the same for every exercise in a session. */
  function capable() {
    if (_gl3 === null) {
      try {
        var c = document.createElement('canvas');
        _gl3 = !!(c.getContext('webgl2'));
      } catch (e) { _gl3 = false; }
    }
    return _gl3;
  }

  /* The provenance line. A measured view has to say what it was measured from, and for the CC-BY
     reference that is also the attribution the licence requires — so it is rendered on screen, not
     buried in a file. Read defensively: if a clip records no provenance we say so plainly rather
     than printing nothing, because silence would read as "no source needed". */
  function provenance(id) {
    var name = clipFor(id);
    if (!name) return '';
    var t = (M.TARGETS && M.TARGETS[name]) || null;
    if (!t) return 'Measured reference \u2014 source not recorded';
    var src = t.source || t.title || 'source not recorded';
    var lic = t.licence || '';
    return 'Measured from ' + src + (lic ? ' \u00b7 ' + lic : ' \u00b7 licence not recorded');
  }

  function phaseAligned(id) {
    var name = clipFor(id);
    var clip = name && S3D.CLIPS[name];
    return !!clip && Math.abs(clip.duration - PHASE_DUR_S) < 1e-6;
  }

  /* ---------------------------------------------------------------- the view */
  function destroy(el) {
    if (!el || !el.__s3d) return;
    var s = el.__s3d;
    if (el.__raf) { cancelAnimationFrame(el.__raf); el.__raf = 0; }
    /* Release the GL context explicitly. Browsers cap live WebGL contexts (Chrome allows ~16) and
       every open/close of a sheet would otherwise leak one until the oldest is silently dropped. */
    try {
      var lose = s.ctx && s.ctx.gl && s.ctx.gl.getExtension('webgl_lose_context');
      if (lose) lose.loseContext();
    } catch (e) {}
    el.__s3d = null;
    el.innerHTML = '';
  }

  function start(el, id, env) {
    if (!el || !has3D(id) || !capable()) return false;
    destroy(el);
    /* The app's play flag (`demoPlay`) is a local in index.html's script scope, not a window global.
       Rather than reach for it by a scoping trick, the app passes it in — which keeps this module
       loadable and testable on its own, and makes the dependency explicit at the call site. */
    env = env || {};
    var isPlaying = env.playing || function () { return true; };
    var prefersStill = env.reduced || function () {
      try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
      catch (e) { return false; }
    };
    /* The phase label and progress bar live in the app's shared HUD. The 2D loop updates them from
       its own frame; if this loop did not, the HUD would freeze on whatever the last 2D frame left
       there while the 3D body kept moving — the screen would confidently name the wrong phase. The
       app passes its own updater in, so `stageAt()` stays the single source of phase truth. */
    var onFrame = env.onFrame || function () {};

    var clipName = clipFor(id), clip = S3D.CLIPS[clipName], ch = character();
    /* `.animstage` carries 6px of padding per side and `clientWidth` INCLUDES padding, so the content
       box is 12px narrower. Sizing straight from clientWidth overflows the card by 12px. */
    var size = Math.max(180, Math.min(340, (el.clientWidth || 300) - 12));
    var dpr = Math.min(2, root.devicePixelRatio || 1);

    var canvas = document.createElement('canvas');
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = '100%';
    /* height:auto is load-bearing. The stylesheet only sets `height:auto` for `.animstage svg`, and a
       canvas is not an svg — without it the canvas lays out at its ATTRIBUTE height (size*dpr, so
       ~680px at dpr 2) while being stretched to 100% wide, giving a squashed figure in a tall box. */
    canvas.style.height = 'auto';
    canvas.style.aspectRatio = '1 / 1';
    canvas.style.display = 'block';
    canvas.style.borderRadius = '12px';
    canvas.style.touchAction = 'none';            /* so a drag orbits instead of scrolling the sheet */
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Three-dimensional technique demonstration, measured from reference video');
    el.appendChild(canvas);

    var ctx;
    try { ctx = R.makeCtx(canvas, ch, _geo); }
    catch (e) { destroy(el); el.innerHTML = ''; return false; }   /* shader/context failure: 2D demo wins */

    var st = el.__s3d = {
      ctx: ctx, canvas: canvas, clip: clipName,
      yaw: 30, pitch: 8, dist: 430, drag: null,
      pinching: 0, pinched: 0
    };

    /* Orbit / zoom. Pointer events cover mouse, pen and touch in one path, which matters because
       this sheet is read at 360-430 px on a phone. */
    canvas.addEventListener('pointerdown', function (e) {
      st.drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!st.drag) return;
      st.yaw += (e.clientX - st.drag.x) * 0.5;
      st.pitch = Math.max(-70, Math.min(80, st.pitch + (e.clientY - st.drag.y) * 0.3));
      st.drag = { x: e.clientX, y: e.clientY };
    });
    var release = function () { st.drag = null; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      st.dist = Math.max(160, Math.min(1000, st.dist + e.deltaY * 0.5));
    }, { passive: false });

    el.__id = id;
    el.__t = 0;
    var t0 = null, last = null;

    var frame = function (ts) {
      if (t0 === null) { t0 = ts; last = ts; }
      if (isPlaying()) {
        /* Same arithmetic as startAnimLoop, so `demoStep` and the progress bar stay in step. */
        el.__t = (((ts - t0) % TEMPO_CYCLE_MS) + TEMPO_CYCLE_MS) % TEMPO_CYCLE_MS / TEMPO_CYCLE_MS;
      } else {
        t0 = ts - (el.__t || 0) * TEMPO_CYCLE_MS;
      }
      last = ts;
      var ev = S3D.sample(ch, clipName, el.__t * clip.duration);
      R.draw(ctx, ev, R.camera('persp', canvas.width / canvas.height, st.yaw, st.pitch, st.dist),
             { skeleton: !!st.skeleton, props: propsFor(ev, clipName) });
      try { onFrame(el.__t); } catch (e) {}
      el.__raf = requestAnimationFrame(frame);
    };

    try {
      var ev0 = S3D.sample(ch, clipName, 0);
      R.draw(ctx, ev0, R.camera('persp', canvas.width / canvas.height, st.yaw, st.pitch, st.dist),
             { props: propsFor(ev0, clipName) });
    } catch (e) { destroy(el); return false; }

    if (prefersStill()) {
      /* Respect the preference: draw the two extremes side by side as one still instead of
         animating, exactly as the 2D engine does with renderStill(). */
      try {
        var a = S3D.sample(ch, clipName, 0), b = S3D.sample(ch, clipName, clip.duration * 0.5);
        R.drawCell(ctx, 0, 0, canvas.width, a, R.camera('persp', 1, st.yaw, st.pitch, st.dist),
                   { props: propsFor(a, clipName) });
        R.drawCell(ctx, canvas.width / 2, 0, canvas.width / 2, b,
                   R.camera('persp', 1, st.yaw, st.pitch, st.dist),
                   { props: propsFor(b, clipName) });
      } catch (e) {}
      el.__raf = requestAnimationFrame(frame);      /* still orbitable, just not advancing */
      return true;
    }
    el.__raf = requestAnimationFrame(frame);
    return true;
  }

  root.S3D_APP = {
    has3D: has3D,
    capable: capable,
    clipFor: clipFor,
    provenance: provenance,
    phaseAligned: phaseAligned,
    start: start,
    destroy: destroy,
    /* Exposed so the audit and the browser probes can ask what the app believes without
       re-deriving the mapping. */
    mapping: function () {
      var out = {};
      Object.keys(CLIP_FOR_EX).forEach(function (k) { out[k] = CLIP_FOR_EX[k]; });
      return out;
    }
  };
})(typeof window !== 'undefined' ? window : this);
