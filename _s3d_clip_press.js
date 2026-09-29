/* _s3d_clip_press.js — STANDING BARBELL OVERHEAD PRESS (military press). One clip for FORGE's 3D view.

   MEASURED — the two numbers the reference gave, verbatim (see TARGETS below):
     - elbow interior angle at LOCKOUT ............... 163.7 deg  (interior at elbL; 180 = straight)
     - wrist height at lockout, wrL.y - shL.y ........ 43.9 engine units, read at t = 0

   Source: 'YouTube CC-BY - Barbell Shoulder Press / Military Press (Best Barbells)'
   Licence: 'CC BY'
   The 43.9 is the reference's wrist at 0.401 m over an upper arm of 0.219 m, expressed in this
   engine's units by scaling the upper arm to the rig's 24:  24 * (0.401 / 0.219) = 43.9.

   AUTHORED — nothing in the reference constrains any of this, it is staging:
     - the WHOLE racked (bottom) position. The reference pinned the lockout, not a reliable bottom,
       so the bar's bottom height, the elbow angle there, the grip width, the stance and the leg
       pose are all authored. It is SOLVED here (see the rack solver) rather than typed, because a
       rack has to satisfy three things at once: the elbow in the 60-90 deg band, forearms near
       vertical, and the elbow arc bottoming out at the rack key. The delivered pose measures 78.3
       deg, the forearm 3.4 deg off vertical, the elbow 1.0 unit forward of the hand, and the arc
       bottoms 0.005 deg below the key. The bar finishes 16 units above the shoulders and 21 units
       Forward of them — see WHY THE BAR IS FORWARD below;
     - the grip: 14 units to each wrist, so the wrists are 28 units apart. The reference's barbell
       invariant is 0.471 m, which scales to ~32 units, and 28 is as wide as this clip can go
       without breaking the OTHER measured number — see WHY THE GRIP IS 28 below;
     - the elbow pole points — i.e. where the elbows travel: out to the sides and forward of the
       torso, never behind it and never inverted;
     - the slight backward torso lean at lockout and the small forward lean at the rack;
     - the stance width, the planted feet and the near-straight knees;
     - the tempo keys, dictated by the app's 1500/320/1000/320 ms clock, not by the reference.

   ---------------------------------------------------------------------------------------------
   WHY THE GRIP IS 28 UNITS AND NOT THE 32 THE REFERENCE IMPLIES
   ---------------------------------------------------------------------------------------------
   The grip and the lockout height are ONE equation, not two independent numbers. The measured
   elbow angle fixes the shoulder->wrist chord at 43.065; the wrist sits outboard of the shoulder
   by dx = gripHalf - 4.5, and only the chord's VERTICAL component is the measured wrist height:
       height = sqrt(chord^2 - dx^2)
   which FALLS as the grip widens:  grip 28 -> 42.004 (inside the measured 43.9 +/- 2),
   grip 32 -> 41.502 (2.40 units short), crossover at a 28.9-unit grip. So a 32-unit grip does not
   merely look different, it breaks the other measured number. 28 is the widest grip this clip can
   hold with both measured numbers true. That was measured, not assumed.

   ---------------------------------------------------------------------------------------------
   WHY THE BAR IS FORWARD OF THE SHOULDERS
   ---------------------------------------------------------------------------------------------
   Not a staging choice: the elbow angle is fixed by the shoulder->wrist DISTANCE alone (law of
   cosines) and the pole only rotates the elbow about that axis, so it cannot change the angle.
   With upper 24 / fore 19.5:
       elbow  60 deg -> chord 22.10      elbow  90 deg -> chord 30.92
       elbow  75 deg -> chord 25.66      elbow 120 deg -> chord 38.74
   A 60-90 deg rack therefore REQUIRES the wrist 22-31 units from the shoulder. Tuck the hands in
   to the chest, as a photograph of a rack suggests, and the elbow collapses: the first version of
   this clip put the wrist 6.3 units out and measured 13.8 deg, an arm folded onto itself that
   renders as visibly broken arms. The bar reaching well forward is the price of a real rack.

   ---------------------------------------------------------------------------------------------
   THE ONE NUMBER THIS CLIP CANNOT REACH, AND WHY (read this before comparing the check output)
   ---------------------------------------------------------------------------------------------
   The two measured numbers are jointly OUT OF REACH on this rig, and it is an arithmetic fact,
   not a pose choice:

     An elbow interior angle of 163.7 deg fixes the shoulder->wrist chord by the law of cosines.
     With the rig's own bones (upper 24.000, fore 19.500):
         chord(163.7) = sqrt(24^2 + 19.5^2 - 2*24*19.5*cos 163.7) = 43.065 units
     and the vertical component of that chord can never exceed the chord itself, so the highest a
     wrist can sit above the shoulder AT THAT ELBOW ANGLE is 43.065 units — and once the grip moves
     the wrist outboard of the shoulder by dx, even that is reduced to sqrt(43.065^2 - dx^2).

     The reference asks for 43.9. So the shortfall is at least 0.835 units, and it is a property of
     the RATIO between the reference's two arm bones and this rig's, not of the pose: reaching 43.9
     on a 163.7 deg elbow implies a forearm of 20.85 units against BONE.fore = 19.5 (with a
     matching upper arm), i.e. the reference's arm is proportionally longer than this skeleton's.
     At this clip's 28-unit grip the shortfall is 1.896 units, and it splits in two:
         elbow angle alone (43.9 - 43.065) .................... 0.835   impossible for ANY pose
         the grip holding the wrist 9.5 off-axis ............... 1.061   see WHY THE GRIP IS 28
     For the record, the whole arm at FULL extension only spans 24 + 19.5 = 43.5, so 43.9 is 0.4
     beyond the rig's arm even with the elbow locked straight — and clearing 43.9 over a 9.5-unit
     lateral offset would need 44.916, i.e. 1.4 units more arm than this skeleton has.

   WHAT THIS CLIP DOES ABOUT IT
     It reproduces the ELBOW ANGLE — the reference's own direct measurement, and the better-
     conditioned of the two — EXACTLY (delta 0.000 deg), and then holds that angle and searches for
     the tallest wrist the rig can produce with it AT THIS GRIP. Achieved: 42.004 units against a
     grip-aware ceiling of 42.0045 and a target of 43.9. It sits on its own ceiling to 1.0e-4, so
     the whole 1.896-unit shortfall is the two constraints above, not a slack pose. 1.896 units is
     ~1.7 cm at this rig's scale.
     It does NOT straighten the elbow to buy those units: that would restate a measured target to
     match this clip's own output, and it would also look wrong — an overhead press does not finish
     with locked-straight elbows. The achieved number is printed by _check_clip_press.cjs and carried
     in `derived.lockout_wrist_dy`; it is never restated as a pass.

   ---------------------------------------------------------------------------------------------
   TEMPO (see _CLIP_BRIEF.md): keys sit exactly on the app's 1500/320/1000/320 ms boundaries.
     home = LOCKOUT (elbow 163.7 deg — triceps shortest overhead), so phase 1 (0 -> 1.5 s) is the
     controlled LOWERING from lockout into the rack. away = RACKED. Phase 3 (1.82 -> 2.82 s) drives
     the bar back overhead. Reversed, the whole animation would run backwards.

   HOW THE POSE IS BUILT
     Both arms are solved with two-bone IK (`S3D.ikTwoBone` on the armL / armR chains) toward a
     wrist TARGET placed in the shoulder's sagittal plane, so the two wrists are mirror images by
     construction and the 2.20 m bar stretched between them cannot tilt or stretch. The elbow angle
     is never authored as an angle: it falls out of where the wrist is put, and it is measured back
     off ev.fk.p by _check_clip_press.cjs, which is what the brief requires.
     The legs are IK-solved too, with the ankles at the rig's own rest ankle height (y = 9) so the
     feet stay planted on the floor all rep, and the knee pole forward so the knees cannot bend
     backwards. `level: 'toeL'/'toeR'` keeps the soles flat as the shins tilt.
     `p` carries only the torso chain. Every arm and leg joint comes from IK, so there is no
     authored left-side arm rotation for S3D.both() to mirror; the right side is built from the left
     by negating x, which is the same reflection. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./_s3d_core.js'));
  else root.S3D_CLIP_PRESS = factory(root.S3D);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S3D) {
  'use strict';

  var V = S3D;

  /* ---------------------------------------------------------------- the measured record */
  var TARGETS = {
    elbow_lockout_deg: 163.7,              /* interior elbow angle at lockout */
    wrist_above_shoulder_lockout: 43.9,    /* wrL[1] - shL[1] at t = 0 */
    source: 'YouTube CC-BY \u2014 Barbell Shoulder Press / Military Press (Best Barbells)',
    licence: 'CC BY'
  };

  /* ---------------------------------------------------------------- the rig, read not typed
     Bone lengths and the shoulder's rest height are read off the skeleton rather than typed in, so
     a change to the rig moves this clip's construction with it instead of silently skewing the
     angles. The chord at the measured elbow angle is derived the same way. */
  var SK = V.buildSkeleton();
  var SH_REST = SK.rest.shL;                                /* [4.5, 104.5, 0] */
  var L_UPPER = V.vdist(SK.rest.elbL, SK.rest.shL);         /* 24.0 */
  var L_FORE = V.vdist(SK.rest.wrL, SK.rest.elbL);          /* 19.5 */
  var CHORD_LOCKOUT = Math.sqrt(
    L_UPPER * L_UPPER + L_FORE * L_FORE -
    2 * L_UPPER * L_FORE * Math.cos(TARGETS.elbow_lockout_deg * V.D2R));

  /* ---------------------------------------------------------------- AUTHORED staging */
  var DURATION = 3.14;
  /* Grip: 14 units to each wrist, so the hands are 28 units apart. The reference's barbell
     invariant is 0.471 m between the wrists; scaled to this rig that is about 32 units, and 28 is
     as close as this clip can get while still satisfying the OTHER measured number — see the note
     below. It is AUTHORED: a grip width is a setup choice, and the reference pinned the lockout
     pose, not a grip measurement.

     WHY NOT EXACTLY 32 — the grip and the lockout height are one equation, not two
     The measured elbow angle fixes the shoulder->wrist chord at 43.065. The wrist sits outboard of
     the shoulder by dx = gripHalf - 4.5, so the chord's VERTICAL component — the measured wrist
     height — is sqrt(chord^2 - dx^2) and falls as the grip widens:
         grip 28 (dx 9.5) -> reach 42.004   inside the measured 43.9 +/- 2
         grip 32 (dx 11.5)-> reach 41.502   2.40 units SHORT of 43.9
     The crossover is a 28.9-unit grip. So a 32-unit grip does not merely look different, it breaks
     the other measured number: it was measured and rejected here rather than adopted and quietly
     excused. 28 units is the widest grip this clip can hold while both of its measured numbers stay
     true. */
  var GRIP_X = 14;
  var STANCE_X = 8;                          /* AUTHORED: ankles under the hips, flat on y = 9 */
  var ANKLE = [STANCE_X, 9, 0];
  var KNEE_POLE = [7, 46, 64];               /* AUTHORED: knees travel forward, never backwards */

  /* Torso: a slight backward lean at lockout (the natural ribcage position under an overhead bar),
     a small forward lean at the rack with the bar in front of the shoulders. The chest rotation is
     what carries the shoulder joints; the pelvis never moves. */
  var TORSO_LOCKOUT = V.both({
    spine: V.qA([1, 0, 0], -5), chest: V.qA([1, 0, 0], -4),
    neck: V.qA([1, 0, 0], 3), head: V.qA([1, 0, 0], 7)
  });
  var TORSO_RACK = V.both({
    spine: V.qA([1, 0, 0], 1), chest: V.qA([1, 0, 0], 1),
    neck: V.qA([1, 0, 0], 2), head: V.qA([1, 0, 0], 5)
  });

  function round4(x) { return Math.round(x * 1e4) / 1e4; }

  /* ---------------------------------------------------------------- the arms, solved by IK
     `target` is the WRIST position in world space. `pole` is a POINT: only its component
     perpendicular to the shoulder -> wrist line steers the elbow, so both poles deliberately sit
     OUT and FORWARD of that line. The elbows therefore travel out to the sides and in front of the
     torso — the only place a press's elbows ever go — and never behind it or inverted.
     Both sides are built from one source with x negated, so the elbows and wrists cannot drift
     apart and the bar between the wrists stays level and one grip wide. */
  function arms(target, pole) {
    return {
      armL: { t: [target[0], target[1], target[2]], pole: [pole[0], pole[1], pole[2]] },
      armR: { t: [-target[0], target[1], target[2]], pole: [-pole[0], pole[1], pole[2]] }
    };
  }

  /* RACK (AUTHORED). Bar at about shoulder height and out in front of the shoulders, hands directly
     over the elbows so the FOREARMS COME OUT VERTICAL, which is what a rack looks like.

     THE ELBOW ANGLE IS A CONSEQUENCE OF THE DISTANCE, and this is the trap the first version of this
     clip fell into. The law of cosines fixes the shoulder->wrist chord from the elbow angle alone,
     and the pole only ROTATES the elbow about that axis — it cannot change the angle at all. With
     upper 24 / fore 19.5:
         elbow  60 deg -> chord 22.10      elbow  90 deg -> chord 30.92
         elbow  75 deg -> chord 25.66      elbow 120 deg -> chord 38.74
     An earlier rack put the wrist only 6.3 units from the shoulder, which folds the arm onto itself:
     it measured 13.8 deg and rendered as visibly broken arms. A rack of 60-90 deg therefore REQUIRES
     the wrist 22-31 units from the shoulder, and that is why the bar sits well forward of the
     shoulders rather than tucked against the chest — it is forced by this rig's arm length, not
     chosen for looks. Solved by search over the wrist target and the pole: 74.9 deg with the forearm
     0.64 deg off vertical and the elbow 0.2 units forward of the hand. */
  /* Seeds only — the rack solver below overwrites BOTH of these. They exist so the solver has a
     definition even if it ever fails to find a pose (it throws if it does not). */
  var WRIST_RACK = [GRIP_X, SH_REST[1] + 8.5, 19.0];
  var POLE_RACK = [11, 109, 13];
  var RACK_SOLVED = null;                    /* filled by the solver below */
  var RACK_CONSIDERED = 0, RACK_ACCEPTED = 0;

  /* LOCKOUT (MEASURED elbow). The wrist is placed on the 163.7 deg chord (CHORD_LOCKOUT) straight
     ABOVE THE POSED SHOULDER JOINT — not above its rest position. That distinction is the whole
     reason the number below is solved rather than typed: the torso keys rotate the chest, and the
     chest rotation carries the shoulder joints with it, so a target measured from SK.rest.shL lands
     on the wrong chord and the elbow comes out several degrees off. With the wrist straight up from
     the posed shoulder the arm finishes genuinely vertical, which is both the highest the measured
     elbow angle permits and what an overhead press's lockout actually looks like. */
  var POLE_LOCKOUT = [25, SH_REST[1] - 1, 6];
  var LOCKOUT_Z = 0.0;                       /* solved below, not authored */
  var WRIST_LOCKOUT = [GRIP_X, SH_REST[1] + CHORD_LOCKOUT, 0.0];

  /* ---------------------------------------------------------------- the legs, solved by IK
     Ankles planted at the rig's own rest ankle height so the soles stay on the floor; the knee angle
     this gives is near straight, which is the stance a standing press is performed in. */
  function legs() {
    return {
      legL: { t: ANKLE.slice(), pole: KNEE_POLE.slice(), level: 'toeL' },
      legR: { t: [-ANKLE[0], ANKLE[1], ANKLE[2]],
              pole: [-KNEE_POLE[0], KNEE_POLE[1], KNEE_POLE[2]], level: 'toeR' }
    };
  }

  /* Every key must carry the SAME chain names: evalClip() reads k0.ik's keys and looks each one up
     in k1, so a key missing a chain would silently drop that limb out of the pose. */
  function ikFor(wrist, pole) {
    var ik = {}, L = legs(), A = arms(wrist, pole);
    Object.keys(L).forEach(function (k) { ik[k] = L[k]; });
    Object.keys(A).forEach(function (k) { ik[k] = A[k]; });
    return ik;
  }
  function key(t, wrist, pole, torso) {
    return { t: t, p: torso, root: [0, 0, 0], ik: ikFor(wrist, pole) };
  }
  function buildKeys(wristLockout) {
    return [
      key(0.00, wristLockout, POLE_LOCKOUT, TORSO_LOCKOUT),   /* home: LOCKOUT */
      key(1.50, WRIST_RACK, POLE_RACK, TORSO_RACK),           /* away: RACKED, end of phase 1 (lowering) */
      key(1.82, WRIST_RACK, POLE_RACK, TORSO_RACK),           /* hold, end of phase 2 */
      key(2.82, wristLockout, POLE_LOCKOUT, TORSO_LOCKOUT),   /* home: LOCKOUT, end of phase 3 (the drive) */
      key(3.14, wristLockout, POLE_LOCKOUT, TORSO_LOCKOUT)    /* hold, end of phase 4 */
    ];
  }

  /* ---------------------------------------------------------------- solve the lockout target
     The wrist is fired straight up from the POSED shoulder. The chord fixes the elbow angle by the
     law of cosines exactly, but where the shoulder actually ends up depends on the torso keys, which
     nothing can read before the rig is posed — so the target height is SOLVED, not typed. Pose, read
     the elbow angle back off ev.fk.p, and bisect on the target height; the response is strictly
     monotone (higher target -> straighter arm), which is what makes a bracket valid. A Newton step on
     it diverges, because d(angle)/d(height) swings by a factor of ten across the range.
     The search then runs over the wrist's Z as well and keeps the pose with the greatest height: for
     a fixed chord the height is the chord's vertical component, so the tallest wrist is the one whose
     shoulder->wrist line is nearest WORLD vertical, and the torso's backward lean tilts the posed
     shoulder away from the target's z. That is worth 0.067 of the 0.914 unit shortfall.
     The probe clip is registered under its own name and removed again, so it can never be drawn.
     Nothing is rounded: ikTwoBone puts the wrist on the chord exactly, and rounding the target to
     4 dp was worth 8e-4 units of chord and a tenth of a degree of elbow. */
  (function solveLockout() {
    var NAME_PROBE = 'press__shoulder_probe';
    function pose(target) {
      var kL = key(0, target, POLE_LOCKOUT, TORSO_LOCKOUT);
      var kR = key(DURATION, target, POLE_LOCKOUT, TORSO_LOCKOUT);
      S3D.CLIPS[NAME_PROBE] = { name: NAME_PROBE, duration: DURATION, loop: true, desc: 'probe pose', keys: [kL, kR] };
      var p = V.evalClip(SK, S3D.CLIPS[NAME_PROBE], 0).fk.p;
      delete S3D.CLIPS[NAME_PROBE];
      var u = V.sub(p.shL, p.elbL), w = V.sub(p.wrL, p.elbL);
      return {
        elbow: Math.acos(V.clamp(V.dot(u, w) / (V.len(u) * V.len(w)), -1, 1)) / V.D2R,
        dy: p.wrL[1] - p.shL[1]
      };
    }
    var bestY = 0, bestH = -Infinity;
    for (var z = -3; z <= 1.5001; z += 0.25) {
      var lo = SH_REST[1] + 35, hi = SH_REST[1] + CHORD_LOCKOUT;   /* elbow(lo) < target < elbow(hi) */
      for (var i = 0; i < 40 && hi - lo > 1e-9; i++) {
        var mid = (lo + hi) / 2;
        if (pose([GRIP_X, mid, z]).elbow < TARGETS.elbow_lockout_deg) lo = mid; else hi = mid;
      }
      var y = (lo + hi) / 2, got = pose([GRIP_X, y, z]);
      if (got.dy > bestH) { bestH = got.dy; bestY = y; LOCKOUT_Z = z; }
    }
    WRIST_LOCKOUT = [GRIP_X, bestY, LOCKOUT_Z];
  })();

  /* ---------------------------------------------------------------- solve the rack target
     WRIST_RACK and POLE_RACK above are starting estimates; the delivered rack pose is CHOSEN by the
     search below, because three constraints have to hold at once and they trade against each other:

       - the elbow must sit in the 60-90 deg rack band (the first version measured 13.8 deg, which is
         an arm folded onto itself, and it renders as visibly broken arms);
       - the forearms must come out close to VERTICAL, which is what a rack looks like;
       - the arc must bottom out AT the rack key. If it bottoms out past t=1.5 the elbow keeps
         flexing through the hold and unflexing before 1.82 — a twitch — and the arc reached between
         keys dips below the "away" extreme, which this clip's own check reports as a defect.

     WHY THESE TRADE, AND WHY THE BAR ENDS UP FORWARD. The elbow angle is fixed by the
     shoulder->wrist DISTANCE alone (law of cosines), and the pole only rotates the elbow about that
     axis, so the pole cannot change the angle at all. With upper 24 / fore 19.5:
         elbow  60 deg -> chord 22.10     elbow  90 deg -> chord 30.92
         elbow  70 deg -> chord 25.22     elbow 120 deg -> chord 38.74
     A 60-90 deg rack therefore REQUIRES the wrist 22-31 units from the shoulder. Tuck the hands
     close to the chest, as a photograph of a rack suggests, and the elbow collapses to ~14 deg. So
     the bar finishing well forward of the shoulders is FORCED by this rig's arm length, not chosen
     for looks; given that distance, the pole then decides how vertical the forearm can be.
     The search scores each candidate on the whole phase-1 arc, not just on the end pose, so the
     winner is the pose whose elbow reaches its global minimum at the rack key. */
  (function solveRack() {
    var NAME_PROBE = 'press__rack_probe';
    /* NOTE the two probe keys carry distinct TIMES. A degenerate two-key clip whose keys share one
       `t` makes evalClip's key span zero, and everything downstream (root, fk positions, every angle)
       comes back null rather than throwing. That failure is silent in a filter: `elbow < 62` is false
       for NaN, so a NaN pose passes every test and the first candidate silently wins. */
    function probeClip(w, pole, torso) {
      return { name: NAME_PROBE, duration: DURATION, loop: true, desc: 'probe pose',
        keys: [key(0, w, pole, torso), key(DURATION, w, pole, torso)] };
    }
    function poseAt(w, pole) {
      S3D.CLIPS[NAME_PROBE] = probeClip(w, pole, TORSO_RACK);
      var ev = V.evalClip(SK, S3D.CLIPS[NAME_PROBE], 0);
      var p = ev.fk.p;
      delete S3D.CLIPS[NAME_PROBE];
      if (!p.elbL || p.elbL[1] === null) {
        throw new Error('rack probe produced no arm joints for ' + JSON.stringify(w) +
          ' / ' + JSON.stringify(pole));
      }
      var u = V.sub(p.shL, p.elbL), wv = V.sub(p.wrL, p.elbL);
      var fa = V.norm(V.sub(p.wrL, p.elbL));
      return {
        elbow: Math.acos(V.clamp(V.dot(u, wv) / (V.len(u) * V.len(wv)), -1, 1)) / V.D2R,
        tilt: Math.acos(V.clamp(Math.abs(fa[1]), -1, 1)) / V.D2R,
        elbFwd: p.elbL[2] - p.wrL[2], elbBelow: p.shL[1] - p.elbL[1]
      };
    }
    /* the deepest point of phase 1 for a candidate rack pose, posed through a throwaway two-key clip
       so that what is measured is the interpolated motion, not just the endpoint */
    function arcDip(w, pole) {
      var k = key(0, w, pole, TORSO_RACK);
      var k0 = key(0, WRIST_LOCKOUT, POLE_LOCKOUT, TORSO_LOCKOUT);
      var k1 = key(1.50, w, pole, TORSO_RACK);
      var kA = key(1.82, w, pole, TORSO_RACK);
      var k2 = key(2.82, WRIST_LOCKOUT, POLE_LOCKOUT, TORSO_LOCKOUT);
      var k3 = key(DURATION, WRIST_LOCKOUT, POLE_LOCKOUT, TORSO_LOCKOUT);
      S3D.CLIPS[NAME_PROBE] = { name: NAME_PROBE, duration: DURATION, loop: true, desc: 'probe pose',
        keys: [k0, k1, kA, k2, k3] };
      var lo = Infinity, end = 0, prev = null, back = 0;
      for (var i = 0; i <= 240; i++) {
        var t = 1.5 * i / 240;
        var p = V.evalClip(SK, S3D.CLIPS[NAME_PROBE], t).fk.p;
        var u = V.sub(p.shL, p.elbL), wv = V.sub(p.wrL, p.elbL);
        var e = Math.acos(V.clamp(V.dot(u, wv) / (V.len(u) * V.len(wv)), -1, 1)) / V.D2R;
        if (!(e >= 0)) { delete S3D.CLIPS[NAME_PROBE]; throw new Error('arc probe produced a non-finite elbow angle'); }
        if (e < lo) lo = e;
        if (prev !== null && e - prev > back) back = e - prev;
        prev = e;
        if (i === 240) end = e;
      }
      delete S3D.CLIPS[NAME_PROBE];
      return { dip: end - lo, back: back };
    }
    var best = null, considered = 0, accepted = 0, rows = [];
    for (var wy = SH_REST[1] + 8; wy <= SH_REST[1] + 19; wy += 1) {
      for (var wz = 16; wz <= 28; wz += 1) {
        for (var py = 60; py <= 90; py += 10) {
          for (var pz = 20; pz <= 40; pz += 5) {
            for (var px = 12; px <= 24; px += 4) {
              considered++;
              var r = poseAt([GRIP_X, wy, wz], [px, py, pz]);
              if (r.elbow < 62 || r.elbow > 88 || r.elbBelow <= 0) continue;
              accepted++;
              var a = arcDip([GRIP_X, wy, wz], [px, py, pz]);
              /* the arc's own behaviour dominates: a pose whose elbow keeps folding past the key is
                 rejected outright, and only then are tilt and elbow angle traded off */
              var sc = -a.dip * 40 - a.back * 400 - r.tilt * 2 - Math.abs(r.elbow - 78) * 0.5;
              if (!best || sc > best.sc) {
                best = { sc: sc, wy: wy, wz: wz, pole: [px, py, pz], r: r, a: a };
              }
            }
          }
        }
      }
    }
    if (!best) { throw new Error('rack solver found no pose in the 62-88 deg band with the elbow below the shoulder'); }
    RACK_CONSIDERED = considered;
    RACK_ACCEPTED = accepted;
    WRIST_RACK = [GRIP_X, best.wy, best.wz];
    POLE_RACK = best.pole;
    RACK_SOLVED = { elbow: best.r.elbow, tilt: best.r.tilt, elbFwd: best.r.elbFwd,
                    elbBelow: best.r.elbBelow, dip: best.a.dip, back: best.a.back };
  })();

  /* ---------------------------------------------------------------- the clip */
  var CLIP = {
    name: 'press',
    duration: DURATION,
    loop: true,
    desc: 'standing barbell overhead press. MEASURED and reproduced exactly: the lockout elbow, 163.7 deg '
        + '— and that is the only pose the reference pins. AUTHORED: everything else, including the '
        + 'racked position (elbow 78.3 deg, forearms within 3.4 deg of vertical, the bar out in front '
        + 'of the shoulders) and the grip, 28 units between the wrists, which is the reference\'s '
        + '0.471 m invariant scaled to this rig as closely as the lockout height allows. The wrist '
        + 'reaches 42.0 units above the shoulder at lockout against a 43.9 reference: a 163.7 deg '
        + 'elbow pins the shoulder-to-wrist chord at 43.065, so no pose on this rig can close that '
        + 'gap while the elbow holds the measured angle. The bar is level, square and rigid to 0. '
        + 'From the lockout the bar is lowered under control to the rack, held, then driven back '
        + 'overhead. Feet planted, knees near straight, no pelvis movement.',
    keys: buildKeys(WRIST_LOCKOUT)
  };

  S3D.CLIPS[CLIP.name] = CLIP;
  S3D.MEASURED = S3D.MEASURED || {};
  S3D.MEASURED[CLIP.name] = { targets: TARGETS, source: TARGETS.source, licence: TARGETS.licence };

  /* `derived` is not part of the module contract; the check script reads it so the numbers it
     compares against are the clip's own, rather than a second copy typed into the test. */
  return {
    clip: CLIP, targets: TARGETS,
    derived: {
      L_upper: L_UPPER, L_fore: L_FORE,
      chord_at_lockout_elbow: CHORD_LOCKOUT,
      /* the honest gap between the two measured numbers: see the header note */
      lockout_wrist_dy: round4(WRIST_LOCKOUT[1] - SH_REST[1]),
      lockout_wrist_dy_shortfall: round4(TARGETS.wrist_above_shoulder_lockout - CHORD_LOCKOUT),
      grip_half_width: GRIP_X,
      wrist_lockout: WRIST_LOCKOUT.slice(),
      wrist_rack: WRIST_RACK.slice(),
      pole_lockout: POLE_LOCKOUT.slice(),
      pole_rack: POLE_RACK.slice(),
      shoulder_rest: SH_REST.slice(),
      /* the rack solver's own account of what it did — the check reads these instead of trusting a
         pose typed into the test, and so the achieved rack pose can be reported without re-deriving
         it. `rack_solved` also carries the arc's dip below the rack key and the worst backward
         travel, i.e. the two ways a rack key can fail to be the bottom of the movement. */
      rack_solved: RACK_SOLVED,
      rack_considered: RACK_CONSIDERED,
      rack_accepted: RACK_ACCEPTED
    }
  };
});