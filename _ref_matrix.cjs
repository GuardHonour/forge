/* _ref_matrix.cjs — licensed-coverage matrix for the FORGE Library.

Why this exists: 48 exercises need reference video, and the honest question is not "did the
search return something" but "is there a reference whose LICENCE permits use AND whose VARIANT
matches the exercise". A wrong-variant reference is worse than none, because it looks
authoritative — the CDC series offers a "Half squat" for a back squat and a seated dumbbell
"Overhead Press" for a standing barbell one. So this file never reports a bare count. It records
the candidate TITLES, so the classification can be checked by eye instead of trusted.

The exercise list is read out of index.html at runtime. The Library is the source of truth for
what the Library contains; a copied list here would silently drift.

Sources and why only these:
  * Wikimedia Commons  -- licence is in extmetadata, per file, machine-readable.
  * archive.org        -- licenceurl per item.
  * YouTube, filtered  -- the sp=EgIwAQ%3D%3D search parameter IS YouTube's own Creative Commons
                          filter, so the filter is the licence signal, and the top candidate per
                          exercise is then re-extracted in full to confirm the licence field
                          rather than assuming the filter worked.

Run: node _ref_matrix.cjs [--only id,id] [--limit N] [--out _ref/coverage.json]
*/
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = argOf('--out', path.join('_ref', 'coverage.json'));
const LIMIT = parseInt(argOf('--limit', '0'), 10);
const ONLY = argOf('--only', '').split(',').filter(Boolean);
const YTDLP = process.env.YTDLP || path.join(process.env.USERPROFILE || '', '.local', 'bin', 'yt-dlp.exe');

// ---- the exercise list, from the app -----------------------------------------
const html = fs.readFileSync('index.html', 'utf8');
// Entries look like:
//   {id:'bench',n:'Barbell Bench Press',g:'Chest',cat:'Barbell',m:['Chest'],m2:['Triceps'],eq:'Barbell + bench',db:0,cue:'...',def:{...}}
// so `m`/`m2` sit between cat and eq, and ids contain hyphens (incline-db, machine-ohp).
// Templates elsewhere are {id:'bench'} with no n/g/cat/eq, so requiring all four skips them.
const EX = [];
const re = /\{id:'([a-z0-9-]+)',n:'([^']+)',g:'([^']+)',cat:'([^']+)',[^}]{0,300}?eq:'([^']+)'/g;
let m;
while ((m = re.exec(html)) !== null) EX.push({ id: m[1], n: m[2], g: m[3], cat: m[4], eq: m[5] });
if (!EX.length) { console.error('NO_EXERCISES_PARSED -- the index.html shape changed; fix the regex before trusting anything below'); process.exitCode = 1; return; }
console.log('LIBRARY holds %d exercises (read from index.html)', EX.length);

const words = (s) => s.toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/).filter((w) => w && !['the', 'and', 'with', 'a', 'of', 'to', 'on', 'for'].includes(w));

// Equipment/technique words that CHANGE which movement this is. If a candidate carries one of
// these and the exercise does not, the candidate is a different exercise, not a match.
const VARIANTS = ['dumbbell', 'barbell', 'machine', 'smith', 'cable', 'band', 'kettlebell',
  'seated', 'standing', 'lying', 'incline', 'decline', 'single', 'one arm', 'alternating',
  'assisted', 'half', 'partial', 'romanian', 'sumo', 'front', 'behind', 'reverse', 'close grip',
  'wide grip', 'ez bar', 'preacher', 'hack', 'bulgarian', 'split', 'deficit', 'rack pull'];

function classify(exName, title) {
  const t = ' ' + title.toLowerCase().replace(/[^a-z0-9 ]/g, ' ') + ' ';
  const ew = words(exName);
  const missing = ew.filter((w) => !t.includes(w));
  const extra = VARIANTS.filter((v) => t.includes(v) && !exName.toLowerCase().includes(v));
  // every content word of the exercise present, and no contradicting variant word
  if (!missing.length && !extra.length) return { verdict: 'EXACT', missing, extra };
  // most of the exercise present, but something about it differs -> a lookalike
  if (missing.length <= Math.max(1, Math.floor(ew.length / 2))) return { verdict: 'VARIANT', missing, extra };
  return { verdict: 'WEAK', missing, extra };
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'FORGE-reference-audit/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function commons(name) {
  const q = encodeURIComponent('filetype:video ' + name);
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search'
    + '&gsrsearch=' + q + '&gsrnamespace=6&gsrlimit=4&prop=imageinfo&iiprop=url|mime|extmetadata';
  try {
    const j = await getJSON(url);
    const pages = Object.values(j.query?.pages || {});
    return pages.map((p) => {
      const ii = (p.imageinfo || [])[0] || {};
      const lic = ii.extmetadata?.LicenseShortName?.value || 'UNKNOWN';
      return { title: p.title.replace(/^File:/, ''), licence: lic, url: ii.url || '',
               mime: ii.mime || '' };
    });
  } catch (e) { return [{ error: String(e.message) }]; }
}

async function archive(name) {
  const q = encodeURIComponent('(' + name + ') AND mediatype:movies');
  const url = 'https://archive.org/advancedsearch.php?q=' + q
    + '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=licenseurl&rows=4&page=1&output=json';
  try {
    const j = await getJSON(url);
    return (j.response?.docs || []).map((d) => ({
      title: d.title || d.identifier, licence: d.licenseurl || 'UNKNOWN',
      url: 'https://archive.org/details/' + d.identifier }));
  } catch (e) { return [{ error: String(e.message) }]; }
}

function youtubeCC(name) {
  // sp=EgIwAQ%3D%3D is YouTube's own Creative Commons filter
  const q = encodeURIComponent(name + ' exercise technique');
  const url = 'https://www.youtube.com/results?search_query=' + q + '&sp=EgIwAQ%3D%3D';
  try {
    const out = execFileSync(YTDLP, ['--flat-playlist', '--no-warnings',
      '--print', '%(title)s|%(id)s|%(duration)s', url],
      { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean).slice(0, 4).map((line) => {
      const [title, id, dur] = line.split('|');
      return { title: title || '', id: id || '', seconds: Math.round(Number(dur) || 0),
               licence: 'CC (YouTube CC filter)', url: 'https://www.youtube.com/watch?v=' + id };
    });
  } catch (e) { return [{ error: 'yt-dlp: ' + String(e.message).slice(0, 80) }]; }
}

function confirmLicence(videoId) {
  try {
    const out = execFileSync(YTDLP, ['--no-warnings', '--skip-download', '--print', '%(license)s',
      'https://www.youtube.com/watch?v=' + videoId],
      { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split('\n')[0] || 'NA';
  } catch { return 'UNVERIFIED'; }
}

(async () => {
  let list = EX;
  if (ONLY.length) list = list.filter((e) => ONLY.includes(e.id));
  if (LIMIT) list = list.slice(0, LIMIT);

  const matrix = {};
  if (fs.existsSync(OUT)) { try { Object.assign(matrix, JSON.parse(fs.readFileSync(OUT, 'utf8')).exercises || {}); } catch {} }

  for (const ex of list) {
    process.stdout.write('  probing ' + ex.id.padEnd(11) + ' ' + ex.n.slice(0, 30).padEnd(31) + ' ... ');
    const [c, ar, yt] = [await commons(ex.n), await archive(ex.n), youtubeCC(ex.n)];
    // best candidate per source, by verdict then by name overlap
    const rank = { EXACT: 0, VARIANT: 1, WEAK: 2 };
    const scored = (arr) => arr.filter((x) => x.title).map((x) => ({ ...x, ...classify(ex.n, x.title) }))
      .sort((a, b) => (rank[a.verdict] - rank[b.verdict]) || (a.missing.length - b.missing.length));
    const cs = scored(c), as = scored(ar), ys = scored(yt);
    const bestYT = ys[0];
    let confirmed = null;
    if (bestYT && bestYT.id && bestYT.verdict !== 'WEAK') {
      confirmed = confirmLicence(bestYT.id);
      await sleep(400);
    }
    const best = [cs[0], as[0], ys[0]].filter(Boolean)
      .sort((a, b) => rank[a.verdict] - rank[b.verdict])[0];
    matrix[ex.id] = {
      id: ex.id, name: ex.n, group: ex.g, category: ex.cat, equipment: ex.eq,
      verdict: best ? best.verdict : 'NONE',
      commons: cs, archive: as, youtube_cc: ys,
      youtube_licence_confirmed: confirmed,
      note: best ? null : 'no candidate returned by any source',
    };
    console.log((best ? best.verdict : 'NONE').padEnd(8) + (confirmed ? 'licence=' + confirmed.slice(0, 34) : ''));
    await sleep(300);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    _provenance: 'Coverage audit only. No reference media is redistributed; candidates are links. '
      + 'verdict EXACT means every content word of the exercise appears in the candidate title and no '
      + 'contradicting variant word does; VARIANT means a lookalike movement; WEAK means the search '
      + 'matched on almost nothing and the candidate should not be used.',
    generated: new Date().toISOString(), exercises: matrix,
  }, null, 1));
  console.log('\nWROTE ' + OUT + ' (' + Object.keys(matrix).length + ' exercises)');
})().catch((e) => { console.error('MATRIX_FAILED ' + e); process.exitCode = 1; });
