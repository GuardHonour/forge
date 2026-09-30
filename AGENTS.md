# FORGE — Training Log (workout tracker PWA) — Venture Instructions (dsh agent)

You are the **FORGE workout-app agent**. You work ONLY inside this workspace
(`C:\Users\Admin\workout-app`). FORGE is a self-hosted weight-training log web app
(PWA, single HTML file, no backend, all data in the browser's localStorage).

---

## WHAT THE APP IS
- **Name:** FORGE · Training Log (short: FORGE)
- **Form:** single-file PWA — `index.html` (the whole app: UI + logic + styles inline),
  installable to home screen via `manifest.json` + `install.html`. No server, no backend,
  no network calls. **All data lives in the user's own browser localStorage** — privacy-first.
- **Repo:** GitHub `GuardHonour/forge` (default branch `main`). Local dir is the working copy.
  **The live app is GitHub Pages at `https://guardhonour.github.io/forge/`** — that URL is the origin
  the phone's installed PWA lives on, so it is the one that matters (see DEPLOYING below).
- **Purpose:** rapid, in-session weight/rep logging for lifters — log sets as weight × reps,
  previous workout numbers as tap-to-accept "ghosts", auto PR detection, rest timer.

## THE 6 TABS (from the app shell, `<nav id="nav">`)
1. **Train** — the active session logger. Each exercise card opens with a **prescription bar** (`3×5–8 reps` + the recommended load, `nextLoad()` — the same engine the Coach uses), then **one line stating the day's load outright** (`.rxprog`: "All 3 working sets at 102.5 kg — +2.5 on last session, whose top set was 100 kg"), then the engine's reason for that load, then the set rows (`G.bump` steppers, complete-set checkmarks), then a **per-set effort strip** (`G.rirMenu`/`G.setSetRir`, with `G.rirAllMenu`/`G.setRir` as the stamp-one-reading-on-every-set shortcut), a `+ Set`/`- Set`/`Warm-up ramp`(→`Clear ramp`) row, and a separate `Something hurt?` / `Remove…` (`G.removeMenu`) row. **The card has to answer "what goes on the bar today?" once and unambiguously.** The pill says `Today`, not `Next` — on a card you are standing in the middle of, "next" reads as some future session. The `.rxprog` line says the load applies to *every working set* and names the last-session number it is measured against. And last session is presented as a **record**: `LAST · 3 × 8 @ 100 kg` when every set matched, otherwise a per-set list labelled `S1/S2/S3` — three bare per-set numbers directly above the pill was a real complaint, where a reader took `70×8 · 70×8 · 72.5×6` for today's sets. The fourth column shows last session's set in the row's own notation (`100×8`), never a bare tonnage: an unlabelled `800` sitting under a weight stepper reads as a weight. Note the engine's `nl.note` copy is shown on this card *and* in the Coach, so it must stay tense-neutral — "add 2.5 kg", never "add 2.5 kg next time", which on the Train card means today and reads as a contradiction of the pill.
2. **Coach** — the analysis/prescription surface: readiness, volume audit vs per-muscle landmarks, autoregulated next loads (`rxRows`), stalls, balance, safety. Gated on data sufficiency (`confidence()`).
3. **Hist** (History) — past sessions.
4. **Prog** (Progress) — PRs, trends, stats.
5. **Lib** (Library) — exercise catalogue (picker: search `pk-q`, category chips `pk-cats`).
6. **Plan** — templates/plans.

Plus a **rest-timer "pill"** overlay (`#pill`, `pill-time`/`pill-label`, circular `pill-fg` progress) that auto-starts between sets, and a background FX canvas (`#fx`).

## DATA MODEL (ground truth — DO NOT invent keys)
- **Storage key:** `const KEY='forge.v1'` → saved via `localStorage.setItem(KEY, …)` / `saveLS()` / `loadLS()`.
- **Session in progress:** `KEY + '_sess'` (`saveSess()`/`loadSess()`), shape has `entries`.
- **Pre-import snapshot:** `KEY + '_pre_import'` — written by `G.doImport`, read by `G.restorePreImport`. The undo for a wrong restore.
- **Build/version marker:** `const APP_BUILD='2026-08-25r'` in `localStorage['forge_build']`. **Bump this on every shipped change** — a stale marker means installed copies keep running cached code. **`sw.js` has its own `BUILD` constant that MUST be bumped in the same edit**; `_coach_test.cjs` asserts the two match, because a drifted cache tag is exactly how a service worker serves last month's engine forever.
- Core object `S` holds the whole store (sessions, exercises, plans). Preserve `S.entries` / set-row shape (`{done, w, r, k?, t?, rir?}` per set, rows keyed `i-k`).
- **Additive keys added on top of `v:2`** (all optional; absent on older records, never required):
  - `S.profile` — `{onboarded, goal, level, days, bw, sex, rir, injuries[], standardsOn}`. Backfilled per-key from `freshProfile()`; read only through `prof()`. **Every field here is read by the engine — that is the entry requirement for asking.** Three that failed it were deleted (`birth`, `equipment`, and a `bar` increment that duplicated each exercise's own `def.inc` and was mislabelled as the bar's weight rather than its smallest jump); a store written before them still carries them, and they are inert rather than migrated. `goal` used to be asked and ignored — it now grades weekly volume through `GOAL_TUNE`, and `sex` is asked (see CALIBRATION below).
  - **per-set `rir`** (0–5, reps in reserve) and per-set `t` (seconds from session start) and per-set `k` (**set kind**, see below). Per-set effort is **canonical**: set 1 can be five in reserve while set 3 is none, and that difference is the whole point of the feature. Read it through `setRirOf(st,en)`/`hasRir(st)`, never `st.rir` directly.
  - **per-entry `rir`** — now only a *derived* compatibility summary: `entryRir(en)` = the **minimum** reading across working sets (the hardest set), re-derived on save and on session-edit save via `recountSession()`, and deleted when no set carries one. It exists so older readers, exports and imports keep working; a live session's own `en.rir` is always deleted the moment a per-set reading is written, because a second exercise-level record would contradict the sets. Absent means "unverified hardness", not "easy"; absent `k` means an ordinary working set — which is also exactly what every pre-existing record means, so both models are backward-safe by construction.
  - `S.bwLog` — `[{date, kg}]`, **kg canonical, 0.1 kg steps**. Backfilled to `[]`; `profile.bw` stays the current value and is kept in sync by `logBw()`. Bodyweight is the one quantity that legitimately has a tenth in it: `logBw()` rounds to 0.1 kg itself and **never** routes through `fw()`/`snapW()`, because a plate grid silently rewrote 79 kg as 78.75.
  - `S.over` — `{exId: dateISO}` for user overrides of a prescribed load.
  - `S.pain` — `[{date, exId, tier}]` safety reports. Tier 2+ also adds the muscle group to `profile.injuries`.
  - `S.lastExport` — dateISO of the last backup download; drives `backupState()`/`backupCard()`.
- **Derived, never stored:** muscle volume, e1RM, trends, stalls, readiness. Everything the Coach shows is recomputed from the log, so no migration is needed for it.

## SET KINDS (the volume contract)
`KINDS` = `wu` (warm-up) / `drop` / `back` / `fail`, with `null` meaning an ordinary working set.
- **`volSets(sets)`** excludes warm-ups → use for **volume, tonnage, set counts, PRs, muscle volume**.
- **`e1Sets(sets)`** keeps only working + `fail` → use for **e1RM / best-ever** (a deliberately submaximal drop or back-off set must not understate a maximum).
- **Never** iterate `en.sets` raw in an analytics path. `volSets`/`e1Sets` exist so the definition of "counts" lives in exactly one place; every mismatch between Progress and the Coach has been a bug of this kind.
- A warm-up is real work and is still shown, logged and saved — it just does not count as training volume. The one-tap `G.addWarmups` ramp inserts *marked* sets for this reason.

## THE PLATE GRID (a weight the gym does not have is not a prescription)
A prescribed load is a claim about what to put on the bar, so the rounding has to know two things:
the **unit** and the **exercise's own increment**. `snapW(kg,inc)`/`gridOf(inc)` in the units section
are the single place that decides it.

- **kg — snap to that exercise's `def.inc`** (barbell 2.5/5, dumbbell 2, cable and machine 2.5/5).
  This used to be ONE global 1.25 kg grid for every exercise and every unit, which prescribed an
  **18.75 kg dumbbell** and a **117.5 kg squat** — 48.75 kg a side, a combination no set of plates
  makes. Snap to `def.inc` and those become 18 and 120.
- **lb — snap to 5 lb**, because an lb rack steps 2.5 lb a side. The old code snapped in kg and then
  multiplied by 2.2046, so every lb prescription was nonsense: **all 12 sampled lifts** were
  non-multiples of 5 lb (`176.4`, `79.9`, `33.1`, `88.2`, `407.9`).
- **An intended increase smaller than one plate step becomes a HOLD** (`partial` in `nextLoad`). The
  "it cost you — smaller jump, rebuild the reps" branch computes half a step; rounding that to the
  nearest grid point hands back the FULL step, which is the opposite of what the branch means. So a
  sub-step increase floors instead, and the two branches stay distinguishable.
- **The 10% cap is a promise about the load, not about the factor**, so after snapping, step back down
  until the number is inside it — on a 5 kg step the nearest loadable weight to `mx*1.10` can sit
  half a step over the ceiling.
- **`fw()` may not invent precision.** Snapping then printing at one decimal turned 43.75 kg into
  **"43.8"**, which is where this started. Two decimals is exact for a 1.25 kg step and for the lb
  conversion; trailing zeros still drop. Bodyweight is the one exception and does not use it.
- **Snapping happens when a load is PROPOSED or STEPPED, never when it is SAVED.** `G.save()` stores
  `st.w` as-is. It used to re-snap, which rewrote what the lifter did: a dumbbell stepped to 28 kg
  (inc 2) was written to the log as 27.5, because the save path applied a grid the stepper never used.
  It also means a session carried over from an older build is not quietly moved on save.
- **`G.bump` and `G.editBump` share `stepLoad(w,d,ex)`**, which steps in whichever unit the user thinks
  in. `editBump` used to read `ex.inc`, which does not exist (it is `ex.def.inc`), so every edit stepped
  by the 2.5 fallback regardless of the exercise.
- **Demo history goes on the same grid** (`seed()`), or "Regenerate demo history" fills the log with
  loads nobody could have put on a bar.
- `r125` is gone. If you find yourself wanting "the 1.25 kg barbell increment" as a bare constant, that
  is the bug this section exists to prevent: it is a *kg barbell* fact, and it was being applied to
  dumbbells, cable stacks and pounds.

## TYPED WEIGHTS AND THE BODYWEIGHT FAMILY
Two reports, one shape: the steppers walk the exercise's own grid and nothing else, so a weight the
grid cannot express had no way in — and a lift whose load is not a weight at all had no way to say so.

- **Typing a weight.** Tapping the number in a set row (`[data-wedit]` → `G.weightEntry` →
  `G.weightSet`) opens a sheet whose field accepts **any** value. A dumbbell rack steps 2 kg here and
  2.5 kg there, odd bells come in 7/9/11, and a cable stack can be anything; none of those are
  reachable by stepping, and the lifter is standing in front of the actual plates. The sheet offers
  the coach's recommendation, last session's set on that row, and — for a bodyweight lift —
  `Bodyweight` / `± one increment`, so the common answers are still one tap. **A typed weight is the
  lifter's own measurement, so it is stored exactly as typed and never re-snapped** — the same rule as
  `G.save()`, and for the same reason: snapping on save rewrites what somebody actually did. A typed
  value is still a *proposed* load for the next session, and that one does get snapped.
- **The bodyweight family.** `bw` (12 lifts) and `bwPlus` (pull-up only) were split half-features:
  `G.bump` returned early on `ex.bw`, so a chin-up could never take a plate, while `G.checkSet`
  refused `w<=0` on `!ex.bw`, so a pull-up could never be logged at bodyweight. `isBwEx(ex)` treats
  both flags as **one family with one signed load**:
  **`w > 0` is ADDED weight, `w = 0` is BODYWEIGHT (a real, complete entry), `w < 0` is ASSISTANCE**
  (a band or an assist machine). One sign is the entire model, so progression is one comparison —
  a bigger `w` is harder — and `stepLoad` walks straight through zero.
- **Volume counts the mass the set MOVED (2026-09-30b).** `repLoad(id,w,date)` prices a bodyweight
  set at the lifter's OWN bodyweight on the session's date (`bwAt`: the `bwLog` entry on or before
  that date, else the profile's current value) — their number, not an invented coefficient: w=0 is
  the body, w>0 stacks on it, w<0 is assistance removing from it, floored at zero. A 107 kg
  lifter's 3×8 pull-ups used to read as zero volume, which was honest about the fraction of
  bodyweight a pull-up puts through the lats and dishonest about the 107 kg that undeniably moved.
  Every tonnage path still funnels through `repLoad`, and the session `date` is threaded through
  `entryVol`/`sessVol`/`prevSum` so past sessions price at THAT day's bodyweight — never re-price
  history at today's mass. Progression for these lifts is unchanged: `scoreByReps` and `e1`'s
  zero-floor stay — volume changed, the engine did not. `_upgrade_test.cjs` asserts every
  tonnage series shifted by EXACTLY this rule and nothing else; `_coach_test.cjs` holds the
  signed-load arithmetic (108−20=88, floor at 0, unknown mass stays 0).
- **The bodyweight progression is its own branch in `nextLoad`, not the weighted one.**
  ASSIST → BODYWEIGHT → ADDED, because assistance is a load you are trying to *remove*: topping the
  rep range at −20 kg prescribes −17.5, not +2.5. Topping it at 0 prescribes +`inc`. Missing the rep
  floor moves the load by one increment **in the easier direction whatever the sign** (so a small
  added load that misses the floor comes straight off to bodyweight — the reported case), except at
  exactly 0, where there is nothing left to remove and it holds and the reps do the work. The
  `factor`/10% cap machinery is deliberately **bypassed**, not reused: `cap = mx*1.10` around
  `mx = 0` would collapse a bodyweight→added progression back to zero. The 10% cap is a promise about
  the load, and the load here is the body.
- **A `bwPlus` first-timer is prescribed BODYWEIGHT.** A pull-up fell through to the weighted engine,
  and `def.start` is 5, so the app handed somebody who could not do one bodyweight pull-up a 5 kg dip
  belt. `d.start` is a barbell-shaped answer and the family does not use it.
- **Scored on reps only while genuinely UNLOADED** (`scoreByReps`). Reading this from the `bw` flag
  would score every weighted pull-up as zero progress; reading it from nothing would score a
  bodyweight pull-up as a zero 1RM. So the mode is a fact about the **data**, computed over the whole
  recorded history, and `scoreOf`/`liftReport`/`bwNote` all go through it.
- **Three states, three labels, everywhere a load is shown.** `wCell` (HTML, in the stepper) and
  `loadLbl`/`compactW` (text, for a sentence or a table cell) render `BW` / `+5 kg` / `12.5 ASSIST`.
  `0 kg` for bodyweight is what made a bodyweight pull-up look like a number the lifter had failed to
  enter, and `-20` reads as *minus twenty assists* — the unit has to be the thing being subtracted.
- **The warm-up ramp keys off the LOAD, not the flag** (`addWarmups`): a ramp needs a working load to
  ramp to. It used to test `ex.bw`, which gave a weighted pull-up no ramp and a light barbell a normal
  one. Its guard now runs **before** anything is written, so a refused ramp cannot leave the session
  half-changed.
- `_coach_test.cjs`'s `BODYWEIGHT FAMILY` section and `_shot_train.cjs`'s `TYPING A WEIGHT` section
  hold all of the above, including that the `ASSIST` sub-label is not clipped inside its own cell.

## RULES / GUARDRAILS
- **Never break the single-file build.** index.html is self-contained (inline CSS+JS). Keep edits inline; do NOT split it into multiple files or add external deps that the manifest/PWA can't reach standalone.
- **Respect storage shape.** Any change touching `S`, `entries`, or set rows must round-trip through `saveLS()`/`loadLS()` and stay serializable to JSON for localStorage. Migration (`forge.v1` → later) must be additive/backward-safe.
- **No backend, no cloud, no analytics.** FORGE is local-first by design ("your data stays yours"). Do not add network calls, telemetry, or a server requirement unless explicitly asked.
- **Accessibility/UX bar:** set rows use `aria-label` (e.g. "Complete set N"); keep buttons keyboard/AT friendly; preserve the dark theme (`background_color #0a0b0d`, `--volt` accent).
- **Keep the fast-in-session feel:** hold-to-bump steppers, tap-to-accept ghosts, one-tap complete — do not add multi-step friction to the Train flow.
- **Tests:** the regression gate is now SIX suites — run all of them after any logic change:
  `_runtime_test.cjs`, `_split_test.cjs`, `_hard_test.cjs`, `_coach_test.cjs`, `_contrast_check.cjs`,
  `_upgrade_test.cjs`.
  `_coach_test.cjs` covers the tracking/recommendation layer and is the one to extend when the Coach engine changes. `_contrast_check.cjs` enforces WCAG AA on `--ink`/`--mut`/`--dim` in all six themes plus their visual hierarchy. `_upgrade_test.cjs` is the only suite that is about a *deployment* rather than the app: it boots the previously shipped build's store in the working build, so it is the one to run before anything reaches a phone that holds real data.
  `_hard_test.cjs` also carries the demo-engine contract (one rig per exercise, every authored pose reachable, no frame clamped, one shared tempo and HUD) — extend it when the technique engine changes, and run `_audit_demos.cjs` plus `_check_ui.cjs` on top of the six suites.
- **Test harness gotchas (these have each cost a false "app bug"):**
  - `G` throttles 14 tap actions to one call per 400 ms. A second call inside that window is *silently swallowed*. The harness uses a controllable `FakeDate`; call `advance(1000)` before a throttled action instead of concluding the app is broken.
  - `S` is **reassigned** by `wipe()`, `doImport('replace')` and `restorePreImport()`. Read it through the live getter (`api.__S()`), never a captured reference.
  - Destructive actions call `confirm()`; the harness stubs it to `true`.

## STRENGTH STANDARDS (the one place external data is allowed)
`SBD_NORMS` embeds 486 bodyweight-stratified cut-points from van den Hoek et al. 2024,
*J Sci Med Sport* 27(10):734-742 (doi:10.1016/j.jsams.2024.07.005, **CC BY 4.0**) — 809,986
drug-tested unequipped powerlifting competition entries, deciles 10–90 as multiples of bodyweight.
- **Opt-in** (`profile.standardsOn`), and shown **only** when both `profile.sex` and a bodyweight exist. Never guess either.
- **Squat / bench / deadlift only.** The overhead press has **no** peer-reviewed norms — do not invent a band for it.
- Bodyweight **snaps** to the standard IPF class and the class is **always displayed**; the table is 9 buckets per sex, not a continuum.
- **Never** claim a percentile of people, a grade, or a rank. The reference population is stated in the copy every time: drug-tested unequipped **competitors**, not the general gym population, and a competition single is a **tested maximum** while FORGE shows a **formula estimate**. Both push the same way, so a user's ratio normally sits *below* the band — omitting that overclaims in the opposite direction.
- **Rejected on provenance, do not add:** self-reported community tables (Strength Level), ExRx/Kilgore (self-describes as *not* norms; terms forbid reuse), coaching-benchmark tables with no sample or method (Your PT), and modelled scores (Symmetric Strength). The extracted dataset and full provenance live in `strength_norms_jsams2024.json` and `STRENGTH_NORMS_PROVENANCE.md`; `_build_strength_norms.cjs` is the one-off extractor, not app runtime. `_coach_test.cjs` asserts the embedded table still matches the source JSON exactly.

## CALIBRATION (the profile is a promise, and `_coach_test.cjs` holds it to it)
The profile sheet says its answers calibrate the app. Two rules keep that true, and breaking either
is the bug this section exists to prevent:
- **A question that nothing reads is deleted, not kept.** Asking for a birth year, a kit list or a
  global plate jump that no code path consumes is a lie told at the one moment the user is paying
  attention. `birth`, `equipment` and `bar` were removed on exactly this ground.
- **Anything the app tells the user to set must be settable where it says so.** The strength-standards
  card used to say "Set your sex in your profile" and link to a profile with no such control — a dead
  end that made the feature unreachable. `sexChips()`/`stdInputs()` are now shared by the profile and
  by that card, `G.setSex('')` clears the answer, and the copy states plainly that it only picks which
  published table you are read against.
- **`profile.goal` grades weekly volume.** `GOAL_TUNE` scales the `VLM` band in `landmarks()`:
  hypertrophy is the identity `(1,1,1)` so nothing already graded changes meaning, strength grades
  lower (heavy work costs more recovery per set) and general health lower again. Rounding can never
  collapse the band — `landmarks()` re-orders it. Like `VLM` this is a programming heuristic, a
  starting model, not a measured constant.
- Each profile answer prints its **measured effect** (`.pfx`), computed from the same tables the
  engine reads — the volume target it grades against, the split the day count maps to, what the
  effort target does to load. The effect line cannot drift from the engine because it is derived from
  it, and `_coach_test.cjs` asserts the sheet prints the same number the audit uses.

## UI SURFACES ADDED
- **In-session auto-regulation** — completing a working set BELOW its rep floor (`adjustAfterSet`)
  retargets the remaining sets of that exercise so the volume still gets done: a near miss (one rep
  short) holds the load and drops the rep target to what was just achieved; a real miss also takes
  one grid step off the load (a bodyweight lift steps through zero into assistance, like its own
  progression). It fires only when the failed set attempted the current target — a load the user
  dialled themselves is their choice, not a miss to override — and re-fires against the adjusted
  target, so a second miss eases further. The completed set is **never rewritten**; the card states
  the miss and the new aim ("Set 2 missed the 6-rep floor at BW — remaining sets aim at 2 reps @
  …") and the load pill flips Today→Now, because two contradicting sentences on one card is how a
  prescription stops being one. The NEXT session's prescription still reads what was actually
  lifted — the adjustment aims today's remaining rows, never the engine.
- **Set kinds** — tap the `S1` badge on a Train set row to mark warm-up / drop / back-off / to-failure. `G.addWarmups(i)` inserts a marked ramp in one tap.
- **Per-set effort (RIR)** — every set carries its own 0–5 "reps in reserve", logged from the Train card's effort strip (`G.rirMenu` → `G.setSetRir`) or one reading for all sets at once (`G.rirAllMenu` → `G.setRir`), and correctable later from the session editor (`G.editRirMenu`). The strip shows each set's reading and reports the **hardest** one; `entryRir(en)` (min across working sets) is what `nextLoad()` and the volume discount read. The card's reason line says what the last session's effort did to *today's* load (`rirNote`) — including the honest "nothing yet, one reading sits inside its own error" case — because today's weight is already on the bar and only a later session can respond to it.
- **Granular removal** — `G.removeMenu(i)`: clear the warm-up ramp (`G.clearWarmups`), remove one set (`G.delSetAt`, guarded so the last set cannot be deleted), clear every set (`G.clearSets`), or remove the whole exercise (`G.removeEntry`, always behind a confirm that names the exercise and its set counts). A bare "Remove" next to "Warm-up ramp" used to delete the exercise, which is exactly the bug this replaces.
- **Backup & restore** — `G.openImport()`. Merge is **additive and default**; Replace is explicit. Both write `KEY + '_pre_import'` first, so `G.restorePreImport()` undoes a wrong choice. `backupCard()` nags in Progress only once the log is real (≥5 sessions) and stale (never, or >14 days).
- **Saved-session editing** — `G.openSessionEdit(sid)` from an expanded History session. **Edits run on a copy**; nothing touches the log until Save, so Cancel is free and a refused save (every exercise removed) cannot leave an empty shell. Save re-derives `prCount` via `recountSession()`.
- **Bodyweight** — a time series, logged from Profile or Progress. Stored in kg, displayed in the user's unit. The chart scales to the **data range**, not zero, and says so; a tight range must not masquerade as a dramatic trend.
- **Consistency calendar** — `heatCard()` in Progress. A block of coloured squares only earns its space if it answers "when did I last train" and "what did I do that day", so the grid is a real calendar: **one column per calendar week** (`mondayOf`, the same week engine History divides sessions by), **Monday at the top**, a named week axis (`Aug 3 … NOW`), a ring on today, and a hollow square for days that have not happened yet — "missed" and "not yet" must not look alike. The headline above it states the last session and how long ago (`ago()`), plus sessions in the last 7 days; tapping a day (`G.heatTap`) reports that day's name, sets and volume. **The old grid filled each row with eight CONSECUTIVE days**, so no column was a weekday and the most recent training day could not be located by eye at all.
- **Weekly volume chart** — the average line is annotated in the **left gutter** (`AVG` / `44.4k`), the one strip no bar or value label can reach, with the unit named in the section subtitle. It used to be an axis label written at the far right *before* the bars were drawn, so the current week's bar painted straight across the middle of the words ("AV…kg"). Paint order is not a fix where a bar and a word share pixels; not sharing pixels is.

## EVIDENCE RULES FOR COACH COPY
The Coach surface makes claims to users, so wording is constrained, not just the logic:
- **Never** say a lift has "plateaued" — say "no measurable progress yet". A change smaller than the typical error is not a signal.
- Report e1RM as **an estimate** and, where shown as a number, as a range. Never imply a formula estimate is a tested max.
- Deload is **optional, user-triggered, mild (~20% sets), frequency preserved**, and labelled a practice convention — never auto-scheduled, never a 50% cut.
- ACWR is a **descriptive** spike detector: no "in range"/"optimal" band, no injury-risk prediction.
- No normative push:pull ratio and no joint/posture health claim — state what the data is, not what it prevents.
- Avoid the word **"prevent"** in any health context (it leaves the FDA general-wellness lane). No diagnosis, no rehab plan; `G.painTier` triages urgency only.
- RIR/effort is a **soft input** (`rirTrust`): it modulates load, never overrides logged load and reps, and never acts on a single reading.
- Remedies must be **equal-cost to accept** — the override (`G.override`) is one tap and is stored as training data.

## DEPLOYING TO THE LIVE APP
The live app is **GitHub Pages: `https://guardhonour.github.io/forge/`**, served from the repo root of
`main`. That origin is where the phone's installed PWA and its `forge.v1` localStorage live, so it is
the only deployment that updates the app a human actually uses — the DSH-served copy at
`https://kilam-pc.tail55b389.ts.net/forge/index.html` is a *different origin* and is for eyeballing a
build, never for switching to: localStorage is per-origin, so pointing the phone at it would present an
EMPTY log, not the user's own.

- **Two files deploy:** `index.html` and `sw.js`. Nothing else in the repo changes for a normal build
  (manifest, icons, `install.html`, `latest.html` are static), and the app's own `sw.js` registration
  is relative, so the repo-root layout is what Pages serves. Both build markers must be bumped together
  (`APP_BUILD` and `sw.js`'s `BUILD`) — `_coach_test.cjs` fails if they drift.
- **How the update reaches an installed copy:** the document is served STALE-WHILE-REVALIDATE
  (cached copy renders instantly; a background refresh stocks the cache for the NEXT open), with
  one carve-out: navigations carrying `?fresh=` are NETWORK-FIRST, because the self-heal depends on
  that hop being fresh bytes. So the bump flips `localStorage['forge_build']`, the stale install
  notices on the open it lands on, wipes the SW + caches and reloads with `?fresh=1` — fresh bytes,
  no loop. In the worst case an update costs one extra open; no user action beyond reopening.
  No user action beyond reopening the app.
- **A `git push` from this workspace does NOT work unattended.** `credential.helper=helper-selector`
  (from the hermes gitconfig) blocks waiting for an interactive selection, and with the helper
  disabled git reports `could not read Username for 'https://github.com'` because
  `GIT_TERMINAL_PROMPT` is off and no askpass/`gh`/stored credential exists. The two commits before
  `98c8ca9` are both `Add files via upload` — the GitHub web UI. So a deploy is either the user
  running `git push origin main` from an interactive shell, or dragging `index.html` + `sw.js` into
  the repo's upload page.
- **If the web-UI route is used, this clone diverges** (the uploaded commit has the same content but a
  different hash). Realign with `git fetch origin && git reset --soft origin/main` — **`--soft`, never
  `--hard`**: the working tree routinely carries another agent's uncommitted work, and `--hard` would
  delete it. `--soft` moves the branch to the uploaded commit and leaves the tree alone.
- **Packaging for a laptop upload is `_pack_for_upload.cjs`, not `_publish_forge.cjs`.** The latter
  publishes the WORKING TREE (right for eyeballing a build in progress); the packager reads
  `git show HEAD:<file>`, so what gets uploaded is the frozen, gated build. This distinction is not
  academic: mid-deploy the tree was edited twice under a running gate, so "the bytes I tested" and
  "the bytes on disk" were 20 KB and then 50 KB apart.
- **Gate the frozen bytes, not the working tree.** `git show HEAD:index.html` into a scratch dir
  alongside the icons and the probe scripts, then run the suites there — copying only the seven logic
  suites and forgetting the icon PNGs or `_shot_prog.cjs` produces phantom failures (`every declared
  icon file exists`, `MODULE_NOT_FOUND`) that look like app bugs and are not.
- **Run `_upgrade_test.cjs` before any deploy.** It is the only check that a store written by the
  build currently being served still opens, unchanged, in the new one.

## FILES
- `index.html` — THE app (edit this for features/fixes).
- `sw.js` — service worker: the document is STALE-WHILE-REVALIDATE (cached copy renders instantly, background refresh for the next open; navigations carrying `?fresh=` are network-first because the self-heal depends on that hop being fresh bytes), cache-first for every other same-origin request, cross-origin never intercepted. Registered inline from `index.html` (no `<script src>`) and skipped on `file://`.
- `_probe_boot_cost.cjs` — boots the app's single inline script in the runtime-test's node sandbox and asserts it is fast (< 1 s). It exists because the FORGE-3D press clip once ran its pose solvers at module load — ~2 million FK+IK pose evaluations inside the parser-blocking script, tens of seconds on the splash on every phone open — and no suite measured boot cost, so the gate was green while the phone was unusable. The press clip's solvers are now BAKED (see `BAKED, NOT SOLVED AT LOAD` in `_s3d_clip_press.js`; `node _check_clip_press.cjs --resolve` re-runs them and asserts the baked constants reproduce).
- `manifest.json` — PWA name/icons/display (name "FORGE · Training Log", icons icon-192/512).
- `install.html` / `latest.html` — install + update pages.
- `icon-*.png` / `favicon-96.png` — icons.
- `_runtime_test.cjs`, `_split_test.cjs`, `_hard_test.cjs`, `_coach_test.cjs`, `_contrast_check.cjs` — the regression gate.
- `_upgrade_test.cjs` — the DEPLOYMENT gate, and the only suite whose subject is an upgrade rather than the app. `_legacy_build_k.html` / `_legacy_sw_k.js` are byte-for-byte snapshots of what `guardhonour.github.io/forge/` was serving; the test boots that build, makes a realistic 9-week history with its own generator, adds the residue an old store carries (the deleted `profile.birth`/`.equipment`/`.bar`, entry-level `rir`, an in-progress session, an old `forge_build` marker), then hands those exact bytes to the working build and asserts the history is **byte-identical**, that every LOGGED number — muscle volume, weekly volume, PR list, session load — reads the **same**, that no top-level key is dropped, that every tab renders and the new calendar reflects the old data, that the marker flips, and that a second boot on the saved store is clean. **The one prescription assertion is deliberately weaker, and on purpose:** every prescribed load must land on its own exercise's `def.inc` grid and must not have moved by more than **one increment**. It used to assert the loads were *unchanged*, which was true only while one global 1.25 kg grid applied to everything — a correct plate grid necessarily re-snaps lifts that were never loadable (7 of 21 in the sample history). "Within one increment, onto a loadable weight" is the invariant that survives, and it is strictly stronger than "unchanged" for the thing that actually matters: a re-snap is not a re-prescription, and the suite prints the moved list so a genuine engine change is visible rather than hidden. **Two traps it has already fallen into, both worth remembering: (1) comparing the new build's reading of a MUTATED store against the old build's in-memory state produced two false failures — the baseline must be a second boot of the legacy build on the identical bytes; (2) a whole-structure numeric fingerprint is worse than named per-field checks, because a failure then cannot say which number moved.**
- `strength_norms_jsams2024.json`, `STRENGTH_NORMS_PROVENANCE.md`, `_build_strength_norms.cjs` — the strength-standards evidence trail. Not loaded at runtime.
- `_audit_demos.cjs` — geometric audit of the 48 technique demos: 1:1 coverage, every joint finite, every **authored** pose within the skeleton's reach, no rendered frame needing a clamp, and the bounding box the shared viewBox is chosen from. Run it after any change to a demo pose.
- `_shot_demos.cjs` — renders a contact sheet of the demos in headless Chrome (`node _shot_demos.cjs [cols] [px] [id,id,...|all] [out.png]`), each cell showing the rep's three extremes.
- `_shot_filmstrip.cjs` — `node _shot_filmstrip.cjs <frames> <cell> <id,...> <out.png>`: one row per exercise, one column per point in the rep, so a whole movement arc reads off a single still. This is the one that survives a chat/attachment channel that flattens animation (GIFs get re-encoded to a single static frame), and it is what caught the push-up bottoming out onto the floor when the numeric audit was perfectly happy.
- `_check_ui.cjs` — drives the real app over the Chrome DevTools Protocol at true 360/390/430 px viewports and asserts the demo HUD does not overflow, the SVG mounts, pause/step/resume work, and no JS error fired. Chrome refuses a window narrower than ~500 px, which is why this uses device-metrics emulation rather than `--window-size`.
- `_shot_train.cjs` — the Train card at those same three widths: asserts no horizontal overflow and **no cell clipped inside its own box** (that check is what found the weight stepper's `+` button being cut off between 421px and 520px — a pre-existing bug, confirmed by running the same probe against `_baseline_original.html`), drives the per-set effort strip, and proves the chain end to end: a reading on set 1, another on set 3, save, then the next prescription for that lift changes. `node _shot_train.cjs [file.html]` probes any build; writes `_train_<w>.png`, `_train_mixed.png`, `_train_effort.png`, `_train_remove.png`.
- `_shot_profile.cjs` — the calibration surfaces at 390px: opens the profile sheet and asserts every card is inside the sheet, then drives the **strength-standards** card's comparison-table chips and checks the answer sticks. It exists because `_coach_test.cjs` reads `#ovl.innerHTML` as a string and cannot see the browser's parse tree — an unbalanced `</div>` closes `.sheet` early and everything after it renders unstyled outside the modal, which is exactly what this caught. `_coach_test.cjs` now asserts div balance for every sheet, and this proves it in a real engine. Writes `_profile.png`, `_profile_standards.png`.
- `_shot_prog.cjs` — the Progress tab at 360/390px: measures, rather than reads, the two surfaces a reader complained about. It asserts the consistency grid is a real calendar (7 weekday rows, each holding ONE weekday — the old grid packed eight consecutive days into a row, so no column meant anything; 8 week columns with the current week on the right; today ringed exactly once; the days still to come hollow and untappable; no horizontal overflow), taps a day and checks the toast it produces, and measures the weekly-volume chart's average label against every bar's box: **zero shared pixels**, the annotation's right edge left of the first bar, and no week's own value label hidden. Both bugs were legibility bugs, and a string assertion cannot see either. Writes `_prog_volume.png`, `_prog_consistency.png`.
- `_shot_ios.cjs` — the iOS safe-area probe, and the one check that answers "why does this look wrong on an iPhone". FORGE ships `viewport-fit=cover` + `black-translucent`, so in a standalone iPhone PWA the web content is laid out UNDER the status bar and the home indicator: for a long time the header's own logo, streak chip and settings gear were drawn on top of the clock and the battery, and the rest-timer pill — `bottom:86px`, a fixed offset — ended up ~20px INSIDE the tab bar, because the tab bar grows by the home-indicator inset on a device that has one. CDP cannot emulate `env(safe-area-inset-*)` (it is always 0 on desktop), which is exactly why the app defines `--sat`/`--sab` on `:root` and every consumer reads the variable: the probe overrides those two custom properties to the real iPhone values (59px / 34px) and then MEASURES geometry. Two passes: insets 0 at 360/390/430 must leave the layout byte-for-byte where it was, and the simulated island must leave every header control below the status-bar band with nothing overlapping the tab bar. Writes `_ios_393_noinset.png`, `_ios_393_island.png`. `node _shot_ios.cjs [file.html]` probes any build, which is how it was shown to FAIL before the fix. **Do not reintroduce a bare `env(safe-area-inset-*)` consumer** — it silently un-testable, and `grep -c` for `env(safe-area` in `index.html` should stay at 2.
- `_make_iosfix.cjs` — builds a **minimal, deployable single-fix build** on top of the COMMITTED bytes. Written when the iOS fix had to reach a phone while the working tree also carried ~500 lines of an unrelated, mid-development FORGE-3D feature from another agent: shipping that to somebody's only training log to deliver a CSS fix is not a trade worth making. It reads `git cat-file blob HEAD:...` (byte-exact, never a `Get-Content`/`Set-Content` round trip, which is how `·` once became `Â·`), applies a table of literal replacements **each asserting exactly ONE match** so drifted HEAD fails loudly, asserts the `viewport-fit=cover` premise the fix exists to satisfy, and writes `_iosfix/` for the ordinary six-suite gate. Generalise it freely — the pattern is "one fix on the live build, gated, while the tree is mid-edit".
- `_preview_demos.cjs` — builds `FORGE-demo-preview.html`, a standalone page animating all 48 demos at once using the app's own engine. Generated artifact; regenerate after any pose change. The fastest way for a human to eyeball the whole set *with motion*, and it needs no server — it works from `file://`.
- `_shot_cues.cjs` — renders all 48 SET UP cues into `FORGE-setup-cues.png` using the app's own CSS for that row, so the copy can be proofread in one look. Reads the values out of `index.html`; nothing is duplicated.
- `_publish_forge.cjs` / `_verify_served.cjs` — **how a human actually views this work.** The DSH GUI's static fallback seat serves any file under the frontend dist root, and only that dist's own `index.html` is auth-gated, so publishing into a SUBDIRECTORY (`<dsh>/apps/web/dist/forge/`) makes the app reachable on port 3080 with no auth and no change to DSH itself. Two safeguards held deliberately: a subdirectory, so the app's relative `sw.js` registration 404s and **no service worker is ever installed on the host origin** (one there could cache the GUI's own assets); and a filename that is not the dist index, which is the single path that returns 401. `_verify_served.cjs` drives the published URLs in Chrome and asserts the app boots, a rig animates, the cue renders, zero service workers registered and zero failed requests. PNGs come back as `application/octet-stream` (no image type in the server's MIME map) so the sheets are inlined as data URIs in the gallery. **Re-run `_publish_forge.cjs` after any rebuild — `pnpm build` can clear the dist.**
- `_probe_sw_http.cjs` — **the only check of the deploy that runs over HTTP, and therefore the only
  one that exercises the service worker at all.** Every other suite reads the build from `file://`, and
  the app deliberately skips SW registration there — so the offline shell, the cache eviction that
  makes an update land, and the `?fresh=1` redirect a phone takes when `APP_BUILD` changes had never
  been run against the path that actually reaches the phone. It serves the frozen `_deploy/` bytes on a
  throwaway localhost origin (**never** the DSH dist subdirectory — a service worker must not be
  installed on the GUI's own origin) under their real filenames so the relative `sw.js` registration and
  the SW's `./index.html` both resolve as they will on Pages, then asserts: a pre-seeded OLD cache and
  OLD `forge_build` marker (as a real phone carries) redirect to `?fresh=1` **exactly once** — the loop
  risk is real, because the redirect target must not redirect again — the marker bumps, the SW activates
  and opens the cache named for the new build, the old cache is **evicted**, the cached shell is the new
  build, the new UI is present in the served bytes, and then **with the server stopped** the app still
  boots from cache. `node _probe_sw_http.cjs [dir]` defaults to `_deploy/` and accepts any directory
  holding `index.html` + `sw.js`. Its first run caught a bug in itself (the pill and load line were
  queried document-wide and so asserted the *bench* card's prescription, not the pull-up's) — scope a
  card assertion to `.xcard`, never to the document.
- `_build_deploy.cjs` / `_gate_deploy.cjs` — **the deploy path when the working tree is not shippable.** `index.html` is one file, so `git add index.html` ships *everything* uncommitted in it — and this tree routinely holds a co-agent's mid-development work. It did exactly that at the time of writing: the plate-grid/Train-card fix sat in the same file as ~27 KB of unfinished FORGE-3D clips, and shipping the file as it stood would have put an ungated feature on the one origin that holds the real training log. So `_build_deploy.cjs` reads the **live** bytes (`git show origin/main:…`), takes the hunks of *this* change from the real `git diff origin/main`, and applies the ones that belong to it. Classification is structural, not by eye: a hunk is the 3D agent's if any line it CHANGES falls inside the `FORGE-3D` marker region — **not** if its start line does, because unified diffs carry context and the hunk that rewrites the payload's generated-header comment legitimately begins three lines above the `BEGIN` marker. Two comment-only hunks from a third change are excluded by explicit content signature. **Every dropped hunk must be accounted for by one of those reasons or the build aborts**, so a future unrelated change cannot be silently omitted from a deploy. It then reads the result back and asserts the payload region is byte-identical to live, that this change's markers are present and the other agent's are absent, and that both build markers moved together. `_gate_deploy.cjs` copies those frozen bytes into `_gatedeploy/` alongside the icons, the norms JSON and the legacy snapshots, and runs all ten suites **there** — the suites read `index.html` from the cwd, so gating the working tree would prove things about bytes that are not going anywhere. Three traps it hit, all worth keeping: (1) a `git worktree` checkout runs the file through `core.autocrlf`/`.gitattributes` and came back **CRLF**, +1 char per line and 2507 of them, which would have rewritten every line of the committed file — write the blobs out verbatim instead; (2) `git apply` run from inside a subdirectory of the repo still resolves paths against the **repository root**, so it applied nothing and reported success — apply the hunks in-process with every context line verified; (3) a filtered patch with no trailing newline is `corrupt` to `git apply`. To commit without disturbing the co-agent's tree, stage the deploy blobs with `git hash-object -w` + `git update-index --add --cacheinfo` — **never** copy the deploy over `index.html`, which would delete work that is not yours.
- `_pack_for_upload.cjs` / `_verify_live.cjs` — the two halves of a deploy that a human performs
  from a laptop. The packager materialises `git show HEAD:index.html` and `HEAD:sw.js` as downloads
  under `dist/forge/deploy/`, prints their sha256, and verifies over HTTP that the tailnet serves
  those bytes; the verifier downloads what `guardhonour.github.io` is actually serving and compares
  it to `origin/main`, then drives that URL in headless Chrome at 390px. **The verifier compares
  against the PUBLISHED COMMIT, not the working tree** — the tree is routinely ahead of a deploy, and
  a working-copy comparison calls a good deploy a mismatch. **And it maps `rect.bar` to
  `getBoundingClientRect()` before measuring**: an SVGRectElement has no `.left`, so overlaps
  computed from the elements themselves are `NaN`, which CDP serialises to `null` and which made
  "no bar covers the average label" pass *vacuously* on any build, correct or broken. A check that
  cannot fail is worse than no check, so it now asserts the bars were measurable at all.
  **And it carries a guard against a false CLEAN, for the same reason.** Comparing live against
  `origin/main` answers "is what Pages serves the committed code?", which is *not* the question "did
  the build I just packaged get deployed?" — when a deploy is staged but not yet uploaded, `origin/main`
  and Pages both still hold the OLD build, so every byte assertion passes and the run reports CLEAN
  while the fix sits undeployed. That happened: the typed-weight/bodyweight deploy was staged at
  `2026-08-25s`, Pages was still serving `2026-08-25r`, and the verifier passed. It now also reads
  `_deploy/index.html`'s marker and asserts it is what live serves, so a staged-but-undeployed build
  **fails** the run. Use `FORGE_REF=HEAD` when you want the bytes themselves checked rather than the
  published ref.
- **The address to hand a human is the Tailscale one, never `127.0.0.1`.** `DSH_WEB_URL` reports the *local binding*, but the webserver binds loopback only, so no phone or laptop on the tailnet can reach `http://127.0.0.1:3080/...` — that resolves to the *reader's own* machine. `tailscale serve status` shows what is actually published; on this box `/` proxies to `127.0.0.1:3080`, giving `https://kilam-pc.tail55b389.ts.net/`. `_publish_forge.cjs` reads that mapping at runtime rather than hardcoding it. This is also why a hand-rolled `python -m http.server` on another port is useless to a remote reader: only proxied ports exist off-box.
- `_fixenc.cjs` — one-off repair for **double-encoded** source. A PowerShell `Get-Content`/`Set-Content` round trip decodes UTF-8 as cp1252 and writes the mojibake back, so `·` becomes `Â·` and `—` becomes `â€"` — the app still runs, it just renders `all lifts Â· 10 weeks` on screen, and **no behavioural test notices**. This reverses it exactly (strip the BOM the writer added, map each character back to the byte cp1252 produced, decode as UTF-8) and aborts rather than guessing if a character has no mapping. `_coach_test.cjs` asserts the shipped files are valid UTF-8 and BOM-free, so this can never ship silently again. **Do not use `Get-Content … | Set-Content` to edit app source** — use the file tools, whose encoding is UTF-8 by construction.
- `_changediff/` — disposable diff-vs-original artifacts.

## TECHNIQUE DEMOS (the Library animations)
Every one of the 48 exercises has its **own** animation, drawn from one shared vector engine in
`index.html` (search `/* ================= TECHNIQUE`). Uniformity is by construction, not by
convention — do not introduce a per-exercise special case in the engine or the CSS:

- **One skeleton for all 48.** `BONE` is an anatomically-derived bone-length set (scaled from a
  180 cm athlete), one 200×200 viewBox, one palette, one stroke-weight set, one four-phase tempo
  (`TEMPO`, `CYCLE` = 3140 ms). `home` is **always** the shortened-muscle position and `away`
  always the lengthened one, so phase 1 is always the controlled lowering and phase 3 the drive.
- **Poses are authored as limb *targets*, not joint angles.** Two-link IK (`ik`/`solve`) places every
  elbow and knee, so a hand or foot lands where it was authored. Reach limits are hard: a hand within
  43.5 of its shoulder, a foot within 62.8 of its hip, minimum 4.5 (arm) / 2.2 (leg).
- **Near/far depth is applied at draw time**, not in the solver (`VIEW[view].{sh,hip}`): one IK pass
  runs per limb from the joint centre, then the limb is offset rigidly. Feeding the offset into the
  solver makes a symmetric two-hand grip reachable on the near side and impossible on the far side.
- **Angles interpolate along the shortest path** (`lerpAng`). A plain numeric lerp spins a spine from
  180° to −151° the long way round and folds the body inside out mid-rep.
- **`_audit_demos.cjs` checks the *authored extremes*, and `_hard_test.cjs` asserts no rendered frame
  needs clamping.** Between two valid poses a straight-line target path can momentarily sit further
  from the joint than the limb is long (the sit-up did exactly this); `fitTarget` clamps that to "the
  limb is at full extension". That is an artefact of interpolation between two valid poses, not an
  authoring error — so the strict check lives on `home`/`away`, where a real mistake shows up, and
  would otherwise be hidden by the clamp.
- **Every exercise also carries a one-line `setup` cue**, rendered by `demoHUD` in a uniform
  `SET UP` row directly under the controls, in both the sheet and the full-screen view. It is about
  getting into position — grip, stance, machine adjustment — and deliberately does **not** repeat the
  exercise's own execution `cue`, which the sheet already shows under EXECUTION. Its job is to tell
  two look-alike movements apart: a chin-up and a pull-up differ only in the grip, and a side view
  cannot show that, so the setup line names it. `_hard_test.cjs` asserts all 48 exist, are unique,
  fit one line (≤ 80 chars), and that the HUD *element structure* is identical for every exercise —
  structure must match; the text inside is per-exercise, so compare tags, not raw markup.
- **No third-party media.** The free exercise datasets (`yuhonas/free-exercise-db`, `wrkout/exercises.json`)
  are Unlicense for the JSON but their images are static two-frame Everkinetic line art (CC BY-SA 3.0),
  and both point at a **paid** product for video. Proprietary animated-GIF libraries forbid hotlinking
  and redistribution, and `sw.js` never intercepts cross-origin, so a remote GIF would simply be blank
  offline. That route was evaluated and rejected — do not reintroduce remote media.

## OUTPUT STANDARD
- Give exact file paths you changed. After any HTML/JS edit, sanity-check the relevant test file
  and note the result honestly. Never claim a feature works without verifying the storage shape
  and the run.
- If a request would violate local-first (no backend) or durability of user data, flag it
  rather than silently building it.