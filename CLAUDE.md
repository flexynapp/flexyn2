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

**Deployment status — audited 2026-07-30, delivery fixed 2026-07-31.**
Every step of the old "still missing" checklist is done, and the pipeline
now delivers. The one remaining gap is that nothing is subscribed:

| Step | State | Evidence |
|---|---|---|
| VAPID keys generated | ✅ | 87-char P-256 public key baked into the production bundle |
| `VITE_VAPID_PUBLIC_KEY` in client build env | ✅ | listed in the Netlify resolved config; key present in the served JS |
| `send-push` Edge Function deployed | ✅ | ACTIVE, version 17 |
| `send_push_url` / `send_push_secret` in Vault | ✅ | both rows exist, created 2026-05-21 |
| `pg_net`, fanout fn, trigger, `push_subscriptions` | ✅ | all present; 2 push-related crons. Only the STATEMENT-level `trg_notifications_push_fanout_batch` is attached — `notify_push_fanout` (row-level) exists unattached, so fix both when changing either |
| **Actually delivering** | ✅ | fixed by mig 274; verified `200 {"ok":true,…}` on 2026-07-31 |
| Anyone subscribed to deliver TO | ❌ | 0 rows — see the end of this section |

**The subscribe side was broken too — fixed 2026-07-31.** Separate from the
delivery bug below, almost nobody could subscribe in the first place. Web
push needs a service worker registration, and the app wasn't registering
one at all: the dynamic `import('virtual:pwa-register')` in
`AppUpdatePrompt.jsx` carried a `/* @vite-ignore */`, so Vite never bundled
the virtual module and the runtime import rejected into a `.catch(() =>
null)`. `usePushSubscription` awaits `navigator.serviceWorker.ready`, which
never resolves without a registration, so opt-in hung silently — no error,
no toast, nothing in Sentry. That is the likely explanation for
`push_subscriptions` holding exactly one row. Verified fixed on the live
authenticated page (`ready` resolves, `/push-sw.js` controls the page).
**This does not explain the 404 below** — that is a separate, still-open
problem on the delivery side.

**RESOLVED 2026-07-31 (mig 274). Delivery is verified working.** A
self-targeted notification produced `200` with
`{"ok":true,"sent":0,"removed":1,"batch":1}` — trigger → Vault → pg_net →
Edge Function, authenticated. A 200 rather than 401 also rules out the
`send_push_secret` / `SEND_PUSH_TRIGGER_SECRET` mismatch that used to be
undiagnosable from outside.

**This section previously documented a wrong diagnosis. Both halves of it
were false, and the retraction is worth keeping**, because the reasoning
that produced it looks sound:

- *"The fanout's one recorded HTTP call 404s, so `send_push_url` is
  wrong."* The 404 was **not push**. `net._http_response` held one row,
  404 at 2026-07-26 20:00:00, body `{"code":"NOT_FOUND","message":
  "Requested function was not found"}`. Cron job 5 runs `0 20 * * 0` —
  Sundays at 20:00 — posting to `/functions/v1/generateWeeklyDebriefs`,
  2026-07-26 was a Sunday, and that function has never been deployed. It
  is the Weekly Debriefs follow-up, firing weekly at a dead endpoint. The
  old note ruled this out by arguing "every `net.http_post` caller in the
  applied migrations is push-related" — **job 5 is a raw cron command, not
  a migration function body**, so a grep over migrations could never see
  it. Check `cron.job` as well as `pg_proc` before attributing an HTTP
  call to a feature.
- *"The Vault URL doesn't resolve."* It was correct all along —
  `https://<ref>.functions.supabase.co/send-push`, the form that returns
  401 — and it was **never read**, so `vault.update_secret()` would have
  fixed nothing. (`vault.decrypted_secrets` IS readable as `postgres` via
  MCP, contrary to the old note; that one query would have settled it.)

**The actual defect was a silent revert.** Mig 080 taught the fanout to
read `vault.decrypted_secrets`; migs 098 and 127 later redefined the same
function from the pre-080 template and put
`current_setting('app.send_push_url', true)` back. Managed Supabase blocks
`ALTER DATABASE … SET` — the whole reason mig 038 moved these into the
Vault — so both GUCs read NULL, the function hit its secrets-missing guard,
and returned before dispatching. Push had **never sent a single request**.

Two lessons, both cheap:

- **Read the INSTALLED function body, not the migration that created it.**
  `pg_get_functiondef()` is the source of truth. A later migration
  redefining a function from a stale template is invisible in the file
  that "owns" the feature, and this had been live since mig 098.
- **The guard is deliberately silent** (mig 034) so partial deploys don't
  break notification inserts. In-app rows keep landing and nothing raises.
  `net._http_response` is the only place it shows — and an *empty* table
  there means "never dispatched", which reads identically to "never
  triggered".

Remaining, and NOT a push bug: `push_subscriptions` is currently **0**. The
one subscription (2026-05-25) was 410 Gone and the Edge Function cleaned it
up on that first successful call, which is correct behaviour. Nobody could
create a replacement while the service worker was failing to register (see
the section above), so re-opt-in from Settings is what proves end-to-end
delivery to a device. Expect `sent: 1, removed: 0`.

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

## Equipment picker (migrations 268–273, July 2026)

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
- **One home space per owner** (mig 271). `getOrCreateHomeSpace` is
  read-then-insert, and `UNIQUE (owner_id, gym_id)` never constrained it
  because `gym_id` is NULL for home spaces and NULLs are distinct. The
  partial unique index closes it — but the index alone would have made
  things worse, because the losing racer's INSERT now returns 23505 and
  the old code reported it and returned null, turning a harmless
  duplicate into a silently dropped photo. Both `getOrCreateHomeSpace`
  and `getOrCreateGymSpace` re-read the winner on 23505. If you add
  another get-or-create here, it needs the same branch.
- **`equipment_models` is empty in production and that is correct.** The
  50 "seed models" are `SEED_MODELS` in `equipmentCatalog.js`, a
  client-side vocabulary; no migration inserts a row. The table fills
  only from user submissions, as a dedupe target. Don't read
  `count(*) = 0` as missing seed data.
- **A `kind='gym'` training_space requires gym membership** (mig 270).
  Mig 268 checked only `owner_id = auth.uid()`, which let any signed-in
  user attach a space to any gym and inject entries onto its floor —
  `listGymFloor` unions every space with that gym_id, so it rendered to
  all members. Verified as a real exploit against production before
  patching. When adding a policy here, test it by executing the attack
  under `SET LOCAL role authenticated` + JWT claims; MCP/SQL-editor
  queries run as `postgres` and bypass RLS entirely.

## Scheduled workouts (migration 276, Aug 2026)

"Schedule it" on the AI Coach plan card. Saving to Regimens produces an
artefact the user has to remember to return to; implementation-intention
research (Gollwitzer) is clear that naming *when* roughly doubles
follow-through, so a session can now be pinned to a day and an hour and
`scheduled_workouts` + an hourly cron turns that into an actual trigger.

- **Local date + local hour, never a timestamptz.** "Thursday at 7am"
  means 7am wherever the user wakes up. An absolute instant would shift
  the reminder for anyone who travels and would need rewriting on every
  timezone change. `scheduled_date` / `scheduled_hour` are resolved
  against `user_profiles.timezone_offset_minutes` at fire time, the same
  way migration 035 does streak reminders.
- **`public.user_local_now(uuid)` exists so the cron's WHERE clause stays
  paste-safe** — one function call instead of a join, which keeps every
  statement single-table with bare column names per the clipboard rule in
  the Workflow section. Don't "simplify" it back into a join.
- **The whole session is stored in `workout` JSONB**, not a regimen id.
  What fires is what the user committed to, even if the generator's
  catalog or their history has moved on. It's also what
  `/workout?scheduled=<id>` loads, so the reminder lands you *in* the
  session rather than on the Workout page to go find it.
- **Anything more than 12h past its slot is marked `missed`, not
  notified.** If the cron was down or an offset moved, a reminder for
  yesterday morning arriving tonight reads as the app being broken and
  can't be acted on.
- **There is no client INSERT policy.** Rows are created only through
  `schedule_workout()`, which derives `user_id` and `user_email` from
  `auth.uid()`. An INSERT policy would let someone attach a schedule to
  another user, and `user_email` is what the push fan-out delivers to.
- **A new function is EXECUTE-able by PUBLIC until you revoke it, and
  every public-schema function is a PostgREST endpoint.** `REVOKE` on
  `fire_scheduled_workout_reminders` is load-bearing: without it any
  caller, including `anon`, could POST to
  `/rest/v1/rpc/fire_scheduled_workout_reminders` and fire every user's
  due reminders early or sweep pending rows into `missed`, running
  SECURITY DEFINER while doing it. The cron is unaffected — pg_cron runs
  the job as its owner. Caught by the security advisor, not by testing
  the feature, which worked perfectly throughout. **Run `get_advisors`
  after adding any SECURITY DEFINER function**; 17 functions in this
  project currently carry the same lint and most are benign helpers, so
  the signal to look for is a function with side effects.
- **`workout_reminder` is deliberately absent from
  `notification_type_category`.** Unmapped types always deliver (mig 083),
  which is right here: the user asked for THIS reminder at THIS hour, so
  muting the broad "engagement" category — which exists for nudges *we*
  initiate — must not silence it. Quiet hours (mig 098) still apply.

## Home gym / "My Gym" (migration 275, Aug 2026)

Beta testers wanted to declare the gym they actually train at, see it on
the locator map, and race the people who train there. `gym_members` was
already the "belongs to N gyms" junction; `user_profiles.home_gym_id` is
the ONE that is theirs.

- **The map now has three tiers, and shape carries the meaning.** Purple
  bubble = verified business (`source='owner'`). Grey bubble =
  `source='community'`, a real gym with real members and a real
  leaderboard that nobody has claimed. Grey teardrop = a live
  OpenStreetMap result nobody has picked yet, fetched from Overpass and
  never persisted. Grey is shared between the last two on purpose (both
  mean "unclaimed"); the bubble-vs-teardrop distinction is what says
  "has a community".
- **Picking an OSM gym PROMOTES it.** Almost no real gym has registered
  a business account, so `set_home_gym_from_osm` creates a persistent
  `source='community'` row from the OSM feature. Everyone who later
  picks that gym must land on the SAME row or one gym floor gets two
  leaderboards — that's enforced by the partial unique index
  `gym_businesses_osm_uniq (osm_type, osm_id) WHERE osm_id IS NOT NULL`,
  not by client discipline.
- **`ON CONFLICT` against a PARTIAL index must repeat the predicate.**
  `ON CONFLICT (osm_type, osm_id) DO NOTHING` raises `42P10` — Postgres
  only matches a partial index when the clause carries its `WHERE`. This
  shipped broken through a migration-executes-cleanly check and was only
  caught by calling the RPC as a real authenticated user. **Verifying
  that a migration runs is not verifying that its functions work.**
- **Key on `(osm_type, osm_id)`, never `osm_id` alone.** OSM ids are
  unique only within a type, so `node/123` and `way/123` are different
  places. The client carries `osmType` through `fetchOsmGyms` for this
  reason; dropping it merges two unrelated gyms into one row.
- **Overpass lookup lives in `src/lib/osmGyms.js`, not `GymMap.jsx`.**
  GymMap statically imports maplibre-gl, so importing anything from it
  drags the whole map engine into the onboarding chunk — vite.config
  keeps maplibre out of `vendor-misc` precisely so it stays lazy. The
  onboarding picker and the map share this module instead.
- **`owner_id` stays NULL on a community gym.** Same reasoning as demo
  gyms below: nobody proved they own the place, so nobody gets owner
  controls. `created_by_user_id` records who promoted it and grants
  nothing — it exists so the 20-gym anti-spam cap has something to count.
  A real owner claims the gym later through the verification queue.
- **Onboarding holds the pick and applies it at final save.** The
  `home_gym` step writes nothing; `handleRevealNext` calls the RPC with
  the other side effects. Abandoning onboarding halfway therefore leaves
  no community gym and no membership behind for a user who never
  finished signing up.
- **Never read `user.home_gym_id` from AuthContext alone** — use
  `resolveHomeGymId()` (context → profile cache → one query). Onboarding
  attaches the gym AFTER its `checkUserAuth()`, and a pick made on
  another device never touches this tab's context, so the context value
  is legitimately stale in both cases. Reading only it renders "you
  haven't picked a gym yet" at someone who picked one a minute ago.
- **The board ranks by consistency, not volume** — `active days in the
  last 7`, reusing `get_gym_consistency_leaderboard` (mig 150/158).
  Ranking a local gym floor by weight moved sorts it by bodyweight and
  training age and tells a beginner they're last, which is exactly the
  person this feature needs to keep. Don't "improve" it to volume.
- **A success toast here MUST carry an `action`, or it renders nothing.**
  `src/lib/toast.js` suppresses every non-error variant unless it has one
  (the app-wide "errors only" policy). Both save paths originally called
  a bare `toast.success(...)`, so a working save produced no feedback
  whatsoever and looked identical to a dead button — which is most of
  why this feature took four rounds to land. They now pass an Undo
  action, which both satisfies the policy and is the right affordance for
  a one-tap commit. Same trap applies to any new confirmation anywhere.
- **Tapping a gym in the My Gym picker SAVES it — no confirm step.** It
  was select-then-press-a-button, and the selected row's ✓ read as
  "saved" when it only meant "highlighted", so a pick sat uncommitted
  while everything looked done. `deselectable={false}` is passed there
  precisely because, once a tap commits, tapping your current gym again
  must not mean "unset my home gym". Onboarding keeps the deferred
  two-step (it must not write before final save) and so keeps
  `deselectable` at its default.
- **Overpass is unreliable and its failure must never render as "no gyms
  found".** Audited 2026-08-01 from a browser Origin: `overpass-api.de`
  answers browser User-Agents with `406` and sends no CORS header, so it
  can never succeed from the app (it was listed FIRST, and because
  `Promise.any`'s AggregateError is call-ordered, every outage got
  reported as its 406); `kumi.systems` was timing out on every request;
  `private.coffee` managed 2/3. Mirrors are ordered by that measurement
  and `pickError()` prefers an error from a mirror that could have
  worked. The picker tracks the failure separately from an empty result —
  "there are no gyms near you" is a claim about the world we may only
  make when the lookup actually succeeded.
- **Community aggregates are members-only.** `get_gym_community_progress`
  gates on `is_gym_member_or_owner` because it reports how many people
  train at a named physical address and when. Verified against
  production that a non-member gets `42501`.

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

## Storage — the `uploads` bucket

Every user upload goes through `_uploadFile` in `src/api/db.js`, which
defaults to the public `uploads` bucket and writes
`<auth.uid()>/<timestamp>.<ext>`. That prefix is what every RLS policy on
the bucket keys off, so don't change the path shape casually.

- **The bucket's `allowed_mime_types` must agree with `SAFE_MIMES` +
  `VIDEO_MIMES` in db.js.** They didn't until mig 272, and the result was
  that Hub video posts and story videos had **never once succeeded** since
  the project was created — Storage rejected them before writing, and the
  UI showed a generic "couldn't post". When you teach `_uploadFile` a new
  type, add it to the bucket in the same change or it will fail in exactly
  this silent way.
- **50 MB is a hard ceiling on the Free plan.** Supabase enforces a global
  file-size limit above every bucket which cannot exceed 50 MB on Free, so
  a per-bucket limit above that is fiction. `VIDEO_MAX_BYTES` and the
  user-facing copy say 50 MB for that reason. Moving to Pro means raising
  the global limit, the bucket, the constant, and the copy together.
- **Pin `contentType` from the extension for videos too.** It read
  `SAFE_MIMES[ext]`, and `ext` is `''` on the video branch (it lives in
  `videoExt`), so it was `undefined` and supabase-js fell back to the
  client-supplied `file.type` — the exact thing the comment there says we
  don't trust.
- **`remove()` needs a SELECT policy** (mig 273). Storage resolves a
  delete's targets with a SELECT first. Mig 185 dropped the bucket's only
  SELECT policy to stop enumeration, which silently broke deletion: the API
  returns **200 with an empty array** and removes nothing. Every
  failed-after-upload cleanup was orphaning its blob. Mig 273 restores a
  SELECT scoped to the caller's own uid prefix — enumeration stays closed.
  If you ever add a bucket policy, check `remove()` still deletes rather
  than assuming a 200 means success.
- **`storage.protect_delete()` blocks direct `DELETE FROM storage.objects`**
  with `42501`. It only checks a session setting, so `BEGIN; SET LOCAL
  storage.allow_delete_query = 'true'; DELETE …; COMMIT;` works. Use it only
  when the owning user no longer exists — it removes the metadata row and
  can orphan the blob. Prefer the Storage API.

## Service worker / PWA

- **Never put `/* @vite-ignore */` on the `virtual:pwa-register` import.**
  It tells Vite not to resolve the specifier, so the module is never
  bundled and the runtime import rejects on a bare string. It sat on that
  import from 2026-05-23 until 2026-07-31 and disabled the service worker
  entirely: no precache, no offline shell, no update prompt, and push
  opt-in hanging forever on `navigator.serviceWorker.ready`. There is a
  comment at the call site; leave it there.
- **`AppUpdatePrompt` is the only thing that registers the worker**, and it
  sits below five early returns in `App.jsx` (loading, `user_not_registered`,
  `auth_required`, incomplete onboarding, stashed token). So nothing global
  in that render — service worker, install prompt — mounts while signed
  out. Measuring any of it on the marketing or onboarding screens shows it
  missing whether or not it works.
- **An installed PWA can be months behind `main`.** A device was found
  running a ten-week-old build while every server-side check said the
  backend was healthy — and the feature under test didn't exist in that
  build. `buildInfo.js` exists for this: Settings → footer → tap the build
  label copies hash + date + UA, and the live hash is readable straight out
  of the served bundle. **Ask for the device build hash before theorising**
  whenever a device report and the database disagree.

## Verifying against production — three layers

Each layer catches what the one below it cannot, and every real bug in the
July 2026 equipment/storage work was found by dropping a layer:

1. **SQL as `authenticated`** — `BEGIN; SET LOCAL role authenticated; SET
   LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'; …
   ROLLBACK;` with the client's statements issued **separately** (CTEs in
   one statement can't see each other's writes, which gives a false
   "blocked"). This is the only way to test RLS — raw MCP/SQL-editor
   queries run as `postgres` and bypass it entirely. Blind to PostgREST and
   Storage: a bucket MIME allowlist is enforced by the Storage service, not
   the database.
2. **A node probe** using the anon key from `.env.local` plus
   `supabase.auth.signInAnonymously()`, driving the real HTTP APIs. Proves
   the service layer. Clean up whatever it writes.
3. **The deployed site in the browser pane.** A file input can be driven
   without a real file: build a `File` (canvas → `toBlob` for an image,
   `MediaRecorder` over `canvas.captureStream()` for a genuinely decodable
   video), assign via `DataTransfer` to `input.files`, dispatch `change`.

## i18n discipline

- 15 supported languages: `en es fr de pt it ja ko zh ar hi ru tr pl nl`.
- Per-domain translation files: `src/lib/i18n-*.js` (e.g. `i18n-coach.js`,
  `i18n-goals.js`, `i18n-discovery.js`). Each exports a `{ <lang>:
  { 'key': 'value' } }` object.
- At build time `scripts/split-i18n.mjs` merges every part file into
  per-language aggregates under `src/lib/i18n-langs/`.
- New keys: add to a part file with English at minimum. At the call site
  use **`tFallback(key, 'English')`** so a missing translation surfaces a
  sensible string, never a key code.
- **NEVER `t(key) || 'English'`. It does not work**, and this file used to
  recommend it. `getTranslation` ends with `return enVal ?? key`, so a
  total miss returns the *key string* — which is non-empty, therefore
  truthy, so `||` never reaches the fallback. Eleven call sites had
  accumulated: five rendered raw key paths (two of them inside
  `toast.error`, so users saw a toast reading `nutrition.toast.waterCap`),
  five were dead-but-harmless, and one was worse than either —
  `t('progress.title') || 'of daily goal'` rendered **"45% Progress"** on
  the hydration ring, because that key exists and means the Progress page
  title. A missing key looks broken; that one looked fine and said the
  wrong thing. `src/lib/__tests__/i18nRawKeys.test.js` now fails the suite
  on the pattern itself, so it can't come back.
- **A language may appear at most once per part file.** JavaScript resolves
  a duplicate literal key by keeping the last block and discarding the
  earlier one silently — no error, no warning. Three of 41 files had this;
  it cost `onboarding.welcome.languageHint` in pt/it/ja/ko, the one string
  whose job is telling someone who can't read the current language how to
  switch, so those four fell back to English asking "Don't speak English?".
  `scripts/split-i18n.mjs` now fails the build on it. The guard is
  brace-depth aware because `i18n-warn.js` legitimately holds two separate
  object literals that each declare all 15 languages.
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
- Data-layer modules under `src/lib/data/` are worth testing directly, not
  only through the components that call them. `equipment.js` looked covered
  because `ImplementPicker.test.jsx` mocked `persistEquipmentPhoto` — but
  the mock always returned null, so every step between the picker and the
  database was untested. A mocked dependency is not coverage of that
  dependency. See `src/lib/data/__tests__/equipment.test.js` for a
  chainable-mock shape that asserts on the **sequence** of statements,
  which is usually the part that's actually unproven.
- `npm run test` — full suite. `npm run test:watch` — watch mode.
  `npm run test:coverage` — V8 coverage. As of 2026-07-31: **2366 tests
  passing across 167 files**.

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
- Weekly Debriefs. **The Edge Function is now DEPLOYED** (2026-07-31,
  `generateWeeklyDebriefs`, version 1, `verify_jwt: false`). It had been
  sitting written-but-undeployed in `supabase/functions/` — CLAUDE.md
  described it as still needing to be built, which was stale. Verified
  live: `POST` with no auth returns `401 {"error":"unauthorized"}`, `GET`
  returns `405`, and the deployed source is a byte-for-byte match for the
  repo file (456 lines, 22,531 bytes, identical SHA-256).

  It is deployed but **inert**, and two things are still needed to make it
  run: set `DEBRIEF_CRON_SECRET` as a function secret, then re-add the
  cron (recipe below). `verify_jwt` is deliberately false because the cron
  authenticates with `X-Cron-Secret`, which a gateway JWT check would
  reject before the function's own auth gate runs — same posture as
  `send-push`. `SEND_PUSH_TRIGGER_SECRET` and `ANTHROPIC_API_KEY` are
  optional: without them it skips the push fan-out and falls back to the
  rule-based insight.

  **The cron was unscheduled on 2026-07-31.** `cron.job` id 5
  (`weekly-debrief-generator`, `0 20 * * 0`) posted to
  `/functions/v1/generateWeeklyDebriefs`, which has never been deployed,
  so it 404'd every Sunday at 20:00 for ten weeks. It never showed as a
  failed job — `net.http_post` only queues, so the run always records
  `succeeded` — and it was the only row in `net._http_response` most
  weeks, which is exactly how it got misread as a push-delivery failure
  (see the Push notifications section).

  **When you re-add it, do NOT inline the key.** The old command carried
  the project's `service_role` JWT in plaintext inside `cron.job.command`.
  It was not leaked — `cron.job`'s RLS policy is `username =
  CURRENT_USER` and the job was owned by `postgres`, so `anon` and
  `authenticated` saw no rows despite holding SELECT, and the key appears
  nowhere in the working tree or git history — but a service_role JWT
  bypasses every RLS policy in the project, so it does not belong in a
  table. Use the Vault, the way mig 038 does for push:

  ```sql
  SELECT cron.schedule('weekly-debrief-generator', '0 20 * * 0', $$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets
                   WHERE name = 'debrief_func_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret
                                         FROM vault.decrypted_secrets
                                        WHERE name = 'debrief_cron_secret')),
      body    := '{}'::jsonb);
  $$);
  ```

  The function is deployed now, so re-adding the cron no longer restores a
  weekly 404 — but set `DEBRIEF_CRON_SECRET` first, or every run gets a
  401 instead, which is just as silent.
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
- ~~Push pipeline is built but not deployed.~~ ~~It is however not
  DELIVERING, on a bad `send_push_url`.~~ **Both obsolete.** It is
  deployed AND delivering as of 2026-07-31 (mig 274) — verified with a
  `200 {"ok":true,…}` from the Edge Function. The `send_push_url`
  diagnosis was wrong; the 404 belonged to the weekly-debriefs cron. The
  real causes were the fanout silently reverting to GUCs that managed
  Supabase can never set, plus the service worker not registering so
  nobody could subscribe. Both fixed. What's left is that
  `push_subscriptions` is 0 — opt in from Settings on a device to prove
  delivery end to end. Full account in the "Push notifications" section.
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
