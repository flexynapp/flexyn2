# FLEXYN — COMPLETE SYSTEM ARCHITECTURE DOCUMENT

> **Scope note:** Flexyn is ~162,500 LOC across 304 components, 341 lib modules,
> 143 numbered SQL migrations, and 5 Supabase Edge Functions. This document
> covers every **feature surface** with a four-part breakdown (Functional
> Summary / Granular Mechanics / UI/UX Touchpoints / Data Models & Dependencies).
> It is exhaustive at the feature/subsystem level; it does not reproduce all
> 162K lines verbatim. File paths and migration numbers are cited throughout so
> any claim is traceable.
>
> Generated as a principal-architect total-code audit. Last updated alongside
> migration 143 (trainer tier).

---

# 1. HIGH-LEVEL ARCHITECTURE & TECH STACK

## 1.1 Core Architecture

**Pattern: Client-heavy modular monolith (SPA) over a Backend-as-a-Service.** There is no custom application server. The architecture is three-tiered:

1. **Presentation tier** — a React 18 SPA (Vite build), organized as a **page-per-route feature-module monolith**. Each route is an independently code-split chunk (`React.lazy`). Cross-cutting concerns live in React Context providers; data access is centralized in a compatibility shim.
2. **Data-access tier** — a single shim (`src/api/db.js`) exposing a Base44-style entity API (`db.entities.X.filter/create/update/delete`, `db.auth.*`, `db.functions.invoke`) that translates onto the Supabase JS client. Newer code calls `supabase.from()` directly. **All security is enforced at the database (RLS), not in the client** — the client is treated as untrusted.
3. **Backend tier** — Supabase: Postgres (with Row-Level Security on every table), Supabase Auth (JWT), Storage (buckets: `uploads`, `avatars`), Realtime (channels), pg_cron (scheduled jobs), pg_net (HTTP from triggers), Vault (secrets), and Deno Edge Functions for AI/email/push.

**Architectural invariants (enforced by convention, documented in CLAUDE.md):**
- **Atomic mutations via SECURITY DEFINER RPCs.** Any operation that reads-then-writes a shared counter (XP, coins, volume, league XP, post counters, member counts) is done in a single SQL statement inside an RPC, never client-side read-modify-write. ~15+ atomic RPCs (migs 023–143).
- **Idempotent migrations.** `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` + `CREATE POLICY`, `ALTER … ADD COLUMN IF NOT EXISTS`, `INSERT … ON CONFLICT`.
- **Graceful schema-drift tolerance.** Reads use `safeSelect` (strip-and-retry on missing columns); writes use strip-and-retry in `db.js`. Migrations can lag deploys without crashing the UI.
- **Layered failure handling.** Write strip-retry → read strip-retry → per-region ErrorBoundary → route ErrorBoundary → recovery affordances → Sentry async capture.

## 1.2 Tech Stack (every dependency)

**Core runtime:** React 18, React-DOM, React Router DOM (SPA routing), Vite 6 (build + dev server, manual vendor chunking).

**UI/styling:** Tailwind CSS (+ `tailwindcss-animate`, `tailwind-merge`, `class-variance-authority`, `clsx`), Radix UI primitives (27 packages: accordion, alert-dialog, avatar, checkbox, collapsible, context-menu, dialog, dropdown-menu, hover-card, label, menubar, navigation-menu, popover, progress, radio-group, scroll-area, select, separator, slider, slot, switch, tabs, toast, toggle, toggle-group, tooltip, aspect-ratio), `lucide-react` (icons), `framer-motion` (animation), `vaul` (drawer), `sonner` (toasts).

**Data/state:** TanStack React Query (server cache + mutations), React Context (global UI state), `react-hook-form` (forms).

**Backend SDK:** `@supabase/supabase-js`.

**Charts/media:** `recharts` (Progress/Body charts — Line/Bar/ResponsiveContainer), hand-rolled SVG (nutrition mini-bars), `html2canvas` (share-card PNG export), `canvas-confetti` (celebrations), `qrcode` (gym signage), `@zxing/browser` (barcode/QR scan), `maplibre-gl` (gym map, cardio routes via OpenFreeMap/MapTiler).

**AI/ML:** `@tensorflow/tfjs` + `@tensorflow/tfjs-backend-webgl` + `@tensorflow-models/pose-detection` (MoveNet, Form Coach); Anthropic Claude API (AI Coach chat + Photo-AI meal recognition, both via Edge Functions holding the key server-side).

**Dates/i18n:** `date-fns` (+ locale packs), custom i18n splitter (`scripts/split-i18n.mjs`, 15 languages).

**PWA/offline:** `vite-plugin-pwa`, Workbox (`workbox-precaching`/`routing`/`strategies`/`window`).

**Observability:** `@sentry/react`.

**Third-party APIs/integrations:** Supabase (Auth/DB/Storage/Realtime/Edge/Vault/cron), Anthropic Claude (Vision + chat), Open Food Facts (keyless barcode), USDA FoodData Central (server-proxied), Spoonacular (community/restaurant foods), Tenor (DM GIFs), OpenFreeMap/MapTiler (map tiles), Web Push/VAPID (notifications), Stripe Connect (trainer payments — scaffolded, not yet live).

**Tooling:** ESLint (+ react, react-hooks, react-refresh, unused-imports), Vitest + jsdom + Testing Library + V8 coverage (1,115 tests / 96 files), `rollup-plugin-visualizer`, TypeScript (jsconfig only — codebase is JS/JSX), Netlify hosting.

**Build guards (`vite.config.js`):** `MISSING_EXPORT`, `UNRESOLVED_IMPORT`, `PLUGIN_ERROR` are escalated from warnings to **build failures** (added after a 2026-05-23 production crash from a stale named import).

## 1.3 Data Flow

**Read path:** Component mounts → `useQuery(['key', user.email], () => db.entities.X.filter(...))` → db.js shim maps entity→table, builds `supabase.from(table).select().eq/in().order().limit()` → PostgREST applies RLS (`auth.uid()`/`auth.email()`) → rows returned → React Query caches by key (default 5-min gcTime) → component renders. Wide column-named reads route through `safeSelect` which strips unknown columns and retries (≤20×) on `42703`/`PGRST204`.

**Write path:** User action → `useMutation` → optimistic `onMutate` (cancel queries, snapshot, patch cache) → `db.entities.X.create(data)` auto-injects `created_by`(email)+`user_id`(uuid), strip-retries unknown columns (≤15×), detects `23505` idempotency conflict → on success `invalidateQueries` re-fetches; on error roll back to snapshot + `reportError` + toast.

**Mutation fan-out (example: workout save):** INSERT `workout_logs` → `increment_user_volume` RPC (atomic) → `mark_workout_volume_credited` RPC → `updateUserXpAndAchievements` (XP + achievement unlock + milestone capsules) → streak record → league weekly-XP record → quest progress → crew-war contribution → gauntlet check → PR detection → celebration queue. Most post-INSERT steps are fire-and-forget/try-catch so a partial failure never blocks the save; a Dashboard-mount reconcile pass (`reconcile_my_workout_volume`, mig 142) repairs counters if the network dropped mid-fan-out.

**Cross-user notifications:** SECURITY DEFINER `notify_X_for(...)` RPCs insert into `notifications`; an AFTER INSERT trigger (mig 034) calls `pg_net.http_post` to the `send-push` Edge Function (no-op if VAPID secrets unset or during quiet hours). Self-targeted notifications insert directly under the user's own RLS.

**Scheduled flows:** pg_cron jobs fire streak-break reminders (mig 035), welcome-back + quest-expiry (037), weekly gauntlet reset (082), league resolution (lazy on read). Weekly debriefs generated via RPC on Progress/Dashboard mount.

---

# 2. COMPREHENSIVE FEATURE-BY-FEATURE BREAKDOWN

## A. IDENTITY & ACCESS

### A1. Authentication
- **Functional summary:** Sign in via Apple/Google OAuth or passwordless email magic-link; sessions persist; unauthenticated users are gated to a sign-in/onboarding wall (except the viral duel-invite landing).
- **Granular mechanics:** `AuthContext.jsx` bootstraps from `supabase.auth.getSession()` (synchronous localStorage read) with a 10s safety timeout; listens to `onAuthStateChange` (SIGNED_IN/TOKEN_REFRESHED/SIGNED_OUT/USER_UPDATED), defers profile load via setTimeout to let Supabase settle. On SIGNED_IN it strips `access_token`/`refresh_token` from the URL hash (history-leak defense) and fire-and-forget auto-claims any stashed referral code. `db.auth.signInWithProvider('google'|'apple')` and `signInWithMagicLink(email)` (`shouldCreateUser:true` auto-enrolls). A Postgres trigger `handle_new_user` (mig 001) auto-creates the `user_profiles` row on `auth.users` insert.
- **UI/UX touchpoints:** `Splash.jsx` (first paint, routes by auth+onboarding flags), `SignInToContinue.jsx` (OAuth buttons + magic-link field + loading/error states), `ProtectedRoute.jsx` (gate), `UserNotRegisteredError.jsx`.
- **Data models/deps:** `auth.users` (Supabase), `user_profiles.id = auth.uid()`, `user_profiles.email`; localStorage `fn-returning-user`; profile cache in `db.js`.

### A2. Onboarding
- **Functional summary:** A 7-step first-run flow capturing goals, experience, an optional lift self-assessment, age, height, weight, and username; generates a personalized starter regimen.
- **Granular mechanics:** `Onboarding.jsx` steps: (1) Welcome carousel; (2) multi-select goals (strength/muscle/lose/endurance/mobility) with live "tailoring" preview; (3) experience level (newbie→advanced → sets/reps baseline); (4) 4-question assessment (bench bodyweight, 1.5× squat, 10 pull-ups, sub-10 mile) feeding a volume bump; (5) age via drag-scrubber (13–80 COPPA gate) + username + sanitization; (6) height (ft/in↔cm ruler); (7) weight (lb↔kg scrubber). Completion writes `onboarding_complete`/`onboarding_completed` via `updateMe` (20× strip-retry). `starterRegimen.js` `buildStarterRegimen({goals,level,daysCount,assessment})` deterministically picks per-goal exercises + sets/reps; `ensureStarterRegimen()` is idempotent (skips if any regimen exists) and fire-and-forget.
- **UI/UX touchpoints:** Aurora animated background, KineticHeading, drag scrubbers with haptics, confetti on finish.
- **Data models/deps:** `user_profiles` (onboarding_*, fitness_level, fitness_goals[], training_days, gender, birthday, height_inches/cm, weight_lbs/kg, units, country/state); `regimens`. App.jsx auto-heals stale onboarding flags when a real username + profile fields exist; usernames prefixed `deleted_` force re-onboarding.

## B. WORKOUT & TRAINING

### B1. Workout Logger
- **Functional summary:** Log a strength/cardio session: pick a regimen or freestyle, add exercises, log sets (weight×reps, RPE/RIR, warmup/failed flags, per-set feel emoji+note, tempo, notes), watch live volume, save to earn XP/streak/league/quest/crew/gauntlet credit and PR celebrations.
- **Granular mechanics (`Workout.jsx`, 2,500 lines):** Idle→In-Progress→Completed state machine; `started`+`activeSessionId` gate the editor. Live elapsed clock from `startedAt` (`WorkoutElapsedChip` + `elapsedClock.js`). On save: future-date guard (UTC+14 ceiling); empty-set filter (drops sets with no reps, or no weight for non-cardio); per-exercise set cap + per-muscle-group cap clamps (`workoutFatigue.js`, demographic-adjusted by age/gender/weight); anti-cheat realistic-limit checks (`realisticLimits.js`); implausible-volume detection (`detectImplausibleWorkout`). INSERT `workout_logs` with a client-generated `idempotency_key` (mig 142, dedupes double-taps → `__duplicate` short-circuit skips all credits). Then atomic `increment_user_volume` + `mark_workout_volume_credited`; `updateUserXpAndAchievements`; streak/league/quest/crew-war fan-out; `detectPRsInWorkout` (Epley 1RM vs historical) → `firePRCelebration`; deload suggestion; comeback +200 XP (flagged exercises). Paused sessions persist to localStorage (`paused_workouts.<userId>`) for resume; "repeat from log" clones an old session blanked to a template.
- **UI/UX touchpoints:** `ExerciseLogger.jsx` (per-exercise card: last-3-session history sidebar, progressive-overload hint, tempo/notes drawer), `SetRow.jsx` (weight steppers, smart-paste "225x8" parser, PR trophy + flash, PR proximity bar, plate diagram), `LiveVolumePill`, `RestTimerOverlay`, banners (Injury/Duel/Bounty/Nemesis/Comeback), secondary-action grid (Regimens, Generate, Saved, Cardio, Goals, Duels, Bounties), modals (FormCoach, Generator, EditWorkout, ProgressPhoto, PRShare, WorkoutShare, GauntletStats), first-workout tutorial.
- **Data models/deps:** `workout_logs` (exercises JSONB, total_volume, duration_min, idempotency_key, volume_credited_at), `user_profiles` counters, `workoutVolume.js` (shared volume math honoring `include_bar_in_volume`), `xpSystem.js`.

### B2. Regimens & Templates
- **Functional summary:** Build, save, fork, review, and run multi-day workout programs; community store of shared regimens; built-in canonical programs; "save this session as a template."
- **Granular mechanics:** `regimens.js` (CRUD, tombstone-aware purge on account delete, clone-count on fork), `regimenReviews.js` (star ratings + reviews, mig 118), `regimens` table (`days` JSONB, `is_active`, `is_public_free`, difficulty mig 120). `RegimenStorePage` browses community programs; `WorkoutGeneratorModal` + `aiCoach/workoutGenerator.js` builds a session from history; `workoutTemplates.js` saves a logged session as a reusable template; `ProgramTemplatePicker` seeds canonical programs.
- **UI/UX touchpoints:** RegimensSection, RegimenStorePage, WorkoutSavedList, TemplatesModal, EditWorkoutModal.
- **Data models/deps:** `regimens`, `regimen_reviews`, `workout_templates`; exercise library (400+ in `ExerciseAutocomplete`).

### B3. Rest Timer
- **Functional summary:** Auto-starting rest countdown with voice cues, chime, haptics, presets, HIIT intervals.
- **Granular mechanics (`RestTimerContext.jsx`):** Single `setInterval(250ms)` ticks against an absolute `endsAt` epoch (background-drift-proof). Auto-starts when a set becomes fully logged (bodyweight uses reps-only signal). `start/stop/addTime` manage an auto-dismiss timeout (ref-tracked, cleared so a new timer isn't killed by a stale callback); `addTime` past zero re-arms completion. Completion fires `fireCompletionFeedback` (WebAudio 3-tone chime, capped AudioContext pool) + `navigator.vibrate` + spoken cue. Default duration persisted (`fn-rest-timer-default`, clamped 15–600s).
- **UI/UX touchpoints:** `RestTimerOverlay.jsx` (floating pill: −15/+15/skip, progress fill, finishing pulse; expanded panel with presets 30/60/90/120/180/300, HIIT presets Tabata/EMOM/30-30/40-20, sound + voice toggles).
- **Data models/deps:** localStorage only; SettingsContext `restTimerEnabled`; `audioCues.js`.

### B4. Form Coach (pose analysis)
- **Functional summary:** Camera-based real-time form scoring on 4 lifts using on-device pose detection.
- **Granular mechanics (`formcoach/`, `formCoach/`):** Lazy-imports TF.js + WebGL backend + MoveNet SINGLEPOSE_LIGHTNING (~3 MB, prewarmed on modal open, CPU fallback). `analyzeForm(imageDataUrl, exerciseName)` runs pose estimation → per-exercise geometry rules (`rules.js`) → `{overall_score 0–10, form_rating, good_points[], corrections[], injury_risks[], tip, _bodyDetectionScore, _poseQuality}`.
- **UI/UX touchpoints:** FormCoachModal, ExercisePicker, CameraView, FeedbackPanel, DemoSection. Wrapped in its own ErrorBoundary so a TF.js failure can't crash Workout.
- **Data models/deps:** No DB persistence (analysis is ephemeral); vendor-tfjs/pose chunks.

### B5. PR Tracking & Celebration
- **Functional summary:** Detects estimated-1RM personal records live during logging and post-save, with a distinct gold celebration + shareable card.
- **Granular mechanics:** `personalRecords.js` `buildPRIndex(logs)` (O(1) per-exercise best), live in SetRow via Epley `epleyOneRepMax`; post-save `detectPRsInWorkout(clamped, prevLogs)` excludes warmups/failed/first-attempts; `firePRCelebration` (gold/crimson confetti, victory haptic, 🏆, share-card event). Client-side only (no `is_pr` column).
- **UI/UX touchpoints:** SetRow trophy + "NEW PR" flash + PRProximityBar; PRShareCard (Canvas 2D, gold palette); Progress Personal Bests tab.
- **Data models/deps:** derived from `workout_logs`; `oneRepMax.js`, `prCelebration.js`.

## C. CARDIO
- **Functional summary:** Track runs/rides/swims/walks with HR, cadence, splits, power, elevation, calories; indoor + outdoor GPS; templates, goals, VO2max estimate.
- **Granular mechanics (`cardio.js`, `components/cardio/`):** Three capture modes — outdoor GPS (geolocation polyline + live HR/cadence), indoor treadmill (manual + RPE), manual retro entry. `cardioVO2max.js`: ACSM speed formula (running, 40–350 m/min) or Uth-Sørensen HR method, `bestVO2max` prefers HR. `cardioLimits.js`: MET-ceiling calorie validation + per-type speed bounds. Saving fires atomic `increment_user_distance` + XP (cardio formula: 1.5 XP/min + distance/calorie bonuses, intensity multiplier, 600 cap).
- **UI/UX touchpoints:** CardioSection, CardioLiveTrackerOutside/Indoor, CardioManualForm, RouteMap (MapLibre polyline + splits + elevation), CardioGoals, CardioTemplates.
- **Data models/deps:** `cardio_logs` (type, distance_meters, duration_seconds, avg/max_hr, cadence, calories, avg_pace, elevation_gain_m, gps_route, HR zones mig 094, expansion mig 117).

## D. PROGRESS & ANALYTICS
- **Functional summary:** Five tabs — Trends (per-exercise charts w/ time-range filter), Analytics (max-weight, volume-by-muscle, frequency), Body (metrics + charts), Photos, Insights — plus hero stats and weekly summary.
- **Granular mechanics (`Progress.jsx`):** Queries last 200 workout/cardio/body rows. PersonalBestsTab maps best weight/reps per exercise. AnalyticsTab: max-weight-over-time (slice -20), volume-by-muscle (first group only — known undercount), 30-day frequency. Trends tab applies the time-range filter (7/30/90/365) via `GroupedExerciseTrends`→`ExerciseProgressCard` (Recharts monotone lines, dual Y-axis weight+reps). Hero volume reads `user_profiles.total_volume_lbs` (all-time) else `calcVolume(logs)`.
- **UI/UX touchpoints:** TAB_META strip, FilterDropdown (regimen/time-range/muscle), BodyMetricsTab, ProgressPhotosTab + PhotoCompareSlider, InsightsTab, AdvancedAnalytics (BottomSheet), MuscleGroupHeatmap, WorkoutCalendarGrid, TrainingPatternCard, PRHistoryModal.
- **Data models/deps:** `workout_logs`, `cardio_logs`, `body_metrics`, `weekly_debriefs`, Recharts.

## E. NUTRITION

### E1. Meal/Macro Logging
- **Functional summary:** Log foods (manual, barcode, photo-AI, recipe) with full macro + micronutrient breakdown; live calorie bar + macro rings vs goals; water tracker; fasting.
- **Granular mechanics (`Nutrition.jsx`, `nutrition.js`):** Today-only `nutrition_logs` query. Macros summed independently per entry (no `4P+4C+9F=kcal` enforcement — math gap tolerated). Water entries encode oz in `food_name` ("Water|N") for schema-drift safety, optimistic-inserted. First-meal celebration. Goals from `nutritionDefaults.calculateDailyValues(profile)`.
- **UI/UX touchpoints:** CalorieTopBar (consumed/goal/remaining, tiered color), MacroNutrientBox (8 macros bar/ring view, net carbs), MineralsVitaminsBox, WaterTracker (droplet grid, weight/age-scaled target, 200oz cap), LogMealForm, MealTypePicker, BarcodeResult/NotFound modals, NutritionTrendsChart (SVG mini-bars), NutritionOnboardingModal.
- **Data models/deps:** `nutrition_logs` (_g/_mg suffixed columns mig 006 + legacy fallbacks), `user_profiles` goals.

### E2. Food Lookup
- **Granular mechanics (`foodLookup.js`):** 3-tier waterfall — community `food_items` table → Open Food Facts (keyless, per-100g scaling, kJ→kcal) → USDA FDC (server-proxied `usdaBarcodeLookup`). `@zxing/browser` lazy-loaded scanner with `detectedRef` multi-fire guard, scan history in localStorage (cap 20). Photo-AI: `recognize-meal` Edge Function → Claude Vision → macro estimate (`photoMealRecognition.js`, 4MB cap, errors NOT_FOOD/RATE_LIMIT/PIPELINE_MISSING).
- **Data models/deps:** `food_items` (community), Edge Function `recognize-meal`.

### E3. Plans / Recipes / Fasting / Calorie Cycling
- **Granular mechanics:** `mealPlans.js` (weekly grid, `buildGroceryList` aggregates ingredients → PNG export); `nutritionRecipes.js` (`sumIngredients`/`perServing`); `fastingWindow.js` (localStorage `flexyn.fastingWindow.<email>`, 16:8/18:6/20:4 presets, live countdown); `calorieCycling.js` (`user_profiles.calorie_cycling` training/rest split, `resolveToday`).
- **UI/UX touchpoints:** WeeklyMealPlannerModal, RecipeBuilderModal, FastingTrackerCard, NutritionPlansModal, PortionGuide, MealHistoryModal.
- **Data models/deps:** `meal_plans` (mig 123), `nutrition_recipes`, `user_profiles.calorie_cycling`.

## F. WELLNESS
- **Functional summary:** Daily sleep, mood, soreness, hydration, recovery/readiness; opt-in cycle tracking with phase-aware training hints.
- **Granular mechanics:** `sleepLogs.js`/`moodLogs.js` upsert one row/user/date (`sleep_logs` mig 095: hours/quality/soreness/notes; `mood_logs` mig 096: 5-emoji scale). `cycleLogs.js` (mig 128, opt-in via `cycle_tracking_enabled`, `cyclePhase.js` pure phase computation → follicular/luteal/menstrual training hints). Recovery/readiness widgets composite sleep + soreness + workout recency.
- **UI/UX touchpoints:** Dashboard cards (HydrationRing, MoodLogCard, SleepLog, RecoveryScore, ReadinessCard), CycleTrackerCard.
- **Data models/deps:** `sleep_logs`, `mood_logs`, `cycle_logs`, recovery_scores.

## G. GOALS
- **Functional summary:** Strength/cardio/generic goals on weekly/monthly/lifetime timelines with progress bars and almost-complete nudges.
- **Granular mechanics (`goals.js`):** CRUD with profanity check; goal-complete celebration (atomic `complete_goal` mig 030); `GoalsAlmostComplete` nudge at ≥90%.
- **UI/UX touchpoints:** GoalsModal, GoalsList, GoalForm, GoalProgressBar, GoalsAlmostComplete (Workout page).
- **Data models/deps:** `goals` (exercise_name, target_value, timeline, notes).

## H. BODY COMPOSITION
- **Functional summary:** Track weight, body-fat %, and 7 circumference measurements with trend charts and a muscle diagram.
- **Granular mechanics (`bodyMetrics.js`, `BodyMetricsTab.jsx`):** `body_metrics` (weight_lbs, body_fat_pct, chest/waist/hips/L-R arm/L-R thigh inches, mig 133); kg↔lb / cm↔in conversions via `weightUnit.js` (1-decimal display; round-trip drift below display precision). Recharts multi-series.
- **UI/UX touchpoints:** BodyMetricsTab, MuscleDiagram, MuscleDetailsModal, body-metrics components.

## I. GAMIFICATION (12 engines)

### I1. XP & Levels (1–100)
- **Mechanics:** `xpSystem.js` — base 150 XP/level, tiered growth 1.05–1.13; strength XP = 12/set + rep-volume + lbs/400 + duration, 1000/session cap; cardio capped 600; daily 2,500 cap; flat rewards (first workout 50, milestones 150/400/750, goal 100, regimen 60/120/250). `calculateLevelFromXp` derives level+progress.
- **UI/deps:** LevelBar, LevelUpManager, LevelUpOverlay; `user_profiles.total_xp/current_level/lifetime_xp`; atomic `increment_user_xp` / `grant_level_up_rewards` (mig 070).

### I2. Capsules & Loot
- **Mechanics:** 3 capsule tiers (standard/premium/elite) with published rarity odds; atomic `claim_capsule_loot` (mig 028) rolls sticker/title/theme/frame across common→legendary(+animated); variants foil/gold/diamond multiply sell value. Grants on level-up, first-workout, streak milestones (30/60/100), achievement milestones (5/10/25/50/100).
- **UI/deps:** UserBag (Capsules/Stickers/Titles/Frames/Themes tabs, sell w/ 2-step armed confirm), CapsuleOpener; `user_capsules`, `user_inventory`, `lootCatalog/lootThemes/lootFrames`; idempotency via `*_awarded` counters.

### I3. Leagues
- **Mechanics:** Lazy weekly enrollment (`ensureCurrentLeague`), ~30/league, tiers bronze→diamond; atomic `increment_league_xp` (027); week resolution via `distribute_league_rewards` (067) promotes top-5/demotes bottom-5, awards coins+capsules, idempotent claim; monthly league track (mig 132).
- **UI/deps:** LeagueCard, LeaderboardsModal/RegionalLeaderboardsModal; `leagues`, `league_members`.

### I4. Quests
- **Mechanics:** 3 daily quests (easy/medium/hard) seeded per user+date from `questCatalog.js`; `recordAction(user, ACTION_TYPE, n)` increments matching quests across the app (9 action types); atomic `claim_quest_atomic` (068).
- **UI/deps:** QuestCard, Dashboard `ensureTodaysQuests`; `user_daily_quests`.

### I5. Gauntlet
- **Mechanics:** Personal 10-challenge linear path (`checkChallenge1` validates 4+ exercises/zero-skipped post-save; `complete_gauntlet_challenge` awards) + weekly community gauntlet (threshold + leaderboard, cron reset mig 082).
- **UI/deps:** Gauntlet page, GauntletStatsModal; `gauntlet_challenges`, `user_gauntlet_progress/completions`, `weekly_gauntlets/attempts`.

### I6. Duels
- **Mechanics:** open/mirror/exercise 1v1; lifecycle pending→active→completed; atomic `submit_duel_result_atomic` (079); DM `[DUEL_INVITE_V1]` cards; external shareable invite landing (mig 072) for viral acquisition.
- **UI/deps:** Duels page, DuelBanner, CreateDuelModal, DuelInviteLanding; `duels`, `duelInvites.js`.

### I7. Bounties
- **Mechanics:** Target another user's record (4 metrics × 3 difficulty tiers w/ entry fee + reward); claim → `checkAndCompleteBounty` post-workout; auto-generated + user-created.
- **UI/deps:** Bounties page, BountyBoard, BountyBanner, CreateBountyModal; `bounties`, `bounty_claims`.

### I8. Nemesis
- **Mechanics:** Auto-assign rival 10–20% higher XP; weekly volume/sessions/XP comparison; ≥2/3 wins → overthrow (atomic `increment_overthrow_count` mig 112, push mig 111); opt-out flag.
- **UI/deps:** NemesisCard; `nemesis_assignments`, `user_profiles.overthrow_count/nemesis_opt_out`.

### I9. Streaks
- **Mechanics:** Independent login + workout streaks; milestone coins + elite capsules (30/60/100); auto-freeze consumption; once-monthly post-break rescue (`spendStreakRescue` mig 087, sets last date to yesterday so user must still train). Soft same-day rescue nudge after 6pm.
- **UI/deps:** LoginStreakSync, StreakFlame, Dashboard banner; `user_profiles.{login,workout}_streak/last_*_date/longest_*/streak_freezes_available`, `streak_rescues`.

### I10. Achievements
- **Mechanics:** Action-threshold unlocks grant XP+coins+celebration and feed milestone-capsule progression (`grantForAchievementMilestone` mig 071).
- **UI/deps:** AchievementsVault/Tab/Modal; `achievements`, `user_profiles.milestone_capsules_awarded`.

### I11. Coins (Flex Coins)
- **Mechanics:** Universal currency; atomic `increment_flex_coins` (030); spend via `purchase_shop_item` (031, capsules 100/350/1000, streak freeze); peer gifting `gift_flex_coins` (124); coin shop seasonal items (131), bundle deals (134).
- **UI/deps:** CoinShopModal, coin-gift modal; `user_profiles.flex_coins`.

### I12. Prestige
- **Mechanics:** At L100, reset to L1 for prestige tier I–X + permanent title + coins; `lifetime_xp` accumulates; cosmetic only; leaderboard by prestige then lifetime_xp.
- **UI/deps:** prestige components; `user_profiles.prestige_level/lifetime_xp/prestiged_at`.

## J. HUB SOCIAL

### J1. Posts & Feed
- **Mechanics:** "The Pump" (global public) + "Squad" (followed) feeds; `FETCH_WINDOW=100` server window + client `PAGE_SIZE=8` IntersectionObserver pagination + cursor-based `fetchOlder*`; post types text/workout/meal/repost/poll/video; like/dislike (atomic `set_post_reaction` 024) + independent emoji reactions (mig 053/126); threaded comments w/ @mentions + comment likes; saved posts; 2s-dwell view tracking; trending hashtags (window-scoped); realtime "X new posts" pill filtered by mute/block/follow/privacy; profanity-gated bodies.
- **UI/deps:** Hub.jsx, HubFeed, HubPostCard, HubComposer, HubProfile, PeopleYouMayKnow; `hub_posts/reactions/comments/comment_likes/post_views/saved_posts`.

### J2. Follows
- **Mechanics:** `hub_follows` (idempotent on 23505); suggestions `getSuggestedFollowees` (mig 091) + friend-of-friend `getRecommendations`; mutual-follow-since anniversary; follow notification (mig 041, recipient-language).
- **UI/deps:** FollowSuggestionRail, HubProfile follow button.

### J3. Stories
- **Mechanics:** 25h ephemeral (10/window cap); overlays JSONB (text/emoji/sticker, max 50, mig 111); privacy public/friends/crew/private + story_blocks; polls (`cast_vote` mig 112); emoji reactions (6-whitelist mig 097); view/like insights; highlights (persistent albums mig 099); status notes (≤60 char blurbs).
- **UI/deps:** StoriesRow, StoryViewer; `stories/story_views/likes/blocks/poll_votes/reactions/highlights/highlight_items/status_notes`.

### J4. Direct Messages
- **Mechanics:** 1:1 + group (3–10, mig 116); message types text/voice/gif/sticker/trade/duel/crew_invite (mig 115); reactions (`toggle_dm_reaction` 064); quote-reply; read receipts (localStorage instant + `read_at`); message requests (stranger filtering via `accepted_emails` mig 113); scheduled send + soft delete (mig 114); pinning (mig 062); Tenor GIFs; voice memos.
- **UI/deps:** Messages page, HubMessages, MessageThread/Input, VoiceMemoRecorder; `hub_conversations/messages`, `dm_message_reactions`.

### J5. Crews
- **Mechanics:** Teams (cap 16, atomic `joinCrew` mig 075); crew chat (text/xp_fuel/roll_call/regimen_share, pinning, expiry); roll call votes; XP fuel claim (dedupe); assigned regimens (clone); crew challenges (mig 104, metric targets); crew wars (team-vs-team, atomic `contributeWarXp` 076); crew stories; stats + first-achievers; discovery (mig 090).
- **UI/deps:** CrewsSection, CrewChat, CrewHeader, CrewStats; `crews/crew_members/messages/challenges/wars/war_contributions/xp_claims/assigned_regimens/roll_call_responses`.

### J6. Moderation & Safety
- **Mechanics:** Content reports (mig 007/078/103 statuses + moderator RPCs); full-scope blocks (mig 106, severs follows + mirrors story_blocks); soft mutes (mig 107, client filter); 8-layer profanity filter (`profanityFilter.js`: homoglyph/leet/zero-width/NFKD/star-mask) on posts/comments/crew names/challenge/highlight titles/username.
- **UI/deps:** ReportModal, SettingsPanel blocked/muted lists, AdminReports; `hub_reports`, `bug_reports`, `user_blocks`, `user_mutes`.

### J7. Referrals / Live / Status
- **Mechanics:** Referral codes (`get_my_referral_code`/`claim_referral` mig 089, `?ref=` capture); live workout sessions (`hub_live_sessions` realtime channel, viewer count); status notes.
- **UI/deps:** referral card, LiveSessionCard/Broadcaster, ActivityFeed.

## K. AI COACH
- **Functional summary:** Chat coach that answers training/nutrition/recovery questions grounded in the user's own data.
- **Granular mechanics:** `coach.js` calls the **`coach-chat` Edge Function** (Anthropic Haiku, key server-side, ≤150 words, 12s timeout, capped at 20 msg/user/day by migration 305). It receives the question, the last 8 turns, and a training digest from `buildCoachContext()` in `responders.js`, and returns structured `{kind, reply, goal}` — `kind:'plan'` hands off to the deterministic `planBuilder` so a generated session stays saveable and reproducible. Replies are written in the user's app language. **On any failure** (not deployed / no key / offline / capped) it falls through to the original `aiCoach/intents.js` regex router → `responders.js`, so the Coach works with zero config. Voice input (Web Speech API). Returns `{reply, intent, source:'llm'|'plan'|'rules', plan?, capped?}`.
- **UI/deps:** Coach page, CoachChat, StarterPlanHeroCard (Workout); no dedicated table (reads existing entities).

## L. GYM ECOSYSTEM
- **Functional summary:** National network of physical gyms — register/verify, join by 8-char code or QR, per-gym feed/events/leaderboard/about, national map.
- **Granular mechanics (migs 135–141):** Verification queue → admin approves (`is_app_admin`) → `generate_flexyn_code` mints code; `join_gym_by_code`; `get_gyms_in_bbox` (debounced map queries, member_count denormalized via trigger); `get_gym_leaderboard` (volume/xp/streak, RANK with deterministic tiebreaker joined_at→user_id per mig 141, includes zero-stat members); gym feed (reactions atomic `toggle_gym_feed_reaction` mig 141 + membership-gated, comments, pinned one-per-gym, image upload); events (datetime-local→ISO offset fix, upcoming/past scope, creator/owner delete, RSVPs going/maybe/cant mig 139); about (hours/amenities/photos mig 140); member-join push (mig 136); 25 demo gyms seeded (mig 137).
- **UI/deps:** MyGyms, GymHub (Feed/Events/Leaderboard tabs), GymMap (MapLibre, cancellation-guarded pin render), RegisterGym, GymEdit, AdminGyms, GymSignageCard (QR poster), QrCodeScanner, MemberDirectoryModal; `gym_businesses/verification_queue/members/events/feed_posts/feed_post_reactions/feed_comments/event_rsvps`.

## M. TRAINER TIER (Creator Marketplace)
- **Functional summary:** Trainers package regimens as paywalled programs; 15% platform / 85% creator split; Stripe-ready, currently mock-fulfilled.
- **Granular mechanics (mig 143):** `user_profiles += is_trainer/stripe_connect_id/trainer_bio`; `regimens += is_public_free`; `trainer_listings` (price_cents ≥100, is_published, sales rollups) + `trainer_purchases` (stripe_payment_intent_id UNIQUE, split CHECK reconciles, UNIQUE(user,listing), is_mock); gated regimen read = additional permissive SELECT policy (free OR purchased) OR'd with owner policy; fulfillment server-only via `checkout-session` Edge Function (mock mode mints intent + service-role insert; live mode scaffolds Stripe PaymentIntent w/ application_fee + transfer_data); `get_my_trainer_revenue` RPC + stats trigger.
- **UI/deps:** TrainerStudio (/trainer/studio: revenue, Connect status, listing CRUD, ListingFormModal w/ live split preview), TrainerMarket (/trainer/market: unlock CTA → checkout → open program), Market entry card; `trainerMarket.js`, `trainerSplit.js`.

## N. MARKETPLACE (coin-based, pre-existing)
- **Functional summary:** Player-to-player regimen/sticker sales in Flex Coins with ratings, trade history, wishlist, featured slots, bundles.
- **Granular mechanics:** `marketplace_listings` (seller_user_id/email, asking_price, status mig 009) + atomic purchase (mig 025, post-admin cleanup), sold counts (119), wishlist (121), featured (122), bundles (134).
- **UI/deps:** Market page, MarketplaceFeed, TradeHistory; distinct from the trainer tier.

## O. NOTIFICATIONS & PUSH
- **Functional summary:** In-app bell feed + Web Push across 14 categories with per-category prefs, snooze, and quiet hours.
- **Granular mechanics:** `notifications.js` (14 NOTIFICATION_TYPES; self-targeted insert vs cross-user `notify_X_for` SECURITY DEFINER RPCs with server-side 15-language text); AFTER INSERT trigger (mig 034) → `send-push` Edge Function via pg_net (no-op without VAPID/quiet hours mig 098). Per-category prefs JSONB (singular keys, mig 036/083), snooze (127), quiet hours (098/100). Crons: streak-break (035), welcome-back + quest-expiry (037).
- **UI/deps:** NotificationBell, NotificationPanel, Notifications page; `notifications`, `push_subscriptions`, `usePushSubscription.js`, `send-push` function.

## P. SETTINGS / PROFILE / THEME / ACCOUNT
- **Functional summary:** Profile drawer + settings: identity, units, language, appearance, haptics/sounds, notification prefs/snooze/quiet hours, body stats, story privacy, 2FA, connected apps, data export, blocks/mutes, bug report, sub-menu launchers (Bag, Gyms, Journal, Debrief, Injuries, Achievements), sign-out, account delete.
- **Granular mechanics:** `ProfileMenu.jsx` (drawer, Esc/touch outside-close, typed-DELETE account-confirm, sign-out preserves journal, logout-before-wipe, cookie/IDB/localStorage wipe); `SettingsPanel.jsx` (toggles, body-stat edit w/ range validation, quiet hours, per-category push, bar-weight-in-volume toggle mig 143); ThemeContext (light/dark + 11 level/loot themes, inline FOUC bootstrap in index.html); 2FA (`twoFactor.js`), data export (`dataExport.js`); account deletion (`_invokeDeleteAccount` purges ~35 tables incl. gym + trainer + wellness, partial-failure surfaced).
- **UI/deps:** ProfileMenu, SettingsPanel, ThemePicker/Selector, AccountDeletedScreen, TwoFactorSection, ConnectedAppsSection, BugReportDialog; localStorage `fn-*`, `user_profiles` columns.

## Q. WEEKLY DEBRIEFS
- **Functional summary:** Auto-generated weekly recap cards (volume, sessions, top lift, XP, vs-prior delta) with PNG share + epoch tagging.
- **Granular mechanics:** `debriefs.js` `generate_my_weekly_debrief` RPC (SECURITY DEFINER, upserts from logs); `weeklyRecap.js` rolling-7-day metrics + PR detection; `safeSelect` for column tolerance; auto-generate-once guard; html2canvas export.
- **UI/deps:** DebriefVault (Weekly Summary), WeeklyDebriefCard, WeeklyRecap; `weekly_debriefs`.

---

# 3. STATE MANAGEMENT & DATA SCHEMA

## 3.1 State Lifecycle

**Server state — TanStack React Query.** Single `queryClientInstance`. Keys namespaced by `user.email`/`user.id` (`['workoutLogs', email]`, `['userProfile', email]`, etc.). Default gcTime 5 min; per-query `staleTime` (30–60s typical). Mutations use optimistic `onMutate` → snapshot → patch → `onError` rollback → `onSuccess`/`onSettled` `invalidateQueries`. Dedup across components sharing a key.

**Global UI state — 7 React Contexts (all localStorage-backed, most server-synced):**

| Context | State | localStorage | Server column |
|---|---|---|---|
| AuthContext | user, isAuthenticated, isLoadingAuth | session (Supabase) | user_profiles |
| LanguageContext | language (15) | `fn-language` | preferred_language |
| SettingsContext | 9 toggles | `fn-*` | — (device-local) |
| ThemeContext | themeId, lootThemeId, darkMode, activeAnimation | `fn-theme/fn-loot-theme/fn-dark-mode` | preferred_theme/loot_theme_id/dark_mode |
| WeightUnitContext | weightUnit (lbs/kg/stone) | `flexyn_weight_unit` | weight_unit |
| DistanceUnitContext | distanceUnit (mi/km) | `flexyn_distance_unit` | distance_unit |
| RestTimerContext | active/secondsLeft/defaultDuration/sound/voice | `fn-rest-timer-*` | — |

**Local component state** — `useState`/`useRef` for editor/form/modal state; `react-hook-form` for complex forms; custom hooks (`useWorkoutSessions` paused-draft persistence, `useFormDraft`, `useScrollRestoration`, `useNetworkStatus`, `useLongPress`, `useComebackProtocol`, etc.).

**Persistence tiers:** (1) Postgres (canonical, RLS) — all durable data + cross-device prefs; (2) localStorage — device prefs, paused workouts, journal entries, fasting window, scan history, dismissal flags (`flexyn.<feature>.<userId>` namespace); (3) sessionStorage — reconcile-once flags; (4) IndexedDB — Supabase/Workbox caches.

## 3.2 Schema Map (Postgres, RLS-enforced)

**Identity/core (mig 001–002):** `user_profiles` (id=auth.uid, email, username, bio, avatar_url, full_name, onboarding_*, total_xp, current_level, lifetime_xp, prestige_level, flex_coins, achievements_unlocked_count, milestone_capsules_awarded, total_volume_lbs, total_distance_meters, login/workout streaks + longest + freezes + last dates, league_tier, equipped_title/frame_id, preferred_theme/loot_theme_id/dark_mode, gender, birthday, height/weight + units, fitness_level/goals, training_days, country/state, privacy_mode, is_private, hide_from_search, notification_prefs JSONB, notification_snoozes, timezone_offset, cycle_tracking_enabled, calorie_cycling, daily_protein_goal_g, is_trainer, stripe_connect_id, trainer_bio, include_bar_in_volume, account_reset_at). Auto-created by `handle_new_user` trigger.

**Training:** `workout_logs` (exercises JSONB, total_volume, duration_min, idempotency_key, volume_credited_at), `regimens` (days JSONB, is_active, is_public_free), `workout_templates`, `regimen_reviews`, `exercise_forms`, `injury_logs` (mig 052), `gauntlet_challenges`/`user_gauntlet_progress`/`completions`, `weekly_gauntlets`/`attempts`, `duels`, `bounties`/`bounty_claims`, `nemesis_assignments`.

**Cardio/wellness:** `cardio_logs`, `sleep_logs`, `mood_logs`, `cycle_logs`, `recovery_scores`, `body_metrics` (+7 measurements), `goals`.

**Nutrition:** `nutrition_logs`, `food_items`, `nutrition_recipes`, `meal_plans`.

**Gamification:** `user_capsules`, `user_inventory`, `leagues`/`league_members`, `monthly_league_members`, `user_daily_quests`, `achievements`, `streak_rescues`, `seasonal_shop_items`, `bundle_deals`.

**Social:** `hub_posts`/`reactions`/`comments`/`comment_likes`/`post_views`/`saved_posts`, `hub_follows`, `stories`/`story_views`/`likes`/`blocks`/`poll_votes`/`reactions`/`highlights`/`highlight_items`, `status_notes`/`note_likes`, `hub_conversations`/`hub_messages`/`dm_message_reactions`, `crews`/`crew_members`/`crew_messages`/`crew_challenges`/`crew_wars`/`war_contributions`/`xp_claims`/`assigned_regimens`/`roll_call_responses`, `hub_reports`/`bug_reports`, `user_blocks`/`user_mutes`, `hub_live_sessions`, `notifications`, `push_subscriptions`.

**Marketplace/gym/trainer:** `marketplace_listings`/`marketplace_wishlist`, `gym_businesses`/`verification_queue`/`members`/`events`/`feed_posts`/`feed_post_reactions`/`feed_comments`/`event_rsvps`, `trainer_listings`/`trainer_purchases`.

**RLS pattern:** owner access via `auth.uid() = user_id` or `auth.email() = created_by`; public-read for social discovery; gated reads via membership/purchase EXISTS; writes via owner WITH CHECK or service-role-only (trainer fulfillment). `ALTER DEFAULT PRIVILEGES` (mig 085) auto-grants service_role on new public tables.

---

# 4. EDGE CASES, VALIDATIONS & ERROR HANDLING

## 4.1 Input Validations
- **Workout:** future-date ceiling (UTC+14); realistic weight/reps caps (`realisticLimits.js`, demographic-scaled, silently clamped + toast); per-exercise + per-muscle-group set caps (`workoutFatigue.js`); implausible-volume detector (hard wall, dismiss-only); empty-set filter; RPE 1–10, RIR 0–10 clamped; numbers-only weight guard; idempotency key dedupe.
- **Nutrition:** `min="0"` (client-only — no upper bound or server CHECK; 5,000g protein possible via API); water 200oz/day cap; macro↔calorie NOT reconciled (math gap).
- **Profile/Settings:** weight 50–800 lb, height 24–96 in, birthday future/age-13/age-120 guards.
- **Onboarding:** age 13 COPPA gate; username sanitization + profanity (mig 050).
- **Social:** 8-layer profanity (`profanityFilter.js`) on posts/comments/crew/challenge/highlight/username; story overlay cap 50; crew capacity 16; group DM 3–10.
- **Gym/Trainer:** Flexyn code 8-char `[A-HJ-NP-Z2-9]`; listing price_cents ≥100; split CHECK reconciles; injury date 10-year lower bound.
- **Cardio:** MET calorie ceiling + per-type speed bounds + VO2max valid ranges.

## 4.2 Error Boundaries & Resilience (6-layer)
1. **Write strip-and-retry** (`db.js` create/updateMe) — strips `42703`/`PGRST204` unknown columns, retries ≤15–20× → migration can lag deploy.
2. **Read strip-and-retry** (`safeSelect.js`) — same for explicit-column SELECTs, ≤20×, propagates real errors (RLS/network/type).
3. **Per-region ErrorBoundary** — wraps each major card (Dashboard/Workout/Progress/Goals/Nutrition/FormCoach/etc.); catches render throws so one card can't blank the page.
4. **Route-level ErrorBoundary** (`App.jsx`, every route) with `label` for Sentry tagging.
5. **Recovery affordances** (`ErrorBoundary.jsx`) — Go Home / Try Again / Copy Details; auto-reset on `location.pathname` change; chunk-load-failure → hard reload (stale-PWA recovery via `?reset-sw=1` kill-switch in index.html).
6. **Async capture** (`reportError.js`) — catch-blocks/mutation-onError → Sentry with `{feature}` tag + level.

**Graceful-degradation conventions:** every RPC wrapper falls back to `[]`/`null`/`{ok:false}` on `42883`/`42P01` (pre-migration host) so unbuilt-pipeline UIs show empty states, never crash. EmptyState components everywhere. Optimistic updates roll back on error with a toast. Network-drop during workout save → optimistic row reverts + retry toast; paused draft persists to localStorage; reconcile pass repairs counters on next Dashboard mount. Boot-time error reporter in index.html paints the error into #root if React never mounts.

**Concurrency:** all shared-counter writes are atomic SECURITY DEFINER RPCs (XP/coins/volume/distance/league-XP/post-counters/member-counts/war-scores/overthrow/gauntlet/quest-claim/duel-resolve); fallbacks to legacy read-modify-write only on confirmed-missing-RPC hosts (the workout volume fallback was tightened in mig 142 to stop re-introducing the race on transient errors).

---

## Known limitations of this document
1. At 162K LOC this is **feature/subsystem-complete, not a line-by-line transcription**.
2. A handful of subsystems (exact rarity-odds tables, the full 15-quest catalog, every i18n key) exist in code but are summarized rather than enumerated here.
