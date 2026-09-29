/* _gate_deploy.cjs — run the whole regression gate against the FROZEN deploy bytes.

   WHY A SEPARATE DIRECTORY
   The suites read `index.html` from the current directory, and the working tree's copy
   is NOT the build being deployed: it also carries another agent's mid-development 3D
   clip work. Gating the working tree would therefore prove things about bytes that are
   not going anywhere — and, worse, could pass a card assertion for the wrong reason.
   So the deploy bytes are copied into a scratch directory alongside the icons, the
   norms JSON and the legacy snapshots the suites need, and the suites run THERE.

   The file list mirrors _iosfix/, the layout this workspace already established for
   "gate a frozen build". Missing the icon PNGs or the norms JSON produces phantom
   failures ("every declared icon file exists", a norms mismatch) that look like app
   bugs and are not.
*/
'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SRC = path.join(HERE, '_deploy');
const DIR = path.join(HERE, '_gatedeploy');

/* the app's own files, which must come from the DEPLOY, plus the fixtures the suites need */
const FROM_DEPLOY = ['index.html', 'sw.js'];
const FROM_ROOT = ['manifest.json', 'favicon-96.png', 'icon-192.png', 'icon-512.png',
  'icon-maskable-512.png', 'strength_norms_jsams2024.json', '_legacy_build_k.html', '_legacy_sw_k.js',
  'install.html', 'latest.html'];

/* EVERY file the suites read, and the assertion count each one silently gates.
   This is not decoration. _coach_test.cjs checks BOM + double-encoding on five files and
   contributes TWO assertions per file that EXISTS — so a fixture missing from this
   directory does not fail, it makes the gate QUIETER. That is exactly what happened:
   install.html and latest.html were absent, and the suite reported 514 assertions where
   the working tree reports 518. Nothing went red. A gate that skips assertions silently
   is worse than no gate, so presence is asserted up front. */
const REQUIRED = [
  ['index.html', 'the build under test'],
  ['sw.js', 'the build under test'],
  ['manifest.json', 'PWA manifest: icons + name'],
  ['install.html', 'BOM/mojibake check (2 assertions)'],
  ['latest.html', 'BOM/mojibake check (2 assertions)'],
  ['favicon-96.png', '"every declared icon file exists"'],
  ['icon-192.png', '"every declared icon file exists"'],
  ['icon-512.png', '"every declared icon file exists"'],
  ['icon-maskable-512.png', '"every declared icon file exists"'],
  ['strength_norms_jsams2024.json', 'the embedded norms table must match its source'],
  ['_legacy_build_k.html', 'the upgrade suite boots the previously shipped build'],
  ['_legacy_sw_k.js', 'the upgrade suite boots the previously shipped worker']
];

/* suite -> the string that means it passed. A suite that prints anything else has failed. */
const SUITES = [
  ['_runtime_test.cjs', 'ALL RUNTIME TESTS PASSED'],
  ['_split_test.cjs', '0 failed'],
  ['_hard_test.cjs', 'HARD TEST: ALL GREEN'],
  ['_coach_test.cjs', 'COACH TEST: ALL GREEN'],
  ['_contrast_check.cjs', 'CONTRAST: ALL THEMES PASS AA'],
  ['_upgrade_test.cjs', 'UPGRADE TEST: ALL GREEN'],
  ['_audit_demos.cjs', 'DEMO AUDIT CLEAN'],
  ['_check_ui.cjs', 'UI CHECK CLEAN'],
  ['_shot_train.cjs', 'TRAIN CARD CHECK CLEAN'],
  ['_shot_ios.cjs', 'iOS SAFE-AREA CHECK CLEAN']
];

const only = process.argv.slice(2);

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
for (const f of FROM_DEPLOY) fs.copyFileSync(path.join(SRC, f), path.join(DIR, f));
for (const f of FROM_ROOT) fs.copyFileSync(path.join(HERE, f), path.join(DIR, f));
for (const [suite] of SUITES) fs.copyFileSync(path.join(HERE, suite), path.join(DIR, suite));

const indexSha = require('crypto').createHash('sha256')
  .update(fs.readFileSync(path.join(DIR, 'index.html'))).digest('hex').slice(0, 16);

/* refuse to run a gate that is quietly thinner than the one the working tree gets */
const absent = REQUIRED.filter(([f]) => !fs.existsSync(path.join(DIR, f)));
if (absent.length) {
  console.error('GATE REFUSED: the gating directory is missing ' + absent.length + ' file(s) the suites read.');
  console.error('A missing fixture does not fail a suite — it makes it assert LESS, silently.');
  for (const [f, why] of absent) console.error('  ' + f.padEnd(30) + why);
  process.exit(1);
}

console.log('gating the FROZEN deploy bytes, not the working tree');
console.log('  _gatedeploy/index.html  sha256 ' + indexSha);
console.log('  ' + REQUIRED.length + ' fixtures present (a missing one would silence assertions, not fail)');
console.log('  (working tree index.html is a different file and is not what ships)\n');

let failed = 0;
for (const [suite, pass] of SUITES) {
  if (only.length && !only.some(o => suite.includes(o))) continue;
  /* the app runs a setInterval, so the node suites never exit: run with a timeout and
     read the output that was produced. The output is complete well before the cap. */
  const r = cp.spawnSync(process.execPath, [suite], { cwd: DIR, encoding: 'utf8', timeout: 180000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const badLines = out.split('\n').filter(l => /^\s*FAIL/.test(l));
  const passed = out.includes(pass) && badLines.length === 0;
  const counts = (out.match(/\d+ passed, \d+ failed/) || []).pop() || '';
  if (passed) {
    console.log(`  PASS  ${suite.padEnd(22)} ${counts}`);
  } else {
    failed++;
    console.log(`  FAIL  ${suite.padEnd(22)} expected "${pass}"${counts ? ', got ' + counts : ''}`);
    for (const l of badLines.slice(0, 8)) console.log('          ' + l.trim());
    const tail = out.trim().split('\n').slice(-4);
    for (const l of tail) console.log('          | ' + l.trim());
  }
}

console.log('');
if (failed) {
  console.error(`GATE FAILED: ${failed} suite(s) did not pass on the frozen deploy bytes — do not deploy`);
  process.exit(1);
}
console.log(`GATE CLEAN: all ${only.length ? only.length : SUITES.length} suite(s) pass on the exact bytes to be pushed`);
