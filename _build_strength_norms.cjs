/* One-off extractor: converts the parsed JSAMS table dump into clean JSON.
   Source TSV produced from the archived published article HTML:
   https://web.archive.org/web/20250408030407id_/https://www.jsams.org/article/S1440-2440(24)00246-9/fulltext
   Not part of the app runtime. */
const fs = require('fs');
const path = require('path');

const TSV = path.join(process.env.TEMP, 'jsams_tables.tsv');
const lines = fs.readFileSync(TSV, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);

// Split into blocks keyed by ########## TABLE_INDEX_n ##########
const blocks = {};
let cur = null;
for (const ln of lines) {
  const m = ln.match(/^#+ TABLE_INDEX_(\d+) #+/);
  if (m) { cur = m[1]; blocks[cur] = []; continue; }
  if (cur !== null && ln.trim() !== '') blocks[cur].push(ln);
}

const AGE_GROUPS = ['12-17', '18-35', '36-59', '60-79', '80+'];
const PCTS = ['90th','80th','70th','60th','50th','40th','30th','20th','10th'];

function parseAgeTable(rows) {
  // rows[0] = lift name ; rows[1] = header w/ Ns ; rows[2..3] = subheaders ; rows[4..] = data
  const lift = rows[0].trim();
  const header = rows[1].split('\t');
  const ns = {};
  header.slice(1).forEach((h, i) => {
    const n = h.match(/N\s*=\s*([\d,]+)/);
    ns[AGE_GROUPS[i]] = n ? Number(n[1].replace(/,/g, '')) : null;
  });
  const out = { lift: lift.toLowerCase().replace(/\s+/g, '_'), n: ns, percentiles: {} };
  for (const r of rows.slice(4)) {
    const c = r.split('\t');
    const p = c[0].trim();
    if (!/^\d+th$/.test(p)) continue;
    const nums = c.slice(1).map(Number);
    const rec = {};
    AGE_GROUPS.forEach((g, i) => {
      const base = i * 3;
      rec[g] = { cut_point: nums[base], ci95: [nums[base + 1], nums[base + 2]] };
    });
    out.percentiles[p] = rec;
  }
  return out;
}

function parseBwTable(rows, sex) {
  const header = rows[0].trim(); // 'Females' | 'Males'
  const cats = {};
  let curCat = null;
  for (const r of rows.slice(3)) {
    const c = r.split('\t');
    const catMatch = c[0].match(/^(\d+\+?)\s*kg/);
    if (catMatch) {
      curCat = catMatch[1];
      const nSquat = (c[0].match(/Squat \(n = ([\d,]+)\)/i) || [])[1];
      const nBench = (c[0].match(/Bench [Pp]ress \(n = ([\d,]+)\)/i) || [])[1];
      const nDl = (c[0].match(/Deadlift \(n = ([\d,]+)\)/i) || [])[1];
      cats[curCat] = {
        unit: 'kg', n: {
          squat: nSquat ? Number(nSquat.replace(/,/g, '')) : null,
          bench_press: nBench ? Number(nBench.replace(/,/g, '')) : null,
          deadlift: nDl ? Number(nDl.replace(/,/g, '')) : null,
        },
        percentiles: {},
      };
      c.shift(); // drop the merged category cell; c[0] is now the percentile
    }
    if (!curCat) continue;
    const p = c[0].trim();
    if (!/^\d+th$/.test(p)) continue;
    const nums = c.slice(1).map(Number);
    // column order: squat, squashLL, squatUL, bench, benchLL, benchUL, deadlift, dlLL, dlUL
    cats[curCat].percentiles[p] = {
      squat:        { cut_point: nums[0], ci95: [nums[1], nums[2]] },
      bench_press:  { cut_point: nums[3], ci95: [nums[4], nums[5]] },
      deadlift:     { cut_point: nums[6], ci95: [nums[7], nums[8]] },
    };
  }
  return { sex, bodyweight_relative: true, categories: cats };
}

const dataset = {
  dataset_id: 'jsams-2024-powerlifting-norms',
  title: 'Normative data for the squat, bench press and deadlift exercises in powerlifting: Data from 809,986 competition entries',
  authors: ['Daniel J. van den Hoek','Patrick L. Beaumont','Adele K. van den Hoek','Patrick J. Owen','Joel M. Garrett','Robert Buhmann','Christopher Latella'],
  journal: 'Journal of Science and Medicine in Sport',
  year: 2024,
  volume: '27', issue: '10', pages: '734-742',
  doi: '10.1016/j.jsams.2024.07.005',
  pmid: '39060209',
  license: 'CC BY 4.0',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  publisher_fulltext: 'https://www.jsams.org/article/S1440-2440(24)00246-9/fulltext',
  repository_copy: 'https://ro.ecu.edu.au/ecuworks2022-2026/4617',
  reading_of_record_used: 'https://web.archive.org/web/20250408030407id_/https://www.jsams.org/article/S1440-2440(24)00246-9/fulltext',
  design: 'Retrospective cross-sectional analysis of global drug-tested, unequipped powerlifting competition results',
  n_total: 809986, n_male: 571650, n_female: 238336,
  metric: 'relative strength = maximum successful lift (kg) / athlete bodyweight at that competition (kg)',
  percentile_range: '10th-90th deciles',
  units: 'ratio of lifted weight to bodyweight (dimensionless multiple)',
  caveats: [
    'Population is drug-tested, unequipped COMPETITIVE POWERLIFTERS, not the general gym population.',
    'Values are 1RM achieved in competition under IPF rules (squat to depth, paused bench, no straps), not an e1RM from a rep formula.',
    'No overhead press data: powerlifting does not include the overhead press.',
    'Reported N for the male squat age table is identical to the female bench press age table; treat that N row as suspect.',
  ],
  age_stratified: { female: {}, male: {} },
  bodyweight_stratified: { female: null, male: null },
};

// Female age: 4 (squat), 5 (bench), 6 (deadlift); Male age: 7, 8, 9
dataset.age_stratified.female[parseAgeTable(blocks['4']).lift] = parseAgeTable(blocks['4']);
dataset.age_stratified.female[parseAgeTable(blocks['5']).lift] = parseAgeTable(blocks['5']);
dataset.age_stratified.female[parseAgeTable(blocks['6']).lift] = parseAgeTable(blocks['6']);
dataset.age_stratified.male[parseAgeTable(blocks['7']).lift] = parseAgeTable(blocks['7']);
dataset.age_stratified.male[parseAgeTable(blocks['8']).lift] = parseAgeTable(blocks['8']);
dataset.age_stratified.male[parseAgeTable(blocks['9']).lift] = parseAgeTable(blocks['9']);

// Bodyweight tables: 10 (female), 11 (male)
dataset.bodyweight_stratified.female = parseBwTable(blocks['10'], 'female');
dataset.bodyweight_stratified.male = parseBwTable(blocks['11'], 'male');

const outPath = path.join(__dirname, 'strength_norms_jsams2024.json');
fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2), 'utf8');
console.log('wrote', outPath);
console.log('female BW categories:', Object.keys(dataset.bodyweight_stratified.female.categories).join(', '));
console.log('male   BW categories:', Object.keys(dataset.bodyweight_stratified.male.categories).join(', '));
console.log('female age lifts:', Object.keys(dataset.age_stratified.female).join(', '));
console.log('male   age lifts:', Object.keys(dataset.age_stratified.male).join(', '));
console.log('sample female 84kg 90th:', JSON.stringify(dataset.bodyweight_stratified.female.categories['84'].percentiles['90th']));
console.log('sample male 93kg 50th:', JSON.stringify(dataset.bodyweight_stratified.male.categories['93'].percentiles['50th']));
console.log('sample male squat 18-35 n:', dataset.age_stratified.male.squat.n['18-35'],
            '| female bench 18-35 n:', dataset.age_stratified.female.bench_press.n['18-35']);