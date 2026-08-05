# Acceptance review — S-tier features #51–75

Run 2026-08-05 against `main` and the production database.

Like the #26–50 band, this is mostly not a design review: of 25 features, **two
have UI a designer can touch** (#54, #63/#64 partially). The rest are 10
economy/gamification guarantees, 2 i18n mechanisms and 11 PWA/resilience
claims. So "exercise it" means executing SQL, probing deployed endpoints and
reading emitted bundles.

Nothing below is graded from reading a migration. Where a claim could only be
settled by hitting the live system, I hit it.

---

## Headline

**#74 (Storage GC) is an F, and it is proven, not suspected.** The Edge
Function is deployed and its cron has fired **2,710 times**. It has collected
**nothing**. Two blobs have been queued since 2026-07-27 with `attempts = 0` —
the function body has never executed once. Cause below; it is the same shape as
the weekly-debrief cron that 404'd for ten weeks.

**#62 is a D.** The claim is "never renders a raw key". Thirteen keys render
raw key paths to users right now, and **the fallback idiom CLAUDE.md documents
does not work**.

---

## Gamification & economy (#51–60)

### #51 `GA1` — XP curve through Level 100
**GRADE: A** — `xp_level_thresholds` holds exactly 100 rows, levels 1–100, no
gaps. The curve is genuinely tuned rather than linear: step size grows 100 →
111 → 136 → 230 → 545 → 3,493 → 10,445 → 23,401, and level 100 sits at
**643,860** total XP. Against the realistic daily ceiling (#59: 4,000 workout +
2,400 cardio + change ≈ 7,400/day) that is ~87 days of maximal play — a real
long-tail curve, not a placeholder.

### #52 `GA10` — Flex Coins currency
**GRADE: A** — Live. 120 ledger rows across four distinct sources
(`increment_flex_coins`, `claim_daily_chest`, `grant_level_up_rewards`, plus the
migration-264 opening balance). Real balances, real movement, as recently as
today.

### #53 `GA11` — Coin ledger with a rolling mint ceiling (migration 264)
**GRADE: B**
**EVIDENCE:** Structurally correct in the way that matters most. The trigger is
`BEFORE UPDATE ... FOR EACH ROW`, so its `NEW.flex_coins := …` write actually
takes effect — an `AFTER` trigger would have made the clamp a no-op that only
logged. And the `zzz_` name prefix is load-bearing: Postgres fires BEFORE
triggers in alphabetical order, so `zzz_flex_coin_ledger_tr` runs **last**,
after `user_profiles_block_privileged_updates_tr`, and therefore records the
value that actually survived every other guard. That is a deliberate,
non-obvious detail and it is right.

**GAP — the `actor` column is not recording what it claims to.** Every one of
the 120 rows has `actor` = `postgres` or `migration`. Never `authenticated`.
Cause: the trigger sets `actor := current_user`, and inside a `SECURITY DEFINER`
function `current_user` is the function **owner**, not the caller. So the one
column you would reach for during a "who minted these coins" investigation says
`postgres` for every row, including 97 rows that came from genuine user
activity. `source` (regex-scraped from `current_query()`) works fine and is
carrying the whole forensic load by itself.

**GAP — the clamp has never fired.** `clamped = true` on 0 of 120 rows, so the
ceiling is unexercised in production. I attempted a write-then-`ROLLBACK` probe
to exercise it and the sandbox classifier blocked the write, correctly. Not
asserting it is broken — asserting it is unproven.
**FIX:** `session_user` (or `auth.role()` / `auth.uid()`) instead of
`current_user`. Backfilling old rows isn't possible; the information is gone. **S**

### #54 `GA2` — Level bar + animated level-up overlay
**GRADE: A** — `LevelBar.jsx` and `LevelUpOverlay.jsx` both exist, 5 consumers,
gated behind a user-facing `levelAnimationsEnabled` preference.

### #55 `GA23` — Welcome + first-workout capsules (migrations 277/278)
**GRADE: C**
**EVIDENCE:** Both RPCs exist in production (`grant_welcome_capsule`,
`grant_first_workout_capsule`) and the client calls them properly via
`supabase.rpc(...)` — migration 277's repair landed and the old broken client
INSERT is gone. 290 capsule rows.

**GAP — the defect that made migration 278 necessary is still in the client.**
`LevelUpManager.jsx` writes the localStorage baseline **before** the grant
resolves, unconditionally, and swallows failure with `console.warn`:

```js
if (lastSeenLevel === null || Number.isNaN(lastSeenLevel)) {
  try { localStorage.setItem(storageKey, String(currentLevel)); } catch {}   // ← burns the one-shot
  lastFiredForRef.current = currentLevel;
  capsules.grantWelcomeCapsule(...)
    .catch((err) => console.warn('[LevelUpManager] welcome capsule grant failed:', err));
  return;
}
```

That branch is `first time on this device` — it never runs again once the key is
written. So any failure (offline, a token refresh mid-flight, RLS) costs that
user their welcome capsule permanently, with no retry and nothing in Sentry.

What makes this a clean finding rather than a guess: **the very same file
already contains the correct pattern**, forty lines down, for the level-up
grant — localStorage gated on `.then()`, the in-session flag rolled back in
`.catch()`, with a comment explaining precisely why. The welcome branch simply
never received the same treatment.

**Not evidence, and worth saying so:** 12 profiles currently hold zero capsules.
I initially read that as users losing the grant. It isn't — all 12 were created
today and 11 are guests, i.e. my own probe accounts from this session's
delete-flow testing. An incomplete guest never mounts `LevelUpManager` (it sits
below the onboarding gate in `App.jsx`), so zero capsules there is correct
behaviour. **The defect is structural and real; production does not show it
having bitten anyone since migration 278.**
**FIX:** Mirror the level-up branch — set localStorage in `.then()`, and use
`reportError` with a feature tag instead of `console.warn`. **S**

### #56 `GA3` — Level-up manager (queued, non-overlapping)
**GRADE: B** — Non-overlapping: yes. **Queued: no.** There is a single
`useState(null)` event and a `lastFiredForRef` guard; a second level-up would
replace the first rather than queue behind it. In practice this is fine — a
multi-level jump renders one overlay spanning `fromLevel → toLevel`, which is
the better UX anyway — so the behaviour is right and the sheet's wording is
loose. Worth noting that `src/lib/rewardQueue.js` (a real queue, with tests)
exists and is used only by `Workout.jsx`; the level-up path does not use it.

### #57 `GA43` — Login streak + workout streak tracked separately
**GRADE: A** — Genuinely separate and internally consistent. 21 users carry a
login streak, 4 carry a workout streak. The invariant that matters holds
exactly: **zero** profiles of 49 have `current > longest` on either pair.

### #58 `GA6` — Server-authoritative XP (migration 189)
**GRADE: A** — `increment_user_xp` takes `p_user_id` and **ignores it**,
reading `auth.uid()` into its own variable and using that throughout. That is
the same defensive shape migration 285 just applied to `is_blocked`, and here it
was right from the start. Also carries an absolute range guard (`p_xp > 100000`
→ `22023`), a rolling 50,000/24h cap, an append-only `xp_grant_log`, and it
recomputes `current_level` from the thresholds table rather than trusting a
client-sent level.

### #59 `GA7` — Per-action, per-day XP rate limits + audit ledger (migs 188/198)
**GRADE: B**
**EVIDENCE:** Real and specific. `grant_action_xp` caps eight action types
individually — workout 4,000, cardio 2,400, comeback 200, water 24, meal 30,
recipe 75, regimen 200, goal 500, else 1,000 — writes `action_xp_ledger`, then
defers to `increment_user_xp` for the global cap. Two independent ceilings.

**GAP — the two ceilings use different clocks, in the same call path.**
`grant_action_xp` buckets by `(now() AT TIME ZONE 'utc')::date` — a UTC calendar
day. `increment_user_xp` uses `now() - interval '24 hours'` — a rolling window.
Both are described as "per day".

The UTC calendar day is the weaker of the two: for a user at UTC−7, per-action
caps reset at **5pm local**, mid-evening, so an evening and next-morning session
land in different buckets and each gets a full allowance. The app already has
the machinery to avoid this — `timezone_offset_minutes` and
`public.user_local_now(uuid)`, built for migration 276's reminders for exactly
this reason — and this path doesn't use it.
**FIX:** Resolve the day through `user_local_now`, or switch to a rolling
window to match `increment_user_xp`. Prefer the latter: one clock is easier to
reason about than two correct ones. **S**

### #60 `GA8` — XP for workouts, cardio, water, goals, regimens, achievements, milestones
**GRADE: A** — All seven named categories appear in `grant_action_xp`'s cap
table (eight branches plus a default), each with its own tuned ceiling.

---

## Internationalization (#61–62)

### #61 `I18-2` — ~40 per-domain part files aggregated at build time
**GRADE: B**
**EVIDENCE:** 41 part files → 15 aggregates → 20,749 keys, regenerated on every
build. The mechanism works.

**GAP — the splitter silently tolerates duplicate language blocks.** Three of 41
part files declare the same language key twice inside one object literal:

| File | Duplicated | Keys actually lost |
|---|---|---|
| `i18n-part6.js` | pt, it, ja, ko | **4** |
| `i18n-part8.js` | hi, tr | 0 |
| `i18n-warn.js` | all 15 | 0 |

JavaScript resolves a duplicate literal key by keeping the **last** one and
discarding the earlier block entirely — no error, no warning, no build failure.

Today the damage is 4 keys, and they are an unlucky 4:
`onboarding.welcome.languageHint` for **pt, it, ja and ko**. That string's whole
job is telling someone who doesn't read the current language how to switch. It
falls back to English, so a Portuguese speaker on the welcome screen is asked
*"Don't speak English? Choose your language below."* — the one place where an
English fallback is not merely untranslated but actively wrong. The correct
Portuguese string is sitting in the repo, four lines above the block that
overwrites it.
**FIX:** Two lines in `scripts/split-i18n.mjs` — detect a repeated language key
per part file and fail the build. Then un-duplicate the three files. **S**

### #62 `I18-3` — `tFallback('key', 'English')` — never renders a raw key
**GRADE: D — the guarantee does not hold.**

`tFallback` itself is correct: it calls `t(key, vars)`, compares the result
against the key, and substitutes the fallback on an exact match. 981 keys use
it properly.

The failures are all around it. `getTranslation` ends with `return enVal ?? key`
— on a total miss it returns **the key string itself**, which is truthy. Three
consequences, all live:

**1. The idiom CLAUDE.md documents is broken.** The file says to use
`t(key) || 'English'`. Because a miss returns a non-empty string, `||` never
fires. Confirmed at five call sites:

```js
t('dashboard.removeWidget')      || 'Remove widget'                    // renders "dashboard.removeWidget"
t('nutrition.toast.bottleTooBig')|| 'That bottle is too big…'          // renders the key
t('nutrition.toast.waterCap')    || "That's plenty of water for today" // renders the key  (×2 sites)
t('workout.saveChanges')         || 'Save changes'                     // renders the key
t('nutrition.profanityWarning')  || 'Please remove inappropriate…'     // renders the key
```

Two of those are `toast.error(...)` — so the user gets a toast reading
`nutrition.toast.waterCap`.

**2. RETRACTED — `crewTreasury.js` is correct.** An earlier draft of this
review reported eight more raw-key renders here, on the reading that
`t('treasury.warWon', 'War won')` passes a fallback into `t`'s `vars`
parameter. It does not. `describeLedgerReason(reason, tFallback)` takes the
translator as an **argument** and aliases it to a local `t`:

```js
export function describeLedgerReason(reason, tFallback) {
  const t = tFallback || ((_k, fallback) => fallback);
```

and `CrewTreasuryPanel.jsx` passes `tFallback`. So those eight calls have
correct `(key, fallback)` semantics and always did. The finding was an artefact
of a regex that matched `t(` without knowing which `t` was in scope — the same
class of mistake as grading from a migration instead of the installed function.
The guard test written for this now filters to files that call `useLanguage()`,
which excludes this module by construction.

**3. Five keys are absent from `en`** (not thirteen), verified by parsing the
built aggregate. Since `en` is the last fallback before the raw key, missing
from `en` means *guaranteed* raw-key render in every one of the 15 languages.

**4. Found while fixing, worse than a raw key: a silently WRONG string.**
`WaterTracker.jsx` had `{Math.round(pct)}% {t('progress.title') || 'of daily goal'}`.
`progress.title` exists and means **"Progress"** — the page title. So the `||`
never fired and the hydration ring read **"45% Progress"** instead of "45% of
daily goal". A missing key at least looks broken; this one looks fine and says
the wrong thing. Five further `||` sites were dead-but-harmless (key present,
fallback identical), which is why the fix is to ban the pattern rather than
chase the keys.

**FIX:** Convert all 13 sites to `tFallback(key, 'English')` — that is what both
patterns were reaching for. Then add the audit as a test: parse `en.js`, scan
for literal `t('…')` call sites, fail on any key absent from `en`. The scan
takes about a second and would have caught all 13 the day they landed. Consider
making `t` throw in DEV when passed a string as `vars`, which is unambiguously a
mistake. **S**

---

## Onboarding (#63–64)

### #63 `ON14` — Animated "building your plan" step
**GRADE: A** — Present, with a real headline ("Building your plan") and staged
animation rather than a bare spinner.

### #64 `ON16` — Per-step transition animations
**GRADE: A** — All five named variants exist in `Onboarding.jsx`: `curtain`,
`tilt`, `flip`, `flash`, `iris`.

---

## PWA, performance & resilience (#65–75)

### #65 `RS11` — Sentry async error capture with feature tags
**GRADE: A** — `reportError` used across **74 files** with **106 distinct
feature tags**. Genuinely adopted, not a token helper. (The two `console.warn`
catches in `LevelUpManager` noted under #55 are the exception that proves it.)

### #66 `RS12` — Toast policy: errors always show, success requires an action
**GRADE: B — the claim is now stale, by design.** This was changed earlier in
this session. The action-gated policy suppressed 271 of 283 non-error toasts
(95%), so for a month a successful save produced no feedback at all and looked
identical to a dead button. `toast.success` is now a **passthrough**; info /
message / warning remain gated. The row should be reworded to match, or it will
read as a regression to the next reviewer.

### #67 `RS13` — Build guards on `MISSING_EXPORT` / `UNRESOLVED_IMPORT` / `PLUGIN_ERROR`
**GRADE: A** — All three in the blocking set in `vite.config.js`, with the
2026-05-23 incident recorded at the call site. Exercised repeatedly this session.

### #68 `RS14` — Manual vendor chunking
**GRADE: A** — Ten vendor chunks actually emitted: tfjs 2,318 KB, misc 615 KB,
charts 274 KB, supabase 195 KB, dates 122 KB, motion 121 KB, pose 115 KB, icons
96 KB, query 40 KB, sentry 11 KB — plus `maplibre-gl` at 1,055 KB in its own
lazy chunk, exactly as intended.

**Checked and cleared:** `vendor-radix` appears in the config but is never
emitted. That is not drift — the rule is deliberately commented out, with a note
that splitting Radix into its own chunk produced a top-level TDZ
`ReferenceError` on every page load. Radix intentionally rides in `vendor-misc`.
Worth knowing before someone "restores" it.

### #69 `RS15` — Lazy-loaded pages, modals and tabs
**GRADE: A** — 29 lazy imports and 36 `Suspense` boundaries in `App.jsx` alone.

### #70 `RS18` — Micro-batcher request coalescer
**GRADE: B** — `src/lib/microBatcher.js` exists and works, with 3 real consumers
(`hubReactions`, `stickerReactions`, `crewMessageReactions`). Correctly scoped
to reaction-style writes, but that is narrow for a row ranked at this tier —
it's a utility, not an app-wide layer.

### #71 `RS19` — Profile cache with explicit `patchProfile` invalidation
**GRADE: A** — 13 consumers. The trap this exists for is documented at length in
CLAUDE.md and the discipline is visibly being followed.

### #72 `RS2` — Service worker with precache + offline shell
**GRADE: A** — `precacheAndRoute(self.__WB_MANIFEST)` plus a `NavigationRoute`
with `networkTimeoutSeconds: 4`, so the cached shell serves only when the
network is genuinely slow or absent rather than pre-empting fresh content.

### #73 `RS22` — Delayed-loading hook (no spinner flash)
**GRADE: B** — `useDelayedLoading` exists with 5 consumers. Correct, modestly
adopted; most loading states still render immediately.

### #74 `RS31` — Storage GC Edge Function
**GRADE: F — deployed, scheduled, and has never once run.**

**EVIDENCE, in order:**

| Check | Result |
|---|---|
| Function deployed | ✅ ACTIVE, version 6 |
| Cron scheduled | ✅ job 18, `*/5 * * * *` |
| Cron runs recorded | **2,710**, **0 failures** |
| Objects queued | 2, both since **2026-07-27** |
| Objects processed | **0** |
| `attempts` on those rows | **0** |

`attempts = 0` after nine days is the tell: the Edge Function increments it, so
zero means the body never executed — not that it ran and failed.

**Cause — and the near-miss is the point.**

The first diagnosis was: `storage-gc` is deployed `verify_jwt: true` while
`kick_storage_gc` sends only `X-Storage-GC-Secret` and no `Authorization`, so
the gateway rejects every dispatch. Probing both endpoints appeared to confirm
it, with two different bodies from two different layers:

```
POST /storage-gc   → 401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}   ← the gateway
POST /send-push    → 401 {"error":"unauthorized"}                 ← the function's own code
```

That is all true, and it is a real defect. **It is not why nothing happened.**

Reading the *installed* function body found the actual cause:

```sql
PERFORM extensions.http_post(...)   -- this function does not exist
```

pg_net is registered with `extensions` as its extension namespace, but it
publishes its API into a schema named `net`. The real function is
`net.http_post`. So every call raised `42883: function
extensions.http_post(...) does not exist` — and the call sits inside
`BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING … END`, so the error was
caught, downgraded to a warning, and the function returned normally. pg_cron
recorded `succeeded` because the SQL itself was fine.

**The request was never sent. A request that is never sent cannot be rejected
by a gateway.** The curl proved what *would* happen if it were sent; it could
not prove that was the reason. This is precisely the failure mode CLAUDE.md's
push post-mortem warns about — a plausible, evidence-backed diagnosis of the
wrong layer — and the thing that broke the tie was reading `pg_get_functiondef`
instead of the migration that created it.

**FIX (both, and both were needed):**
1. `net.http_post` instead of `extensions.http_post`, and drop the exception
   handler — every early return above it is explicit, so reaching the dispatch
   means "configured with work pending" and a failure there should surface as
   a failed cron run. Migration 286.
2. Redeploy `storage-gc` with `verify_jwt: false`, matching `send-push` and
   `generateWeeklyDebriefs`. **Do not** instead put a service_role JWT in
   `cron.job.command` — CLAUDE.md rules that out, and that token bypasses every
   RLS policy in the project. **S**

### #75 `RS6` — Write strip-and-retry on missing columns
**GRADE: A** — Handles both error shapes that matter (`42703` from Postgres,
`PGRST204` from PostgREST's schema cache) and memoizes the stripped column per
table so later writes skip the round trip.

---

## Summary

**Grades:** A ×14 · B ×8 · C ×1 · D ×1 · F ×1.

The economy layer is the strongest thing in this band and it is strong in the
right places: XP is server-authoritative and ignores its own client-supplied
parameter, the coin trigger fires in an order that was clearly reasoned about,
and streaks are internally consistent across all 49 profiles. Those are the
claims most worth being true.

**The failures share one shape: a success signal that isn't measuring the thing.**
Storage GC's cron reports `succeeded` 2,710 times while nothing is collected,
because the job's success means "the SQL ran", not "the blob was deleted". The
i18n fallback idiom reports a string, because `||` sees a truthy key path and
concludes the lookup worked. The coin ledger reports an actor, because
`current_user` returns *an* answer inside SECURITY DEFINER — just not the one
anybody wants. The welcome capsule reports nothing at all, because its failure
path is `console.warn`. In each case the mechanism is present, the dashboard is
green, and the outcome is absent.

That is worth stating plainly because it is the same lesson the push pipeline
taught this project in July: *an empty result table reads identically to "never
dispatched".* The cheap defense is to assert on the **outcome** —
`processed_at IS NOT NULL`, a key present in `en`, an `actor` that is ever
anything but `postgres` — not on the step completing.

**Best improvement-per-hour:**
1. `verify_jwt: false` on `storage-gc` (#74). One setting. Turns a dead
   five-minute cron into a working one and drains a nine-day backlog.
2. The 13 raw-key call sites (#62), plus the test that scans for them. The bug
   is user-visible text reading `nutrition.toast.waterCap`.
3. Fail the i18n build on duplicate language blocks (#61) and un-duplicate the
   three files. Two lines in the splitter.
4. Gate the welcome-capsule localStorage write on success (#55) — copy the
   pattern from forty lines below it in the same file.
5. `session_user` instead of `current_user` in the coin ledger (#53).
6. One clock for XP rate limits (#59).

**One row should be reworded rather than fixed:** #66's toast policy was
deliberately changed this session and the sheet still describes the old
behaviour.
