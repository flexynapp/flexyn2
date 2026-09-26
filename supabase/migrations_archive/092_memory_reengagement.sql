-- 092_memory_reengagement.sql
--
-- Server-side memory finder + push trigger for the "you trained on
-- this day N years ago — hit it again?" re-engagement nudge. The
-- client-side WorkoutMemoryCard (shipped this session) handles the
-- moment when a user is ALREADY in the app. This migration handles
-- the moment when they're NOT.
--
-- TARGET COHORT
-- ─────────────
-- Dormant users — logged in 7+ but ≤30 days ago. Sweet spot for
-- re-engagement: not so fresh that we annoy active users with
-- redundant pushes, not so cold that we're shouting at definitely-
-- churned accounts. The welcome-back cron (migration 037) covers
-- 3-30 days but with generic copy; this push is specific and
-- emotional (their own past PR or workout) which converts better.
--
-- DESIGN PILLARS
-- ──────────────
--   • Cap at one memory push per user per calendar week. Tracked in
--     a dedup table. Prevents spam across multi-day cron firings.
--   • Match logs by month+day in past years, prefer the most recent
--     match (same logic as client-side findWorkoutMemory but pure
--     SQL).
--   • Honor notification_prefs.engagement just like the welcome-back
--     and weekly-gauntlet crons.
--   • 15-language i18n text helper that includes the workout's top
--     lift in the body when available.

-- ── Dedup table ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.memory_reengagement_log (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL,
  pushed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  memory_date DATE NOT NULL,
  PRIMARY KEY (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_memory_reengagement_week
  ON public.memory_reengagement_log (week_start DESC);

ALTER TABLE public.memory_reengagement_log ENABLE ROW LEVEL SECURITY;

-- service_role-only via the ALTER DEFAULT PRIVILEGES from 085. No
-- client SELECT policy — this is an internal audit log.

-- ── i18n text helper (15 langs) ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.memory_reengagement_text(
  p_language     TEXT,
  p_years_ago    INT,
  p_top_lift     TEXT  -- nullable; included as body suffix when present
) RETURNS JSONB
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN '⏪ Hace ' || p_years_ago || (CASE WHEN p_years_ago = 1 THEN ' año' ELSE ' años' END) || ' entrenaste hoy'
        WHEN 'fr' THEN '⏪ Il y a ' || p_years_ago || ' an' || (CASE WHEN p_years_ago = 1 THEN '' ELSE 's' END) || ', vous vous entraîniez ce jour'
        WHEN 'de' THEN '⏪ Vor ' || p_years_ago || ' Jahr' || (CASE WHEN p_years_ago = 1 THEN '' ELSE 'en' END) || ' hast du heute trainiert'
        WHEN 'pt' THEN '⏪ Há ' || p_years_ago || ' ano' || (CASE WHEN p_years_ago = 1 THEN '' ELSE 's' END) || ' você treinou neste dia'
        WHEN 'it' THEN '⏪ ' || p_years_ago || ' ann' || (CASE WHEN p_years_ago = 1 THEN 'o' ELSE 'i' END) || ' fa ti allenavi oggi'
        WHEN 'ja' THEN '⏪ ' || p_years_ago || '年前の今日、トレーニングしていました'
        WHEN 'ko' THEN '⏪ ' || p_years_ago || '년 전 오늘 운동했어요'
        WHEN 'zh' THEN '⏪ ' || p_years_ago || '年前的今天，你训练了'
        WHEN 'ar' THEN '⏪ منذ ' || p_years_ago || ' سن' || (CASE WHEN p_years_ago = 1 THEN 'ة' ELSE 'وات' END) || ' تدربت في هذا اليوم'
        WHEN 'hi' THEN '⏪ ' || p_years_ago || ' साल पहले आज आपने ट्रेन किया था'
        WHEN 'ru' THEN '⏪ ' || p_years_ago || ' год' || (CASE WHEN p_years_ago = 1 THEN '' ELSE 'а' END) || ' назад вы тренировались сегодня'
        WHEN 'tr' THEN '⏪ ' || p_years_ago || ' yıl önce bugün antrenman yaptın'
        WHEN 'pl' THEN '⏪ ' || p_years_ago || ' lat' || (CASE WHEN p_years_ago = 1 THEN 'o' ELSE '' END) || ' temu trenowałeś dzisiaj'
        WHEN 'nl' THEN '⏪ ' || p_years_ago || ' jaar geleden trainde je vandaag'
        ELSE '⏪ ' || p_years_ago || (CASE WHEN p_years_ago = 1 THEN ' year' ELSE ' years' END) || ' ago you trained today'
      END,
    'body',
      CASE WHEN p_top_lift IS NOT NULL AND p_top_lift <> ''
           THEN p_top_lift || ' — '
           ELSE ''
      END ||
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN 'Vuelve y supéralo.'
        WHEN 'fr' THEN 'Revenez et battez-le.'
        WHEN 'de' THEN 'Komm zurück und übertreffe es.'
        WHEN 'pt' THEN 'Volte e supere isso.'
        WHEN 'it' THEN 'Torna e superalo.'
        WHEN 'ja' THEN '戻ってきて、超えていこう。'
        WHEN 'ko' THEN '돌아와서 이겨내세요.'
        WHEN 'zh' THEN '回归，再创新高。'
        WHEN 'ar' THEN 'عُد وتجاوزه.'
        WHEN 'hi' THEN 'वापस आओ और इसे मात दो।'
        WHEN 'ru' THEN 'Возвращайтесь и побейте это.'
        WHEN 'tr' THEN 'Geri dön ve onu geç.'
        WHEN 'pl' THEN 'Wróć i pobij to.'
        WHEN 'nl' THEN 'Kom terug en versla het.'
        ELSE 'Come back and top it.'
      END
  );
$$;

REVOKE ALL ON FUNCTION public.memory_reengagement_text(TEXT, INT, TEXT) FROM PUBLIC;

-- ── Cron-driven dispatch ──────────────────────────────────────────────
--
-- Returns the count of notifications inserted so the cron log shows
-- progress. Per-row work:
--   1. Find dormant users (last_login_date between 7-30 days ago)
--      who haven't been notified this week.
--   2. For each, find the most recent past-year workout matching
--      today's calendar day.
--   3. If found, claim the (user, week_start) row via the dedup
--      table — UNIQUE constraint blocks duplicates across concurrent
--      cron firings.
--   4. Insert a notifications row. The 034 trigger fans out a Web
--      Push automatically via the send-push Edge Function.

CREATE OR REPLACE FUNCTION public.dispatch_memory_reengagement()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      DATE := (now() AT TIME ZONE 'UTC')::date;
  v_week_start DATE := date_trunc('week', now() AT TIME ZONE 'UTC')::date;
  v_user       RECORD;
  v_memory     RECORD;
  v_text       JSONB;
  v_count      INTEGER := 0;
  v_top_lift   TEXT;
BEGIN
  FOR v_user IN
    SELECT p.id, p.email, p.preferred_language
      FROM public.user_profiles p
     WHERE p.email IS NOT NULL
       AND p.last_login_date IS NOT NULL
       AND p.last_login_date <= v_today - INTERVAL '7 days'
       AND p.last_login_date >= v_today - INTERVAL '30 days'
       AND (
             p.notification_prefs IS NULL
             OR (p.notification_prefs ->> 'engagement') IS NULL
             OR (p.notification_prefs ->> 'engagement') <> 'false'
           )
       AND NOT EXISTS (
         SELECT 1 FROM public.memory_reengagement_log mrl
          WHERE mrl.user_id = p.id AND mrl.week_start = v_week_start
       )
  LOOP
    -- Find this user's most recent past-year workout on today's
    -- calendar day. EXTRACT lets us pull month+day independent of
    -- timezone considerations.
    SELECT wl.date, wl.exercises
      INTO v_memory
      FROM public.workout_logs wl
     WHERE wl.user_id = v_user.id
       AND wl.date IS NOT NULL
       AND EXTRACT(MONTH FROM wl.date::date) = EXTRACT(MONTH FROM v_today)
       AND EXTRACT(DAY   FROM wl.date::date) = EXTRACT(DAY   FROM v_today)
       AND wl.date::date < v_today
     ORDER BY wl.date DESC
     LIMIT 1;

    -- No historical match → no memory to surface → skip.
    IF v_memory IS NULL THEN CONTINUE; END IF;

    -- Claim the (user, week) row. UNIQUE blocks concurrent firings.
    BEGIN
      INSERT INTO public.memory_reengagement_log (user_id, week_start, memory_date)
      VALUES (v_user.id, v_week_start, v_memory.date::date);
    EXCEPTION WHEN unique_violation THEN
      CONTINUE; -- already pushed this week
    END;

    -- Extract a top-lift summary from the workout JSONB if possible.
    -- The exercises array shape is [{name, sets:[{weight, reps}]}].
    -- We pull the heaviest single set's name + weight × reps for the
    -- push body. Failures fall back to NULL → body shows just the
    -- "Come back" line without the per-workout flavor.
    v_top_lift := NULL;
    BEGIN
      SELECT (ex_obj->>'name') || ': ' ||
             round((s->>'weight')::numeric) || ' × ' || (s->>'reps')::text
        INTO v_top_lift
        FROM jsonb_array_elements(COALESCE(v_memory.exercises, '[]'::jsonb)) ex_obj
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ex_obj->'sets', '[]'::jsonb)) s
       WHERE (s->>'weight')::numeric > 0
       ORDER BY (s->>'weight')::numeric DESC
       LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_top_lift := NULL;
    END;

    v_text := public.memory_reengagement_text(
      COALESCE(v_user.preferred_language, 'en'),
      EXTRACT(YEAR FROM v_today)::int - EXTRACT(YEAR FROM v_memory.date::date)::int,
      v_top_lift
    );

    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_user.id,
       v_user.email,
       'memory_reengagement',
       v_text ->> 'title',
       v_text ->> 'body',
       '⏪',
       '/dashboard',
       jsonb_build_object(
         'memory_date', v_memory.date::date,
         'top_lift',    v_top_lift
       ));

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_memory_reengagement() FROM PUBLIC;

-- ── Category mapping: route memory_reengagement → engagement ───────────
-- So the same Settings toggle that gates welcome-back covers this too.

CREATE OR REPLACE FUNCTION public.notification_type_category(p_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_type
    -- streak
    WHEN 'streak_milestone'        THEN 'streak'
    WHEN 'streak_break_warning'    THEN 'streak'
    -- quests
    WHEN 'quest_claimed'           THEN 'quests'
    WHEN 'quest_expiry_warning'    THEN 'quests'
    -- league
    WHEN 'league_promoted'         THEN 'league'
    WHEN 'league_demoted'          THEN 'league'
    WHEN 'league_held'             THEN 'league'
    WHEN 'league_promotion'        THEN 'league'
    WHEN 'league_demotion'         THEN 'league'
    -- social
    WHEN 'friend_post'             THEN 'social'
    WHEN 'friend_follow'           THEN 'social'
    WHEN 'comment_reply'           THEN 'social'
    WHEN 'post_reaction'           THEN 'social'
    WHEN 'post_like'               THEN 'social'
    WHEN 'sticker_reaction'        THEN 'social'
    WHEN 'trade_offer'             THEN 'social'
    WHEN 'crew_everyone'           THEN 'social'
    -- achievements
    WHEN 'pr_set'                  THEN 'achievements'
    WHEN 'capsule_earned'          THEN 'achievements'
    WHEN 'coin_milestone'          THEN 'achievements'
    -- engagement
    WHEN 'welcome_back'            THEN 'engagement'
    WHEN 'weekly_gauntlet_started' THEN 'engagement'
    WHEN 'memory_reengagement'     THEN 'engagement'  -- NEW
    -- competitive
    WHEN 'duel_invite'             THEN 'competitive'
    WHEN 'duel_result'             THEN 'competitive'
    WHEN 'bounty_claim'            THEN 'competitive'
    WHEN 'bounty_beaten'           THEN 'competitive'
    WHEN 'crew_war_started'        THEN 'competitive'
    WHEN 'crew_war_resolved'       THEN 'competitive'
    WHEN 'nemesis_assigned'        THEN 'competitive'
    ELSE NULL
  END;
$$;

-- ── Cron schedule (hourly, but the dedup table makes it weekly) ──────
-- Hourly so the push lands close to the user's preferred time window;
-- the per-(user, week) dedup row prevents over-sending. Staggered to
-- minute 19 to avoid bunching with the welcome-back (037), gauntlet
-- (082), and other crons.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
DECLARE
  v_id BIGINT;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'memory_reengagement_hourly';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule(
    'memory_reengagement_hourly',
    '19 * * * *',
    $cron$ SELECT public.dispatch_memory_reengagement(); $cron$
  );
END $$;

NOTIFY pgrst, 'reload schema';
