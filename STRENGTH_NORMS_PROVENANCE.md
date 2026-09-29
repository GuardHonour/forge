# Strength Norms — Provenance Research & Ship Decision

**Question:** can FORGE ship a citable strength-standards table (e1RM thresholds by
bodyweight and sex) without fabricating numbers?
**Answer: yes, for squat / bench press / deadlift only. No, for overhead press.**

---

## 1. Verdict

One dataset is genuinely shippable:

> **van den Hoek DJ, Beaumont PL, van den Hoek AK, Owen PJ, Garrett JM, Buhmann R,
> Latella C. (2024).** *Normative data for the squat, bench press and deadlift exercises
> in powerlifting: Data from 809,986 competition entries.*
> Journal of Science and Medicine in Sport, 27(10), 734–742.
> DOI [10.1016/j.jsams.2024.07.005](https://doi.org/10.1016/j.jsams.2024.07.005) ·
> PMID 39060209 · **Licence: CC BY 4.0** (redistribution permitted with attribution).

Why it qualifies where the popular sites do not:

| Property | von den Hoek 2024 | Strength Level | Symmetric Strength | ExRx / Kilgore |
|---|---|---|---|---|
| Underlying data | **Measured competition results** (1RM actually lifted, under IPF rules, in a meet) | Self-reported lifts entered by web users | **Model**, not measurements | "Accumulated performance data", competition classification systems 1950s→present |
| Sample | **809,986 entries** (571,650 M / 238,336 F) | 195,513,376 lifts from 27,893,268 self-selected users | Ratios from world records + ExRx + USPA tables | Not stated as a sample |
| Peer reviewed | **Yes** (JSAMS, indexed in PubMed/Scopus) | No | No | No |
| Methodology published | **Yes** (retrospective cross-sectional; deciles + 95% CI) | Only "checks for implausible data, duplicates, automated submissions" | Partial (formula-level only) | One paragraph |
| Licence for reuse | **CC BY 4.0** — reusable | All rights reserved | All rights reserved | Terms explicitly forbid reuse |
| Self-describes as | Normative data | "standards" from community data | "strength research and data from strength competitions" | **"should not be confused with strength norms"** |

**Do not ship Strength Level.** It is an internet-population, self-reported, self-selected
sample presented in a normative-looking frame — precisely what was ruled out. Its own page
says it draws on *"community-submitted lifts"* and *"community lifts entered by ... users"*,
retained *"after checks for implausible data, duplicates, and unusual or automated submission
patterns."* That is data hygiene, not sampling. Its percentiles describe the people who chose
to type numbers into strengthlevel.com.

**ExRx is doubly unusable:** it is not norms by its own statement, and its Terms of Content Use
restrict the content to *"personal, non-commercial use only"* and forbid use that acts as a
*"source of or substitute for the Service."*

---

## 2. What the dataset actually is (the claim it supports)

* **Population:** drug-tested, unequipped **competitive powerlifters** worldwide. Not gym-goers.
* **Measurement:** the **maximum successful lift in an actual competition** (squat to depth,
  paused bench, no straps), divided by bodyweight at that meet.
* **Unit:** a dimensionless multiple of bodyweight (e.g. `2.83` = 2.83 × bodyweight).
* **Resolution:** deciles 10th–90th, each with a 95% CI, stratified by sex and by either
  age classification (12–17 / 18–35 / 36–59 / 60–79 / 80+) or IPF bodyweight class.
* **Limits:** no overhead press (powerlifting does not contest it); no general-population claim.

---

## 3. The data

Full machine-readable extraction: **`strength_norms_jsams2024.json`** — 486 bodyweight-stratified
cut-points (2 sexes × 9 classes × 9 deciles × 3 lifts, each with a 95% CI) plus 270
age-stratified cut-points. Extracted programmatically (see `_build_strength_norms.cjs`), not
transcribed by hand.

Validation: the extracted values reproduce the paper's own abstract **exactly** at 18–35 and 80+
for both sexes — squat M 2.83 / F 2.26, deadlift M 3.25 / F 2.66, bench F 1.35, and the four
80+ values (M 1.72/1.31/2.30, F 1.01/0.92/1.68). The single exception is male bench press 18–35
90th percentile, where the **abstract says 1.95 and the table says 1.96** (see §6).

### Bodyweight-class cut-points (multiples of bodyweight; 50th and 90th deciles)

| class | SQ p50 | BP p50 | DL p50 | SQ p90 | BP p90 | DL p90 |
|---|---|---|---|---|---|---|
| F 43 kg | 1.43 | 0.87 | 1.87 | 2.01 | 1.25 | 2.48 |
| F 47 kg | 1.79 | 1.07 | 2.29 | 2.40 | 1.58 | 2.96 |
| F 52 kg | 1.80 | 1.04 | 2.25 | 2.39 | 1.45 | 2.88 |
| F 57 kg | 1.78 | 1.02 | 2.20 | 2.32 | 1.40 | 2.77 |
| F 63 kg | 1.73 | 0.98 | 2.10 | 2.24 | 1.33 | 2.65 |
| F 69 kg | 1.67 | 0.93 | 2.01 | 2.16 | 1.27 | 2.52 |
| F 76 kg | 1.62 | 0.90 | 1.93 | 2.10 | 1.24 | 2.42 |
| F 84 kg | 1.51 | 0.84 | 1.78 | 1.97 | 1.15 | 2.23 |
| F 84+ kg | 1.29 | 0.70 | 1.47 | 1.73 | 0.98 | 1.90 |
| M 53 kg | 1.64 | 1.08 | 2.12 | 2.27 | 1.51 | 2.77 |
| M 59 kg | 2.18 | 1.54 | 2.71 | 2.95 | 2.29 | 3.49 |
| M 66 kg | 2.30 | 1.56 | 2.80 | 2.95 | 2.06 | 3.47 |
| M 74 kg | 2.33 | 1.58 | 2.77 | 2.91 | 2.01 | 3.38 |
| M 83 kg | 2.29 | 1.56 | 2.68 | 2.83 | 1.96 | 3.24 |
| M 93 kg | 2.20 | 1.52 | 2.54 | 2.72 | 1.89 | 3.06 |
| M 105 kg | 2.10 | 1.46 | 2.38 | 2.59 | 1.83 | 2.87 |
| M 120 kg | 1.98 | 1.40 | 2.18 | 2.45 | 1.75 | 2.64 |
| M 120+ kg | 1.78 | 1.26 | 1.89 | 2.24 | 1.59 | 2.33 |

*Age-stratified deciles exist for every lift × sex × the five age bands, with 95% CIs, in the JSON.*

**Sparsity / interpolation.** The bodyweight axis is **9 IPF classes per sex**, not a continuum —
coarser than the app's arbitrary user bodyweight, so a lookup must interpolate. Two honest options:
(1) select the class containing the user's bodyweight and state which class was used; or (2)
linearly interpolate between adjacent class **boundaries**. Do not extrapolate beyond 43 kg /
120+ kg. The thinnest cells are the extremes (F 43 kg: squat n=680; M 53 kg: squat n=3,099) —
the career-adjacent classes (M 83/93 kg, F 57/63 kg) carry tens of thousands of entries each.

---

## 4. Recommendation for what the app displays

**Ship the self-referential metrics as the primary surface; show the published band only as
clearly-labelled context.**

| Layer | What to show | Claim it supports | Claim it must NOT make |
|---|---|---|---|
| **1. Trend & rate of change** (primary) | e1RM over time as a **range**, and change per unit time vs the user's own typical variability | "Your estimated max moved from X to Y over N weeks." | No "on track", no "good progress rate", no comparison to anyone. A change smaller than typical error is not a signal. |
| **2. Own-history percentile** (primary) | "This is your 4th-best squat session in 12 logged sessions" | Purely descriptive of the user's own record. | Never call it a percentile of *people*. Label it "of your own logged sessions" every time it appears. |
| **3. Bodyweight-relative ratio** (primary, descriptive) | `e1RM ÷ bodyweight`, shown as a plain ratio | A dimensionless number the user can track themselves over time. | It is **not** a score, not a grade, not comparable across lifters without a reference population. Body-mass ratios do not fully remove body-size effects. |
| **4. Published reference band** (secondary, opt-in) | The decile band from von den Hoek 2024 matching the user's sex and bodyweight class, for squat / bench / deadlift only | "Competitive drug-tested powerlifters at your bodyweight typically lifted between A× and B× bodyweight (10th–90th decile)." | Never "you are stronger than N% of lifters." Never apply to overhead press. Never imply general-population standing. |
| **Overhead press** | Ratio + trend only (layers 1–3). No reference band. | — | No population/normative framing at all — no peer-reviewed OHP norms were found to exist. |

**Required labelling (verbatim-safe wording):**

* Reference band: *"Reference range: drug-tested, unequipped powerlifting competitors at your
  bodyweight (van den Hoek et al., 2024, n = 809,986 competition results). This is a competition
  population, not the general gym population."*
* Always state it is a **competition 1RM** and that the app's number is an **estimated 1RM from a
  rep formula**, so the two are not the same quantity: *"Their numbers are lifts performed in
  competition. Yours is an estimate calculated from a set you logged."*
* If using the constant `120+`, say so.
* Do not show the band at all unless `profile.sex` and `profile.bw` are both set; never guess either.

**Two reasons the band will usually look unflattering, and both must be surfaced:** the reference
population is competitive powerlifters (most recreational lifters sit below its 10th decile), and
an e1RM is systematically below a true tested 1RM. Presenting the band without those two caveats
would overclaim in the opposite direction and is worse than showing nothing.

---

## 5. Sources actually fetched

* [JSAMS article landing page (publisher)](https://www.jsams.org/article/S1440-2440(24)00246-9/fulltext)
* [Archived published full text — the source of every number here](https://web.archive.org/web/20250408030407id_/https://www.jsams.org/article/S1440-2440(24)00246-9/fulltext)
* [QUT ePrints record (abstract, sample sizes, licence)](https://eprints.qut.edu.au/256865/)
* [ECU Research Online record (confirms CC BY 4.0)](https://ro.ecu.edu.au/ecuworks2022-2026/4617)
* [Unpaywall API (licence = cc-by, OA status hybrid)](https://api.unpaywall.org/v2/10.1016/j.jsams.2024.07.005?email=strength-research@example.org)
* [OpenAlex API (CC BY, OA locations, MeSH terms)](https://api.openalex.org/works/doi:10.1016/j.jsams.2024.07.005)
* [Semantic Scholar API (abstract)](https://api.semanticscholar.org/graph/v1/paper/DOI:10.1016/j.jsams.2024.07.005?fields=title,abstract,openAccessPdf,externalIds)
* [The Strength Initiative — the paper's own companion calculator](https://www.thestrengthinitiative.com/)
* [Strength Level standards page (self-reported community data)](https://strengthlevel.com/strength-standards)
* [Symmetric Strength — About & References (methodology)](https://symmetricstrength.com/about)
* [ExRx Weightlifting Performance Standards (Kilgore; disclaims norms; reuse restricted)](https://exrx.net/Testing/WeightLifting/StrengthStandards)
* [Your PT "Strength Standards Dataset v2" methodology + CSV](https://www.your-pt.com/research/strength-standards/)
* [OpenPowerlifting FAQ — "we release all of our data into the public domain"](https://www.openpowerlifting.org/faq)
* [OpenPowerlifting bulk CSV (4,034,179 rows, updated nightly)](https://openpowerlifting.gitlab.io/opl-csv/bulk-csv.html)

**Also verified and rejected:** *Your PT* publishes a downloadable CSV of four lifts × five bands ×
two sexes, but its own methodology page states it is *"not a population survey or clinical
assessment"*, that the values are *"coaching benchmarks"*, and that it contains **no empirical
sample** — *"Our standards represent curated coaching benchmarks derived from strength training
practice."* It is honest, but it is a coach's estimate, not norms. Shipping it as percentiles
would be fabrication. **OpenPowerlifting** is a genuine alternative *source* — public-domain,
4M rows, with sex, bodyweight, age, equipment and tested-status columns — but it is raw data, not
a citable published table; deriving percentiles from it ourselves would create our own numbers,
which then require our own documented methodology rather than a citation.

---

## 6. Could NOT verify — do not paper over these

1. **The supplementary tables S1–S3** (age × bodyweight cross-stratification) are referenced in the
   text but the three `.docx` attachments return **HTTP 403** and are not archived. Not included.
2. **Confirmed internal inconsistency in the paper:** the male *squat* age table reports
   n = 20,004 / 103,984 / 39,817 / 3,925 / 36, which is **character-identical to the female bench
   press age table**, and far below the male bench (509,785) and male deadlift (386,849) totals for
   the same stratification. The male squat **N row is almost certainly a copy error**. The
   *decile cut-points* in that table are internally consistent and match the abstract, so the
   thresholds are usable; **the sample size for male squat by age should not be quoted.**
3. **Male bench press 18–35, 90th percentile: abstract 1.95, table 1.96.** One of the two is a
   typo; the table value is used. Immaterial at two significant figures but worth knowing.
4. **Symmetric Strength's exact provenance is not fully disclosed.** Its About page documents the
   *formula* (Wilks-relative, Wathan 1RM, Foster/McCulloch age coefficients) and the *ratios*
   (median squat/deadlift 87% M, 84% F; bench/deadlift 65% M, 57% F, from raw world records), but
   not a sample, a date range, or a subject count.
5. **Kilgore / Rippetoe's *Practical Programming* tables** could not be inspected directly. What is
   verifiable is ExRx's statement that the same author's tables are *"based on competitive
   weightlifter and powerlifting classification systems in use from the 1950's to present"* — no
   sample size, no methodology paper, and a licence that forbids redistribution.
6. **Strength Level's raw methodology is undisclosed** beyond aggregate counts; qualifying rules
   are not published in a form that permits independent check.
7. **No peer-reviewed normative dataset for the overhead press exists** as far as this search
   reached. Every OHP "standard" found traces back to either ExRx/Kilgore (unpublished method,
   reuse-restricted) or a self-reported site. Search results openly admitted this: one OHP
   standards page states its numbers are *"not a peer-reviewed dataset."*
8. `web_search` was unusable (invalid API key); everything above came from direct `web_fetch` and
   PowerShell retrievals of the URLs listed in §5. Reddit was not reachable. The publisher's own
   full text (jsams.org, sciencedirect.com) and the ECU repository PDF are all Cloudflare-403;
   the archived reading-of-record is the copy that was actually read.

---

## 7. Files

* `strength_norms_jsams2024.json` — the extracted dataset (new).
* `_build_strength_norms.cjs` — one-off extractor, not part of the app runtime (new).
* No change was made to `index.html` or any app file. Regression gate: `_runtime_test.cjs`,
  `_split_test.cjs`, `_hard_test.cjs` all pass. `_coach_test.cjs` fails at line 377
  (`s0` is null, in the "WARM-UP RAMP" section) — **pre-existing and unrelated** to this work,
  which touched no app code.