"""_ref_targets.py — turn measured reference poses into TARGETS a rig can be driven to.

This is the bridge between "a video of a human" and "an animation". It deliberately emits
DIRECTIONS (unit vectors for each limb segment in body-ish axes) rather than Euler angles,
because a direction cannot be rotated in the wrong plane: the press bug happened because I
authored an absolute rotation about the Y axis, which is abduction, and the arm swung out to
the side. Given a target direction, the rotation is derived, not guessed.

It also carries the trust flags through. A number is only emitted alongside the view it came
from, so a downstream fit can refuse the ones that are not observable in that view:
  FRONT view  -> lateral (x) is directly observed; fore/aft and hand separation in depth are not
  SIDE  view  -> fore/aft (x) is directly observed; lateral is depth-inferred
Vertical (y) and joint angles are view-independent and trustworthy everywhere.

Usage: python _ref_targets.py <pose.json> --clip-id <id> --out <targets.json> [--add]
"""
import json, sys, argparse, collections

ap = argparse.ArgumentParser()
ap.add_argument('pose')
ap.add_argument('--clip-id', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--title', default='')
ap.add_argument('--uploader', default='')
ap.add_argument('--url', default='')
ap.add_argument('--licence', default='')
ap.add_argument('--add', action='store_true', help='merge into an existing targets file')
ap.add_argument('--min-vis', type=float, default=0.6)
ap.add_argument('--extreme-by', choices=['wrist', 'elbow'], default='wrist',
                help='which quantity defines the two ends of the movement. wrist (default) suits a '
                     'press; elbow suits a curl or pushdown, where wrist height runs the other way '
                     'and selecting by it labels the bent-elbow frame "lockout".')
a = ap.parse_args()

rows = json.load(open(a.pose))
usable = [r for r in rows if r.get('dirs') and r.get('checks_ok') and r['torso_visibility'] >= a.min_vis]
if not usable:
    print('NO_USABLE_FRAMES'); raise SystemExit(1)

views = dict(collections.Counter(r['view'] for r in usable))
dominant = max(views, key=views.get)
print('usable frames %d of %d; views %s -> dominant %s' % (len(usable), len(rows), views, dominant))

def agg(rows, label):
    """Median of the frames near an extreme, plus their spread.

    Taking the single highest/lowest frame conflates a REP's extreme with the CLIP's extreme:
    the global minimum wrist height was the final frame of the video with the bar lowered to
    the thighs (elbow 125 deg), not the rack (elbow ~80 deg) that occurs five times. It is also
    just noisy. Percentile-selected medians are robust to that outlier and give a spread, which
    is a real uncertainty rather than a false precision.
    """
    import statistics as st
    import math

    def med(key):
        vals = [r['world'][key] for r in rows if key in r.get('world', {})]
        return round(st.median(vals), 3) if vals else None

    def med_dir(key):
        vals = [r['dirs'][key] for r in rows if key in r.get('dirs', {})]
        if not vals:
            return None
        v = [sum(x[i] for x in vals) / len(vals) for i in range(3)]
        n = sum(c * c for c in v) ** 0.5
        return [round(c / n, 3) for c in v] if n > 1e-9 else None

    def elev(v):
        return round(math.degrees(math.acos(max(-1.0, min(1.0, v[1])))), 1) if v else None

    ua, fa, to = med_dir('upper_arm_L'), med_dir('forearm_L'), med_dir('torso')
    hs = [r['world']['wrist_above_shoulder_m'] for r in rows]
    # Independent field medians need not come from the SAME frame, so the angle between the
    # median upper arm and the median forearm came out 96.5 deg where the directly measured
    # elbow was 80.7 deg -- a combination that never actually occurred. Also emit one real,
    # internally consistent frame: the one closest to the median wrist height.
    med_wrist = st.median(hs)
    rep = min(rows, key=lambda r: abs(r['world']['wrist_above_shoulder_m'] - med_wrist))
    ru, rf = rep['dirs']['upper_arm_L'], rep['dirs']['forearm_L']
    cosang = max(-1.0, min(1.0, sum(ru[i] * rf[i] for i in range(3))))
    between = round(math.degrees(math.acos(cosang)), 1)
    measured_elbow = round(rep['world']['elbow_angle_L'], 1)
    return {
        'n_frames': len(rows), 'label': label,
        'example_frame': rows[0]['file'], 'view': rows[0]['view'],
        'torso_vis_min': min(r['torso_visibility'] for r in rows),
        'wrist_above_shoulder_m': med('wrist_above_shoulder_m'),
        'wrist_above_spread_m': round(max(hs) - min(hs), 3) if hs else None,
        'elbow_angle_deg': med('elbow_angle_L'),
        'upper_arm_dir': ua, 'upper_arm_elev_from_up_deg': elev(ua),
        'forearm_dir': fa, 'forearm_elev_from_up_deg': elev(fa),
        'torso_dir': to, 'torso_elev_from_up_deg': elev(to),
        'hand_separation_x_m': med('hand_separation_x_m'),
        'hand_separation_z_m': med('hand_separation_z_m'),
        'trust_lateral': rows[0]['trust_lateral'], 'trust_foreaft': rows[0]['trust_foreaft'],
        # a single REAL pose, internally consistent by construction -- this is what a rig
        # should be driven to, with the field medians kept only as the uncertainty
        'pose_consistent': {
            'frame': rep['file'],
            'upper_arm_dir': ru, 'forearm_dir': rf,
            'dirs_between_deg': between, 'measured_elbow_deg': measured_elbow,
            # The angle BETWEEN two bone directions is the SUPPLEMENT of the joint angle: a 124.6 deg
            # elbow IS 55.4 deg between the upper arm and forearm. Comparing the two directly marked
            # a perfectly consistent measurement as inconsistent (dirs_agree=false on an exact match).
            'dirs_agree': abs(between - (180.0 - measured_elbow)) < 12.0,
            'elbow_angle_deg': measured_elbow,
            'wrist_above_shoulder_m': rep['world']['wrist_above_shoulder_m'],
            'hand_separation_x_m': rep['world']['hand_separation_x_m'],
            'torso_dir': rep['dirs']['torso'],
        },
    }

# Frames near each end of the movement, not the single extreme frame.
#
# WHICH field defines "each end" is a real choice, and getting it wrong silently measures the wrong
# frames while still printing confident numbers. Selecting by wrist HEIGHT is correct for a press
# (lockout = wrist highest) and INVERTED for a pushdown: there the elbow is most extended at the
# wrist's LOWEST point. Pointed at the CDC arm-extension clip, the wrist-height rule reported
# "lockout 51.7 deg" -- a strongly FLEXED elbow -- and "racked 134.6 deg", i.e. the whole movement
# read backwards. --extreme-by elbow selects on the elbow angle itself, so the two ends are the
# joint's own extremes whatever the exercise does with wrist height.
if a.extreme_by == 'elbow':
    def _key(r):
        return (r['world']['elbow_angle_L'] + r['world']['elbow_angle_R']) / 2.0
    _unit = 'deg'
    _hi_name, _lo_name = 'most-extended', 'most-flexed'
else:
    def _key(r):
        return r['world']['wrist_above_shoulder_m']
    _unit = 'm'
    _hi_name, _lo_name = 'lockout', 'racked'
ks_all = sorted(_key(r) for r in usable)
p_hi = ks_all[int(0.92 * (len(ks_all) - 1))]
p_lo = ks_all[int(0.08 * (len(ks_all) - 1))]
hi_rows = [r for r in usable if _key(r) >= p_hi]
lo_rows = [r for r in usable if _key(r) <= p_lo]
if not hi_rows or not lo_rows:
    print('PRIOR_FAIL: could not form extreme bands from "%s" -- refusing to write targets rather '
          'than describe the whole clip as one end of a movement' % a.extreme_by)
    raise SystemExit(1)
print('extreme bands, selected by %s: %s >= %.3f %s (%d frames), %s <= %.3f %s (%d frames)'
      % (a.extreme_by, _hi_name, p_hi, _unit, len(hi_rows), _lo_name, p_lo, _unit, len(lo_rows)))
if a.extreme_by == 'elbow':
    print('   NOTE: the stored keys are still named lockout/racked for schema stability, but they '
          'mean most-extended/most-flexed here, NOT the press positions.')

targets = {
    'lockout': agg(hi_rows, _hi_name),
    'racked': agg(lo_rows, _lo_name),
    'extreme_selected_by': a.extreme_by,
    'naming_caveat': ('lockout/racked here mean most-extended/most-flexed, not the press positions'
                      if a.extreme_by == 'elbow' else
                      'lockout/racked are the press positions, selected by wrist height'),
    'reliable_in_this_view': (['elbow angle', 'upper arm direction', 'forearm direction',
                               'wrist height above shoulder', 'torso lean']
                              + (['lateral hand separation'] if hi_rows[0]['trust_lateral'] else [])
                              + (['fore/aft hand position'] if hi_rows[0]['trust_foreaft'] else [])),
    'NOT_reliable_in_this_view': ([] if hi_rows[0]['trust_lateral'] else ['lateral hand separation -- depth-inferred'])
                                 + ([] if hi_rows[0]['trust_foreaft'] else ['fore/aft position -- depth-inferred']),
}

out = {}
if a.add:
    try: out = json.load(open(a.out))
    except Exception: out = {}
out.setdefault('_provenance', 'Measured by pose estimation on licence-cleared reference video. '
                              'Reference frames are NOT redistributed; only derived angles are stored.')
out.setdefault('clips', {})
out['clips'][a.clip_id] = {
    'title': a.title, 'uploader': a.uploader, 'url': a.url, 'licence': a.licence,
    'dominant_view': dominant, 'views_seen': views, 'usable_frames': len(usable),
    'targets': targets,
}
json.dump(out, open(a.out, 'w'), indent=1)

print()
for name in ('lockout', 'racked'):
    t = targets[name]
    print('%-8s %s  view=%s  (%d frames, torso_vis >= %.2f)'
          % (name, t['example_frame'], t['view'], t['n_frames'], t['torso_vis_min']))
    print('   wrist %+.3f m above shoulder | elbow %.1f deg' % (t['wrist_above_shoulder_m'], t['elbow_angle_deg']))
    print('   upper_arm dir %s  (%.1f deg from straight up)' % (t['upper_arm_dir'], t['upper_arm_elev_from_up_deg']))
    print('   forearm   dir %s  (%.1f deg)' % (t['forearm_dir'], t['forearm_elev_from_up_deg']))
    print('   hands apart: x=%.3f z=%.3f  lateral_trust=%s' % (t['hand_separation_x_m'], t['hand_separation_z_m'], t['trust_lateral']))
print()
print('WROTE %s (clip %s)' % (a.out, a.clip_id))
