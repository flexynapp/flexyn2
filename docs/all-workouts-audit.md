# All Workouts — audit, 2026-08-12

Scope: the surface behind the "All Workouts" tile on `/workout`. There is no
All Workouts *page* — it is an inline `<Dialog>` at `src/pages/Workout.jsx:2840`.

| Sub-feature | File | Verdict |
|---|---|---|
| 1. Gym tab | `components/workout/WorkoutSavedList.jsx` (180) | **(b) exists, was broken → fixed** |
| 2. Cardio tab | `components/cardio/CardioSavedList.jsx` (128) | **(a) exists and works** — defect already fixed on main before this audit |
| 3. Edit & Delete | `components/workout/EditWorkoutModal.jsx` (446) | **(a) exists and works** — no confirmed in-scope defect; zero test coverage |
| 4. Search | `Workout.jsx:2874` + both lists | **(c) partially wired** — indexes and renders dates differently; never indexes exercise names |

Method: source read on `origin/main` (not the stale local checkout), production
SQL, the repo's own suites, and two live `QueryObserver`s to settle the one
question that reasoning got wrong.

---

## 0. Ground truth, re-measured

`origin/main` = `b2c04e8b`. Local `~/flexyn2` was at `f60fc89c`, ~70 commits
behind — **that difference changed two of this audit's verdicts** (§2).

```sql
select (select count(*) from workout_logs) gym_rows,
       (select count(*) from workout_logs where total_volume > 0) vol_pos,
       (select count(*) from workout_logs where coalesce(duration_min,0)>0) dur_pos,
       (select count(*) from workout_logs where updated_at > created_at) edited,
       (select count(*) from cardio_logs where coalesce(duration_seconds,0)>0) c_sec;
-- gym_rows=9  vol_pos=1  dur_pos=0  edited=0  c_sec=5
```

Everything in the brief's ground-truth block reproduced **except `notes`**:

| Column | Brief | Measured | Why |
|---|---|---|---|
| `notes` | 3 of 9 | **0 of 9** | `count(notes)` is 3; all three are the **empty string**. `count(*) FILTER (WHERE notes <> '')` is 0. |

Non-null is not non-empty — the same distinction CLAUDE.md's dead-columns
section already teaches about non-null vs non-zero, one column across.

---

## 1. Lead 1 — which path wrote `total_volume = 0`

**CLAIM.** Six logs store `total_volume = 0` while carrying real work, and the
brief asks whether `Workout.jsx` wrote them or a script bypassed it.

**PROOF.** `idempotency_key` settles it. `Workout.jsx:1765` puts it in the same
`create` payload as `:797` puts `total_volume` — so a client-written row carries
both or neither.

| Rows | `idempotency_key` | `total_volume` | created |
|---|---|---|---|
| the 3 real rows | **present on 3 of 3** | 4995 / 0 / 0 | minutes-to-days apart |
| the 6 "Push A" rows | **absent on 6 of 6** | 0 | **all within 783 ms** on 2026-08-10 |

The key has been written by the client since **2026-05-24** (`e713f1d7`), three
months before those rows existed, so its absence cannot be a missing feature.
Six rows with backdated `date` values, identical titles, one guest account, no
idempotency key, in under a second, is a seeding script.

**VERDICT: not a client bug.** The live writer is correct on 3 of 3 rows it
wrote — and the two zeros among them are honest (one log has no exercises, one
derives to 0).

**WHAT FAILURE WOULD LOOK LIKE.** A row carrying an idempotency key *and*
`total_volume = 0` against non-zero derived volume. There are none.

**CLAUDE.md.** The correction dated 2026-08-11 is **already there** (lines
513–531) and already says migration 329 is a one-shot that these rows postdate.
The brief was written against the stale checkout. One refinement is worth
adding and I have left the original visible — see §7.

## 2. Lead 7 — the reconcilers

**CLAIM.** Something already reconciles stored volume; would it have healed §1?

**PROOF.** `pg_get_functiondef` on the installed bodies.
`reconcile_my_workout_volume` filters `COALESCE(total_volume,0) > 0` **and**
`created_at > now() - 7 days`. The six rows are inside the date window and
excluded by the `> 0` filter.

**VERDICT: no, and correctly so.** It is reached — `src/lib/data/workouts.js:47`
calls it — and skipping zero rows is right, because crediting a seeded row would
put fabricated volume on a leaderboard.

## 3. Sub-feature 1 — the Gym tab · **BROKEN → FIXED**

**CLAIM.** Six components register `['workoutLogs', email]` with six different
limits, so they share one cache entry.

**PROOF.** Six call sites, read: `WorkoutSavedList:52` (500), `Workout.jsx:596`
(50), `Dashboard:1122` (50), `Progress:508` (1000), `BodyMetricsTab:28` (1000),
`useNutritionTargets:51` (1000). `WorkoutSavedList` is a **static** import at
`Workout.jsx:30`, so both register on the same mount.

**The direction of the damage is the opposite of the obvious reading, and I got
it wrong first.** I claimed the Gym tab was capped at 50. Measured with two live
`QueryObserver`s against the installed react-query:

```
A (limit 50)  fetches           → entry = 50
B (limit 500) mounts, refetches → entry = 500
A now renders                   → 500 rows it never asked for
```

With the default `staleTime: 0` a second observer does not read the stale entry —
it refetches with its **own** queryFn and overwrites for everyone. So the list
got its 500; every *other* reader got rows it never requested. Opening
All Workouts ▸ Gym replaced the Workout page's 50-row entry with 500.

**FIX.** `src/lib/data/workoutKeys.js`, mirroring `cardioKeys.js` — which closed
the identical defect for `cardio_logs` on 2026-08-12 and left the gym half
untouched. Invalidation is unedited: React Query matches `queryKey` as a prefix,
so the eleven existing `invalidateQueries(['workoutLogs', email])` calls still
clear all six scopes. Asserted, not assumed.

**WHAT FAILURE LOOKS LIKE.** Reverting the key makes two tests fail:
`does not clobber the Workout page's 50-row entry` and `registers under the
savedList scope`. Verified by actually reverting.

**An earlier version of the first test passed against the bug.** It asserted the
list rendered its own rows, which it does either way. That is exactly the
vacuous test the method section warns about; it was rewritten to assert the
neighbour's entry survives.

## 4. Sub-feature 2 — the Cardio tab · **already fixed, no change**

**CLAIM.** Same shared-key defect as the gym side.

**PROOF.** True, and closed before this audit opened. `CardioSavedList` on
`origin/main` uses `cardioLogsKey(email,'savedList')` and
`cardioData.listSummaries` (five columns, not `select('*')`);
`CardioDetailModal` fetches its own row by id. Guarded by
`cardioLogsKey.test.js` and `cardioDetailFetch.test.jsx`.

**How I nearly mis-reported it:** the first pass read these files from
`f60fc89c`. `git diff f60fc89c origin/main` shows both cardio files changed and
`WorkoutSavedList` identical — which is what pointed at the gym side.

Lead 5 confirmed: `cardio_logs.duration_min` is 0 of 5 and `duration_seconds` is
5 of 5; **neither file on this surface reads the dead column.**

## 5. Sub-feature 3 — Edit & Delete · **no confirmed defect, no change**

**CLAIM (lead 4).** No component test exists for the three list/edit files.

**PROOF.** Confirmed, and stronger than a grep suggests. `EditWorkoutModal` is
named by three test files and **rendered by none**: `workoutTitle.test.js:50` and
`workoutDuration.test.js:61` carry it as a *file-path string* inside an invariant
test, and `workoutStoredVolume.test.js:12` mentions it in a comment.
`CardioSavedList` is `vi.mock`ed to `<div/>`. `WorkoutSavedList` had zero
references — now nine tests.

**Lead 3 confirmed, and it proves nothing.** `updated_at > created_at` is 0 of 9:
zero triggers on `workout_logs`, and `makeEntity().update()` sends only the
caller's payload. **Nothing stamps the column.** Same trap as regimens; do not
read it as an edit signal.

**WHAT I DID NOT DO.** I did not drive the 446-line modal. Its clamp/validation
layers and its delete-time volume reconciliation are unexercised by this audit.

## 6. Sub-feature 4 — Search · **partially wired, no change**

**CLAIM.** Search works.

**PROOF.** It does, with two gaps, both read in source:

- **Rendered and indexed dates disagree.** `WorkoutSavedList:131` formats with
  `{ locale: dateLocale }`; `:64` builds the search index with **no locale**. A
  Spanish user sees `ago 9` and can only find it by typing `August`.
  `CardioSavedList:54` has the same split.
- **Exercise names are never indexed.** Neither list reads `log.exercises`. With
  `title` NULL on every row a real account wrote and `tags` empty on 9 of 9,
  that is the only text most users could search by.
- One `historySearch` serves both tabs, so a query typed on Gym reports failure
  on Cardio.

Added one **characterization test** recording today's behaviour (an English
month name matches). Invert it when the locale is bound; do not delete it.

## 7. Lead 6 — the two `TO PUBLIC` policies · **needs Kegan's decision**

**CLAIM.** Both tables carry one `ALL` policy `TO PUBLIC`, the shape migration
347 just fixed on `goals`.

**PROOF.** Executed, rolled back, probe identity asserted distinct from the row
owner:

| Probe | Result |
|---|---|
| `anon` → `workout_logs` | `42501 permission denied for function current_user_email` |
| `anon` → `cardio_logs` | same |
| authenticated **non-owner** | **0 rows** — correctly blocked |
| authenticated **owner** | 2 rows — legitimate case still works |

**VERDICT: no live leak.** anon is stopped only by a missing EXECUTE grant on
`current_user_email`, which CLAUDE.md calls "not a boundary". Latent, not live.

**The `food_items` trap does not apply here.** That trap is that scoping *one*
of several permissive policies removes the throwing expression and lets another
succeed. Each of these tables has **exactly one** policy, so scoping it to
`authenticated` leaves anon with no permissive policy at all.

**SHIPPED as migration 349, applied 2026-08-12.** Re-probed after applying, and
the anon result *changed shape*, which is the whole point: it now returns **0
rows cleanly** because no policy applies to it, rather than `42501 permission
denied for function current_user_email`. The block no longer depends on a
missing GRANT.

| Post-migration probe | Result |
|---|---|
| `anon` → both tables | **0 rows**, no error — no policy applies |
| authenticated non-owner → both | 0 rows |
| non-owner INSERT forging another `user_id` | **rejected** |
| owner → `workout_logs` | 2 rows |
| owner (a user who has cardio) → `cardio_logs` | 2 rows |

The second owner probe exists because the first owner has no cardio rows, so
`cl=0` proved nothing about that table until it was run against a user who does.

## 8. Lead 2 — the empty log · **historical for the reason given, live for another**

**CLAIM.** One log has zero exercises; is the save path still capable of it?

**PROOF.** Row `dad0ba31` (2026-07-26) carries an idempotency key, so the client
wrote it. The obvious explanation is wrong: `shouldKeepSet`'s bodyweight branch —
the fix for "a calisthenics workout saved as `exercises:[]` behind a success
toast" — landed **2026-06-10** (`17e2357c`), six weeks *before* that row.

Reading the installed predicate (`realisticLimits.js`), a live path remains:

```js
if (!hasReps) return false;
return hasWeight || !!ctx.isBodyweight || !!ctx.isCardio;
```

A **weighted** exercise logged with reps and no weight is dropped, the exercise
is then dropped at `Workout.jsx:746`, and nothing re-checks. The Save button
guards `exercises.length === 0` on the **pre-filter** array; the insert uses the
**post-filter** one.

**Not fixed here — it is the save path, upstream of this surface**, and belongs
to a Workout-save audit rather than All Workouts. What is in scope is what the
Gym tab renders for such a row, and it is correct: no exercise count, no set
count, no volume segment — no zeros. Locked by a test.

## 9. SQL — not run, pending a decision

```sql
-- Scopes both owner policies to `authenticated`. Same shape as migration 347
-- on `goals`. Safe here because each table has exactly ONE policy, so there is
-- no second permissive policy to un-shadow.
ALTER POLICY "workout_logs: owner full access" ON public.workout_logs TO authenticated;
ALTER POLICY "cardio_logs: owner full access"  ON public.cardio_logs  TO authenticated;
```

`ALTER POLICY … TO role` per CLAUDE.md — it changes roles without restating
expressions full of the `alias.column` tokens the paste pipeline mangles.

---

## RESULTS

**Confirmed defects**

1. **Six `workout_logs` readers shared one cache entry** (§3). Fixed in
   `845ffd89`. Frontend only.
2. **Empty-workout save is still reachable** for a weighted exercise logged with
   reps and no weight (§8). Confirmed, **not fixed** — upstream of this surface.
3. **Search indexes dates without the locale it renders them with** (§6).
   Confirmed, not fixed — characterized.

**Latent, needs a decision:** two `TO PUBLIC` policies (§7).

**What passed**

- `total_volume`'s live writer is correct (§1); the six zeros are seeded rows.
- The reconcilers are reached and correctly skip zero rows (§2).
- The Gym tab renders no zeros for a 0-exercise log — CLAUDE.md's rule, held.
- Neither cardio file reads the dead `duration_min`.
- No live RLS leak, both directions, with the legitimate case still working.

**Already fixed before this audit** — the Cardio tab's shared key and
`select('*')` (§4). Reported as audited, not as my fix.

**Pre-existing suite failure, not mine.** `i18nCoverage > coverage does not
regress below 79%` fails on clean `origin/main` with the identical value
(`ru` at 0.78981 against a 0.79 floor). I confirmed this by stashing and
re-running the same command. My first check appeared to pass only because
`npx vitest` skips the i18n splitter that `npm run test` runs — the CLAUDE.md
trap, in the direction that makes a pre-existing failure look like yours. Not
raising the floor: that defeats the ratchet.

**What I did not do**

- Did not drive `EditWorkoutModal` (446 lines) — no rendered coverage added.
- Did not open the 25 server-side consumers beyond the two reconcilers.
- Did not verify anything in a browser; jsdom + measured cache behaviour only.
- Did not act on the empty-save path or the search locale split.

**Penpot.** The page **All Workouts** carries one board, `All Workouts —
proposed`. **I created it earlier today. It is not Kegan's design and must not
be implemented from** — treating an agent's proposal as the brief is exactly
what the check-for-a-board rule exists to prevent. No UI was invented or changed
in this audit.

## CLAUDE.md correction (2026-08-12)

The dead-columns entry for `workout_logs.total_volume` already carries its
2026-08-11 correction and I have left it, and the superseded "fixed at both
ends" sentence above it, visible. One refinement is added there: the six zero
rows are a **seeding artefact**, not evidence about the writer — they carry no
`idempotency_key`, which the client has written since 2026-05-24, and landed six
at a time in 783 ms. No row written by the app has a wrong `total_volume`.
