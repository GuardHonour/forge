"""_ref_rep.py — choose the CRUCIAL FRAMES of a reference clip by measurement, not by eye.

The point of a reference video is a rep, but a technique video is mostly talking, setup and
titles. Watching 561 seconds to find the 3 that matter is exactly the kind of thing I am bad
at, so the rep is located from the pose signal instead.

Signal: wrist height above the shoulder. For a press that rises from a low point to a high one
and back, which is a rep. A valid rep must:
  * start and end near a local minimum and reach a clear maximum (span > --min-span)
  * hold a trustworthy torso on BOTH end frames (--min-vis), because the shoulder angle is
    computed against the torso; a frame where the hips were occluded by a chair yields a
    confident, wrong shoulder angle
  * be monotonic enough to be a rep rather than a camera cut or a person walking in

Outputs the frame indices at the rep's phases, mapped onto the app's own tempo (eccentric 1500,
hold 320, concentric 1000, hold 320 ms), so the reference and the FORGE animation are sampled
at the SAME points in the movement.

Usage: python _ref_rep.py <pose.json> [--min-span 0.15] [--min-vis 0.4] [--fps 2]
"""
import json, sys, argparse

ap = argparse.ArgumentParser()
ap.add_argument('pose')
ap.add_argument('--min-span', type=float, default=0.15)
ap.add_argument('--min-vis', type=float, default=0.4)
ap.add_argument('--fps', type=float, default=2.0)
a = ap.parse_args()

rows = json.load(open(a.pose))
seq = []
for r in rows:
    if not r.get('detected') or not r.get('world'):
        seq.append(None); continue
    w = r['world']
    seq.append({'file': r['file'], 'h': w['wrist_above_shoulder_m'],
                'vis': r['torso_visibility'], 'elbow': w['elbow_angle_L'],
                'sh': w['shoulder_angle_L'], 'sep': w['hand_separation_m'],
                'vis2': r['image']})
print('frames=%d usable=%d' % (len(seq), sum(1 for s in seq if s)))
hs = [s['h'] if s else None for s in seq]
print('wrist-above-shoulder range %.3f .. %.3f m'
      % (min(x for x in hs if x is not None), max(x for x in hs if x is not None)))

# A rep is a contiguous run with trustworthy torso, from a low wrist to a high wrist and back.
best = None
i = 0
while i < len(seq):
    if not seq[i] or seq[i]['vis'] < a.min_vis:
        i += 1; continue
    j = i
    while j < len(seq) and seq[j] and seq[j]['vis'] >= a.min_vis:
        j += 1
    run = list(range(i, j))
    if len(run) >= 6:
        bot = min(run, key=lambda k: seq[k]['h'])     # lowest wrist  = bottom of the press
        top = max(run, key=lambda k: seq[k]['h'])     # highest wrist = lockout
        span = seq[top]['h'] - seq[bot]['h']
        if span >= a.min_span and abs(top - bot) >= 2:
            # prefer a long trustworthy run with a big span
            score = span * (len(run) ** 0.5)
            if best is None or score > best['score']:
                best = {'score': score, 'run': (i, j - 1), 'bot': bot, 'top': top, 'span': span}
    i = j if j > i else i + 1

if not best:
    print('NO_REP_FOUND — no trustworthy run spans %.2f m' % a.min_span)
    raise SystemExit(0)

bot, top = best['bot'], best['top']          # lowest and highest wrist, by HEIGHT
first, second = (bot, top) if bot < top else (top, bot)
print('REP bottom@%s (idx %d)  top@%s (idx %d)  span %.3f m, trustworthy run %s'
      % (seq[bot]['file'], bot, seq[top]['file'], top, best['span'], best['run']))
print('ORDER: motion goes %s first, so this is a %s rep'
      % ('UP' if bot < top else 'DOWN', 'concentric-first' if bot < top else 'eccentric-first'))

# The app's tempo, applied to the half-cycle between the two extremes so the reference and the
# FORGE animation are sampled at the SAME points. Interpolating between bottom and top keeps
# the names honest: no index swap, so 'top' can never quietly mean 'bottom'.
TEMPO = [('ecc', 1500), ('hold', 320), ('con', 1000), ('hold', 320)]
total = sum(d for _, d in TEMPO)
print('tempo marks (fraction of cycle): ' + ', '.join('%s@%.2f' % (n, acc / total)
      for n, acc in [(TEMPO[0][0], 0)] + [(n, sum(d for _, d in TEMPO[:i + 1])) for i, (n, d) in enumerate(TEMPO)]))
print()
print('%6s %-14s %8s %8s %8s %8s %8s  %s' % ('idx', 'file', 'wrist_h', 'torsoVis', 'elbow', 'shldr', 'hands', 'phase'))
def sample(frac):
    """frac 0 = an extreme; walk bottom<->top, going up then back down"""
    return round(bot + (top - bot) * frac)
marks = []
for name, frac in (('bottom/ecc', 0.0), ('25%up', 0.25), ('mid', 0.5), ('75%up', 0.75), ('top/lockout', 1.0)):
    idx = max(min(bot, top), min(max(bot, top), sample(frac)))
    s = seq[idx]
    marks.append({'name': name, 'frac': frac, 'idx': idx})
    print('%6d %-14s %8.3f %8.2f %8.1f %8.1f %8.3f  %s'
          % (idx, s['file'], s['h'], s['vis'], s['elbow'], s['sh'], s['sep'], name))
json.dump({'bot': bot, 'top': top, 'bot_file': seq[bot]['file'], 'top_file': seq[top]['file'],
           'span': best['span'], 'fps': a.fps, 'marks': marks},
          open(a.pose.replace('.json', '_rep.json'), 'w'), indent=1)
print('WROTE %s' % a.pose.replace('.json', '_rep.json'))
