# Audit — Progress page stats dashboard

Run 2026-08-11 against `origin/main` @ `3e411d6b` and production
(`ebvqxuwfiptcmlkhflfj`). Six sub-features were named in the brief:
Total Workouts, Total Workout Time, Total Calories Burned, PR Lifts,
Volume, Workout Frequency.

**One of the six has no home on this page. One is correct code that has
never had data to render. One had a real defect, and it was not on this
page at all — it was in the writer three screens away.** Short version
before the detail:

| # | Sub-feature | Verdict | |
|---|---|---|---|
| 1 | Total Workouts | **(a) exists and works** | 4 surfaces, agree by construction; one documented ceiling |
| 2 | Total Workout Time | **(b) exists, correct, unexercised** | writer landed 2026-08-10; 0 of 9 rows carry it; rows self-hide |
| 3 | Total Calories Burned | **(d) absent here / (c) partially wired upstream** | **DEFECT FOUND AND FIXED** in the manual cardio writer |
| 4 | PR Lifts | **(a) exists and works** | the 2026-08-10 bodyweight fix reached both list surfaces |
| 5 | Volume | **(b) exists; stored column is wrong on 6 of 9 rows** | reported, not fixed — see why |
| 6 | Workout Frequency | **(a) exists and works** | the `=== 1` lead is a false alarm; proof below |

One code change shipped. Nothing was restored, and the deliberately
deleted cardio aggregate stays deleted.

---

## Ground truth — re-verified, and it does not fully hold

The brief's ground-truth block was checked line by line. Most of it held.
**Two lines did not, and one of them is the most important number in this
audit.**

| Claim in the brief | Verified |
|---|---|
| `workout_logs` — 9 rows, 3 users, 2026-07-13 → 2026-08-09 | ✅ exact |
| `exercises` 9/9 · `user_id` 9/9 · `created_by` blank 0 | ✅ exact |
| `workout_logs.duration_min` 0 of 9 | ✅ exact |
| `cardio_logs` — 5 rows, 3 users, 2026-05-13 → 2026-08-09 | ✅ exact |
| `distance_meters` 5/5 · `duration_seconds` 5/5 non-zero · `calories` 5/5 non-null, 3/5 non-zero | ✅ exact |
| `cardio_logs.duration_min` 0 of 5 | ✅ exact |
| **`workout_logs.total_volume` "9 of 9 populated"** | ❌ **9/9 non-null, 1 of 9 NON-ZERO** |
| **"migration 329's backfill plus Workout.jsx persisting on save both landed"** | ❌ both landed; the column is still wrong on 6 of 9 rows |

The brief warned about exactly this trap one paragraph earlier — "calories
is 5-of-5 non-null but 3-of-5 non-zero, and those are different facts" —
and then applied the un-warned reading to `total_volume`. `count(col)`
against `count(*)` says populated; `count(*) FILTER (WHERE col > 0)` says
otherwise:

```
rows=9  total_volume non-null=9  total_volume > 0 = 1
```

**A third fact neither document carries, and it reframes everything
below:** 6 of the 9 workout rows are **seeded test data**. They belong to
`be8d18f6…`, a guest account created 2026-08-10 17:11, and all six rows
were inserted at **2026-08-10 18:23** within 700 ms of each other, with
back-dated `date` values spread across 2026-07-13 → 2026-08-09. Same
title ("Push A"), same single exercise, Bench Press climbing 135 → 145 →
… That account holds 0 XP, level 1, streak 0. A parallel session seeded a
multi-week series to exercise a chart. The real population of this
dashboard is **two accounts and three logs.**

---

## Rule Zero — does each sub-feature exist?

### 1. Total Workouts — (a) exists and works

**Four** surfaces, not the three the brief lists:

| Surface | Expression | Period |
|---|---|---|
| Hero slide "Workouts" | `logs.length` | all time |
| Frame stats row | `frameLogs.length` | 7 / 30 / 365 / all, labelled |
| `AnalyticsTab` stat card | `logs.length` | all time |
| `AdvancedAnalyticsSheet` "Total workouts" | `model.workouts` = `logs.length` | all time |

**Can they disagree on screen at the same moment? No, and not by luck.**
All three all-time surfaces read the same `logs` array — the same
`useMemo` output, post-`filterAfterReset`. They cannot diverge without a
code change. The frame row is windowed but prints its own window as the
card's heading ("Last 7 Days"), which is the fix audit 20 finding 7
already applied to this page. **Lead ruled out.**

One real ceiling, unexercised: `LOG_FETCH_LIMIT` is **1000** and the query
is `'-date'` ordered, so every all-time figure on this page — count,
volume, PRs — is really "your most recent 1000 sessions". At three
sessions a week that is 6.4 years away. Worth knowing, not worth changing.

### 2. Total Workout Time — (b) exists, is correct, and has never had data

**The brief is wrong that this has no home.** It is two rows in
`AdvancedAnalyticsSheet` — "Total time" and "Avg session" — derived
through `workoutDurationMin()` and gated on `model.hasDuration`.

The writer exists and is correct: `Workout.jsx:1760` writes
`[DURATION_COLUMN]` (= `duration_min`), auto-filling from the live elapsed
timer when the user gives no manual value. That landed in **`d0a15d2b`,
2026-08-10** — the commit that fixed the client writing `duration_minutes`
at a table whose column is `duration_min`, which `db.js`'s strip-and-retry
had been silently dropping since launch.

So `duration_min` at 0 of 9 is the **third shape** from CLAUDE.md: the
writer exists and its precondition has not yet been met. Of the 9 rows,
two predate the fix (2026-07-25, 2026-08-07) and six are the seeded batch,
which never went through `Workout.jsx` at all. **No real session has been
saved since the writer landed.**

And the surface handles the absence correctly — both rows drop together
rather than reporting "0 min" twice, which is the behaviour the sheet's own
head comment says it was built for. **Unexercised, not broken. Nothing to
fix.**

### 3. Total Calories Burned — absent on this page, defective upstream

**On the Progress page: (d) absent.** `grep -rn calories src/pages/Progress.jsx
src/components/progress/` returns comments, the InsightsTab TDEE block, and
a CSV column. No calories stat is rendered on any of the four surfaces.

And `Progress.jsx:623-628` records that an aggregate of exactly this was
deliberately deleted:

> A session COUNT, not a stats object. It also summed distance, duration
> and calories on every frame change and nothing ever read any of the
> three — the card shows one number. […] If a distance or duration stat is
> wanted here, add it to the card and the sum with it.

That is a decision with a stated rationale and a standing invitation.
**I did not restore it.** Adding a calories stat to the frame card is
product work, not a fix, and it needs Kegan's call.

**But the underlying quantity is (c) partially wired, and the entry path
that skips it is a genuine defect — see the RESULTS section.** The TDEE
estimate in `InsightsTab` was rewritten by audit 21; I did not go near it.

### 4. PR Lifts — (a) exists and works

Three surfaces, and the 2026-08-10 bodyweight fix is on both that answer
"what are my bests":

| Surface | Ranking |
|---|---|
| `topPRs` (`Progress.jsx:666`) | loaded first, heaviest down; then bodyweight by reps; tie → name |
| `PersonalBestsSheet.bests` | **identical** — same three-clause comparator |
| `PRHistoryModal` | per-exercise history, a different question |

The defect the `topPRs` comment describes — `.filter(pr => pr.weight > 0)`
dropping every push-up and pull-up so a bodyweight lifter saw no PRs on the
page while the sheet one tap below listed them — **was fixed on both
sides, not one.** Verified by reading both comparators, not by trusting
the comment.

Two divergences, both unexercised and neither worth a change:
`PersonalBestsSheet` skips a log with no `date` (`if (!log?.date) return`)
and `topPRs` does not, so a date-less row would contribute to one list and
not the other — every production row has a date. And
`AdvancedAnalyticsSheet`'s "Strongest lift" / "Most reps" break ties by
first-encountered rather than by name.

### 5. Volume — (b) exists; the stored column is wrong on 6 of 9 rows

The page's own arithmetic is fine. `calcVolume` (`Progress.jsx:133`) is
sum(weight × reps) and is used consistently for the frame row and as the
hero's fallback. **The problem is one layer down** — see RESULTS.

On the bar-weight question the brief raised: `calcVolume` takes no
`includeBarWeight` argument at all, and neither does the profile counter.
So **every volume figure on Progress is RAW**, which is the side CLAUDE.md
requires for anything leaderboard-adjacent, and the page is at least
self-consistent. It does mean a user with `include_bar_in_volume` on sees a
bigger number in `LiveVolumePill` mid-session than on Progress afterward.
That is the same trade the weekly review makes deliberately ("a personal
number that silently disagrees with the comparative number beside it is
worse than one that is merely raw"). **Consistent with the documented
rule. Not a defect; no change.**

### 6. Workout Frequency — (a) exists and works; the lead is a false alarm

`Progress.jsx:219` filters `d.Workouts === 1`. The brief asks what happens
on a day with two workouts. **Nothing, and `>= 1` would be identical**, because
two lines up the value is constructed as:

```js
Workouts: loggedDays.has(format(day, 'yyyy-MM-dd')) ? 1 : 0
```

`loggedDays` is a **Set** of date strings. `Workouts` is only ever 0 or 1,
so `=== 1` and `>= 1` are the same predicate and always will be. A day with
two sessions counts once — correct for a metric labelled "Days Trained
(30d)" and "N / 30 days", and the bar chart's y-domain is `[0, 1]` to
match. **Ruled out. No change.**

---

## Checks — claim / proof / failure

**1. Does the stored `total_volume` agree with the exercises it came from?**
*Proof:* derive volume from the JSONB in SQL and compare per row.
*Failure:* any row where they differ.
**6 of 9 differ** — 675, 725, 870, 775, 800 and 660 lbs of real logged
work, all stored as 0. Not chronological: the newest row (2026-08-09) is
one of them and a 2026-07-25 row is correct. **Confirmed — see RESULTS.**

**2. Did migration 329's backfill actually run?**
*Proof:* Gabe's 2026-07-25 row predates the write-path fix (`ae98c477`,
2026-08-09) yet carries a correct 4995. Only the backfill can have put it
there. *Failure:* would have been that row at 0 too.
**It ran. This is not an un-applied migration.**

**3. Then why are 6 rows still zero?**
*Proof:* their `created_at` is 2026-08-10 18:23, **after** 329 ran. 329 is
a one-shot `UPDATE`, not a trigger. *Failure:* if they predated it.
**The backfill is a snapshot with no invariant behind it.**

**4. Can the reconciliation RPC heal them?**
*Proof:* `pg_get_functiondef('reconcile_my_workout_volume')` — the
installed body, not the migration — filters on
`COALESCE(total_volume, 0) > 0`. *Failure:* would have been that it
recomputes from `exercises`. **It cannot. A zero row is skipped by
design, so it can never credit `user_profiles.total_volume_lbs`.**
Measured: the seeded account has 4505 lbs derived and **0** in both the
column and the profile counter.

**5. Is anything reading these columns from inside the database?**
*Proof:* `SELECT proname FROM pg_proc WHERE prosrc ILIKE '%workout_logs%'
OR prosrc ILIKE '%cardio_logs%'` → **25 functions**, of which six mention
`total_volume` (`get_friend_leaderboard`, `get_gym_community_progress`,
`get_period_leaderboard`, `get_trophy_progress`,
`sync_my_crew_challenge_progress`, `update_solo_challenge_progress`) and
`generate_weekly_review_for` mentions `calories` and `duration_min`.
*Failure:* calling these columns client-only. **They are not. Every zero
here is read by a leaderboard or a review.**

**6. Which cardio entry path writes a zero calorie count?**
*Proof:* all three import `estimateCalories`; the two live trackers call it
unconditionally on save. `CardioManualForm` puts it behind an optional
"Estimate" button and saves `Number(calories) || 0`. Corroborated by the
data — the two zero-calorie rows have suspiciously round distances
(11265.408 m = exactly 7.00 mi, 3218.688 m = exactly 2.00 mi) while the
auto-computed row is 722.8546936794438 m. *Failure:* would have been a
messy distance on a zero row. **Confirmed — see RESULTS.**

**7. Is the cap the cause instead?**
*Proof:* `getMaxRealisticCalories(900, {})` = round(18 × 70 × 0.25) = **315**,
against a MET estimate of 224. **Not the cause. Ruled out before fixing.**

**8. Are `AnalyticsTab`'s `t()` calls a latent raw-key render?**
*Proof:* ran `scripts/split-i18n.mjs` and checked all 15 generated
dictionaries for `progress.totalWorkouts`, `progress.workoutFrequency`,
`progress.daysTrained30d`. *Failure:* a key absent in any language.
**Present in all 15.** These are fully-translated keys, not new
English-only ones — `tFallback` is the standard for the latter.
**`t()` is legitimate here. No change**, and converting them would be
churn against 15 shipped translations.

**9. Do the three all-time workout counts read the same array?**
*Proof:* read all four call sites. **Yes — one `useMemo`, three consumers.**

---

# RESULTS

## Confirmed defect — fixed

| # | Severity | Defect |
|---|---|---|
| **1** | **Medium** | `CardioManualForm` stored a hard **0** in `cardio_logs.calories` whenever the user left the optional field alone, via `Number(calories) \|\| 0`. That is not an absence — it is a claim that the session burned nothing, and no consumer can tell the two apart. `generate_weekly_review_for` sums this column into the week's cardio kcal, so a blank field understated the review by the entire session. **This form was the only entry path with the problem:** `CardioLiveTrackerIndoor` and `CardioLiveTrackerOutside` both call the same `estimateCalories` and store the result without asking, while here it sat behind a "Estimate" button nobody has to press. **2 of 5 production rows carry the zero**, both manual entries with real distance and duration behind them. Blank now runs the same estimator; a **typed** 0 is still stored as 0. |

`src/components/cardio/__tests__/cardioManualCalories.test.jsx` — **5 tests,
new file.** The first reproduces the production row exactly: Kegan's
2026-08-09 treadmill session, 900 s over 3218.688 m, which stored 0 against
a MET-derived 224.

Verified the tests are not vacuous by reverting the fix and re-running: the
two that assert the new behaviour **fail** against the old code, and the
three that pin unchanged behaviour (typed value, typed 0, Estimate button)
pass against both. The typed-0 carve-out is what makes the change safe and
it is pinned by its own test.

## Confirmed defect — reported, NOT fixed

| # | Severity | Defect |
|---|---|---|
| **2** | **Medium** | `workout_logs.total_volume` is a denormalised cache with **one writer and no invariant**. Migration 329 was a one-shot `UPDATE`; `Workout.jsx` writes the column on save; nothing enforces it for any other insert path. Six rows inserted on 2026-08-10 — after 329 ran — carry 0 against 4,505 lbs of real derived volume, and `reconcile_my_workout_volume` filters on `total_volume > 0` so they can never heal. Six database functions read this column, including two leaderboards and the gym's "lbs moved" tile. |

**Why I did not fix it.** The six bad rows are a parallel session's seeded
guest data, so a backfill re-run would be tidying someone else's test
fixtures. The durable fix is a derive-on-write trigger, and
`total_volume` is invariant territory — it is the column
`get_gym_leaderboard` ranks members on, and CLAUDE.md is explicit that it
must stay RAW. **Adding a trigger to a leaderboard-ranked column without
asking is exactly the change that should not be made unilaterally.**
Recommendation and the idempotent SQL are at the foot of this document.

## Browser render — what the numbers actually look like

jsdom paints nothing and recharts measures a 0×0 container, so the figures
were checked in a real browser via the stub-alias harness (recipe at the
foot of this document). `AdvancedAnalyticsSheet` takes `logs` as a prop, so
it renders standalone. Four fixtures, at 375×812:

| Fixture | Rendered |
|---|---|
| **none** (0 logs) | "Start logging workouts to see your progress" — an honest empty state, no zeros |
| **one** (1 log) | `4,995` · **"1 workout"** (singular branch resolves) · Strongest 555 lbs · Squat |
| **prod** (the real 9-row shape) | `9,500` · 9 workouts · Strongest 555 lbs · Squat · **Most reps 12 · Pull-Up** · Unique 3 · Most performed Bench Press · 6× · Top muscle Legs |
| **dense** (60 logs / 4 months) | `49,350` · 60 workouts · no overflow, no truncation |

Three things this settled that reading could not:

- **No `0`, `—`, `NaN`, `Infinity` or `$NaN` renders in any fixture.** Every
  figure is a real number or the row is absent.
- **On the production shape, "Total time" and "Avg session" do not render at
  all** — the `hasDuration` gate works, and the sheet does not print "0 min".
  Re-run with durations attached and both appear: **7 h 3 m** total and
  **47 min** average against 423 minutes over 9 sessions, which is exact.
- **The hero reads `9,500`, which is the DERIVED sum, not the stored column.**
  Production's `total_volume` column sums to 4,995 across the same nine rows.
  So every Progress-page volume figure is **immune to defect 2** — it
  re-derives from the `exercises` JSONB. The stored column's blast radius is
  the six database functions that read it, not this page. That is the single
  most useful thing the render pass established, and it narrows the defect
  rather than widening it.
- **`Most reps 12 · Pull-Up` confirms sub-feature 4 on a third surface** —
  the bodyweight lift survives into the sheet's LOAD group as well as into
  both bests lists.

**Not done in the browser: the frame toggle (7d / 30d / 90d / All).** It
lives in `Progress.jsx` itself rather than in a prop-driven child, so
driving it needs the whole page mounted with its four queries stubbed. The
All-Time null-prev-period branch was verified by reading instead —
`FRAME_PREV.all` is `null`, so `prevFrameWorkouts`, `prevFrameCardio` and
`volumeDelta` are all `null` and every delta line is suppressed rather than
comparing against an empty window. That is a read, not a render, and I am
flagging it as the one gap.

## Checks that PASSED

Total Workouts agree across all four surfaces by construction · the frame
row labels its own window · Total Workout Time is correct and self-hides
rather than printing "0 min" · the duration writer (`d0a15d2b`) writes the
column the table actually has · PR ranking is identical in `topPRs` and
`PersonalBestsSheet`, bodyweight bests included on both · Workout Frequency
`=== 1` is equivalent to `>= 1` by construction · `AnalyticsTab`'s `t()`
keys exist in all 15 languages · migration 329 did run · Progress volume is
uniformly RAW and consistent with the leaderboard rule · `calcVolume` is
correct arithmetic · lint clean · build clean.

## What I did NOT do

- **Did not restore the deleted cardio distance/duration/calories
  aggregate.** Removed deliberately with a stated rationale, quoted above.
  Its last sentence invites adding a stat to the card — that is a product
  call, not a bug fix.
- **Did not add a calories or workout-time stat to the Progress page.**
  Neither exists there; building them is new product work.
- **Did not touch `InsightsTab`.** Its 8 defects belong to
  `docs/progress-insights-goal-audit.md` and its TDEE block to audit 21.
  Nothing I found lands inside it.
- **Did not convert `AnalyticsTab`'s `t()` to `tFallback`** — checked, and
  `t()` is correct for keys that ship in all 15 languages.
- **Did not add a `total_volume` trigger or re-run the 329 backfill.** See
  above; both need a decision.
- **Did not drive the frame toggle in a browser.** See the render section —
  it needs the whole page mounted, and the All-Time branch was settled by
  reading instead. This is the one deliverable I did not complete as asked.
- **Did not run an authenticated end-to-end round trip.** Same limit the
  two previous audits hit — it needs a real sign-in.
- **Did not touch `whileHover` on the AnalyticsTab stat cards.** The brief
  rated it low-stakes and it is: `whileHover` is inert on touch, costs
  nothing, and the sheet is reachable on a desktop PWA.

## The thing that outranks every defect above

**This dashboard has three real workout logs behind it.** Six of the nine
rows are a guest account seeded yesterday by another session; the other
three belong to two accounts, one of which is Kegan's. Five cardio rows
across three users, the oldest 90 days old.

So the honest reading of `duration_min` at 0 of 9 is not "the stat is
broken" — it is that the writer landed the day before yesterday and nobody
has saved a workout since. The honest reading of `total_volume` at 1 of 9
is not "the writer is broken" — the one real user who saved through
`Workout.jsx` got a correct 4995 in the row **and** in their profile
counter. The one defect that is genuinely live, reproducible and reaching a
real consumer is the calorie zero, and it is live precisely because it sits
on the path a real person actually used twice.

**The most valuable finding is the one that is not a defect yet:**
`total_volume` has no invariant, only a snapshot. It was correct on
2026-08-09 because a migration made it correct that day, and it was wrong
again 30 hours later. Nothing detected that. At three users it is a
curiosity; at three thousand it is a leaderboard that ranks people by which
code path happened to write their row.

---

## Recommendation — the `total_volume` invariant (needs a decision)

Two options, in increasing order of commitment. **Neither is applied.**

**(a) Re-run the backfill.** Migration 329's body is idempotent by
construction — it only touches rows where stored and derived differ — so it
is safe to run at any time. This heals today's six rows and buys nothing
against the next non-`Workout.jsx` insert.

**(b) Derive it on write.** A `BEFORE INSERT OR UPDATE` trigger computing
the same sum would make the column true by construction, and the client
write becomes redundant rather than authoritative. This is the real fix and
it touches a leaderboard-ranked column, so it wants your sign-off — in
particular that the trigger must use the RAW formula with no bar weight,
per CLAUDE.md's "stored volume is RAW" rule.

## Reproducing the render harness

Deliberately **not committed** — throwaway scaffolding. To rebuild:

- `harness.html` at root (with `class="dark"` on `<html>`) mounting
  `/src/harness.jsx`
- `src/harness.jsx` mounting `AdvancedAnalyticsSheet` inside
  `QueryClientProvider` + `LanguageProvider`, with the fixture chosen by
  `?fx=none|one|prod|duration|dense`
- `vite.harness.config.js` aliasing `@/api/db`, `@/api/supabaseClient`,
  `@/lib/AuthContext`, `@/lib/WeightUnitContext` to one stub module, plus
  `optimizeDeps.entries: ['harness.html']` — without it the dep scan walks
  `index.html` → `App.jsx` → `virtual:pwa-register` and the server dies on
  an unresolved import
- `npx vite --config vite.harness.config.js --port 5233 --strictPort`.
  **Not 5199** — a parallel session holds it and its SPA fallback returns
  200 for any path, so you get the wrong app and cannot tell. Confirm with
  `curl -s localhost:5233/harness.html | grep -c src/harness.jsx`.

Read the numbers with `get_page_text`, not a screenshot: the Browser pane
pauses rAF when hidden, so a framer-motion surface can still be mid-fade
when the screenshot lands.

## Reproducing the SQL

Every production figure in this document came from `execute_sql` as
`postgres`. Row-level counts and derivations do not need RLS; no claim here
depends on what a particular user can see, so the
`SET LOCAL role authenticated` harness was not required. The one query
worth keeping:

```sql
WITH derived AS (
  SELECT w.id, w.date, w.total_volume,
    COALESCE((
      SELECT sum(COALESCE((s->>'weight')::numeric,0) * COALESCE((s->>'reps')::numeric,0))
      FROM jsonb_array_elements(COALESCE(w.exercises,'[]'::jsonb)) ex
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ex->'sets','[]'::jsonb)) s
    ),0) AS calc_volume
  FROM public.workout_logs w
)
SELECT date, total_volume, calc_volume, (total_volume::numeric = calc_volume) AS agrees
FROM derived ORDER BY date;
```
