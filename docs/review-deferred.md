# Deferred review findings — running ledger

Everything the acceptance reviews found that has **not** been fixed, and why.
One place, so nothing quietly falls off the list between bands.

Updated after each batch. Bands completed so far: **#1–25**, **#26–50**.

Status values: `OPEN` (needs doing), `DECISION` (needs a call from Kegan,
not a fix), `BLOCKED` (needs information or access I don't have).

---

## Needs a decision from you

| # | Band | Item | The decision |
|---|---|---|---|
| 19 | 1–25 | Completing a set with no weight entered | Should a set with reps but no weight count as complete? Currently it does. Bodyweight movements make that correct; a forgotten weight field makes it a silent data-quality hole. Deferred by you on 2026-08-05 — recorded in `review-tier-s-01-25.md`. **DECISION** |
| 30 | 26–50 | `public._migration_log` exists with 0 rows | Populate it from every migration going forward, or drop the table. Both are defensible. An empty table that looks like a ledger is the worst of the three, because it implies a tracking mechanism that isn't there. **DECISION** |
| — | 1–25 | `src/pages/Legal.jsx` placeholders | Three amber `LEGAL_TODO` markers ship on /privacy and /terms: legal ENTITY name, CONTACT_EMAIL, JURISDICTION. Only you can fill these. They are visible to users until you do. **DECISION** |

## Needs information I don't have

| # | Band | Item | What's missing |
|---|---|---|---|
| 33 | 26–50 | Bounty escrow mechanism | Graded B partly because I could not find anything named escrow — no function body matches escrow/hold/deduct near a bounty. Either it lives under a name I didn't guess, or the sheet's claim is loose. Point me at it and I'll verify it properly. **BLOCKED** |

## Open work, with the reason it wasn't done in-band

| # | Band | Item | Why deferred | Size |
|---|---|---|---|---|
| 34 | 26–50 | Economy-RPC atomicity under concurrency | Not a code change. Needs a harness firing overlapping RPCs at a real database and asserting no double-spend. Reading function bodies cannot prove it, and asserting it from a single-threaded probe would manufacture exactly the false confidence these reviews exist to remove. | M |
| 32 | 26–50 | `debrief_cron_secret` / `debrief_func_url` not in Vault | Only actionable when the weekly-debrief cron is re-scheduled (recipe is in CLAUDE.md). Adding them now creates two Vault rows pointing at a cron that doesn't exist. | S |
| 49 | 26–50 | `pluralize()` adoption | The helper is correct; it simply isn't called in most places that hand-roll `n === 1 ? … : …`. A wide mechanical sweep across many components, each edit a small chance of changing user-visible copy. Wants its own pass with the diff read in full, not bundling with one-line fixes. | M |
| — | 26–50 | Seven private `prefersReducedMotion` copies | CapsuleOpener, StepsLogCard, LevelUpOverlay, SnakeGameModal, ThemeAnimationLayer, DailyQuestsCard, SplashScreen each still declare their own. `src/lib/reducedMotion.js` now exists for them. Same reasoning as #49 — mechanical, wide, and animation regressions are the hardest kind to notice. Noted at the top of that module. | S |

---

## Closed since the ledger started

Kept so a re-read of an old review doesn't re-raise something already done.

| # | Band | Item | Closed by |
|---|---|---|---|
| 28 | 26–50 | Nav reset on route change | Was "unproven"; proving it found a real inverted-gesture bug. Fixed 2026-08-05. |
| 31 | 26–50 | 16 unindexed FKs | Migration 285 §1, plus a drift-audit check so the class stops recurring. |
| 38 | 26–50 | `is_blocked` trusted a client-supplied viewer id | Migration 285 §3. |
| 42 | 26–50 | Unwrapped `auth.uid()` in RLS policies | Migration 285 §2 (8, not the 11 the review claimed). |
| 33 | 26–50 | `loot_catalog` INSERT grant | Migration 285 §4. Escrow half of #33 is still BLOCKED above. |
| 36 | 26–50 | anon SELECT on four zero-policy tables | Migration 285 §4. |
| 43 | 26–50 | "45+ Radix primitives" claim | Corrected to 14 in `docs/tier-s-a-review-list.md`. |
| 48 | 26–50 | ko/ar/hi/tr had no date-fns locale | `src/lib/dateLocales.js` now matches the 15 shipped languages. |
| 50 | 26–50 | Three `AnimatedNumber` implementations | Collapsed to one; the third renamed with the reason it stays separate. |
