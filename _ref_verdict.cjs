/* _ref_verdict.cjs — turn the raw coverage probe into an honest, licence-gated verdict.

The first version of the audit classified on TITLE MATCH ALONE, and immediately produced an
"EXACT" match for a Barbell Bench Press on archive.org whose licence field read UNKNOWN. That is
the single most dangerous output this tool can give: a reference that looks authoritative and
cannot legally be used, or worse, is used and then has to be withdrawn. Licence is therefore a
GATE, not a note. A candidate is only counted as coverage when its licence is identified AND
permits reuse, and only then does the title verdict decide EXACT vs VARIANT.

It also separates the two questions the goal asks, because they fail independently:
  * is there a reference at all?          -> COVERAGE
  * is it the SAME movement?              -> exact / lookalike
An exercise can be well covered by a lookalike and have no exact reference (the CDC "Leg Curl"
may be seated where the Library's is lying), which is a different conclusion from "nothing".

Reclassifying from the saved JSON rather than re-probing is deliberate: the network sweep is the
slow, rate-limited part and it is already recorded, so a fix to the rules costs seconds.

Run: node _ref_verdict.cjs [_ref/coverage.json]
*/
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SRC = process.argv[2] || path.join('_ref', 'coverage.json');
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// ---- licence gate -------------------------------------------------------------
// Ordered: share-alike is checked before plain attribution because "CC BY-SA" contains "CC BY".
function licenceClass(text, confirmed) {
  const t = String(text || '') + ' ' + String(confirmed || '');
  if (/public domain|pd-|no known copyright|no restrictions|cc0/i.test(t)) return 'PD';
  if (/by-sa|share ?alike/i.test(t)) return 'CC-BY-SA';
  if (/cc by|creative commons attribution/i.test(t)) return 'CC-BY';
  if (/creative commons/i.test(t)) return 'CC-UNSPECIFIED';
  return 'UNUSABLE';
}
const REUSABLE = new Set(['PD', 'CC-BY', 'CC-BY-SA', 'CC-FILTER']);

const RANK = { EXACT: 0, VARIANT: 1, WEAK: 2 };
const rows = [];

for (const e of Object.values(raw.exercises)) {
  const cands = [];
  const push = (src, c) => {
    if (!c || !c.title) return;
    // Licence is a gate, but a gate has to distinguish "no licence" from "licence asserted by a
    // weaker source". Collapsing those two produced five false NONE verdicts: a YouTube hit whose
    // full-extraction confirmation failed was marked UNUSABLE even though the CC search filter
    // had already established the licence, so Cable Chest Fly, Overhead Triceps Extension,
    // Walking Lunge, Standing Calf Raise and Glute Bridge were all reported as uncovered when a
    // direct re-probe found clear CC references for every one of them.
    let cls, evidence;
    if (src === 'youtube_cc') {
      const conf = e.youtube_licence_confirmed;
      if (conf && /creative commons|cc by/i.test(conf)) {
        cls = licenceClass('', conf); evidence = 'licence field: ' + String(conf).slice(0, 40);
      } else {
        cls = 'CC-FILTER'; evidence = 'YouTube CC search filter only (field confirmation unavailable)';
      }
    } else {
      cls = licenceClass(c.licence); evidence = 'field: ' + String(c.licence).slice(0, 40);
    }
    cands.push({ src, ...c, licence_class: cls, evidence, reusable: REUSABLE.has(cls) });
  };
  (e.commons || []).forEach((c) => push('commons', c));
  (e.archive || []).forEach((c) => push('archive', c));
  (e.youtube_cc || []).forEach((c) => push('youtube_cc', c));

  const usable = cands.filter((c) => c.reusable && c.verdict !== 'WEAK');
  const exact = usable.filter((c) => c.verdict === 'EXACT');
  const variant = usable.filter((c) => c.verdict === 'VARIANT');
  const best = exact[0] || variant[0] || null;

  rows.push({
    id: e.id, name: e.name, group: e.group, equipment: e.equipment,
    licence_clear_exact: exact.length,
    licence_clear_variant: variant.length,
    usable_total: usable.length,
    rejected_licence: cands.length - cands.filter((c) => c.reusable).length,
    verdict: exact.length ? 'EXACT' : variant.length ? 'LOOKALIKE_ONLY' : 'NONE',
    best: best ? { src: best.src, title: best.title, licence_class: best.licence_class,
                   url: best.url, verdict: best.verdict } : null,
  });
}

const summary = {
  EXACT: rows.filter((r) => r.verdict === 'EXACT').length,
  LOOKALIKE_ONLY: rows.filter((r) => r.verdict === 'LOOKALIKE_ONLY').length,
  NONE: rows.filter((r) => r.verdict === 'NONE').length,
};

console.log('LICENCE-GATED COVERAGE over %d exercises', rows.length);
console.log('  EXACT usable reference        : %d', summary.EXACT);
console.log('  LOOKALIKE only (no exact)     : %d', summary.LOOKALIKE_ONLY);
console.log('  NONE licence-clear            : %d', summary.NONE);
console.log();
for (const r of rows) {
  const b = r.best;
  // padEnd, not '%-13s': Node's console.log supports %s/%d but NOT printf width modifiers, so a
  // %-13s format string silently evaluates 'string' % array -> NaN and prints NaN for every row.
  console.log('  ' + r.id.padEnd(13) + ' ' + r.name.slice(0, 26).padEnd(27)
    + r.verdict.padEnd(18) + (b ? (b.licence_class + '  ' + String(b.title).slice(0, 52)) : '--'));
}

fs.writeFileSync(path.join('_ref', 'coverage_verdict.json'), JSON.stringify({
  _provenance: 'Licence-gated coverage verdict. Licence is a GATE: a candidate whose licence is '
    + 'unknown or does not permit reuse is never counted as coverage, however well its title '
    + 'matches. No reference media is redistributed here; entries are links and licence classes.',
  generated: new Date().toISOString(), summary, exercises: rows,
}, null, 1));

console.log();
console.log('NO LICENCE-CLEAR REFERENCE AT ALL:');
for (const r of rows.filter((x) => x.verdict === 'NONE')) console.log('  - ' + r.id + '  ' + r.name);
console.log();
console.log('LOOKALIKE ONLY -- usable licence, but the movement differs. These are the ones that need');
console.log('a judgement call, because using them silently would be worse than using nothing:');
for (const r of rows.filter((x) => x.verdict === 'LOOKALIKE_ONLY'))
  console.log('  - %s  %s  ->  %s', r.id.padEnd(13), r.name.slice(0, 24).padEnd(25),
    r.best ? String(r.best.title).slice(0, 58) : '');
console.log('\nWROTE _ref/coverage_verdict.json');
