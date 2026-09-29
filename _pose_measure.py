"""_pose_measure.py — turn reference frames of a real human into joint ANGLES, in 3D, in metres.

This is the piece that changes the question from "does this look right?" to "how far is my
rig from a measured human?". MediaPipe returns two useful things per frame:

  pose_landmarks        normalised 2D image coordinates (what it saw)
  pose_world_landmarks  metric 3D joint positions, origin at the hip centre (what it inferred)

Both are reported, because they fail differently. The 2D set is what the detector actually
observed and is trustworthy for angles IN THE IMAGE PLANE -- which means the camera view
decides what an angle means: front-on gives abduction, side-on gives flexion. The world set
gives the 3D angle directly but is a single-view estimate, so it is the one to distrust.

Every frame also gets an OVERLAY written next to it with the detected skeleton drawn on the
real pixels. That is not decoration: a plausible angle table from a detector that locked onto
the wrong person, or onto a wall, is exactly the kind of confident wrong number this session
has already produced three times. Look at the overlay before believing the table.

Usage:
  python _pose_measure.py <images...|dir> --out <json> --overlay <dir> [--model <task>]
"""
import sys, os, json, glob, math

def parse_args():
    a = sys.argv[1:]
    out = overlay = model = None
    imgs = []
    i = 0
    while i < len(a):
        if a[i] == '--out': out = a[i + 1]; i += 2
        elif a[i] == '--overlay': overlay = a[i + 1]; i += 2
        elif a[i] == '--model': model = a[i + 1]; i += 2
        else: imgs.append(a[i]); i += 1
    return imgs, out, overlay, model

imgs, out_json, overlay_dir, model = parse_args()
if not imgs or not out_json:
    print('usage: python _pose_measure.py <images|dir> --out out.json --overlay dir [--model x.task]')
    raise SystemExit(2)

files = []
for p in imgs:
    if os.path.isdir(p): files += sorted(glob.glob(os.path.join(p, '*.jpg')) + glob.glob(os.path.join(p, '*.png')))
    else: files += sorted(glob.glob(p))
if not files:
    print('NO_INPUT_FILES')
    raise SystemExit(2)

import mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision
import cv2
import numpy as np

# Indices are stable across MediaPipe pose releases; naming them here avoids depending on the
# legacy mp.solutions API, which is gone in 1.x.
NOSE, L_SH, R_SH, L_EL, R_EL, L_WR, R_WR = 0, 11, 12, 13, 14, 15, 16
L_HIP, R_HIP, L_KN, R_KN, L_AN, R_AN = 23, 24, 25, 26, 27, 28
L_HEEL, R_HEEL, L_FOOT, R_FOOT = 29, 30, 31, 32
EDGES = [(L_SH, R_SH), (L_SH, L_EL), (L_EL, L_WR), (R_SH, R_EL), (R_EL, R_WR),
         (L_SH, L_HIP), (R_SH, R_HIP), (L_HIP, R_HIP), (L_HIP, L_KN), (L_KN, L_AN),
         (R_HIP, R_KN), (R_KN, R_AN), (L_AN, L_HEEL), (L_HEEL, L_FOOT),
         (R_AN, R_HEEL), (R_HEEL, R_FOOT)]

def ang(a, b, c):
    """angle at b, degrees, from 3D points"""
    v1 = np.array(a, float) - np.array(b, float)
    v2 = np.array(c, float) - np.array(b, float)
    n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
    if n1 < 1e-9 or n2 < 1e-9: return None
    return math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(v1, v2) / (n1 * n2))))))

opts = vision.PoseLandmarkerOptions(
    base_options=mpp.BaseOptions(model_asset_path=model),
    running_mode=vision.RunningMode.IMAGE,
    num_poses=1,
    min_pose_detection_confidence=0.3,
    min_pose_presence_confidence=0.3)
lm = vision.PoseLandmarker.create_from_options(opts)
print('MODEL %s' % os.path.basename(model))

if overlay_dir: os.makedirs(overlay_dir, exist_ok=True)
rows = []
for f in files:
    name = os.path.basename(f)
    res = lm.detect(mp.Image.create_from_file(f))
    if not res.pose_landmarks:
        rows.append({'file': name, 'detected': False})
        print('%-34s NO POSE DETECTED' % name)
        continue
    L2 = res.pose_landmarks[0]
    W3 = res.pose_world_landmarks[0] if res.pose_world_landmarks else None
    vis = [round(float(x.visibility), 3) for x in L2]

    rec = {'file': name, 'detected': True,
           'min_visibility': min(vis),
           'torso_visibility': round(min(vis[L_SH], vis[R_SH], vis[L_HIP], vis[R_HIP]), 3)}
    if W3:
        # MediaPipe world landmarks use the IMAGE convention: x right, y DOWN, z depth.
        # Flip y so every "above" in this file is genuinely positive. The self-consistency
        # checks below caught this sign error on all 79 reference frames -- the first two
        # checks failed on every frame, which is only possible if y is inverted.
        #
        # Axis meaning depends on the camera. On a SIDE view the subject's fore/aft axis maps
        # to image x (reliable) and their lateral axis to z (depth-inferred, unreliable). On a
        # FRONT view it is the other way round. So fore/aft is read from x here, and the
        # lateral figure is reported separately and flagged, never silently mixed in.
        P = [(p.x, -p.y, p.z) for p in W3]
        # Store the RAW landmark set. Angle tables are judgements; the landmarks are the
        # measurement, so keeping them means a new question never needs the detector re-run.
        rec['world_raw'] = [[round(float(c), 4) for c in p] for p in P]
        rec['vis_raw'] = vis

        def seg(a_i, b_i):
            v = np.array(P[b_i], float) - np.array(P[a_i], float)
            n = float(np.linalg.norm(v))
            return (v / n) if n > 1e-9 else None

        # Segment DIRECTIONS, which is what a rig actually needs. Unlike the hip-based
        # shoulder angle these do not depend on the hip, and on a side view the far hip is
        # routinely occluded -- so the shoulder angle can be garbage while the arm direction
        # is perfectly good. Elevation is measured from +y (0 = straight up, 180 = straight down).
        for tag, (a_i, b_i) in (('upper_arm_L', (L_SH, L_EL)), ('forearm_L', (L_EL, L_WR)),
                                ('upper_arm_R', (R_SH, R_EL)), ('forearm_R', (R_EL, R_WR)),
                                ('torso', (L_HIP, L_SH)), ('thigh_L', (L_HIP, L_KN)),
                                ('shin_L', (L_KN, L_AN))):
            v = seg(a_i, b_i)
            if v is None:
                continue
            rec.setdefault('dirs', {})[tag] = [round(float(c), 3) for c in v]
            rec['dirs'][tag + '_elev'] = round(math.degrees(math.acos(max(-1.0, min(1.0, float(v[1]))))), 1)

        # Self-consistency: catches a detector that locked onto something that is not a person,
        # which is the failure that yields a confident and entirely wrong table.
        checks = {
            'shoulder_above_hip_L': bool(P[L_SH][1] > P[L_HIP][1]),
            'ankle_below_hip_L': bool(P[L_AN][1] < P[L_HIP][1]),
            'upper_arm_len_plausible': bool(np.linalg.norm(np.array(P[L_EL]) - np.array(P[L_SH])) < 0.6),
            'arm_reach_plausible': bool(np.linalg.norm(np.array(P[L_WR]) - np.array(P[L_SH])) < 0.95),
        }
        rec['checks'] = checks
        rec['checks_ok'] = all(checks.values())

        # WHICH VIEW IS THIS? It decides what every other number means, and a technique video
        # cuts between camera angles, so this must be classified PER FRAME, not per video.
        # The shoulder line is the body's lateral axis: front-on it projects onto image x,
        # side-on onto depth z. Whichever dominates tells us which axis is trustworthy.
        shx = float(abs(P[L_SH][0] - P[R_SH][0]))
        shz = float(abs(P[L_SH][2] - P[R_SH][2]))
        tot = (shx * shx + shz * shz) ** 0.5
        if tot < 1e-6:
            rec['view'], rec['view_ratio_x'] = 'UNKNOWN', None
        else:
            ratio = shx / tot
            rec['view'] = 'FRONT' if ratio > 0.65 else ('SIDE' if ratio < 0.35 else 'OBLIQUE')
            rec['view_ratio_x'] = round(ratio, 2)
        rec['shoulder_x_m'] = round(shx, 3)
        rec['shoulder_z_m'] = round(shz, 3)
        # which measurement to trust follows from the view
        rec['trust_lateral'] = rec['view'] in ('FRONT', 'OBLIQUE')
        rec['trust_foreaft'] = rec['view'] in ('SIDE', 'OBLIQUE')

        # shoulder flexion measured against the torso axis, and the elbow angle
        rec['world'] = {
            'elbow_angle_L': ang(P[L_SH], P[L_EL], P[L_WR]),
            'elbow_angle_R': ang(P[R_SH], P[R_EL], P[R_WR]),
            'shoulder_angle_L': ang(P[L_HIP], P[L_SH], P[L_EL]),
            'shoulder_angle_R': ang(P[R_HIP], P[R_SH], P[R_EL]),
            'hand_separation_m': round(float(np.linalg.norm(np.array(P[L_WR]) - np.array(P[R_WR]))), 3),
            'shoulder_separation_m': round(float(np.linalg.norm(np.array(P[L_SH]) - np.array(P[R_SH]))), 3),
            'wrist_above_shoulder_m': round(float(P[L_WR][1] - P[L_SH][1]), 3),
            'wrist_forward_of_shoulder_m': round(float(P[L_WR][0] - P[L_SH][0]), 3),
            'wrist_lateral_of_shoulder_m': round(float(P[L_WR][2] - P[L_SH][2]), 3),
            'hand_separation_x_m': round(float(abs(P[L_WR][0] - P[R_WR][0])), 3),
            'hand_separation_z_m': round(float(abs(P[L_WR][2] - P[R_WR][2])), 3),
        }
    # 2D image-plane angle: what the detector actually saw, in the camera plane
    I = [(p.x, p.y) for p in L2]
    rec['image'] = {
        'elbow_angle_L': ang(I[L_SH], I[L_EL], I[L_WR]),
        'shoulder_angle_L': ang(I[L_HIP], I[L_SH], I[L_EL]),
        'wrist_above_shoulder_px': round(float(I[L_WR][1] - I[L_SH][1]), 4),
    }
    rows.append(rec)
    w = rec.get('world', {})
    print('%-34s torso_vis=%.2f  elbowL=%6.1f  shoulderL=%6.1f  hands apart=%.3fm  wrist %+.3fm above / %+.3fm fwd of shoulder'
          % (name, rec['torso_visibility'], w.get('elbow_angle_L') or -1, w.get('shoulder_angle_L') or -1,
             w.get('hand_separation_m') or -1, w.get('wrist_above_shoulder_m') or 0,
             w.get('wrist_forward_of_shoulder_m') or 0))

    if overlay_dir:
        img = cv2.imread(f)
        h, wpx = img.shape[:2]
        for a_i, b_i in EDGES:
            pa = (int(L2[a_i].x * wpx), int(L2[a_i].y * h))
            pb = (int(L2[b_i].x * wpx), int(L2[b_i].y * h))
            cv2.line(img, pa, pb, (60, 220, 90), 2, cv2.LINE_AA)
        for i2, p in enumerate(L2):
            if vis[i2] < 0.3: continue
            c = (int(p.x * wpx), int(p.y * h))
            col = (60, 160, 255) if i2 in (L_SH, R_SH, L_EL, R_EL, L_WR, R_WR) else (200, 200, 200)
            cv2.circle(img, c, 4, col, -1, cv2.LINE_AA)
        cv2.putText(img, 'vis %.2f' % rec['torso_visibility'], (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.imwrite(os.path.join(overlay_dir, name), img)

json.dump(rows, open(out_json, 'w'), indent=1)
det = sum(1 for r in rows if r.get('detected'))
print('WROTE %s  frames=%d detected=%d' % (out_json, len(rows), det))
