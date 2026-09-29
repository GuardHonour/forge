/* _build_deploy.cjs — build a MINIMAL, DEPLOYABLE FORGE on top of the LIVE bytes.

   WHY THIS EXISTS
   The working tree carries TWO independent pieces of uncommitted work at once:

     (a) this session's fix — the plate grid (every prescribed load on an increment the
         gym actually has) and the Train card stating today's load once; and
     (b) another agent's MID-DEVELOPMENT FORGE-3D clip work: ~27 KB of new and rewritten
         _s3d_*.js clips, spliced between the FORGE-3D markers.

   `index.html` is one file, so `git add index.html` would ship BOTH to the single origin
   that holds the user's real training log. Shipping an unfinished, ungated feature in
   order to deliver a legibility fix is the trade _make_iosfix.cjs already refused to
   make, and the reasoning is identical here.

   WHAT IT DOES
   Takes the bytes that are actually LIVE (origin/main) and applies ONLY the hunks
   belonging to (a), taken from the real `git diff origin/main`. Nothing is retyped, so
   there is no transcription drift. The result is then read back and asserted.

   HOW A HUNK IS CLASSIFIED
   Structurally, not by eye. The FORGE-3D payload is a contiguous region between the
   markers _build_app3d.cjs emits, so "is this the 3D agent's hunk?" is answered by
   whether any line the hunk CHANGES lands inside that region — not by the hunk's start
   line, because unified diffs carry context and the hunk that rewrites the payload's
   generated-header comment legitimately begins three lines above the BEGIN marker.
   Two further hunks are excluded by explicit content signature: comment-only tweaks to
   the iOS safe-area block belonging to a third change.

   EVERY DECISION IS ASSERTED. A dropped hunk that is neither in the 3D region nor one
   of those two signatures is a hard error, so a future unrelated change cannot be
   silently omitted from a deploy.

   WHY IT DOES NOT USE `git apply`
   Two traps, both hit before this was written. (1) A `git worktree` checkout runs the
   file through core.autocrlf/.gitattributes and came back CRLF — +1 char per line, 2507
   of them — which would have rewritten every line of the committed file. (2) Running
   `git apply` from inside _deploy/ still resolves paths against the REPOSITORY ROOT, so
   it applied nothing here and reported success. Applying the hunks in-process, against
   the raw blob, with every context line verified, is both byte-exact and loud.
*/
'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const OUT = path.join(HERE, '_deploy');
const LIVE_REF = 'origin/main';
const FILES = ['index.html', 'sw.js'];

const sh = (cmd, opts) => cp.execSync(cmd, { cwd: HERE, maxBuffer: 1 << 28, ...opts }).toString();
const blob = ref => cp.execSync(`git show ${LIVE_REF}:${ref}`, { cwd: HERE, maxBuffer: 1 << 28 });
const sha = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
function fail(msg) { console.error('\n_BUILD_DEPLOY: ' + msg); process.exit(1); }

const THREE_D_BEGIN = 'FORGE-3D BEGIN';
const THREE_D_END = 'FORGE-3D END';

function threeRegion(text) {
  const i = text.indexOf(THREE_D_BEGIN);
  const j = text.indexOf(THREE_D_END);
  if (i < 0 || j < 0 || j < i) fail('could not find the FORGE-3D markers in the live build');
  const begin = text.lastIndexOf('\n', i) + 1;
  const end = text.indexOf('\n', j) + 1;
  return {
    begin,
    end,
    startLine: text.slice(0, begin).split('\n').length,
    endLine: text.slice(0, end).split('\n').length - 1
  };
}

/* a hunk belongs to the 3D payload if any line it CHANGES lands inside the region */
function hunkTouchesRegion(h, reg) {
  let old = h.oldStart;
  for (const line of h.body) {
    if (line.startsWith('+')) {
      if (old >= reg.startLine && old <= reg.endLine) return true;
    } else if (line.startsWith('-')) {
      if (old >= reg.startLine && old <= reg.endLine) return true;
      old++;
    } else {
      old++;
    }
  }
  return false;
}

function parseHunks(patch) {
  const hunks = [];
  let cur = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) fail('unparseable hunk header: ' + line);
      cur = { header: line, oldStart: Number(m[1]), body: [] };
      hunks.push(cur);
      continue;
    }
    if (cur) cur.body.push(line);
  }
  return hunks;
}

/* ---- apply kept hunks to the live text, verifying every context line ---- */
function applyHunks(liveText, kept, label) {
  const live = liveText.split('\n');
  const out = [];
  let cursor = 0;
  for (const h of kept) {
    const start = h.oldStart - 1;
    if (start < cursor) fail(`${label}: hunk ${h.header} overlaps an earlier hunk`);
    while (cursor < start) out.push(live[cursor++]);
    for (const line of h.body) {
      if (line === '') continue;                       // trailing '' from the split
      const tag = line.charAt(0);
      const text = line.slice(1);
      if (tag === '\\') continue;                      // "\ No newline at end of file"
      if (tag === ' ') {
        if (live[cursor] !== text) {
          fail(`${label}: context mismatch at old line ${cursor + 1} for ${h.header}\n`
            + `    live:  ${JSON.stringify(live[cursor])}\n    patch: ${JSON.stringify(text)}`);
        }
        out.push(text); cursor++;
      } else if (tag === '-') {
        if (live[cursor] !== text) {
          fail(`${label}: removal does not match at old line ${cursor + 1} for ${h.header}\n`
            + `    live:  ${JSON.stringify(live[cursor])}\n    patch: ${JSON.stringify(text)}`);
        }
        cursor++;
      } else if (tag === '+') {
        out.push(text);
      } else {
        fail(`${label}: unexpected hunk line ${JSON.stringify(line)}`);
      }
    }
  }
  while (cursor < live.length) out.push(live[cursor++]);
  return out.join('\n');
}

/* Hunks that are NOT this session's work, by content: comment-only tweaks to the iOS
   safe-area block, from a change that is neither the plate grid nor the 3D work. */
const FOREIGN_COMMENT_SIGNS = [
  { label: 'iOS safe-area comment: hyphen -> em dash',
    sign: 'there - and naming them makes the insets overridable' },
  { label: 'iOS safe-area comment: dropped the -webkit-touch-callout verification note',
    sign: 'Scoped to WebKit-on-iOS so the 14px/13px density is untouched' }
];

/* ---- build -------------------------------------------------------------- */
const liveIndexRaw = blob('index.html');
const liveIndex = liveIndexRaw.toString('utf8');
const region = threeRegion(liveIndex);
console.log(`live ${LIVE_REF} index.html: ${liveIndexRaw.length} bytes, FORGE-3D region lines ${region.startLine}..${region.endLine}`);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let keptTotal = 0, droppedTotal = 0;
for (const file of FILES) {
  const live = blob(file).toString('utf8');
  const hunks = parseHunks(sh(`git diff --unified=3 ${LIVE_REF} -- ${file}`));
  if (!hunks.length) fail(`nothing to deploy for ${file} — the live build already has this work`);

  const kept = [], dropped = [];
  for (const h of hunks) {
    const in3d = file === 'index.html' && hunkTouchesRegion(h, region);
    const foreign = (!in3d && file === 'index.html')
      ? FOREIGN_COMMENT_SIGNS.find(f => h.body.some(l => l.includes(f.sign))) : null;
    if (in3d) dropped.push({ h, why: 'FORGE-3D region (another agent, mid-development)' });
    else if (foreign) dropped.push({ h, why: foreign.label });
    else kept.push(h);
  }

  const unexplained = dropped.filter(d => !hunkTouchesRegion(d.h, region)
    && !FOREIGN_COMMENT_SIGNS.some(f => d.h.body.some(l => l.includes(f.sign))));
  if (unexplained.length) {
    fail('refusing to deploy: ' + unexplained.length + ' hunk(s) are neither the 3D work nor a\n'
      + '  known comment tweak, so this build would silently omit somebody else\'s change:\n'
      + unexplained.map(d => '    ' + file + ' ' + d.h.header).join('\n'));
  }
  if (file === 'index.html' && kept.some(h => hunkTouchesRegion(h, region))) {
    fail('a 3D-region hunk leaked into the kept set');
  }

  /* sw.js carries exactly one thing worth deploying — the cache tag. Assert that, so a
     future edit to it cannot ride along inside a build described as a weight fix. */
  if (file !== 'index.html') {
    const changed = kept.flatMap(h => h.body).filter(l => /^[+-]/.test(l));
    if (changed.some(l => !/^[+-]const BUILD = '/.test(l))) {
      fail(`${file} carries a change beyond the build marker:\n  ` + changed.join('\n  '));
    }
  }

  fs.writeFileSync(path.join(OUT, file), applyHunks(live, kept, file), 'utf8');

  console.log(`\n${file}: ${hunks.length} hunks -> ${kept.length} kept, ${dropped.length} dropped`);
  for (const d of dropped) console.log(`  DROP ${d.h.header}  ${d.why}`);
  for (const h of kept) console.log(`  KEEP ${h.header}`);
  keptTotal += kept.length; droppedTotal += dropped.length;
}

/* ---- read the result back and check it says what we think it says -------- */
const outIndex = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const outReg = threeRegion(outIndex);
const outRegion = outIndex.slice(outReg.begin, outReg.end);
const liveRegion = liveIndex.slice(region.begin, region.end);

const mustHave = [
  ['function snapW(', 'the plate grid'],
  ['const gstep=gridOf(d.inc);', 'the sub-step hold rule'],
  ['>Today <b>', "the pill naming today's load"],
  ['class="rxwhy rxprog"', "the line stating the day's load"],
  ['const isBwEx=ex=>', 'the bodyweight family predicate'],
  ['BW<small>', 'bodyweight rendered as BW, not 0 kg'],
  ['<small>ASSIST</small>', 'assistance as its own label'],
  ['data-wedit=', 'the tap-to-type hook on a weight cell'],
  ['weightEntry(i,k){', 'the sheet that accepts any weight'],
  ['weightSet(i,k,v){', 'the commit that stores it as typed'],
  ['function scoreByReps(', 'reps-vs-e1RM decided from the data'],
  ['function loadLbl(', 'the three-state load label'],
  ['function compactW(', 'the short per-set label'],
  ['const cv=repLoad(en.id,st.w)*st.r', 'the per-set delta chip going through the clamp']
];
const mustNotHave = [
  ['r125', 'the removed global 1.25 kg rounding'],
  ['/* ===== _s3d_clip_press.js', "the 3D agent's new clip module"],
  ['thigh_top_deg', "the 3D agent's squat rewrite"],
  ['>Next <b>', 'the old pill label'],
  ["if(ex.bw)return;", 'the early return that made a chin-up unable to take a plate'],
  ["if(!ex.bw&&st.w<=0){toast('Add a load first')", 'the guard that refused a bodyweight pull-up']
];
let bad = 0;
for (const [needle, what] of mustHave) {
  if (!outIndex.includes(needle)) { console.error(`  FAIL: the deploy is missing ${what} ("${needle}")`); bad++; }
}
for (const [needle, what] of mustNotHave) {
  if (outIndex.includes(needle)) { console.error(`  FAIL: the deploy still contains ${what} ("${needle}")`); bad++; }
}
if (outRegion !== liveRegion) {
  let k = 0;
  while (k < outRegion.length && k < liveRegion.length && outRegion[k] === liveRegion[k]) k++;
  console.error('  FAIL: the FORGE-3D region is not byte-identical to the live build —'
    + ` live ${liveRegion.length} vs deploy ${outRegion.length}, first difference at char ${k}`);
  bad++;
}
const marker = /APP_BUILD='([^']+)'/.exec(outIndex);
const swMarker = /BUILD = '([^']+)'/.exec(fs.readFileSync(path.join(OUT, 'sw.js'), 'utf8'));
const liveMarker = /APP_BUILD='([^']+)'/.exec(liveIndex)[1];
if (!marker || !swMarker) { console.error('  FAIL: a build marker is missing'); bad++; }
else if (marker[1] !== swMarker[1]) { console.error(`  FAIL: build markers differ (${marker[1]} vs ${swMarker[1]})`); bad++; }
else if (marker[1] === liveMarker) { console.error('  FAIL: APP_BUILD was not bumped'); bad++; }
if (bad) fail(bad + ' check(s) failed on the built bytes');

console.log(`\nhunks overall: ${keptTotal} kept, ${droppedTotal} dropped`);
console.log('\nbuilt _deploy/ on top of ' + LIVE_REF + ':');
for (const f of FILES) {
  const b = fs.readFileSync(path.join(OUT, f));
  console.log(`  ${f.padEnd(12)} ${String(b.length).padStart(8)} bytes  sha256 ${sha(b)}`);
}
console.log(`  APP_BUILD = ${marker[1]}   (live was ${liveMarker})`);
console.log(`  FORGE-3D region byte-identical to live (${region.end - region.begin} chars, lines ${region.startLine}..${region.endLine})`);
