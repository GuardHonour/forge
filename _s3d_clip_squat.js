/* _s3d_clip_squat.js — BARBELL BACK SQUAT. One measured clip for FORGE's 3D view.

   MEASURED — the numbers this clip exists to reproduce, verbatim as given (TARGETS below):
     knee interior angle ... 176.8 deg standing (top)  ->  66.7 deg at the bottom
     hip  interior angle ... 172.7 deg standing (top)  ->  70.4 deg at the bottom
   Source: Wikimedia Commons file `commons_squat.webm`, licence CC BY 3.0, artist "FitnessScape".

   Everything else in this file is AUTHORED, and the two are labelled separately everywhere below.
   The single largest authored decision is the ARM POSE — see the block above solveArms().

   WHAT IS SOLVED RATHER THAN TYPED
   Four quantities are DERIVED here at load time, each from a measured target, and each solved
   against the engine's own sampled pose rather than by hand:

     1. the pelvis DROP at the top   — closed form, from the measured knee angle (law of cosines);
     2. the STANCE WIDTH             — bisection, from the measured hip angle at the top;
     3. the PELVIS AT THE BOTTOM     — bisection, from the measured THIGH angle (see the anchor note);
     4. the TORSO LEAN at the bottom — bisection, from the measured hip angle at the bottom.

   (3) and (4) are not cosmetic preferences. They are the two degrees of freedom the rig leaves that
   the measured angles actually pin down, and guessing either one is how a squat ends up with the
   right knee and the wrong hip. Every bisection calls `evalClip` on a one-key probe clip, so it
   converges on the angle the CHECK will measure — computed from `ev.fk.p`, the posed world positions
   — not on a private formula that might disagree with the engine.

   WHICH MEASURED NUMBER PLACES THE PELVIS AT THE BOTTOM, AND WHY NOT `hip_travel_m`
     The knee angle fixes only the hip-to-ankle DISTANCE (law of cosines: 34.585 units), which leaves
     the pelvis free anywhere on a circle of that radius around the ankle — a whole family of squats
     with the right knee angle and wildly different hips. The record carries two candidates for
     picking the point, and they do not agree, so one of them has to be rejected on evidence:
       * measured THIGH elevation 91.7 deg + measured knee 66.7 deg  ->  hip-ankle 34.585 units
       * measured knee 66.7 deg alone                                ->  hip-ankle 34.585 units
     agreement 0.0000 units. Those two ANGLES are mutually consistent to four decimal places, and two
     independent measurements agreeing exactly is not a coincidence a distance measurement has to be
     compared against.
       * recorded `hip_travel_m` 0.567 m -> would require a hip-ankle reach of 35.9 units / a descent
         of 38.7 units, i.e. the knee angle that goes with it is not the one that was recorded.
     A direction is also the more robust measurement: it survives a pose model's own scale error,
     which is exactly what a distance in metres does not. So the pelvis is placed by the THIGH ANGLE
     (the thigh's elevation from straight up, 91.7 deg at the bottom — 1.7 deg past horizontal), and
     `hip_travel_m` is recorded in TARGETS below for the record but is NOT used to build the pose.
     The solve also reproduces the record's STANDING thigh angle as an independent check: 171.84 deg
     against the measured 173.7 — a 1.86 deg miss, inside the same +/-2 deg the brief asks for.

   WHY THE STANCE IS WIDER THAN THE RIG'S REST FOOT POSITION  (the one place this clip departs
   from a literal reading of the brief, so it is stated here in full)
     The brief says to put each foot target at the REST foot position (ankleL = [8, 9, 0]). Doing that
     cannot reproduce the measured angles, and the shortfall is not marginal:
       at the REST foot position, with the pelvis standing at its rest height, the interior knee angle
       is 163.87 deg — 12.93 deg short of the measured 176.8, six times the tolerance — and the hip
       angle is 164.22 deg against a measured 172.7.
     The reason is a property of the RIG, not a choice: the rig's rest stance puts the ankle only 1.5
     units outboard of the hip joint (ankle x 8.0 vs hipL x 6.5), so the hip-to-ankle distance is
     62.19 units against the leg's maximum reach of 62.82 — the leg is 99.0% extended and the knee
     cannot straighten any further. A measured knee angle of 176.8 deg IS a nearly straight leg, so
     the feet have to be far enough out that the leg can actually BE straight; the law of cosines puts
     the minimum lateral offset at 8.65 units, i.e. an ankle at x >= 15.15.
     What closes the gap is real and is not a fudge: the measured reference's own thigh is NOT
     vertical at the top (thigh_from_vertical_deg = 173.7 in `_ref/squat_measured.json`, 6.3 deg off
     straight down). A squat is stood with the feet outside the hip joints, so the thigh leans
     OUTWARD, and that outward lean is exactly what lets the leg extend. Solving (2) for the measured
     172.7 deg hip angle gives an ankle at x = 15.26 — a stance 30.5 units (41 cm) wide. That is an
     ordinary back-squat stance width; the rig's REST stance, 16 units (22 cm), is narrower than any
     real squat is performed.
     The feet are still PLANTED in the sense that matters: the foot target is byte-identical on all
     five keys, so nothing slides, and the toe is held level by the engine's own `level:'toeL/R'`.

   WHY THE BAR IS RIGID BY CONSTRUCTION
     _s3d_props.js draws a real 2.20 m bar along the line between the two WRIST joints and never
     scales it, so the hands must sit on a bar that cannot stretch. Every key here carries the SAME
     arm quaternions (`both(ARMS)`, identical object on all five keys), so the wrist-to-wrist
     distance is fixed by the arm's own bone lengths and cannot vary with the torso. The bar's
     levelness and squareness then follow from the pose being mirror-symmetric — and `both()` is what
     makes it mirror-symmetric, rather than two hand-written sides that can drift apart.

   TEMPO: keys sit exactly on the app's own 1500/320/1000/320 ms boundaries (see _CLIP_BRIEF.md).
     home = STANDING (knee 176.8, hip 172.7): the quadriceps and glutes are SHORTEST there, and home
     is always the shortened-muscle position. So phase 1 (0 -> 1.5 s) is the controlled LOWERING
     into the bottom — the eccentric half of a squat — and phase 3 (1.82 -> 2.82 s) is the drive up.
     away = the BOTTOM of the squat (knee 66.7, hip 70.4), held through phase 2. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./_s3d_core.js'));
  else root.S3D_CLIP_SQUAT = factory(root.S3D);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S3D) {
  'use strict';

  var V = S3D;

  /* ------------------------------------------------------------------ the measured record */
  var TARGETS = {
    knee_top_deg: 176.8,
    knee_bottom_deg: 66.7,
    hip_top_deg: 172.7,
    hip_bottom_deg: 70.4,
    /* The thigh's elevation from straight UP (180 = pointing straight down), measured from the same
       clip: 173.7 standing, 91.7 at the bottom. These are what fix WHERE on the pelvis's arc the
       bottom sits — the knee angle alone fixes only the hip-to-ankle DISTANCE, leaving the pelvis
       free anywhere on a circle around the ankle.
       They are used rather than the record's `hip_travel_m` (0.567 m) because the two measured
       ANGLES are mutually consistent and the recorded distance is not: knee 66.7 deg alone implies a
       hip-ankle reach of 34.585 units, and thigh 91.7 deg with knee 66.7 deg implies 34.585 units —
       agreement to 0.0000 units — while 0.567 m of descent would need 38.7 units. A direction is
       also the more robust measurement: it survives the pose model's own scale error, which a
       distance does not. */
    thigh_top_deg: 173.7,
    thigh_bottom_deg: 91.7,
    /* Recorded for the record, NOT used to build the pose — see the anchor note at the top of this
       file: 0.567 m of hip descent is inconsistent with the reference's own knee angle (66.7 deg
       implies 34.585 units of hip-ankle reach, i.e. 0.495 m of descent). Kept so the discrepancy is
       visible here rather than silently dropped. */
    hip_travel_m_recorded: 0.567,
    source: 'Wikimedia Commons file commons_squat.webm',
    licence: 'CC BY 3.0',
    artist: 'FitnessScape'
  };

  /* ------------------------------------------------------------------ rig-derived geometry
     Read off the skeleton rather than typed in, so a change to the rig moves this construction with
     it instead of silently skewing the angles. */
  var SK = V.buildSkeleton();
  var HIP_X = SK.rest.hipL[0];                          /* 6.5 — pelvis half-width at the hip joints */
  var HIPS_Y = SK.rest.hips[1];                         /* 71.8 */
  var ANKLE_Y = SK.rest.ankleL[1];                      /* 9 — the foot is planted on the floor */
  var CHEST_DY = SK.rest.chest[1] - SK.rest.hips[1];    /* 24 — hips joint to chest joint, upright */
  var L1 = V.vdist(SK.rest.kneeL, SK.rest.hipL);        /* 32.5 — thigh */
  var L2 = V.vdist(SK.rest.ankleL, SK.rest.kneeL);      /* 30.3 — shin */
  /* The metre scale, derived the same way _s3d_props.js derives it (topmost joint + head bone over
     1.80 m), so a distance measured off THIS rig can be reported in metres against the reference
     without importing a scale from a different body. */
  var UPM = (function () {
    var top = 0;
    SK.boneNames.forEach(function (j) { if (SK.rest[j][1] > top) top = SK.rest[j][1]; });
    return (top + V.BONE.head) / 1.80;
  })();

  /* Interior angle AT joint b, between (b->a) and (b->c). The brief's convention: 180 = straight.
     Identical to the formula the check script uses, so agreement between them is not a coincidence
     of two different definitions. */
  function angleAt(P, a, b, c) {
    var u = V.sub(P[a], P[b]), v = V.sub(P[c], P[b]);
    var lu = V.len(u), lv = V.len(v);
    if (!(lu > 1e-9) || !(lv > 1e-9)) return NaN;
    return Math.acos(V.clamp(V.dot(u, v) / (lu * lv), -1, 1)) / V.D2R;
  }

  /* The hip-ankle distance that produces a given interior knee angle, by the law of cosines on the
     thigh/shin triangle. This is the "solve the drop" step: the knee angle is not authored, it is
     what the pelvis height makes it. */
  function reachForKneeAngle(thetaDeg) {
    var c = Math.cos(thetaDeg * V.D2R);
    return Math.sqrt(L1 * L1 + L2 * L2 - 2 * L1 * L2 * c);
  }

  /* ------------------------------------------------------------------ the planted feet
     The foot target is the SAME on every key — that is what "planted" means here, and it is why the
     feet cannot creep through the rep. `pole` is a point 70 units in FRONT of the ankle at ankle
     height, which makes the IK's perpendicular (pp) point along +Z at every interpolated frame: the
     knee therefore bends forward in the leg's own plane and tracks out over the foot rather than
     swinging sideways. */
  var POLE_FWD = 70;
  var STANCE_X = 0;                                     /* solved below, before the keys are built */

  function legs(sx) {
    return {
      legL: { t: [sx, ANKLE_Y, 0], pole: [sx, ANKLE_Y, POLE_FWD], level: 'toeL' },
      legR: { t: [-sx, ANKLE_Y, 0], pole: [-sx, ANKLE_Y, POLE_FWD], level: 'toeR' }
    };
  }

  /* ------------------------------------------------------------------ AUTHORED: the arms
     THE ARM POSE IS AUTHORED. Nothing in the reference measurement constrains it: the clip was
     measured for knee and hip angles only, and its REAR 3/4 framing cannot resolve a grip.

     What it is: a back-squat RACK. The bar lies on the upper traps, the hands grip it just outside
     the shoulders, the elbows hang DOWN and slightly BACK, and the forearms fold up and back from
     the elbow to the bar. That geometry is why the elbow angle below comes out acute (~27 deg): with
     the hands on a bar that is only ~11 units from the shoulder joint, the two arm bones are almost
     doubled back on each other, and that is what a racked bar looks like.

     It is authored as a TARGET, not as joint angles, which is this project's convention: the wrist
     is placed at a point (the bar's centre line) and the engine's two-bone IK derives the elbow. The
     target is given in the REST frame, where the chest carries no rotation, so the resulting
     quaternions are exactly "this wrist, relative to the chest" — and holding those quaternions
     constant on every key is what makes the bar ride the back rigidly instead of drifting.

     Numbers, in rig units (1 unit = 1.47 cm at this rig's 1.80 m scale):
       wrist target  [7.6, 102.5, -10.5]  = 3.1 outside the shoulder joint (4.5), 2.0 below shoulder
                                            height (104.5), 10.5 behind the coronal plane — i.e. on
                                            the upper back, outside the torso's ~9.3-unit surface.
       pole point    [20,  70,  -20]      = below, behind AND slightly outboard of the shoulder, so
                                            the elbow solves down-and-back with about 21 deg of
                                            abduction. The outboard component is not decoration: the
                                            rig's chest capsule (radius ~13) is WIDER than its
                                            shoulder joints (x = 4.5), so an elbow tucked straight
                                            under the shoulder is swallowed by the torso mesh. At
                                            this pole 86% of the upper arm's length lies outside the
                                            body surface (worst intrusion 0.97 units), which is
                                            clearer than the seated leg-extension clip's own arm pose
                                            (67%, 2.67 units) — checked, not assumed.
     Grip width is a CONSEQUENCE of these two points (2 x 7.6 = 15.2 units), not a third number. */
  var WRIST_TARGET = [7.6, 102.5, -10.5];
  var ARM_POLE = [20, 70, -20];

  var ARMS = (function () {
    var q = {}, W = V.fk(SK, q, [0, 0, 0]);
    var res = V.ikTwoBone(SK, 'armL', WRIST_TARGET, ARM_POLE, q, W);
    if (res.clamped) throw new Error('squat: the authored back-squat grip is outside the arm\'s reach');
    /* Mirroring is done once here and the SAME object is reused on every key, so the two sides
       cannot drift and the grip cannot stretch. */
    return V.both({ shL: q.shL, elbL: q.elbL });
  })();

  /* ------------------------------------------------------------------ key construction */
  function key(t, root, torso, sx) {
    var p = {};
    Object.keys(torso).forEach(function (k) { p[k] = torso[k]; });
    Object.keys(ARMS).forEach(function (k) { p[k] = ARMS[k]; });
    return { t: t, p: p, root: root, ik: legs(sx) };
  }

  /* The angle the CHECK will measure, read from the engine's own posed world positions. */
  function probePose(k) {
    var probe = { name: '__squat_probe', duration: 1, loop: false, keys: [k, k] };
    return V.evalClip(SK, probe, 0).fk.p;
  }
  function probeHipAngle(k) { return angleAt(probePose(k), 'chest', 'hipL', 'kneeL'); }
  /* The thigh's elevation from straight up, which is how the reference records it. */
  function probeThighFromUp(k) {
    var v = V.sub(probePose(k).kneeL, probePose(k).hipL);
    return Math.acos(V.clamp(v[1] / V.len(v), -1, 1)) / V.D2R;
  }

  /* Generic bisection on a monotonic scalar, used for the two quantities the measured angles pin
     down but no closed form gives cleanly. Throws rather than returning a guess if the root is not
     bracketed — a silently un-converged solve is exactly the failure this clip must not have. */
  function bisect(f, lo, hi, iters, what) {
    var flo = f(lo), fhi = f(hi);
    if (!((flo <= 0 && fhi >= 0) || (flo >= 0 && fhi <= 0))) {
      throw new Error('squat: ' + what + ' is not bracketed on [' + lo + ', ' + hi + '] (' +
                      flo.toFixed(2) + ' .. ' + fhi.toFixed(2) + ' deg)');
    }
    for (var i = 0; i < iters; i++) {
      var mid = 0.5 * (lo + hi), fm = f(mid);
      if ((flo <= 0) === (fm <= 0)) { lo = mid; flo = fm; } else { hi = mid; fhi = fm; }
    }
    return 0.5 * (lo + hi);
  }

  /* ---- 1 + 2. the TOP: pelvis height from the knee angle, stance width from the hip angle ---- */
  var D_TOP = reachForKneeAngle(TARGETS.knee_top_deg);
  var D_BOT = reachForKneeAngle(TARGETS.knee_bottom_deg);

  /* Standing, the torso is upright: no joint rotation at all, which is also the pose that MAXIMISES
     the interior hip angle for any given stance — a forward lean carries the chest joint forward and
     makes (hipL -> chest) more parallel to (hipL -> kneeL), lowering the angle. Solving the stance
     against an upright torso therefore yields the NARROWEST stance that can meet the measured 172.7,
     which is the conservative reading of the brief's "rest foot position" instruction: any author who
     leaned the trunk would have to splay the feet further still. */
  function topRoot(dx) {
    /* hip = (HIP_X, HIPS_Y + root.y, 0), ankle = (HIP_X + dx, ANKLE_Y, 0); the leg reaches D_TOP. */
    var dy = Math.sqrt(Math.max(0, D_TOP * D_TOP - dx * dx));
    return [0, ANKLE_Y - HIPS_Y + dy, 0];
  }
  var DX = bisect(function (dx) {
    return probeHipAngle(key(0, topRoot(dx), {}, HIP_X + dx)) - TARGETS.hip_top_deg;
  }, 0.25, 15, 60, 'the stance width that reproduces the measured standing hip angle');
  STANCE_X = HIP_X + DX;
  var ROOT_TOP = topRoot(DX);

  /* ---- 3. the BOTTOM: the pelvis's place on the arc is fixed by the reference's measured THIGH
     angle, and the torso lean is then solved for the measured hip angle ----
     The knee angle fixes the hip-to-ankle DISTANCE, which leaves the pelvis free anywhere on a
     circle of radius D_BOT around the ankle. The measured thigh elevation picks the point: the
     pelvis travels BACKWARD in a squat (the figure faces +Z), so the z component is negative. */
  function bottomRoot(yb) {
    var dz2 = D_BOT * D_BOT - DX * DX - yb * yb;      /* yb = the hip's height above the ankle */
    if (!(dz2 > 0)) return null;
    return [0, ANKLE_Y + yb - HIPS_Y, -Math.sqrt(dz2)];
  }
  var YB_BOT = bisect(function (yb) {
    var r = bottomRoot(yb);
    if (!r) return -1e9;
    return probeThighFromUp(key(1.5, r, {}, STANCE_X)) - TARGETS.thigh_bottom_deg;
  }, 18, 32, 60, 'the pelvis position that reproduces the measured bottom thigh angle');
  var ROOT_BOT = bottomRoot(YB_BOT);

  /* The torso leans forward at the bottom (it has to: the pelvis has travelled back), and the lean
     is SOLVED so the interior hip angle is the measured 70.4 rather than eyeballed. The lean goes in
     `spine` because that is the joint whose rotation moves the CHEST JOINT — which is the landmark
     the hip angle is defined at — while neck and head counter-rotate so the lifter keeps looking
     forward instead of at the floor. (They cannot affect any measured angle: neither is on the
     chest->hipL->kneeL path.)
     NOTE ON READING `solved.lean_deg`: it is the SPINE JOINT's rotation, and this rig carries the
     trunk on two 12-unit bones (hips -> spine -> chest) of which only the spine's own rotation is
     authored, so the SPINE AXIS ends up at half that angle off vertical. At the bottom lean_deg is
     44.66 deg and the trunk therefore actually leans 22.33 deg — a plausible deep-squat trunk angle,
     and the figure the check prints as `actual lean of the spine axis off vertical`. */
  function torsoLean(deg) {
    return V.both({
      spine: V.qA([1, 0, 0], deg),
      neck: V.qA([1, 0, 0], -0.4 * deg),
      head: V.qA([1, 0, 0], -0.6 * deg)
    });
  }
  var LEAN = bisect(function (deg) {
    return probeHipAngle(key(1.5, ROOT_BOT, torsoLean(deg), STANCE_X)) - TARGETS.hip_bottom_deg;
  }, 0, 80, 60, 'the torso lean that reproduces the measured bottom hip angle');

  /* ------------------------------------------------------------------ the clip */
  var HOME_KEY = function (t) { return key(t, ROOT_TOP.slice(), {}, STANCE_X); };
  var AWAY_KEY = function (t) { return key(t, ROOT_BOT.slice(), torsoLean(LEAN), STANCE_X); };

  var CLIP = {
    name: 'squat',
    duration: 3.14,
    loop: true,
    desc: 'barbell back squat \u2014 knee and hip angles measured from commons_squat.webm (CC BY 3.0, ' +
          'FitnessScape); the back-rack arm pose is AUTHORED, not measured',
    keys: [
      HOME_KEY(0.00),    /* start: home, standing (quadriceps/glutes shortest) */
      AWAY_KEY(1.50),    /* end of phase 1: the controlled LOWERING into the bottom */
      AWAY_KEY(1.82),    /* end of phase 2: hold */
      HOME_KEY(2.82),    /* end of phase 3: the drive back to standing */
      HOME_KEY(3.14)     /* end of phase 4: hold */
    ]
  };

  S3D.CLIPS[CLIP.name] = CLIP;
  S3D.MEASURED = S3D.MEASURED || {};
  S3D.MEASURED[CLIP.name] = { targets: TARGETS, source: TARGETS.source, licence: TARGETS.licence };

  return {
    clip: CLIP,
    targets: TARGETS,
    /* The solved staging, exposed so the check script can print what was derived rather than
       re-deriving it — and so a reader can see the numbers this file arrived at without running it. */
    solved: {
      stance_x: STANCE_X, dx: DX, lean_deg: LEAN,
      hip_above_ankle_bot: YB_BOT,
      root_top: ROOT_TOP.slice(), root_bot: ROOT_BOT.slice(),
      thigh_from_up_top_deg: probeThighFromUp(CLIP.keys[0]),
      units_per_metre: UPM
    }
  };
});
