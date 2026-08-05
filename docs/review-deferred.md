# Deferred review findings — running ledger

Everything the acceptance reviews found that has **not** been fixed, and why.
One place, so nothing quietly falls off the list between bands.

Updated after each batch. Bands completed so far: **#1–25**, **#26–50**,
**#51–75**, **#76–100**.

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
| 74 | 51–75 | **Storage GC — confirm it actually drains** | Both causes are fixed (migration 286 + `verify_jwt: false` redeploy), but the migration has not been run yet, so the queue still holds 2 blobs at `attempts = 0`. **This is the one item that needs checking after you run the SQL**: within ~5 minutes both rows should show `processed_at` set. If `attempts` climbs but `processed_at` stays null, the function is now reaching its own auth gate and the `STORAGE_GC_SECRET` function secret doesn't match the Vault's `storage_gc_secret` — a third, separate problem that could not be tested while the request was never being sent at all. | S |
| 56 | 51–75 | Level-up overlay is not actually queued | The sheet says "queued, non-overlapping". It's a single `useState` event plus a fired-for guard. Non-overlapping: yes. Queued: no. Behaviour is fine today — a multi-level jump renders one overlay spanning `from → to`, which is better UX than a queue — so this is a wording fix on the sheet, not code. `src/lib/rewardQueue.js` is a real queue and is used only by `Workout.jsx`. | — |
| 70 | 51–75 | Micro-batcher adoption | Works, 3 consumers, all reaction-style writes. Correct but narrow for a row ranked at this tier. Widening it is a judgement call about which writes benefit, not a defect. | M |
| 73 | 51–75 | `useDelayedLoading` adoption | 5 consumers; most loading states still render their spinner immediately. Same shape as #49 — a wide, low-risk sweep that wants its own pass. | M |
| — | 51–75 | `checkout-session` and `friendRecapEmail` are in the repo but not deployed | Noticed while auditing #74. Five functions are live; these two exist only as source. Either they're intentionally shelved or they're another silently-absent dependency. Needs a call on which. | S |

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
| 74 | 51–75 | Storage GC never dispatched | `net.http_post` (mig 286) + `verify_jwt: false` redeploy. Verification still open above. |
| 62 | 51–75 | `t(key) \|\| 'English'` renders raw keys | 11 sites converted to `tFallback`; `i18nRawKeys.test.js` fails on the pattern; CLAUDE.md corrected. |
| 61 | 51–75 | Duplicate language blocks dropped 4 keys | `split-i18n.mjs` now fails the build; part6/part8 merged; 20,749 → 20,753 keys. |
| 55 | 51–75 | Welcome capsule burned its one-shot | localStorage moved into `.then()`, `reportError` replaces `console.warn`. |
| 53 | 51–75 | Coin ledger `actor` always `postgres` | `session_user` (mig 286). Historical rows can't be corrected. |
| 59 | 51–75 | XP caps rolled over at UTC midnight | `user_local_now()` (mig 286). |
| 66 | 51–75 | Toast-policy row was stale | Behaviour was deliberately changed earlier; the sheet described the old one. Noted in the review. |
| — | 76–100 | **28 of 28 info/message/warning toasts rendered nothing** | All three variants made passthrough; `toastPolicy.test.js` asserts on delivery and audits the call sites. |
| 86/90 | 76–100 | Daily chest readiness was per-device | `isDailyChestReady(userId, lastClaimAt)` now consults the server's `last_daily_chest_at` as well; either source saying "claimed" hides it. |
| 86/90 | 76–100 | Coin balance stale after claiming a chest | `patchProfile({ flex_coins: data.new_balance })` — server-returned, so it is the permitted case for a privileged column. |
| 96 | 76–100 | Profile-menu row named three entries that don't exist | Row rewritten in `docs/tier-s-a-review-list.md`. |
| 110 | 101–127 | 4 of 5 registered tooltips never mounted | Three mounted (smart paste, PR proximity, DM double-tap); `STREAK_FLAME_TAP` removed — no such gesture exists. `tooltipRegistry.test.js` now fails when a registered ID has no mount site (verified it fires). |
| 120 | 101–127 | "Six celebration helpers" — there are seven | Corrected in the sheet and CLAUDE.md; the table now lists all seven with their patterns. |
