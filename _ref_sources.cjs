#!/usr/bin/env node
/* _ref_sources.cjs — find out which sources can actually supply REFERENCE video for the
 * Library exercises, and under what licence. Discovery only: this downloads nothing and
 * stores no media.
 *
 * The licensing question is the whole point. A video I can watch tells me nothing I can
 * use unless I may lawfully (a) fetch it and (b) derive measurements from it, and the
 * frames must never be redistributed unless the licence says so. So every candidate is
 * scored on licence first and coverage second.
 *
 * Sources probed:
 *   Wikimedia Commons  -- CC/PD by construction, searchable by file type, has a real API
 *   archive.org        -- mediatype:movies with an explicit licenseurl field
 *   YouTube            -- only defensible when the uploader CHOSE a Creative Commons
 *                         licence, which is a per-video property, so it needs filtering
 */
const TERMS = [
  ['ohp', 'overhead press'],
  ['squat', 'barbell back squat'],
  ['bench', 'barbell bench press'],
  ['deadlift', 'deadlift'],
  ['pullup', 'pull up exercise'],
  ['plank', 'plank exercise'],
];

async function j(url, opts) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'FORGE-rig-reference/1.0 (local analysis)' }, ...opts });
    if (!r.ok) return { error: 'HTTP ' + r.status };
    return await r.json();
  } catch (e) { return { error: e.message }; }
}

async function commons(term) {
  const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search'
    + '&gsrsearch=' + encodeURIComponent(term + ' filetype:video') + '&gsrnamespace=6&gsrlimit=8'
    + '&prop=imageinfo&iiprop=url|mime|size|extmetadata';
  const d = await j(u);
  if (d.error) return { error: d.error };
  const pages = Object.values((d.query && d.query.pages) || {});
  return pages.map(p => {
    const ii = (p.imageinfo || [])[0] || {};
    const em = ii.extmetadata || {};
    return {
      title: p.title,
      mime: ii.mime,
      mb: ii.size ? +(ii.size / 1048576).toFixed(1) : null,
      lic: (em.LicenseShortName && em.LicenseShortName.value) || '?',
      url: ii.url,
    };
  });
}

async function archive(term) {
  const u = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(term + ' AND mediatype:movies')
    + '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=licenseurl&fl%5B%5D=year&rows=8&page=1&output=json';
  const d = await j(u);
  if (d.error) return { error: d.error };
  const docs = (d.response && d.response.docs) || [];
  return docs.map(x => ({ id: x.identifier, year: x.year, lic: x.licenseurl || 'no licenseurl (PD claim unverified)', title: String(x.title || '').slice(0, 60) }));
}

(async () => {
  console.log('=== WIKIMEDIA COMMONS (CC/PD by construction) ===');
  for (const [id, term] of TERMS) {
    const r = await commons(term);
    if (r.error) { console.log(`  ${id.padEnd(9)} ERROR ${r.error}`); continue; }
    const vids = r.filter(x => x.mime && x.mime.startsWith('video'));
    console.log(`  ${id.padEnd(9)} files=${r.length} videos=${vids.length}`);
    for (const v of vids.slice(0, 3)) console.log(`      ${v.lic.padEnd(22)} ${v.mb}MB  ${v.title}`);
  }

  console.log('=== ARCHIVE.ORG (mediatype:movies) ===');
  for (const [id, term] of TERMS) {
    const r = await archive(term);
    if (r.error) { console.log(`  ${id.padEnd(9)} ERROR ${r.error}`); continue; }
    const lic = r.filter(x => x.lic !== 'no licenseurl (PD claim unverified)');
    console.log(`  ${id.padEnd(9)} hits=${r.length} with-licenseurl=${lic.length}`);
    for (const v of lic.slice(0, 2)) console.log(`      ${String(v.year).padEnd(6)} ${v.lic}`);
  }

  console.log('=== YOUTUBE via yt-dlp (licence is per-video; CC must be filtered) ===');
  console.log('  see the yt-dlp licence probe for whether CC-only filtering is viable');
  process.exit(0);
})();
