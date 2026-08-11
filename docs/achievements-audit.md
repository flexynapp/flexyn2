# Achievements audit — 2026-08-11

Audit of the Achievements feature across five named sub-features:
unlocked badges, progress toward the next badge, achievement categories,
date unlocked, and share.

Method for every check below: the **CLAIM**, the **PROOF** that settles
it, and what **FAILURE** would have looked like. Reading code and finding
it plausible is not a passed check.

---

## 0. The brief's ground truth was stale, and that changed the audit

The task named these files and this schema:

> `src/lib/achievementDefinitions.js` — the catalog.
> Table `public.achievements` … There is NO category column and NO
> share/shared column. The whole table holds ONE ROW, for ONE user.

All of that is true and **almost none of it is load-bearing**, because
the feature was rebuilt onto a different table and a different catalog.
The shared checkout `~/flexyn2` was **99 commits behind `origin/main`**,
which is where that description came from.

| | Brief said | Actually live on `origin/main` |
|---|---|---|
| Catalog | `achievementDefinitions.js` | `src/lib/trophyDefinitions.js` |
| Table | `public.achievements` | `public.user_trophies` |
| Rows | 1 row, 1 user | **54 rows, 16 users** |
| Grant path | — | `grant_eligible_trophies()` (migs 167 + 323) |
| Surface | Progress > Achievements tab | `AchievementsVault` overlay off ProfileMenu |

`AchievementsTab.jsx`'s own header comment documents the switch: the old
table "had no server grant path — migration 189 removed the client INSERT
policy to stop badge forgery and nothing replaced it — so production held
ONE row across every user, an `xp_250` that wasn't even in the catalog."

**This audit is of the live trophy surface.** `achievementDefinitions.js`
survives with exactly one consumer (`CrewStatsPanel`'s
`getAchievementById`) plus a smoke test.

### PROOF

```sql
select 'achievements', count(*), count(unlocked_at), count(distinct user_id) from public.achievements
union all
select 'user_trophies', count(*), count(earned_at), count(distinct user_id) from public.user_trophies;
```

| table | rows | date populated | users |
|---|---|---|---|
| `achievements` | 1 | 1 | 1 |
| `user_trophies` | **54** | **54** | **16** |

---

## RULE ZERO — does each sub-feature exist?

| # | Sub-feature | Verdict |
|---|---|---|
| 1 | Unlocked Badges | **(a) exists and works** |
| 2 | Progress Towards Next Badges | **(b) existed and was broken** on one ladder — fixed |
| 3 | Achievement Categories | **(a) exists and works** — client-side taxonomy, correctly so |
| 4 | Date Unlocked | **(a) exists and works** — 54/54 populated; one i18n defect on the shared post, fixed |
| 5 | Share Achievement | **(b) exists, one of two entry points was dead** — fixed. Never exercised in production |

Nothing was absent. **Nothing new was built.** Every change is a repair to
something that already existed and was wired to the wrong thing.

---

## 1. Unlocked Badges — (a) exists and works

### CHECK 1.1 — the client catalog and the server grant list agree

**CLAIM.** `trophyDefinitions.js` says "The catalog here mirrors the
server's list — when you change one, change the other." A drift in either
direction is invisible and damaging: `AchievementsTab` resolves rows with
`getTrophy(row.trophy_id)` and **`.filter((x) => x.trophy)`**, so a
server-granted id missing from the client is silently dropped from the
Earned tab — the user earns a badge that never appears.

**PROOF.** Extracted the `named` VALUES list out of the *installed*
`grant_eligible_trophies()` body via `pg_get_functiondef`, and diffed it
against `TROPHIES` in the worktree.

```
client TROPHIES: 120   server named: 120
IN SERVER, NOT IN CLIENT (granted but would not render): []
IN CLIENT, NOT IN SERVER (shown but ungrantable):        []
```

**FAILURE would have looked like:** a non-empty list on either side.
**Result: PASS**, 120/120 both directions.

### CHECK 1.2 — badges cannot be forged

**CLAIM.** CLAUDE.md's invariants say the client never computes
achievements, and mig 189 exists because the client "used to INSERT
achievement rows directly, which let any signed-in user forge a badge."

**PROOF.** Attempted the forgery as a real authenticated user, inside a
rolled-back transaction. Note `authenticated` **holds** INSERT/UPDATE/
DELETE grants on the table, so the only thing stopping this is RLS.

| step | outcome |
|---|---|
| `INSERT … 'capstone_apex'` (own user) | **blocked 42501** |
| `UPDATE … SET trophy_id='capstone_apex'` | **0 rows** |
| `DELETE` another user's badges | **0 rows** |
| `SELECT` scope | 54 rows (whole table) |

**FAILURE would have looked like:** a successful insert, or a non-zero
update count. **Result: PASS.**

The read-all SELECT is by design — trophies render on public profiles.
`anon` holds a SELECT grant but has **no policy**, so RLS denies it; the
sole policy is `TO authenticated`.

### CHECK 1.3 — an unresolvable id degrades rather than rendering blank

**CLAIM.** The legacy table's one row is an `xp_250` in no catalog.
**PROOF.** Render test: a `xp_250` row alongside `first_rep` renders only
First Rep, no untitled medallion. Tail (`sessions_x1`) and league-season
(`league_s5_legend`) ids **do** resolve. **Result: PASS.**

---

## 2. Progress Towards Next Badges — (b) was broken on one ladder

### CHECK 2.1 — every ladder's signal actually arrives

**CLAIM.** Each ladder declares a `signal` key that must exist in
`get_trophy_progress()`'s payload. A missing key is the classic silent
zero this repo has a documented habit of shipping — a permanently empty
progress bar, not an error.

**PROOF.** Ran the RPC as a real authenticated user (it raises 42501
under plain MCP, which runs as `postgres`):

```sql
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
SELECT public.get_trophy_progress();
ROLLBACK;
```

All 33 ladder signals are present, plus `gauntletPath`. **Result: PASS** —
no missing-key zeros. Several signals genuinely read 0 (`workouts`,
`volumeLbs`, `capsulesOpened`); that is **unexercised, not broken** — the
whole database holds 3 workout logs.

> A lead that dissolved on inspection, recorded because the reasoning
> looked sound: the probe user reads `capsulesOpened: 0` while
> `capsule_1` and `capsule_25` exist in the table. That is not a
> contradiction — those rows belong to *other* users. Checked before
> reporting.

### CHECK 2.2 — DEFECT: the gauntlet ladder measured the wrong number

**CLAIM.** `gauntlet_path` declares `signal: 'gauntletPath'`. Something
must read it.

**PROOF.** Nothing did. The only per-rung signal lookup in the entire app
was `LADDERS[ladderId]?.signal`:

```
$ grep -rn "\.signal" <the five files that consume the catalog>
AchievementsTab.jsx:243:    const key = LADDERS[ladderId]?.signal;
```

So the `gauntlet` ladder measured **both** its rungs against
`gauntletDone` (challenges cleared), while the server grants
`gauntlet_path` on `gauntletPath` (whole path finished). Two consequences,
both live:

1. Rungs sorted by threshold, and these two thresholds are on
   **incomparable scales** — `gauntlet_path` is 1 (a yes/no) and
   `gauntlet_5` is 5 (a count). The **gold** rung therefore sorted
   *before* the bronze one, so a brand-new user's gauntlet ladder offered
   "Gauntlet Cleared — Completed the full gauntlet path" as the next
   thing to go and do.
2. The moment `gauntletDone` hit 1, `nextRung` stepped past
   `gauntlet_path` **forever** — the gold trophy could never again show
   as in progress, because it was being tested against the wrong number.

Measured: this is the **only** ladder affected.

```
ladders where tier-order DISAGREES with threshold-order: 1
  gauntlet
    threshold: gauntlet_path -> gauntlet_5
    tier     : gauntlet_5    -> gauntlet_path
rungs whose own signal differs from their ladder's: gauntlet_path
```

**FIX.** `rungSignal()` resolves a rung's own signal, falling back to the
ladder's; `nextRung` takes the progress map so a rung with its own signal
is measured against it; rungs sort by **tier, then threshold**.

That sort change is safe precisely because it is a no-op elsewhere: on 30
of 31 ladders every rung shares one signal, so tier order and threshold
order coincide. A test asserts that the rung sequence is unchanged for
every ladder except `gauntlet`.

### CHECK 2.3 — DEFECT: "Ladder complete." on a ladder with nothing earned

**Found only by rendering.** jsdom paints nothing and the two halves sit
in different elements, so the full suite was green over this.

**CLAIM.** A ladder reporting "✓ Ladder complete." has been completed.

**PROOF.** In the harness, panels C and D rendered:

```
Crew                    0 / 1
✓ Ladder complete.
```

`finished` was computed as `!nextRung(...)` — "there is no next rung" —
not "every rung is earned". On the five ladders that deliberately dead-end
(`crew`, `cardio`, `cross`, `level`, `gauntlet`) a user whose signal
already clears the top threshold has no next rung while holding none of
the badges. The grant lands on the next checkpoint, and the two queries
behind this page carry separate 30s `staleTime`s, so they legitimately
disagree for a window.

Reachable in production, not hypothetical:

```sql
-- in >=1 crew, so the `crew` ladder's only threshold is met,
-- but holding no crew_squad badge
users_in_a_crew: 4 | users_with_crew_squad: 4 | users_who_see_the_bug: 1
```

**One live user sees this today.**

**FIX.** "Complete" now requires every rung earned. Where there is no next
rung but the top one is unearned, the top rung stays on screen with a
clamped "1 / 1" bar — the honest state: you met the bar, the badge is
pending.

---

## 3. Achievement Categories — (a) exists and works

**The brief's hypothesis was right about the mechanism and wrong about the
file.** Categories are a **pure client-side taxonomy** — there is no
category column on `user_trophies`, and there should not be. They live in
`TROPHY_CATEGORIES` in **`trophyDefinitions.js`**, not
`achievementDefinitions.js`.

This is (a), not (c). A category is presentation, and the server has no
use for one: `grant_eligible_trophies` grants by id against a threshold.
Adding a column would create a second source of truth for a value already
derivable from the catalog.

### PROOF

| Check | Result |
|---|---|
| categories used by `TROPHIES` but not declared | `['capstone']` — **deliberate**, see below |
| categories used by `LADDERS` but not declared | `[]` |
| declared categories with **no** ladder behind them (empty heading) | `[]` |
| all 10 headings render | **PASS** (render test) |

`capstone` is deliberately outside `TROPHY_CATEGORIES`: capstones have no
ladder and no numeric criterion, so a category section would have nowhere
to put them. They render through the **Locked** row instead, carrying
their outstanding prerequisites. The existing suite already pinned this
(`'every trophy category is a declared group'` excludes capstones with a
comment). Verified rather than assumed — **not** a gap.

---

## 4. Date Unlocked — (a) exists and works

### CHECK 4.1 — is the column actually written?

**CLAIM.** Per the brief, `unlocked_at` is "the obvious candidate" for a
column nothing writes.

**PROOF.** On the **live** table the column is `earned_at`, and:

```
user_trophies: count(*) = 54, count(earned_at) = 54
```

**54 of 54.** Real spread of dates, 2026-05-29 → 2026-08-11.
**Result: PASS.** Not a dead column. (The brief's `unlocked_at` on the
retired table is 1 of 1 — also populated, and irrelevant.)

### CHECK 4.2 — the date reaches the screen through a locale-bound path

**PROOF.** The Earned tab uses `useDateFormatter()` from `src/lib/intl.js`
(Intl-backed, language-bound) — correct. A render test asserts the value
passes through that formatter and that a null `earned_at` renders **no**
date line rather than "Invalid Date" or an epoch.

### CHECK 4.3 — DEFECT: the shared post's date was English in all 15 languages

`PostActivityBlock`'s `AchievementBlock` rendered the unlock date with
date-fns `format(parseISO(...), 'MMM d, yyyy')`. CLAUDE.md is explicit
that date-fns `format()` binds no locale, so this read "Aug 11, 2026"
under a fully-translated screen. **FIXED** — routed through
`useDateFormatter`.

The snapshot key chain is intact and now has a test, because it crosses a
naming boundary and a rename on either side would silently drop the date
off every shared badge: `row.earned_at` → `unlockedDate` (camel, the
caller's shape) → `unlocked_date` (snake, what the renderer reads).

---

## 5. Share Achievement — (b) one of two entry points was dead

### CHECK 5.1 — has it ever been used?

**PROOF.**

```sql
select post_type, count(*) from public.hub_posts group by 1;
```

`status` 14 · `regimen` 2 · `meal` 2 · `cardio` 2 · `poll` 2 · `repost` 2 ·
`stats` 1 — and **no `achievement` row has ever existed.**

Say what this is: **unexercised**, not proof of a bug. `shareAchievement.js`'s
own comment explains why — "until migration 323 no achievement could be
unlocked to share in the first place." There was nothing to share.

Structurally reachable, checked rather than assumed: `hub_posts` has **no
CHECK constraint on `post_type`** (only two on `content_warning`), so
`'achievement'` is a legal value.

### CHECK 5.2 — DEFECT: the composer's picker was permanently empty

**CLAIM.** There are two share entry points. The Achievements sheet's per-
badge Share button, and the Hub composer's "Achievement" section.

**PROOF.** The composer read:

```js
const all = await achievements.list(user.email);   // → public.achievements
return all.filter(a => a.unlocked).slice(0, 10);
```

Two independent faults, either alone sufficient:

1. `@/lib/data/achievements` reads the **retired** `public.achievements`
   table — one row in all of production.
2. `public.achievements` has **no `unlocked` column**. Verified against
   the live schema; the columns are `id, created_by, user_id,
   achievement_id, name, description, unlocked_at, xp_awarded, created_at,
   created_date`. So `a.unlocked` was `undefined` on every row it could
   ever see.

Net effect: `unlockedAchievements.length > 0` was **false for 100% of
users, forever**. Nothing threw, nothing logged — an empty section is
indistinguishable from "this user has earned nothing." Exactly the
plausible-zero shape CLAUDE.md warns about.

**FIX.** New `listEarnedForShare(userId)` in `src/lib/data/trophies.js`
returns earned trophies in the shape the composer already consumes; the
composer now uses it and is keyed on `user.id` rather than email.

### CHECK 5.3 — the sheet's Share button

**PROOF.** Tested end to end: payload carries `achievement_id`, `name`,
`icon` and `unlockedDate`; success and failure both toast; a **thrown**
share (network blip, not a returned `{ok:false}`) recovers instead of
leaving the button spinning forever.

The `linked_entity_id` UUID guard is now pinned by tests. `hub_posts.
linked_entity_id` is a uuid column and a badge id is a slug, so passing it
through raises 22P02 and the whole share fails. The guard nulls it for
slugs, passes real UUIDs through, and keeps the id in the snapshot where
the renderer reads it. **Never exercised in production** — hence the test.

### CHECK 5.4 — i18n

The Share control's label and `aria-label` were bare English literals in a
component whose every other string was translated, and the aria-label
built an English sentence around the badge name in all 15 languages. The
vault's "Back" and "Achievements" chrome likewise. **FIXED** with narrow
`achievements.share.` / `achievements.vault.` keys, English-only, per the
no-machine-translation rule.

---

# RESULTS

## Confirmed defects — all fixed

| # | Defect | Evidence | Blast radius |
|---|---|---|---|
| D1 | Hub composer's achievement picker read the retired table **and** filtered on a column that has never existed | live schema + row counts | **100% of users**, permanently empty section |
| D2 | `gauntlet_path`'s `signal` override had **zero readers**; ladder measured the wrong signal and sorted gold before bronze | grep + catalog analysis | every user's gauntlet ladder |
| D3 | "✓ Ladder complete." rendered beside a `0 / 1` counter | **browser render** + SQL | 1 live user today; any dead-end ladder |
| D4 | Shared post's unlock date used date-fns, so English in all 15 languages | CLAUDE.md rule + code | every non-English viewer of a shared badge |
| D5 | Share label + aria-label + vault chrome hardcoded English | code | all 14 non-English languages |

## What passed, and was checked rather than assumed

- Client catalog ↔ server grant list: **120/120**, both directions.
- Badge forgery: INSERT `42501`, UPDATE 0 rows, DELETE 0 rows, as a real
  authenticated user.
- Every ladder signal present in `get_trophy_progress()`. No silent zeros.
- `earned_at` **54 of 54** populated. Not a dead column.
- Categories: no undeclared category, no empty heading, all 10 render.
- `anon` cannot read `user_trophies` (grant without policy → RLS denies).
- Unresolvable / tail / league-season ids all degrade correctly.

## Scope — stated plainly

- **Share has never been used in production.** Zero `achievement` posts
  have ever existed. The fixes make both entry points reachable and are
  covered by tests, but "works" here means *proven by test and by
  schema*, not *observed in the wild*.
- **`workouts`, `volumeLbs`, `distinctLifts`, `capsulesOpened`,
  `questsClaimed`, `perfectDays` and `activeMonths` all read 0** for the
  probe account. The database holds 3 workout logs total. Those ladders
  are **unexercised**, and this audit says nothing about whether their
  arithmetic is right at scale.
- **The `gauntlet` ladder mixes two signals on one ladder.** D2 fixes the
  reading and the ordering. Whether a binary path-completion trophy
  *should* be a rung on a counting ladder at all is a product question,
  and I have not answered it.
- Verified on **desktop Chrome at 390px column width**. Not seen on a
  real phone.

## Not done

- No node probe (layer 2) and no run against the deployed site. Share is
  proven by unit test and schema, not by posting a real badge to Hub.
- `PostActivityBlock`'s **goal** block has the identical date-fns defect
  two lines from the one I fixed. Left alone as out of scope; flagged
  separately.
- Did not audit `ProfileTrophies` / `ProfileBadgeShowcase`, which consume
  the same catalog on the profile surface.
- Did not touch `achievementDefinitions.js` or the retired
  `public.achievements` table. Both are now down to one real consumer
  (`CrewStatsPanel`) and are a sensible deletion candidate — but that is a
  removal, not a fix.

## Tests added

| File | Tests |
|---|---|
| `src/lib/__tests__/trophyLadders.test.js` | 36 → 43 (+7: per-rung signals; 1 existing test split into 2) |
| `src/components/__tests__/achievementsSurface.test.jsx` | 23, new — one block per sub-feature |
| `src/lib/data/__tests__/trophiesShare.test.js` | 9, new |
| `src/lib/data/__tests__/shareAchievement.test.js` | 7, new |

**All are regression tests.** None pins current buggy behaviour, so there
are no characterization tests to invert here.

Suite: **4370 → 4416 passing** across 316 files (+46). Lint clean, build
clean.
