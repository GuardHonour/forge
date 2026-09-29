/* _s3d_check_shaders.cjs — is every GLSL source in _s3d_render.js byte-identical to the one
   that was inlined in the viewer page before the split?
   node _s3d_check_shaders.cjs <original-page.html>
   The page interpolated its page-level NB into VERT, so the reference is the original literal
   with ${NB} replaced by the same max(24, joint count) the renderer computes. */
const fs = require('fs');
const R = require('./_s3d_render.js');
const src = fs.readFileSync(process.argv[2] || '_s3d_view_before.html', 'utf8');
const nb = Math.max(24, R.core().buildCharacter().sk.order.length);

function grab(name) {
  const m = src.match(new RegExp('var ' + name + ' = `([\\s\\S]*?)`;'));
  if (!m) throw new Error('could not find ' + name + ' in ' + process.argv[2]);
  return m[1].split('${NB}').join(String(nb));
}

let bad = 0;
[['VERT', R.VERT(nb)], ['FRAG', R.FRAG], ['LVERT', R.LVERT], ['LFRAG', R.LFRAG]].forEach(([n, got]) => {
  const want = grab(n);
  if (want === got) { console.log(n + ': IDENTICAL (' + got.length + ' chars)'); return; }
  bad++;
  console.log(n + ': DIFFERS  want ' + want.length + ' chars, got ' + got.length);
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (want[i] !== got[i]) {
      console.log('   first diff at char ' + i +
        '\n   want: ' + JSON.stringify(want.slice(Math.max(0, i - 30), i + 30)) +
        '\n   got : ' + JSON.stringify(got.slice(Math.max(0, i - 30), i + 30)));
      break;
    }
  }
});
console.log('NB used = ' + nb);
console.log(bad ? 'RESULT: ' + bad + ' shader source(s) differ' : 'RESULT: all 4 shader sources byte-identical');
process.exit(bad ? 1 : 0);
