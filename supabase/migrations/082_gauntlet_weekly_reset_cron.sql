-- 082_gauntlet_weekly_reset_cron.sql
--
-- Weekly Gauntlet lifecycle management + push notification for new weeks.
--
-- BEFORE: migration 060 creates public.weekly_gauntlets with a status
-- enum ('upcoming' → 'active' → 'closed') and a week_start / week_end
-- range. Nothing advances the status — the seeded "Opening Week" row
-- is hardcoded to 'active' once but every subsequent week sits in
-- whatever state someone last left it. There's also no notification
-- when a new weekly gauntlet opens, so the feature is invisible to
-- users who don't visit the Gauntlet tab unprompted.
--
-- AFTER:
--   1. advance_weekly_gauntlet_statuses() — cron-callable function that
--      flips upcoming → active (when week_start <= today) and
--      active → closed (when week_end < today). Idempotent — safe to
--      run more often than necessary.
--   2. For each gauntlet that JUST transitioned to active, fans out
--      notifications to active users (logged in within last 14 days).
--      The notifications table INSERT path triggers the existing push
--      fanout (migrations 034/038/080) so each eligible user gets one
--      "🏔️ New weekly gauntlet" push.
--   3. Hourly pg_cron job invokes the advance function. Status
--      transitions happen at most ~1 hour after the week boundary.
--      Sub-hour precision isn't worth a more aggressive schedule for
--      a weekly feature.
--
-- Audience filtering (mirrors the welcome_back cron in migration 037):
--   • last_login_date within the last 14 days — active users only.
--     Inactive users will see the active gauntlet when they next open
--     the app; no push spam to churned accounts.
--   • notification_prefs.engagement != 'false' — honors the
--     opt-out toggle on the Settings panel's "Welcome back" category
--     (which semantically also covers nudges about new content).
--   • Per-(user, gauntlet) dedup via a tracking table so a user can't
--     receive the same gauntlet notification twice — important
--     because the advance function is idempotent and may flip the
--     same gauntlet's status only once but the notification fanout
--     can be re-attempted if a partial run failed.
--
-- The dedup pattern follows migration 037's UPDATE…RETURNING claim
-- for `last_welcome_back_at`, adapted to a row per (user, gauntlet):

CREATE TABLE IF NOT EXISTS public.weekly_gauntlet_notifications (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gauntlet_id UUID NOT NULL REFERENCES public.weekly_gauntlets(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, gauntlet_id)
);

-- service_role / SECURITY DEFINER access — never read by clients.
REVOKE ALL ON public.weekly_gauntlet_notifications FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_gauntlet_notifications TO service_role;

-- ── Text helper ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.weekly_gauntlet_started_text(
  p_language TEXT,
  p_title    TEXT
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN '🏔️ Nuevo Gauntlet Semanal'
        WHEN 'fr' THEN '🏔️ Nouveau Gauntlet Hebdomadaire'
        WHEN 'de' THEN '🏔️ Neuer Wochen-Gauntlet'
        WHEN 'pt' THEN '🏔️ Novo Gauntlet Semanal'
        WHEN 'it' THEN '🏔️ Nuovo Gauntlet Settimanale'
        WHEN 'ja' THEN '🏔️ 新しい週間ガントレット'
        WHEN 'ko' THEN '🏔️ 새로운 주간 건틀릿'
        WHEN 'zh' THEN '🏔️ 全新每周挑战开始'
        WHEN 'ar' THEN '🏔️ تحدي جديد لهذا الأسبوع'
        WHEN 'hi' THEN '🏔️ नया साप्ताहिक गॉन्टलेट'
        WHEN 'ru' THEN '🏔️ Новый Еженедельный Гонтлет'
        WHEN 'tr' THEN '🏔️ Yeni Haftalık Gauntlet'
        WHEN 'pl' THEN '🏔️ Nowy Tygodniowy Gauntlet'
        WHEN 'nl' THEN '🏔️ Nieuwe Wekelijkse Gauntlet'
        ELSE              '🏔️ New Weekly Gauntlet'
      END,
    'body',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN p_title || ' — Compite contra la comunidad.'
        WHEN 'fr' THEN p_title || ' — Affrontez la communauté.'
        WHEN 'de' THEN p_title || ' — Tritt gegen die Community an.'
        WHEN 'pt' THEN p_title || ' — Compita contra a comunidade.'
        WHEN 'it' THEN p_title || ' — Sfida la community.'
        WHEN 'ja' THEN p_title || ' — コミュニティと競い合おう。'
        WHEN 'ko' THEN p_title || ' — 커뮤니티와 경쟁하세요.'
        WHEN 'zh' THEN p_title || ' — 与社区一较高下。'
        WHEN 'ar' THEN p_title || ' — تنافس مع المجتمع.'
        WHEN 'hi' THEN p_title || ' — कम्युनिटी के साथ प्रतिस्पर्धा करें।'
        WHEN 'ru' THEN p_title || ' — Сразитесь с сообществом.'
        WHEN 'tr' THEN p_title || ' — Topluluğa karşı yarış.'
        WHEN 'pl' THEN p_title || ' — Rywalizuj ze społecznością.'
        WHEN 'nl' THEN p_title || ' — Neem het op tegen de community.'
        ELSE              p_title || ' — Compete against the community.'
      END
  );
$$;

REVOKE ALL ON FUNCTION public.weekly_gauntlet_started_text(TEXT, TEXT) FROM PUBLIC;

-- ── Status advance + notification fanout ────────────────────────────────
--
-- Returns the count of newly-activated gauntlets so the cron caller can
-- log progress. Separate counter for closed gauntlets would clutter the
-- return shape; the closure is a passive transition with no fanout.

CREATE OR REPLACE FUNCTION public.advance_weekly_gauntlet_statuses()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      DATE := (now() AT TIME ZONE 'UTC')::date;
  v_gauntlet   RECORD;
  v_user       RECORD;
  v_text       JSONB;
  v_count      INTEGER := 0;
BEGIN
  -- ── Close expired gauntlets first (no notification — passive) ─────────
  UPDATE public.weekly_gauntlets
     SET status = 'closed'
   WHERE status = 'active'
     AND week_end < v_today;

  -- ── Activate upcoming gauntlets whose window has begun ────────────────
  -- We capture the IDs of newly-activated rows in a CTE so we can fan out
  -- notifications only for the rows THIS function call activated. A second
  -- invocation finds no rows to update (idempotent) and the notification
  -- fanout below has the (user, gauntlet) dedup as a second safety net.
  FOR v_gauntlet IN
    WITH activated AS (
      UPDATE public.weekly_gauntlets
         SET status = 'active'
       WHERE status = 'upcoming'
         AND week_start <= v_today
         AND week_end   >= v_today
       RETURNING id, title
    )
    SELECT id, title FROM activated
  LOOP
    v_count := v_count + 1;

    -- Fan out notifications to active users. Filters mirror the
    -- welcome_back cron in 037:
    --   • last_login_date within last 14 days
    --   • notification_prefs.engagement != 'false'
    --   • user_email NOT NULL (auth row still exists)
    --
    -- Per-user dedup via INSERT … ON CONFLICT DO NOTHING on
    -- weekly_gauntlet_notifications. The trigger from 034/080 fires
    -- on EACH notifications INSERT, so even a retry of a partial run
    -- would deliver duplicate pushes without this guard.
    FOR v_user IN
      SELECT p.id          AS user_id,
             p.email       AS user_email,
             p.preferred_language
        FROM public.user_profiles p
       WHERE p.email IS NOT NULL
         AND p.last_login_date IS NOT NULL
         AND p.last_login_date >= v_today - INTERVAL '14 days'
         AND (
               p.notification_prefs IS NULL
               OR (p.notification_prefs ->> 'engagement') IS NULL
               OR (p.notification_prefs ->> 'engagement') <> 'false'
             )
    LOOP
      -- Atomic dedup claim: only the first call for this (user,
      -- gauntlet) inserts; subsequent calls hit ON CONFLICT and skip
      -- the notification row entirely.
      INSERT INTO public.weekly_gauntlet_notifications (user_id, gauntlet_id)
      VALUES (v_user.user_id, v_gauntlet.id)
      ON CONFLICT DO NOTHING;

      IF NOT FOUND THEN
        CONTINUE;  -- already notified this user about this gauntlet
      END IF;

      v_text := public.weekly_gauntlet_started_text(
        COALESCE(v_user.preferred_language, 'en'),
        v_gauntlet.title
      );

      INSERT INTO public.notifications
        (user_id, user_email, type, title, body, icon, link_url, metadata)
      VALUES
        (v_user.user_id,
         v_user.user_email,
         'weekly_gauntlet_started',
         v_text ->> 'title',
         v_text ->> 'body',
         '🏔️',
         '/gauntlet',
         jsonb_build_object('gauntlet_id', v_gauntlet.id,
                            'gauntlet_title', v_gauntlet.title));
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_weekly_gauntlet_statuses() FROM PUBLIC;

-- ── Schedule the hourly cron ────────────────────────────────────────────
-- Weekly transitions don't need sub-hour precision. If the cron worker
-- is briefly down, the next firing catches up — the function is
-- idempotent.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
DECLARE
  v_id BIGINT;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'weekly_gauntlet_advance_hourly';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule(
    'weekly_gauntlet_advance_hourly',
    '7 * * * *',  -- minute 7 of each hour — staggered off the other crons
    $cron$ SELECT public.advance_weekly_gauntlet_statuses(); $cron$
  );
END $$;

NOTIFY pgrst, 'reload schema';
