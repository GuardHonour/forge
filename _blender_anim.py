"""_blender_anim.py — keyframed rep cycles on the fitted rig, audited numerically, plus a
motion filmstrip.

Why this file computes its own forward kinematics instead of setting pose_bone.matrix:

Setting pose_bone.matrix is correct but needs a depsgraph update per bone to see the
parent's new pose, and each update re-evaluates the armature modifier over 10,582
vertices. At ~2,500 updates per clip the first version of this script exceeded a 10 minute
cap. The fix is to stop asking Blender and do the arithmetic directly:

    pose_matrix[bone] = pose_matrix[parent] @ (parent.matrix_local^-1 @ bone.matrix_local) @ basis

Rotating about world axis w therefore means a basis rotation about W^-1 @ w, where W is
the bone's orientation with the parent already posed -- which is exactly why converting a
world axis through the bone's REST matrix is wrong for children. Basis quaternions are
written straight into rotation_quaternion, and my FK is then CHECKED against Blender's own
pose evaluation, so speed does not cost correctness.

Other decisions:
* TEMPO COMES FROM THE APP. FORGE uses one four-phase tempo for all 48 exercises:
  eccentric 1500 ms, hold 320, concentric 1000, hold 320 (CYCLE 3140 ms). Same here, at
  FPS 40, so Blender motion is directly comparable with the shipped 2D rigs and S3D.
* THE FEET STAY PLANTED BY CONSTRUCTION, then that is measured rather than assumed: after
  posing the legs the root is translated until the ankle returns to its rest height.
* A FILMSTRIP, NOT A GIF. GIFs arrive flattened to one static frame over a chat channel.
  One row per clip, one column per point in the rep, drawn from the same interpolation the
  GLB is baked from, so the sheet and the export cannot disagree.

Run:
  blender.exe --background --factory-startup --python _blender_anim.py -- <rigged.blend> <sheet.png> [cols]
"""
import bpy, sys, os, math, time, json
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
rigged, out = argv[0], argv[1]
cols = int(argv[2]) if len(argv) > 2 else 9

FPS = 40
TEMPO = [('ecc', 1500), ('hold', 320), ('con', 1000), ('hold', 320)]
CYCLE = sum(d for _, d in TEMPO)
FRAMES = int(round(CYCLE / 1000.0 * FPS))

ORDER = ['spine', 'spine.001', 'spine.002', 'spine.003',
         'shoulder.L', 'upper_arm.L', 'forearm.L', 'hand.L',
         'shoulder.R', 'upper_arm.R', 'forearm.R', 'hand.R',
         'thigh.L', 'shin.L', 'foot.L', 'toe.L',
         'thigh.R', 'shin.R', 'foot.R', 'toe.R']
AX = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}

# Signs measured, not guessed: arms hang at (0.42,-0.18,-0.89), toes point to -Y, so the
# figure faces -Y. Horizontal arm -65 about Y; overhead -155; hip flexion negative about X;
# knee flexion positive about X.
SQUAT_TOP = {'shin.L': {'X': -23}, 'shin.R': {'X': -23}}   # see note below
# KNOWN SHORTFALL, left failing on purpose rather than tuned until it passed: this rig reaches at
# best ~166 deg of knee extension (measured here 165.8), against the reference's 176.8, so the
# squat's TOP is about 11 deg short and knee travel reads 100.4 deg against 110.2.
#
# Two measured causes, both worth keeping:
#  * The rig's REST pose is not straight-legged -- it carries ~28 deg of knee flexion, so a shin
#    value is a rotation FROM that bent rest, not an absolute knee angle. Assuming otherwise put
#    the bottom knee at 44.4 deg (22 deg too deep) when the same shin value that reads correctly
#    once the offset is accounted for gives 65.4.
#  * The response is NON-MONOTONIC: shin -23 yields a 165.8 deg knee and shin -41 yields 158.4,
#    because the angle between two bone directions varies sinusoidally with the rotation rather
#    than linearly, and the shin's flexion axis is not perpendicular to its own bone. So no value
#    of a pure X rotation fully straightens this leg; closing it needs a rotation about the true
#    perpendicular-to-bone knee axis instead of the world X axis.
# Bottom position DRIVEN BY MEASUREMENT, not authored. Reference: "Squat - exercise demonstration
# video.webm", CC BY 3.0, artist FitnessScape, via Wikimedia Commons -- 1280x720, 7.1 s. The clip
# is a REAR 3/4 view, established by the nose-depth test (nose 0.084 m FARTHER from the camera
# than the shoulders); the shoulder-line ratio called it FRONT at 0.99, which is indistinguishable
# from a true front view at 0.94 and would have wrongly marked fore/aft untrustworthy -- the axis
# a squat lives on.
#
# Measured extremes across the clip:
#   knee  176.8 deg standing -> 66.7 deg at the bottom  (110 deg of flexion)
#   hip   172.7 deg -> 70.4 deg
#   thigh 82 deg of rotation from vertical
#   hips descend 0.567 m measured against the ankles
#
# The authored values were thigh -62 / shin 78: only 62 deg of thigh rotation and a 102 deg knee,
# so the squat was about a third too shallow -- which is exactly how it read in the filmstrip.
#
# The rig's REST pose already has ~23 deg of knee flexion, so a shin value is a rotation FROM that
# bent rest, not an absolute knee angle. Setting shin 113 for a 67 deg knee produced 44.4 deg --
# the rest flexion counted twice. These values are therefore stated relative to rest: shin -23
# straightens the leg at the top, and (113.3 - 22.6) reaches the measured bottom knee.
SQUAT_BOTTOM = {
    'spine.001': {'X': 10}, 'spine.002': {'X': 8},
    'thigh.L': {'X': -82}, 'thigh.R': {'X': -82},
    'shin.L': {'X': 91}, 'shin.R': {'X': 91},
    'foot.L': {'X': -9}, 'foot.R': {'X': -9},     # keeps the sole flat: -(91 - 82)
    'upper_arm.L': {'X': -55}, 'upper_arm.R': {'X': -55},
}
SQUAT_TARGETS = {'bottom_knee_deg': 66.7, 'top_knee_deg': 176.8,
                 'thigh_flexion_deg': 82.0, 'hip_drop_m': 0.567}
# ---- PRESS: driven by WRIST TARGETS + two-link IK -----------------------------
# Three attempts got here, and each failure is why the final form looks like this:
#
#  1. Authored Euler angles ('Y': -155 for the lockout) rotated about the abduction axis, so the
#     arm swung out to the side like a lateral raise. Anything authored by picking an axis and a
#     number can silently pick the wrong plane.
#  2. Measured DIRECTIONS fixed the plane exactly (mechanism error 0.00 deg) and reproduced the
#     elbow angles exactly, but a direction carries no position. The reference's landmarks are
#     ~25% undersized, so the same direction on this rig's longer arms threw the hands 0.196 m
#     behind the shoulder, and rotating the arm to correct the grip width swung the racked hands
#     0.361 m behind the body -- a behind-the-neck press.
#  3. WRIST TARGETS + IK, which is how the app's own 2D engine authors every one of the 48 demos
#     ("poses are authored as limb targets, not joint angles"). A target constrains the position
#     in every axis at once, so it cannot be right in the plane and wrong in fore/aft.
#
# What the reference still supplies, because it measures these well and the app does not state
# them: the LOCKOUT elbow angle (163.7 deg, scale-free) and the lockout wrist height (measured
# +0.401 m as a ratio of the reference's own upper arm, re-expanded on this rig = +0.528 m).
#
# What the app's cue supplies, because the reference's technique differs: the RACK. Its lifter
# racks with the elbows flared ~45 deg from the body (a wide military press); the cue says "Bar on
# the front delts, hands just outside the shoulders, elbows under it". Those are not compatible:
# at an 82 deg elbow, hands at the shoulders force the wrist ~0.35 m either forward or BEHIND the
# shoulder. A front rack is a tightly folded arm, and the IK derives that rather than assuming it.
PRESS_SPINE_LOCKOUT = {'spine.002': {'X': -3}}
PRESS_SPINE_RACKED = {'spine.002': {'X': 3}}
PRESS_LOCKOUT = dict(PRESS_SPINE_LOCKOUT)     # arms filled in below, once FK exists
PRESS_RACKED = dict(PRESS_SPINE_RACKED)

# Wrist targets as offsets from the shoulder joint, in rig axes (+x = the .L side, -y = forward).
# The lateral offset is IDENTICAL for both poses because a barbell is rigid: the hands cannot
# drift from 0.31 m to 1.09 m apart during a rep, which is what driving directions produced.
PRESS_GRIP_OUT_M = 0.040      # "just outside the shoulders" -- this rig's shoulder joints are 0.195
PRESS_TARGETS = {
    # Height chosen so the IK lands the elbow on the MEASURED 163.7 deg, which is the scale-free
    # quantity. The rig's forearm/upper-arm ratio (0.262/0.289 = 0.908) differs from the
    # reference's (0.211/0.219 = 0.963), so height and elbow angle cannot BOTH be matched on one
    # body: at the scale-corrected height of 0.529 m the elbow comes out 150.2 deg. The angle
    # wins because it is measured directly and is scale-free, while the height passed through a
    # 1.32x correction for landmarks that are 25% undersized. They end up 12 mm apart.
    'lockout': {'wrist': (PRESS_GRIP_OUT_M, +0.060, +0.541), 'elbow_deg': 163.7,
                'source': 'measured elbow angle; height set to satisfy it (0.541 vs 0.529 scaled)'},
    'racked': {'wrist': (PRESS_GRIP_OUT_M, -0.120, +0.000), 'elbow_deg': None,
               'source': "app cue: bar on the front delts at shoulder height, hands just outside"},
}
# The scale at which the reference's landmark geometry is reported, for the note printed below.
# MediaPipe's world landmarks come out ~25% undersized (upper arm 0.219 m vs ~0.30 real), so an
# absolute displacement from that source is not a length -- it is a length times an unknown
# scale. Angles are unaffected (uniform scale cancels inside an angle) but a height is a
# distance, which is why the lockout height above was converted through this ratio BEFORE being
# used as a target, rather than taken as 0.401 m on a body of different proportions.
REF_UPPER_ARM_M = 0.219

# Declared here and FILLED later, by mutation, exactly as SQUAT_TOP/SQUAT_BOTTOM are. CLIPS below
# holds a reference to these dicts, so rebinding the name later (LEGEXT_SEATED = {...}) would leave
# CLIPS pointing at the empty dict it captured -- which is a NameError if the name is not yet bound
# and a silently empty pose if it is.
LEGEXT_SEATED = {}
LEGEXT_EXTENDED = {}
MACHPRESS_FLEXED = {}
MACHPRESS_EXTENDED = {}

CLIPS = [
    ('squat', {'top': SQUAT_TOP, 'bottom': SQUAT_BOTTOM}, ('spine', 'foot.L'),
     ['top', 'bottom', 'bottom', 'top', 'top']),
    ('press', {'overhead': PRESS_LOCKOUT, 'racked': PRESS_RACKED}, None,
     ['overhead', 'racked', 'racked', 'overhead', 'overhead']),
    # Home is the shortened-muscle position (the app's own convention), so the extended knee leads.
    ('legext', {'extended': LEGEXT_EXTENDED, 'seated': LEGEXT_SEATED}, None,
     ['extended', 'seated', 'seated', 'extended', 'extended']),
    # Same convention: a chest press is shortest at the elbow with the handles at the chest, so the
    # EXTENDED arms are home.
    ('machinepress', {'extended': MACHPRESS_EXTENDED, 'flexed': MACHPRESS_FLEXED}, None,
     ['extended', 'flexed', 'flexed', 'extended', 'extended']),
]
# Clips whose feet are NOT planted. A seated leg extension legitimately moves the feet: the shin
# swings, so foot travel and stance drift are expected rather than defects. The standing clips have
# their ankles pinned by the root fix and must not slide. Checked by name so the distinction is
# explicit at the point of use instead of being inferred and silently wrong.
FEET_NOT_PLANTED = {'legext', 'machinepress'}

bpy.ops.wm.open_mainfile(filepath=rigged)
sc = bpy.context.scene
sc.render.fps = FPS
body = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('GEO-body')][0]
meta = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
print('LOADED %s + %s (%d bones) fps=%d cycle=%dms frames=%d'
      % (body.name, meta.name, len(meta.data.bones), FPS, CYCLE, FRAMES))

# ---- rest topology, parents first ------------------------------------------
TOPO, REST_REL = [], {}
def walk(b):
    TOPO.append(b.name)
    REST_REL[b.name] = (b.parent.matrix_local.inverted() @ b.matrix_local) if b.parent else b.matrix_local.copy()
    for c in b.children:
        walk(c)
for b in meta.data.bones:
    if b.parent is None:
        walk(b)

def basis_quat(pose, bone_name, W):
    """accumulate this bone's basis rotation, each axis converted through the CURRENT
    orientation (so successive axes on one bone compose correctly)

    Supports an arbitrary world axis as {'axis': (x, y, z), 'deg': n} alongside the named X/Y/Z
    shorthand. That exists because of a measured failure, not for generality's sake: rotating the
    shin about world X to straighten a knee gains only ~0.6 deg of knee angle per degree applied,
    and the response is NON-MONOTONIC (-23 deg gave a 165.8 deg knee while -41 gave 158.4), so no
    value of an X rotation could reach the reference's 176.8 deg. The reason is that the angle
    between two bone directions varies sinusoidally, and the shin's axis is not perpendicular to
    its own bone. Turning about the true knee axis -- perpendicular to both bones -- makes the
    applied degrees and the joint angle the same thing.
    """
    spec = pose.get(bone_name, {})
    ops = []
    for k, v in spec.items():
        if k in ('deg', 'dir', 'base'):
            continue
        if k == 'axis':
            ops.append((Vector(v).normalized(), float(spec.get('deg', 0.0)), 'A', False))
        elif k == 'axis_from':
            # An axis that must FOLLOW its parent joint through the rep. Freezing it at one extreme
            # turns the limb about the wrong line mid-rep: the squat's right foot slid 0.5150 m and
            # the stance width changed by 0.6207 m, even though both endpoint poses were exactly
            # symmetric (mirror error 0.000000). That contrast is what located the fault in the
            # interpolation rather than the poses.
            pbone, pax = v
            base = Vector(spec['base']).normalized()
            ang = float(pose.get(pbone, {}).get(pax, 0.0))
            ops.append(((Matrix.Rotation(math.radians(ang), 3, 'X') @ base).normalized(),
                        float(spec.get('deg', 0.0)), 'A', False))
        elif k.endswith('_local'):
            # A rotation about the bone's OWN local axis, with NO world-space conversion. This is
            # the axis a rig is actually built around, and it is the only form that keeps a knee
            # turning in the plane it was rigged in -- see the squat block below.
            ops.append((AX[k[0]], float(v), k, True))
        else:
            ops.append((AX[k], float(v), k, False))
    q = Quaternion()
    for vec, deg, _key, _loc in sorted(ops, key=lambda o: o[2]):
        if _loc:
            q = Quaternion(vec, math.radians(deg)) @ q
            continue
        cur = (W @ q.to_matrix().to_4x4()).to_3x3()
        a = (cur.inverted() @ vec).normalized()
        q = Quaternion(a, math.radians(deg)) @ q
    return q

def fk(pose, root_local=None):
    """pure-math FK: returns (Pm, basis) with no depsgraph involvement"""
    Pm, basis = {}, {}
    for name in TOPO:
        bone = meta.data.bones[name]
        rel = REST_REL[name]
        base = Pm[bone.parent.name] if bone.parent else Matrix.Identity(4)
        W = base @ rel
        spec = pose.get(name, {})
        if 'dir' in spec:
            # A bone's local +Y runs head->tail, so demanding a world direction d means the
            # basis rotation must send +Y to d expressed in the bone's own posed frame. The
            # minimal such rotation is derived, not authored, and cannot pick the wrong plane.
            d = Vector(spec['dir']).normalized()
            t = (W.to_3x3().inverted() @ d).normalized()
            q = Vector((0.0, 1.0, 0.0)).rotation_difference(t)
        else:
            q = basis_quat(pose, name, W)
        loc = Vector((0, 0, 0))
        if root_local is not None and bone.parent is None:
            loc = root_local
        basis[name] = (q, loc)
        Pm[name] = W @ (Matrix.Translation(loc) @ q.to_matrix().to_4x4())
    return Pm, basis

def apply_pose(arm, pose, rootfix, rest_ankle):
    Pm, basis = fk(pose)
    if rootfix:
        # Correct in ALL THREE AXES. Fixing only z keeps the ankle at the right height while
        # the leg swing slides it forward: the foot travel measured 0.35 m with a z-only fix.
        # A real squat plants the foot and moves the hips back, which is what a full 3D
        # delta on the root produces.
        delta = rest_ankle - Pm[rootfix[1]].to_translation()
        root_local = REST_REL[rootfix[0]].to_3x3().inverted() @ delta
        Pm, basis = fk(pose, root_local)
    for name in ORDER:
        pb = arm.pose.bones[name]
        pb.rotation_mode = 'QUATERNION'
        q, loc = basis[name]
        pb.rotation_quaternion = q
        pb.location = loc
    return Pm

# ---- PER-FRAME LATERAL CORRECTION -------------------------------------------------
# The abduction that cancels the knee's sideways foot drift is constant only if the pose is, and
# through a rep it is not. Solving it at the two extremes left the RIGHT foot travelling 0.1261 m:
# the root fix pins only the LEFT ankle, so any change in ankle-to-ankle distance across the rep
# drags the other foot with it. Both Blender and my own FK agree that travel is real, so this fixes
# the animation rather than the measurement. Curves are sampled across u and interpolated during
# blending, so the correction holds at every frame instead of only at the ends.
LATERAL_CURVES = {}


def _curve_at(samples, u):
    if u <= samples[0][0]:
        return samples[0][1]
    if u >= samples[-1][0]:
        return samples[-1][1]
    for _i in range(len(samples) - 1):
        _u0, _v0 = samples[_i]
        _u1, _v1 = samples[_i + 1]
        if _u0 <= u <= _u1:
            _t = (u - _u0) / max(1e-9, _u1 - _u0)
            return _v0 * (1 - _t) + _v1 * _t
    return samples[-1][1]


def blend(a, b, u):
    out = {}
    for bone in ORDER:
        da, db = a.get(bone, {}), b.get(bone, {})
        if 'dir' in da or 'dir' in db:
            # directions interpolate on the sphere; a straight lerp between two unit vectors
            # shortens the vector and can pass through the origin mid-rep
            va = Vector(da.get('dir', db['dir'])).normalized()
            vb = Vector(db.get('dir', da['dir'])).normalized()
            out[bone] = {'dir': tuple(va.slerp(vb, u))}
            continue
        d = {}
        for ax in set(da) | set(db):
            va, vb = da.get(ax), db.get(ax)
            if ax in ('axis', 'axis_from', 'base'):
                # directions/specs pass through; only the ANGLE is interpolated
                d[ax] = va if va is not None else vb
            elif va is None or vb is None:
                # A MISSING rotation key means ZERO degrees, not "borrow the other pose's value".
                # Treating it as the latter held the squat's thigh at its bottom angle for the whole
                # rep whenever only one extreme named it.
                d[ax] = (va if va is not None else 0.0) * (1 - u) + (vb if vb is not None else 0.0) * u
            else:
                d[ax] = va * (1 - u) + vb * u
        if d:
            out[bone] = d
    for _cb, _cs in LATERAL_CURVES.items():
        if _cb in out:
            # Keyed by the THIGH ANGLE, not by u. The clip blends the pose pair in REVERSED order
            # for the return half of the rep, so a u-keyed curve was being read at the wrong point
            # and applied the wrong abduction -- which is what kept the right foot moving 0.1351 m
            # even though the lateral residual measured 0.0007 m at the sampled u values. The thigh
            # angle is monotone across the rep and identical whichever direction it is blended in.
            out[_cb]['Z_local'] = _curve_at(_cs, out[_cb].get('X', 0.0))
    return out

EDGES = [0]
for _, d in TEMPO:
    EDGES.append(EDGES[-1] + d)

def pose_at(clip, t_ms):
    _, poses, _, order = clip
    for i in range(len(EDGES) - 1):
        if EDGES[i] <= t_ms <= EDGES[i + 1]:
            span = EDGES[i + 1] - EDGES[i]
            u = 0.0 if span == 0 else (t_ms - EDGES[i]) / span
            return blend(poses[order[i]], poses[order[i + 1]], u)
    return poses[order[-1]]

# rest ankle position (3D, so the foot can be pinned in every axis)
Pm0, _ = fk({})
REST_ANKLE = Pm0['foot.L'].to_translation().copy()
print('REST ankle position (my FK) = (%.4f, %.4f, %.4f)' % (REST_ANKLE.x, REST_ANKLE.y, REST_ANKLE.z))

# ---- REBUILD THE SQUAT'S SHIN ROTATIONS ON THE RIG'S OWN KNEE AXIS ---------------
# THREE wrong approaches preceded this one, each of which left the numbers looking right:
#   1. world X -- only 0.60 deg of knee angle per degree applied, and non-monotonic (-23 gave
#      165.8, -41 gave 158.4), so no value could reach the reference's 176.8 deg knee.
#   2. cross(thigh_dir, shin_dir) -- perpendicular to the REST bone triangle, but this rig's rest
#      legs are splayed, so the axis lands 31 deg off lateral: (0.854, -0.518, 0.040). Turning the
#      knee about it swings the foot SIDEWAYS. With the already-correct ankle pinned by the root
#      fix, that sideways swing forced the OTHER foot to travel -- which is exactly what surfaced as
#      "the right foot slides 0.40 m" and a visibly widening, sumo-like stance.
#   3. mirroring that axis between the legs -- worse again (0.9968 m of foot travel).
#
# The rig's own knee axis is its LOCAL X, which is what the rig was built around. Rotating about a
# bone's local axis needs no world-space conversion at all. The degrees are then SOLVED for by scan
# and scored on two things at once: reaching the measured knee angle, and NOT shifting the foot
# sideways. That lateral column is the check the first two approaches would each have failed.
def _knee_of(Pm, side):
    _t = (Pm['shin.' + side].to_translation() - Pm['thigh.' + side].to_translation()).normalized()
    _s = (Pm['foot.' + side].to_translation() - Pm['shin.' + side].to_translation()).normalized()
    return 180.0 - math.degrees(math.acos(max(-1.0, min(1.0, _t.dot(_s)))))


REST_KNEE_DEG = _knee_of(Pm0, 'L')
print('REST knee angle: L %.2f  R %.2f' % (_knee_of(Pm0, 'L'), _knee_of(Pm0, 'R')))


def solve_shin_local(side, target_knee_deg, thigh_x, knee_flexion_sign=None):
    """Local-X degrees putting this knee at target_knee_deg, found by a scan over +-180.
    Returns (deg, knee_reached_deg, lateral_foot_shift_m). Ties break toward the SMALLER lateral
    shift, so a solution that reaches the angle only by splaying the leg loses to one that reaches
    it in plane.

    knee_flexion_sign, when given, restricts the scan to local-X values of that sign. It is not
    cosmetic. A given interior knee angle has TWO local-X solutions -- correct flexion, and a
    backward fold through straight -- and both measure the same number, so no amount of angle
    checking can tell them apart. Left free, this scan took the wrong branch for the seated leg
    extension: the shin folded UP in front of the thigh, the ankle sitting 0.379 m ABOVE the knee,
    while the knee travel matched the measured reference to 0.0 deg and every angle table read
    perfect. The caller supplies the sense from a physically verified pose (the squat's bottom).
    """
    _best = None
    for _i in range(-180, 181):
        _d = float(_i)
        if knee_flexion_sign is not None and _i != 0 and (_i > 0) != (knee_flexion_sign > 0):
            continue
        _P, _ = fk({'thigh.' + side: {'X': thigh_x}, 'shin.' + side: {'X_local': _d}})
        _k = _knee_of(_P, side)
        _lat = abs(_P['foot.' + side].to_translation().x - Pm0['foot.' + side].to_translation().x)
        _err = round(abs(_k - target_knee_deg), 3)
        if _best is None or _err < _best[0] or (_err == _best[0] and _lat < _best[3]):
            _best = (_err, _d, _k, _lat)
    return _best[1], _best[2], _best[3]


def solve_thigh_abduct(side, thigh_x, knee_local_deg):
    """Thigh local-Z that cancels the sideways drift the knee rotation introduces.

    A local-X knee turn is close to the rig's real axis but not exactly perpendicular to the leg's
    sagittal plane, so it still shifted the foot ~0.07 m sideways; with the ankle pinned, that
    became the residual 0.1260 m of right-foot travel. The knee angle is a LOCAL quantity and is
    unaffected by how the thigh is oriented, so abduction is a free second degree of freedom: it can
    be solved to zero the lateral shift without touching the knee at all. Solving BOTH extremes to
    zero also makes the stance identical at the top and bottom, so the foot cannot travel.
    Returns (thigh_Z_local, lateral_shift_m, knee_deg_reached)."""
    _best = None
    for _i in range(-250, 251):
        _z = _i / 10.0
        _P, _ = fk({'thigh.' + side: {'X': thigh_x, 'Z_local': _z},
                    'shin.' + side: {'X_local': knee_local_deg}})
        _lat = abs(_P['foot.' + side].to_translation().x - Pm0['foot.' + side].to_translation().x)
        if _best is None or _lat < _best[0]:
            _best = (_lat, _z, _knee_of(_P, side))
    return _best[1], _best[0], _best[2]


def _mirror_err(pose):
    """How far the two ankles are from being exact mirrors about x=0. Zero means a symmetric pose."""
    _P, _ = fk(pose)
    _aL = _P['foot.L'].to_translation()
    _aR = _P['foot.R'].to_translation()
    return (_aL.x + _aR.x) ** 2 + (_aL.y - _aR.y) ** 2 + (_aL.z - _aR.z) ** 2


THIGH_X = SQUAT_BOTTOM['thigh.L']['X']
# The knee angle is a LOCAL quantity, so the shin's solution does not depend on how the thigh is
# oriented in the world: solve once per side. Then solve the thigh's abduction on top of it.
_SOLVED = {}
for _side in ('L', 'R'):
    _ts = solve_shin_local(_side, SQUAT_TARGETS['top_knee_deg'], 0.0)
    _bs = solve_shin_local(_side, SQUAT_TARGETS['bottom_knee_deg'], THIGH_X)
    _tz, _tlat, _tk = solve_thigh_abduct(_side, 0.0, _ts[0])
    _bz, _blat, _bk = solve_thigh_abduct(_side, THIGH_X, _bs[0])
    _SOLVED[_side] = ((_ts[0], _tz, _tk, _tlat), (_bs[0], _bz, _bk, _blat))
    print('   %s: TOP shin %+.1f thigh Z %+.1f -> knee %.1f, sideways %.4f m | '
          'BOTTOM shin %+.1f thigh Z %+.1f -> knee %.1f, sideways %.4f m'
          % (_side, _ts[0], _tz, _tk, _tlat, _bs[0], _bz, _bk, _blat))

# The thigh's X sign is per side and MEASURED: with each leg solved independently, the pose is
# symmetric only if the right thigh turns the correct way.
_e = {}
for _s in (1.0, -1.0):
    _p = {'spine.001': {'X': 10}, 'spine.002': {'X': 8},
          'thigh.L': {'X': THIGH_X, 'Z_local': _SOLVED['L'][1][1]},
          'thigh.R': {'X': THIGH_X * _s, 'Z_local': _SOLVED['R'][1][1]},
          'shin.L': {'X_local': _SOLVED['L'][1][0]},
          'shin.R': {'X_local': _SOLVED['R'][1][0]}}
    _e[_s] = _mirror_err(_p)
SENSE_R = min(_e, key=lambda k: _e[k])
print('   RIGHT thigh sense test: same-sign mirror error %.4f, opposite-sign %.4f  ->  %s'
      % (_e[1.0], _e[-1.0], 'SAME sign' if SENSE_R > 0 else 'OPPOSITE sign'))

for _side in ('L', 'R'):
    _sgn = 1.0 if _side == 'L' else SENSE_R
    _t, _b = _SOLVED[_side]
    SQUAT_TOP['thigh.' + _side] = {'X': 0.0, 'Z_local': _t[1]}
    SQUAT_BOTTOM['thigh.' + _side] = {'X': THIGH_X * _sgn, 'Z_local': _b[1]}
    SQUAT_TOP['shin.' + _side] = {'X_local': _t[0]}
    SQUAT_BOTTOM['shin.' + _side] = {'X_local': _b[0]}
print('   mirror error after the fix: bottom %.6f, top %.6f'
      % (_mirror_err(SQUAT_BOTTOM), _mirror_err(SQUAT_TOP)))
# Keep each sole flat, using ITS OWN side's rest direction: a single shared direction was another
# left/right shortcut, and the right foot's rest direction is the mirror, not the same vector.
for _side in ('L', 'R'):
    _fd = (Pm0['foot.' + _side].to_3x3() @ Vector((0, 1, 0))).normalized()
    SQUAT_TOP['foot.' + _side] = {'dir': tuple(_fd)}
    SQUAT_BOTTOM['foot.' + _side] = {'dir': tuple(_fd)}
    print('   foot %s rest direction %s' % (_side, tuple(round(c, 3) for c in _fd)))
print('SQUAT shins rotate about their LOCAL knee axis: top %+.1f deg, bottom %+.1f deg'
      % (SQUAT_TOP['shin.L']['X_local'], SQUAT_BOTTOM['shin.L']['X_local']))


# ---- LEG EXTENSION: the knee is MEASURED, the hip is authored -------------------------------
# Targets come from _ref/cdc_leg_targets.json, measured by pose estimation on the CDC
# "Muscle Strengthening at the Gym - Leg Extension" clip (Public domain). These are the
# RUN-FILTERED values: measured over the longest contiguous take, not over every usable frame.
# That distinction is the difference between 54.1 and 133.5 deg of knee travel -- the unfiltered
# figure had picked up a deep knee flexion from a different segment of the clip, probably someone
# sitting down, and would have driven this rig to a range the exercise does not have.
#
# The HIP is AUTHORED, and labelled so. The same measurement reported a 70 deg hip range, which was
# discarded: on a leg-extension machine the seat fixes the hip, so that figure is torso-estimation
# error rather than hip motion. The seated thigh angle below is a plausible machine setting.
LEGEXT_TARGETS = {'flexed_knee_deg': 108.7, 'extended_knee_deg': 162.8,
                  'source': 'CDC Muscle Strengthening at the Gym - Leg Extension (Public domain)',
                  'measured_by': 'MediaPipe pose estimation, longest contiguous take (16 frames)'}
LEGEXT_SEATED_THIGH_X = -70.0     # AUTHORED (not measured): thigh roughly horizontal, as if seated.
# Not -85: with the thigh at -85 the correct (non-folded) knee branch tops out at 152.0 deg, so the
# measured 162.8 deg extended position is UNREACHABLE and the clip cannot reproduce the reference's
# top end at all. At -70 the rig can reach it. The hip angle is the one number here that was never
# measured -- the reference's own hip figure was discarded as torso-estimation error -- so it is
# tuned to let the MEASURED quantity be hit, rather than held at a guess that blocks it.

LEGEXT_SEATED.update({'spine.001': {'X': 6}, 'spine.002': {'X': 4}})
LEGEXT_EXTENDED.update({'spine.001': {'X': 6}, 'spine.002': {'X': 4}})
for _side in ('L', 'R'):
    _sgn = 1.0 if _side == 'L' else SENSE_R
    # The squat's bottom knee is physically verified, so its shin sense is the reference for what
    # knee FLEXION means on this rig. Without it the solver takes whichever branch matches the
    # angle, which produced a shin folded up in front of the thigh.
    _flex_sign = SQUAT_BOTTOM['shin.' + _side]['X_local']
    _fs = solve_shin_local(_side, LEGEXT_TARGETS['flexed_knee_deg'], LEGEXT_SEATED_THIGH_X,
                           knee_flexion_sign=_flex_sign)
    _es = solve_shin_local(_side, LEGEXT_TARGETS['extended_knee_deg'], LEGEXT_SEATED_THIGH_X,
                           knee_flexion_sign=_flex_sign)
    _fz, _flat, _fk = solve_thigh_abduct(_side, LEGEXT_SEATED_THIGH_X, _fs[0])
    _ez, _elat, _ek = solve_thigh_abduct(_side, LEGEXT_SEATED_THIGH_X, _es[0])
    LEGEXT_SEATED['thigh.' + _side] = {'X': LEGEXT_SEATED_THIGH_X * _sgn, 'Z_local': _fz}
    LEGEXT_EXTENDED['thigh.' + _side] = {'X': LEGEXT_SEATED_THIGH_X * _sgn, 'Z_local': _ez}
    LEGEXT_SEATED['shin.' + _side] = {'X_local': _fs[0]}
    LEGEXT_EXTENDED['shin.' + _side] = {'X_local': _es[0]}
    _fd = (Pm0['foot.' + _side].to_3x3() @ Vector((0, 1, 0))).normalized()
    LEGEXT_SEATED['foot.' + _side] = {'dir': tuple(_fd)}
    LEGEXT_EXTENDED['foot.' + _side] = {'dir': tuple(_fd)}
    print('   LEGEXT %s: seated knee %.1f deg (measured %.1f), extended knee %.1f deg '
          '(measured %.1f), sideways %.4f/%.4f m'
          % (_side, _fk, LEGEXT_TARGETS['flexed_knee_deg'], _ek,
             LEGEXT_TARGETS['extended_knee_deg'], _flat, _elat))
print('   LEGEXT mirror error: seated %.6f, extended %.6f'
      % (_mirror_err(LEGEXT_SEATED), _mirror_err(LEGEXT_EXTENDED)))


def _solve_abduct_for(pose, side):
    """Thigh Z_local putting THIS pose's ankle back at its rest LATERAL position.

    Lateral only, deliberately. Targeting the ankle's full rest position was tried and is
    unachievable -- it reported a 0.6808 m residual, because in a deep squat the ankle is nowhere
    near where it rests standing, and the only thing that can keep a foot planted is a hip
    translation, which the root fix already applies. Abduction can only cancel the sideways drift.

    What remains is the stance WIDTH, and that is the whole remaining defect: with the left ankle
    pinned, any change in ankle-to-ankle distance across the rep drags the right foot."""
    _rest_x = Pm0['foot.' + side].to_translation().x
    _best = None
    for _i in range(-250, 251):
        _z = _i / 10.0
        _p = {k: dict(v) for k, v in pose.items()}
        _p['thigh.' + side] = dict(_p.get('thigh.' + side, {}))
        _p['thigh.' + side]['Z_local'] = _z
        _P, _ = fk(_p)
        _err = abs(_P['foot.' + side].to_translation().x - _rest_x)
        if _best is None or _err < _best[0]:
            _best = (_err, _z)
    return _best[1], _best[0]


for _side in ('L', 'R'):
    _samples = []
    _worst = 0.0
    for _i in range(11):
        _u = _i / 10.0
        _pose_u = blend(SQUAT_TOP, SQUAT_BOTTOM, _u)
        _z, _err = _solve_abduct_for(_pose_u, _side)
        _samples.append((_pose_u.get('thigh.' + _side, {}).get('X', 0.0), _z))
        _worst = max(_worst, _err)
    _samples.sort(key=lambda s: s[0])
    LATERAL_CURVES['thigh.' + _side] = _samples
    print('   abduction curve thigh.%s, keyed by thigh X (deg): %s'
          % (_side, ' '.join('%.0f:%+.1f' % (k, z) for k, z in _samples)))
    print('      worst 3-D ankle residual on the sampled grid: %.4f m' % _worst)
_peek = [fk(blend(SQUAT_TOP, SQUAT_BOTTOM, _i / 20.0))[0]['foot.R'].to_translation() for _i in range(21)]
print('   right-foot travel my FK now predicts over the corrected rep: %.4f m'
      % max((p - _peek[0]).length for p in _peek))

# ---- BUILD THE PRESS POSES FROM WRIST TARGETS + TWO-LINK IK -------------------
# This is how the app's own 2D engine authors all 48 demos, and for the same reason: a limb
# TARGET pins the position in every axis at once, so it cannot come out right in the plane and
# wrong in fore/aft. That is precisely how the direction-driven version produced a
# behind-the-neck rack (hands 0.361 m behind the shoulder) while every angle checked out.
def grip_half_width(pose):
    Pm_g, _ = fk(pose)
    return abs(Pm_g['hand.L'].to_translation().x - Pm_g['hand.R'].to_translation().x) / 2.0

def shoulder_to_wrist(pose):
    """Signed fore/aft and height of the wrist relative to the shoulder. Fore/aft is the axis
    that broke last round and that no earlier check looked at."""
    Pm_s, _ = fk(pose)
    sh = Pm_s['upper_arm.L'].to_translation()
    wr = Pm_s['hand.L'].to_translation()
    return wr.y - sh.y, wr.z - sh.z

def arm_dirs_from_wrist(pose_spine, side, offset, pole):
    """Two-link IK: put this wrist at shoulder + offset, with the elbow biased toward pole."""
    Pm_s, _ = fk(pose_spine)
    S = Pm_s['upper_arm' + side].to_translation()
    E = Pm_s['forearm' + side].to_translation()
    Wr = Pm_s['hand' + side].to_translation()
    L1, L2 = (E - S).length, (Wr - E).length
    sign = 1.0 if side == '.L' else -1.0
    target = S + Vector((offset[0] * sign, offset[1], offset[2]))
    v = target - S
    # clamp into the reachable annulus: beyond it the limb is straight, inside it fully folded
    d = min(max(v.length, abs(L1 - L2) + 1e-4), L1 + L2 - 1e-4)
    n = v.normalized()
    cosA = max(-1.0, min(1.0, (L1 * L1 + d * d - L2 * L2) / (2.0 * L1 * d)))
    A = math.acos(cosA)                 # angle at the shoulder between S->W and S->elbow
    pv = Vector((pole[0] * sign, pole[1], pole[2]))
    pv = pv - n * pv.dot(n)             # pole component perpendicular to the reach line
    if pv.length < 1e-6:                # degenerate: any perpendicular will do
        pv = Vector((0.0, 0.0, 1.0)) - n * n.z
        if pv.length < 1e-6:
            pv = Vector((0.0, 1.0, 0.0)) - n * n.y
    u = pv.normalized()
    ua = (n * math.cos(A) + u * math.sin(A)).normalized()
    elbow = S + ua * L1
    fa = (target - elbow).normalized()
    return {'upper_arm' + side: {'dir': tuple(ua)}, 'forearm' + side: {'dir': tuple(fa)}}

# The elbow points forward and slightly out -- "elbows under it". At the lockout the arm is
# nearly straight, so the pole barely matters there.
POLE_RACKED = (0.55, -0.75, -0.35)
POLE_LOCKOUT = (0.75, -0.60, 0.10)
for _label, _pose, _spine, _pole in (('lockout', PRESS_LOCKOUT, PRESS_SPINE_LOCKOUT, POLE_LOCKOUT),
                                     ('racked', PRESS_RACKED, PRESS_SPINE_RACKED, POLE_RACKED)):
    _pose.clear(); _pose.update(_spine)
    for _side in ('.L', '.R'):
        _pose.update(arm_dirs_from_wrist(_spine, _side, PRESS_TARGETS[_label]['wrist'], _pole))
print('PRESS built from wrist targets + IK: grip half-width lockout %.3f m, racked %.3f m'
      % (grip_half_width(PRESS_LOCKOUT), grip_half_width(PRESS_RACKED)))

# ---- DOES THE RIG ACHIEVE THE REQUESTED DIRECTIONS? --------------------------
# A target direction is only worth anything if the posed rig actually points that way AND the
# resulting geometry reproduces the measurement the direction came from. Both halves are
# checked here, because "I asked for the right direction" is not evidence that I got it.
print()
print('PRESS ACCEPTANCE (rig vs the measured reference)')
RIG_UPPER_M = (Pm0['forearm.L'].to_translation() - Pm0['upper_arm.L'].to_translation()).length
SCALE = RIG_UPPER_M / REF_UPPER_ARM_M
print('  reference landmark scale: upper arm %.3f m measured vs %.3f m on this rig -> x%.2f'
      % (REF_UPPER_ARM_M, RIG_UPPER_M, SCALE))
press_ok = True
lat_seen = {}
for label, pose in (('lockout', PRESS_LOCKOUT), ('racked', PRESS_RACKED)):
    Pm_p, _ = fk(pose)
    sh = Pm_p['upper_arm.L'].to_translation()
    wr = Pm_p['hand.L'].to_translation()
    wrR = Pm_p['hand.R'].to_translation()
    ua = (Pm_p['upper_arm.L'].to_3x3() @ Vector((0, 1, 0))).normalized()
    fa = (Pm_p['forearm.L'].to_3x3() @ Vector((0, 1, 0))).normalized()
    t = PRESS_TARGETS[label]
    tgt = sh + Vector(t['wrist'])
    # EVERY axis at once, fore/aft included. The previous version checked height and lateral but
    # never fore/aft, so it passed a pose with the hands 0.361 m behind the body.
    pos_err = (wr - tgt).length
    elbow = 180.0 - math.degrees(math.acos(max(-1.0, min(1.0, ua.dot(fa)))))
    fore, up = wr.y - sh.y, wr.z - sh.z
    lat = abs(wr.x - wrR.x)
    lat_seen[label] = lat
    print('  %-8s wrist hit its target to %.4f m across ALL axes (incl. fore/aft)' % (label, pos_err))
    if t['elbow_deg']:
        print('           elbow %.1f deg (measured %.1f) delta %+.1f  [scale-free]'
              % (elbow, t['elbow_deg'], elbow - t['elbow_deg']))
    else:
        print('           elbow %.1f deg -- DERIVED by IK from the cue, not assumed' % elbow)
    print('           wrist fore/aft %+.3f m (+ is BEHIND the shoulder), height %+.3f m, lateral %.3f m'
          % (fore, up, lat))
    if pos_err > 0.010:
        press_ok = False
    if t['elbow_deg'] and abs(elbow - t['elbow_deg']) > 5.0:
        press_ok = False
    # The defect that broke the last attempt: a press must not put the hands behind the body.
    if fore > 0.12:
        press_ok = False
# A barbell is rigid: the invariant that matters most is that the grip does not change.
if abs(lat_seen['lockout'] - lat_seen['racked']) > 0.005:
    press_ok = False
print('  BARBELL INVARIANT grip constant through the rep: %.3f m vs %.3f m (delta %.3f m) %s'
      % (lat_seen['lockout'], lat_seen['racked'],
         abs(lat_seen['lockout'] - lat_seen['racked']),
         'OK' if abs(lat_seen['lockout'] - lat_seen['racked']) <= 0.005 else 'FAIL'))
print('  HANDS-IN-FRONT-GUARD racked wrist must not be behind the shoulder: %s'
      % ('OK' if shoulder_to_wrist(PRESS_RACKED)[0] <= 0.12 else 'FAIL'))


# ---- MACHINE CHEST PRESS: the elbow range is MEASURED (and was CORRECTED) ---------------------
# Targets come from _ref/cdc_targets.json, clip 'machine-press', measured by pose estimation on the
# CDC public-domain chest-press clip with the extremes selected by ELBOW ANGLE.
#
# An earlier version of that measurement selected its two extremes by WRIST HEIGHT and reported
# 126.4 / 116.0 -- a 10 deg range for a chest press, which is not a chest press. It was withdrawn.
# Re-selecting on the elbow itself gives 86.4 (flexed) to 130.5 (extended), a 44 deg range.
#
# The wrist DISTANCE is not typed in. It is derived from the measured elbow angle by the law of
# cosines on this rig's own bone lengths, so the IK lands the elbow on the measurement by
# construction -- and the acceptance check below then proves it happened, because "I asked for the
# right reach" is not evidence that I got the right angle.
MACHPRESS_TARGETS = {
    'flexed': {'elbow_deg': 86.4, 'source': 'measured: CDC chest_press, elbow-selected band median'},
    'extended': {'elbow_deg': 130.5, 'source': 'measured: CDC chest_press, elbow-selected band median'},
}
RIG_FORE_M = (Pm0['hand.L'].to_translation() - Pm0['forearm.L'].to_translation()).length
print()
print('MACHINE PRESS built from the MEASURED (corrected) elbow range')
print('  rig bones: upper arm %.3f m, forearm %.3f m' % (RIG_UPPER_M, RIG_FORE_M))
for _k in ('extended', 'flexed'):
    _t = MACHPRESS_TARGETS[_k]
    _t['reach'] = math.sqrt(max(0.0, RIG_UPPER_M ** 2 + RIG_FORE_M ** 2 - 2.0 * RIG_UPPER_M
                                * RIG_FORE_M * math.cos(math.radians(_t['elbow_deg']))))
    # Purely forward and level: a machine chest press drives the hands horizontally away from the
    # chest at about shoulder height, so the offset is -y with no height component.
    _t['wrist'] = (PRESS_GRIP_OUT_M, -_t['reach'], 0.0)
    print('  %-8s measured elbow %.1f deg -> wrist %.3f m forward of the shoulder'
          % (_k, _t['elbow_deg'], _t['reach']))

MACHPRESS_SPINE = {'spine.001': {'X': 4}, 'spine.002': {'X': 2}}
# Elbows out to the sides and a little back, which is how a chest press is set up. The pole swings
# the elbow AROUND the shoulder-to-wrist line without changing the elbow angle, so it affects
# plausibility only -- the measured quantity is unaffected either way.
MACHPRESS_POLE = (0.85, 0.30, -0.35)
_MACHPRESS_KNEE = None
for _k, _pose in (('extended', MACHPRESS_EXTENDED), ('flexed', MACHPRESS_FLEXED)):
    _pose.clear()
    _pose.update(MACHPRESS_SPINE)
    for _side in ('.L', '.R'):
        _pose.update(arm_dirs_from_wrist(MACHPRESS_SPINE, _side,
                                         MACHPRESS_TARGETS[_k]['wrist'], MACHPRESS_POLE))
    # Seated legs: AUTHORED, not measured. The same clip's hip figure was discarded because the seat
    # fixes the hip, so what it reports is torso-estimation error rather than hip motion. The knees
    # are held at the seat setting for the whole rep, as they are on the machine.
    for _side in ('L', 'R'):
        _sgn = 1.0 if _side == 'L' else SENSE_R
        _ks = solve_shin_local(_side, 100.0, -70.0,
                               knee_flexion_sign=SQUAT_BOTTOM['shin.' + _side]['X_local'])
        _kz, _klat, _MACHPRESS_KNEE = solve_thigh_abduct(_side, -70.0, _ks[0])
        _pose['thigh.' + _side] = {'X': -70.0 * _sgn, 'Z_local': _kz}
        _pose['shin.' + _side] = {'X_local': _ks[0]}
        _fd = (Pm0['foot.' + _side].to_3x3() @ Vector((0, 1, 0))).normalized()
        _pose['foot.' + _side] = {'dir': tuple(_fd)}
print('  seated legs (AUTHORED; the hip was never measured): thigh -70 deg, knee held at %.1f deg'
      % _MACHPRESS_KNEE)

print()
print('MACHINEPRESS ACCEPTANCE (rig vs the measured, corrected reference)')
_mp_ok = True
_pm_rows = {}
for _k, _pose in (('extended', MACHPRESS_EXTENDED), ('flexed', MACHPRESS_FLEXED)):
    Pm_m, _ = fk(_pose)
    _els = {}
    for _side in ('L', 'R'):
        _ua = (Pm_m['upper_arm.' + _side].to_3x3() @ Vector((0, 1, 0))).normalized()
        _fa = (Pm_m['forearm.' + _side].to_3x3() @ Vector((0, 1, 0))).normalized()
        _els[_side] = 180.0 - math.degrees(math.acos(max(-1.0, min(1.0, _ua.dot(_fa)))))
    _el = min(_els.values())          # the WORSE side governs, as everywhere else
    _sh = Pm_m['upper_arm.L'].to_translation()
    _wr = Pm_m['hand.L'].to_translation()
    _pm_rows[_k] = _el
    print('  %-8s elbow %.1f deg (measured %.1f) delta %+.1f | wrist %.3f m forward of the '
          'shoulder, %.3f m above it' % (_k, _el, MACHPRESS_TARGETS[_k]['elbow_deg'],
                                         _el - MACHPRESS_TARGETS[_k]['elbow_deg'],
                                         _sh.y - _wr.y, _wr.z - _sh.z))
    if abs(_el - MACHPRESS_TARGETS[_k]['elbow_deg']) > 5.0:
        _mp_ok = False
    if _wr.y > _sh.y:
        _mp_ok = False
        print('    FAIL: the wrist is BEHIND the shoulder in a press')
print('  elbow travel %.1f deg (measured 44.1) delta %+.1f'
      % (_pm_rows['extended'] - _pm_rows['flexed'],
         (_pm_rows['extended'] - _pm_rows['flexed']) - 44.1))
print('  MACHINEPRESS_ACCEPTANCE %s' % ('OK' if _mp_ok else 'OUT OF TOLERANCE'))
print('  PRESS_ACCEPTANCE %s' % ('OK' if press_ok else 'OUT OF TOLERANCE'))
print()

# ---- SQUAT ACCEPTANCE (rig vs the measured reference) -------------------------
# Anchored to the measurement, like the press. The knee angle and thigh rotation are scale-free,
# so they transfer exactly; the hip DROP is a distance and is reported for information rather than
# asserted, because it carries the same landmark-scale uncertainty the press height did.
print('SQUAT ACCEPTANCE (rig vs the measured CC BY 3.0 reference)')
squat_ok = True
sq_rows = {}
for label, pose in (('top', SQUAT_TOP), ('bottom', SQUAT_BOTTOM)):
    Pm_s, _ = fk(pose)
    hip = (Pm_s['thigh.L'].to_translation() + Pm_s['thigh.R'].to_translation()) / 2.0
    ank = (Pm_s['foot.L'].to_translation() + Pm_s['foot.R'].to_translation()) / 2.0
    # BOTH legs, and the WORSE side governs. Reading only .L is what let a right leg bending out of
    # plane -- 0.12 m through the floor -- report as a perfect match.
    knees = {}
    for side in ('L', 'R'):
        th_ = (Pm_s['thigh.' + side].to_3x3() @ Vector((0, 1, 0))).normalized()
        sh_ = (Pm_s['shin.' + side].to_3x3() @ Vector((0, 1, 0))).normalized()
        knees[side] = 180.0 - math.degrees(math.acos(max(-1.0, min(1.0, th_.dot(sh_)))))
    knee = max(knees.values())
    asym = abs(knees['L'] - knees['R'])
    th = (Pm_s['thigh.L'].to_3x3() @ Vector((0, 1, 0))).normalized()
    thigh_from_up = math.degrees(math.acos(max(-1.0, min(1.0, th.z))))
    sq_rows[label] = (knee, 180.0 - thigh_from_up, hip.z - ank.z, asym)
    print('  %-7s knee %.1f deg (L %.1f R %.1f, asymmetry %.2f), thigh flexion %.1f deg, '
          'hips %.3f m above the ankles'
          % (label, knee, knees['L'], knees['R'], asym, 180.0 - thigh_from_up, hip.z - ank.z))
kb, kt = sq_rows['bottom'][0], sq_rows['top'][0]
fb = sq_rows['bottom'][1]
drop = sq_rows['top'][2] - sq_rows['bottom'][2]
print('  knee travel %.1f deg (measured 110.2) delta %+.1f' % (kt - kb, (kt - kb) - 110.2))
print('  bottom knee %.1f deg (measured 66.7) delta %+.1f' % (kb, kb - SQUAT_TARGETS['bottom_knee_deg']))
print('  bottom thigh flexion %.1f deg (measured 82.0) delta %+.1f'
      % (fb, fb - SQUAT_TARGETS['thigh_flexion_deg']))
print('  hips descend %.3f m (measured 0.567 -- informational, carries the landmark scale)' % drop)
if abs(kb - SQUAT_TARGETS['bottom_knee_deg']) > 6.0:
    squat_ok = False
if abs(fb - SQUAT_TARGETS['thigh_flexion_deg']) > 6.0:
    squat_ok = False
if abs((kt - kb) - 110.2) > 6.0:
    squat_ok = False
# Where does the right leg go wrong? Both endpoint poses are exactly symmetric (mirror error
# 0.000000) yet the animated right foot drifts 0.4019 m, so the fault can only be in the blended
# path. This separates "the blended pose is asymmetric" from "the pose is fine and something
# downstream treats the sides differently".
_worst_u, _worst_e = None, 0.0
for _i in range(11):
    _u = _i / 10.0
    _e = _mirror_err(blend(SQUAT_TOP, SQUAT_BOTTOM, _u))
    if _i % 5 == 0:
        print('    u=%.1f mirror error %.4f' % (_u, _e))
    if _e > _worst_e:
        _worst_u, _worst_e = _u, _e
print('  INTERPOLATION symmetry: worst mirror error %.4f at u=%.1f (ends are 0.0000, so the POSES'
      ' are symmetric and only the blended path is not)' % (_worst_e, _worst_u))
print('  detail per bone at the worst point:')
_wp = blend(SQUAT_TOP, SQUAT_BOTTOM, _worst_u)
for _b in ('thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R'):
    print('    %-9s %s' % (_b, _wp.get(_b)))
print('  SQUAT_ACCEPTANCE %s' % ('OK' if squat_ok else 'OUT OF TOLERANCE'))

# ---- LEGEXT ACCEPTANCE (rig vs the measured CDC public-domain reference) ---------------------
# This is the point of the whole pipeline: the clip's knee angles are compared against numbers
# MEASURED from licensed video, not against angles chosen by eye. Both extremes are checked, not
# just the range, because a rig can match the RANGE while sitting in the wrong place overall --
# which is precisely what the app's own legext demo does (right range, 24-35 deg too flexed).
print('LEGEXT ACCEPTANCE (rig vs the measured CDC public-domain reference)')
legext_ok = True
lg_rows = {}
for label, pose in (('seated', LEGEXT_SEATED), ('extended', LEGEXT_EXTENDED)):
    Pm_l, _ = fk(pose)
    knees = {}
    for side in ('L', 'R'):
        th_ = (Pm_l['thigh.' + side].to_3x3() @ Vector((0, 1, 0))).normalized()
        sh_ = (Pm_l['shin.' + side].to_3x3() @ Vector((0, 1, 0))).normalized()
        knees[side] = 180.0 - math.degrees(math.acos(max(-1.0, min(1.0, th_.dot(sh_)))))
    # the WORSE side governs, as in the squat block
    lg_rows[label] = (min(knees.values()), abs(knees['L'] - knees['R']))
    print('  %-8s knee %.1f deg (L %.1f R %.1f, asymmetry %.3f)'
          % (label, min(knees.values()), knees['L'], knees['R'], abs(knees['L'] - knees['R'])))
    # An interior knee angle does NOT determine which way the shin bends: folding the shin up in
    # front of the thigh and letting it hang below the thigh can both measure 108.7 deg. The
    # filmstrip could not settle it either -- with a front camera a seated person's thighs point
    # straight at the lens, so the row reads as kneeling whether or not the pose is right. So check
    # the axis that actually differs: where the ankle sits relative to the knee and the hip.
    _hip_p = Pm_l['thigh.L'].to_translation()
    _knee_p = Pm_l['shin.L'].to_translation()
    _ank_p = Pm_l['foot.L'].to_translation()
    _below = _knee_p.z - _ank_p.z          # + means the ankle hangs below the knee (correct)
    _fwd = _hip_p.y - _knee_p.y            # + means the knee is forward of the hip (the rig faces -y)
    print('  %-8s ankle %.3f m below the knee, knee %.3f m forward of the hip' % (label, _below, _fwd))
    if label == 'seated':
        if _below < 0.15:
            legext_ok = False
            print('    FAIL: seated ankle is only %.3f m below the knee. A seated leg extension '
                  'hangs the shin DOWN; this is the shin folded the wrong way.' % _below)
        if _fwd < 0.10:
            legext_ok = False
            print('    FAIL: seated knee is only %.3f m forward of the hip -- the thigh is not '
                  'brought to horizontal.' % _fwd)
    if label == 'extended' and _below < 0.0:
        legext_ok = False
        print('    FAIL: extended ankle sits ABOVE the knee (%.3f m) -- impossible with the thigh '
              'horizontal.' % _below)
_kr = lg_rows['extended'][0] - lg_rows['seated'][0]
# The rig's knee CANNOT straighten past its rest pose. Probed rather than hardcoded, so it cannot
# go stale: ask the solver for full extension and see what it actually gives in the valid branch.
# This ceiling is why the measured 162.8 deg top end is unreachable -- at thigh -85 and at -70 the
# solver returns the identical 152.0, so it is a property of the knee, not of the seat angle. The
# honest consequence is that the rig reproduces the seated end of the reference exactly and the
# bottom 10.8 deg of its extension is missing. Stating that beats loosening a tolerance until the
# number passes.
_ceil = solve_shin_local('L', 180.0, LEGEXT_SEATED_THIGH_X,
                         knee_flexion_sign=SQUAT_BOTTOM['shin.L']['X_local'])[1]
_achievable = _ceil - LEGEXT_TARGETS['flexed_knee_deg']
print('  rig knee ceiling %.1f deg (rest-pose limited); achievable travel %.1f deg vs measured '
      '54.1 -- shortfall %.1f deg is the rig, not the reference'
      % (_ceil, _achievable, 54.1 - _achievable))
print('  knee travel %.1f deg (measured 54.1 run-filtered) delta %+.1f' % (_kr, _kr - 54.1))
print('  seated knee %.1f deg (measured 108.7) delta %+.1f'
      % (lg_rows['seated'][0], lg_rows['seated'][0] - LEGEXT_TARGETS['flexed_knee_deg']))
print('  extended knee %.1f deg (measured 162.8, rig ceiling %.1f) delta vs ceiling %+.1f'
      % (lg_rows['extended'][0], _ceil, lg_rows['extended'][0] - _ceil))
if abs(lg_rows['seated'][0] - LEGEXT_TARGETS['flexed_knee_deg']) > 6:
    legext_ok = False
# Judged against the RIG'S OWN CEILING, not against the unreachable target: the check still fails if
# the clip under-uses the range available to it, which is the authoring error worth catching.
if abs(lg_rows['extended'][0] - _ceil) > 6:
    legext_ok = False
if max(lg_rows['seated'][1], lg_rows['extended'][1]) > 0.5:
    legext_ok = False
print('  LEGEXT_ACCEPTANCE %s' % ('OK' if legext_ok else 'OUT OF TOLERANCE'))
print()

# ---- CHECK MY FK AGAINST BLENDER -------------------------------------------
# If this disagrees, every number below is fiction. Blender evaluates the same pose from the basis
# values I write, so the two must match.
#
# Swept across the WHOLE squat rep at 11 points, not a single mid-rep pose. The one-pose version
# reported a 1 um match while the animated audit simultaneously reported the right foot travelling
# 0.1261 m, and it kept reporting 1 um across three quite different pose specifications -- every
# check was reading either one pose or the left leg only.
worst, worst_bone, worst_u, bl_stance = 0.0, '', 0.0, 0.0
if meta.animation_data:
    meta.animation_data.action = None
bpy.context.view_layer.update()
_mine_R, _bl_R = [], []
for _i in range(11):
    _u = _i / 10.0
    check_pose = blend(SQUAT_TOP, SQUAT_BOTTOM, _u)
    apply_pose(meta, check_pose, ('spine', 'foot.L'), REST_ANKLE)
    bpy.context.view_layer.update()
    Pm_chk, _ = fk(check_pose)
    delta = REST_ANKLE - Pm_chk['foot.L'].to_translation()
    root_local = REST_REL['spine'].to_3x3().inverted() @ delta
    Pm_chk2, _ = fk(check_pose, root_local)
    # ARMATURE space on both sides. My FK works in armature space, so applying matrix_world to
    # Blender's head inserted a whole extra transform and manufactured a 0.24 m "disagreement".
    _mine_R.append(Pm_chk2['foot.R'].to_translation().copy())
    _bl_R.append(meta.pose.bones['foot.R'].head.copy())
    _mine_stance = (Pm_chk2['foot.L'].to_translation() - Pm_chk2['foot.R'].to_translation()).length
    _blL = meta.pose.bones['foot.L'].head
    bl_stance = max(bl_stance, abs((_blL - meta.pose.bones['foot.R'].head).length - _mine_stance))
    for name in ORDER:
        _d = (Pm_chk2[name].to_translation() - meta.pose.bones[name].head).length
        if _d > worst:
            worst, worst_bone, worst_u = _d, name, _u
print('FK_SELFTEST swept the squat at 11 points: worst joint error %.6f m (%s at u=%.1f)'
      % (worst, worst_bone, worst_u))
print('   stance width, my FK vs Blender: differs by up to %.6f m over those points' % bl_stance)
# The question the audit keeps raising: does the RIGHT foot actually travel during the rep?
_travel_mine = max((p - _mine_R[0]).length for p in _mine_R)
_travel_bl = max((p - _bl_R[0]).length for p in _bl_R)
print('   RIGHT foot travel over the rep: my FK %.4f m, Blender %.4f m  (left foot is pinned)'
      % (_travel_mine, _travel_bl))
if worst > 1e-4:
    print('FK_MISMATCH — refusing to bake animation on kinematics that disagree with Blender')
    raise SystemExit(1)

# ---- FULL-CLIP SWEEP, ON THE ACTUAL FRAMES ---------------------------------
# The 11-point sweep above samples u uniformly, but the clip's frames are NOT uniformly spaced in u
# (the tempo does that), and a mismatch living only between those samples is invisible to it. This
# walks every frame of the real clip, applies the root fix exactly as the bake does, and compares my
# FK against Blender's evaluation of the same frame. It also settles the one question the whole
# round has hinged on: does the RIGHT foot actually travel?
_clip_sq = [c for c in CLIPS if c[0] == 'squat'][0]
_worst_ff, _worst_frame, _mine_Rf, _bl_Rf = 0.0, -1, [], []
for _f in range(FRAMES + 1):
    _Pm_ap = apply_pose(meta, pose_at(_clip_sq, _f / FPS * 1000.0), _clip_sq[2], REST_ANKLE)
    # WITHOUT this, pose.bones[].head still reports the PREVIOUS frame's evaluated pose, and the
    # comparison silently becomes "my current frame vs Blender's last frame" -- which manufactured a
    # 0.135 m disagreement on foot.R and a 0.615 m offset on every root-level bone. The 11-point
    # sweep above always called it, which is exactly why that one agrees to 1 um.
    bpy.context.view_layer.update()
    _mine_Rf.append(_Pm_ap['foot.R'].to_translation().copy())
    _bl_Rf.append(meta.pose.bones['foot.R'].head.copy())
    _d = (_Pm_ap['foot.R'].to_translation() - meta.pose.bones['foot.R'].head).length
    if _d > _worst_ff:
        _worst_ff, _worst_frame = _d, _f
print('FULL-CLIP SWEEP squat (%d frames): worst FK-vs-Blender on foot.R = %.6f m at frame %d'
      % (FRAMES + 1, _worst_ff, _worst_frame))
print('   right-foot travel: my FK %.4f m, Blender %.4f m  (frame 0 as the reference)'
      % (max((p - _mine_Rf[0]).length for p in _mine_Rf),
         max((p - _bl_Rf[0]).length for p in _bl_Rf)))
if _worst_ff > 1e-4:
    _t_bad = _worst_frame / FPS * 1000.0
    _pose_bad = pose_at(_clip_sq, _t_bad)
    _Pm_bad = apply_pose(meta, _pose_bad, _clip_sq[2], REST_ANKLE)
    _errs = sorted(((_Pm_bad[b].to_translation() - meta.pose.bones[b].head).length, b)
                   for b in ORDER)
    print('  WORST-FRAME BREAKDOWN (frame %d, t=%.0f ms) -- largest FK-vs-Blender errors first:'
          % (_worst_frame, _t_bad))
    for _e, _b in reversed(_errs[-6:]):
        print('    %-12s %.6f m' % (_b, _e))
    print('  the pose the clip asks for at that instant:')
    for _b in ('spine', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R'):
        print('    %-9s %s' % (_b, _pose_bad.get(_b)))
    print('FK_MISMATCH on the real clip — refusing to bake')
    raise SystemExit(1)

# ---- bake one action per clip, sampled every frame -------------------------
meta.animation_data_create()
for name, poses, rootfix, order in CLIPS:
    act = bpy.data.actions.new(name)
    # The filmstrip clears the active action at the end of this script, and Blender does
    # not write a zero-user datablock to disk -- so without a fake user the saved .blend
    # contains no actions at all and the GLB export silently has nothing to export.
    act.use_fake_user = True
    meta.animation_data.action = act
    clip = (name, poses, rootfix, order)
    for f in range(FRAMES + 1):
        # ORDER MATTERS. sc.frame_set() evaluates the action and OVERWRITES the pose, so
        # setting the pose first and the frame second keys the same evaluated pose on every
        # frame -- an action with 127 keys per curve and no motion in it. The exporter then
        # optimises those constant channels down to 2 keys and the GLB animates nothing.
        # Move the playhead first, then pose, then record.
        sc.frame_set(f)
        apply_pose(meta, pose_at(clip, f / FPS * 1000.0), rootfix, REST_ANKLE)
        for bone in ORDER:
            pb = meta.pose.bones[bone]
            pb.keyframe_insert('rotation_quaternion', frame=f)
            pb.keyframe_insert('location', frame=f)
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    # Prove the bake captured motion at all: an action can have a key on every frame and
    # still be a constant, which is exactly the failure above.
    spread = max((max(kp.co[1] for kp in fc.keyframe_points) - min(kp.co[1] for kp in fc.keyframe_points))
                 for fc in act.fcurves)
    print('BAKED action %-6s frames=0..%d fcurves=%d keys=%d max_fcurve_spread=%.4f %s'
          % (name, FRAMES, len(act.fcurves), sum(len(fc.keyframe_points) for fc in act.fcurves),
             spread, 'OK' if spread > 0.01 else 'FAIL — constant action, no motion baked'))

# ---- audit -----------------------------------------------------------------
def deformed_z(mesh):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    me = ev.to_mesh()
    zs = [(mesh.matrix_world @ v.co).z for v in me.vertices]
    ev.to_mesh_clear()
    return min(zs)

def deformed_z_at(mesh):
    """(z, (x, y, z)) of the lowest deformed vertex, so a floor penetration can be ATTRIBUTED to a
    body part instead of guessed at"""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    me = ev.to_mesh()
    lo = min((mesh.matrix_world @ v.co for v in me.vertices), key=lambda p: p.z)
    ev.to_mesh_clear()
    return lo.z, (lo.x, lo.y, lo.z)

dump, fails = {}, []
for name, poses, rootfix, order in CLIPS:
    meta.animation_data.action = bpy.data.actions[name]
    rest_len = None
    prev_q, flips = {}, 0
    lowest = 1e9
    lowest_at = None
    contact = []
    sample = {}
    for f in range(FRAMES + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        J = {b: meta.pose.bones[b].head.copy() for b in ORDER}
        if not all(all(map(math.isfinite, v)) for v in J.values()):
            fails.append('%s f%d non-finite joint' % (name, f))
        lens = {b: (meta.pose.bones[b].tail - meta.pose.bones[b].head).length for b in ORDER}
        if rest_len is None:
            rest_len = lens
        drift = max(abs(lens[b] - rest_len[b]) for b in ORDER)
        if drift > 1e-5:
            fails.append('%s f%d bone length drift %.2e' % (name, f, drift))
        for b in ORDER:
            q = meta.pose.bones[b].rotation_quaternion.copy()
            if b in prev_q and q.dot(prev_q[b]) < 0:
                flips += 1
                fails.append('%s f%d %s quaternion sign flip (LINEAR interp would spin the long way)' % (name, f, b))
            prev_q[b] = q
        if f % 3 == 0:
            lz, lvert = deformed_z_at(body)
            if lz < lowest:
                lowest, lowest_at = lz, (f, lvert)
        contact.append((J['foot.L'].copy(), J['toe.L'].copy(), J['foot.R'].copy(), J['toe.R'].copy()))
        if f % 25 == 0:
            sample[f] = {b: [round(c, 6) for c in meta.pose.bones[b].rotation_quaternion] for b in ORDER}
    travel_foot = max((c[0] - contact[0][0]).length for c in contact)
    travel_toe = max((c[1] - contact[0][1]).length for c in contact)
    # BOTH sides. A left-leg-only audit reported foot_travel 0.0000 while the right leg was bending
    # out of plane and its foot sat 0.12 m under the floor -- the check never looked at the side
    # that broke. Stance width is checked too, since a symmetric squat must not change it.
    travel_foot_r = max((c[2] - contact[0][2]).length for c in contact)
    travel_toe_r = max((c[3] - contact[0][3]).length for c in contact)
    _stance = [(c[0] - c[2]).length for c in contact]
    stance_drift = max(_stance) - min(_stance)
    print('AUDIT %-6s lowest_vertex_z=%+.4f foot_travel=%.4f toe_travel=%.4f quat_flips=%d'
          % (name, lowest, travel_foot, travel_toe, flips))
    print('       right side: foot_travel=%.4f toe_travel=%.4f; stance drift=%.4f'
          % (travel_foot_r, travel_toe_r, stance_drift))
    if lowest_at:
        # WHICH vertex is below the floor, and how far from the feet -- the previous two attempts
        # to explain this penetration blamed the ankle, then the foot, and both were wrong: the
        # foot and toe joints measure 0.0000 travel, so they are provably stationary.
        f_at, (vx, vy, vz) = lowest_at
        print('       lowest vertex at frame %d is (%.3f, %.3f, %.3f); nearest foot joint '
              '(%.3f, %.3f, %.3f)' % (f_at, vx, vy, vz, contact[f_at][0].x, contact[f_at][0].y,
                                      contact[f_at][0].z))
    if lowest < -0.01:
        fails.append('%s floor penetration %.4f' % (name, lowest))
    # Planted feet are checked for EVERY clip whose feet are planted -- not 'squat' by name.
    # Hardcoding the name meant the press was never checked for foot slide at all, and any clip
    # added later would silently get no check. FEET_NOT_PLANTED is the explicit exemption: a seated
    # leg extension legitimately swings the shin, so its feet are expected to travel.
    if name not in FEET_NOT_PLANTED:
        if travel_foot > 0.02:
            fails.append('%s foot slides %.4f' % (name, travel_foot))
        if travel_foot_r > 0.02:
            fails.append('%s RIGHT foot slides %.4f (left foot %.4f) -- an asymmetric leg'
                         % (name, travel_foot_r, travel_foot))
        if stance_drift > 0.02:
            fails.append('%s stance width drifts %.4f' % (name, stance_drift))
    else:
        print('       %s is seated: feet not planted by design, so foot travel %.4f and stance '
              'drift %.4f are expected rather than defects' % (name, travel_foot, stance_drift))
    dump[name] = sample
print('ANIM_AUDIT %s' % ('CLEAN' if not fails else 'FAILURES: ' + '; '.join(fails[:6])))
dumpdir = os.path.dirname(os.path.abspath(out))
with open(os.path.join(dumpdir, '_blender_anim_dump.json'), 'w') as fh:
    json.dump({'fps': FPS, 'frames': FRAMES, 'cycle_ms': CYCLE, 'clips': dump}, fh)

# ---- filmstrip -------------------------------------------------------------
meta.animation_data.action = None
for pb in meta.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
times = list(EDGES)
while len(times) < cols:
    times = sorted(set(times + [(times[i] + times[i + 1]) // 2 for i in range(len(times) - 1)]))
times = times[:cols]
print('SHEET columns at ms: %s' % times)

row_h = 1.95
copies = []
for r, clip in enumerate(CLIPS):
    for c, t in enumerate(times):
        arm = meta.copy(); sc.collection.objects.link(arm)
        mesh = body.copy(); sc.collection.objects.link(mesh)
        mesh.parent = None
        for m in mesh.modifiers:
            if m.type == 'ARMATURE':
                m.object = arm
        apply_pose(arm, pose_at(clip, t), clip[2], REST_ANKLE)
        copies.append((r, c, arm, mesh))
meta.hide_render = True
body.hide_render = True

def bounds(mesh):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    me = ev.to_mesh()
    pts = [mesh.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return pts

gap = 0.22
layout = {}
row_width = {}
for r, c, arm, mesh in copies:
    bpy.context.view_layer.update()
    pts = bounds(mesh)
    layout[(r, c)] = (min(p.x for p in pts), max(p.x for p in pts) - min(p.x for p in pts), min(p.z for p in pts))
for r in sorted(set(k[0] for k in layout)):
    row_width[r] = sum(layout[(r, c)][1] for c in sorted(k[1] for k in layout if k[0] == r)) + gap * (len(times) - 1)
total_w = max(row_width.values())
nrow = len(CLIPS)
for r in sorted(row_width):
    x = (total_w - row_width[r]) / 2.0          # centre each row in the frame
    zoff = row_h * (nrow - 1 - r)               # first clip on the TOP row
    for c in sorted(k[1] for k in layout if k[0] == r):
        minx, w, minz = layout[(r, c)]
        arm, mesh = [(a, m) for rr, cc, a, m in copies if rr == r and cc == c][0]
        arm.location.x += x - minx
        mesh.location.x += x - minx
        arm.location.z += zoff - minz
        mesh.location.z += zoff - minz
        x += w + gap
print('SHEET row widths %s -> total_w=%.2f (frame must cover the WIDEST row)'
      % ({r: round(v, 2) for r, v in row_width.items()}, total_w))
bpy.context.view_layer.update()
span = row_h * len(CLIPS) + 1.0
print('SHEET grid %dx%d world %.2f x %.2f' % (len(CLIPS), len(times), total_w, span))

mid_x = total_w / 2.0
bpy.ops.mesh.primitive_plane_add(size=total_w * 3.0, location=(mid_x, 0.0, 0.0))
floor = bpy.context.active_object
fm = bpy.data.materials.new('Floor'); fm.use_nodes = True
fb = fm.node_tree.nodes.get('Principled BSDF')
if fb:
    fb.inputs['Base Color'].default_value = (0.09, 0.10, 0.12, 1.0)
    fb.inputs['Roughness'].default_value = 0.9
floor.data.materials.append(fm)
world = bpy.data.worlds.new('W'); world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.04, 0.045, 0.055, 1.0)
sc.world = world

def add_area(nm, energy, size, loc, rot):
    ld = bpy.data.lights.new(nm, 'AREA'); ld.energy = energy; ld.size = size
    o = bpy.data.objects.new(nm, ld); sc.collection.objects.link(o)
    o.location = loc; o.rotation_euler = [math.radians(a) for a in rot]
add_area('Key', 300, 3.5, (mid_x - total_w * 0.30, -total_w * 0.42, span * 1.25), (50, 0, -34))
add_area('Fill', 90, 5.0, (mid_x + total_w * 0.40, -total_w * 0.38, span * 0.7), (66, 0, 44))
add_area('Rim', 150, 2.0, (mid_x, total_w * 0.45, span * 1.0), (118, 0, 4))

cam_data = bpy.data.cameras.new('Cam'); cam_data.type = 'ORTHO'
cam_data.ortho_scale = total_w * 1.05
cam = bpy.data.objects.new('Cam', cam_data); sc.collection.objects.link(cam)
sc.camera = cam
cam.location = (mid_x, -total_w * 1.5, span * 0.5)
cam.rotation_euler = (math.radians(90), 0, 0)

res_x = 1800
res_y = int(round(res_x * (span * 1.08) / (total_w * 1.05)))
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 32
sc.cycles.use_denoising = True
sc.render.resolution_x = res_x; sc.render.resolution_y = res_y
sc.render.image_settings.file_format = 'PNG'
sc.render.filepath = os.path.abspath(out)
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Base Contrast'
t0 = time.time()
bpy.ops.render.render(write_still=True)
print('RENDER_OK %.1fs bytes=%d res=%dx%d path=%s'
      % (time.time() - t0, os.path.getsize(sc.render.filepath), res_x, res_y, sc.render.filepath))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(dumpdir, '_blender_anim.blend'))
print('SAVED _blender_anim.blend')
