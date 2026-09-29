#!/usr/bin/env node
/* _ref_find.cjs — find lawful reference video for a movement, with a poster frame to triage it.
 *
 * Two sources, both chosen because the licence is a property of the source rather than
 * something I have to hope for:
 *
 *   Wikimedia Commons  - PD or CC by construction. `filetype:video` in namespace 6.
 *   YouTube            - ONLY through the Creative Commons search filter. A per-video
 *                        property, so it must be filtered at search time; an unfiltered hit
 *                        reports `license = NA` and is not usable.
 *
 * `iiurlwidth` returns a transcoded poster JPEG for a video file, which is what makes this
 * usable at scale: I can look at 100 candidates for the cost of 100 small images, instead of
 * downloading 100 videos to find out that 95 are the wrong angle.
 *
 * Usage:  node _ref_find.cjs <term> [--thumbs <dir>] [--limit N] [--yt]
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const term = args.find(a => !a.startsWith('--')) || '';
const limit = (() => { const i = args.indexOf('--limit'); return i >= 0 ? +args[i + 1] : 12; })();
const thumbDir = (() => { const i = args.indexOf('--thumbs'); return i >= 0 ? args[i + 1] : null; })();
const wantYt = args.includes('--yt');
if (!term) { console.log('usage: node _ref_find.cjs <term> [--thumbs dir] [--limit N] [--yt]'); process.exit(2); }

const UA = { 'User-Agent': 'FORGE-rig-reference/1.0 (local analysis; contact: local)' };

function classify(short) {
  const s = (short || '').toLowerCase();
  if (s.includes('public domain') || s.includes('cc0')) return { tier: 'PD', attribution: false };
  if (s.includes('cc by')) return { tier: 'CC-BY', attribution: true };
  if (s.includes('cc by-sa')) return { tier: 'CC-BY-SA', attribution: true };
  return { tier: 'UNKNOWN', attribution: true };
}

async function commons() {
  const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search'
    + '&gsrsearch=' + encodeURIComponent(term + ' filetype:video') + '&gsrnamespace=6&gsrlimit=' + limit
    + '&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=640';
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error('commons HTTP ' + r.status);
  const d = await r.json();
  const pages = Object.values((d.query && d.query.pages) || {});
  return pages.map(p => {
    const ii = (p.imageinfo || [])[0] || {};
    const em = ii.extmetadata || {};
    const lic = (em.LicenseShortName && em.LicenseShortName.value) || '?';
    const artist = (em.Artist && em.Artist.value || '').replace(/<[^>]*>/g, '').trim().slice(0, 50);
    return {
      src: 'commons', title: p.title, lic, artist,
      mb: ii.size ? +(ii.size / 1048576).toFixed(1) : null,
      url: ii.url, thumb: ii.thumburl,
      desc: (em.ImageDescription && em.ImageDescription.value || '').replace(/<[^>]*>/g, '').trim().slice(0, 90),
      ...classify(lic),
    };
  });
}

async function youtube() {
  const { execFileSync } = require('child_process');
  const yt = 'C:\\Users\\Admin\\.local\\bin\\yt-dlp.exe';
  const search = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(term) + '&sp=EgIwAQ%3D%3D';
  let out = '';
  try {
    out = execFileSync(yt, ['--no-warnings', '--skip-download', '--playlist-end', String(limit),
      '--print', '%(license)s\t%(duration)s\t%(title)s\t%(webpage_url)s\t%(thumbnail)s', search],
      { encoding: 'utf8', timeout: 180000 });
  } catch (e) { return [{ src: 'youtube', error: (e.message || '').split('\n')[0].slice(0, 120) }]; }
  return out.split('\n').filter(Boolean).map(line => {
    const [lic, dur, title, url, thumb] = line.split('\t');
    const ok = /creative commons/i.test(lic || '');
    return {
      src: 'youtube', title, url, thumb, dur: dur ? +dur + 's' : null, lic,
      tier: ok ? 'CC-BY' : 'NOT-CC', attribution: true, usable: ok,
    };
  });
}

(async () => {
  if (thumbDir) fs.mkdirSync(thumbDir, { recursive: true });
  const rows = [];
  const c = await commons().catch(e => [{ src: 'commons', error: e.message }]);
  rows.push(...c);
  if (wantYt) rows.push(...await youtube());

  console.log('=== TERM: ' + term + ' ===');
  let usable = 0;
  for (const [i, r] of rows.entries()) {
    if (r.error) { console.log('  ERROR ' + r.src + ': ' + r.error); continue; }
    if (r.src === 'youtube' && !r.usable) continue;
    usable++;
    const tag = r.tier === 'PD' ? 'PD   ' : r.tier === 'CC-BY' ? 'CC-BY' : r.tier === 'CC-BY-SA' ? 'BY-SA' : '??   ';
    console.log(`  [${String(i).padStart(2)}] ${tag} ${String(r.mb || r.dur || '').padStart(7)}  ${r.title.slice(0, 72)}`);
    if (r.artist) console.log(`        by ${r.artist}`);
    if (r.desc) console.log(`        ${r.desc}`);
    if (thumbDir && r.thumb) {
      const safe = (r.src + '_' + i + '_' + r.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)) + '.jpg';
      try {
        const img = await fetch(r.thumb, { headers: UA });
        if (img.ok) {
          const buf = Buffer.from(await img.arrayBuffer());
          fs.writeFileSync(path.join(thumbDir, safe), buf);
          console.log(`        thumb -> ${safe} (${(buf.length / 1024).toFixed(0)} KB)`);
        }
      } catch (e) { /* a missing poster frame is not fatal */ }
    }
  }
  console.log(`=== ${usable} licence-usable candidate(s) of ${rows.length} ===`);
  // process.exit() here trips a libuv assertion ("!(handle->flags & UV_HANDLE_CLOSING)")
  // because fetch handles are still closing. Let the loop drain instead.
  process.exitCode = 0;
})();
