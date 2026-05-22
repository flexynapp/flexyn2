# CLAUDE.md

Working notes for Claude sessions on this repo. Skim this first — it
will save you ~15 minutes of exploration on your first task.

## What this is

**Flexyn** — a fitness companion PWA. React + Vite + Supabase + Tailwind +
Radix UI + Tanstack Query + Framer Motion. Five top-level routes
(Dashboard, Workout, Hub, Progress, Nutrition) plus four hoisted-from-
Hub destinations (Messages, Market, Coach, Onboarding). PWA installable
on iOS / Android / desktop. 15 supported languages.

The README has the production overview; this file is for working
conventions a contributor needs day-to-day.

## Session journal — May 2026 batch

A single long session shipped migrations 080–099 plus ~17,000 lines of
new product code. Conventions/patterns introduced here that future
contributors should match:

- **Migration order matters and we DON'T renumber retroactively.** When
  numbering parallel commits, pick the next free `NNN` at branch start.
  If two branches independently claim the same number, the second-to-
  land renames its file. Files at the same NNN are tolerated when
  bodies are disjoint (e.g. `054_duels.sql` + `054_bio_profanity_check.sql`).
- **The push pipeline is live and gated by `app.send_push_url` /
  `app.send_push_secret` via Supabase Vault** (not `ALTER DATABASE` —
  managed Supabase blocks that). The `notify_push_fanout` trigger short-
  circuits when secrets are missing, so new RLS tables don't break
  push delivery during partial-deploy windows. As of mig 098 the trigger
  also short-circuits during the user's quiet hours.
- **Per-category notification preferences use SINGULAR keys** (streak,
  quests, league, social, achievements, engagement, competitive). The
  category mapping was unified in migration 083 after migration 065
  silently regressed it to plural names — see the migration head comment
  for the full story.
- **Three share cards follow the same Canvas 2D pattern** (no
  html2canvas dep): WorkoutShareCard (purple/fuchsia), WeeklyRecapShareCard
  (emerald/cyan), PRShareCard (gold/crimson). Color rotation gives each
  moment its own identity; the share API + download fallback chain is
  identical.
- **Six celebration helpers each have a distinct vibration + confetti
  signature** (goal / first-workout / first-regimen / first-goal /
  first-meal / pr). When adding a 7th, give it its own signature —
  see `src/lib/prCelebration.js` for the pattern. Multi-celebration
  events should route through `src/lib/rewardQueue.js` to avoid
  overlapping toasts.
- **`tFallback('key', 'English fallback')`** is the standard i18n call.
  English fallbacks ship inline; native translators fill non-English
  locales via `src/lib/i18n-*.js` part files (the splitter aggregates).
  Don't ship machine-translated copy.
- **localStorage flags for per-device UX state** follow the
  `flexyn.<feature>.<userId>` namespace pattern. Examples:
  `flexyn.celebratedCrewWars.<userId>`, `flexyn.pendingReferralCode`,
  `flexyn.pushOptInDismissed.<userId>`, `flexyn.iosInstallDismissed.<userId>`,
  `flexyn.onboardingState.<userId>`.
- **Schema drift audit lives at `supabase/migrations/_audit_schema_drift.sql`**
  (leading underscore keeps it out of auto-runners). Paste it into the
  SQL Editor to surface column-type drift, missing FKs, missing
  service_role grants, and orphan rows. Migration 085's ALTER DEFAULT
  PRIVILEGES auto-grants service_role on new public tables, so new
  drift in that dimension shouldn't accumulate.

The biggest user-facing additions this session:

- Push fanout for nemesis, gauntlet, comments+replies, memories,
  referrals (mig 081–089)
- Streak rescue (mig 087) — one-tap save on a missed day, once/month
- Onboarding 7-day nudge sequence + iOS install banner + push opt-in
- Live activity rail + follow suggestions + crew suggestions + friend
  leaderboards on Hub
- Workout calendar grid + workout memory card + workout suggestion +
  PR celebration + repeat-from-log on Dashboard/Workout
- Hydration ring + mood log + sleep log + recovery score + readiness
  card (mig 094–097)
- Voice input (set logging + Coach dictation)
- Built-in program templates + workout templates + bar inventory
- User-created bounties + crew challenges + quiet hours + dedicated
  notification page + story emoji reactions + story highlights schema

## Two engineers, parallel sessions

Two Claude sessions edit this repo concurrently — yours and a teammate's.
**Before any non-trivial edit, fetch origin and rebase.** Direct pushes
to `main` are the convention here (no PR workflow). Push your feature
branch first, then fast-forward `main`. Never force-push `main`.

See: `~/.claude/projects/C--Flexyn/memory/feedback_parallel_sync.md`.

## Database migrations

- All migrations live in `supabase/migrations/NNN_*.sql` in execution order.
- The runbook is [docs/migrations-runbook.md](docs/migrations-runbook.md)
  with a state-check query at the bottom — paste it into Supabase SQL
  Editor to see what's deployed.
- **Every `CREATE POLICY` must be guarded with `DROP POLICY IF EXISTS`** —
  Postgres doesn't support `CREATE POLICY IF NOT EXISTS`, so a retry of a
  partially-applied migration fails with `42710` otherwise. Migrations
  047, 048, 050, 051, 052, 053 follow this pattern; 043 and 044 were
  patched after the fact. See:
  `~/.claude/projects/C--Flexyn/memory/feedback_postgres_policy_idempotency.md`.
- The same rule applies to triggers (`DROP TRIGGER IF EXISTS` before
  `CREATE TRIGGER`). Other idempotent constructs (`CREATE TABLE IF NOT
  EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE
  FUNCTION`, `INSERT ... ON CONFLICT DO UPDATE`) already self-guard.
- **Numbering with parallel engineers**: pick the next free `NNN` when
  you start. If two branches independently pick the same number, the
  branch that lands second renames its file to `NNN+1_*.sql` before
  pushing. Files at the same `NNN` are tolerated if their bodies are
  independent (current examples: `054_bio_profanity_check.sql` +
  `054_duels.sql`, and `055_crew_wars.sql` +
  `055_first_workout_capsule_flag.sql` — both pairs touch disjoint
  tables, so the alphabetical execution order is harmless). Don't add
  a third file at the same number — renumber instead.

## Push notifications

The pipeline is built; it just needs secrets to deploy. The full chain:

| Migration / file | Role |
|---|---|
| `033_push_subscriptions.sql` | Table + `upsert_push_subscription` RPC. Client opt-in lives in `src/lib/usePushSubscription.js`. |
| `034_notification_push_trigger.sql` | AFTER INSERT trigger on `notifications` → `pg_net.http_post` to the Edge Function. Trigger is a no-op when `app.send_push_url` / `app.send_push_secret` are unset, so the in-app row still lands. |
| `035_streak_break_reminders.sql` | Hourly cron, 15-language text helpers, pushes when a ≥2-day streak is about to break in user's local 18-21h. |
| `036_notification_prefs_and_language.sql` | Per-category opt-in JSONB on `user_profiles`. The 034 trigger reads it; muted categories skip push fanout (in-app row still inserts). |
| `037_welcome_back_and_quest_crons.sql` | Two more crons — welcome-back (3-30 day churned, hourly) and quest-expiry (incomplete dailies, every 15min). |
| `038_push_secrets_via_vault.sql` | Stores `app.send_push_secret` in the Vault rather than the postgres role. |
| `supabase/functions/send-push/index.ts` | Edge Function — VAPID delivery, 410-Gone cleanup, dual auth (Bearer JWT or X-Send-Push-Secret). |

**To actually start delivering pushes** (this is what's still missing):

1. `npx web-push generate-vapid-keys` on a dev machine.
2. `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=…
   VAPID_SUBJECT="mailto:ops@flexyn.app"
   SEND_PUSH_TRIGGER_SECRET="$(openssl rand -hex 32)"`.
3. Add `VITE_VAPID_PUBLIC_KEY=…` to the client build env so
   `usePushSubscription.js` exposes the opt-in toggle.
4. `supabase functions deploy send-push`.
5. In SQL Editor: `ALTER DATABASE postgres SET app.send_push_url =
   'https://<ref>.functions.supabase.co/send-push'` and
   `ALTER DATABASE postgres SET app.send_push_secret = '<step-2 value>'`,
   then `SELECT pg_reload_conf()`.
6. Verify with a self-targeted test push from the Settings panel.

**Patterns for adding new push types:**

- Self-targeted (notifying yourself, e.g. quest reset) → call
  `notifications.create({ userId, type, title, body, ... })` from the
  client. RLS lets you insert your own row; the trigger handles fanout.
- Cross-user (notifying someone else, e.g. friend follow, league win,
  duel result) → write a `notify_X_for(p_user_id, …)` SECURITY DEFINER
  RPC in a new migration following the pattern in
  `041_friend_notifications_i18n.sql`. Server-side text helpers go in
  the same migration with branches for all 15 languages, mirroring
  `streak_break_text`. The RPC inserts into `notifications`, the
  trigger does the rest.
- Cron-driven (time-window pushes like welcome-back) → mirror the
  atomic `UPDATE…RETURNING last_X_nudge_at` claim pattern in
  `037_welcome_back_and_quest_crons.sql` so concurrent cron firings
  can't double-send.

## Resilience layers

The app uses a layered approach to failure handling — each layer catches
a different class of bug:

| Layer | Where | What it catches |
|---|---|---|
| Write strip-and-retry | `src/api/db.js` `updateMe` + `makeEntity().create` | 42703 / PGRST204 missing-column on inserts/upserts |
| Read strip-and-retry | `src/api/safeSelect.js` | Same, but for `supabase.from().select()` chains |
| Per-region ErrorBoundary | Wrapped around each major card on Dashboard / Workout / Progress / Goals / Nutrition | Render-time throws inside the section |
| Route-level ErrorBoundary | `src/App.jsx` on every route | Render-time throws in a whole page chunk |
| Recovery affordances | `src/components/ErrorBoundary.jsx` | "Go to Home" + "Try again" + "Copy details" + auto-reset on `location.pathname` change |
| Async error capture | `src/lib/reportError.js` | catch-block / mutation-onError failures → Sentry with feature tags |

**Patterns to use:**

- New `.select()` with explicit column lists → wrap in
  [safeSelect](src/api/safeSelect.js). Existing examples:
  `HubProfile.jsx`, `stories.js`, `debriefs.js`, `LoginStreakBanner.jsx`.
- New catch blocks for async failures → use
  [reportError](src/lib/reportError.js) with a `feature` tag (e.g.
  `workout.save`, `onboarding.starter-regimen`).
- New page → wrap in `<ErrorBoundary label="...">`. New region inside an
  existing page → same.

## Celebration system

There are five "first-X" milestone celebrations + one completion. Each
fires confetti + haptic + toast + Sentry breadcrumb, but uses a **distinct
vocabulary** so a user feels each as its own moment:

| Helper | Trigger | Haptic | Confetti shape | Emoji | Palette |
|---|---|---|---|---|---|
| `fireGoalCelebration` | Goal completed | `[15,50,15]` | 2 side bursts y:0.55 | 🏆 | Green/yellow |
| `fireFirstWorkoutCelebration` | First workout logged | `[20,60,20,60,80]` | Center + 2 sides y:0.55-0.6 | 🎉 | Orange/green |
| `fireFirstRegimenCelebration` | First regimen saved | `[15,45,15,45]` | 2 side bursts y:0.6 | 💪 | Purple/pink |
| `fireFirstGoalCelebration` | First goal created | `[10,30,80]` | 1 top burst y:0.3 | 🎯 | Blue/teal |
| `fireFirstMealCelebration` | First meal logged | `[12,30,12,30,12]` | 2 bottom corners y:0.85 | 🥗 | Warm food |

All live in `src/lib/*Celebration.js`. Each is well-tested in
`src/lib/__tests__/*Celebration.test.js`. **Don't add another celebration
without giving it a distinct haptic + confetti signature.**

## i18n discipline

- 15 supported languages: `en es fr de pt it ja ko zh ar hi ru tr pl nl`.
- Per-domain translation files: `src/lib/i18n-*.js` (e.g. `i18n-coach.js`,
  `i18n-goals.js`, `i18n-discovery.js`). Each exports a `{ <lang>:
  { 'key': 'value' } }` object.
- At build time `scripts/split-i18n.mjs` merges every part file into
  per-language aggregates under `src/lib/i18n-langs/`.
- New keys: add to a part file with English at minimum. Use the
  `t(key) || 'English'` fallback pattern at the call site so missing
  translations surface a sensible string, never a key code.
- Adding a new part file: name it `i18n-<domain>.js` and the splitter
  picks it up automatically. Export shape must match existing files.
- **Don't ship machine-translated copy** on prominent surfaces. If you
  can't get native-quality translations for all 15 languages, ship
  English-only for the missing ones with a `TODO(i18n)` comment in the
  file head.

## Testing

- Framework: vitest, jsdom. Setup in `src/test/setup.js`.
- Existing tests: `src/lib/__tests__/`, `src/lib/data/__tests__/`,
  `src/components/__tests__/`, `src/api/__tests__/`, `src/hooks/__tests__/`.
- Supabase mock pattern: see `src/lib/__tests__/capsuleMilestones.test.js`
  or `src/lib/data/__tests__/injuries.test.js` for the chainable-mock shape.
- Confetti tests: `canvas-confetti` mock leaks across tests because
  `setTimeout`-scheduled bursts from prior tests can land in later
  buffers. Filter the mock calls by a **unique signature** (e.g. the
  helper's distinctive origin coords) rather than asserting on exact
  call count.
- `npm run test` — full suite. `npm run test:watch` — watch mode.
  `npm run test:coverage` — V8 coverage. As of writing: **432/432 tests
  passing across 30 files**.

## Build & analyze

- `npm run dev` — Vite dev server.
- `npm run build` — production build. Vite + manual chunking in
  [vite.config.js](vite.config.js) splits the heaviest deps into their
  own vendor chunks (`vendor-tfjs`, `vendor-supabase`, `vendor-charts`,
  `vendor-motion`, etc.).
- `npm run analyze` — build with `ANALYZE=true` so
  rollup-plugin-visualizer writes a treemap to `dist/bundle-stats.html`.
  Use this when adding a substantial library or wondering where bytes
  went.
- Lazy-loading rule: modals and tabs that only mount on user action
  should be `React.lazy()` + `<Suspense fallback={null}>`. Existing
  examples: `DebriefVault`, `InjuryForm`, the page chunks in `App.jsx`.
- `html2canvas`, `canvas-confetti`, `@zxing/browser`, and `maplibre-gl`
  are excluded from the `vendor-misc` chunk so their dynamic imports
  get their own lazy chunks. Don't break that — see the `manualChunks`
  function in vite.config.

## ESLint

- `npm run lint` — must exit clean before any push.
- Common stumble: teammate's commits sometimes land unused imports
  (`X`, `useCallback`, etc.). Those are chore commits — fix in a
  separate small commit so the blame stays clean.

## File locations cheat sheet

- New page → `src/pages/<Name>.jsx`, registered as a lazy import in
  `src/App.jsx`.
- New data-layer function → `src/lib/data/<table>.js`. Export named
  functions, use `supabase` from `@/api/supabaseClient`, wrap
  column-named reads in `safeSelect`.
- New component → `src/components/<area>/<Name>.jsx`. Components for
  Dashboard go in `dashboard/`, hub in `hub/`, etc.
- New lib helper → `src/lib/<helper>.js`. If it's a celebration, mirror
  one of the existing `*Celebration.js` files.

## Workflow

1. `git fetch origin && git rev-list --left-right --count HEAD...origin/main`
   before any work. If origin is ahead, rebase.
2. Edit. Run `npm run lint` + `npm run build` (and `npm run test` if
   logic changed).
3. Commit with a multi-paragraph message that explains the why, not just
   the what. Use HEREDOC so quotes survive.
4. `git push origin <branch>` — push the feature branch first.
5. `git push origin <branch>:main` — fast-forward main. Only after the
   branch push succeeds.
6. Update tasks via `TaskUpdate` (this session uses TaskCreate /
   TaskUpdate / TaskList — `TodoWrite` was deprecated mid-session).

## Things that are intentionally out of scope right now

- LocationStep.jsx was deleted; no country/state collection in
  onboarding until the team makes a product decision.
- The `is_active` regimen column is dormant — schema is there but
  nothing reads/writes it.
- Server-side profanity check is on `username` only; `bio` is still
  client-only.
- Weekly Debriefs migration 051 needs an Edge Function +
  `app.debrief_func_url` + `app.debrief_cron_secret` to actually
  populate. Teammate owns that follow-up.
- i18n: discovery cards + ~21 Hub fallback keys still default to English
  on 8 of 15 languages. Needs a native-speaker pass. Also: the new
  `recap.*` keys used by `src/components/dashboard/WeeklyRecap.jsx`
  are English-only via `tFallback(key, 'English')`; safe to ship, but
  worth a translation pass.
- i18n translation gap: an audit pass found ~128 keys missing in
  Arabic, Chinese, and Russian relative to English. Many are toast
  messages and validation copy. Needs a native-speaker review pass
  per the "Don't ship machine-translated copy" rule. Affected files:
  `i18n-bug-report.js`, `i18n-hub.js`, `i18n-goals.js` and others —
  search for non-`en` blocks with fewer keys than the `en` block.
- RTL polish: `dir="rtl"` is already wired on `<html>` for Arabic in
  LanguageContext, but ~20 components still use hardcoded `text-left`/
  `text-right`/`ml-`/`mr-` Tailwind classes that don't flip. Listed
  in the audit. Each needs testing in both directions, so it's a
  per-file cleanup as developers touch those files. Use logical
  properties (`text-start`/`ms-`/`me-`) or `rtl:` modifier overrides.
- `.toLocaleString()` migration: `src/lib/intl.js` is the new util
  (`useNumberFormatter` / `useDateFormatter` / `formatNumber` /
  `formatDate`). 3 highest-traffic sites already swapped in
  (WeeklyRecap, StatsHubModal, LeaderboardsContent). The remaining
  `.toLocaleString()` calls across the app are mechanical one-line
  swaps when developers next touch those files.
- Push pipeline (migrations 033-039 + the `send-push` Edge Function)
  is built but not deployed. VAPID secrets + `ALTER DATABASE postgres
  SET app.send_push_url/_secret` haven't been set. See the "Push
  notifications" section above for the deploy checklist.
- Competitive-feature pushes are wired:
  • Duels — `notify_duel_invite_for` / `_result_for` (mig 065)
  • Bounties — `notify_bounty_claim_for` / `_beaten_for` (mig 069)
  • Crew Wars — `notify_crew_war_started_for` / `_resolved_for` (mig 069)
  • Nemesis assigned — `notify_nemesis_assigned_for` (mig 081)
  • Nemesis overthrown — self-celebration in `performOverthrow`,
    `nemesis_overthrown` → competitive (mig 102)
  • Gauntlet path completion — self-targeted in `completeGauntletPath`
  • Weekly gauntlet started — hourly cron fans out on status flip
    upcoming→active to opted-in active users (mig 082)
  • Crew challenge created / completed — per-member fanout via
    `notify_crew_challenge_*_for` RPCs (mig 103)

  Still NOT pushing (pick any of these if extending):
  • Individual gauntlet-challenge completions — intentional, in-app
    celebration only.
  • Crew-challenge progress milestones (25/50/75%) — intentional,
    too noisy; chat header shows progress.
  • Crew-challenge expiry without hitting goal — intentional silent
    failure; a "you missed your goal" push reads as scolding.
  • "You got dethroned" cross-user push to the overthrown nemesis —
    skipped intentionally; likely demotivating.
