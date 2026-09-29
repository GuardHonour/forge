/* _s3d_props.js — equipment for the in-app 3D technique view.

   WHAT WAS ACTUALLY BEING RENDERED BEFORE THIS FILE
   Nothing. Verified rather than assumed: _s3d_core.js contains no barbell, dumbbell, plate or seat
   geometry of any kind (its only mesh builders are buildSkeleton/buildSDFMesh — the body),
   _s3d_view.html draws exactly three things (a floor grid, the figure, and an optional skeleton
   overlay), and _blender_anim.py creates a single primitive in its whole length — a floor plane.
   The equipment existed only as MATHEMATICS: the press clips enforce a "BARBELL INVARIANT" that
   holds the two hands a rigid, unchanging distance apart as if gripping a bar. The bar's effect was
   in the motion; the bar was never modelled. Two of the four measured clips are seated, so without
   a seat they render as a figure floating ~31 cm above the floor.

   WHAT THIS ADDS, AND WHY IT IS SHAPED THIS WAY
   - A barbell for the two barbell lifts, and a seat (+ back pad for the machine press) for the two
     seated ones. Scoped deliberately: enough to make each movement legible and to ground the seated
     poses, not full machine frames with weight stacks.
   - The barbell is built ONCE at real dimensions in metres and is then only ROTATED and TRANSLATED
     into the grip. It is never scaled. Two reasons: a real bar is rigid, which is exactly the
     invariant the clips already enforce, so the hands sit on a bar that cannot stretch to follow
     them; and a matrix carrying no scale leaves the surface normals correct, whereas a unit cylinder
     stretched to length would light wrongly along its barrel and its plates.
   - Every dimension here is AUTHORED, not measured. Nothing in this file came from the reference
     video, and none of it may be presented as measurement. It is real equipment sizing (a standard
     220 cm Olympic bar, a 45 cm plate) converted into this engine's units.

   THE UNIT SCALE IS DERIVED, NOT TYPED
   FORGE's BONE table is "scaled from a 180 cm athlete" (see AGENTS.md), so the metre scale follows
   from the skeleton itself: take the top of the head in engine units and divide by 1.80 m. That
   makes every dimension below a real length in metres rather than a magic number, and it keeps the
   equipment in proportion if the rig is ever rescaled.
*/
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./_s3d_core.js'));
  else root.S3D_PROPS = factory(root.S3D);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S3D) {
  'use strict';

  /* ---------------------------------------------------------------- real dimensions, in metres */
  var BAR_M = {
    shaft_half_len: 1.10,      /* a standard Olympic bar is 2.20 m overall */
    shaft_radius: 0.014,       /* 28 mm shaft diameter */
    plate_radius: 0.225,       /* a 450 mm bumper plate */
    plate_thickness: 0.030,
    plate_centre: 0.62,        /* where the loaded plates sit on the sleeve */
    collar_radius: 0.025
  };
  var SEAT_M = {
    width: 0.30, depth: 0.34, thickness: 0.06,
    back_thickness: 0.06, back_height: 0.30,
    /* How far the seat surface sits BELOW the pelvis JOINT, and how far BACK the pad sits from it.

       BOTH WERE WRONG AT FIRST, and a render is what said so, not a number. With the original values
       (0.055 m and 0.10 m) the seat slab's top landed at y=35.55 while the thigh mesh has a radius of
       about 6.9 units around the hip joint at y=39.3 -- so the seat was INSIDE the thighs and showed
       only as a thin lip under the buttocks. The back pad's front face sat at z=-8.9 while the
       torso's own back surface is at z=-12, so the pad was INSIDE the torso and effectively invisible.
       Both clips were rendered and inspected to establish this.

       The values are authored, but derived from anatomy rather than invented: the femoral head when
       seated is roughly 0.53 m above the floor and a seat surface roughly 0.44 m, so the joint sits
       about 0.09-0.12 m above the seat -- and the thigh's own thickness has to clear it on top of
       that. The pad's front face is placed just BEHIND the torso surface (about 12.6 units back on
       the default rig) so it touches the back rather than intersecting it. */
    pelvis_drop: 0.115,
    back_lean: 0.185
  };

  /* which equipment each measured clip uses. Keyed by CLIP name, not exercise id, so the mapping
     lives in one place: _s3d_app.js maps exercise -> clip, and this maps clip -> equipment. */
  var RIG_FOR_CLIP = {
    squat:        { bar: true,  seat: false, back: false },
    press:        { bar: true,  seat: false, back: false },
    legext:       { bar: false, seat: true,  back: true  },
    machinepress: { bar: false, seat: true,  back: true  }
  };

  /* ------------------------------------------------------------------ unit scale from the rig */
  function unitsPerMetre(ch) {
    var sk = ch.sk, top = 0;
    sk.boneNames.forEach(function (j) { if (sk.rest[j][1] > top) top = sk.rest[j][1]; });
    /* `top` is the topmost JOINT (the head joint), not the top of the skull, so add the head bone —
       which is authored as a length in BONE, not a joint offset. */
    top += (S3D.BONE && S3D.BONE.head) || 0;
    if (!(top > 0)) throw new Error('cannot derive the unit scale: no joint above y=0');
    return top / 1.80;
  }

  /* ------------------------------------------------------------------ tiny geometry kit
     Output matches packGeometry()'s format exactly — pos/nrm as Float32Array, bi/bw as Float32Array
     with four influences per vertex, idx as Uint32Array — so the props go through the SAME shader
     and skinning path as the body.

     Every prop vertex is bound to bone slot 0 with weight 1 as a PLACEHOLDER, and that placeholder
     must not be taken literally. Slot 0 holds the body's hips matrix and is re-copied from the skin
     data every frame, so a prop left pointing at it would ride the BODY instead of its own matrix.
     The renderer therefore REWRITES this single influence to the prop's own spare slot when it first
     builds that prop's vertex buffer — the renderer is the one place that knows which slot the prop
     was given. Weight 1 on a single matrix is also what keeps a rigid bar rigid. */
  function merge(parts) {
    var pos = [], nrm = [], idx = [], base = 0;
    parts.forEach(function (p) {
      for (var i = 0; i < p.pos.length; i++) pos.push(p.pos[i]);
      for (var j = 0; j < p.nrm.length; j++) nrm.push(p.nrm[j]);
      for (var k = 0; k < p.idx.length; k++) idx.push(p.idx[k] + base);
      base += p.pos.length / 3;
    });
    var n = pos.length / 3;
    var bi = new Float32Array(n * 4), bw = new Float32Array(n * 4);
    for (var v = 0; v < n; v++) { bi[v * 4] = 0; bw[v * 4] = 1; }
    return {
      pos: new Float32Array(pos), nrm: new Float32Array(nrm),
      bi: bi, bw: bw, idx: new Uint32Array(idx)
    };
  }

  /* A cylinder whose axis is +X, spanning [-halfLen, +halfLen], radius r, centred at cx. */
  function cylX(cx, halfLen, r, segs, parts) {
    var pos = [], nrm = [], idx = [], ring = [];
    segs = segs || 14;
    for (var i = 0; i < segs; i++) {
      var a = i / segs * Math.PI * 2, cy = Math.cos(a), cz = Math.sin(a);
      ring.push([cy, cz]);
    }
    /* side wall */
    var start = pos.length / 3;
    ring.forEach(function (u) {
      pos.push(cx - halfLen, u[0] * r, u[1] * r); nrm.push(0, u[0], u[1]);
      pos.push(cx + halfLen, u[0] * r, u[1] * r); nrm.push(0, u[0], u[1]);
    });
    for (var s = 0; s < segs; s++) {
      var a0 = start + s * 2, b0 = start + ((s + 1) % segs) * 2;
      idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
    /* end caps, with their own flat normals */
    [-1, 1].forEach(function (dirSign) {
      var c0 = pos.length / 3, cy = cx + dirSign * halfLen;
      pos.push(cy, 0, 0); nrm.push(dirSign, 0, 0);
      ring.forEach(function (u) { pos.push(cy, u[0] * r, u[1] * r); nrm.push(dirSign, 0, 0); });
      for (var t = 0; t < segs; t++) {
        var p1 = c0 + 1 + t, p2 = c0 + 1 + ((t + 1) % segs);
        if (dirSign > 0) idx.push(c0, p1, p2); else idx.push(c0, p2, p1);
      }
    });
    parts.push({ pos: pos, nrm: nrm, idx: idx });
  }

  /* An axis-aligned box. half = [hx, hy, hz], centre c. */
  function box(c, half, parts) {
    var F = [
      [[+1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
      [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
      [[0, +1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
      [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
      [[0, 0, +1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
      [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]
    ];
    var pos = [], nrm = [], idx = [], base = pos.length / 3;
    F.forEach(function (f) {
      var n = f[0], v = f[1], s = pos.length / 3;
      v.forEach(function (q) {
        pos.push(c[0] + q[0] * half[0], c[1] + q[1] * half[1], c[2] + q[2] * half[2]);
        nrm.push(n[0], n[1], n[2]);
      });
      idx.push(s, s + 1, s + 2, s, s + 2, s + 3);
    });
    parts.push({ pos: pos, nrm: nrm, idx: idx });
  }

  /* ------------------------------------------------------------------ the two props */
  function buildBar(scale) {
    var parts = [];
    cylX(0, BAR_M.shaft_half_len * scale, BAR_M.shaft_radius * scale, 16, parts);
    [-1, 1].forEach(function (s) {
      cylX(s * BAR_M.plate_centre * scale, BAR_M.plate_thickness * scale / 2,
           BAR_M.plate_radius * scale, 20, parts);
      cylX(s * (BAR_M.plate_centre + 0.09) * scale, 0.02 * scale,
           BAR_M.collar_radius * scale, 10, parts);
    });
    return merge(parts);
  }

  function buildSeat(scale) {
    var parts = [], S = SEAT_M;
    /* Built centred at the origin with its TOP face on y=0, so placing it is a pure translation to
       the seat surface rather than a translation plus a half-thickness correction. */
    box([0, -S.thickness * scale / 2, 0],
        [S.width * scale / 2, S.thickness * scale / 2, S.depth * scale / 2], parts);
    return merge(parts);
  }

  function buildBack(scale) {
    var parts = [], S = SEAT_M;
    box([0, S.back_height * scale / 2, -S.back_lean * scale - S.back_thickness * scale / 2],
        [S.width * scale / 2, S.back_height * scale / 2, S.back_thickness * scale / 2], parts);
    return merge(parts);
  }

  /* ------------------------------------------------------------------ per-frame placement */
  function orthoBasis(axis) {
    /* A cylinder and a disc are radially symmetric, so any perpendicular pair will do. */
    var a = S3D.norm(axis);
    var ref = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    var b = S3D.norm(S3D.cross(a, ref));
    var c = S3D.norm(S3D.cross(a, b));
    return [a, b, c];
  }

  /* Column-major 4x4 with the given basis columns and translation — the convention fk() uses
     (worldM[12..14] is the translation). No scale, deliberately: see the header. */
  function basisMatrix(x, y, z, t) {
    return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, t[0], t[1], t[2], 1];
  }

  return {
    BAR_M: BAR_M, SEAT_M: SEAT_M, RIG_FOR_CLIP: RIG_FOR_CLIP,
    unitsPerMetre: unitsPerMetre,

    /* Build every prop once per character. */
    build: function (ch) {
      var sc = unitsPerMetre(ch);
      return {
        scale: sc,
        bar: buildBar(sc),
        seat: buildSeat(sc),
        back: buildBack(sc),
        /* Where the seat surface goes, per clip, filled lazily by seatYFor(). */
        _seatY: {}
      };
    },

    /* The seat surface height for a clip: derived from the LOWEST the pelvis reaches during that
       clip, not typed in, so a reseated or reauthored clip moves its own seat with it. Cached
       because it needs a full scan of the clip. */
    seatYFor: function (G, ch, clipName, sample) {
      if (G._seatY[clipName] !== undefined) return G._seatY[clipName];
      var lo = Infinity, dur = (S3D.CLIPS[clipName] || {}).duration || 0;
      for (var i = 0; i <= 24; i++) {
        var ev = sample(ch, clipName, dur * i / 24);
        var y = ev.fk.p.hips[1];
        if (y < lo) lo = y;
      }
      G._seatY[clipName] = lo - SEAT_M.pelvis_drop * G.scale;
      return G._seatY[clipName];
    },

    /* What to draw at this instant, as [{geo, matrix}]. The renderer gives each entry one spare bone
       slot, so a prop costs one draw call and no new shader. */
    frame: function (G, ch, S3Dref, ev, clipName, sample) {
      var rig = RIG_FOR_CLIP[clipName];
      if (!rig) return [];
      var out = [];
      if (rig.bar) {
        /* The bar is RIGID and lies along the line between the wrists, centred between them. Its
           length is not derived from the grip: a real bar does not stretch to follow the hands, and
           the clips already hold the hands at a constant spacing, so the hands land on the bar where
           they land. */
        var a = ev.fk.p.wrL, b = ev.fk.p.wrR;
        var mid = S3Dref.mul(S3Dref.add(a, b), 0.5);
        var axis = S3Dref.sub(b, a);
        if (S3Dref.len(axis) < 1e-6) return [];
        var B = orthoBasis(axis);
        out.push({ geo: G.bar, matrix: basisMatrix(B[0], B[1], B[2], mid) });
      }
      if (rig.seat) {
        var y = this.seatYFor(G, ch, clipName, sample);
        /* Under the pelvis, centred between the hip joints, facing the way the figure faces (+Z). */
        var hx = (ev.fk.p.hipL[0] + ev.fk.p.hipR[0]) / 2;
        var hz = (ev.fk.p.hipL[2] + ev.fk.p.hipR[2]) / 2;
        out.push({ geo: G.seat, matrix: basisMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [hx, y, hz]) });
      }
      if (rig.back) {
        var yb = this.seatYFor(G, ch, clipName, sample);
        var bx = (ev.fk.p.hipL[0] + ev.fk.p.hipR[0]) / 2;
        var bz = (ev.fk.p.hipL[2] + ev.fk.p.hipR[2]) / 2;
        out.push({ geo: G.back, matrix: basisMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [bx, yb, bz]) });
      }
      return out;
    }
  };
});
