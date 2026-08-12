# Goals — audit

**Measured 2026-08-12 against `origin/main` @ `f941ed78` and production.**
Every figure is a measurement with a timestamp. Two claims in this document
would have been wrong if I had not checked *when* something happened —
see [Finding 1](#f1), which is a defect that fixed itself a week after it
struck.

**Status: decisions taken, changes shipped.** Recon, RULE ZERO and the
probes came first; Kegan then took the three calls that were his (below),
and this document was updated to match rather than left as the draft that
preceded them.

---

## Scope

| Sub-feature | Verdict | Live defect? |
|---|---|---|
| Create & Edit a Goal | **(a) exists and works** | No — but 3 of 5 production rows are debris from a bug fixed in May |
| Goal Progress & the Almost-Complete nudge | **(a) exists and works** | No — correct, and largely unexercised for want of matching logs |
| Complete a Goal | **(a) exists and works** | No — **unexercised**: 0 goals completed, ever |
| Cardio Goals screen | **deliberately removed 2026-08-11** | Cleanup was incomplete — 674 orphaned lines + 2 stale mocks, now deleted |

**Already covered; not re-reported.** `docs/progress-insights-goal-audit.md`
audits the *Projected Goal Date* card on Progress → Insights and pins 8
defects (B4, D1, D2, C1, C5, B6, B7, B2b, E1) with **labelled
characterization tests** in `insightsTab.test.jsx` that pass against the
bugs on purpose. Nothing here touches that card, and those tests must be
inverted rather than deleted when someone fixes them.

---

## The population, stated up front

This matters more than any single column count.

| | |
|---|---|
| `public.goals` | **5 rows, 3 authors** |
| by type | `strength` 3 · `cardio_distance` 2 |
| by status | `active` 5 · **`completed` 0** |
| by period | `lifetime` 5 |
| created in last 14 days | 1 |
| triggers on `goals` | **0** |

**This is the meal-plans shape, not the regimens shape.** Regimens had 33
rows from 28 real authors, which is what made an empty column there
damning. Here, 5 rows from 3 people — and **3 of those 5 are duplicates of
one goal** (see Finding 1) — so the honest count is *three distinct goals
across three users.* An empty column on this surface is weak evidence of
anything. I have tried to say **"unexercised"** wherever that is what I
mean, and to separate it from "no writer exists".

Columns at zero, with the reason distinguished:

| Column | Populated | Why |
|---|---|---|
| `target_value`, `unit` | 0 of 5 | **No writer.** `GoalForm` has four branches and none of them emits either. Not a usage gap — the form cannot produce them. |
| `current_value` | 0 non-zero | **No writer, and no reader on this surface.** Progress is derived from logs at render time by `goalProgress.js`. The column is vestigial. |
| `description` | 0 of 5 | No writer in `GoalForm`. |
| `completed_at` | 0 of 5 | **Unexercised.** `complete_goal()` writes it and is correct — nobody has completed a goal. |
| `deadline` | 0 of 5 | **Unexercised, not dead.** The form writes it on all four branches and `GoalsList` reads it. Three users simply did not set one. |
| `period_start_date` | 0 of 5 | All 5 goals are `lifetime`, for which a period start is meaningless. Correct. |
| `achieved_weight` / `achieved_reps` | 0 of 5 | Snapshotted on completion. Follows `completed_at`. |
| `notes` | **5 of 5** | Worth noting because it inverts the regimens result. Every value came from onboarding (`"Set from onboarding"`, `"Current 5K: 20:00 · Set from onboarding"`, `"For army "`). |

---

<a name="f1"></a>
## Finding 1 — three of five goals are duplicates, from a bug that no longer exists

**CLAIM.** `sjoudrie@gmail.com` holds three byte-identical goals: Deadlift,
350 lb × 5, notes `"For army "`, no title.

**PROOF.** Their `created_at` values:

```
2026-05-14 00:31:54.482485+00
2026-05-14 00:31:54.632551+00
2026-05-14 00:31:54.816892+00
```

**334 milliseconds end to end.** Three inserts inside a third of a second
is not three decisions; it is one submit landing three times.

**Then the check that changes the verdict.** `GoalForm`'s submit button
carries `disabled={isSubmitting}`, fed from
`createMutation.isPending || updateMutation.isPending`. So the guard
exists today. When was it added?

```
3238e25c  2026-05-21  fix: round-4 exhaustive audit — context memoization, async safety, UI guards
```

**Seven days after the duplicates landed.** The bug was real, it is fixed,
and it was fixed before I got here. Reporting it as a live defect would
have been exactly the error this method is supposed to prevent — the same
error, in the other direction, as the meal-logging audit declaring search
"never built" a week before search shipped.

**FAILURE would have looked like:** the guard predating 2026-05-14, which
would have meant the duplicates had some other cause still in the code.
They do not.

**What remains is data, not code.** Three junk rows sit in production and
`sjoudrie@gmail.com` sees the same Deadlift goal three times on the Goals
list today. There is no unique constraint on `goals` to have prevented it
and none is proposed — a user may legitimately hold two goals for the same
lift at different targets.

→ **DECIDED AND APPLIED 2026-08-12: keep the oldest, delete the other two.**
Verified afterwards against production — `goals` is now 3 rows, exactly one
Deadlift goal remains, and it is `7384fda0-…` created at `00:31:54.482485`,
the first of the three. Neither deleted id is still present.

→ **Keep the oldest.** Deleting user rows
is Kegan's call and the repo tooling is right to refuse a migration that
does it, so the statement was handed over inline and is recorded in the
head of migration 347 — not executed by it. A migration that deleted these
ids would re-run against a rebuilt database where they do not exist.

---

## Finding 2 — the Cardio Goals screen outlived its own removal by a day · **DELETED**

**A CORRECTION IS RECORDED HERE, because I got this wrong first and the
wrong version is the more tempting one.**

My first pass concluded: *"508 lines with no importer; `git log -S'CardioGoals'
-- src/pages/` returns nothing, so it was **never wired**; and it was
bug-fixed yesterday by someone who did not know no user could open it."*

Every observation in that sentence was true. The conclusion was false, and
it was false because **I searched `src/pages/` for the importer of a
component that was mounted from another component.** The right query is:

```
git log -S'CardioGoals' -- src/components/cardio/CardioSection.jsx
  c1b2861d  2026-05-22  feat(cardio): 14-feature cardio expansion — … goals …
  0e7a2d6d  2026-08-11  Cardio: Start Session — one hero, one sheet, three rows of pills
```

**It was wired from 2026-05-22 until 2026-08-11.** `0e7a2d6d` removed it,
deliberately, and said so in its own message:

> "Saved Workouts, Cardio Goals and Devices & Apps come off the screen;
> each already has a home (All Workouts ▸ Cardio, **the Goals form**,
> Settings ▸ Connected apps)."

So this is category **"deliberately removed"**, not "never built" — and
the destination the commit names is exactly what this audit independently
confirmed: `GoalForm` has `cardio_distance`, `cardio_duration` and
`cardio_sessions` branches, and `GoalsList` / `GoalsAlmostComplete` render
cardio goals through the shared `goalProgress.js`. The feature has a home.

**And the "fixed a screen nobody could reach" jab was wrong too.** The two
commits are twenty hours apart, in the sensible order:

```
ce422f31  2026-08-11 02:08  fixed a real bug in a screen that was still live
0e7a2d6d  2026-08-11 22:09  took the screen off the Cardio page
```

Nobody fixed a screen they had already removed. They fixed it in the
morning and the evening redesign superseded it.

**What was actually wrong: the removal was incomplete.** `0e7a2d6d` was
careful about its own debris — it deleted `cardioTileCopy.test.jsx`
because "its entire premise … no longer has four tiles", and pulled the
orphaned i18n keys and their `AWAITING_TRANSLATION` entries. It missed:

| Left behind | |
|---|---|
| `src/components/cardio/CardioGoals.jsx` | 508 lines, no importer |
| `src/components/__tests__/cardioGoalsScreen.test.jsx` | 166 lines, 6 tests, testing an unmounted screen |
| `vi.mock('@/components/cardio/CardioGoals')` × 2 | in `cardioSectionHeader.test.jsx` and `cardioDeepLink.test.jsx` — mocks of a module nothing in the graph imports |

**FIX.** All four removed. The two suites whose mocks I deleted still pass
(12 tests), which is the proof those mocks were no-ops. Two present-tense
comments that named the screen as a live caller — in `goalProgress.js` and
`GoalForm.jsx` — now say what happened to it; the two past-tense ones that
record why the calculator was consolidated are left exactly as they were,
because they are still true.

**Test count falls by 6 on purpose.** The suite is not supposed to shrink,
and this is the exception the rule allows: a test whose subject no longer
exists. Same reasoning `0e7a2d6d` applied to `cardioTileCopy.test.jsx`.

---

## Finding 3 — completion works and has never once run

**CLAIM.** `completed_at` is 0 of 5 and every goal is `active`, so the
completion path is broken.

**PROOF that it is not.** `complete_goal(p_goal_id uuid)` — read from
`pg_get_functiondef()`, not from the migration — is SECURITY DEFINER,
derives the user from `auth.uid()` **and** `current_user_email()`, and
performs the transition atomically:

```sql
UPDATE public.goals SET status='completed', completed_at=now()
  WHERE id=p_goal_id AND created_by=v_email AND status='active'
```

Scoped to the owner, idempotent by construction (`AND status='active'`),
returning `{already:true}` on a second call so the caller skips the XP
grant. `authenticated` holds EXECUTE. Both callers — `GoalsModal` and
`GoalsAlmostComplete` — use it and honour the `already` flag.

**So this is (a) exists and works, and unexercised.** Five goals, three
users, no completions. That is a usage fact, not a defect, and on a table
this small it is not even surprising.

**One latent inconsistency, not a live bug.** Both callers fall back to a
direct `goalsData.update(goalId, { status: 'completed' })` when the RPC is
missing (`42883` / `42P01`). That fallback sets `status` but **not
`completed_at`** — which would produce a completed goal the Dashboard hero
can never surface, since its slide keys on `completed_at`. The RPC exists
and is granted, so this branch is unreachable today. Worth deleting on the
next pass through the file; not worth a migration.

---

## Finding 4 — the hero's "Goal Completed" slide can never show its number

**CLAIM.** `HeroSlideshow` renders a completed goal with an animated
metric.

**PROOF that it cannot.** `HeroSlideshow.jsx:298` reads:

```js
const tv = Number(g.target_value);
…
if (Number.isFinite(tv) && tv > 0) { slide.metricValue = tv; slide.metricUnit = g.unit || ''; }
```

`target_value` and `unit` are **0 of 5 with no writer** — `GoalForm`'s four
branches emit `target_weight`/`target_reps` for strength and
`target_distance_meters` / `target_duration_seconds` / `target_sessions`
for cardio, and never the generic pair. So the guard is always false and
the slide is always title-only.

**This is graceful, not broken** — the code degrades exactly as written,
and `g.title` and `g.description` have the same shape (the form writes
neither; the two titles in production came from onboarding). Severity is
low. But it is a real "0-of-N with no writer", distinct from the
unexercised columns above, and it means a branch of the Dashboard hero is
unreachable by construction rather than merely unvisited.

Cheapest honest fix if it is worth anything: have `HeroSlideshow` derive
the metric from the typed columns it already has, the same way
`summarizeGoalTarget` does. Not proposed here — the slide needs a
completed goal first, and there have been none.

---

## Checks that PASSED

**RLS, executed rather than read.** `goals` carries one policy — `owner
full access [ALL]` — and its `polroles` is empty, i.e. `TO PUBLIC`. `anon`
holds table SELECT. Probed as a real authenticated user who owns none of
the rows: **0 rows returned, correctly scoped to the owner.** Probed as
`anon`: blocked — but by `42501 permission denied for function
current_user_email`, i.e. **only by a missing GRANT on a helper**.

That is the same shape CLAUDE.md calls "not a boundary" (mig 303 scoped
the hub feed to `authenticated` for exactly this reason), and it is a
stronger case here than it was on `workout_templates` in the regimens
audit, because `goals` holds real user data rather than being empty.
Latent, not live. Worth scoping the policy `TO authenticated`.

**Progress arithmetic.** `goalProgress.js` derives progress from logs at
render time and does not read `current_value`. The two `cardio_distance`
goals have matching logs (5 cardio logs, all with distance, activities
`running_outside`, `running_treadmill`, `walking_outside`). The three
Deadlift goals have **0 matching logged sets** across 9 workout logs — so
they sit at 0%, correctly, for want of a Deadlift ever being logged.

**Duplicate-submit guard.** Present and wired today (see Finding 1).

---

<a name="decisions"></a>
## Decisions for Kegan — none of these are mine to take

All three were put to Kegan before anything was changed. His answers:

1. **The three duplicate Deadlift goals → keep the oldest, delete the
   other two.** Handed over as inline SQL rather than shipped as a
   migration: a migration that deletes user rows would re-run against a
   rebuilt database where those ids do not exist. The statement is
   recorded in the head of migration 347 so a future reader can tell
   production from a fresh build. Same posture as migration 344.
2. **`CardioGoals.jsx` + its test → delete both.** Done, plus the two
   stale `vi.mock` lines. See Finding 2 — this turned out to be finishing
   a decision he had already made and documented on 2026-08-11, not a new
   one.
3. **Scope the `goals` policy `TO authenticated` → yes.** Migration 347.

## What shipped, and what did not

**Shipped and applied 2026-08-12:** migration 347 (policy scope); deletion of `CardioGoals.jsx`,
its test, and two stale mocks; three comment corrections; this document.

**Handed over, and run by Kegan on 2026-08-12:** the duplicate-row DELETE.

**Both re-verified after the fact, in both directions** — because a policy
scoped to the wrong role is how you blank a page, and "it returned no rows"
looks identical whether the policy closed or the feature broke:

| probe | before 347 | after 347 |
|---|---|---|
| `anon` reads `goals` | blocked by a missing GRANT on `current_user_email` — *not a boundary* | **0 rows, blocked by the policy itself** |
| owner reads own goals | 1 | **1 — no regression** |
| owner reads another user's goals | 0 | **0 — still scoped** |

**Not done:**

- **No tests added.** The suite loses 6 and gains 0. Everything confirmed
  here was settled by SQL or by git history, and neither is a thing a
  vitest case can pin. The one behaviour worth a test — the duplicate
  submit — is already guarded, and the guard predates me by three months.
- Did not drive the Goals surface in a browser harness — jsdom paints
  nothing, and every claim above is settled by SQL or by grep, not by
  render. The empty states and the nudge copy are unverified visually.
- Did not audit `GoalsProgressStrip` or the Nutrition page's goals
  integration beyond confirming they mount.
- Did not re-open the Projected Goal Date card. Covered elsewhere.
