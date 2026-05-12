# Push Notifications — Setup & Operations

This guide walks an operator through everything needed to wire the Web
Push pipeline end-to-end:

1. Client subscribes via Service Worker → `push_subscriptions` table.
2. Anything (RPC, user action, cron job) inserts into `notifications`.
3. AFTER INSERT trigger calls the `send-push` Edge Function via pg_net.
4. Edge Function fans out one Web Push per subscription for that user.

Migrations involved: **033, 034, 035**.
Edge Function: `supabase/functions/send-push/`.
Client: `src/lib/usePushSubscription.js` + `src/lib/push-sw.js`.

---

## 1. Generate VAPID keys (one-time)

VAPID is the identity protocol for Web Push servers. Run:

```bash
npx web-push generate-vapid-keys
```

This prints a public/private key pair. **Treat the private key like a
service-role secret** — anyone with it can send push notifications to
your users.

---

## 2. Client `.env`

Add the **public** key to the client build env so `usePushSubscription`
can subscribe browsers to it:

```bash
# .env
VITE_VAPID_PUBLIC_KEY=B...your-public-key...
```

Without this, the push toggle in Settings stays hidden.

---

## 3. Supabase Edge Function secrets

Three VAPID secrets plus the shared-secret used by the DB trigger:

```bash
supabase secrets set VAPID_PUBLIC_KEY="B..."
supabase secrets set VAPID_PRIVATE_KEY="..."
supabase secrets set VAPID_SUBJECT="mailto:ops@yourdomain.com"

# Used by migration 034's trigger to authenticate to send-push without
# minting a Supabase JWT. Generate with: openssl rand -hex 32
supabase secrets set SEND_PUSH_TRIGGER_SECRET="<random-256-bit-hex>"
```

Deploy the function:

```bash
supabase functions deploy send-push
```

---

## 4. Database runtime settings

The trigger in migration 034 reads two `current_setting()` values. Set
them on the database so trigger sessions can see them:

```sql
-- Run these in the Supabase SQL editor as a database owner.

ALTER DATABASE postgres SET app.send_push_url    =
  'https://<project-ref>.functions.supabase.co/send-push';

ALTER DATABASE postgres SET app.send_push_secret =
  '<same value as SEND_PUSH_TRIGGER_SECRET above>';
```

After running these, force config reload so new connections pick them
up:

```sql
SELECT pg_reload_conf();
```

**If you skip this step the trigger gracefully no-ops** — notifications
still insert, just without push fanout. So you can deploy the migrations
before configuring the URL/secret if needed.

---

## 5. Run the migrations

In order, via the Supabase SQL editor or your migration runner:

```
033_push_subscriptions.sql             — subscription table + upsert RPC
034_notification_push_trigger.sql      — AFTER INSERT trigger + pg_net dispatch
035_streak_break_reminders.sql         — timezone+language columns, streak cron, i18n
036_notification_prefs_and_language.sql — per-category prefs JSONB + pref RPC
037_welcome_back_and_quest_crons.sql   — welcome-back + quest-expiry crons
```

Migration 034 requires the `pg_net` extension (preinstalled on Supabase).
Migrations 035 + 037 require `pg_cron` (also preinstalled). All migrations
`CREATE EXTENSION IF NOT EXISTS` themselves — no manual extension setup
needed.

---

## 6. Verify the pipeline

```sql
-- (a) The trigger exists:
SELECT trigger_name, event_manipulation, action_timing
  FROM information_schema.triggers
 WHERE event_object_table = 'notifications';

-- (b) All cron jobs are registered:
SELECT jobid, jobname, schedule, active
  FROM cron.job
 WHERE jobname IN (
   'streak_break_reminders_hourly',
   'welcome_back_hourly',
   'quest_expiry_15min'
 );

-- (c) Dry-run the streak reminder function manually:
SELECT public.run_streak_break_reminders();
-- → returns integer count of nudges sent in the last call.

-- (d) Inspect pg_net delivery results (last 10 calls):
SELECT id, status_code, content_type, created
  FROM net._http_response
 ORDER BY created DESC
 LIMIT 10;
```

End-to-end smoke test:

1. Open the app in Chrome / Edge (PWA-eligible browser).
2. Settings → enable push toggle → grant browser permission.
3. Confirm a row appears in `push_subscriptions` for your user.
4. From SQL editor, insert a test notification for yourself:

   ```sql
   INSERT INTO notifications (user_id, user_email, type, title, body, icon)
   VALUES (auth.uid(), auth.email(), 'test', 'Hello', 'It works.', '✅');
   ```

5. A push notification should appear within ~1 second.
6. Check `net._http_response` to confirm the Edge Function returned 200.

---

## 7. Common failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Notification inserts but no push | `app.send_push_url` not set | Run ALTER DATABASE (step 4) + `pg_reload_conf()` |
| Edge Function returns 401 | Secret mismatch | Confirm `SEND_PUSH_TRIGGER_SECRET` (function) == `app.send_push_secret` (DB) |
| `unauthorized` on local `supabase functions serve` | No Bearer + no trigger secret | Pass `Authorization: Bearer <anon-key>` from your test caller |
| Subscriptions table empty after Settings toggle | Service Worker not registered | Confirm HTTPS, hard-reload, check `navigator.serviceWorker.controller` |
| 410 Gone in `net._http_response` | Browser revoked subscription | Edge Function auto-deletes; user re-toggles to re-subscribe |
| `timezone_offset_minutes` is NULL forever | Client never called `update_user_timezone_offset` | Confirm `AuthContext.loadProfile` is firing the RPC; check console for errors |

---

## 8. Per-category preferences (migration 036)

Users can mute push categories without disabling push entirely. The
`user_profiles.notification_prefs` JSONB column has these flags (default
all `true`):

| Category | Notification types gated |
|----------|--------------------------|
| `streak` | `streak_milestone`, `streak_break_warning` |
| `quests` | `quest_claimed`, `quest_expiry_warning` |
| `league` | `league_promoted`, `league_demoted`, `league_held` |
| `social` | `friend_post`, `friend_follow`, `comment_reply`, `post_reaction`, `sticker_reaction`, `trade_offer` |
| `achievements` | `pr_set`, `capsule_earned`, `coin_milestone` |
| `engagement` | `welcome_back` |

The `notify_push_fanout` trigger consults this column before dispatching.
Notification types that don't map to a category (via
`notification_type_category()`) always fan out — better to over-deliver
a new type than silently drop it. To add a new category-aware type,
add a WHEN branch in `notification_type_category` (migration 036).

Client API:
- Read: `SELECT notification_prefs FROM user_profiles WHERE id = auth.uid()`
- Write: `supabase.rpc('update_notification_pref', { p_category: 'streak', p_enabled: false })`

The Settings panel shows toggles for each category under the push
master switch (`src/components/SettingsPanel.jsx`).

---

## 9. Localization

Migration 035 ships `streak_break_text(language, streak)` and migration
037 ships `welcome_back_text(language)` + `quest_expiry_text(language,
remaining)` — pre-translated for 15 languages keyed off
`user_profiles.preferred_language`. Unknown codes fall through to
English.

Adding a new language: append a WHEN branch to each of those three
functions and ship a migration with the updated `CREATE OR REPLACE
FUNCTION` definitions.

---

## 10. Tuning the streak-reminder window

Edit `run_streak_break_reminders()` in migration 035 if you want to
change behavior:

- **Local hour window** — `EXTRACT(HOUR …) BETWEEN 18 AND 20` defines
  the 18:00–21:00 local-time send window. Widen to BETWEEN 17 AND 21
  for a longer window.
- **Cooldown** — `last_streak_nudge_at < now() - INTERVAL '18 hours'`
  prevents more than one nudge per ~18h. Increase to '24 hours' to be
  conservative.
- **Minimum streak** — `workout_streak >= 2` skips users with only a
  1-day streak. Raise to `>= 3` for fewer, more-meaningful nudges.

The cron runs hourly (`0 * * * *`). You can change the schedule with
`SELECT cron.alter_job(jobid, schedule := '15,45 * * * *')` for a
twice-hourly cadence.
