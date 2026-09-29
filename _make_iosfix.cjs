/* FORGE · BUILD THE MINIMAL iOS-FIX-ONLY DEPLOYABLE

   The live app (guardhonour.github.io/forge/) is build 'p', and HEAD is that same build. The
   working tree is build 'q' but carries ~500 lines of an unrelated, mid-development FORGE-3D
   feature from another agent, which must not be pushed to somebody's phone just to deliver a CSS
   fix. So this takes the COMMITTED bytes (`git cat-file blob HEAD:...`, byte-exact — never a
   Get-Content/Set-Content round trip) and applies ONLY the iOS safe-area fix, then writes the
   result to _iosfix/ to be gated by the same six suites as any other build.

   Every replacement asserts it matched EXACTLY once, so a drifted HEAD fails loudly instead of
   silently producing a file that is not the fix.

   Run: node _make_iosfix.cjs   →  _iosfix/index.html, _iosfix/sw.js
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const OUT = '_iosfix';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const blob = spec => execFileSync('git', ['cat-file', 'blob', spec], { maxBuffer: 64 * 1024 * 1024 });

/* ---- the fix, as literal replacements against the committed build ---- */
const EDITS = [
  /* 1. the device's dead edges, named once. env() is 0 on desktop/Android, so nothing moves
        there; naming them is also what lets a desktop Chrome probe measure the iPhone layout. */
  [`:root{
  --bg:#08090b; --bg2:#0a0b0d; --card:#14161a; --card2:#1a1d23; --card3:#20242b;
  --line:#242830; --line2:#30353e;
  --ink:#f2f4f7; --mut:#98a1ac; --dim:#5f6873;
  --volt:#cbf33a; --volt2:#b4dc22; --on-volt:#12150a;
  --hot:#ff6b4a; --gold:#ffc94a;
  --r:14px;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{
  background:var(--bg); color:var(--ink);
  font-family:Archivo,system-ui,sans-serif; font-size:15px; line-height:1.45;
}`,
    `:root{
  --bg:#08090b; --bg2:#0a0b0d; --card:#14161a; --card2:#1a1d23; --card3:#20242b;
  --line:#242830; --line2:#30353e;
  --ink:#f2f4f7; --mut:#98a1ac; --dim:#5f6873;
  --volt:#cbf33a; --volt2:#b4dc22; --on-volt:#12150a;
  --hot:#ff6b4a; --gold:#ffc94a;
  --r:14px;
  /* The device's unusable edges, named once and read everywhere. The app ships
     viewport-fit=cover + apple-mobile-web-app-status-bar-style:black-translucent, so in a
     standalone iPhone PWA the web content is laid out UNDER the status bar and the home
     indicator: without these the header's own controls are drawn on top of the clock and the
     battery. env() is 0 wherever there is no such edge (desktop, Android), so nothing moves
     there - and naming them makes the insets overridable, which is the only way a desktop
     Chrome probe can measure the iPhone layout at all. */
  --sat:env(safe-area-inset-top,0px);
  --sab:env(safe-area-inset-bottom,0px);
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
html{background:var(--bg);-webkit-text-size-adjust:100%;overscroll-behavior-y:none}
body{
  background:var(--bg); color:var(--ink);
  font-family:Archivo,system-ui,sans-serif; font-size:15px; line-height:1.45;
  -webkit-text-size-adjust:100%;
}
/* iOS Safari/standalone zooms the whole page when a control smaller than 16px takes focus, and
   leaves it zoomed: the app then looks "not formatted for iOS" until the field is blurred.
   Scoped to WebKit-on-iOS so the 14px/13px density is untouched on desktop and Android
   (verified: desktop Chrome reports CSS.supports('-webkit-touch-callout','none') === false). */
@supports (-webkit-touch-callout:none){
  .searchbox,.sel{font-size:16px!important}
  textarea.searchbox{font-size:16px!important}
}`],

  /* 2. #frame: keep a vh fallback so an iOS older than 15.4 (no dvh) still fills the screen */
  ['#frame{max-width:500px;margin:0 auto;min-height:100dvh;',
   '#frame{max-width:500px;margin:0 auto;min-height:100vh;min-height:100dvh;'],

  /* 3. THE BUG: the header's own controls were drawn underneath the iOS status bar */
  ['  padding:14px 16px 12px;background:color-mix(in srgb,var(--bg2) 88%,transparent);',
   '  padding:calc(14px + var(--sat)) 16px 12px;background:color-mix(in srgb,var(--bg2) 88%,transparent);'],

  /* 4. the tab bar already reserved the home indicator; route it through the named inset */
  ['padding:6px 6px calc(10px + env(safe-area-inset-bottom))}',
   'padding:6px 6px calc(10px + var(--sab))}'],

  /* 5. the rest-timer pill is fixed at bottom:86px. The tab bar GROWS by the home-indicator
        inset on an iPhone, so a fixed offset the pill used to clear by 14px ends up 20px
        inside the tab bar. Lift it by the same inset. */
  ['#pill{position:fixed;left:12px;transform:none;bottom:86px;z-index:45;',
   '#pill{position:fixed;left:12px;transform:none;bottom:calc(86px + var(--sab));z-index:45;'],

  /* 6. same arithmetic for the toasts */
  ['#toasts{position:fixed;left:50%;transform:translateX(-50%);bottom:132px;z-index:50;',
   '#toasts{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(132px + var(--sab));z-index:50;'],

  /* 7. bottom sheets: named inset + a vh fallback for pre-15.4 iOS */
  ['max-height:88dvh;overflow-y:auto;', 'max-height:88vh;max-height:88dvh;overflow-y:auto;'],
  ['padding:10px 18px calc(22px + env(safe-area-inset-bottom));',
   'padding:10px 18px calc(22px + var(--sab));'],

  /* 8. the build marker, so an installed copy actually replaces its cached shell */
  [`const APP_BUILD='2026-08-25p';`, `const APP_BUILD='2026-08-25q';`]
];

const SW_EDITS = [[`const BUILD = '2026-08-25p';`, `const BUILD = '2026-08-25q';`]];

const apply = (label, bytes, edits) => {
  const src = bytes.toString('utf8');
  if (src.includes('\uFFFD')) throw new Error(label + ': committed blob is not clean UTF-8');
  let out = src;
  for (const [from, to] of edits) {
    const n = out.split(from).length - 1;
    if (n !== 1) throw new Error(label + ': expected exactly 1 match, found ' + n + ' for: ' + from.slice(0, 70).replace(/\n/g, '\\n'));
    out = out.split(from).join(to);
  }
  return out;
};

/* the fix is meaningless if the app does not actually declare the cover/translucent contract */
const PREMISE = ['viewport-fit=cover', 'apple-mobile-web-app-status-bar-style" content="black-translucent"'];

fs.mkdirSync(OUT, { recursive: true });

const headIndex = blob('HEAD:index.html');
const headSw = blob('HEAD:sw.js');

const fixedIndex = apply('index.html', headIndex, EDITS);
const fixedSw = apply('sw.js', headSw, SW_EDITS);

for (const p of PREMISE) {
  if (!fixedIndex.includes(p)) throw new Error('index.html: missing the premise it exists to satisfy: ' + p);
}

fs.writeFileSync(path.join(OUT, 'index.html'), fixedIndex, 'utf8');
fs.writeFileSync(path.join(OUT, 'sw.js'), fixedSw, 'utf8');

/* resources the six suites need; forgetting the icons or the legacy snapshots produces
   phantom failures that look like app bugs (see AGENTS.md) */
const COPY = ['manifest.json', 'favicon-96.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'strength_norms_jsams2024.json', '_legacy_build_k.html', '_legacy_sw_k.js',
  '_runtime_test.cjs', '_split_test.cjs', '_hard_test.cjs', '_coach_test.cjs', '_contrast_check.cjs',
  '_upgrade_test.cjs', '_audit_demos.cjs', '_check_ui.cjs', '_shot_ios.cjs'];
for (const f of COPY) {
  if (!fs.existsSync(f)) { console.log('  (skipped, absent) ' + f); continue; }
  fs.copyFileSync(f, path.join(OUT, f));
}

const b = s => fs.readFileSync(s);
console.log('  live/HEAD build  2026-08-25p  ->  fix build 2026-08-25q');
console.log('  ' + OUT + '/index.html  ' + fixedIndex.length.toLocaleString().padStart(9) + ' bytes  sha256 ' + sha(b(path.join(OUT, 'index.html'))).slice(0, 32) + '...');
console.log('  ' + OUT + '/sw.js       ' + fixedSw.length.toLocaleString().padStart(9) + ' bytes  sha256 ' + sha(b(path.join(OUT, 'sw.js'))).slice(0, 32) + '...');
console.log('  applied ' + EDITS.length + ' replacements to index.html, ' + SW_EDITS.length + ' to sw.js');
console.log('\n  next: run the gate inside ' + OUT + '/');
