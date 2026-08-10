# Migrations Runbook

Every SQL migration that lives in `supabase/migrations/`, in execution
order, with a one-line description and a callout for any that need
follow-up (Vault secrets, Edge Function deploy, etc.). All migrations
are idempotent — re-running is safe.

If you're staring at a Supabase project and don't know what's deployed,
run the **State check** query at the bottom of this file and compare.

---

## How to apply a migration

Every migration in this repo is plain SQL designed for the **Supabase
SQL Editor**. No CLI required.

1. Open Supabase dashboard → SQL Editor → New query.
2. Paste the contents of the migration file (or a multi-migration paste
   block — see [`docs/push-notifications-setup.md`](push-notifications-setup.md)
   for an example).
3. Click **Run**.
4. Verify with the state-check query below.

---

## Migration catalog

| # | File | Purpose | Follow-up needed? |
|---|---|---|---|
| 001 | `001_initial_schema.sql` | Bootstrap: `user_profiles`, RLS policies, public-profile read | — |
| 002 | `002_user_profile_columns.sql` | Add missing profile columns (onboarding, fitness goals, etc.) | — |
| 003 | `003_grant_permissions.sql` | Grant Supabase role table privileges | — |
| 004 | `004_schema_patches.sql` | Post-migration schema fixes from the Base44 → Supabase port | — |
| 005 | `005_missing_columns.sql` | Critical columns missed in 002 (weight_lbs, height_inches, etc.) | — |
| 006 | `006_data_integrity.sql` | Foreign-key + CHECK-constraint hardening | — |
| 007 | `007_reports.sql` | Content-reports + bug-reports tables | — |
| 008 | `008_storage_bucket.sql` | `uploads` Supabase Storage bucket for avatars/meal photos | — |
| 009 | `009_loot_system.sql` | Loot capsules, inventory, marketplace tables | — |
| 010 | `010_sticker_variants.sql` | `variant` column on `user_inventory` (sticker rarity) | — |
| 011 | `011_fix_sticker_reactions_and_message_rls.sql` | RLS hardening on `hub_messages` + sticker reactions | — |
| 012 | `012_hub_messages_attachment.sql` | `attachment_url` column on `hub_messages` (DM image sharing) | — |
| 013 | `013_onboarding_timestamp.sql` | `onboarding_completed_at` timestamp | — |
| 014 | `014_gamification.sql` | Daily quests + login streak tables | — |
| 015 | `015_sticker_reactions_avatar.sql` | Denormalize avatar/name onto `post_sticker_reactions` | — |
| 016 | `016_leagues_workout_streak.sql` | Weekly leagues + workout-streak tracking | — |
| 017 | `017_notifications.sql` | In-app notifications table + RLS | — |
| 018 | `018_bump_upload_size.sql` | Storage bucket per-file limit → 50 MB | — |
| 019 | `019_titles_and_frames.sql` | Profile titles + frames loot types | — |
| 020 | `020_fix_league_members_rls.sql` | Fix infinite RLS recursion on `league_members` | — |
| 021 | `021_loot_theme_id.sql` | `loot_theme_id` column for equipped themes | — |
| 022 | `022_achievement_milestone_capsules.sql` | Track achievement-milestone capsule grants | — |
| 023 | `023_atomic_volume_distance.sql` | Atomic counter RPCs (replace client read-modify-write) | — |
| 024 | `024_atomic_post_reaction.sql` | Atomic post-reaction state transition | — |
| 025 | `025_marketplace_atomic_purchase.sql` | Marketplace concurrency hardening | — |
| 026 | `026_notifications_harden.sql` | Cross-user `create_notification_for` RPC with type allowlist | — |
| 027 | `027_leagues_atomic.sql` | League join/leave/resolve concurrency fixes | — |
| 028 | `028_server_capsule_roll.sql` | Server-side capsule roll (closes loot-forgery exploit) | — |
| 029 | `029_validate_sticker_reaction.sql` | Block sticker-reaction forgery via SECURITY DEFINER RPC | — |
| 030 | `030_goal_complete_atomic.sql` | Atomic goal-completion + `increment_flex_coins` RPC | — |
| 031 | `031_coin_shop_purchase.sql` | Atomic coin-shop purchase RPC | — |
| 032 | `032_volume_distance_allow_negative.sql` | Allow negative deltas in the volume/distance counters | — |
| 033 | `033_push_subscriptions.sql` | Web Push subscription table + idempotent upsert RPC | — |
| 034 | `034_notification_push_trigger.sql` | AFTER INSERT trigger on `notifications` → pg_net → send-push Edge Function | **Vault + Edge Function** |
| 035 | `035_streak_break_reminders.sql` | Hourly cron + `streak_break_text` server-side i18n (15 languages); timezone columns | — |
| 036 | `036_notification_prefs_and_language.sql` | Per-category `notification_prefs` JSONB + `notification_type_category` helper + `update_notification_pref` RPC | — |
| 037 | `037_welcome_back_and_quest_crons.sql` | Welcome-back (hourly) + quest-expiry (every 15 min) crons + their text helpers | — |
| 038 | `038_push_secrets_via_vault.sql` | Re-point trigger at Supabase Vault (managed-Postgres compatibility) | **Vault secrets** |
| 039 | `039_notifications_delete_policy.sql` | DELETE RLS policy on `notifications` (unblocks trash/clear-all in UI) | — |
| 040 | `040_league_resolution_i18n.sql` | `league_resolution_text` + `notify_league_resolution_for` RPC (15 languages × 3 outcomes) | — |
| 041 | `041_friend_notifications_i18n.sql` | `friend_post_text` + `friend_follow_text` + matching RPCs (per-recipient i18n) | — |
| 042 | `042_security_hardening.sql` | Real security + dep-fragility fixes (the hardening pass) | — |
| 043 | `043_stories.sql` | 24-hour Photo Stories: `stories` + `story_views` tables + RLS policies | — |
| 044 | `044_story_likes.sql` | `story_likes` table (❤️ reactions on stories) + RLS | — |
| 045 | `045_story_media.sql` | Add `overlay_text` + `media_type` columns to `stories` | — |
| 046 | `046_story_dms.sql` | `story_dms_disabled` on `user_profiles` + `overlay_style` JSONB on `stories` | — |
| 047 | `047_story_enhancements.sql` | 25h expiry, privacy, `story_blocks`, `status_notes`, `status_note_likes` | — |
| 048 | `048_crews.sql` | Crews group chat: 5 tables + 2 SECURITY DEFINER RPCs (`is_crew_member`, `is_crew_admin`) | — |
| 049 | `049_profile_extensions.sql` | Add `city`, `country_flag`, `trophy_case` (JSONB), `trophy_case_visible` to `user_profiles` | — |
| 050 | `050_username_profanity_check.sql` | `is_username_clean()` function + `enforce_username_profanity` trigger on `user_profiles.username` (raises 23514 on banned content) | — |
| 051 | `051_weekly_debriefs.sql` | `weekly_debriefs` table + RLS policies (auto-populated by a Sunday cron — needs the `generateWeeklyDebriefs` Edge Function + `app.debrief_func_url` + `app.debrief_cron_secret` DB settings to actually generate data) | **Edge Function + DB settings** |
| 052 | `052_injury_logs.sql` | `injury_logs` table for Recovery Mode + RLS | — |
| 053 | `053_exercise_groups.sql` | `exercise_groups` table for superset/circuit metadata + RLS | — |
| 054 | `054_bio_profanity_check.sql` | `is_bio_clean()` function + `enforce_bio_profanity` trigger on `user_profiles.bio` (mirrors 050 for the second user-visible free-text field; raises 23514 on banned content) | — |

---

## Follow-up checklist for migrations 034 + 038

These two migrations enable **push notification delivery**. After
running them, the database is fully wired but won't actually deliver a
push until you complete the setup in
[`docs/push-notifications-setup.md`](push-notifications-setup.md):

- [ ] Generate VAPID key pair (browser DevTools snippet in the runbook)
- [ ] Set Edge Function secrets in dashboard → Project Settings →
      Edge Functions → Secrets:
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `VAPID_SUBJECT` (e.g. `mailto:ops@flexyn.app`)
  - `SEND_PUSH_TRIGGER_SECRET` (any 256-bit hex string)
- [ ] Deploy `send-push` Edge Function (paste
      `supabase/functions/send-push/index.ts` into the Edge Functions
      UI, click Deploy)
- [ ] Add `VITE_VAPID_PUBLIC_KEY` to client `.env` (and Netlify env
      vars)
- [ ] Create two Vault secrets in SQL Editor (`send_push_url`,
      `send_push_secret` — see the runbook for the exact commands)

Until those are done, the trigger inserts notifications into the DB
correctly, but `notify_push_fanout()` no-ops on missing Vault secrets
and no Web Push is sent. That's safe — it's the intended
graceful-degrade path.

---

## State check

Paste this into the SQL Editor to inspect what's deployed:

```sql
-- Migration evidence — counts row by row. All counts should match
-- the "Expected" column on a fully-applied environment.
SELECT 'columns on user_profiles' AS what,
       count(*)::int               AS actual,
       '15+'                       AS expected
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'user_profiles'
UNION ALL
SELECT 'notifications table exists', count(*), '1'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'notifications'
UNION ALL
SELECT 'push_subscriptions table exists', count(*), '1'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
UNION ALL
SELECT 'push fanout trigger', count(*), '1'
  FROM information_schema.triggers
 WHERE event_object_table = 'notifications'
   AND trigger_name = 'trg_notifications_push_fanout'
UNION ALL
SELECT 'cron jobs (streak + welcome + quest)', count(*), '3'
  FROM cron.job
 WHERE jobname IN (
   'streak_break_reminders_hourly',
   'welcome_back_hourly',
   'quest_expiry_15min'
 )
UNION ALL
SELECT 'i18n text helpers', count(*), '6'
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN (
     'streak_break_text', 'welcome_back_text', 'quest_expiry_text',
     'league_resolution_text', 'friend_post_text', 'friend_follow_text'
   )
UNION ALL
SELECT 'notify_*_for RPCs', count(*), '3'
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN (
     'notify_league_resolution_for',
     'notify_friend_post_for',
     'notify_friend_follow_for'
   )
UNION ALL
SELECT 'vault secrets (push)', count(*), '2 (after setup)'
  FROM vault.secrets
 WHERE name IN ('send_push_url', 'send_push_secret')
UNION ALL
SELECT 'delete-own policy on notifications', count(*), '1'
  FROM pg_policies
 WHERE tablename = 'notifications'
   AND policyname = 'notifications: delete own'
UNION ALL
SELECT 'stories tables (043-047)', count(*), '6'
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN (
     'stories','story_views','story_likes',
     'story_blocks','status_notes','status_note_likes'
   )
UNION ALL
SELECT 'crews tables (048)', count(*), '5'
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN (
     'crews','crew_members','crew_messages',
     'roll_call_responses','crew_xp_claims'
   )
UNION ALL
SELECT 'crew RPCs (048)', count(*), '2'
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('is_crew_member','is_crew_admin')
UNION ALL
SELECT 'profile extension columns (049)', count(*), '4'
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'user_profiles'
   AND column_name IN ('city','country_flag','trophy_case','trophy_case_visible')
UNION ALL
SELECT 'username profanity trigger (050)', count(*), '1'
  FROM information_schema.triggers
 WHERE event_object_table = 'user_profiles'
   AND trigger_name = 'trg_username_profanity'
UNION ALL
SELECT 'weekly_debriefs table (051)', count(*), '1'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'weekly_debriefs'
UNION ALL
SELECT 'injury_logs table (052)', count(*), '1'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'injury_logs'
UNION ALL
SELECT 'exercise_groups table (053)', count(*), '1'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'exercise_groups'
UNION ALL
SELECT 'bio profanity trigger (054)', count(*), '1'
  FROM information_schema.triggers
 WHERE event_object_table = 'user_profiles'
   AND trigger_name = 'trg_bio_profanity';
```

---

## Migrations that need no SQL — what they DO need

Two pipelines here are not only SQL. **Nothing in this section lives in
`supabase/migrations/`** — replaying every migration into a fresh project
gets you the functions and crons and none of the config below, so each
one comes back wired to a dead endpoint. Treat this table as the
prerequisite list whenever a project is rebuilt or a cron "runs" without
doing anything.

The push step-by-step is in
[`docs/push-notifications-setup.md`](push-notifications-setup.md).

| Pipeline | Layer | What | Where to set it |
|---|---|---|---|
| Push | Client | `VITE_VAPID_PUBLIC_KEY` | `.env` locally + Netlify env vars |
| Push | Edge Function | `VAPID_*` and `SEND_PUSH_TRIGGER_SECRET` | Supabase dashboard → Project Settings → Edge Functions → Secrets |
| Push | Edge Function deploy | `send-push` | Supabase dashboard → Edge Functions → Deploy from UI |
| Push | Vault | `send_push_url`, `send_push_secret` | SQL Editor → `SELECT vault.create_secret(...)` |
| Weekly reviews | Edge Function | `DEBRIEF_CRON_SECRET` | `supabase secrets set` (see CLAUDE.md) |
| Weekly reviews | Vault | `debrief_func_url`, `debrief_cron_secret` | SQL Editor → `SELECT vault.create_secret(...)` |
| Storage GC | Edge Function | `STORAGE_GC_SECRET` | `supabase secrets set` (see CLAUDE.md) |
| Storage GC | Edge Function deploy | `storage-gc` | MCP `deploy_edge_function`, or dashboard |
| Storage GC | Vault | `storage_gc_url`, `storage_gc_secret` | SQL Editor → `SELECT vault.create_secret(...)` |

**A vault URL must carry the project ref, and a placeholder there fails
in a way nothing reports.** `storage_gc_url` shipped as
`https://YOUR-PROJECT-REF.functions.supabase.co/storage-gc` — the
template was never substituted. That hostname still resolves, so the
request reaches Supabase's functions gateway and comes back
`400 Project not specified.` into `net._http_response`, which nobody
reads. The cron logged `succeeded` every five minutes for as long as it
had existed. Correct form, matching `send_push_url`:

```
https://<project-ref>.functions.supabase.co/<function-slug>
```

Two cheap checks that would have caught it, both worth running after any
rebuild:

```sql
-- every vault URL should contain the project ref
SELECT name, length(decrypted_secret) AS len,
       position('<project-ref>' in decrypted_secret) > 0 AS has_ref
FROM vault.decrypted_secrets
WHERE decrypted_secret LIKE 'https://%';

-- a shared secret should look generated, not typed
SELECT name, length(decrypted_secret) AS len
FROM vault.decrypted_secrets
WHERE name LIKE '%secret%';
```

The URL lengths cluster tightly (60–73) when they are right, and every
shared secret should be **64** — a 32-byte hex string. `storage_gc_secret`
sat at 23 next to two siblings at 64, and it did not match what the
function had; the vault and the Edge Function env are two separate places
and nothing reconciles them. Rotate both together:

```sql
SELECT vault.update_secret(
         (SELECT id FROM vault.secrets WHERE name = 'storage_gc_secret'),
         encode(extensions.gen_random_bytes(32), 'hex'),
         'storage_gc_secret'
       );
```

then push the new value into the function without printing it, using the
`supabase db query --linked` → `supabase secrets set` chain documented in
CLAUDE.md. Rotating breaks the old secret immediately, so the cron returns
401 until the second half lands.

---

## `net._http_response` lies about success

The section above is about a cron reporting `succeeded` while doing
nothing. This is the mirror image, and it bites when you go looking for
the first problem: **a row in `net._http_response` with `timed_out = true`
does not mean the work failed.**

`net.http_post`'s `timeout_milliseconds` defaults to **5000**, and a cold
Supabase Edge Function boot measures **~4.8s** here. pg_net abandons the
request; the function keeps running and finishes anyway. Measured on
2026-08-10, the first storage-GC cycle that ever ran:

| Where | What it said |
|---|---|
| `net._http_response` id 212 | `Timeout of 5000 ms reached. Total time: 5002.584 ms` |
| `storage_cleanup_queue.processed_at` | `19:15:05.788`, `last_error` NULL, both blobs gone |

The work completed **0.56s after** the request was recorded as timed out.
The single row anyone would consult to ask "did it run?" said no, and was
wrong.

**The rule: verify a dispatch against the thing it was supposed to CHANGE**
— the queue, the row, the column — never against `net._http_response`
alone. That table is authoritative for *failure* (a 400 or 401 there is
real, and it is the only place a dispatch error surfaces) but not for
*success*.

This is not a livelock. A timed-out cold call still leaves the instance
warm, so the next firing answers instantly — it self-heals. The cost is
one misleading row per idle gap, not a stuck job.

Migrations 337 and 339 passed `timeout_milliseconds := 30000` to all four
callers that existed then. The default is still 5000 and nothing enforces
this, so **any new `net.http_post` call must pass it explicitly.** The
worst case is a rarely-invoked function: `kick_weekly_reviews` runs
`0 20 * * 0`, once a week, so its endpoint is cold on *every* firing —
guaranteed to take the path the others only risk.

Audit every caller after adding one:

```sql
SELECT proname,
       position('timeout_milliseconds' in pg_get_functiondef(oid)) > 0 AS has_timeout
FROM pg_proc
WHERE pronamespace::regnamespace::text = 'public'
  AND prokind = 'f'
  AND pg_get_functiondef(oid) LIKE '%net.http_post%'
ORDER BY 1;
```

Every row should read `true`. The `prokind = 'f'` filter is required, not
cosmetic — without it `pg_get_functiondef` is handed an aggregate and the
whole query dies with `42809: "array_agg" is an aggregate function`.

---

## Smoke tests

Run [`supabase/tests/cron_smoke_tests.sql`](../supabase/tests/cron_smoke_tests.sql)
in the SQL Editor whenever you've touched 034 → 041. It produces a
PASS/FAIL grid for the pure helpers (text functions, type-category
mapping) and verifies every cron job + trigger is registered.
Read-only, safe to run anytime.
