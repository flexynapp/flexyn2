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
- **The single most-common defect class shipped this session** has
  been references to nonexistent columns / functions in new
  migrations and RPCs — caught and patched across 100 (timezone_offset
  vs timezone_offset_minutes), 101 (weekly_xp/volume/sessions on the
  wrong table, total_posts nonexistent, grant_flex_coins undefined),
  109 (followed_email vs followee_email on hub_follows — broke 100%
  of Block-button clicks). Before writing a new migration that
  references existing schema, **grep for the actual column / function
  name in the migrations directory** rather than typing what you
  expect it to be. Same rule for SECURITY DEFINER RPCs that pass
  user-supplied identifiers: gate on auth.uid() server-side, not
  on the client-supplied param (108 was a privacy leak from
  trusting client-passed email).

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

**The pipeline IS deployed.** (This section previously said it wasn't —
that was stale; audited 2026-07-30, see the status block below.) The full
chain:

| Migration / file | Role |
|---|---|
| `033_push_subscriptions.sql` | Table + `upsert_push_subscription` RPC. Client opt-in lives in `src/lib/usePushSubscription.js`. |
| `034_notification_push_trigger.sql` | AFTER INSERT trigger on `notifications` → `pg_net.http_post` to the Edge Function. Trigger is a no-op when `app.send_push_url` / `app.send_push_secret` are unset, so the in-app row still lands. |
| `035_streak_break_reminders.sql` | Hourly cron, 15-language text helpers, pushes when a ≥2-day streak is about to break in user's local 18-21h. |
| `036_notification_prefs_and_language.sql` | Per-category opt-in JSONB on `user_profiles`. The 034 trigger reads it; muted categories skip push fanout (in-app row still inserts). |
| `037_welcome_back_and_quest_crons.sql` | Two more crons — welcome-back (3-30 day churned, hourly) and quest-expiry (incomplete dailies, every 15min). |
| `038_push_secrets_via_vault.sql` | Stores `app.send_push_secret` in the Vault rather than the postgres role. |
| `supabase/functions/send-push/index.ts` | Edge Function — VAPID delivery, 410-Gone cleanup, dual auth (Bearer JWT or X-Send-Push-Secret). |

**Deployment status — audited 2026-07-30.** Every step of the old
"still missing" checklist is done except the last, and delivery is
currently BROKEN on a misconfigured URL:

| Step | State | Evidence |
|---|---|---|
| VAPID keys generated | ✅ | 87-char P-256 public key baked into the production bundle |
| `VITE_VAPID_PUBLIC_KEY` in client build env | ✅ | listed in the Netlify resolved config; key present in the served JS |
| `send-push` Edge Function deployed | ✅ | ACTIVE, version 17 |
| `send_push_url` / `send_push_secret` in Vault | ✅ | both rows exist, created 2026-05-21 |
| `pg_net`, fanout fn, trigger, `push_subscriptions` | ✅ | all present; 1 real subscription, 2 push-related crons |
| **Actually delivering** | ❌ | see below |

**The open bug: `send_push_url` looks wrong.** The only HTTP call
`pg_net` has on record from the fanout returned **404** (2026-07-26).
Probing the endpoints directly, both correct forms return 401
(function exists, auth required) and only a wrong slug returns 404:

```
401  https://<ref>.functions.supabase.co/send-push
401  https://<ref>.supabase.co/functions/v1/send-push
404  https://<ref>.functions.supabase.co/send_push     ← underscore, wrong
```

So the trigger is firing and reaching Supabase, but the path stored in
the Vault doesn't resolve. Every `net.http_post` caller in the applied
migrations is push-related, so that 404 can't be attributed to another
feature. Not confirmed by reading the secret — reading
`vault.decrypted_secrets` is (correctly) blocked — so verify and fix with:

```sql
SELECT vault.update_secret(
  (SELECT id FROM vault.secrets WHERE name = 'send_push_url'),
  'https://<ref>.functions.supabase.co/send-push'
);
```

Then confirm with a self-targeted push from Settings and re-check
`SELECT status_code, count(*) FROM net._http_response GROUP BY 1` — a 401
there would instead mean `send_push_secret` doesn't match the function's
`SEND_PUSH_TRIGGER_SECRET`, which is the other failure mode and is not
distinguishable from outside.

Note the trigger is a deliberate no-op when the URL/secret are missing, so
this class of failure is SILENT: in-app notification rows keep landing and
nothing surfaces an error. `net._http_response` is the only place it shows.

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

## Profile cache — invalidating `['userProfile']` does NOT refresh it

`db.auth.me()` returns a **module-level cache** (`src/api/profileCache.js`)
and only re-reads the row when that cache is empty. So this does nothing:

```js
await supabase.from('user_profiles').update({ some_flag: true }).eq('id', id);
queryClient.invalidateQueries({ queryKey: ['userProfile', email] }); // ← refetches
// ...and the refetch calls me(), which hands back the SAME stale object.
```

The symptom is nasty because the write **succeeds**: with an optimistic
local state the control flips, then the effect that syncs from `profile`
reads the old value back, so the toggle reverts on remount while the row
holds the new value. UI and database disagree and the user can't tell which
is real. This bit the cycle-tracker X, all four Settings privacy toggles,
story privacy, quiet hours, prestige, trainer status and the equipped
title/frame — see commits 88933c0, 208cf82, 7db3f83.

**The rule:**

- `db.auth.updateMe()` refreshes the cache itself → nothing to do.
- A **raw `supabase.from('user_profiles').update()`** or an **RPC** that
  changes the row → call `patchProfile({ ...the columns you changed })`
  from `@/api/profileCache` on success.
- **Import `@/api/profileCache`, never `@/api/db`, from a data module.**
  `db.js` registers a `supabase.auth.onAuthStateChange` listener at module
  scope, so importing it drags that listener in and breaks any test that
  stubs the supabase client — this is exactly how `gymRival.js` broke
  `gymRivalOverthrow.test.js`. `profileCache.js` is plain state with no
  imports and is safe anywhere.

**Do NOT patch these** — migration 142 rejects direct client writes to them
with `42501`, so a client-computed value would cache something that never
persisted, which is worse than being stale:

> `flex_coins` · `total_xp` · `current_level` · `prestige_level` ·
> `league_tier` · `login_streak` · `workout_streak` ·
> `longest_login_streak` · `longest_workout_streak` ·
> `milestone_capsules_awarded` · `referral_code` · `referred_by` ·
> `last_daily_chest_at`

`flex_coins` is doubly unsafe: migration 264's ledger trigger **clamps**
credits past the rolling ceiling, so even an accepted write may not store
the number you sent. For all of these, patch only with a value the **server**
returned (an RPC's payload), never one computed on the client. The existing
raw writes to those columns are deliberately guarded pre-030 / pre-173
fallbacks — leave them alone.

Not worth patching either: pure write-only columns nothing reads back
through `me()`, e.g. the `last_active_at` presence heartbeat in `Layout.jsx`
and `HubProfile.jsx`.

## AI Coach personalization

Everything that shapes a generated session lives in one pure module,
[trainingModifiers.js](src/lib/aiCoach/trainingModifiers.js). It takes
context and returns four bounded numbers plus the notes explaining them;
`generateWorkout` applies them. No I/O, no React — callers fetch the
context and pass it in.

```
buildTrainingModifiers({ goal, nutritionGoal, weeklyRateLbs, restrictions,
                         age, cycleState, feel })
  → { loadMultiplier, setsDelta, repDelta, restDeltaSec, notes[], applied }
```

`generateWorkout` takes three separate context inputs — `modifiers`,
`demographics` ({ gender, age, activityLevel }) and `excludeMuscleGroups`.
**All three default to inert**, so a caller that passes none gets the exact
workout the generator produced before any of this existed.

**Rules for anything added here:**

- **Clamp it.** Every output is bounded: load `0.8–1.1`, sets `±1`, reps
  `-4…+6`, rest `-30…+60s`. Stacked signals must never compound into a
  prescription nobody asked for. When you add an input, check the clamp
  still leaves room — a +30s age bonus on a +30s strength goal hit the old
  45s ceiling and silently collapsed two age bands into one value.
- **Explain it on the card.** Every adjustment pushes a `notes` string, and
  `CoachPlanCard` renders them. An automatic change to someone's training
  that isn't explained reads as a bug — a user who suddenly gets a lighter
  day must be able to see it was the deficit, the phase, or their check-in.
- **Verify with real numbers, not just tests.** Twice now, green tests hid
  a defect that printing the actual output across a range exposed
  immediately (the rest clamp; the goal-priority ordering).
- **Context flows IN.** These modules must not import `@/api/db` — see the
  Profile cache section. `planBuilder`'s test mocks `@/api/db` with only
  `entities.WorkoutLog`, so a `db.auth.me()` call there breaks it.
- **Both surfaces or neither.** Quick pick
  ([WorkoutQuickGenerator.jsx](src/components/coach/WorkoutQuickGenerator.jsx))
  and the chat path (`CoachChat` → `askCoach(user, msg, ctx)` →
  `buildCoachPlan`) must get the same context, or the two disagree about
  the same lift. Both were silently running on `{}` at different points.

**Cycle phase is deliberately weak.** A 2023 Frontiers systematic review
found no reliable effect of cycle phase on strength performance or on
adaptation; ACSM's guidance is to adapt to symptoms, not the calendar. So
phase moves load by **at most 5%**, never blocks a session, and is fully
overridden the moment the user answers the "how do you feel today?"
check-in — a reported symptom beats a predicted phase. Do not strengthen
this without new evidence. The one un-hedged phase note is ovulation
(ligament laxity → ACL risk), which surfaces as a warm-up cue, not a load
change. Cycle context is read **only** when `cycle_tracking_enabled` is on.

**Multi-goal profiles blend, they don't collapse.** Onboarding lets people
tick several goals and a profile carrying all six is normal.
`normalizeGoals()` returns every match and the rules are **averaged** —
summing would let strength+endurance cancel by luck and strength+speed
compound. `normalizeGoal()` (singular) still returns the dominant one for
callers that want a label. `mobility` contributes a note and no numbers, so
its note is re-added after the blend or averaging erases its only
contribution.

**Diet cuts volume, not load.** Intensity is what protects strength in a
deficit, so `lose` removes a set and leaves the bar heavy; `gain` adds one.

**Fuel notes are allergen-filtered.** `fuelNote()` checks the user's
`DIETARY_RESTRICTIONS` + `ALLERGENS` (via `loadRestrictions`) and never
names a food they can't eat. If a stacked combination rules out every named
option it falls back to unnamed macros rather than guessing. Never add a
food suggestion anywhere in the Coach without routing it through this.

**Starting weights use demographics.** `_demographicScale()` in
workoutGenerator scales the bodyweight multipliers by sex (upper and lower
body separately — the gap is far smaller in the legs), age and activity.
Unset or `other` sex takes a conservative middle value rather than
defaulting to male: over-prescribing a first working set is the direction
that hurts someone. Only applies when there's no history for that lift.

**Injuries must be passed.** `getExcludedMuscleGroups()` in
[injuries.js](src/lib/data/injuries.js) handles synergists (a serious
shoulder injury also drops chest and triceps). It and `excludeMuscleGroups`
both existed for months with zero callers connecting them, so an injured
user was still handed Overhead Press. Any new surface that generates a
workout has to resolve active injuries and pass them.

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

## Equipment picker (migration 268, July 2026)

Lifters can record the SPECIFIC implement they're using — their gym's
Hammer Strength row rather than "a row", or their own Bowflex 552s.
Docs: `docs/gym-equipment-picker-research.md` (evidence) and
`docs/gym-equipment-picker-prompt.md` (phase-by-phase build log).

Conventions a contributor must not undo:

- **Never ship manufacturer product photography or brand logos.** Brand
  and model names as TEXT are nominative use and fine; their imagery is
  not ours. Images come from users, falling back to drawn silhouettes.
  `ATTRIBUTIONS.md` has the full rule and `REFERENCE_IMAGES` in
  `src/lib/equipmentImage.js` is the (empty, licence-gated) slot for
  openly-licensed generics.
- **Controlled vocabularies live in one module and are additive-only.**
  `src/lib/equipmentCatalog.js` holds `BRAND_META`,
  `IMPLEMENT_TYPE_META` and `SEED_MODELS`, in the same slug→metadata
  shape as `src/lib/gymAmenities.js`. Adding entries is always safe;
  RENAMING a slug is a data migration, because slugs are persisted in
  `workout_logs.exercises` and `space_equipment`.
- **`classifyEquipment` (exerciseEquipment.js) is NOT the gate for the
  picker.** It's a coarse 9-way regex built for a filter pill where a
  miss is invisible, and it's wrong on ~25 of the exercises that matter
  most here — every Lat Pulldown variant falls to 'other', Machine and
  Cable Crunch fall to 'bodyweight', Barbell Hack Squat falls to
  'machine'. `implementTypeForExercise` overrides by name and falls back
  to it. Don't "fix" the classifier; its existing consumer and tests
  depend on current behavior.
- **Only add a `ladder` to a seed model when the exact settings are
  verified against the manufacturer's own spec.** `snapToSelectable`
  uses it to keep progressive-overload suggestions on weights the gear
  can actually be set to; a guessed ladder produces confidently wrong
  advice. Absent = no snapping, which is the safe default.
- **A gym's floor is the union of every member's `training_spaces` row
  for that gym**, not one canonical space. That's forced by the schema:
  `UNIQUE (owner_id, gym_id)` plus an INSERT policy requiring
  `owner_id = auth.uid()` means a member cannot create a space the gym
  owns. Trust tiers fall out of it — owner's space is authoritative,
  `verified_by_owner` is a blessed member find, the rest is
  member-submitted.
- **`equipment_models` has no client UPDATE or DELETE policy on
  purpose.** An UPDATE scoped to `submitted_by` would let a user flip
  their own `approved` flag and publish into the global catalog.
  Approval is service_role only.

**`gym_businesses.owner_id` is nullable ON PURPOSE — this is not drift.**
Migration 137 explicitly ran `ALTER COLUMN owner_id DROP NOT NULL` so the
25 seeded `Demo:` gyms could exist without an `auth.users` row behind
them, and documents the cleanup (`DELETE FROM gym_businesses WHERE
owner_id IS NULL AND name LIKE 'Demo:%'`). Real gyms come from
`approve_gym_verification`, which always sets `owner_id` from the
verification queue. Don't "restore" the NOT NULL and don't backfill
owners onto demo rows — an owned demo gym is worse than an ownerless
one, because it grants a real user edit rights over fake data.

Consequence worth knowing: the equipment tab's owner controls (Confirm /
"Listed by the gym") never render on a demo gym, because a demo gym has
no owner to be. That's correct behavior, not a bug.

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
  - **One deliberate exception exists**: `src/lib/i18n-equipment.js` (37
    short UI labels, machine-translated 2026-07-30 with Kegan's sign-off,
    on the reasoning that a reviewed-later label beats an English
    fallback). It marks itself as MT, tracks outstanding languages in an
    exported `REVIEW_PENDING`, and is guarded by
    `src/lib/__tests__/i18nEquipment.test.js`. **This is not a precedent**
    — don't machine-translate prose, onboarding, or marketing, and don't
    add a second exception without asking.

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

## Build guards (don't disable)

The build has an `onwarn` hook in `vite.config.js` that turns specific
Rollup warning codes into **build failures**. These were added after a
production crash on 2026-05-23 — a `inventory.listMine` call referenced
a non-existent named export, Vite's `logLevel: 'error'` setting silenced
the `MISSING_EXPORT` warning, and the bug shipped as a runtime crash.
The guard ensures that defect class can never silently land again.

Currently blocking:
- `MISSING_EXPORT` — `import { foo } from 'mod'` or `ns.foo` where
  `foo` isn't on the module's exports. Symptoms in production: silent
  `undefined`-call TypeError, or in some bundler configs a minified
  TDZ (`can't access lexical declaration 'oe' before initialization`).
- `UNRESOLVED_IMPORT` — module path doesn't resolve at build time.
- `PLUGIN_ERROR` — a Vite/Rollup plugin escalated to error (shouldn't
  be a warning anyway).

**If the build fails with `[vite-build-guard]`** — don't disable the
guard. The warning corresponds to a real bug. Fix the import, then
rebuild. If you have a defensible case for treating one as a false
positive (extremely rare), surface it explicitly rather than removing
the code from the blocking set silently.

## TDZ trap — declare const/let BEFORE first use

JavaScript hoists `function` declarations but **not** `const` or `let`.
Code that *reads* a const-bound name before its declaration line
throws `ReferenceError: can't access lexical declaration X before
initialization`. Dev mode masks some patterns (React's double-render,
JSX callback fns that only run after render); production minified
re-orders statements and the bug fires on the first render.

The 2026-05-23 production Hub crash was this exact pattern in
`HubPostCard.jsx`:

```jsx
function HubPostCard({ post }) {
  // ...
  useEffect(() => {
    if (... || isMine) return;     // ← reads `isMine`
    // ...
  }, [user?.email, post.id, isMine]);  // ← AND in deps array

  // ... 80 lines later ...
  const isMine = post.author_email === user?.email;  // ← declared LATE
}
```

The deps array `[..., isMine]` is evaluated synchronously when
`useEffect` is called, but `isMine` is in TDZ at that point. **Always
declare a `const` before its first use, including inside any
`useEffect` / `useMemo` / `useCallback` deps array.**

ESLint has `no-use-before-define` configured at `'warn'` level
(masked by `--quiet` in the default `npm run lint` script — run
`npx eslint .` to see all 141 existing warnings). Goal is to upgrade
to `'error'` once those are cleaned up. New code: don't add new
violations of this rule.

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
  column-named reads in `safeSelect`. If it writes `user_profiles`, read
  the "Profile cache" section above first — you almost certainly need a
  `patchProfile()` call, and you must import `@/api/profileCache` rather
  than `@/api/db`.
- New component → `src/components/<area>/<Name>.jsx`. Components for
  Dashboard go in `dashboard/`, hub in `hub/`, etc.
- New lib helper → `src/lib/<helper>.js`. If it's a celebration, mirror
  one of the existing `*Celebration.js` files.
- Anything that changes what the AI Coach programs → `src/lib/aiCoach/`,
  and read the "AI Coach personalization" section above first. New context
  inputs go through `buildTrainingModifiers` (clamped + explained on the
  card), not straight into `generateWorkout`.

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
6. **ALWAYS, after every push, send the user the SQL to run.** This is a
   standing instruction (kegan, 2026-05). Frontend ships via Netlify
   auto-deploy from `main`, but the DB is deployed by the user manually
   pasting SQL into the Supabase SQL editor — so a push is only "done"
   once they have the matching SQL. After each push, report EITHER:
     • the pending migration(s) as a copy-paste block, OR
     • "No SQL needed — frontend only" when the change touched no
       migrations / DB objects.
   Don't wait to be asked. See the paste-safety rule below — the SQL
   you hand over must survive the user's clipboard pipeline.
   **MANDATORY, NO EXCEPTIONS (kegan, 2026-05, mobile):** ALWAYS paste the
   actual SQL inline in chat inside a fenced ```sql code block so it has a
   one-tap copy button. NEVER tell the user to open / copy a file from the
   repo or GitHub — they are on mobile and cannot open files. This applies
   no matter how long the SQL is; if a bundle is huge, split it across
   several ```sql blocks in the SAME reply (each its own copy button) and
   tell them the run order — but it must all be in chat. A file path is
   NEVER an acceptable substitute for the inline SQL.
7. **Paste-safe SQL is mandatory.** The user's paste pipeline mangles
   short `alias.column` tokens AND record-field `.id` tokens (e.g.
   `up.id`, `v_verif.id`, `v_capsule.id`) → `42601 syntax error at "<"`.
   Only emit: `public.<table>`, `auth.<fn>()`, `NEW.`/`OLD.`, bare
   columns in single-table statements, CTE-renamed join keys, and
   `#variable_conflict use_column` for RETURNS TABLE OUT-param shadowing.
   Prefer scalar `SELECT ... INTO v_a, v_b` over `%ROWTYPE` + dotted
   record access. A migration that's fine for a CLI runner can still
   mangle on paste — rewrite the bundle you hand the user accordingly.
8. Update tasks via `TaskUpdate` (this session uses TaskCreate /
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
- RTL polish: `dir="rtl"` is wired on `<html>` for Arabic in
  LanguageContext. The bulk audit-pass swap is complete — 22 files
  cleaned across 6 batches (56 logical-property swaps + 4 icon-flip
  `rtl:scale-x-[-1]` transforms). Layout chrome, notification UI,
  Dashboard cards, Leaderboards, nutrition flows, debrief, duel
  modals, nemesis card all use logical properties (`text-start`/
  `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`border-s`/`border-e`)
  instead of hardcoded LTR classes. Three audit-flagged components
  (OneShotTooltip, PullToRefresh, AdminReports) had hits that were
  intentional symmetric positioning (centering or full-width pins)
  and need no swap. Still pending: visual verification in RTL mode
  on device (class swaps produce correct LAYOUT but icon orientation
  in non-flipped components and JS animations — e.g., NotificationPanel
  slide-in direction — still need direction-aware logic for full
  Arabic readiness).
- `.toLocaleString()` migration: `src/lib/intl.js` is the new util
  (`useNumberFormatter` / `useDateFormatter` / `formatNumber` /
  `formatDate`). Sites swapped so far: WeeklyRecap, StatsHubModal,
  LeaderboardsContent, WorkoutCalendarGrid, ReferralCard,
  CrewStatsPanel, AchievementsTab, AchievementsModal,
  CreateInviteLinkModal, Gauntlet (ChallengeDetail), ui/chart.jsx
  (tooltip values). Remaining hardcoded-`'en-US'` sites that are
  intentionally English (buildInfo.js, workoutGenerator.js AI
  prompts, HubProfile.jsx joined-month, WeeklyDebriefCard helper)
  stay as-is.
- ~~Push pipeline is built but not deployed.~~ **No longer true** — it
  IS deployed (VAPID keys, the `send-push` function, and the Vault
  secrets are all in place). It is however not DELIVERING: the fanout's
  one recorded HTTP call 404s, pointing at a bad `send_push_url`. This
  is an open bug, not out of scope — details and the fix are in the
  "Push notifications" section above.
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
