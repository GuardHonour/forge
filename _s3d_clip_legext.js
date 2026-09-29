/* _s3d_clip_legext.js — SEATED LEG EXTENSION (machine). One measured clip for FORGE's 3D view.

   MEASURED — the numbers this clip exists to reproduce, verbatim as given (see TARGETS below):
     knee interior angle, seated/flexed position ....... 108.7 deg
     knee interior angle, full extension ............... 162.8 deg
   Source: 'CDC exercise video' — public domain, US Government work.

   What is MEASURED is the knee angle at the two extremes. Everything else here is AUTHORED
   staging, and no claim is made about any of it:
     - the seated pelvis height: the pelvis JOINT at 40 rig units (~59 cm above the floor, which
       puts the derived seat surface at ~53 cm — a plausible machine seat), with the thigh
       exactly HORIZONTAL. Horizontal is the seated-machine convention and it is what the other
       seated measured clip (_s3d_clip_machinepress.js) uses at a pelvis of 39.3, so the app's
       two seated clips sit at the same height over the shared floor grid. Checked, not assumed:
       at this height the flexed foot's lowest point (the toe capsule) is ~2.3 rig units (3.4 cm) clear of the
       floor. Lower would sink it through the floor; higher would be a stool, not a machine.
     - the thigh's 1-unit outward splay (it matches the rig's own rest splay, hip x 6.5 ->
       knee x 7.5);
     - the slight backward lean of the torso (8 deg) and the head angle;
     - the arm pose: the arm is brought in from the rig's 42 deg A-pose to ~12 deg of abduction
       and the elbow flexed ~22 deg, so the hands hang beside the seat where a leg-extension
       machine's handles are. Nothing in the reference constrains the arms.
     - the foot's attitude uses the engine's own `level: 'toeL/R'`, which keeps the foot pointing
       the way it points at rest. There is no floor contact and no foot target to solve to: the
       machine's ankle pad holds the lower leg, and the foot is free.

   ONE VISUAL CONSEQUENCE OF THE MEASUREMENT, STATED RATHER THAN HIDDEN
     The reference's extension angle is 162.8 deg, which is 17.2 deg short of straight. With a
     horizontal thigh that puts the extended shin 17.2 deg BELOW horizontal, and the shin's arc
     runs from 18.7 deg forward of vertical (flexed) to that. A leg extension reaching a true
     180 deg would look flatter at the top; reproducing 162.8 deg is the point of this clip, so
     the 17.2 deg droop at the top is the measured number showing through, not an authoring
     error. (At the other extreme the same number puts the flexed shin 18.7 deg forward of
     vertical, which is exactly how the bottom of a leg extension looks.)

   WHY THE PELVIS CANNOT MOVE
     `root` is identical on every key and the `hips` joint is never rotated, so the pelvis is
     EXACTLY fixed in space for the whole rep — which is what a seated machine movement does:
     the seat and back pad hold it, and only the shin swings.

   WHY THE MEASURED ANGLES ARE HIT EXACTLY RATHER THAN APPROXIMATED
     The hip is fixed, so the movement is authored the way the movement actually works: the knee
     stays put and the shin swings about it. For a target interior knee angle `theta`:
         delta   = 180 - theta                 (the shin's departure from the thigh's own line)
         shinDir = rotX(thighDir, delta)
         ankle   = knee + L2 * shinDir
     Two-bone IK then puts the knee at exactly L1 from the hip and L2 from that ankle, so the
     interior angle at the knee is `theta` by the law of cosines. The pole point is solved from
     the same triangle — it is the perpendicular offset of the authored knee from the hip->ankle
     line — so the knee bends FORWARD (the only way a knee bends) and the pole is never guessed
     from a picture. Both keys' poles are consistent under the engine's linear pole
     interpolation, so the interpolation between them keeps the knee on the correct side too.

   TEMPO: keys sit on the app's own 1500/320/1000/320 ms boundaries (see _CLIP_BRIEF.md).
     home = knee EXTENDED (162.8 deg) — the quadriceps is SHORTEST there, and home is always the
     shortened-muscle position — so phase 1 (0 -> 1.5 s) is the controlled LOWERING of the shin
     from extension into flexion: the leg-extension eccentric. Phase 3 (1.82 -> 2.82 s) drives
     back up to extension. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./_s3d_core.js'));
  else root.S3D_CLIP_LEGEXT = factory(root.S3D);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S3D) {
  'use strict';

  var V = S3D;

  var TARGETS = {
    knee_flexed_deg: 108.7,
    knee_extended_deg: 162.8,
    source: 'CDC exercise video',
    licence: 'Public domain (US Government work)'
  };

  /* ---------------------------------------------------------------- rig-derived geometry
     L1/L2 and the hip's rest height are read off the skeleton rather than typed in, so a change
     to the rig moves this clip's construction with it instead of silently skewing the angles. */
  var SK = V.buildSkeleton();
  var HIP_X = SK.rest.hipL[0];                        /* 6.5 */
  var PELVIS_Y = 40;                                  /* AUTHORED seated pelvis height */
  var ROOT = [0, PELVIS_Y - SK.rest.hips[1], 0];       /* constant on every key: the pelvis is fixed */
  var HIP = [HIP_X, PELVIS_Y, 0];
  var L1 = V.vdist(SK.rest.kneeL, SK.rest.hipL);       /* thigh joint-to-joint */
  var L2 = V.vdist(SK.rest.ankleL, SK.rest.kneeL);     /* shin joint-to-joint */

  /* AUTHORED thigh attitude: forward (+Z, the way a seated thigh points), at THIGH_SLOPE_DEG
     below horizontal, splayed 1 unit outward over its 32.4-unit length. See the header for why
     the slope is 0 and why this pelvis height. */
  var THIGH_SLOPE_DEG = 0;
  var THIGH = V.norm([1.0, -32.4 * Math.tan(THIGH_SLOPE_DEG * V.D2R), 32.4]);

  function rotX(v, deg) {
    var c = Math.cos(deg * V.D2R), s = Math.sin(deg * V.D2R);
    return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
  }

  /* The whole leg for one target knee angle, left side. */
  function solveLeg(thetaDeg) {
    var knee = V.add(HIP, V.mul(THIGH, L1));
    var ankle = V.add(knee, V.mul(rotX(THIGH, 180 - thetaDeg), L2));
    var d = V.vdist(HIP, ankle);
    var u = V.mul(V.sub(ankle, HIP), 1 / d);
    var cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    var perp = V.sub(V.sub(knee, HIP), V.mul(u, L1 * cosA));   /* the pole direction, solved not guessed */
    return { ankle: ankle, pole: V.add(HIP, V.mul(V.norm(perp), 60)) };
  }

  /* Both legs, mirror-symmetric: this is a machine movement, so the two sides are one movement.
     (The engine's `both()` mirrors `p` rotations; IK targets are world points and are mirrored
     here by negating x, which is the same reflection.) */
  function legs(thetaDeg) {
    var g = solveLeg(thetaDeg), A = g.ankle, P = g.pole;
    return {
      legL: { t: A, pole: P, level: 'toeL' },
      legR: { t: [-A[0], A[1], A[2]], pole: [-P[0], P[1], P[2]], level: 'toeR' }
    };
  }

  /* AUTHORED torso and arms — identical on every key (a leg extension does not move the upper
     body; the pelvis and torso are held by the seat and the back pad). */
  function upperBody() {
    return V.both({
      spine: V.qA([1, 0, 0], -5),
      chest: V.qA([1, 0, 0], -3),
      neck: V.qA([1, 0, 0], 2),
      head: V.qA([1, 0, 0], 5),
      shL: V.qMul(V.qA([0, 0, 1], -30), V.qA([1, 0, 0], -12)),
      elbL: V.qA([1, 0, 0], -22)
    });
  }

  /* home = knee EXTENDED (quadriceps shortest), away = knee FLEXED (quadriceps lengthened). */
  var HOME = 162.8, AWAY = 108.7;
  function key(t, theta) { return { t: t, p: upperBody(), root: ROOT.slice(), ik: legs(theta) }; }

  var CLIP = {
    name: 'legext',
    duration: 3.14,
    loop: true,
    desc: 'seated leg extension on a machine \u2014 the shin swings from hanging (knee flexed) up to extended, pelvis fixed',
    keys: [
      key(0.00, HOME),    /* start: home, fully extended */
      key(1.50, AWAY),    /* end of phase 1: the controlled lowering into flexion */
      key(1.82, AWAY),    /* end of phase 2: hold */
      key(2.82, HOME),    /* end of phase 3: the drive back to extension */
      key(3.14, HOME)     /* end of phase 4: hold */
    ]
  };

  S3D.CLIPS[CLIP.name] = CLIP;
  S3D.MEASURED = S3D.MEASURED || {};
  S3D.MEASURED[CLIP.name] = { targets: TARGETS, source: TARGETS.source, licence: TARGETS.licence };

  return { clip: CLIP, targets: TARGETS };
});
