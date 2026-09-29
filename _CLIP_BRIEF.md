# Brief: authoring ONE measured S3D technique clip

You are authoring **one** exercise clip for FORGE's 3D technique view. Read this whole brief first.
Then **write your file immediately** with a rough-but-valid clip, verify it, and iterate. An agent on
this task already failed by exploring for 30 minutes without writing anything — a rough file that
loads beats a perfect plan. Do not read the whole engine unless you need to.

## What you deliver

Exactly one file, named in your task prompt (e.g. `_s3d_clip_squat.js`). Nothing else. Do not modify
any other file — especially not `index.html`, `_s3d_core.js`, `_s3d_render.js`, `_s3d_app.js`,
`sw.js`, or any test suite. Another agent owns each of those.

## The module contract (follow exactly)

```js
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./_s3d_core.js'));
  else root.S3D_CLIP_<NAME> = factory(root.S3D);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S3D) {
  'use strict';
  var TARGETS = { /* the measured numbers you were given, verbatim, with source + licence */ };
  var CLIP = { name:'<name>', duration:3.14, loop:true, desc:'...', keys:[ /* ... */ ] };
  S3D.CLIPS[CLIP.name] = CLIP;
  S3D.MEASURED = S3D.MEASURED || {};
  S3D.MEASURED[CLIP.name] = { targets: TARGETS, source: '...', licence: '...' };
  return { clip: CLIP, targets: TARGETS };
});
```

`window.S3D.CLIPS` and `window.S3D.MEASURED` are what the app reads. `S3D.MEASURED` is how the app
prints its provenance line, so `source` and `licence` must be **true strings you were given**, never
invented. Do not fabricate an attribution — a fabricated one is worse than none.

## The engine, in the minimum you need

- Axes: right-handed, **Y up, X right, Z toward the viewer**. The figure stands on y=0 and **faces +Z**.
- Joint positions for a posed frame come from `S3D.sample(ch, clipName, t)` → `ev`. **`ev.fk.p[joint]`
  is the posed WORLD POSITION of that joint** — `[x, y, z]`. Always compute angles from these
  positions, never from the rotations you authored: the rotations are the input, the angles are the
  thing being measured, and only the second one is comparable to the reference data.
- Joint names are **per side**: `hips, spine, chest, neck, head`, and per side `sh`/`elb`/`wr`/`hand`,
  `hip`/`knee`/`ankle`/`toe` with an `L` or `R` suffix (e.g. `shL`, `elbL`, `wrL`, `hipL`, `kneeL`,
  `ankleL`, `toeL`). `sh` is the shoulder, `elb` the elbow, `wr` the wrist.
- **Interior angle convention — this is the one thing to get right.** Angles are the interior angle
  AT the joint, where **180° = fully straight**:
  - knee = angle at `kneeL` between (`kneeL`→`hipL`) and (`kneeL`→`ankleL`)
  - elbow = angle at `elbL` between (`elbL`→`shL`) and (`elbL`→`wrL`)
  - hip = angle at `hipL` between (`hipL`→`chest`) and (`hipL`→`kneeL`)
  Compute with `acos(dot(u,v)/(|u||v|))` in degrees, using `S3D.sub` and `S3D.len`.
- The rest pose is an **A-pose with 42° shoulder abduction**, and clip rotations are authored
  RELATIVE to rest. So `qA([1,0,0], d)` rotates about world X by `d` degrees on top of rest.
- Helpers: `S3D.qA([axis], degrees)` → quaternion; `S3D.both({shL:q, elbL:q})` mirrors every `L` key
  onto `R` (use it for symmetric poses — hand-writing both sides is how a clip ends up visibly
  lopsided); `S3D.qSlerp`, `S3D.qMul`, `S3D.qId`.
- Clip format:
  ```js
  { name, duration, loop:true, desc, keys:[ { t, p:{joint:quat}, root:[x,y,z],
      ik:{ legL:{ t:[x,y,z], pole:[x,y,z], level:'toeL' } } } ] }
  ```
  `root` is the translation of the whole figure (its `y` is how the body lowers). `ev` also exposes
  `ev.root`. `p` holds joint rotations; `ik` holds two-bone IK targets — `ikTwoBone` works on **any**
  chain, including the arms: `S3D.CHAINS` is `{armL:['shL','elbL','wrL'], armR:[...], legL:[...], legR:[...]}`.
  IK is how you make a hand or foot land on a specific point; prefer it over hand-solving angles.
- Between keys the engine interpolates with **smoothstep**. So DO NOT put a key at every frame —
  put keys at the extremes and let it interpolate.

## Tempo: your keys must sit at exactly these times

The app's own 2D engine runs a four-phase tempo of 1500 / 320 / 1000 / 320 ms (`CYCLE` = 3140 ms) and
its HUD names the phase from the clock. The 3D clip must use `duration: 3.14` with keys at **exactly**

| t | phase | what the body is doing |
|---|---|---|
| 0    | start | **home** |
| 1.5  | end of phase 1 | **away** |
| 1.82 | end of phase 2 | **away** (hold) |
| 2.82 | end of phase 3 | **home** |
| 3.14 | end of phase 4 | **home** (hold) |

If your keys do not sit exactly there, the HUD will name the wrong phase and the 3D view will
contradict the 2D one. This is not cosmetic: the app derives the phase label from the clock, so a
clip on a different tempo is a lie shown to the user.

**`home` is ALWAYS the shortened-muscle position and `away` ALWAYS the lengthened one**, so phase 1 is
always the controlled lowering. Your task prompt tells you which extreme is which for your movement.
Getting this backwards inverts the entire animation — the figure would drive up and lower down.

## Verification you must run and report (non-negotiable)

Write a check script `_check_clip_<name>.cjs` and run it. Report the raw output.

1. **Loads in node**: `require('./_s3d_clip_<name>.js')` works and `S3D.CLIPS['<name>']` exists.
2. **Keys sit at the required times**, within 1e-9.
3. **The measured extremes are reproduced.** Sample the clip at the key times and compute the
   interior angles from `ev.fk.p`. Print measured vs target and the delta for **every** number you
   were given. Tolerance: **±2°** on angles. If you cannot hit it, say so explicitly with the actual
   number — do not quietly widen the tolerance, and do not edit the target to match the clip.
4. **Smooth motion**: sample ~60 frames and assert no NaN, no frame-to-frame jump in a joint angle
   larger than ~15°, and that the angle arc is monotonic within each phase. A clip that teleports
   between poses looks fine in a table and terrible on screen.
5. **NEGATIVE CONTROL — required.** Demonstrate that your check can actually fail: perturb one
   authored quaternion (or the target) and show the check reporting FAIL. A check that cannot fail
   proves nothing, and on this task a wrong clip looks exactly like a right one in a numeric table.
6. **Render it and LOOK AT IT.** You cannot trust the numbers alone. Render frames and inspect the
   image with the `read_image` tool (there are existing examples — `_s3d_shot.cjs` drives
   `_s3d_view.html` in headless Chrome; `_s3d_view.html` supports `?clips=`/`?mode=filmstrip`).
   Confirm the figure is in a plausible human pose at the extremes — feet on the floor, knees bending
   the right way, no limb passing through the body. Report what you actually saw. If a render looks
   wrong but the numbers pass, **the render is right and the check is incomplete** — say so.

## Honesty requirements

- Anything not measured from the reference is **AUTHORED**. Say which parts are which, in a comment
  and in your report. Do not present an authored pose as measured.
- If you cannot reach a target within tolerance, report the real number and the reason. Never
  restate a target to match your output.
- Do not claim a render looks correct unless you actually opened the image.
