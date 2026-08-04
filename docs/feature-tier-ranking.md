# Flexyn — Feature Tier Ranking

All 890 features from [feature-inventory.md](feature-inventory.md), ranked by the
estimated share of **retained users** (people who finish onboarding and stick
around a couple of weeks) who would ever use each one.

## How to read this

**These are estimates, not measurements.** Flexyn has no usage analytics to draw
on yet — `push_subscriptions` is 0 and the app has barely been in real hands. The
numbers come from general fitness-app engagement patterns applied to this app's
specific structure. Treat them as a starting position to argue with, not data.

**Active vs ambient.** Every feature is marked:

- **Active (552)** — someone chooses to use it. A button, a screen, a flow.
- **Ambient (338)** — infrastructure, chrome, guards, error boundaries.
  Users benefit without deciding to.

This split matters. `safeSelect` and the RLS layer score 100%, which would rank
them above the workout logger if you sorted naively — but "everyone benefits" is
not the same claim as "everyone uses". **When cutting, only ever cut from the
active list.** Ambient items at high percentages are load-bearing precisely
because nobody thinks about them.

**What "use" means:** ever, not daily. A feature at 40% means roughly 2 in 5
retained users touch it at least once. Habitual daily use is far rarer than these
numbers suggest — nutrition logging is 40% *tried*, maybe 15% *sustained*.

## Tier bands

| Tier | Range | Name | Count | Active | Ambient |
|---|---|---|---|---|---|
| **S** | 90–100% | Universal | 82 | 19 | 63 |
| **A** | 70–90% | Core | 45 | 20 | 25 |
| **B** | 45–70% | Common | 101 | 54 | 47 |
| **C** | 25–45% | Regular | 177 | 106 | 71 |
| **D** | 10–25% | Occasional | 197 | 142 | 55 |
| **E** | 3–10% | Niche | 209 | 157 | 52 |
| **F** | 0–3% | Rare | 79 | 54 | 25 |

---

## S-Tier — Universal (90–100%) · 82 features

Effectively everyone who keeps the app touches this. Breaking one of these breaks the product.

| % | ID | Feature | Area | Kind |
|---|---|---|---|---|
| 100 | BE1 | 279 SQL migrations with a documented runbook + state-check query | BE | ambient |
| 100 | BE10 | FK indexing + hot-path indexes | BE | ambient |
| 100 | BE15 | Vault-stored secrets for push + cron | BE | ambient |
| 100 | BE19 | Anti-cheat: XP rate limits, coin mint ceiling, capsule mint lockdown, server-authoritative loot catalog, crew war XP clamp, bounty escrow, referral cap | BE | ambient |
| 100 | BE22 | TanStack Query cache with a shared query client | BE | ambient |
| 100 | BE3 | RLS on every user table | BE | ambient |
| 100 | BE4 | SECURITY DEFINER RPC layer for anything cross-user | BE | ambient |
| 100 | BE5 | `auth.uid()`-gated RPCs (never trusting client-passed identifiers) | BE | ambient |
| 100 | BE6 | Privileged-column lockdown — client writes to `flex_coins`, `total_xp`, `current_level`, `prestige_level`, `league_tier`, streak columns, `referral_code`, etc. rejected with 42501 | BE | ambient |
| 100 | BE7 | Anon RPC surface lockdown | BE | ambient |
| 100 | BE8 | Function `search_path` hardening | BE | ambient |
| 100 | BE9 | RLS initplan optimization (wrapped `auth.*` calls) | BE | ambient |
| 100 | I18-2 | ~40 per-domain translation part files, aggregated at build time by `scripts/split-i18n.mjs` | I18 | ambient |
| 100 | I18-3 | `tFallback('key', 'English')` pattern — never renders a raw key | I18 | ambient |
| 100 | ON1 | 14-step onboarding flow: welcome → goal → sharpen → experience → age → height → weight → body baseline → days → assessment → injury history → home gym → loading → reveal | ON | active |
| 100 | ON14 | Animated "loading / building your plan" step | ON | ambient |
| 100 | ON16 | Per-step transition animations (curtain, tilt, flip, flash, iris) | ON | ambient |
| 100 | ON3 | Six selectable goals: Build strength, Add muscle, Lose fat, Run faster, Run further, Move better | ON | active |
| 100 | ON6 | Four experience levels with animated bar meters: New / Returning / Consistent / Advanced | ON | active |
| 100 | ON7 | Age, height, weight capture with validation (13+ age gate, realistic ranges) | ON | active |
| 100 | RS11 | Sentry async error capture with feature tags (`reportError`) | RS | ambient |
| 100 | RS13 | Build guards that fail the build on `MISSING_EXPORT`, `UNRESOLVED_IMPORT`, `PLUGIN_ERROR` | RS | ambient |
| 100 | RS14 | Manual vendor chunking (tfjs, supabase, charts, motion, maplibre isolated) | RS | ambient |
| 100 | RS15 | Lazy-loaded pages, modals and tabs | RS | ambient |
| 100 | RS18 | Micro-batcher request coalescer | RS | ambient |
| 100 | RS19 | Profile cache module with explicit `patchProfile` invalidation | RS | ambient |
| 100 | RS31 | Storage GC Edge Function | RS | ambient |
| 100 | RS6 | Write strip-and-retry on missing columns (`db.js`) | RS | ambient |
| 100 | RS7 | Read strip-and-retry on missing columns (`safeSelect.js`) | RS | ambient |
| 100 | RS8 | Per-region ErrorBoundaries around every major card | RS | ambient |
| 100 | RS9 | Route-level ErrorBoundaries on every page | RS | ambient |
| 100 | SH1 | Five-tab bottom nav: Dashboard, Workout, Hub, Progress, Nutrition | SH | active |
| 100 | SH2 | Hub tab rendered as a center "FAB" ring, visually distinct from the other four | SH | ambient |
| 100 | SH20 | Fixed mobile header: logo (home) or back-arrow + page title on child routes | SH | ambient |
| 100 | SH24 | Animated route transitions (Framer Motion, per-route keyed) | SH | ambient |
| 100 | SH26 | `last_active_at` presence heartbeat, once per session per day | SH | ambient |
| 100 | SH30 | Launch splash + splash screen route | SH | ambient |
| 100 | UI1 | 45+ Radix-based UI primitives (accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, card, chart, checkbox, collapsible, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input, label, menubar, navigation-menu, pagination, popover, progress, radio-group, scroll-area, select, separator, sheet, sidebar, skeleton, slider, switch, table, tabs, textarea, toast, toaster, toggle, toggle-group, tooltip) | UI | ambient |
| 100 | UI13 | Flexyn logo component | UI | ambient |
| 100 | W29 | Idempotent save / reconcile (migration 142) — no double-logged sessions | W | ambient |
| 100 | W55 | Workout sessions hook with pausable background sync | W | ambient |
| 98 | ON10 | Training-days-per-week picker | ON | active |
| 98 | ON8 | Gender selection: Male / Female / Other (feeds starting-weight scaling and cardio emoji) | ON | active |
| 98 | SH4 | Bottom nav auto-hides on scroll-down, snaps back on scroll-up (6px jitter threshold) | SH | ambient |
| 98 | SH5 | Nav visibility resets to visible on every route change | SH | ambient |
| 96 | W1 | Free-form workout session builder | W | active |
| 96 | W25 | Save workout; discard workout with confirm dialog | W | active |
| 96 | W3 | Per-set logging: weight, reps, completed checkbox | W | active |
| 95 | GA1 | XP system with a tuned curve through Level 100 | GA | ambient |
| 95 | GA6 | Server-authoritative XP (migration 189) | GA | ambient |
| 95 | GA7 | Per-action, per-day XP rate limits + audit ledger (migrations 188, 198) | GA | ambient |
| 95 | GA8 | XP rewards for: workouts, cardio, water, goals, regimens created, achievements, milestones | GA | ambient |
| 95 | ON15 | Reveal step — generated starter regimen presented | ON | active |
| 95 | ON2 | Cinematic hero slideshow (5 feature slides: AI Coach, Smart Log, Progress, Recovery, Streaks) with custom SVG visuals | ON | active |
| 95 | ON30 | Username picker + profanity check (server-side, migration 050) | ON | active |
| 95 | ON9 | Body-baseline step (bodyweight + composition context) | ON | active |
| 95 | SH27 | Safe-area insets respected (iOS home indicator, notch) | SH | ambient |
| 95 | UI11 | PageHeader | UI | ambient |
| 95 | UI14 | Skeleton loaders throughout | UI | ambient |
| 95 | W56 | Workout XP calculation (per-set formula, session caps) | W | ambient |
| 95 | W8 | Mark set done / not done, with haptic | W | active |
| 94 | W2 | Exercise autocomplete over a ~400-exercise library | W | active |
| 92 | D15 | Hero slideshow (auto-advancing, swipeable, prev/next) | D | active |
| 92 | GA2 | Level bar + animated level-up overlay | GA | ambient |
| 90 | BE20 | Atomic RPCs for every economy-touching write (purchase, capsule open, goal complete, post counter, league resolution, volume/distance increment, crew war contribution) | BE | ambient |
| 90 | D19 | Login streak banner | D | ambient |
| 90 | GA10 | Flex Coins currency | GA | ambient |
| 90 | GA11 | Coin ledger with a rolling mint ceiling that clamps over-credits (migration 264) | GA | ambient |
| 90 | GA23 | Welcome capsule + first-workout capsule (migrations 277/278) | GA | ambient |
| 90 | GA3 | Level-up manager (queued, non-overlapping) | GA | ambient |
| 90 | GA43 | Login streak + workout streak, tracked separately | GA | ambient |
| 90 | ON11 | Four-question fitness self-assessment (bench bodyweight, squat 1.5×BW, 10 strict pull-ups, sub-10-min mile) with Yes / Not yet | ON | active |
| 90 | ON17 | Auto-generated starter regimen from onboarding answers, saved to Regimens | ON | active |
| 90 | RS12 | Toast policy — errors always show; success toasts require an action | RS | ambient |
| 90 | RS2 | Service worker with precache + offline shell | RS | ambient |
| 90 | RS22 | Delayed-loading hook (no spinner flash on fast responses) | RS | ambient |
| 90 | SH14 | `···` dot affordance under tabs that have a quick-action menu | SH | ambient |
| 90 | UI16 | Intl helpers — `useNumberFormatter`, `useDateFormatter`, `formatNumber`, `formatDate` | UI | ambient |
| 90 | UI17 | Relative-date formatting + per-locale date-fns locales | UI | ambient |
| 90 | UI18 | Pluralization helper | UI | ambient |
| 90 | UI6 | AnimatedNumber (count-up) | UI | ambient |
| 90 | W52 | First-workout celebration + first-workout capsule grant (with retry message if the grant fails) | W | ambient |

---

## A-Tier — Core (70–90%) · 45 features

The majority path. Most retained users hit these in a normal week.

| % | ID | Feature | Area | Kind |
|---|---|---|---|---|
| 88 | D20 | Workout streak banner | D | ambient |
| 85 | D47 | Stat tiles: This week, Volume, Muscle groups — each with vs-last-week trend arrows | D | ambient |
| 85 | GA52 | Six celebration helpers, each with a distinct haptic + confetti signature | GA | ambient |
| 85 | GA9 | Level reward schedule (migration 263) | GA | ambient |
| 85 | NT1 | Notification bell with unread badge + bounce animation | NT | active |
| 85 | RS28 | Body-scroll lock hook | RS | ambient |
| 85 | SH28 | Keyboard-inset hook so composers sit above the on-screen keyboard | SH | ambient |
| 85 | SH6 | Haptic pulse on every tab tap | SH | ambient |
| 85 | UI10 | OneShotTooltip + tooltip registry (each hint shows once, ever) | UI | ambient |
| 85 | UI2 | BottomSheet | UI | ambient |
| 85 | UI22 | Haptic helper with named patterns | UI | ambient |
| 85 | UI4 | FormattedNumberInput | UI | ambient |
| 85 | W45 | First-workout coach-mark tutorial (skip / next / dismiss, tip N of M) | W | active |
| 80 | D16 | Hero card → Start workout CTA | D | active |
| 80 | D53 | Trophy check on load (auto-celebrates newly earned trophies) | D | ambient |
| 80 | GA16 | Capsules — standard / premium / elite rarity ladder | GA | active |
| 80 | GA20 | Atomic capsule open + server-authoritative rolls (migrations 028, 255, 266) | GA | ambient |
| 80 | GA47 | Streak flame component with intensity by length | GA | ambient |
| 80 | RS20 | Scroll position + scroll restoration hooks | RS | ambient |
| 80 | SE32 | Profile menu entries: Profile, Settings, Marketplace, My Bag, My Gym, My Gyms, Corporate, Trade History, Admin (role-gated), Sign out, Delete account | SE | active |
| 80 | SH15 | One-shot tooltip teaching the long-press gesture ("Hold any tab for shortcuts") | SH | ambient |
| 80 | UI3 | MobileSelect (native-feel picker on touch devices) | UI | ambient |
| 80 | W9 | "Complete exercise" one-tap | W | active |
| 78 | GA17 | Capsule opener animation (single + batch open) | GA | active |
| 75 | D25 | Daily quote (rotating), prev/next, editable rotation | D | ambient |
| 75 | SE1 | Settings panel (slide-over from the profile menu) | SE | active |
| 75 | UI9 | EmptyState + a set of empty-state illustrations | UI | ambient |
| 75 | W17 | Workout elapsed-time chip | W | ambient |
| 75 | W74 | Starter plan hero card ("Your starter plan is ready") + customize / remove | W | active |
| 70 | AI28 | Onboarding coach variant | AI | active |
| 70 | D23 | Daily chest card ("Free capsule + coins — tap to open") | D | active |
| 70 | D43 | Push opt-in banner (only after first workout) | D | active |
| 70 | GA25 | Daily chest (once per UTC day) | GA | active |
| 70 | GA50 | Reward queue — serializes multi-celebration moments so toasts don't overlap | GA | ambient |
| 70 | GA51 | Particles / theme animation layer | GA | ambient |
| 70 | NT18 | Notification types wired to push: streak milestone/break, quest claimed/expiry, league promoted/demoted/held, friend post, friend follow, comment reply, post reaction/like, sticker reaction, trade offer, crew broadcast, PR set, capsule earned, coin milestone, welcome back, weekly gauntlet started, duel invite/result, bounty claim/beaten, crew war started/resolved, rival assigned, rival overthrown, crew challenge created/completed, DM received, memories, referrals, gym member join, report resolution, workout reminder | NT | ambient |
| 70 | NT2 | Notification panel (slide-in) | NT | active |
| 70 | ON18 | Onboarding AI Coach component (`OnboardingCoach`) | ON | active |
| 70 | P1 | Four tabs: Trends, Body, Photos, Insights | P | active |
| 70 | RS29 | Autofocus-on-open hook | RS | ambient |
| 70 | SH22 | Pull-to-refresh on the whole app shell | SH | active |
| 70 | W16 | Live volume pill (running session tonnage) | W | ambient |
| 70 | W4 | Weight stepper buttons (increase/decrease) + decimal input mode | W | active |
| 70 | W46 | Workout saved list with search by name or date | W | active |
| 70 | W75 | Starter plan view | W | active |

---

## B-Tier — Common (45–70%) · 101 features

About half. Strong secondary surfaces — the reason people come back beyond logging.

| % | ID | Feature | Area | Kind |
|---|---|---|---|---|
| 68 | P2 | Summary tiles: total workouts, days trained (30d), top muscle group | P | ambient |
| 68 | P3 | Hero stat row: Streak, Workouts, Volume, Level | P | ambient |
| 65 | D24 | Daily quests card, expandable/collapsible, per-quest claim, "+N coins claimed!" | D | active |
| 65 | D42 | Discovery cards (rotating suggestions, per-device dismissal with cooldown) | D | active |
| 65 | GA35 | 26 achievements across regimen, workout, goal, water, tonnage, cardio, nutrition and scanner categories | GA | ambient |
| 65 | GA39 | Daily quests — one easy + one medium + one hard, deterministic per user per day | GA | active |
| 65 | GA40 | Quest catalog keyed to 10 action types (meal, water, workout, workout minutes, cardio, cardio seconds, PR, progress photo, hub post, goal) | GA | ambient |
| 65 | GA41 | Quest coin rewards 8 / 20 / 50, server-enforced (migrations 199, 265) | GA | ambient |
| 65 | SH25 | Global bag + capsule-opener mount (single instance, opened from anywhere via event) | SH | ambient |
| 65 | W57 | Quest progress emission on save (workout completed, minutes, PRs) | W | ambient |
| 60 | AI25 | Demographic starting-weight scaling (sex, age, activity — upper vs lower body separately) | AI | ambient |
| 60 | BE16 | pg_cron jobs: streak reminders, welcome-back, quest expiry, gauntlet reset, duel expiry, scheduled-workout reminders | BE | ambient |
| 60 | BE17 | pg_net HTTP dispatch to Edge Functions | BE | ambient |
| 60 | D18 | Stories row (top of Dashboard) | D | active |
| 60 | D48 | Quick actions: Log weight, Add progress photo, My Week, open Goals, etc. | D | active |
| 60 | GA27 | Loot catalog: ~60 branded items across common / uncommon / rare / epic / legendary / animated | GA | active |
| 60 | GA32 | Rarity visuals (per-rarity glow/border treatment) | GA | ambient |
| 60 | GA33 | User bag / inventory | GA | active |
| 60 | GA44 | Longest-streak records | GA | ambient |
| 60 | GA5 | XP tiers / tier badges | GA | ambient |
| 60 | HP3 | Hub profile page (own + others') | HP | active |
| 60 | HP6 | Avatar gradient fallback (deterministic per user) | HP | ambient |
| 60 | RS16 | Supabase CDN image transforms (edge resize/recompress) | RS | ambient |
| 60 | RS3 | App update prompt on new deploy | RS | active |
| 60 | SH19 | Red dot on the Marketplace icon when today's daily chest is unclaimed | SH | ambient |
| 60 | UI15 | Twemoji rendering for cross-platform emoji consistency | UI | ambient |
| 60 | UI19 | Text-case helper | UI | ambient |
| 60 | UI8 | UnitPill | UI | ambient |
| 60 | W30 | Rest timer overlay with voice cues (Web Speech API) | W | active |
| 55 | BE12 | Storage `uploads` bucket with per-uid path prefixes, MIME allowlist, 50 MB cap | BE | ambient |
| 55 | CP44 | Weekly leagues with six tiers: Bronze, Silver, Gold, Platinum, Diamond, Legend | CP | active |
| 55 | CP47 | Atomic league resolution + rewards (migrations 027, 067) | CP | ambient |
| 55 | D12 | Collapsible "Nutrition & Recovery" group | D | active |
| 55 | D13 | Collapsible "Your progress" group | D | active |
| 55 | D27 | League card + league standings modal (promotion/demotion zones, "Top N promoted / Bottom N demoted") | D | active |
| 55 | GA24 | Milestone/achievement capsules | GA | ambient |
| 55 | GA36 | 17 trophies across workout / streak / level / duel / crew / cardio, tiered bronze → legendary | GA | ambient |
| 55 | HP4 | Profile edit — display name, bio, city, avatar | HP | active |
| 55 | ON22 | Magic-link email sign-in | ON | active |
| 55 | ON5 | "Sharpen" step — goal-specific follow-up (race distance 5K/10K/Half/Marathon/General, target times for 1mi/5K/10K) | ON | active |
| 55 | P23 | Training-week aggregation | P | ambient |
| 55 | P24 | Workout volume + fatigue computation | P | ambient |
| 55 | P4 | Exercise progress cards (per-lift over time) | P | active |
| 55 | SE15 | Theme picker + theme selector (11 base themes + unlocked loot themes) | SE | active |
| 55 | SH16 | Unread dot on the Hub tab when a followed user posts something new; clears on visiting Hub | SH | ambient |
| 55 | ST1 | Stories row on Dashboard + Hub | ST | active |
| 55 | ST23 | Stories-row visibility rules (who earns a slot) | ST | ambient |
| 55 | UI12 | ThemedScope / theme scoping utility | UI | ambient |
| 55 | UI23 | Sound player with a named sound registry | UI | ambient |
| 55 | W24 | Workout name field + tag selector | W | active |
| 55 | W39 | Equipment thumbnail per exercise | W | ambient |
| 55 | W43 | Drawn equipment silhouettes (no manufacturer imagery, licence-safe) | W | ambient |
| 55 | W51 | PR celebration (confetti + haptic + toast) on estimated-1RM records | W | ambient |
| 55 | W63 | Regimens section — create, edit, delete, run | W | active |
| 50 | CP46 | Promotion / demotion zones with top-N / bottom-N callouts | CP | ambient |
| 50 | D30 | Workout suggestion card ("Next: …") | D | active |
| 50 | H1 | Three feed sub-tabs: Pump (global), Squad (following), Crews | H | active |
| 50 | H29 | Post view tracking (`hub_post_views`) | H | ambient |
| 50 | H37 | Realtime feed updates (`hubPostsRealtime`) | H | ambient |
| 50 | H43 | Atomic post counters (migrations 077, 200) | H | ambient |
| 50 | HP5 | Avatar uploader + crop | HP | active |
| 50 | P21 | Estimated 1RM (Epley) surfaced across the app | P | ambient |
| 50 | W65 | Regimen detail view | W | active |
| 45 | AI1 | Coach chat (`/coach`) — free-form conversation | AI | active |
| 45 | AI10 | Lightweight markdown rendering in chat | AI | ambient |
| 45 | AI14 | Workout generator with muscle-group balance, equipment awareness, set/rep prescription | AI | active |
| 45 | AI27 | Both surfaces (quick pick + chat) receive identical context | AI | ambient |
| 45 | AI29 | Disclaimer copy ("not a substitute for a coach if you have injuries") | AI | ambient |
| 45 | AI3 | Chat / Generate Workout tab split | AI | active |
| 45 | AI8 | Intent classification (`intents.js`) + responders | AI | ambient |
| 45 | BE18 | 6 Edge Functions: `send-push`, `recognize-meal`, `generateWeeklyDebriefs`, `checkout-session`, `friendRecapEmail`, `storage-gc` | BE | ambient |
| 45 | D14 | Collapsible quick-actions row with show-more/show-less | D | active |
| 45 | D21 | Streak calendar grid (show/hide toggle, "You trained on this day") | D | active |
| 45 | D32 | Goals progress strip | D | active |
| 45 | D35 | Hydration ring (tap → Nutrition) | D | active |
| 45 | D44 | iOS "Add to Home Screen" install banner | D | active |
| 45 | D49 | Log Weight modal (unit-aware, sanity warning on odd values) | D | active |
| 45 | G1 | Goals modal (browse + manage) | G | active |
| 45 | GA13 | Coin shop — Standard Capsule (100), Premium Capsule (350), Elite Capsule (1000), Streak Freeze (200) | GA | active |
| 45 | GA15 | Server-side price table (client sends only a SKU) | GA | ambient |
| 45 | GA30 | 27 unlockable app themes (Coral, Mint, Rose, Dusk, Tidal, Nebula, Ember, Aurora, Cyberpunk, Prism, Solar, Jade, Sunset, Arctic, Volcano, Galaxy, Zen, Abyss, Storm, Kingdom, Dragon, Mirage, Summit, Temple, Waterfall, Lunar, Enchanted) | GA | active |
| 45 | GA34 | Equip title / frame / theme | GA | active |
| 45 | HP1 | Follow / unfollow, "Follow back", mutual "You follow each other" | HP | active |
| 45 | HP12 | Profile completion meter with actionable prompts (add photo, write bio, add city, share a workout) | HP | ambient |
| 45 | HP8 | Profile lift stats (best lifts, est. 1RM, lifetime tonnage, longest streak) | HP | ambient |
| 45 | MK15 | Daily chest block inside the market | MK | active |
| 45 | N33 | Water tracker with per-glass logging + XP | N | active |
| 45 | N34 | Water bottle icon component + hydration ring on Dashboard | N | ambient |
| 45 | NT3 | Dedicated `/notifications` page with category filters: Social, Competitive, Achievements, System | NT | active |
| 45 | ON4 | Multi-goal selection (profiles blend rather than collapse to one) | ON | active |
| 45 | P13 | Workout calendar grid | P | active |
| 45 | P19 | Achievements tab | P | active |
| 45 | RS1 | Installable PWA (iOS / Android / desktop) | RS | active |
| 45 | RS25 | Pull-to-dismiss hook | RS | active |
| 45 | SE14 | Weight unit: lbs / kg / stone | SE | active |
| 45 | SE17 | Body stats editing: weight, height, age/date of birth, gender — all validated | SE | active |
| 45 | SH7 | Re-tapping the active tab resets that section to its root (closes sub-views/modals, scrolls to top) | SH | active |
| 45 | W18 | PR proximity bar ("New PR pace") per exercise | W | ambient |
| 45 | W27 | Repeat last workout (one tap from the last-workout card) | W | active |
| 45 | W64 | Regimen form with muscle-group selector + exercise autocomplete | W | active |
| 45 | WE14 | Hydration tracking + ring | WE | active |

---

## C-Tier — Regular (25–45%) · 177 features

A solid minority. Real features with real audiences, but not the spine.

| % | ID | Feature | Area | Kind |
|---|---|---|---|---|
| 42 | AI15 | Training modifiers engine — clamped `loadMultiplier` (0.8–1.1), `setsDelta` (±1), `repDelta` (−4…+6), `restDeltaSec` (−30…+60) | AI | ambient |
| 42 | AI17 | Goal-based modifiers, multi-goal averaging | AI | ambient |
| 42 | AI21 | Age-band modifiers | AI | ambient |
| 42 | AI4 | Coach plan card rendering a generated session | AI | active |
| 42 | G4 | Goal progress bars | G | ambient |
| 42 | G5 | Goals list | G | active |
| 40 | AI13 | Conversation persisted per device | AI | ambient |
| 40 | AI16 | Every modifier writes a human-readable note rendered on the plan card | AI | ambient |
| 40 | AI2 | Quick-pick workout generator (non-chat path) | AI | active |
| 40 | BE11 | Public profiles view with email-harvest protection | BE | ambient |
| 40 | C1 | Four activities: Walking, Running, Cycling, Swimming | C | active |
| 40 | C2 | Gendered activity emoji (matches the user's onboarding gender) | C | ambient |
| 40 | C29 | Distance-unit preference (mi / km) applied everywhere | C | active |
| 40 | CP49 | Leaderboards modal — all boards | CP | active |
| 40 | D29 | Weekly recap card + shareable Weekly Recap PNG card | D | active |
| 40 | D34 | Readiness card (compact + detail) | D | active |
| 40 | D45 | PWA install prompt (non-iOS) | D | active |
| 40 | G2 | Goal form — create strength / cardio / generic goals | G | active |
| 40 | G7 | Goals progress strip on Dashboard | G | ambient |
| 40 | GA28 | 20 unlockable titles | GA | active |
| 40 | H15 | Post reactions (like / dislike) | H | active |
| 40 | HP2 | Follower + following counts and lists | HP | active |
| 40 | HP20 | Follow suggestion rail (dismissible, "Hide suggestions for now") | HP | active |
| 40 | MK1 | Marketplace feed | MK | active |
| 40 | N1 | Manual meal logging (name, calories, macros) | N | active |
| 40 | N22 | Calorie top bar (eaten / remaining) | N | ambient |
| 40 | NF1 | Trainer Programs card on Market — "Coming Soon" placeholder | NF | active |
| 40 | P20 | Achievements vault | P | active |
| 40 | P22 | Progressive-overload suggestions | P | ambient |
| 40 | P5 | Grouped exercise trends | P | active |
| 40 | RS17 | Client image compression before upload | RS | ambient |
| 40 | RS23 | Optimistic delete hook | RS | ambient |
| 40 | SH23 | Floating back-to-top button after ~2 screen-heights of scroll | SH | active |
| 40 | SH8 | Re-tap also fires a `flexyn:active-tab-retap` event so feeds can treat it as a refresh | SH | ambient |
| 40 | ST2 | "Your Story" / "Add a story" entry | ST | active |
| 40 | W47 | Gym / Cardio sub-tab filter on the saved list | W | active |
| 40 | W5 | Bodyweight-exercise detection; "added weight" input instead of absolute | W | active |
| 38 | G10 | First-goal celebration (distinct signature) | G | ambient |
| 38 | G3 | Goal timeframes: weekly / monthly / lifetime | G | active |
| 38 | N2 | Meal-type picker: Breakfast / Lunch / Dinner / Snack, with auto-pick by time of day | N | active |
| 38 | N21 | First-meal celebration | N | ambient |
| 38 | N23 | Macro nutrient box (protein / carbs / fat) | N | active |
| 38 | N27 | Nutrition onboarding modal (goal, TDEE, targets) with base-TDEE display | N | active |
| 35 | C28 | Cardio XP with its own caps (migration 262) | C | ambient |
| 35 | C3 | Mode picker: Running / Walking / Biking | C | active |
| 35 | CP51 | Global rank | CP | ambient |
| 35 | CP56 | Leaderboard podium component | CP | ambient |
| 35 | D17 | Resume-workout banner for a paused session (+ discard with tap-to-confirm) | D | active |
| 35 | D31 | Workout memory card ("On this day…") | D | active |
| 35 | D33 | "Goals almost complete" nudge | D | active |
| 35 | D39 | Macro ring widget | D | active |
| 35 | D40 | Calorie progress widget ("cal remaining") | D | active |
| 35 | GA26 | Daily Flexyn Drop — 3 deterministic rotating items per calendar day | GA | active |
| 35 | GA29 | 11 profile frames | GA | active |
| 35 | H35 | Image expand / collapse | H | active |
| 35 | H41 | Equipped title + frame rendered on the author row | H | ambient |
| 35 | HP19 | People You May Know rail | HP | active |
| 35 | MK3 | Listing card + item detail sheet | MK | active |
| 35 | ON13 | Home-gym picker step (deferred — writes only at final save) | ON | active |
| 35 | ON20 | 7-day onboarding nudge push sequence | ON | ambient |
| 35 | ON24 | Google OAuth sign-in | ON | active |
| 35 | P14 | PR history modal | P | active |
| 35 | SE29 | Sign out (with confirm) | SE | active |
| 35 | ST11 | Story viewer with tap-through + progress bars | ST | active |
| 35 | ST22 | 24h hard delete (migration 233) | ST | ambient |
| 35 | UI5 | CharCountIndicator | UI | ambient |
| 35 | W31 | Audio cue on workout complete (spoken) | W | ambient |
| 35 | W7 | Per-set overflow menu (delete set, more options) | W | active |
| 35 | W73 | Seed regimen sets from history (`seedRegimenSets`) | W | ambient |
| 35 | WE10 | Readiness tiers: Primed / Ready / Moderate / Tired / Depleted | WE | ambient |
| 35 | WE9 | Recovery score — weighted sleep 40% / quality 20% / soreness 25% / recency 15% | WE | ambient |
| 32 | C11 | Manual cardio form (duration, distance, calories) | C | active |
| 32 | N24 | Nutrient rings + ring-vs-bar view toggle setting | N | active |
| 30 | AD13 | Verified-user badge system | AD | ambient |
| 30 | AI9 | Follow-up question generation | AI | active |
| 30 | C18 | Cardio calorie estimation | C | ambient |
| 30 | C23 | Cardio saved list + detail modal | C | active |
| 30 | C4 | Environment picker: Outside (GPS) vs Stationary / Treadmill | C | active |
| 30 | C5 | Input picker: manual entry vs live tracking | C | active |
| 30 | CP45 | Monthly leagues (migration 132) | CP | active |
| 30 | CP48 | League promoted / demoted / held push notifications, i18n | CP | ambient |
| 30 | CP57 | "Around me" leaderboard slice | CP | active |
| 30 | CR1 | Crews section on the Hub | CR | active |
| 30 | D52 | Sync status footer (last-updated timestamp, "Synced") | D | ambient |
| 30 | FC7 | Entry point from Dashboard discovery card + Workout page ("Try Form Coach") | FC | active |
| 30 | G11 | Goal completion XP reward (100 XP) | G | ambient |
| 30 | G8 | Atomic server-side goal completion (migration 030) | G | ambient |
| 30 | GA14 | "Best value" marker computed from cost-per-epic-or-better | GA | ambient |
| 30 | GA38 | Achievements flow + share-achievement card | GA | active |
| 30 | GA42 | Quest expiry warning cron (every 15 min) | GA | ambient |
| 30 | GA48 | Streak-break reminder cron in the user's local 18–21h, 15 languages | GA | ambient |
| 30 | GY1 | My Gym page — declare the one gym you actually train at | GY | active |
| 30 | GY2 | Home-gym picker with tap-to-save (no confirm step) | GY | active |
| 30 | H2 | Activity view (likes/follows/comments) in the header corner | H | active |
| 30 | H39 | Verified-admin badge on posts | H | ambient |
| 30 | H40 | Signature trophy shown next to the author name | H | ambient |
| 30 | HP10 | Trophy case (show/hide toggle) | HP | active |
| 30 | HP18 | Active-now / last-active indicator | HP | ambient |
| 30 | HP26 | Hub search overlay (users, by name/handle) | HP | active |
| 30 | HP9 | Profile badge showcase | HP | ambient |
| 30 | M1 | Messages page with DMs / Crews tabs | M | active |
| 30 | MK14 | Today rail (daily drop block) | MK | active |
| 30 | N20 | Delete a logged entry; clear all for the day | N | active |
| 30 | N8 | USDA + Spoonacular food lookup | N | ambient |
| 30 | NT10 | Web push via VAPID (`send-push` Edge Function) | NT | ambient |
| 30 | NT11 | Batched push fanout trigger (migration 222) | NT | ambient |
| 30 | NT12 | 410-Gone subscription cleanup | NT | ambient |
| 30 | NT20 | 15-language server-side notification text helpers | NT | ambient |
| 30 | NT9 | Push opt-in / opt-out from Settings, with browser-blocked state | NT | active |
| 30 | ON21 | Onboarding state persisted per device (`flexyn.onboardingState.<userId>`) | ON | ambient |
| 30 | ON23 | Apple OAuth sign-in | ON | active |
| 30 | P11 | Insights tab (derived observations) | P | active |
| 30 | P15 | Body metrics tab — weight, body fat %, and 7 measurements (chest, waist, arms, thighs, …) | P | active |
| 30 | P25 | Global rank hook | P | ambient |
| 30 | P7 | Filter by time range: 7 / 30 / 90 / 365 days | P | active |
| 30 | P9 | Muscle-group heatmap (anatomical) | P | active |
| 30 | RS27 | Form draft persistence hook | RS | ambient |
| 30 | RS5 | Custom push service worker (`push-sw.js`) | RS | ambient |
| 30 | SE16 | Language picker (15 languages) with RTL for Arabic | SE | active |
| 30 | SE3 | Toggle: Workout reminders | SE | active |
| 30 | SH18 | DM unread count badge (9+ cap) on Messages icon, sidebar + header | SH | ambient |
| 30 | SH21 | Header title override channel (`flexyn-title` event) used by Cardio mode | SH | ambient |
| 30 | UI21 | Safe-URL helper | UI | ambient |
| 30 | W15 | Drag-to-reorder exercises within a session | W | active |
| 30 | W28 | Repeat any past workout from the saved list | W | active |
| 30 | W36 | Comeback protocol screen after a long layoff | W | active |
| 30 | W48 | Edit a saved workout (`EditWorkoutModal`) | W | active |
| 30 | W54 | Pending-workout recovery (crash/refresh restores an in-progress session) | W | ambient |
| 30 | W66 | Built-in program templates (Starting Strength, 5/3/1 Wendler, Push/Pull/Legs, and more) | W | active |
| 30 | W67 | Program template picker ("Proven programming. Tap a card to get started.") | W | active |
| 28 | G9 | Goal completion celebration (confetti + haptic + 🏆) | G | ambient |
| 28 | M25 | Unread count badge + per-conversation unread | M | ambient |
| 25 | AI24 | "How do you feel today?" check-in that overrides predicted phase | AI | active |
| 25 | AI6 | Save generated plan to Regimens | AI | active |
| 25 | AI7 | Start generated plan live | AI | active |
| 25 | CP52 | Friend leaderboard (3 sort modes) | CP | active |
| 25 | CP55 | Time-window / period leaderboards | CP | active |
| 25 | D28 | Friend leaderboard panel (this week) | D | active |
| 25 | D37 | Sleep log card (hours slept) | D | active |
| 25 | D51 | Routine calendar modal ("My Week") | D | active |
| 25 | G6 | "Almost complete" nudge card | G | ambient |
| 25 | GA18 | Capsule rarity-odds transparency panel ("{epic}% epic+ · {legendary}% legendary+") | GA | active |
| 25 | GA22 | Capsule streak card | GA | ambient |
| 25 | GA31 | Collection modal — everything in the game and what you're still missing | GA | active |
| 25 | GY3 | Nearby gym picker via OpenStreetMap Overpass | GY | active |
| 25 | GY4 | Multi-mirror Overpass fetch with failure-aware error reporting (never renders an outage as "no gyms found") | GY | ambient |
| 25 | H17 | Comments, inline on the card | H | active |
| 25 | H38 | Post activity block (who reacted / commented) | H | ambient |
| 25 | HP22 | Follower activity banner ("N friends joined", "N friends training") | HP | ambient |
| 25 | HP23 | Live activity rail — friends working out right now | HP | active |
| 25 | HP25 | Friend leaderboard panel (3 sort modes) | HP | active |
| 25 | I18-1 | 15 languages: en, es, fr, de, pt, it, ja, ko, zh, ar, hi, ru, tr, pl, nl | I18 | active |
| 25 | I18-7 | Server-side notification text in all 15 languages | I18 | ambient |
| 25 | M11 | Text messages | M | active |
| 25 | M2 | Inbox / Requests / Archived views | M | active |
| 25 | M35 | Conversation date separators ("Today at", "Yesterday at") | M | ambient |
| 25 | MK4 | Buy confirm dialog, atomic purchase RPC (migration 025) | MK | active |
| 25 | N3 | Barcode scanner (@zxing) with multi-orientation decode | N | active |
| 25 | N7 | Open Food Facts lookup | N | ambient |
| 25 | NT13 | Streak-break reminder cron (local 18–21h, 15 languages) | NT | ambient |
| 25 | NT6 | 7 push categories with per-category toggles: streak, quests, league, social, achievements, engagement, competitive | NT | active |
| 25 | ON12 | Injury history step with severity tiers (Mild / Moderate / Serious) | ON | active |
| 25 | P12 | Training pattern card ("You usually train Mon/Wed/Fri at 6:30 PM") | P | ambient |
| 25 | RS21 | Network status detection | RS | ambient |
| 25 | RS24 | Swipe-to-delete hook | RS | active |
| 25 | RS4 | Stale-deploy guard (recovers from missing hashed chunks after a deploy) | RS | ambient |
| 25 | SE13 | Distance unit: mi / km | SE | active |
| 25 | SE2 | Toggle: In-app alerts | SE | active |
| 25 | SE5 | Toggle: Rest timer | SE | active |
| 25 | SH29 | Network status chip (offline/online) | SH | ambient |
| 25 | UI20 | Highlight-matches helper (search result highlighting) | UI | ambient |
| 25 | W21 | Plate calculator modal + plate diagram, bar-weight selector | W | active |
| 25 | W33 | Realistic-limits guard (max weight / reps / duration per exercise) | W | ambient |
| 25 | W38 | Exercise form modal (form cues per lift) | W | active |
| 25 | W76 | Routines — "My Routine" sheet, today's routine card, routine calendar modal | W | active |
| 25 | WE11 | Readiness hook consumed by the Coach | WE | ambient |
| 25 | WE7 | Sleep logging (hours + quality) | WE | active |

---

## D-Tier — Occasional (10–25%) · 197 features

One in six or fewer. Worth keeping if cheap; first place to look for cuts.

| % | ID | Feature | Area | Kind |
|---|---|---|---|---|
| 22 | BE13 | Progress-photos bucket | BE | ambient |
| 22 | D1 | "Customize home" edit mode | D | active |
| 22 | D36 | Mood log card (how are you feeling today) | D | active |
| 22 | D50 | Progress photo capture modal (camera + flip + close) | D | active |
| 22 | D6 | Layout syncs cross-device via `user_profiles.dashboard_layout` (localStorage is the fast-paint path) | D | ambient |
| 22 | GY21 | National gym map (MapLibre, free OpenFreeMap tiles) | GY | active |
| 22 | GY22 | Debounced bbox queries as you pan | GY | ambient |
| 22 | GY23 | Three map tiers by shape/color: purple bubble = verified business, grey bubble = community gym, grey teardrop = unclaimed OSM result | GY | ambient |
| 22 | H16 | Emoji reactions on posts (migration 126) | H | active |
| 22 | I18-6 | Muscle-group translations | I18 | ambient |
| 22 | M22 | Typing indicators | M | ambient |
| 22 | M23 | Delivery status ticks: Sent / Delivered / Read | M | ambient |
| 22 | N12 | Photo-AI meal recognition (Claude Vision via `recognize-meal` Edge Function) | N | active |
| 22 | N19 | Meal history modal + re-log from history | N | active |
| 22 | N32 | Nutrition stats: avg cal/day, days logged, meals logged | N | ambient |
| 22 | N4 | Barcode result modal + "not found" modal with add-your-own path | N | active |
| 22 | P17 | Progress photos tab with capture | P | active |
| 22 | SE12 | Toggle: Sound effects | SE | active |
| 22 | W10 | Superset grouping | W | active |
| 22 | WE6 | Mood logging (Dashboard card + data layer) | WE | active |
| 20 | AD11 | Client + server profanity filters (username, bio, posts, comments, listings, quotes, food names) | AD | ambient |
| 20 | AI18 | Nutrition-goal modifiers (cut removes a set, keeps load; bulk adds a set) | AI | ambient |
| 20 | BE14 | Storage delete-safety SELECT policy | BE | ambient |
| 20 | C13 | Pace calculation and display (per km / per mi, unit-aware) | C | ambient |
| 20 | CP33 | Weekly AI-matched rival ("Find Your Rival") | CP | active |
| 20 | CP34 | Rival card + rival menu on the Workout page | CP | active |
| 20 | CP50 | Regional leaderboards modal | CP | active |
| 20 | CR4 | Crew discovery + suggested-crews rail | CR | active |
| 20 | D22 | Streak rescue card — one-tap save on a missed day, once per month | D | active |
| 20 | D38 | Steps log card (manual entry, edit) | D | active |
| 20 | D8 | Widget Library — add/remove optional widgets, browsable by category | D | active |
| 20 | D9 | 10 widget definitions: Exercise Trends, Weekly Volume, Muscle Groups, Personal Bests, Recent Workout, Goals Progress, Workout Streak, Top Exercises, Stats Slideshow, Journal | D | active |
| 20 | GA19 | Pity system — guaranteed rarity after N opens, with personal open history | GA | ambient |
| 20 | GA46 | Streak rescue (once/month) | GA | active |
| 20 | GY25 | 25 seeded demo gyms across US metros | GY | ambient |
| 20 | GY5 | Picking an OSM gym promotes it to a persistent community gym | GY | ambient |
| 20 | H34 | Video autoplay with mute/unmute toggle | H | active |
| 20 | HP21 | Recently viewed rail | HP | ambient |
| 20 | HP7 | Country picker (full ISO list) on profile | HP | active |
| 20 | I18-5 | Exercise-name translations | I18 | ambient |
| 20 | MK10 | "Sold N times" counters | MK | ambient |
| 20 | MK22 | Collection browser ("Browse every item") | MK | active |
| 20 | MK8 | Featured weekly slot | MK | ambient |
| 20 | N13 | Food photo capture modal + library picker | N | active |
| 20 | N14 | Photo-AI result modal with editable macros | N | active |
| 20 | N16 | Image compression before upload; "too large even after compression" handling | N | ambient |
| 20 | N18 | Saved meals — save any logged meal, re-log with one tap | N | active |
| 20 | N28 | Nutrition plans modal (preset target plans) | N | active |
| 20 | N31 | Nutrition trends chart | N | active |
| 20 | NF15 | Owner equipment controls never render on the 25 demo gyms (they have no owner) — correct behavior | NF | ambient |
| 20 | NF8 | Bio profanity check is client-only (username is server-checked) | NF | ambient |
| 20 | NT14 | Welcome-back cron (3–30 day churned users, hourly) | NT | ambient |
| 20 | NT15 | Quest-expiry cron (every 15 min) | NT | ambient |
| 20 | NT4 | Clear all | NT | active |
| 20 | P10 | Advanced analytics panel | P | active |
| 20 | P16 | Muscle diagram + muscle details modal | P | active |
| 20 | P8 | Filter by muscle group | P | active |
| 20 | SE11 | Toggle: Haptic feedback (with unsupported-device message) | SE | active |
| 20 | SH17 | Desktop sidebar (lg+): logo, profile menu, AI Coach / Messages / Notifications / Marketplace buttons, nav list, language picker | SH | active |
| 20 | ST12 | Story likes | ST | active |
| 20 | W19 | Set-input text parsing (`parseSetInput`) — e.g. "100x5" | W | active |
| 20 | W37 | Injury banner + injury form (severity tiers, synergist muscle exclusion) | W | active |
| 20 | W69 | Regimen template store (community-published regimens) | W | active |
| 20 | WE8 | Step logging (manual entry) | WE | active |
| 18 | D10 | 6 widget categories: analytics, summary, achievements, goals, motivation, wellbeing | D | active |
| 18 | GY6 | Gym leaderboard ranked by consistency (active days in the last 7) | GY | active |
| 18 | H3 | Composer — text posts | H | active |
| 18 | H42 | Server-side profanity check on post bodies | H | ambient |
| 18 | W14 | "Complete group" for a superset/circuit block | W | active |
| 18 | W6 | Per-set note field | W | active |
| 18 | W68 | Workout templates modal (your saved templates) | W | active |
| 16 | CP37 | Weekly settlement — won / lost / draw | CP | ambient |
| 16 | H4 | Composer — workout share (auto-populated from a logged session) | H | active |
| 15 | AI19 | Weekly rate-of-change modifier | AI | ambient |
| 15 | AI26 | Injury-driven muscle-group exclusion passed into the generator | AI | ambient |
| 15 | C25 | Repeat last cardio session | C | active |
| 15 | C6 | Live outdoor tracker with GPS (`CardioLiveTrackerOutside`) | C | active |
| 15 | CP25 | 10-challenge Gauntlet path with sequential unlocks | CP | active |
| 15 | CP35 | Challenge types picker | CP | active |
| 15 | CP36 | Accept / decline a rival challenge, AFK confirmation handling | CP | active |
| 15 | CP53 | Gym consistency leaderboard | CP | active |
| 15 | D2 | Drag-to-reorder any dashboard row (Framer Reorder) | D | active |
| 15 | D41 | Journal widget (inline day entry) | D | active |
| 15 | GA21 | Capsule recovery — auto-grants loot that was rolled but never handed over | GA | ambient |
| 15 | GA37 | Signature trophy (primary slot on the profile banner) | GA | active |
| 15 | GA45 | Streak freeze item | GA | active |
| 15 | GY24 | Search gyms by name / city | GY | active |
| 15 | GY8 | My Gyms page — all gyms you belong to | GY | active |
| 15 | H20 | Comment likes | H | active |
| 15 | HP11 | Primary/signature trophy slot ("Slot 1 shows on your profile banner") | HP | active |
| 15 | HP17 | "Training together since {month}" | HP | ambient |
| 15 | HP32 | Referral card + referral sheet — invite code, copy link, share, redeem a code, lifetime referral count | HP | active |
| 15 | M4 | Auto-accept requests from people you follow (migration 235) | M | ambient |
| 15 | MK13 | Recently-viewed listings rail | MK | ambient |
| 15 | MK6 | Filter bar — muscle group, difficulty, type | MK | active |
| 15 | N25 | Minerals & vitamins box (calcium, magnesium, potassium, fiber, cholesterol, …) | N | active |
| 15 | NT5 | Delete a single notification | NT | active |
| 15 | P6 | Filter by regimen | P | active |
| 15 | RS26 | Long-press hook | RS | active |
| 15 | SE31 | Twemoji attribution credit | SE | ambient |
| 15 | UI24 | Download-media helper (share API + download fallback chain) | UI | ambient |
| 15 | UI7 | TapToCopy | UI | active |
| 15 | W26 | Save current session as a reusable template | W | active |
| 15 | W35 | Deload-opportunity detector | W | ambient |
| 15 | W70 | Regimen store page with difficulty + muscle-group filters | W | active |
| 15 | WE1 | Daily journal — titled entry per day, autosave | WE | active |
| 14 | CP23 | Solo challenges section with Easy / Medium / Hard tiers | CP | active |
| 14 | CP26 | Challenge categories: Single Session, Weekly Volume, Personal Record, Streak, Nutrition, Final Boss | CP | active |
| 14 | CP38 | Rival win/loss record | CP | ambient |
| 14 | CP43 | Rival-assigned push notification | CP | ambient |
| 14 | D3 | Hide any section; hidden sections show as "Hidden — tap to restore" chips | D | active |
| 14 | FC1 | On-device pose analysis (TF.js MoveNet) — no upload, runs on the phone | FC | active |
| 14 | FC4 | Rule-based form scoring (`formCoach/rules.js`, `geometry.js`) | FC | ambient |
| 14 | FC5 | Feedback panel with per-rep cues | FC | active |
| 14 | GY13 | Gym Hub page per gym: Feed / Events / Leaderboard / Equipment / About tabs | GY | active |
| 13 | CP24 | Claim a challenge, track progress, collect reward | CP | active |
| 13 | FC3 | Exercise picker (4 supported lifts) | FC | active |
| 12 | AI20 | Dietary-restriction / allergen-filtered fuel notes (never names a food you can't eat) | AI | ambient |
| 12 | C17 | Cardio PRs | C | ambient |
| 12 | C21 | Cardio goals (with onboarding-set cardio goal) | C | active |
| 12 | C7 | Live indoor tracker (`CardioLiveTrackerIndoor`) | C | active |
| 12 | CP1 | Duels page — active, history, win/loss/tie record (W / L / TIE) | CP | active |
| 12 | CP14 | Bounty board | CP | active |
| 12 | CP27 | Submit a score against a challenge | CP | active |
| 12 | CP29 | Weekly community gauntlet card | CP | active |
| 12 | CP31 | Server-side gauntlet validation (migration 201) | CP | ambient |
| 12 | CR10 | Crew page (roster, stats, chat) | CR | active |
| 12 | CR7 | One crew per user (migration 252) | CR | ambient |
| 12 | DB1 | Weekly debrief card | DB | active |
| 12 | GA4 | Level animations toggle in Settings | GA | active |
| 12 | GY11 | Gym check-in (+XP multiplier on that day's workout) | GY | active |
| 12 | GY17 | Gym About card — hours, amenities, photo gallery, contact | GY | active |
| 12 | GY18 | 20 amenity types (parking, showers, lockers, sauna, steam room, cardio zone, free weights, squat racks, platform, classes, yoga studio, pool, PT, childcare, juice bar, wifi, outdoor space, combat/MMA, climbing, …) | GY | ambient |
| 12 | GY20 | Gym leaderboard tabs: Consistency / Volume / Streak | GY | active |
| 12 | GY7 | Community progress aggregate (members-only) | GY | active |
| 12 | H14 | Post privacy: Public vs Followers-only | H | active |
| 12 | H18 | Threaded replies | H | active |
| 12 | H26 | Delete your own post | H | active |
| 12 | HP14 | Share profile / copy profile link | HP | active |
| 12 | HP28 | Private-profile mode (only followers see level, workouts, photos) | HP | active |
| 12 | M12 | Image attachments | M | active |
| 12 | M26 | Load earlier messages (pagination) | M | active |
| 12 | M3 | Message requests — accept, delete, block, unsend (with confirm steps) | M | active |
| 12 | MK7 | Bundles / bundle deals | MK | active |
| 12 | N10 | Save a new food item for reuse | N | active |
| 12 | N5 | Barcode hints ("rotate a shiny can to cut glare", reads sideways codes) | N | ambient |
| 12 | NF3 | Connected Apps (Apple Health / Google Fit / Strava) — UI only, no sync | NF | active |
| 12 | ON31 | Referral code capture pre-signup (`flexyn.pendingReferralCode`) | ON | active |
| 12 | RS10 | Error recovery affordances: Go to Home / Try again / Copy details / auto-reset on route change | RS | active |
| 12 | SE10 | Toggle: Include bar weight in volume | SE | active |
| 12 | SE19 | Privacy: private profile | SE | active |
| 12 | SE26 | Connected apps section: Apple Health, Google Fit, Strava `[stub]` | SE | active |
| 12 | SE6 | Toggle: Level animations | SE | active |
| 12 | SH9 | Long-press (400 ms) any tab → quick-action popover, anchored above that exact tab | SH | active |
| 12 | ST13 | Story emoji reactions (reaction picker) | ST | active |
| 12 | ST18 | Story highlights rail on the profile | ST | active |
| 12 | ST24 | Story viewers list | ST | active |
| 12 | ST3 | Photo stories | ST | active |
| 12 | ST5 | Story preview sheet before posting | ST | active |
| 12 | ST8 | Story overlay renderer | ST | ambient |
| 12 | W11 | Circuit grouping | W | active |
| 12 | W23 | "Include bar weight in volume" setting | W | active |
| 12 | W32 | Gym check-in XP multiplier applied when checked in | W | active |
| 12 | W49 | Workout share card (PNG, purple/fuchsia) — share sheet + download fallback | W | active |
| 12 | W62 | Scheduled workouts — pin a session to a local day + hour; hourly cron reminder; `/workout?scheduled=<id>` deep link loads it | W | active |
| 12 | W72 | Regimen fork / adopt ("Adopt") with copy-count tracking | W | active |
| 11 | CP15 | Auto-generated bounties from your own records | CP | ambient |
| 10 | AI5 | "Schedule it" on the plan card → `scheduled_workouts` | AI | active |
| 10 | BE21 | Guest-user support paths throughout | BE | ambient |
| 10 | C14 | Heart-rate capture + HR zones (migration 094) | C | active |
| 10 | C8 | Route map rendering of a GPS track | C | ambient |
| 10 | CP2 | Three duel types: Open (most total volume), Mirror (same workout, best completion), Exercise (head-to-head on one lift) | CP | active |
| 10 | CP30 | Weekly gauntlet reset cron + start-of-gauntlet push fanout | CP | ambient |
| 10 | CP41 | "Find a new rival" | CP | active |
| 10 | CR12 | Crew member dots (presence) | CR | ambient |
| 10 | FC2 | Camera view with front/back flip | FC | active |
| 10 | FC6 | Demo section showing correct form | FC | active |
| 10 | GY36 | Gym equipment tab — the gym's floor, unioned across every member's training space | GY | active |
| 10 | H22 | Save / unsave a post | H | active |
| 10 | HP15 | Public profile route `/@username` (works signed-out) | HP | active |
| 10 | M17 | Emoji reactions on DM messages | M | active |
| 10 | MK11 | Star ratings + reviews on regimens | MK | active |
| 10 | N11 | Food-name profanity check | N | ambient |
| 10 | N26 | Net carbs | N | active |
| 10 | N35 | Intermittent fasting tracker — start/end fast, eating-window state, 1–48h duration validation | N | active |
| 10 | N37 | Recipes hub modal — My Recipes / Discover / Most popular tabs | N | active |
| 10 | N9 | Community food items (user-submitted, migration 175) | N | active |
| 10 | NF13 | Deliberately NOT pushed: individual gauntlet-challenge completions, crew-challenge 25/50/75% milestones, crew-challenge expiry-without-goal, "you got dethroned" to the overthrown rival | NF | ambient |
| 10 | NT16 | Scheduled-workout reminder cron (hourly, 12h staleness cutoff → `missed`) | NT | ambient |
| 10 | NT17 | Weekly gauntlet start fanout cron | NT | ambient |
| 10 | NT19 | `workout_reminder` deliberately unmapped so it always delivers | NT | ambient |
| 10 | ON25 | Guest / anonymous sign-in | ON | active |
| 10 | P18 | Photo compare slider (before/after) | P | active |
| 10 | SE7 | Toggle: Nutrient ring view | SE | active |
| 10 | W40 | Implement picker — record the exact machine/model used (brand + type + model) | W | active |
| 10 | WE3 | Journal history modal (browse past days) | WE | active |
| 10 | WE4 | Journal mood score (migration 165) | WE | active |

---

## E-Tier — Niche (3–10%) · 209 features

Small dedicated slice. Justify each one individually — some are load-bearing for the people who use them.

| % | ID | Feature | Area | Kind |
|---|---|---|---|---|
| 9 | CP10 | Atomic duel submission (migration 079) | CP | ambient |
| 9 | CP11 | Duel expiry cron (migration 166) | CP | ambient |
| 9 | CP18 | Three difficulty tiers (Easy / Medium / Hard) with scaled rewards | CP | ambient |
| 9 | CP8 | Duel detail sheet with live scoring | CP | active |
| 9 | CP9 | Server-authoritative duel scoring (migration 202) | CP | ambient |
| 9 | CR13 | Crew chat with message reactions | CR | active |
| 9 | D4 | Per-section layout toggle: stack full-width vs pair side-by-side | D | active |
| 8 | C10 | Auto-pause setting for live cardio | C | active |
| 8 | C12 | Split/segment logging — add split, remove split, per-split duration + distance | C | active |
| 8 | C19 | Cardio limits / sanity guards | C | ambient |
| 8 | C20 | Cardio templates | C | active |
| 8 | C22 | Planned cardio (`CardioPlanned`) | C | active |
| 8 | CP17 | Metrics: weekly volume, session volume, single-lift weight, single-lift reps | CP | active |
| 8 | CP20 | Claim → progress → beat flow, checked on every workout save | CP | active |
| 8 | CP22 | Bounty economy integrity guards (migration 152) | CP | ambient |
| 8 | CP28 | Gauntlet stats modal | CP | active |
| 8 | CP39 | Overthrow flow + overthrow count | CP | active |
| 8 | CR11 | Crew member directory | CR | active |
| 8 | CR14 | Crew stats panel | CR | active |
| 8 | DB2 | Debrief vault (past debriefs, lazy-loaded) | DB | active |
| 8 | GY14 | Gym feed with reactions, comments, pinned posts, image upload | GY | active |
| 8 | GY19 | Member directory modal | GY | active |
| 8 | H19 | @mentions in comments | H | active |
| 8 | H24 | Share post (share sheet + copy link) | H | active |
| 8 | H25 | Edit your own post ("edited" marker) | H | active |
| 8 | H9 | Composer — achievement share | H | active |
| 8 | HP13 | Profile share card (PNG) | HP | active |
| 8 | HP27 | Status notes — short blurb on your avatar in the stories tray, with likes | HP | active |
| 8 | HP33 | Referral reward: 200 coins + Elite capsule for both parties | HP | active |
| 8 | HP34 | Referral cap / anti-abuse (migration 205) | HP | ambient |
| 8 | M14 | GIF picker (Tenor) | M | active |
| 8 | M21 | Delete a message (unsend) | M | active |
| 8 | M6 | Conversation search (by name or message) | M | active |
| 8 | MK2 | List an item for sale (stickers, regimens) | MK | active |
| 8 | MK21 | Listing profanity check | MK | ambient |
| 8 | MK9 | Wishlist / save-for-later | MK | active |
| 8 | N15 | Photo-AI daily quota (cap 3/day) + limit modal + owner exemption | N | active |
| 8 | N39 | Weekly meal planner grid | N | active |
| 8 | N42 | Nutrition tab reorder / customize (same edit-mode pattern as Dashboard) | N | active |
| 8 | N6 | Torch/flashlight toggle in the scanner | N | active |
| 8 | NF10 | i18n gaps: ~128 keys missing in Arabic / Chinese / Russian; discovery cards + ~21 Hub keys English-only on 8 of 15 languages; `recap.*` keys English-only | NF | ambient |
| 8 | NT8 | Quiet hours (do-not-disturb window) | NT | active |
| 8 | ON19 | Onboarding error surface (`onboardingErrors.js`) | ON | ambient |
| 8 | ON26 | "Sign in to continue" interstitial page for gated public links | ON | active |
| 8 | RS30 | Reduced-motion respect throughout | RS | ambient |
| 8 | SE4 | Toggle: Cardio auto-pause | SE | active |
| 8 | SE9 | Toggle: Cycle tracking | SE | active |
| 8 | SH10 | Quick actions — Workout: Quick log / Open cardio / Open goals | SH | active |
| 8 | SH31 | Page-not-found route | SH | ambient |
| 8 | ST14 | DM reply to a story ("Reply sent!") | ST | active |
| 8 | ST20 | Delete your own story | ST | active |
| 8 | ST6 | Text overlays with multiple fonts (Figtree, Caveat, Bradley Hand, Comic Sans MS, Chalkboard SE, Times New Roman) | ST | active |
| 8 | W22 | Configurable barbell inventory (Olympic 45, women's 35, EZ-curl, trap bar, etc.) | W | active |
| 8 | W34 | Implausible-workout detection (sets-per-exercise + muscle-group caps) | W | ambient |
| 8 | W41 | Recent-implements memory (leads the dropdown with your real gear) | W | ambient |
| 8 | W50 | PR share card (PNG, gold/crimson) | W | active |
| 8 | W58 | Crew war + crew challenge progress sync on save | W | ambient |
| 8 | W60 | Gauntlet progress check on save | W | ambient |
| 8 | WE12 | Cycle tracker card — log period, edit, delete, duplicate guard | WE | active |
| 7 | C16 | VO2max estimate | C | ambient |
| 7 | C9 | "GPS signal weak" warning state | C | ambient |
| 7 | CP12 | Duel invite + result push notifications | CP | ambient |
| 7 | CP19 | Pay-to-claim + escrow (migration 205) | CP | active |
| 7 | CP3 | Create duel against a followed user | CP | active |
| 7 | CP54 | Crew league standings | CP | active |
| 7 | CP7 | Configurable duel window (24h / 72h) | CP | active |
| 7 | CR15 | Crew league panel + standings | CR | active |
| 7 | H7 | Composer — progress photo post | H | active |
| 7 | M15 | Sticker picker + sticker display | M | active |
| 7 | N36 | Recipe builder modal (ingredients, directions, image) | N | active |
| 7 | N41 | Meal plan day picker | N | active |
| 7 | WE13 | Cycle phase computation, opt-in only, owner-only RLS | WE | ambient |
| 6 | AI22 | Cycle-phase modifier (deliberately weak: ≤5% load, never blocks a session, overridden by the daily check-in) | AI | ambient |
| 6 | C26 | Session recovery dialog ("recover or discard" an interrupted session) | C | active |
| 6 | C30 | Running fueling model + pace model (`lib/running/`) | C | ambient |
| 6 | CP40 | Cardio Rival variant | CP | active |
| 6 | CR16 | Crew seasons + divisions (migration 248) | CR | active |
| 6 | CR17 | Crew wars — matchmaking, multi-metric scoring, contribution tracking, resolution | CR | active |
| 6 | CR19 | Crew war XP clamp (anti-inflation) | CR | ambient |
| 6 | D26 | Custom quotes modal — add / delete your own quotes, author field, profanity-checked | D | active |
| 6 | GY41 | Equipment brand catalog (~25 brands: Life Fitness, Hammer Strength, Cybex, Technogym, Precor, Matrix, Nautilus, Atlantis, Arsenal, PRIME, Panatta, gym80, Watson, Rogue, Eleiko, REP, Titan, Bowflex, PowerBlock, Ironmaster, NÜOBELL, NordicTrack, Force USA, Tonal, Other, Don't know) | GY | ambient |
| 6 | GY42 | Implement-type catalog (~40 types across machine / cable / free-weight kinds) | GY | ambient |
| 6 | GY43 | ~50 seed equipment models as a client-side vocabulary | GY | ambient |
| 6 | GY9 | Join a gym by 8-char Flexyn code | GY | active |
| 6 | H21 | Repost to your own feed | H | active |
| 6 | H27 | Post analytics for the author (views, engagement) | H | active |
| 6 | H5 | Composer — freestyle workout post | H | active |
| 6 | HP29 | Hide-from-search mode | HP | active |
| 6 | M16 | Sticker reactions with variants | M | active |
| 6 | M18 | Quote-reply to a message | M | active |
| 6 | M27 | Group DMs — create group, name it, member list | M | active |
| 6 | N29 | Calorie cycling — separate training-day vs rest-day targets, auto-selected by whether a workout was logged | N | active |
| 6 | N40 | Grocery list generation from the planner + copy-to-clipboard | N | active |
| 6 | NF14 | `equipment_models` table is empty by design — the 50 seed models are a client-side vocabulary; the table fills from user submissions only | NF | ambient |
| 6 | SE18 | Story settings: allow DM replies, default visibility (Friends / Public) | SE | active |
| 6 | SE20 | Privacy: hide from search | SE | active |
| 6 | SE8 | Toggle: Calorie cycling | SE | active |
| 6 | SH13 | Quick actions — Nutrition: Log meal / Scan barcode / Add water | SH | active |
| 6 | ST7 | Overlay styles: Normal / Bright / Casual / Pixel | ST | active |
| 6 | TR7 | Trainer Market — browse published programs | TR | active |
| 6 | W20 | Voice input for set logging — dictate "100 by 5", "Heard: …" confirmation, stop-listening, mic-permission error handling | W | active |
| 6 | W44 | Equipment ladder snapping — progressive-overload suggestions land on selectable weights | W | ambient |
| 6 | W59 | Bounty claim progress check on save | W | ambient |
| 6 | W61 | Duel progress submission on save | W | ambient |
| 6 | W71 | Regimen reviews + star ratings | W | active |
| 5 | AD7 | Bug report dialog (in-app) with admin pipeline | AD | active |
| 5 | AI11 | Voice dictation into the Coach composer | AI | active |
| 5 | AI12 | Clear chat history (with confirm — "erased on this device") | AI | active |
| 5 | C15 | Cadence, power, elevation fields | C | active |
| 5 | CP13 | Duel trophies (Challenger, Champion) | CP | ambient |
| 5 | CP21 | Bounty claim + bounty beaten push notifications | CP | ambient |
| 5 | CP32 | Path-completion self-celebration notification | CP | ambient |
| 5 | CP6 | Duel invite card in DMs | CP | active |
| 5 | CR18 | Crew war panel + battle entry | CR | active |
| 5 | CR2 | Crew creation flow (name, avatar, description) | CR | active |
| 5 | CR21 | Crew challenges — create (title, metric, target, duration), progress, completion | CR | active |
| 5 | CR22 | Crew challenge server-side progress (migration 246) | CR | ambient |
| 5 | CR6 | Crew membership door / seat cap (crew fills up) | CR | ambient |
| 5 | D5 | Reset to default layout | D | active |
| 5 | DB3 | Auto-generated weekly summary via `generateWeeklyDebriefs` Edge Function `[deployed but inert — cron unscheduled, secret unset]` | DB | ambient |
| 5 | DB4 | Claude-generated insight with a rule-based fallback | DB | ambient |
| 5 | GY15 | Gym events with Going / Maybe / Can't RSVPs | GY | active |
| 5 | GY34 | Leave gym | GY | active |
| 5 | GY37 | Gym equipment editor — add equipment (brand, implement type, series/model, house brand) | GY | active |
| 5 | GY38 | Trust tiers: owner's space authoritative, `verified_by_owner` = blessed member find, rest member-submitted | GY | ambient |
| 5 | GY44 | Home training space (one per owner) for personal gear | GY | active |
| 5 | H10 | Composer — stats snapshot share | H | active |
| 5 | H30 | On-demand translation of user content ("Translate" / "Show original", "translated from …") | H | active |
| 5 | H6 | Composer — meal share (name, calories, protein, carbs, fat) | H | active |
| 5 | HP16 | Profile QR code | HP | active |
| 5 | HP24 | Live session card + "Go Live" broadcaster | HP | active |
| 5 | I18-8 | On-demand translation of user-generated content | I18 | active |
| 5 | M28 | Crew DM invite card | M | active |
| 5 | M33 | Guest-safe DM identity handling (migrations 240/241/244) | M | ambient |
| 5 | M8 | Pin / unpin a conversation | M | active |
| 5 | N17 | Rate-limit and timeout error states for recognition | N | ambient |
| 5 | NF12 | `.toLocaleString()` migration partially complete — some sites still hardcode `en-US` | NF | ambient |
| 5 | ON27 | `user_not_registered` and `auth_required` error screens | ON | ambient |
| 5 | SE21 | Privacy: read receipts | SE | active |
| 5 | SH11 | Quick actions — Hub: New post / Search users | SH | active |
| 5 | SH12 | Quick actions — Progress: Log weight / Add photo | SH | active |
| 5 | ST16 | Story privacy — default visibility Friends vs Public | ST | active |
| 5 | ST17 | Story highlights — create album, add to album, remove from album, "This album is empty" | ST | active |
| 5 | ST4 | Video stories (50 MB cap) | ST | active |
| 5 | W12 | EMOM 1:00 preset | W | active |
| 5 | W13 | Tabata 20s / Tabata 10s presets | W | active |
| 5 | WE5 | "Switch to today to write" guard on past days | WE | ambient |
| 4 | C24 | Cardio voice coach | C | active |
| 4 | CP4 | Create duel by shareable invite link (external, works for non-users) | CP | active |
| 4 | CR20 | Crew win celebration | CR | ambient |
| 4 | CR23 | Crew treasury — pooled coins earned from wars and challenges | CR | active |
| 4 | CR26 | Crew push notifications (war started/resolved, challenge created/completed) | CR | ambient |
| 4 | CR27 | `crew_everyone` broadcast notification | CR | active |
| 4 | CR3 | Crew avatar upload + crop modal | CR | active |
| 4 | CR5 | Join requests — approve / decline (leader) | CR | active |
| 4 | CR8 | Leave crew (blocked while a war is live; must promote a new leader first) | CR | active |
| 4 | GA12 | Peer-to-peer coin gifting (10,000 cap per gift) | GA | active |
| 4 | GY10 | QR code scanner for join-by-code | GY | active |
| 4 | H13 | Content warning gate (blur + tap-to-reveal on the card) | H | ambient |
| 4 | H8 | Composer — video post (50 MB cap, MIME + size validation) | H | active |
| 4 | M10 | Archive a conversation (per device) | M | active |
| 4 | M13 | Voice memos (record, playback) | M | active |
| 4 | M24 | Read receipts opt-out setting (mutual) | M | active |
| 4 | M30 | Coin gifting inside a DM (amount presets + custom, 10,000 cap, balance shown) | M | active |
| 4 | M7 | In-conversation message search | M | active |
| 4 | M9 | Mute / unmute a conversation | M | active |
| 4 | MK12 | Seller profile link + "Message seller" | MK | active |
| 4 | MK5 | Cancel a listing (atomic, migration 078) | MK | active |
| 4 | N30 | Calorie cycling per-macro overrides (blank = keep usual goal) | N | active |
| 4 | NT7 | Per-category snooze: 1h / 4h / 24h + clear | NT | active |
| 4 | SE28 | Delete account (typed confirmation) | SE | active |
| 4 | W42 | Equipment photo capture / replace, "Your photo" vs drawn silhouette | W | active |
| 4 | W53 | Live session broadcast ("Go Live") from a workout | W | active |
| 3 | AD12 | Profanity warning dialog | AD | ambient |
| 3 | AI23 | Ovulation warm-up cue (ACL/ligament-laxity, not a load change) | AI | ambient |
| 3 | C27 | Wearable-sync stub (`CardioWearableStub`) `[stub]` | C | active |
| 3 | CP16 | User-created bounties (metric, exercise, target value, difficulty, expiry) | CP | active |
| 3 | CP42 | Opt out of Gym Rival (Settings) | CP | active |
| 3 | CP5 | Duel invite landing page with type explainer + accept | CP | active |
| 3 | CR24 | Crew perk shop — leader spends the treasury on perks | CR | active |
| 3 | CR25 | Crew-assigned regimens | CR | active |
| 3 | DB5 | PNG export of a debrief | DB | active |
| 3 | GY12 | Check-in landing page `/checkin/:code` | GY | active |
| 3 | GY30 | Public gym landing page `/p/gym/:id` (signed-out) | GY | active |
| 3 | GY35 | Share gym | GY | active |
| 3 | GY45 | Equipment photos (user-supplied only — never manufacturer imagery) | GY | active |
| 3 | H11 | Composer — poll creation (question + ≥2 options) | H | active |
| 3 | H23 | Save a shared meal straight to your saved meals | H | active |
| 3 | H28 | Creator analytics panel | H | active |
| 3 | H31 | Mute author | H | active |
| 3 | H32 | Block author | H | active |
| 3 | HP30 | Block list management | HP | active |
| 3 | HP31 | User mutes | HP | active |
| 3 | M31 | Trade offer card inside a DM | M | active |
| 3 | M32 | Message a marketplace seller (deep link into a pending conversation) | M | active |
| 3 | MK16 | Trade offers — propose an item-for-item swap | MK | active |
| 3 | MK17 | Trade escrow (migration 253) — your item is held, released on cancel | MK | ambient |
| 3 | MK18 | Trade history page (Pending / Accepted / Declined / Cancelled) | MK | active |
| 3 | MK20 | Trade offer push notification | MK | ambient |
| 3 | NF4 | Cardio wearable sync — stub component | NF | active |
| 3 | ON29 | Stashed-token recovery path | ON | ambient |
| 3 | RS32 | Account reset filtering (`filterAfterReset`) so pre-reset rows stay hidden | RS | ambient |
| 3 | SE22 | Privacy: opt out of Gym Rival | SE | active |
| 3 | SE23 | Blocked accounts list — add by email, unblock, self-block prevention | SE | active |
| 3 | SE25 | Two-factor authentication (enroll via TOTP, verify, disable) | SE | active |
| 3 | ST15 | Setting: allow / disallow DM replies to my stories | ST | active |
| 3 | ST19 | Long-press a story to add it to a highlight | ST | active |
| 3 | W77 | Crew-assigned regimens (leaders push a regimen to the crew) | W | active |
| 3 | WE2 | Voice dictation into the journal | WE | active |

---

## F-Tier — Rare (0–3%) · 79 features

Under 1 in 33. Mostly owner/admin tools, easter eggs and dead ends.

| % | ID | Feature | Area | Kind |
|---|---|---|---|---|
| 2 | AD1 | Report content (posts, comments, stories, users) | AD | active |
| 2 | AD2 | Report reasons: harassment, hate speech, impersonation, inappropriate, other | AD | active |
| 2 | CR9 | Auto-delete an emptied crew on leave | CR | ambient |
| 2 | DB6 | `friendRecapEmail` Edge Function | DB | ambient |
| 2 | EE1 | 7× logo tap → confetti barrage + random cheeky toast | EE | active |
| 2 | H12 | Content warning selector: No warning / Sensitive content / Graphic injury / Spoiler / Other (specify) | H | active |
| 2 | H33 | Report post (harassment, hate speech, impersonation, inappropriate, other) | H | active |
| 2 | I18-4 | RTL support: `dir="rtl"` on `<html>` for Arabic, logical CSS properties across 22 audited files, icon flips | I18 | active |
| 2 | M19 | Pin a message to the conversation | M | active |
| 2 | M34 | Block from a conversation | M | active |
| 2 | M5 | Declined-requests management in Settings ("Allow requests" to re-open) | M | active |
| 2 | N38 | Publish a recipe to Discover | N | active |
| 2 | NF11 | RTL visual verification on device still pending (class swaps done; JS animation direction, e.g. NotificationPanel slide-in, not yet direction-aware) | NF | ambient |
| 2 | NF2 | Live payments — checkout runs in test mode, no charge | NF | active |
| 2 | ON28 | Account-deleted screen | ON | ambient |
| 2 | SE24 | Declined message requests management | SE | active |
| 2 | SE27 | "Download my data" full export | SE | active |
| 2 | SE30 | Build info footer — tap to copy hash + date + UA | SE | active |
| 2 | SH32 | Hidden easter egg: tap header logo 7× → confetti barrage + random toast | SH | active |
| 2 | ST9 | Story polls with voting | ST | active |
| 2 | TR10 | `checkout-session` Edge Function `[dormant — live payments not enabled]` | TR | ambient |
| 2 | TR8 | Unlock a program (test mode, no charge) | TR | active |
| 1.5 | CO1 | Corporate Portal page | CO | active |
| 1.5 | M20 | Scheduled send (pick a future date/time, cancel a scheduled message) | M | active |
| 1.5 | M29 | DM polls | M | active |
| 1.5 | MK19 | Cancel offer → release my item | MK | active |
| 1.5 | ST10 | Story countdown overlay | ST | active |
| 1.2 | CO3 | Join by code; join-code copy | CO | active |
| 1 | AD6 | Report-resolution notification to the reporter | AD | ambient |
| 1 | CO9 | Member-facing challenge view ("Your admin hasn't started a challenge yet") | CO | active |
| 1 | D11 | Unknown-widget fallback card ("try removing and re-adding it") | D | ambient |
| 1 | D46 | Prestige prompt when eligible | D | active |
| 1 | EE2 | Snake game modal (hidden, "Secret game") | EE | active |
| 1 | EE3 | Heavy Bird modal (Flappy-Bird-style minigame) | EE | active |
| 1 | GA49 | Prestige — reset at L100 for permanent status, 10 tiers with Roman numerals and titles (The Initiated → The Eternal) | GA | active |
| 1 | H36 | Post collaborators (`collaborator_ids`, migration 219) | H | active |
| 1 | TR9 | Already-owned detection | TR | ambient |
| 0.8 | EE4 | Sweat Jetpack modal (minigame) | EE | active |
| 0.8 | TR1 | Trainer Studio — enable creator mode | TR | active |
| 0.8 | TR11 | Trainer tier flag on profiles (migration 143) | TR | ambient |
| 0.6 | TR2 | Create / edit / delete listings | TR | active |
| 0.5 | CO4 | Seat limits | CO | ambient |
| 0.5 | GY16 | Create / delete a gym event (owner) | GY | active |
| 0.5 | GY26 | Register Gym flow (business name, address, lat/lng, capture-my-location) → verification queue | GY | active |
| 0.5 | GY28 | 8-char Flexyn Code minted on approval | GY | ambient |
| 0.5 | ST21 | Report a story | ST | active |
| 0.5 | TR3 | Publish / unpublish to the trainer market | TR | active |
| 0.5 | TR4 | Sales dashboard: gross sales, your payout, sales count | TR | active |
| 0.5 | TR5 | Platform-fee split math mirrored client-side | TR | ambient |
| 0.4 | CO5 | Leave organization | CO | active |
| 0.4 | GY29 | Gym Edit (owner) — logo, cover, description, hours, "copy Monday to all days", amenities, gallery, contact, map pin | GY | active |
| 0.4 | GY33 | Push to the owner when a member joins | GY | ambient |
| 0.4 | GY39 | Owner controls: "Confirm this is on the floor", "Listed by the gym", remove confirmation | GY | active |
| 0.4 | GY40 | "N member submission(s) to confirm" badge for owners | GY | ambient |
| 0.3 | CO10 | Actor dedup for HR aggregates (migration 156) | CO | ambient |
| 0.3 | CO2 | Create an organization | CO | active |
| 0.3 | CO6 | HR/admin dashboard: total workouts, volume lifted, active (7d), workouts (7d), avg streak, active days, participation, hydration, streak days | CO | active |
| 0.3 | CO7 | Launch a step / workout / streak challenge for the team | CO | active |
| 0.3 | GY31 | Printable signage kit — multi-page US-Letter PDF, one quarter-page QR poster per sheet | GY | active |
| 0.3 | GY32 | Gym signage card in-app | GY | active |
| 0.3 | TR6 | Stripe payout account linking `[stub — "Real payouts route to your Stripe account once live"]` | TR | active |
| 0.2 | AD3 | Admin Reports page — Content / Bug reports tabs | AD | active |
| 0.2 | AD4 | Report states: Pending / Reviewed / Actioned / Dismissed | AD | ambient |
| 0.2 | AD5 | Delete reported content (with confirm) | AD | active |
| 0.2 | AD8 | Moderator RPCs + role table (migrations 103, 110, 179) | AD | ambient |
| 0.2 | AD9 | Admin role gating (`isAppAdmin`) hiding admin-only UI | AD | ambient |
| 0.2 | CO8 | Delete a challenge | CO | active |
| 0.2 | D7 | Admin-only "Save as default layout for new users" | D | active |
| 0.2 | N43 | Admin "save as default nutrition layout" | N | active |
| 0.1 | AD10 | Admin gyms verification dashboard | AD | active |
| 0.1 | GY27 | Admin gyms dashboard — approve / reject verification requests | GY | active |
| 0.1 | SH3 | Per-user nav color override on the Hub ring (purple for `kegan`, blue for `sean`) | SH | active |
| 0.0 | BE2 | Schema drift audit script | BE | ambient |
| 0.0 | I18-9 | i18n check + warn tooling | I18 | ambient |
| 0.0 | NF5 | Weekly Debriefs — Edge Function deployed but the cron is unscheduled and `DEBRIEF_CRON_SECRET` is unset | NF | ambient |
| 0.0 | NF6 | `push_subscriptions` currently 0 rows — delivery is verified working, nobody is subscribed yet | NF | ambient |
| 0.0 | NF7 | `regimens.is_active` column — schema exists, nothing reads or writes it | NF | ambient |
| 0.0 | NF9 | LocationStep removed from onboarding — no country/state collection pending a product decision | NF | ambient |
| 0.0 | RS33 | 2,366 tests across 167 files (vitest + jsdom) | RS | ambient |

---

## Area rollup — average reach of ACTIVE features

Ambient items are excluded here; averaging infrastructure in would flatter every
area equally. Sorted by average active reach, which is roughly "how much of this
area does a typical user actually meet".

| Area | Section | Features | Active | Avg active reach | Peak |
|---|---|---|---|---|---|
| Onboarding & auth | ON | 31 | 23 | 66.8% | 100% |
| Goals | G | 11 | 4 | 41.3% | 45% |
| Gamification & economy | GA | 52 | 21 | 38.3% | 95% |
| Dashboard | D | 53 | 45 | 36.6% | 92% |
| Workout | W | 77 | 54 | 35.3% | 100% |
| PWA, performance & resilience | RS | 33 | 6 | 33.7% | 100% |
| Notifications | NT | 20 | 9 | 33.6% | 85% |
| Progress | P | 25 | 17 | 32.8% | 70% |
| AI Coach | AI | 29 | 13 | 31.7% | 70% |
| App shell, navigation & chrome | SH | 32 | 12 | 26.1% | 100% |
| Hub — social graph & profile | HP | 34 | 25 | 22.6% | 60% |
| Settings & account | SE | 32 | 31 | 20.3% | 80% |
| Nutrition | N | 43 | 33 | 17.7% | 45% |
| Journal & wellness | WE | 14 | 9 | 17.6% | 45% |
| Cardio | C | 30 | 20 | 17.6% | 40% |
| Marketplace & trading | MK | 22 | 16 | 16.5% | 45% |
| Form Coach | FC | 7 | 6 | 15.2% | 30% |
| Design system & primitives | UI | 24 | 1 | 15.0% | 100% |
| Known stubs, dormant code & explicit non-features | NF | 15 | 4 | 14.3% | 40% |
| Competitive | CP | 57 | 37 | 14.2% | 55% |
| Stories | ST | 24 | 21 | 12.6% | 55% |
| Hub — feed & posts | H | 43 | 34 | 12.1% | 50% |
| Internationalization | I18 | 9 | 3 | 10.7% | 100% |
| Gyms & the map | GY | 45 | 32 | 9.0% | 30% |
| Crews | CR | 27 | 19 | 7.7% | 30% |
| Messages / DMs | M | 35 | 29 | 7.7% | 30% |
| Weekly Debriefs | DB | 6 | 3 | 7.7% | 12% |
| Moderation & admin | AD | 13 | 6 | 1.6% | 30% |
| Creator / Trainer tier | TR | 11 | 7 | 1.5% | 6% |
| Easter eggs & hidden surfaces | EE | 4 | 4 | 1.2% | 2% |
| Corporate wellness | CO | 10 | 8 | 0.6% | 1.5% |
| Data, security & backend systems | BE | 22 | 0 | 0.0% | 100% |
