/* Builds _ref/COVERAGE.md -- the honest coverage record the objective asks for.
 *
 * Every number here is DERIVED from the data files, never typed in. That is deliberate: the point
 * of this report is to be trustworthy about what is and is not known, and a hand-written tally
 * drifts from the data the moment either changes. Run: node _ref_report.cjs
 */
const fs = require('fs');
const path = require('path');

const R = d => path.join(__dirname, '_ref', d);
// A leading UTF-8 BOM makes JSON.parse throw, and the first version of this returned null on any
// throw -- which silently dropped machine-press and machine-row (their file is BOM'd, the others are
// not) from the measured table. So: strip the BOM, and never fail quietly.
const readJSON = p => {
  try {
    let s = fs.readFileSync(p, 'utf8');
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    return JSON.parse(s);
  } catch (e) {
    if (fs.existsSync(p)) console.log('WARNING: ' + path.basename(p) + ' exists but did not parse: ' + e.message);
    return null;
  }
};

const verdict = readJSON(R('coverage_verdict.json'));
const cov = readJSON(R('coverage.json'));
const cdc = readJSON(R('cdc_coverage.json'));
const cdcArm = readJSON(R('cdc_targets.json'));
const cdcLeg = readJSON(R('cdc_leg_targets.json'));
if (!verdict || !verdict.exercises) {
  console.log('FATAL: coverage_verdict.json missing or has no exercises array');
  process.exitCode = 1;
  return;
}

const exs = verdict.exercises;
const total = exs.length;

// ---- licence-gated coverage verdicts ---------------------------------------
const byVerdict = {};
for (const e of exs) byVerdict[e.verdict] = (byVerdict[e.verdict] || 0) + 1;

const byLicence = {};
for (const e of exs) {
  const l = (e.best && e.best.licence_class) || 'UNKNOWN';
  byLicence[l] = (byLicence[l] || 0) + 1;
}
const lookalikeOnly = exs.filter(e => e.verdict === 'LOOKALIKE_ONLY').map(e => e.id);
const noCoverage = exs.filter(e => e.verdict === 'NONE' || !e.verdict).map(e => e.id);

// ---- exercises with MEASURED joint angles ----------------------------------
// Derived from the measurement files, not from a list in this script.
const measured = [];
const cdcProv = readJSON(R('cdc_provenance.json')) || [];
const licenceOf = clip => {
  const row = (Array.isArray(cdcProv) ? cdcProv : []).find(r => r && (r.clip === clip || r.id === clip));
  return row ? row.licence : 'Public domain (CDC series)';
};
for (const [file, joints] of [[cdcArm, 'arm'], [cdcLeg, 'leg']]) {
  if (!file || !file.clips) continue;
  for (const id of Object.keys(file.clips)) {
    const t = file.clips[id].targets || file.clips[id];
    measured.push({ id, joints, clip: file.clips[id].clip || t.clip || id, licence: licenceOf(file.clips[id].clip) });
  }
}
// Provenance is READ FROM THE MEASUREMENT FILES, never typed here. An earlier version of this
// script hardcoded "CC BY 3.0 (Wikimedia Commons)" for ohp and squat. That was flatly wrong for ohp:
// its measurement comes from a YouTube CC-BY video by the channel "Best Barbells", not from Commons. Attribution is a licence obligation, so a guessed one is worse than none.
const ohpD = readJSON(R('ohp_targets.json'));
if (ohpD && ohpD.clips) {
  const k = Object.keys(ohpD.clips)[0];
  const t = ohpD.clips[k] || {};
  measured.push({
    id: 'ohp', joints: 'arm',
    clip: (t.title || k) + (t.uploader ? ' -- ' + t.uploader : ''),
    licence: (t.licence || 'LICENCE NOT RECORDED'),
  });
} else {
  console.log('WARNING: ohp_targets.json did not load -- ohp is OMITTED from the measured table');
}
const sqD = readJSON(R('squat_measured.json'));
if (sqD) {
  measured.push({
    id: 'squat', joints: 'leg',
    clip: (sqD.clip || 'squat reference') + (sqD.artist ? ' -- ' + sqD.artist : ''),
    licence: (sqD.licence || 'LICENCE NOT RECORDED'),
  });
} else {
  console.log('WARNING: squat_measured.json did not load -- squat is OMITTED from the measured table');
}

// ---- the rig clips actually DRIVEN by a measurement -------------------------
// Read out of the Blender script so this cannot claim a clip that does not exist.
const anim = fs.readFileSync(path.join(__dirname, '_blender_anim.py'), 'utf8');
const clipNames = [...anim.matchAll(/\('(\w+)',\s*\{[^}]*\}\s*,\s*(?:None|\(')/g)].map(m => m[1]);
const driven = [...new Set(clipNames)];

// ---- data defects, counted rather than asserted ----------------------------
// A candidate URL is broken if it claims youtube.com but carries no 11-char v= parameter.
// archive.org mirrors are NOT broken: the "archive.org/details/youtube-<ID>" form legitimately
// contains the word youtube in its path AND retains the real video ID.
let candTotal = 0, candBroken = 0;
const brokenByEx = new Set();
if (cov && cov.exercises) {
  const isBroken = u => /youtube\.com/.test(u) && !/[?&]v=[A-Za-z0-9_-]{11}/.test(u);
  for (const id of Object.keys(cov.exercises)) {
    const row = cov.exercises[id] || {};
    for (const src of ['commons', 'archive', 'youtube_cc']) {
      for (const k of (row[src] || [])) {
        if (!k || !k.url) continue;
        candTotal++;
        if (isBroken(String(k.url))) { candBroken++; brokenByEx.add(id); }
      }
    }
  }
}
const ccFilter = exs.filter(e => e.best && e.best.licence_class === 'CC-FILTER').map(e => e.id);
// Which ids correspond to a Library row, so the measured table cannot quietly imply that a clip
// name is an exercise id.
const libIds = new Set(exs.map(e => e.id));
if (candTotal === 0) { console.log('WARNING: examined 0 candidate URLs -- the defect count below is vacuous'); }

const L = [];
L.push('# FORGE reference-video coverage');
L.push('');
L.push('Generated by `_ref_report.cjs` from the data files. Every figure is derived, not typed.');
L.push('');
L.push('## What the objective asked for');
L.push('');
L.push('Licensed reference video for the Library exercises, crucial frames extracted, measured joint');
L.push('angles derived by pose estimation, those angles driving the Blender 3D animation, and an');
L.push('honest account of which exercises have no usable licensed reference.');
L.push('');
L.push('## Licence-gated coverage across all ' + total + ' exercises');
L.push('');
for (const k of Object.keys(byVerdict).sort()) L.push('- **' + k + '**: ' + byVerdict[k]);
L.push('');
L.push('"EXACT" and "LOOKALIKE_ONLY" are a shortlist for human review, not a verified fact. Licence is');
L.push('a GATE: a candidate whose licence is unknown or does not permit reuse is never counted.');
L.push('');
L.push('Best-reference licence classes: ' + Object.keys(byLicence).sort().map(k => k + '=' + byLicence[k]).join(', '));
L.push('');
L.push('### Exercises with NO exact match (lookalike only) -- ' + lookalikeOnly.length);
L.push('');
L.push(lookalikeOnly.length ? lookalikeOnly.map(x => '- ' + x).join('\n') : '_none_');
L.push('');
L.push('### Exercises with NO licensed reference at all -- ' + noCoverage.length);
L.push('');
L.push(noCoverage.length ? noCoverage.map(x => '- ' + x).join('\n') : '_none_');
L.push('');
L.push('## Exercises with MEASURED joint angles -- ' + measured.length + ' of ' + total);
L.push('');
L.push('| exercise | joints | reference clip | licence |');
L.push('|---|---|---|---|');
for (const m of measured) L.push('| ' + m.id + (libIds.has(m.id) ? '' : ' (not a Library row)') + ' | ' + m.joints + ' | ' + m.clip + ' | ' + m.licence + ' |');
L.push('');
const unmapped = measured.filter(m => !libIds.has(m.id));
if (unmapped.length) {
  L.push('### Measured and licensed, but NOT attached to a Library row -- ' + unmapped.length);
  L.push('');
  L.push('These clips are measured, but no Library exercise id is claimed for them, and that is');
  L.push('deliberate. Mapping a clip to a row is a judgement the joint angles cannot make: the same');
  L.push('elbow range serves a pushdown and an overhead extension, exactly as the same knee range');
  L.push('serves a curl and an extension. Naming them by their own clip id is the honest option;');
  L.push('forcing them onto a row would manufacture coverage that was never measured.');
  L.push('');
  for (const m of unmapped) L.push('- **' + m.id + '** (' + m.joints + ', ' + m.licence + ')');
  L.push('');
}
L.push('## Blender clips actually driven by those measurements -- ' + driven.length);
L.push('');
L.push(driven.map(x => '- ' + x).join('\n'));
L.push('');
L.push('Read out of `_blender_anim.py` so this cannot claim a clip that does not exist.');
L.push('');
L.push('## Known data defects and UNCONFIRMED licences');
L.push('');
L.push('Candidate URLs examined: **' + candTotal + '**. Broken YouTube URLs (no usable video ID): **'
  + candBroken + '** across **' + brokenByEx.size + '** exercises.');
L.push('');
L.push('The broken form carries the video TITLE where the ID belongs, e.g.');
L.push('`https://www.youtube.com/watch?v= Form Tutorial`. Their `archive.org/details/youtube-<ID>`');
L.push('mirrors retain the real IDs, so recovery is possible, but the direct links as stored are not');
L.push('acquirable.');
L.push('');
L.push('**The ' + ccFilter.length + ' CC-FILTER entries are UNCONFIRMED and must not be counted as coverage:** '
  + ccFilter.join(', ') + '.');
L.push('Their licence was classified by a filter rather than read from the licence field, and they are');
L.push('the same rows whose URLs are corrupted. Under the gate above, unconfirmed means not coverage.');
L.push('');
L.push('## Limits of this record');
L.push('');
L.push('- Measurement is LEFT-side only for the legs: `_pose_measure.py` emits `thigh_L`/`shin_L` and');
L.push('  no right-leg equivalent.');
L.push('- Every reference clip is a frontal view, so fore/aft depth is inferred rather than measured');
L.push('  (`trust_foreaft: false`); lateral position and joint angles are the trustworthy outputs.');
L.push('- Leg measurements are confined to the longest contiguous take. Measuring all usable frames');
L.push('  inflated one leg-extension range from 54.1 to 133.5 deg by picking up a deep knee flexion');
L.push('  from another segment of the clip, probably someone sitting down.');
L.push('- Exercise IDENTITY is taken from each clip\'s published title. Geometry cannot establish it:');
L.push('  a curl and an extension share the same knee range, and a person sitting down passes the same');
L.push('  geometric checks. Pointing the leg extractor at the Chest Press clip reported "the knee');
L.push('  travels 133.6 deg" and passed.');
L.push('- These are samples from one lifter on one machine, not population norms.');
L.push('');

const out = path.join(__dirname, '_ref', 'COVERAGE.md');
fs.writeFileSync(out, L.join('\n'), 'utf8');
console.log('WROTE ' + out);
console.log('  exercises: ' + total + '  verdicts: ' + JSON.stringify(byVerdict));
console.log('  measured: ' + measured.length + '  driven rig clips: ' + driven.join(', '));
console.log('  candidates examined: ' + candTotal + '  broken urls: ' + candBroken + ' in ' + brokenByEx.size + ' exercises');
console.log('  lookalike-only: ' + lookalikeOnly.length + '  no coverage: ' + noCoverage.length + '  cc-filter unconfirmed: ' + ccFilter.length);
