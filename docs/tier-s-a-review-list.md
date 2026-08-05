# S & A tier — review list

From `FlexynFeatureRanking.xlsx` (890 features, 7 tiers). This is the top two
bands: **82 S** (90–100% of retained users) + **45 A** (70–90%) = **127 items**.

Ordered tier → kind → area → ID. Numbering is stable; cite it as `#n`.

**Active vs Ambient is the distinction that matters here.** Active means a user
chooses to use it — a button, a screen, a flow. Ambient is infrastructure and
chrome they benefit from without choosing. Of the 127, only **39 are Active**
(19 in S, 20 in A); the other 88 are ambient. A UX review applies to the 39. The
88 need a different kind of review — correctness, not usability.

The spreadsheet's own caveat is worth repeating: these are estimates, not
measurements. There is no usage analytics in the app. The author flags the
social tiers as weakest — but note almost nothing social reaches S or A, which
is itself a finding.


## S tier · Active

| # | ID | Est. | Feature | Area |
|---|---|---|---|---|
| 1 | `SH1` | 100% | Five-tab bottom nav: Dashboard, Workout, Hub, Progress, Nutrition | App shell, navigation & chrome |
| 2 | `D15` | 92% | Hero slideshow (auto-advancing, swipeable, prev/next) | Dashboard |
| 3 | `ON1` | 100% | 14-step onboarding flow: welcome → goal → sharpen → experience → age → height → weight → body baseline → days → assessment → injury history → home gym → loading → reveal | Onboarding & auth |
| 4 | `ON10` | 98% | Training-days-per-week picker | Onboarding & auth |
| 5 | `ON11` | 90% | Four-question fitness self-assessment (bench bodyweight, squat 1.5×BW, 10 strict pull-ups, sub-10-min mile) with Yes / Not yet | Onboarding & auth |
| 6 | `ON15` | 95% | Reveal step — generated starter regimen presented | Onboarding & auth |
| 7 | `ON17` | 90% | Auto-generated starter regimen from onboarding answers, saved to Regimens | Onboarding & auth |
| 8 | `ON2` | 95% | Cinematic hero slideshow (5 feature slides: AI Coach, Smart Log, Progress, Recovery, Streaks) with custom SVG visuals | Onboarding & auth |
| 9 | `ON3` | 100% | Six selectable goals: Build strength, Add muscle, Lose fat, Run faster, Run further, Move better | Onboarding & auth |
| 10 | `ON30` | 95% | Username picker + profanity check (server-side, migration 050) | Onboarding & auth |
| 11 | `ON6` | 100% | Four experience levels with animated bar meters: New / Returning / Consistent / Advanced | Onboarding & auth |
| 12 | `ON7` | 100% | Age, height, weight capture with validation (13+ age gate, realistic ranges) | Onboarding & auth |
| 13 | `ON8` | 98% | Gender selection: Male / Female / Other (feeds starting-weight scaling and cardio emoji) | Onboarding & auth |
| 14 | `ON9` | 95% | Body-baseline step (bodyweight + composition context) | Onboarding & auth |
| 15 | `W1` | 96% | Free-form workout session builder | Workout |
| 16 | `W2` | 94% | Exercise autocomplete over a ~400-exercise library | Workout |
| 17 | `W25` | 96% | Save workout; discard workout with confirm dialog | Workout |
| 18 | `W3` | 96% | Per-set logging: weight, reps, completed checkbox | Workout |
| 19 | `W8` | 95% | Mark set done / not done, with haptic | Workout |

## S tier · Ambient

| # | ID | Est. | Feature | Area |
|---|---|---|---|---|
| 20 | `SH14` | 90% | `···` dot affordance under tabs that have a quick-action menu | App shell, navigation & chrome |
| 21 | `SH2` | 100% | Hub tab rendered as a center "FAB" ring, visually distinct from the other four | App shell, navigation & chrome |
| 22 | `SH20` | 100% | Fixed mobile header: logo (home) or back-arrow + page title on child routes | App shell, navigation & chrome |
| 23 | `SH24` | 100% | Animated route transitions (Framer Motion, per-route keyed) | App shell, navigation & chrome |
| 24 | `SH26` | 100% | `last_active_at` presence heartbeat, once per session per day | App shell, navigation & chrome |
| 25 | `SH27` | 95% | Safe-area insets respected (iOS home indicator, notch) | App shell, navigation & chrome |
| 26 | `SH30` | 100% | Launch splash + splash screen route | App shell, navigation & chrome |
| 27 | `SH4` | 98% | Bottom nav auto-hides on scroll-down, snaps back on scroll-up (6px jitter threshold) | App shell, navigation & chrome |
| 28 | `SH5` | 98% | Nav visibility resets to visible on every route change | App shell, navigation & chrome |
| 29 | `D19` | 90% | Login streak banner | Dashboard |
| 30 | `BE1` | 100% | 279 SQL migrations with a documented runbook + state-check query | Data, security & backend systems |
| 31 | `BE10` | 100% | FK indexing + hot-path indexes | Data, security & backend systems |
| 32 | `BE15` | 100% | Vault-stored secrets for push + cron | Data, security & backend systems |
| 33 | `BE19` | 100% | Anti-cheat: XP rate limits, coin mint ceiling, capsule mint lockdown, server-authoritative loot catalog, crew war XP clamp, bounty escrow, referral cap | Data, security & backend systems |
| 34 | `BE20` | 90% | Atomic RPCs for every economy-touching write (purchase, capsule open, goal complete, post counter, league resolution, volume/distance increment, crew war contribution) | Data, security & backend systems |
| 35 | `BE22` | 100% | TanStack Query cache with a shared query client | Data, security & backend systems |
| 36 | `BE3` | 100% | RLS on every user table | Data, security & backend systems |
| 37 | `BE4` | 100% | SECURITY DEFINER RPC layer for anything cross-user | Data, security & backend systems |
| 38 | `BE5` | 100% | `auth.uid()`-gated RPCs (never trusting client-passed identifiers) | Data, security & backend systems |
| 39 | `BE6` | 100% | Privileged-column lockdown — client writes to `flex_coins`, `total_xp`, `current_level`, `prestige_level`, `league_tier`, streak columns, `referral_code`, etc. rejected with 42501 | Data, security & backend systems |
| 40 | `BE7` | 100% | Anon RPC surface lockdown | Data, security & backend systems |
| 41 | `BE8` | 100% | Function `search_path` hardening | Data, security & backend systems |
| 42 | `BE9` | 100% | RLS initplan optimization (wrapped `auth.*` calls) | Data, security & backend systems |
| 43 | `UI1` | 100% | **14** UI primitives — alert-dialog, badge, button, card, dialog, drawer, dropdown-menu, input, select, skeleton, textarea (Radix-backed) + BottomSheet, CharCountIndicator, FormattedNumberInput (local). ⚠️ **Corrected 2026-08-05** — the original row claimed "45+" and named 31 components that do not exist in this repo (accordion, avatar, chart, table, tabs, toast, tooltip, sidebar, form, …). They were shadcn scaffolding that shipped with the starter and was never wired to anything: a transitive-reachability check found **zero** consumers, so 32 files and 22 unused Radix dependencies were deleted. Nothing regressed, because nothing imported them. Re-score this row against 14. | Design system & primitives |
| 44 | `UI11` | 95% | PageHeader | Design system & primitives |
| 45 | `UI13` | 100% | Flexyn logo component | Design system & primitives |
| 46 | `UI14` | 95% | Skeleton loaders throughout | Design system & primitives |
| 47 | `UI16` | 90% | Intl helpers — `useNumberFormatter`, `useDateFormatter`, `formatNumber`, `formatDate` | Design system & primitives |
| 48 | `UI17` | 90% | Relative-date formatting + per-locale date-fns locales | Design system & primitives |
| 49 | `UI18` | 90% | Pluralization helper | Design system & primitives |
| 50 | `UI6` | 90% | AnimatedNumber (count-up) | Design system & primitives |
| 51 | `GA1` | 95% | XP system with a tuned curve through Level 100 | Gamification & economy |
| 52 | `GA10` | 90% | Flex Coins currency | Gamification & economy |
| 53 | `GA11` | 90% | Coin ledger with a rolling mint ceiling that clamps over-credits (migration 264) | Gamification & economy |
| 54 | `GA2` | 92% | Level bar + animated level-up overlay | Gamification & economy |
| 55 | `GA23` | 90% | Welcome capsule + first-workout capsule (migrations 277/278) | Gamification & economy |
| 56 | `GA3` | 90% | Level-up manager (queued, non-overlapping) | Gamification & economy |
| 57 | `GA43` | 90% | Login streak + workout streak, tracked separately | Gamification & economy |
| 58 | `GA6` | 95% | Server-authoritative XP (migration 189) | Gamification & economy |
| 59 | `GA7` | 95% | Per-action, per-day XP rate limits + audit ledger (migrations 188, 198) | Gamification & economy |
| 60 | `GA8` | 95% | XP rewards for: workouts, cardio, water, goals, regimens created, achievements, milestones | Gamification & economy |
| 61 | `I18-2` | 100% | ~40 per-domain translation part files, aggregated at build time by `scripts/split-i18n.mjs` | Internationalization |
| 62 | `I18-3` | 100% | `tFallback('key', 'English')` pattern — never renders a raw key | Internationalization |
| 63 | `ON14` | 100% | Animated "loading / building your plan" step | Onboarding & auth |
| 64 | `ON16` | 100% | Per-step transition animations (curtain, tilt, flip, flash, iris) | Onboarding & auth |
| 65 | `RS11` | 100% | Sentry async error capture with feature tags (`reportError`) | PWA, performance & resilience |
| 66 | `RS12` | 90% | Toast policy — errors always show; success toasts require an action | PWA, performance & resilience |
| 67 | `RS13` | 100% | Build guards that fail the build on `MISSING_EXPORT`, `UNRESOLVED_IMPORT`, `PLUGIN_ERROR` | PWA, performance & resilience |
| 68 | `RS14` | 100% | Manual vendor chunking (tfjs, supabase, charts, motion, maplibre isolated) | PWA, performance & resilience |
| 69 | `RS15` | 100% | Lazy-loaded pages, modals and tabs | PWA, performance & resilience |
| 70 | `RS18` | 100% | Micro-batcher request coalescer | PWA, performance & resilience |
| 71 | `RS19` | 100% | Profile cache module with explicit `patchProfile` invalidation | PWA, performance & resilience |
| 72 | `RS2` | 90% | Service worker with precache + offline shell | PWA, performance & resilience |
| 73 | `RS22` | 90% | Delayed-loading hook (no spinner flash on fast responses) | PWA, performance & resilience |
| 74 | `RS31` | 100% | Storage GC Edge Function | PWA, performance & resilience |
| 75 | `RS6` | 100% | Write strip-and-retry on missing columns (`db.js`) | PWA, performance & resilience |
| 76 | `RS7` | 100% | Read strip-and-retry on missing columns (`safeSelect.js`) | PWA, performance & resilience |
| 77 | `RS8` | 100% | Per-region ErrorBoundaries around every major card | PWA, performance & resilience |
| 78 | `RS9` | 100% | Route-level ErrorBoundaries on every page | PWA, performance & resilience |
| 79 | `W29` | 100% | Idempotent save / reconcile (migration 142) — no double-logged sessions | Workout |
| 80 | `W52` | 90% | First-workout celebration + first-workout capsule grant (with retry message if the grant fails) | Workout |
| 81 | `W55` | 100% | Workout sessions hook with pausable background sync | Workout |
| 82 | `W56` | 95% | Workout XP calculation (per-set formula, session caps) | Workout |

## A tier · Active

| # | ID | Est. | Feature | Area |
|---|---|---|---|---|
| 83 | `AI28` | 70% | Onboarding coach variant | AI Coach |
| 84 | `SH22` | 70% | Pull-to-refresh on the whole app shell | App shell, navigation & chrome |
| 85 | `D16` | 80% | Hero card → Start workout CTA | Dashboard |
| 86 | `D23` | 70% | Daily chest card ("Free capsule + coins — tap to open") | Dashboard |
| 87 | `D43` | 70% | Push opt-in banner (only after first workout) | Dashboard |
| 88 | `GA16` | 80% | Capsules — standard / premium / elite rarity ladder | Gamification & economy |
| 89 | `GA17` | 78% | Capsule opener animation (single + batch open) | Gamification & economy |
| 90 | `GA25` | 70% | Daily chest (once per UTC day) | Gamification & economy |
| 91 | `NT1` | 85% | Notification bell with unread badge + bounce animation | Notifications |
| 92 | `NT2` | 70% | Notification panel (slide-in) | Notifications |
| 93 | `ON18` | 70% | Onboarding AI Coach component (`OnboardingCoach`) | Onboarding & auth |
| 94 | `P1` | 70% | Four tabs: Trends, Body, Photos, Insights | Progress |
| 95 | `SE1` | 75% | Settings panel (slide-over from the profile menu) | Settings & account |
| 96 | `SE32` | 80% | Profile menu entries: **Profile · Settings · Achievements · My Bag · My Gym · My Gyms · My Journal · Weekly Summary · My Injuries · Sign out/Sign in · Delete account**, plus Corporate Wellness (feature-flagged **off**, renders for nobody). ⚠️ **Corrected 2026-08-05** — the original row claimed three entries that do not exist: *Marketplace* (My Bag navigates to `/market`, but there is no Marketplace item), *Trade History* (absent), and a role-gated *Admin* entry (the only admin affordance is a crown drawn on the avatar for verified users). It also omitted four that do: Achievements, My Journal, Weekly Summary, My Injuries. Read off the twelve buttons in `ProfileMenu.jsx`. | Settings & account |
| 97 | `W4` | 70% | Weight stepper buttons (increase/decrease) + decimal input mode | Workout |
| 98 | `W45` | 85% | First-workout coach-mark tutorial (skip / next / dismiss, tip N of M) | Workout |
| 99 | `W46` | 70% | Workout saved list with search by name or date | Workout |
| 100 | `W74` | 75% | Starter plan hero card ("Your starter plan is ready") + customize / remove | Workout |
| 101 | `W75` | 70% | Starter plan view | Workout |
| 102 | `W9` | 80% | "Complete exercise" one-tap | Workout |

## A tier · Ambient

| # | ID | Est. | Feature | Area |
|---|---|---|---|---|
| 103 | `SH15` | 80% | One-shot tooltip teaching the long-press gesture ("Hold any tab for shortcuts") | App shell, navigation & chrome |
| 104 | `SH28` | 85% | Keyboard-inset hook so composers sit above the on-screen keyboard | App shell, navigation & chrome |
| 105 | `SH6` | 85% | Haptic pulse on every tab tap | App shell, navigation & chrome |
| 106 | `D20` | 88% | Workout streak banner | Dashboard |
| 107 | `D25` | 75% | Daily quote (rotating), prev/next, editable rotation | Dashboard |
| 108 | `D47` | 85% | Stat tiles: This week, Volume, Muscle groups — each with vs-last-week trend arrows | Dashboard |
| 109 | `D53` | 80% | Trophy check on load (auto-celebrates newly earned trophies) | Dashboard |
| 110 | `UI10` | 85% | OneShotTooltip + tooltip registry (each hint shows once, ever) | Design system & primitives |
| 111 | `UI2` | 85% | BottomSheet | Design system & primitives |
| 112 | `UI22` | 85% | Haptic helper with named patterns | Design system & primitives |
| 113 | `UI3` | 80% | MobileSelect (native-feel picker on touch devices) | Design system & primitives |
| 114 | `UI4` | 85% | FormattedNumberInput | Design system & primitives |
| 115 | `UI9` | 75% | EmptyState + a set of empty-state illustrations | Design system & primitives |
| 116 | `GA20` | 80% | Atomic capsule open + server-authoritative rolls (migrations 028, 255, 266) | Gamification & economy |
| 117 | `GA47` | 80% | Streak flame component with intensity by length | Gamification & economy |
| 118 | `GA50` | 70% | Reward queue — serializes multi-celebration moments so toasts don't overlap | Gamification & economy |
| 119 | `GA51` | 70% | Particles / theme animation layer | Gamification & economy |
| 120 | `GA52` | 85% | **Seven** celebration helpers, each with a distinct haptic + confetti signature — goal, first-workout, first-regimen, first-goal, first-meal, PR, crew-win. ⚠️ **Corrected 2026-08-05** — the row said six; `fireCrewWinCelebration` postdates it. Audited: seven-for-seven distinct vibration patterns, no two colliding. | Gamification & economy |
| 121 | `GA9` | 85% | Level reward schedule (migration 263) | Gamification & economy |
| 122 | `NT18` | 70% | Notification types wired to push: streak milestone/break, quest claimed/expiry, league promoted/demoted/held, friend post, friend follow, comment reply, post reaction/like, sticker reaction, trade offer, crew broadcast, PR set, capsule earned, coin milestone, welcome back, weekly gauntlet started, duel invite/result, bounty claim/beaten, crew war started/resolved, rival assigned, rival overthrown, crew challenge created/completed, DM received, memories, referrals, gym member join, report resolution, workout reminder | Notifications |
| 123 | `RS20` | 80% | Scroll position + scroll restoration hooks | PWA, performance & resilience |
| 124 | `RS28` | 85% | Body-scroll lock hook | PWA, performance & resilience |
| 125 | `RS29` | 70% | Autofocus-on-open hook | PWA, performance & resilience |
| 126 | `W16` | 70% | Live volume pill (running session tonnage) | Workout |
| 127 | `W17` | 75% | Workout elapsed-time chip | Workout |
