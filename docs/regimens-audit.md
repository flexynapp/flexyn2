# Regimens — audit

**Measured 2026-08-12 against `origin/main` @ `3ce405e7` and production.**
Every figure below is a measurement with a timestamp, not a fact. Re-run
before trusting it; two claims in the brief that produced this audit had
already decayed, and one of them was written by me the day before.

The design for this surface is the Penpot page **"Regimens"** (761
shapes), built by [`docs/penpot-regimens-board.js`](penpot-regimens-board.js),
landed as `3ce405e7`. Nothing here proposes a UI the board does not.

---

## Scope, stated plainly

| Sub-feature | Verdict | Code changed? |
|---|---|---|
| My Regimens & Active Plan | **(a) exists and works** | Yes — one XP defect fixed |
| Create & Edit Regimen | **(a) exists and works** — but the claim that nobody has edited one is **unprovable** | No |
| Browse & Clone Community Regimens | **(b) exists and is broken** — clones land, the counter never moves | Yes — `equipRegimen` |
| Rate & Review a Regimen | **(b) exists and is broken** — the adoption guard has never enforced anything | Yes — migration 346 + 6 tests |

**What I did NOT do:** I did not implement the board's UI redesign (the
active-plan band, the cost line on the library card, the muscle tags, the
overflow menu, the sets-per-muscle strip). That is a separate, larger
piece of work, and one finding here changes its order — see
[Finding 3](#finding-3), which had to be fixed *before* the cost line can
ship or the library would have advertised ~14 min for ~47 min sessions.

**Already covered elsewhere; not re-reported:** the store's difficulty
filter. `difficulty` is NULL on 33 of 33 and the four level chips could
only ever return an empty list — this was found and removed by the
shipped Explore Regimens board (`RegimenStorePage.jsx:419`, "NO
DIFFICULTY FILTER"). Verified: no difficulty chip exists on any surface
this audit owns.

---

## Corrections to the ground truth I was handed

Two of the figures in the brief were wrong, and one was wrong in a way
that mattered.

| Claim | Measured 2026-08-12 | Consequence |
|---|---|---|
| `exercises[].muscle_groups` 212 of 212 | **209 of 212** | Cosmetic. Three exercises carry an empty array. |
| `parent_regimen_id` / `parent_id` — NEITHER COLUMN EXISTS, so the fix is "add the parentage column the clone path never had, or drop the adoption requirement" | Both are indeed absent — but **`original_template_id` exists and IS the parentage column**, written by every clone path, populated on 2 rows | The fix is a **column name**, one identifier, not a new column and not a product change. See [Finding 1](#finding-1). |
| "`copy_count` is 0 of 33, so the clone path has never run" | The clone path **has run twice** | The defect is not an unreachable feature; it is a counter write that RLS silently drops. See [Finding 2](#finding-2). |

And one correction to my own board commit `3ce405e7`, which said
`updated_at > created_at` = 0 of 33 means *"nobody has ever edited a
regimen, so the pencil has never earned its slot"*:

> **That inference is invalid.** There are **zero triggers on
> `public.regimens`**, and `makeEntity().update()` in `src/api/db.js`
> sends only the caller's payload. *Nothing anywhere stamps `updated_at`
> on a regimen.* The column equals `created_at` on 33 of 33 rows because
> **it has no writer**, not because nobody edits. The edit path may be
> fine, may be broken, or may be unused — this column cannot tell you
> which, and neither can I without instrumenting it.
>
> This is CLAUDE.md's own "a derived value mistaken for a source" trap,
> and I walked into it while writing the section that warns about it.

---

## Method

Every check below states the **CLAIM**, the **PROOF** that settles it,
and what **FAILURE** would have looked like. Reading code and finding it
plausible is not a proof. All RLS and trigger work was executed as a real
authenticated user — `SET LOCAL role authenticated` plus
`request.jwt.claims` — because MCP runs as `postgres` and bypasses RLS
entirely. Every probe cleaned up after itself and verified the cleanup in
the same call.

---

<a name="finding-1"></a>
## Finding 1 — the review-adoption guard has never enforced anything · **FIXED (mig 346)**

**CLAIM.** `trg_enforce_review_adoption` is a live `BEFORE INSERT`
trigger on `regimen_reviews` that is supposed to require you to own or
have cloned a regimen before reviewing it. It enforces nothing for a
non-owner.

**PROOF (read the installed artefact).** `pg_get_functiondef()` — not the
migration — shows the clone check queries `parent_regimen_id` and
`parent_id`. `information_schema.columns` returns **0** for both on
`public.regimens`. The query therefore raises `undefined_column`, and the
function's own trailing `EXCEPTION WHEN undefined_column THEN RETURN NEW`
catches it and **allows the insert**. A guard that catches its own
exception is a no-op.

**PROOF (execution, which is what actually settles it).** As a real
authenticated user, in a probe that deleted its own rows and verified
`regimen_reviews` was back to 0:

| probe | identity | result |
|---|---|---|
| A | guest account — neither owner nor cloner | **INSERT ALLOWED** |
| B | the owner | INSERT ALLOWED |
| C | a genuine cloner | INSERT ALLOWED |

**FAILURE would have looked like:** probe A returning `42501
review_requires_adoption`. It did not.

**Why nobody noticed:** `regimen_reviews` holds 0 rows. The client half is
correct and has simply never been reached — `regimenReviews.submit()` maps
`42501` → `needs_adoption` and `RegimenReviewsBlock` renders an amber
"Adopt the regimen first" hint, a branch that has executed **zero times**
in production.

**THE FIX, and why it is smaller than the brief assumed.**
`public.regimens.original_template_id` already exists and is exactly the
parentage the guard wanted. Every clone path writes it — `regimens.js
copyTemplate()` and `crews.js equipRegimen()` — and 2 of 33 production
rows carry it. So the guard needed **one identifier corrected**.

Verified on a **shadow trigger over a temp table**, so the live trigger
was never touched during testing:

| probe | expected | result |
|---|---|---|
| A stranger | BLOCKED | `42501 review_requires_adoption` ✅ |
| B owner | ALLOWED | ✅ no regression |
| C cloner | ALLOWED | ✅ no regression |

The `EXCEPTION` handler is removed in the same migration. With a real
column it can no longer fire for the reason it was written, and all it can
do now is mask the next rename the same way it masked this one. It is
deliberately *not* replaced with `WHEN OTHERS`.

**Direction matters:** deleting the handler *without* fixing the column
would have turned a silent no-op into a hard `42703` on every review
insert — worse than the bug. Both halves ship together.

**Other triggers on this feature checked for the same shape:**
`trg_bump_regimen_review_updated_at` has no exception block. `regimens`,
`workout_templates` and `workout_logs` carry no triggers at all. This was
the only instance.

---

<a name="finding-2"></a>
## Finding 2 — clones land, the counter is dropped on the floor · **FIXED**

**CLAIM.** `copy_count` is 0 on 33 of 33 rows, so — per the brief — "the
clone path has never run".

**PROOF that the claim is false.** Two rows carry
`original_template_id`, both pointing at "Upper Body Power Day". The clone
path ran on 2026-05-22 and 2026-07-28.

**PROOF of which path.** The two clone paths leave different fingerprints
in `original_author_username`: `regimens.copyTemplate()` writes
`original.author_username || 'Unknown'` — and `regimens` has no
`author_username` column, so it *always* writes `'Unknown'` — while
`crews.equipRegimen()` writes `source.created_by.split('@')[0]`. Both
production rows read `'sjoudrie'`. **Both came from Crew Chat's "equip
this regimen", not from the store's Adopt button.** The store's Adopt path
has genuinely never run.

**PROOF of the defect (execution).** `equipRegimen` bumps the source with a
direct client `UPDATE` on **another user's row**. Probed as
`keganbergeron@gmail.com` against a regimen owned by
`sjoudrie@gmail.com`, with the identity asserted cross-user first and the
value restored afterwards:

| mechanism | result |
|---|---|
| direct cross-user `UPDATE` (what the code does) | **0 rows matched, no error raised**, `copy_count` 0 → 0 |
| `increment_copy_count()` RPC (what `regimens.js` uses) | `copy_count` 0 → 1 |

**FAILURE would have looked like:** the direct UPDATE raising `42501`. It
does not — the "owner full access" policy scopes writes to
`created_by = auth.email()`, so PostgREST matches zero rows and returns
200 with an empty array. There is no error for the `.catch(() => {})` to
catch. Same shape as the storage `remove()` case in CLAUDE.md.

**Instructive detail:** the comment being replaced was *itself* the fix
for a 2026-05-25 audit finding. That pass corrected the column name
(`clone_count` → `copy_count`) and left the mechanism broken, so the badge
kept reading 0 for a different reason than before. The correct mechanism
was two files away the whole time.

**THE FIX.** `equipRegimen` now calls `increment_copy_count`, and reports
a failure through `reportError` instead of swallowing it. Still non-fatal
— the clone is what the user asked for — but visible next time.

> Note the first of the two clones is *correctly* not counted:
> `equipRegimen` skips the bump when `user.email === source.created_by`,
> and that clone was sjoudrie cloning their own regimen. Only the second
> should have counted.

---

<a name="finding-3"></a>
## Finding 3 — the duration estimate is wrong for 27 of 33 regimens · **FIXED**

**CLAIM.** `rest_seconds` is 44 of 212 — the only k-of-N on this surface.
CLAUDE.md says that usually means a writer plus one entry path that skips
it, and is usually **not** a bug.

**PROOF of the shape.** It is not sparse, it is **bimodal**:

| | |
|---|---|
| rest on **every** exercise | **6** of 33 regimens |
| rest on **no** exercise | **27** of 33 regimens |
| partially covered | **0** of 33 regimens |

**PROOF of the two paths.** One writer: `planBuilder.js:478` stamps
`rest_seconds: ex.restSec ?? 90` on generated plans. One entry path that
skips it: `RegimenForm` — the hand-built path — has **no per-exercise rest
field at all**. Its "Intra rest" / "Inter rest" inputs are `group_meta` on
a superset, a different key, and `group_id` is 0 of 212 so they have never
been used by anyone.

**So the brief is right that this is a legitimate k-of-N. It is also a
bug, in the consumer.** `regimenLoad.estimatedMinutes()` treated a missing
rest as **zero** rest, with a comment reasoning that "the work still
happened, and dropping it would understate the session more than a zero
rest does". That reasoning is sound for one exercise missing rest among
several. It is not the shape the data has.

| | measured |
|---|---|
| 27 rest-less regimens, as rendered | **14.4 min** average |
| the same regimens at the app's own 90 s default | **46.9 min** average |
| worst single case | "Your Starter Plan — Build Strength": **~24 min shown vs ~78 realistic** |

**FAILURE would have looked like:** the shipped store card being wrong
today. It is not — the store shows only the 4 public regimens, and all 4
carry rest. The defect is **latent there and would have gone live the
moment the board's cost line reached the library**, where 27 of 33 have
no rest. That is why this had to be fixed before implementing the board.

**THE FIX.** A named `REST_SECONDS_DEFAULT = 90`, in the same style as the
existing `WORK_SECONDS_PER_SET = 40`. 90 s is not invented for this file
— it is the app's own default in both places that already have one:
`FALLBACK_DURATION` in `RestTimerContext.jsx`, and `planBuilder`'s `?? 90`.
`lastRestSeconds()` had to move with it or the final-set deduction would
have silently stopped happening on exactly the 27 regimens the default now
covers.

The module head comment claimed `rest_seconds` is "set on every exercise
of every public regimen". True — of the four PUBLIC rows. It does not
generalise, and sizing the whole library from a four-row sample is what
produced the zero default. A correction is left in the file.

---

<a name="finding-4"></a>
## Finding 4 — the first-regimen celebration promises XP that is never granted · **FIXED**

**CLAIM.** The XP paths honour "the client never computes XP".

**PROOF.** They do. `grant_action_xp` is SECURITY DEFINER, derives the
user from `auth.uid()`, clamps the client's `p_xp` against a per-action
per-day cap (`regimen_created` → 200), writes an append-only
`action_xp_ledger`, and calls `increment_user_xp`. A client can choose an
amount but not exceed the cap. That matches CLAUDE.md's stated posture
exactly — "silently clamped, rejected, or rate-limited". **Not a defect.**

**But the user-facing number is a lie.** `RegimensSection` grants
`XP_REWARDS.regimenCreated` = **60**, and hands the celebration a literal
`xpGained: 100` under a comment reading *"matches the XP grant above"*. It
does not. The grant beside it was corrected to read the constant; this
line was left behind. The one toast a user sees on their first regimen has
been promising **+100 XP** against a **60 XP** credit.

**FIX.** Read the constant. Same mirrored-constant drift the grant itself
was fixed for.

---

## Checks that PASSED — no defect

**Lead 4 — the three top buttons.** Confirmed in code: `Templates` opens
`TemplatesModal` over `workout_templates` (**0 rows, 0 authors**, whole
database) and `Browse Templates` opens `RegimenTemplateStore`, which calls
the same `regimens.copyTemplate` / `listPublic` as the full-page store one
level up. Both board claims hold. **No code change** — this is a UI
consolidation the board owns, not a defect.

**Lead 4b — `workout_templates: public templates readable` is `TO public`.**
`anon` *does* hold table SELECT (`anon=rDxtm`). Executed as `anon`:
blocked, but by `42501 permission denied for function current_user_email`
— i.e. **only by a missing GRANT on a helper, not by the policy**. That is
precisely the shape CLAUDE.md calls "not a boundary" (mig 303 scoped the
hub feed to `authenticated` for this reason). It is latent, not live —
the table is empty — so it is reported, not fixed, and it belongs with
whatever decision is made about deleting the Templates feature entirely.
`regimens` behaves identically; `regimen_reviews` returned 0 rows to anon
on the policy itself.

**Lead 5 — is the edit path reachable?** Unresolved, and **unresolvable
from the column the question was built on** — see the `updated_at`
correction above. The form renders, validates and submits in code review;
I did not drive it in a browser harness this round, so I am not claiming
it works. What I *can* say is that "nobody has ever edited a regimen" is
not a supported claim.

**Lead 8 — the second surface.** `src/components/routines/` reads the same
`regimens` table and calls them "routines". `RoutineCalendarModal` is
mounted from `Dashboard.jsx:2250` and imports `MyRoutineSheet`;
`RoutineTodayCard` has **no importer anywhere** — it is dead code.
Both surfaces render an active-plan state from `is_active`. This is
duplication with a second noun, not a rename in progress. Left alone:
resolving it is a product decision about which surface survives, and the
board does not cover the routines sheet.

**Lead 10 — trophies.** `grant_eligible_trophies` reads a `regimens` count
for `regimen_5` / `regimen_10` / `regimen_25`; `get_trophy_progress` is
consistent with it. Both SECURITY DEFINER with `authenticated` EXECUTE.
No mismatch found between them and what the client shows.

---

## Tests

Before this audit there was **no `src/components/regimens/__tests__/`
directory** and nothing in `src/components/__tests__/` matched — roughly
2,900 untested lines across the five largest files.

| File | Change |
|---|---|
| `src/lib/__tests__/regimenLoad.test.js` | 14 → **16**. One test **inverted, not deleted** (it pinned the zero-rest behaviour as intent); 3 added for the default, for explicit-rest precedence, and for the real rest-less regimen shape. |
| `src/components/regimens/__tests__/RegimenReviewsBlock.test.jsx` | **New — 6 tests.** The first component test for any regimen component. Pins the adoption-refusal branch that migration 346 makes reachable for the first time. |

**Non-vacuity proven both ways**, per the standing rule:

| Fix reverted | Result |
|---|---|
| `REST_SECONDS_DEFAULT` 90 → 0 | **2 behavioural tests fail**, 14 invariant tests still pass |
| `42501 → needs_adoption` mapping broken | **3 behavioural tests fail**, 3 invariant tests still pass |

Harness note for the next audit: `vi.mock` factories are hoisted above
every top-level statement, so a factory that dereferences a plain `const`
at evaluation time throws "Cannot access before initialization". Use
`vi.hoisted`. A factory that touches the const *lazily* (inside a function
called at runtime) gets away with it, which makes the failure look
arbitrary.

---

## SQL handed over

`supabase/migrations/346_review_adoption_guard_reads_the_real_column.sql`.
Safe to re-run — `CREATE OR REPLACE` plus a guarded `DROP TRIGGER`. It
ends in a `SELECT` that proves it took, because `RAISE NOTICE` is
invisible in the Supabase SQL editor.

No destructive statements. Nothing is deleted or backfilled.

---

## What I did not do

- **Did not implement the board's UI redesign.** Audited and specified;
  not built. Finding 3 had to land first.
- **Did not drive the create/edit form in a browser harness.** So lead 5
  is answered only to the extent of "the question's premise was invalid".
- **Did not touch the routines duplication.** Product decision.
- **Did not fix the `TO public` policy on `workout_templates`.** Latent,
  and tangled with whether that feature survives at all.
- **Did not delete the Templates button or the duplicate store.** The
  board proposes it; it is not a defect, and it is Kegan's call.
