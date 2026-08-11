# Audit — Body Metrics

Run 2026-08-11 against `origin/main` @ `df72f0e6` and production
(`ebvqxuwfiptcmlkhflfj`). Five sub-features were named in the brief:
Weight Log, Measurements, Body Fat %, Chart Over Time, Trend Indicator.

**Two of the five are not features, and one of those was deliberately
removed.** The short version, before any detail:

| # | Sub-feature | Verdict | |
|---|---|---|---|
| 1 | Weight Log | **(a) exists and works** | one writer, `LogWeightModal`, now tested |
| 2 | Measurements (chest/waist/hip) | **(c) partially wired — BY DECISION** | columns + a reader; writer removed on purpose |
| 3 | Body Fat % | **(c) partially wired** | same shape; never had a client writer |
| 4 | Chart Over Time | **(d) absent** | nothing plots body metrics anywhere in the app |
| 5 | Trend Indicator | **(b) exists, 8 known defects** | audited *today* by a parallel session — not re-audited here |

Nothing was "restored". Two real defects were found and fixed, both in
sub-feature 1's blast radius. Details and proofs below.

---

## Ground truth — re-verified, not trusted

The brief's ground-truth block was checked line by line before any of it
was used. **It held in full.**

| Claim | Verified |
|---|---|
| `body_metrics` columns as listed | ✅ exact |
| 4 rows, 3 users | ✅ |
| `weight_lbs` 4/4 · `body_fat_pct` 2/4 · chest/waist/hip 2/4 · `notes` 0/4 | ✅ exact |
| 2026-05-20 → 2026-06-04 | ✅ nothing logged in 68 days |
| `BodyMetricsTab.jsx` 47 lines · `LogWeightModal.jsx` 206 · `bodyMetrics.js` 16 | ✅ exact |
| The BodyMetricsTab header comment | ✅ verbatim |

Two things the block did not say, both material:

- **`user_id` is 4 of 4 and `created_by` is blank on 0 of 4.** This is
  what settles the identity lead — see check 6.
- **`~/flexyn2` was 103 commits behind `origin/main` with a dirty tree.**
  All work here was done in a worktree branched off `origin/main`.

---

## Rule Zero — does each sub-feature exist?

### 1. Weight Log — (a) exists and works

`LogWeightModal.jsx`, opened from the Dashboard quick action or
`/dashboard?logWeight=1`. It is the **only** client-side writer of a
`body_metrics` row in the app. It dual-writes: `user_profiles.weight_lbs`
first (idempotent UPDATE), then the `body_metrics` row (INSERT with no
unique constraint). That order is deliberate compensation — reversed, a
failure after the INSERT lets a retry create a second row for one date.

**Which is authoritative, and can they diverge?** `user_profiles.weight_lbs`
is authoritative for the app — XP formulas, leaderboards, TDEE, the coach
and the reveal step all read it. `body_metrics` is the history, read only
by the projection card, the CSV export, the AI Coach digest and the weekly
review. They **can** diverge, in exactly one direction: profile written,
row INSERT failed. That is the designed trade (a duplicate row is worse
than a missing one) and the user sees an error toast. Divergence in the
other direction is impossible.

### 2. Measurements — (c) partially wired, and this is a DECISION

`chest_cm` / `waist_cm` / `hip_cm` are 2 of 4 — a k-of-N, which CLAUDE.md
warns is usually not a bug. It is not one here.

Migration 133's own head names the intended writer: *"so the onboarding
body-baseline step and Progress tab can store waist / chest / hip"*. Both
are gone. `Onboarding.jsx:3820-3825` records the removal in place:

> This block used to also write body-fat / waist / chest / hip from a
> "body baseline" step, and only ran when that step was filled in. That
> step is gone, so the measurement columns have no source and the gate
> moves to the weight step's own "did they actually touch it" flag

And `BodyMetricsTab.jsx`'s header records the other half:

> body-measurement logging was removed here per product direction — the
> heat map is the whole page.

The two rows carrying measurements are dated 2026-05-27 and 2026-05-28,
inside the window when that step existed. **Nothing to fix.** The only
reader left is the CSV export, which labels the columns `(cm)` honestly.

### 3. Body Fat % — (c) partially wired

Same 2-of-4 shape, same two rows, same removed onboarding step. It differs
from measurements in one way: it has a second, live reader —
`responders.js:1129` feeds `bodyFatPct` into the AI Coach's context digest.
So the Coach can cite a body-fat figure that **the user has no way to set
or correct anywhere in the app**. That is a product gap, not a code defect,
and it affects 2 accounts.

### 4. Chart Over Time — (d) ABSENT

There is no chart of body metrics anywhere. `bodyMetrics` is passed to
exactly one component (`Progress.jsx:1282` → `InsightsTab`), which uses it
for a projected *date*, a CSV export and a row count. `ChartWidgets.jsx`
charts exercise trends and muscle groups from `workout_logs`.

Proven visually, not just by grep: the harness rendered an 18-point,
18-week series and **no graph is drawn** — the card prints "Dec 30, 2026 ·
140 days away · 0.6 lbs/week pace" and three stat columns.

**Building this is new product work. Not started — see "What I did not do".**

### 5. Trend Indicator — (b) exists, and was audited today by someone else

It is the projection card in `InsightsTab`: `TrendingDown`/`TrendingUp`,
"losing weight"/"gaining weight", "Trending wrong way", rate per week,
Current/Goal/Remaining. It is unit-aware and locale-aware.

**`docs/progress-insights-goal-audit.md` landed on `origin/main` today**
(commit `fbbb48b2`) with 8 confirmed defects against this exact card — B4
false congratulation, D1/D2 blank card, C1/C5 success-over-failed-write,
B6 "0.0/week", B7 no horizon cap, B2b off-by-one — each pinned by a
labelled characterization test in `insightsTab.test.jsx`.

I re-derived D1/D2 independently before finding that write-up, then
stopped. **I have not re-reported, re-fixed or re-tested any of it.**
Those 8 remain open and belong to that audit.

---

## Checks — claim / proof / failure

**1. Do the measurement columns have a writer?**
*Proof:* `grep` over `src/`, `supabase/`, `scripts/` returns one CSV export
(`InsightsTab.jsx:547-549`) and one test fixture. No INSERT/UPDATE anywhere.
Migration 133 + the two removal comments explain the 2 populated rows.
*Failure would look like:* a live writer found, making this a real k-of-N
entry-path bug. **Not found — (c) by decision.**

**2. Is anything reading `body_metrics` from inside the database?**
*Proof:* `SELECT proname FROM pg_proc WHERE prosrc ILIKE '%body_metrics%'`
→ **two live consumers**, invisible to a `src/` grep:
`generate_weekly_review_for` (reads `weight_lbs` for the week's start/end
weight) and `sweep_stale_guest_accounts` (a row protects a guest account
from deletion). Both key on `user_id`, not `created_by`.
*Failure:* calling the table dead. **It is not dead.**

**3. Can the client's `created_by`-only filter miss a row?**
*Proof:* `count(*) FILTER (WHERE created_by IS NULL OR created_by = '')`
→ **0**, and `count(user_id)` → 4 of 4. Then as each real owner:
`SET LOCAL role authenticated` + JWT claims → user A sees 2 rows, user B
sees 1, and `WHERE created_by = <their email>` returns the *same* count in
both cases.
*Failure:* RLS allows a row the client filter cannot see. **Not present —
but with 4 rows this is unexercised, not proven safe for a server-stamped
row that does not yet exist.**

**4. Is the table reachable by `anon`?**
*Proof:* the policy is `TO PUBLIC` and `anon` holds `SELECT` — the mig-303
shape. As `anon`: `ERROR 42501: permission denied for function
current_user_email`. And evaluating the predicate with a null identity
returns **0 rows**, so the grant is not the only thing protecting it.
*Failure:* rows returned to anon. **None. Not a leak; I am not reporting
one.** Worth hardening to `TO authenticated` for defence in depth, but it
is not a defect and I did not change it.

**5. Do the range CHECK constraints protect anything?**
*Proof:* all five are `NOT VALID` (never validated against existing rows).
The 699 lb row predates them and is inside `LogWeightModal`'s 70–700 guard.
*Failure:* a constraint claimed as enforcement that isn't. **Recorded, not
changed** — validating them is a migration with no current beneficiary.

**6. Does the weight writer honour the unit preference?**
*Proof:* `toLbs(parsed, weightUnit)` converts before storing, and
`VALID = ['lbs','kg','stone']`. But the input's native `max` and
`placeholder` branched on **kg alone**. **DEFECT — see below.**

**7. Does the quest that says "log a body measurement" lead anywhere?**
*Proof:* `questCatalog.js` mapped `BODY_METRIC_LOGGED` →
`/progress?tab=body`; `Progress.jsx:1265` renders `BodyMetricsTab` for that
tab; that component is 47 lines of heat map + cycle tracker with no input.
**DEFECT — see below.**

**8. Is `src/lib/data/bodyMetrics.js` used?**
*Proof:* zero importers. Every real call site uses `db.entities.BodyMetric`
directly (`Progress.jsx:534`, `LogWeightModal.jsx:97`) or raw supabase
(`Onboarding.jsx:3828`). Its `purgeForUser` has no caller — though so do
nine other modules' `purgeForUser`, because account reset is implemented as
the client-side `filterAfterReset`, not deletion. **Reported, not deleted:
it is a codebase-wide pattern, not a Body Metrics defect, and removing one
of ten is worse than leaving all ten.**

---

# RESULTS

## Confirmed defects — both fixed

| # | Severity | Defect |
|---|---|---|
| **1** | **High** | The `log_body_metric` daily quest deep-linked to `/progress?tab=body`, a tab with no way to log anything. Tapping the quest row (`DailyQuestsCard.jsx:60`) landed the user on the muscle heat map; the quest stayed at 0/1. The comment above it asserted "the measurement form" was there — it was removed per product direction. **InsightsTab had the identical wrong destination in its empty-state copy and it was already fixed there**; this was the same defect in the other file that names one. Now `/dashboard?logWeight=1`, which `Dashboard.jsx:1056` consumes. |
| **2** | **Medium** | `LogWeightModal`'s native `max` and `placeholder` branched on kg alone, so `stone` — the third member of `VALID`, selectable in Settings — fell to the lbs arm: `max="700"` (9,800 lb once converted) and a placeholder reading `154.0`, i.e. a suggestion of 2,156 lb. Everything the browser accepted above 50 was then rejected by the JS guard as "looks off" — the native control and the app disagreeing about one field. Both are now derived from the guard via `fromLbs`, so they cannot drift again. This also corrected kg from a hardcoded `318` to `317` (700 lb = 317.5). |

Verified in a real browser, per unit: lbs `max=700 / 154.0`, kg
`max=317 / 69.9`, stone `max=50 / 11.0`, stone prefill `13.21` for 185 lb.

## Also changed

- **`LogWeightModal`'s header comment described a flow that no longer
  exists** — "writes the same row BodyMetricsTab would", "mirrors what
  BodyMetricsTab does on save", and a range-guard comment instructing the
  next contributor to "keep both paths in sync" with a guard that was
  deleted with the tab's form. Rewritten to say what is true: this modal is
  the only client-side writer, and there is no second path.

## New test coverage

`src/components/dashboard/__tests__/logWeightModal.test.jsx` — **13 tests,
new file.** The only writer of a `body_metrics` row had none, which is the
gap the goal-projection audit's write-up closed by naming. Covers the
dual-write ordering (asserted as a *sequence*, since the order is the
compensation strategy), no-row-on-mirror-failure, the `yyyy-MM-dd` date
key, conversion for all three units, the native bounds per unit, the guard
applied post-conversion, and quest crediting.

One test is worth reading before changing it: the over-ceiling stone entry
is caught by the **native bound**, not the JS guard, so no toast fires and
the assertion is on the *write*. Asserting on the toast would have passed
against the bug and failed against the fix.

Plus one in `questCatalog.test.js` pinning the quest destination — the
existing "every quest has a destination route" check passes for a route
that cannot complete the action, which is exactly how defect 1 survived.

## Checks that PASSED

Ground truth verbatim · RLS cross-user isolation (A sees 2, B sees 1) ·
client filter reaches every row its owner owns · `anon` returns 0 rows by
predicate, not just by a missing grant · both database-side consumers key
on `user_id` · `/dashboard?logWeight=1` is consumed · the dual-write order
is correct compensation · `toLbs` conversion for all three units ·
`format(d,'yyyy-MM-dd')` is a key and correctly stays date-fns · CSV
labels cm columns honestly · the Body tab's minimal render is intentional
and documented · lint clean · build clean · 4449 tests across 319 files.

## What I did NOT do

- **Did not build the Chart Over Time.** It does not exist; building it is
  new product work, not a fix. **This needs a decision.**
- **Did not touch the Trend Indicator's 8 open defects.** They were
  confirmed and pinned by `docs/progress-insights-goal-audit.md` earlier
  today. Re-fixing them here would collide with that branch.
- **Did not restore measurement or body-fat logging.** Removed per product
  direction, quoted above. Restoring it is a product decision.
- **Did not validate the `NOT VALID` CHECK constraints**, harden the
  `TO PUBLIC` policy, or delete the unused `bodyMetrics.js` — each is
  recorded above with why.
- **Did not run an authenticated end-to-end round trip.** Same limit the
  previous audit hit: it needs a real sign-in. The write path is now
  covered by unit tests and the render is covered by the harness; what
  remains unproven is LogWeightModal → PostgREST → card refresh on a live
  session.

## The thing that outranks every defect above

**3 of 57 profiles have ever logged a body weight, and the last entry is
68 days old.** Sub-feature 2 and 3's writers were deliberately deleted,
sub-feature 4 was never built, and sub-feature 5 serves exactly one
account. This feature is not broken so much as abandoned — and a report
claiming five defects in it would be describing code nobody runs. The two
fixed here matter because they are on the one path that is still live: the
quest that tells people to log a weight, and the modal they land in.

---

## Reproducing the render harness

Deliberately **not committed** — it is throwaway scaffolding and does not
belong on `main`. To rebuild:

- `harness.html` at root mounting `/src/harness.jsx`
- `src/harness.jsx` mounting `BodyMetricsTab`, `InsightsTab` (at no-data /
  one-row / the real 4-row production shape / an 18-week dense series) and
  `LogWeightModal`, with unit from `?unit=`
- `vite.harness.config.js` aliasing `@/api/db`, `@/api/supabaseClient`,
  `@/lib/AuthContext`, `@/lib/WeightUnitContext` to stubs, plus
  `optimizeDeps.entries: ['harness.html']` — otherwise the dep scan drags
  `index.html` → `App.jsx` → `virtual:pwa-register` in and the server dies
  on an unresolved import.
- `npx vite --config vite.harness.config.js --port 5233 --strictPort`.
  **Not 5199** — a parallel session holds it and its SPA fallback serves
  200 for any path, so you get the wrong app and cannot tell. Confirm with
  `curl -s localhost:5233/harness.html | grep -c src/harness.jsx`.
