# S + A tier — working-state scorecard

Every feature in the S and A tiers, graded on **how well it actually works
today**, after the fixes from this review cycle. 127 features, all five review
bands applied.

This supersedes the per-band review documents as the *status* record. Those
documents keep the evidence — what was measured, what was probed, what was
retracted — and are worth reading for any row that isn't an A.

---

## Where it stands

| Grade | Before | **After** | |
|:--:|--:|--:|---|
| **A** | 81 | **105** | Ships as is |
| **B** | 22 | **16** | Works; one or two polish gaps |
| **C** | 16 | **3** | A real user will hesitate or misread something |
| **D** | 3 | **0** | Happy path only |
| **F** | 3 | **1** | Broken, missing or misleading |
| — | 2 | 2 | Not gradeable by inspection |

**25 features moved.** Two F's became A's — #43 (the "45+ primitives" claim,
corrected to 14) and #74 (Storage GC, which had never once run). All three D's
cleared, and 13 of 16 C's closed. The remaining F is #20, which is correctly F:
the feature was deleted on purpose.

## Read the Status column before trusting a grade

| Badge | Meaning |
|---|---|
| ✅ live | Shipped and deployed. Netlify auto-deploys `main`. |
| ⏳ needs SQL | **Code is done; the grade is not real until you run the migration.** |
| 🟡 your call | Blocked on a product decision, not on work. |
| 🔒 blocked | Blocked on information I don't have. |
| ⬜ open | Known, specified, not done. |

**Seven A's depend on migrations 285 and 286, which are not yet applied**:
#31, #33, #36, #38, #42 (285) and #53, #59, #74 (286). Until you run those,
treat those rows as their *old* grade in production. #74 in particular is
still an F on your live database right now.

## One honest caveat about the A's

Bands #1–25 were verified in a browser at 375×812 with real taps and
`getBoundingClientRect()` measurements. **Bands #26–127 were verified from
source, SQL against production, and HTTP probes — not by using the UI.**

For the ~60 backend, security and i18n items that is the right instrument, and
it found things a browser never would (a cron that had never fired, an auth
gate at the wrong layer, 28 muted toasts). But roughly **50 UI items in
#76–127 hold an A that means "the code is correct", not "I used it and it felt
right"** — pressed states, disabled reasons, 44×44 targets, layout shift and
backgrounding went unchecked after #25. A browser pass over those is the
single highest-value thing left.

## S tier · Active

| # | ID | Feature | Was | **Now** | Status | What changed / what's left |
|---|---|---|:--:|:--:|---|---|
| 1 | `SH1` | Five-tab bottom nav: Dashboard, Workout, Hub, Progress, Nutrition | A | **A** | ✅ live |  |
| 2 | `D15` | Hero slideshow (auto-advancing, swipeable, prev/next) | C | **C** | ⬜ open | Dots are a 6px visual (hit box is fine); hero occupies ~45% of first paint on a new account. |
| 3 | `ON1` | 14-step onboarding flow: welcome → goal → sharpen → experience → age → height → weight → bod… | B | **B** | ⬜ open | Sheet says 14 steps; the user experiences 11. Doc fix, not yet made. |
| 4 | `ON10` | Training-days-per-week picker | C | **A** | ✅ live | Day chips 39×50 → 44×46. |
| 5 | `ON11` | Four-question fitness self-assessment (bench bodyweight, squat 1.5×BW, 10 strict pull-ups, s… | C | **A** | ✅ live | Assessment Yes/Not-yet 34 → 44; skip 28 → 44. |
| 6 | `ON15` | Reveal step — generated starter regimen presented | B | **B** | ⬜ open | Save-failure path never exercised — not proven broken, not proven handled. |
| 7 | `ON17` | Auto-generated starter regimen from onboarding answers, saved to Regimens | A | **A** | ✅ live |  |
| 8 | `ON2` | Cinematic hero slideshow (5 feature slides: AI Coach, Smart Log, Progress, Recovery, Streaks… | C | **A** | ✅ live | No code change — the finding was wrong. Pips already carry a 44px hit box via `before:-inset-y-5`; review corrected. |
| 9 | `ON3` | Six selectable goals: Build strength, Add muscle, Lose fat, Run faster, Run further, Move be… | A | **A** | ✅ live |  |
| 10 | `ON30` | Username picker + profanity check (server-side, migration 050) | B | **B** | ⬜ open | No inline "available / taken" feedback while typing a username. |
| 11 | `ON6` | Four experience levels with animated bar meters: New / Returning / Consistent / Advanced | A | **A** | ✅ live |  |
| 12 | `ON7` | Age, height, weight capture with validation (13+ age gate, realistic ranges) | C | **A** | ✅ live | Unit toggles 29 → 44. `PillUnitToggle` was the real component; editing `UnitToggle` had changed nothing. |
| 13 | `ON8` | Gender selection: Male / Female / Other (feeds starting-weight scaling and cardio emoji) | A | **A** | ✅ live |  |
| 14 | `ON9` | Body-baseline step (bodyweight + composition context) | C | **A** | ✅ live | Body-baseline inputs 40 → 44. |
| 15 | `W1` | Free-form workout session builder | A | **A** | ✅ live |  |
| 16 | `W2` | Exercise autocomplete over a ~400-exercise library | A | **A** | ✅ live |  |
| 17 | `W25` | Save workout; discard workout with confirm dialog | A | **A** | ✅ live |  |
| 18 | `W3` | Per-set logging: weight, reps, completed checkbox | C | **A** | ✅ live | Weight/reps inputs 36 → 44, ⋯ and ± to full height. First attempt squeezed the weight field to 37px; rebalanced. |
| 19 | `W8` | Mark set done / not done, with haptic | C | **B** | 🟡 your call | Complete-set ✓ now 44×44. Still B: whether a set with reps but no weight should count as complete is your call. |

## S tier · Ambient

| # | ID | Feature | Was | **Now** | Status | What changed / what's left |
|---|---|---|:--:|:--:|---|---|
| 20 | `SH14` | `···` dot affordance under tabs that have a quick-action menu | F | **F** | ✅ live | Correctly F — the `···` affordance does not exist. Deleted 2026-08-05; taught by the long-press tooltip instead. |
| 21 | `SH2` | Hub tab rendered as a center "FAB" ring, visually distinct from the other four | A | **A** | ✅ live |  |
| 22 | `SH20` | Fixed mobile header: logo (home) or back-arrow + page title on child routes | C | **C** | ⬜ open | Two count badges 40px apart, both reading "1", in red and orange. |
| 23 | `SH24` | Animated route transitions (Framer Motion, per-route keyed) | A | **A** | ✅ live |  |
| 24 | `SH26` | `last_active_at` presence heartbeat, once per session per day | — | **—** | ⬜ open | Presence heartbeat — write-only, no UI. Not gradeable by inspection. |
| 25 | `SH27` | Safe-area insets respected (iOS home indicator, notch) | — | **—** | ⬜ open | Safe-area insets — no notch in the emulator. |
| 26 | `SH30` | Launch splash + splash screen route | A | **A** | ✅ live |  |
| 27 | `SH4` | Bottom nav auto-hides on scroll-down, snaps back on scroll-up (6px jitter threshold) | A | **A** | ✅ live |  |
| 28 | `SH5` | Nav visibility resets to visible on every route change | B | **A** | ✅ live | Proving the claim found a real bug: `lastScrollY` seeded to 0 inverted the gesture on any non-nav navigation. Now seeded from `window.scrollY`. |
| 29 | `D19` | Login streak banner | B | **B** | ✅ live |  |
| 30 | `BE1` | 279 SQL migrations with a documented runbook + state-check query | B | **B** | ⬜ open | `_migration_log` has 0 rows. Populate it or drop it — your call. |
| 31 | `BE10` | FK indexing + hot-path indexes | C | **A** | ⏳ needs SQL | 16 FK indexes — migration 285. Drift audit now catches the class. |
| 32 | `BE15` | Vault-stored secrets for push + cron | B | **B** | ⬜ open | Debrief Vault secrets — only actionable when that cron is re-scheduled. |
| 33 | `BE19` | Anti-cheat: XP rate limits, coin mint ceiling, capsule mint lockdown, server-authoritative l… | B | **B** | 🔒 blocked | `loot_catalog` INSERT revoked (285). Escrow half still blocked — I could not find anything by that name. |
| 34 | `BE20` | Atomic RPCs for every economy-touching write (purchase, capsule open, goal complete, post co… | B | **B** | ⬜ open | Economy-RPC atomicity under real concurrency. Needs a racing harness. |
| 35 | `BE22` | TanStack Query cache with a shared query client | A | **A** | ✅ live |  |
| 36 | `BE3` | RLS on every user table | A | **A** | ⏳ needs SQL | anon SELECT revoked on the four zero-policy tables — migration 285. |
| 37 | `BE4` | SECURITY DEFINER RPC layer for anything cross-user | A | **A** | ✅ live |  |
| 38 | `BE5` | `auth.uid()`-gated RPCs (never trusting client-passed identifiers) | B | **A** | ⏳ needs SQL | `is_blocked` ignores its client-supplied viewer id — migration 285. |
| 39 | `BE6` | Privileged-column lockdown — client writes to `flex_coins`, `total_xp`, `current_level`, `pr… | A | **A** | ✅ live |  |
| 40 | `BE7` | Anon RPC surface lockdown | B | **B** | ⬜ open | 67 of 321 public functions are anon-executable; 13 are SECURITY DEFINER. |
| 41 | `BE8` | Function `search_path` hardening | A | **A** | ✅ live |  |
| 42 | `BE9` | RLS initplan optimization (wrapped `auth.*` calls) | B | **A** | ⏳ needs SQL | 8 policies wrapped in `(SELECT auth.uid())` — migration 285. Review had said 11; three were regex false positives. |
| 43 | `UI1` | 14 UI primitives — alert-dialog, badge, button, card, dialog, drawer, dropdown-menu, input… | F | **A** | ✅ live | Claim corrected: 14 primitives, not 45+. 32 unused files and 22 Radix deps deleted. |
| 44 | `UI11` | PageHeader | B | **B** | ⬜ open | `PageHeader` exists with 5 consumers; most pages roll their own. |
| 45 | `UI13` | Flexyn logo component | A | **A** | ✅ live |  |
| 46 | `UI14` | Skeleton loaders throughout | A | **A** | ✅ live |  |
| 47 | `UI16` | Intl helpers — `useNumberFormatter`, `useDateFormatter`, `formatNumber`, `formatDate` | A | **A** | ✅ live |  |
| 48 | `UI17` | Relative-date formatting + per-locale date-fns locales | C | **A** | ✅ live | ko/ar/hi/tr added; sv/da/nb/fi dropped. Map now matches the 15 shipped languages. |
| 49 | `UI18` | Pluralization helper | C | **C** | ⬜ open | `pluralize()` correct but barely called. Wide mechanical sweep. |
| 50 | `UI6` | AnimatedNumber (count-up) | C | **A** | ✅ live | Three `AnimatedNumber`s → one. Shared component gained `from`; LiveVolumePill renamed, deliberately not merged. |
| 51 | `GA1` | XP system with a tuned curve through Level 100 | A | **A** | ✅ live |  |
| 52 | `GA10` | Flex Coins currency | A | **A** | ✅ live |  |
| 53 | `GA11` | Coin ledger with a rolling mint ceiling that clamps over-credits (migration 264) | B | **A** | ⏳ needs SQL | `actor` now `session_user` — migration 286. Historic rows cannot be corrected. |
| 54 | `GA2` | Level bar + animated level-up overlay | A | **A** | ✅ live |  |
| 55 | `GA23` | Welcome capsule + first-workout capsule (migrations 277/278) | C | **A** | ✅ live | localStorage moved into `.then()`, so a failed grant retries instead of burning the one shot. `reportError` replaces `console.warn`. |
| 56 | `GA3` | Level-up manager (queued, non-overlapping) | B | **B** | ⬜ open | Not actually queued — one state + a fired-for guard. Behaviour is fine; the wording is loose. |
| 57 | `GA43` | Login streak + workout streak, tracked separately | A | **A** | ✅ live |  |
| 58 | `GA6` | Server-authoritative XP (migration 189) | A | **A** | ✅ live |  |
| 59 | `GA7` | Per-action, per-day XP rate limits + audit ledger (migrations 188, 198) | B | **A** | ⏳ needs SQL | Per-action XP caps use `user_local_now()` — migration 286. |
| 60 | `GA8` | XP rewards for: workouts, cardio, water, goals, regimens created, achievements, milestones | A | **A** | ✅ live |  |
| 61 | `I18-2` | ~40 per-domain translation part files, aggregated at build time by `scripts/split-i18n.mjs` | B | **A** | ✅ live | Splitter fails the build on duplicate language blocks (brace-depth aware). 4 lost keys recovered. |
| 62 | `I18-3` | `tFallback('key', 'English')` pattern — never renders a raw key | D | **A** | ✅ live | 11 `t(key) || fallback` sites → `tFallback`. `i18nRawKeys.test.js` fails on the pattern. CLAUDE.md corrected. |
| 63 | `ON14` | Animated "loading / building your plan" step | A | **A** | ✅ live |  |
| 64 | `ON16` | Per-step transition animations (curtain, tilt, flip, flash, iris) | A | **A** | ✅ live |  |
| 65 | `RS11` | Sentry async error capture with feature tags (`reportError`) | A | **A** | ✅ live |  |
| 66 | `RS12` | Toast policy — errors always show; success toasts require an action | B | **A** | ✅ live | All of info/message/warning now passthrough. 28 of 28 sites carried no action, so the gate was an off switch. |
| 67 | `RS13` | Build guards that fail the build on `MISSING_EXPORT`, `UNRESOLVED_IMPORT`, `PLUGIN_ERROR` | A | **A** | ✅ live |  |
| 68 | `RS14` | Manual vendor chunking (tfjs, supabase, charts, motion, maplibre isolated) | A | **A** | ✅ live |  |
| 69 | `RS15` | Lazy-loaded pages, modals and tabs | A | **A** | ✅ live |  |
| 70 | `RS18` | Micro-batcher request coalescer | B | **B** | ⬜ open | Micro-batcher works, 3 consumers, all reaction writes. |
| 71 | `RS19` | Profile cache module with explicit `patchProfile` invalidation | A | **A** | ✅ live |  |
| 72 | `RS2` | Service worker with precache + offline shell | A | **A** | ✅ live |  |
| 73 | `RS22` | Delayed-loading hook (no spinner flash on fast responses) | B | **B** | ⬜ open | `useDelayedLoading` works, 5 consumers. |
| 74 | `RS31` | Storage GC Edge Function | F | **A** | ⏳ needs SQL | Two independent faults, both fixed: `net.http_post` (286) and a `verify_jwt:false` redeploy. **Verify it drains after the SQL.** |
| 75 | `RS6` | Write strip-and-retry on missing columns (`db.js`) | A | **A** | ✅ live |  |
| 76 | `RS7` | Read strip-and-retry on missing columns (`safeSelect.js`) | A | **A** | ✅ live |  |
| 77 | `RS8` | Per-region ErrorBoundaries around every major card | A | **A** | ✅ live |  |
| 78 | `RS9` | Route-level ErrorBoundaries on every page | A | **A** | ✅ live |  |
| 79 | `W29` | Idempotent save / reconcile (migration 142) — no double-logged sessions | A | **A** | ✅ live |  |
| 80 | `W52` | First-workout celebration + first-workout capsule grant (with retry message if the grant fails) | A | **A** | ✅ live |  |
| 81 | `W55` | Workout sessions hook with pausable background sync | A | **A** | ✅ live |  |
| 82 | `W56` | Workout XP calculation (per-set formula, session caps) | A | **A** | ✅ live |  |

## A tier · Active

| # | ID | Feature | Was | **Now** | Status | What changed / what's left |
|---|---|---|:--:|:--:|---|---|
| 83 | `AI28` | Onboarding coach variant | A | **A** | ✅ live |  |
| 84 | `SH22` | Pull-to-refresh on the whole app shell | A | **A** | ✅ live |  |
| 85 | `D16` | Hero card → Start workout CTA | A | **A** | ✅ live |  |
| 86 | `D23` | Daily chest card ("Free capsule + coins — tap to open") | C | **A** | ✅ live | Already-claimed toast now renders; readiness reads the server `last_daily_chest_at`; coin balance patched from `new_balance`. |
| 87 | `D43` | Push opt-in banner (only after first workout) | A | **A** | ✅ live |  |
| 88 | `GA16` | Capsules — standard / premium / elite rarity ladder | A | **A** | ✅ live |  |
| 89 | `GA17` | Capsule opener animation (single + batch open) | A | **A** | ✅ live |  |
| 90 | `GA25` | Daily chest (once per UTC day) | C | **A** | ✅ live | Same fix as #86. |
| 91 | `NT1` | Notification bell with unread badge + bounce animation | A | **A** | ✅ live |  |
| 92 | `NT2` | Notification panel (slide-in) | A | **A** | ✅ live |  |
| 93 | `ON18` | Onboarding AI Coach component (`OnboardingCoach`) | A | **A** | ✅ live | Same component as #83. |
| 94 | `P1` | Four tabs: Trends, Body, Photos, Insights | A | **A** | ✅ live |  |
| 95 | `SE1` | Settings panel (slide-over from the profile menu) | A | **A** | ✅ live |  |
| 96 | `SE32` | Profile menu entries: Profile · Settings · Achievements · My Bag · My Gym · My Gyms · My Jou… | D | **A** | ✅ live | Row rewritten from the twelve buttons that exist. Marketplace / Trade History / Admin were never there. |
| 97 | `W4` | Weight stepper buttons (increase/decrease) + decimal input mode | A | **A** | ✅ live |  |
| 98 | `W45` | First-workout coach-mark tutorial (skip / next / dismiss, tip N of M) | A | **A** | ✅ live |  |
| 99 | `W46` | Workout saved list with search by name or date | A | **A** | ✅ live |  |
| 100 | `W74` | Starter plan hero card ("Your starter plan is ready") + customize / remove | A | **A** | ✅ live |  |
| 101 | `W75` | Starter plan view | A | **A** | ✅ live |  |
| 102 | `W9` | "Complete exercise" one-tap | A | **A** | ✅ live |  |

## A tier · Ambient

| # | ID | Feature | Was | **Now** | Status | What changed / what's left |
|---|---|---|:--:|:--:|---|---|
| 103 | `SH15` | One-shot tooltip teaching the long-press gesture ("Hold any tab for shortcuts") | A | **A** | ✅ live |  |
| 104 | `SH28` | Keyboard-inset hook so composers sit above the on-screen keyboard | A | **A** | ✅ live |  |
| 105 | `SH6` | Haptic pulse on every tab tap | A | **A** | ✅ live |  |
| 106 | `D20` | Workout streak banner | A | **A** | ✅ live |  |
| 107 | `D25` | Daily quote (rotating), prev/next, editable rotation | A | **A** | ✅ live |  |
| 108 | `D47` | Stat tiles: This week, Volume, Muscle groups — each with vs-last-week trend arrows | A | **A** | ✅ live |  |
| 109 | `D53` | Trophy check on load (auto-celebrates newly earned trophies) | A | **A** | ✅ live |  |
| 110 | `UI10` | OneShotTooltip + tooltip registry (each hint shows once, ever) | D | **A** | ✅ live | Three hints mounted, `STREAK_FLAME_TAP` removed (no such gesture). Guard test verified to fire. |
| 111 | `UI2` | BottomSheet | A | **A** | ✅ live |  |
| 112 | `UI22` | Haptic helper with named patterns | A | **A** | ✅ live |  |
| 113 | `UI3` | MobileSelect (native-feel picker on touch devices) | B | **B** | ⬜ open | `MobileSelect` real, 5 consumers, all in the gyms area. |
| 114 | `UI4` | FormattedNumberInput | B | **B** | ⬜ open | `FormattedNumberInput` real, 2 consumers. Thinnest adoption in the band. |
| 115 | `UI9` | EmptyState + a set of empty-state illustrations | A | **A** | ✅ live |  |
| 116 | `GA20` | Atomic capsule open + server-authoritative rolls (migrations 028, 255, 266) | A | **A** | ✅ live |  |
| 117 | `GA47` | Streak flame component with intensity by length | A | **A** | ✅ live |  |
| 118 | `GA50` | Reward queue — serializes multi-celebration moments so toasts don't overlap | A | **A** | ✅ live |  |
| 119 | `GA51` | Particles / theme animation layer | A | **A** | 🟡 your call | Half of it is dark. `THEMES_ENABLED = false` makes `activeAnimation` always null, so `ThemeAnimationLayer` renders nothing; `Particles` is imported directly by `LevelUpOverlay`/`LevelBar` and does still run. Code is correct — it lights up when themes come back. |
| 120 | `GA52` | Seven celebration helpers, each with a distinct haptic + confetti signature — goal, first-wo… | A | **A** | ✅ live | Count corrected to seven in both docs. Audited: 7/7 distinct vibration patterns. |
| 121 | `GA9` | Level reward schedule (migration 263) | A | **A** | ✅ live |  |
| 122 | `NT18` | Notification types wired to push: streak milestone/break, quest claimed/expiry, league promo… | A | **A** | ✅ live |  |
| 123 | `RS20` | Scroll position + scroll restoration hooks | A | **A** | ✅ live |  |
| 124 | `RS28` | Body-scroll lock hook | A | **A** | ✅ live |  |
| 125 | `RS29` | Autofocus-on-open hook | A | **A** | ✅ live |  |
| 126 | `W16` | Live volume pill (running session tonnage) | A | **A** | ✅ live |  |
| 127 | `W17` | Workout elapsed-time chip | A | **A** | ✅ live |  |
---

## Everything not yet at A, in one place

### 🟡 Needs a decision from you (3)

| # | Feature | The decision |
|---|---|---|
| 19 | Complete-set ✓ | Should a set with reps but no weight count as complete? Bodyweight movements say yes; a forgotten weight field says no. |
| 30 | `_migration_log` | 0 rows. Populate it going forward, or drop the table. An empty table that looks like a ledger is the worst of the three. |
| — | `Legal.jsx` placeholders | Three amber `LEGAL_TODO` markers ship on /privacy and /terms: entity name, contact email, jurisdiction. Only you can fill these, and they are user-visible. |

### 🔒 Blocked on information (1)

| # | Feature | What's missing |
|---|---|---|
| 33 | Bounty escrow | No function body matches escrow/hold/deduct near a bounty. Either it's under a name I didn't guess or the claim is loose. Point me at it. |

### ⬜ Open, with the reason it wasn't done (16)

**Real user-facing gaps — worth doing next:**

| # | Feature | Gap | Effort |
|---|---|---|---|
| 22 | Fixed mobile header | Two count badges 40px apart, both reading "1". Red vs orange reads as one alert at 16px. Change the shape or drop the avatar badge. | S |
| 2 | Hero slideshow | Dots are a 6px visual (the hit box is fine). Below the threshold of reading as a control. | S |
| 10 | Username picker | No inline "✓ available / ✗ taken" while typing; the only signal is the CTA enabling. | M |
| 6 | Reveal step | Save-failure path never exercised. Force an offline save and confirm the user gets a retry, not a stuck "Saving…". | S to test |
| 3 | Onboarding flow | Sheet says 14 steps; users experience 11. Doc fix. | S |

**Adoption sweeps — correct code, thin usage:**

| # | Feature | Gap | Effort |
|---|---|---|---|
| 44 | PageHeader | 5 consumers; most pages roll their own header. | M |
| 49 | `pluralize()` | Correct, barely called. Wide sweep, each edit a chance to change user-visible copy. | M |
| 70 | Micro-batcher | 3 consumers, all reaction writes. | M |
| 73 | `useDelayedLoading` | 5 consumers; most spinners still render immediately. | M |
| 113 | MobileSelect | 5 consumers, all in the gyms area. | M |
| 114 | FormattedNumberInput | 2 consumers. | M |
| — | `prefersReducedMotion` | Seven components still carry a private copy. `src/lib/reducedMotion.js` exists for them. | S |

**Wording, not code:**

| # | Feature | Gap |
|---|---|---|
| 56 | Level-up manager | Not actually queued — one state plus a fired-for guard. Behaviour is right; the sheet's word is wrong. |
| 40 | Anon RPC surface | 67 of 321 public functions are anon-executable, 13 SECURITY DEFINER. Audited as intentional, but worth a standing check. |
| 32 | Debrief Vault secrets | Only actionable when that cron is re-scheduled. |
| 34 | Economy-RPC atomicity | Needs a harness racing overlapping RPCs. Cannot be settled by reading function bodies. |

### 🔴 Still F (1)

| # | Feature | Why |
|---|---|---|
| 20 | `···` quick-action affordance | **Correctly F — the feature does not exist.** It was 5px at 50% opacity, read by a reviewer as a clipped second line of the tab label, and deleted on 2026-08-05. The gesture is now taught by the long-press one-shot tooltip instead, which fires once and is legible. Nothing to build; the row should be struck from the sheet. |

---

## What to do next, in order

1. **Run migrations 285 and 286.** Seven A's above are not real until you do,
   and #74 is still failing in production every five minutes.
2. **Check Storage GC actually drains** — within ~5 minutes of 286, both rows
   in `storage_cleanup_queue` should show `processed_at`. If `attempts`
   climbs but `processed_at` stays null, there's a third problem: the
   function's `STORAGE_GC_SECRET` not matching the Vault's `storage_gc_secret`,
   which could not be tested while nothing was being dispatched at all.
3. **Fill the three `Legal.jsx` placeholders.** They are live and user-visible.
4. **Browser pass over #76–127.** The largest gap in the review itself, not in
   the product — ~50 UI items graded from source.
5. **The five user-facing gaps** in the table above (#22, #2, #10, #6, #3).

## The pattern worth keeping

Four of the five findings that mattered this cycle were the same shape: **the
mechanism ran, the signal said fine, and the outcome never happened.**

- Storage GC recorded `succeeded` 2,710 times while collecting nothing.
- `getTranslation` returned a truthy key string, so `||` never reached its fallback.
- `keepIfAction` returned `undefined`, so 28 toasts were dropped with no error.
- Four tooltips were registered, documented, and never rendered.

None of them threw. None failed a test. Each was found by checking an
**outcome** — `processed_at`, a key's presence in `en`, whether sonner was
called, whether a mount site exists — rather than whether the mechanism
existed. Every guard added this cycle asserts on the outcome for that reason,
and each one was verified to actually fail before being trusted.
