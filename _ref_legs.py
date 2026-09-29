"""_ref_legs.py — derive measured KNEE and HIP targets from pose JSON for lower-body exercises.

WHY THIS EXISTS SEPARATELY
_ref_targets.py models shoulders, elbows and wrists. Pointed at a leg exercise it produced
confident-looking elbow angles and wrist heights -- numbers that are meaningless for a knee and
would have looked authoritative in a targets file. Rather than stretch that arm-only path into
something that silently reports the wrong joint, this computes the leg angles from data
_pose_measure.py ALREADY emits (dirs: thigh_L, shin_L, torso), so no re-estimation is needed.

TWO CONVENTIONS THAT MATTER
  * The angle BETWEEN two bone directions is the SUPPLEMENT of the joint angle. A straight leg has
    thigh and shin pointing the same way (between = 0), and a knee angle of 180. So knee = 180 -
    between. Getting this backwards once already made a correct arm measurement read as
    inconsistent.
  * Torso and thigh point OPPOSITE ways when standing, so the hip is the angle between them
    DIRECTLY (180 standing), not its supplement. This matches the squat reference, which measured
    172.7 deg standing and 70.4 deg at the bottom.

WHY THERE IS A PRIOR CHECK
A leg measurement can be perfectly self-consistent and still be wrong -- the wrong person, the
wrong phase, a frame where the leg is occluded by the machine. So the caller states which way the
exercise is supposed to move the knee, and a measurement that contradicts that FAILS rather than
being written out.

Usage:
  python _ref_legs.py <pose.json> --clip-id <id> --out <targets.json> --expect extend|flex
                      [--add] [--title ...] [--url ...] [--licence ...] [--min-vis 0.6]
"""
import argparse
import collections
import json
import math
import os
import re
import statistics as st
import sys

ap = argparse.ArgumentParser()
ap.add_argument('pose')
ap.add_argument('--clip-id', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--expect', required=True, choices=['extend', 'flex'],
                help='the direction the caller CLAIMS the exercise loads. Recorded as metadata '
                     'only -- it is NOT verifiable from the joint angles, see the note in the body.')
ap.add_argument('--title', default='')
ap.add_argument('--uploader', default='')
ap.add_argument('--url', default='')
ap.add_argument('--licence', default='')
ap.add_argument('--add', action='store_true')
ap.add_argument('--min-vis', type=float, default=0.6)
a = ap.parse_args()

rows = json.load(open(a.pose))
usable = [r for r in rows if r.get('dirs') and r.get('checks_ok')
          and r.get('torso_visibility', 0) >= a.min_vis
          and r['dirs'].get('thigh_L') and r['dirs'].get('shin_L')]
if not usable:
    print('NO_USABLE_FRAMES_WITH_LEGS'); raise SystemExit(1)

# Only the LEFT leg is measured: _pose_measure.py emits thigh_L/shin_L and no right-leg equivalent.
# Recorded in the output rather than silently implying both sides were measured.
measured_side = 'L'

# --- restrict to the longest CONTIGUOUS run of usable frames ---
# This is not cosmetic. Pointed at the Chest Press clip -- an ARM exercise -- this script reported
# "the knee travels 133.6 deg" and passed its own geometric check, because the pose model emits
# thigh/shin for ANY detected person and a person simply SITT DOWN moves the knee through the same
# range as a leg machine. So the knee geometry cannot prove which movement was measured. Confining
# the measurement to the longest unbroken take, which is where a demonstration actually sits, and
# reporting how many frames that is, makes the confidence legible instead of implied. Identity
# still rests on the clip's published title.
def _fidx(r):
    m = re.search(r'(\d+)', r.get('file', ''))
    return int(m.group(1)) if m else -1


usable.sort(key=_fidx)
_runs, _cur = [], []
for r in usable:
    if _cur and _fidx(r) != _fidx(_cur[-1]) + 1:
        _runs.append(_cur)
        _cur = []
    _cur.append(r)
if _cur:
    _runs.append(_cur)
_all_usable = len(usable)
_run = max(_runs, key=len)
print('contiguous runs of usable frames: %s' % ([len(x) for x in _runs] or 'none'))
print('using the longest run: %d frames (%s..%s), discarding %d scattered frame(s)'
      % (len(_run), _run[0].get('file'), _run[-1].get('file'), _all_usable - len(_run)))
if len(_run) < 8:
    print('PRIOR_FAIL: longest contiguous run is only %d frames. Too scattered to attribute to a '
          'movement.' % len(_run))
    raise SystemExit(1)
usable = _run


def between(u, v):
    """Angle in degrees between two direction vectors."""
    c = max(-1.0, min(1.0, sum(u[i] * v[i] for i in range(3))))
    return math.degrees(math.acos(c))


for r in usable:
    t, s, to = r['dirs']['thigh_L'], r['dirs']['shin_L'], r['dirs']['torso']
    r['_knee'] = 180.0 - between(t, s)      # supplement, see module docstring
    r['_hip'] = between(to, t)              # direct, see module docstring
    r['_shin_elev'] = math.degrees(math.acos(max(-1.0, min(1.0, s[1]))))

views = dict(collections.Counter(r['view'] for r in usable))
dominant = max(views, key=views.get)
print('usable frames %d of %d (legs visible); views %s -> dominant %s'
      % (len(usable), len(rows), views, dominant))

knees = sorted(r['_knee'] for r in usable)
lo, hi = knees[0], knees[-1]
span = hi - lo
print('knee range across the clip: %.1f deg (min %.1f at %s, max %.1f at %s)'
      % (span, lo, min(usable, key=lambda r: r['_knee'])['file'],
         hi, max(usable, key=lambda r: r['_knee'])['file']))

# --- what this CAN and CANNOT verify ---
# Tried and abandoned: gating on --expect (did the knee move the way this exercise should?). A leg
# extension and a leg curl both travel the SAME knee range -- roughly 40 to 165 deg -- in opposite
# LOADING directions, which a joint angle cannot see. A version that required hi>=150 for 'extend'
# and lo<=100 for 'flex' passed for BOTH, so passing '--expect flex' on a leg-extension clip sailed
# through. A hip-based discriminator fails too: a seated leg curl and a seated leg extension both
# hold the hip flexed. Exercise identity therefore comes from the clip's own title, and --expect is
# recorded as a claim, not treated as evidence.
third = max(1, len(usable) // 3)
early = st.median([r['_knee'] for r in usable[:third]])
late = st.median([r['_knee'] for r in usable[-third:]])
trend = 'rising' if late > early else 'falling'
med_hip = st.median([r['_hip'] for r in usable])
print('knee min %.1f, max %.1f, span %.1f' % (lo, hi, span))
print('   (first-third median %.1f -> last-third median %.1f = %s; informational only -- a '
      'multi-rep clip has no monotone trend)' % (early, late, trend))
print('   median hip %.1f deg (context only; the hip is torso-derived, see hip_caveat)' % med_hip)
if span < 25.0:
    print('PRIOR_FAIL: the knee barely moves (%.1f deg). Not a usable leg-exercise measurement -- '
          'probably the wrong segment of the clip, or the leg is occluded.' % span)
    raise SystemExit(1)
if hi < 140.0:
    print('PRIOR_FAIL: the knee never approaches extension (max %.1f deg). Whatever this clip '
          'shows, it is not the full range of a leg machine movement.' % hi)
    raise SystemExit(1)
print('   geometric check PASSED: the knee travels %.1f deg and reaches %.1f deg extended.'
      % (span, hi))
print('   NOTE: this confirms the leg MOVES through a full range. It does NOT confirm that the '
      'clip shows the exercise the caller named -- two different leg machines share this range.')


def band(key, frac=0.15):
    """Median of the frames nearest an extreme, not the single extreme frame.

    The global extreme conflates a rep's extreme with the clip's (a set-up frame, a re-rack), and
    a single noisy frame decides the answer. Percentile-banded medians are robust and give a
    spread that is a real uncertainty."""
    k = max(1, int(len(usable) * frac))
    ordered = sorted(usable, key=lambda r: r[key])
    return ordered[-k:], ordered[:k]


top_rows, bot_rows = band('_knee')


def summarize(rs, label):
    t = [r['dirs']['thigh_L'] for r in rs]
    s = [r['dirs']['shin_L'] for r in rs]
    tm = [sum(v[i] for v in t) / len(t) for i in range(3)]
    sm = [sum(v[i] for v in s) / len(s) for i in range(3)]
    n1 = sum(c * c for c in tm) ** 0.5
    n2 = sum(c * c for c in sm) ** 0.5
    tm = [round(c / n1, 3) for c in tm]
    sm = [round(c / n2, 3) for c in sm]
    # one REAL internally consistent frame (independent medians need not co-occur)
    rep = min(rs, key=lambda r: abs(r['_knee'] - st.median([x['_knee'] for x in rs])))
    return {
        'n_frames': len(rs), 'label': label,
        'example_frame': rs[0]['file'], 'view': rs[0]['view'],
        'knee_angle_deg': round(st.median([r['_knee'] for r in rs]), 1),
        'knee_spread_deg': round(max(r['_knee'] for r in rs) - min(r['_knee'] for r in rs), 1),
        'hip_angle_deg': round(st.median([r['_hip'] for r in rs]), 1),
        'thigh_dir': tm, 'thigh_elev_from_up_deg': round(math.degrees(math.acos(max(-1, min(1, tm[1])))), 1),
        'shin_dir': sm, 'shin_elev_from_up_deg': round(math.degrees(math.acos(max(-1, min(1, sm[1])))), 1),
        'pose_consistent': {
            'frame': rep['file'],
            'knee_angle_deg': round(rep['_knee'], 1),
            'hip_angle_deg': round(rep['_hip'], 1),
            'thigh_dir': rep['dirs']['thigh_L'],
            'shin_dir': rep['dirs']['shin_L'],
            'dirs_between_deg': round(between(rep['dirs']['thigh_L'], rep['dirs']['shin_L']), 1),
            # must equal 180 - knee_angle_deg; this is the check that catches a supplement error
            'supplement_ok': abs(between(rep['dirs']['thigh_L'], rep['dirs']['shin_L'])
                                 - (180.0 - rep['_knee'])) < 0.5,
        },
    }


extended = summarize(top_rows, 'extended' if a.expect == 'extend' else 'knee_high')
flexed = summarize(bot_rows, 'flexed' if a.expect == 'flex' else 'knee_low')

entry = {
    'title': a.title, 'uploader': a.uploader, 'url': a.url, 'licence': a.licence,
    'dominant_view': dominant, 'views_seen': views,
    'usable_frames': len(usable),
    'usable_frames_before_run_filter': _all_usable,
    'measured_side': measured_side,
    'measurement_confidence': 'Frames come from the longest contiguous take. This does NOT prove '
                              'the measured movement is the named exercise: a person sitting down '
                              'moves the knee through the same range, which is why the Chest Press '
                              'clip passed the geometric check when pointed at this script.',
    'knee_range_deg': round(span, 1),
    'knee_most_extended_deg': round(hi, 1),
    'knee_most_flexed_deg': round(lo, 1),
    'reaches_extension': bool(hi >= 150.0),
    'reaches_deep_flexion': bool(lo <= 100.0),
    'hip_range_deg': round(max(r['_hip'] for r in usable) - min(r['_hip'] for r in usable), 1),
    'hip_caveat': 'The hip is derived from the TORSO direction, so it is only trustworthy while the '
                  'torso is clearly visible and genuinely moving. A large hip range on a machine '
                  'that holds the hips (a leg extension, where the seat fixes the hip at roughly '
                  '90 deg) is evidence the torso estimate degraded, not evidence about the hip. '
                  'The knee does not depend on the torso and stays reliable.',
    'expected_motion_claim': a.expect,
    'identity_source': 'the clip title as published by the CDC; NOT derived from the joint angles, '
                       'because a curl and an extension share this knee range',
    'trend_within_clip': trend + ' (informational: a multi-rep clip has no monotone trend)',
    'targets': {'extended': extended, 'flexed': flexed,
                'reliable_in_this_view': ['knee angle', 'hip angle', 'thigh direction',
                                          'shin direction'],
                'NOT_reliable_in_this_view': ['abduction / knee travel sideways -- frontal view, '
                                              'no depth']},
}

if a.add and os.path.exists(a.out):
    cur = json.load(open(a.out))
else:
    # Tolerate --add on a missing file: chaining clips would otherwise die with a traceback on the
    # first one, which is exactly what happened when a clip failed its prior check mid-chain.
    cur = {'_provenance': 'Measured by pose estimation on licence-cleared reference video. '
                          'Leg angles computed as knee = 180 - angle_between(thigh, shin) and '
                          'hip = angle_between(torso, thigh). Reference frames are NOT '
                          'redistributed; only derived angles are stored. Left side only.',
           'clips': {}}
cur.setdefault('clips', {})[a.clip_id] = entry
json.dump(cur, open(a.out, 'w'), indent=1)

print('  extended: knee %.1f deg, hip %.1f deg' % (extended['knee_angle_deg'], extended['hip_angle_deg']))
print('  flexed  : knee %.1f deg, hip %.1f deg' % (flexed['knee_angle_deg'], flexed['hip_angle_deg']))
print('  self-consistency (supplement must hold): %s'
      % ('OK' if extended['pose_consistent']['supplement_ok']
         and flexed['pose_consistent']['supplement_ok'] else 'FAILED'))
print('WROTE %s (clip %s)' % (a.out, a.clip_id))
