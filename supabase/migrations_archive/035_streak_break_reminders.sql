-- 035_streak_break_reminders.sql
--
-- Push a reminder to users whose workout streak is about to break.
--
-- USER STORY:
--   It's 7:30 PM local time. User_X has a 12-day workout streak. They
--   haven't worked out today. In 4.5 hours their streak resets to zero
--   and twelve days of habit-formation evaporates. We push:
--     "🔥 Your 12-day streak ends in 4 hours. Quick workout?"
--   Tap → land on /workouts (or /dashboard).
--
-- DESIGN CONSTRAINTS:
--   1. Send at the user's evening (18:00–21:00 LOCAL time), NOT the
--      server's UTC. Requires a timezone offset per user.
--   2. Don't spam. Max one nudge per user per ~18 hours.
--   3. Don't nudge users who already worked out today.
--   4. Don't nudge users with no streak to lose (workout_streak < 2 —
--      losing a 1-day streak is not retention-worthy).
--   5. Don't nudge users who never opted in to push (they have no
--      push_subscriptions row anyway — the Edge Function will no-op).
--   6. Idempotent — running the cron twice in the same hour must not
--      double-send. The last_streak_nudge_at column gates this.
--   7. Insert into notifications. Migration 034's AFTER INSERT trigger
--      handles the actual push fanout.
--
-- ── User profile additions ──────────────────────────────────────────────

ALTER TABLE public.user_profiles
  -- Local-time offset in minutes from UTC. e.g. Pacific = -480, IST = +330.
  -- Captured client-side via `new Date().getTimezoneOffset() * -1` (Date's
  -- offset is inverted from the convention). Defaults to NULL (UTC fallback
  -- in the cron — no nudge until the client populates this).
  ADD COLUMN IF NOT EXISTS timezone_offset_minutes INTEGER,
  -- When we last sent a streak-nudge to this user. Used to enforce the
  -- 18h cooldown.
  ADD COLUMN IF NOT EXISTS last_streak_nudge_at TIMESTAMPTZ,
  -- ISO 639-1 language code. The client (LanguageContext) reads/writes
  -- this via db.auth.updateMe(); we read it here to render the streak-
  -- break push text in the user's language (see streak_break_text below).
  -- Migration 036 owns the policy/access side of this column for the
  -- notification_prefs subsystem; we just ensure it exists so the cron
  -- can reference it without depending on 036 running first.
  ADD COLUMN IF NOT EXISTS preferred_language TEXT;

-- ── Client-callable RPC to update the timezone offset ───────────────────
--
-- The client should call this on every app bootstrap so users who travel
-- or change time zones get nudges at the new local evening, not the old.

CREATE OR REPLACE FUNCTION public.update_user_timezone_offset(
  p_offset_minutes INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Sanity bound: real-world offsets are in [-720, +840] minutes
  -- (-12:00 to +14:00). Anything outside is malformed.
  IF p_offset_minutes IS NULL
     OR p_offset_minutes < -720
     OR p_offset_minutes > 840 THEN
    RAISE EXCEPTION 'offset out of range' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_profiles
     SET timezone_offset_minutes = p_offset_minutes
   WHERE id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_timezone_offset(INTEGER) TO authenticated;

-- ── Cron worker ─────────────────────────────────────────────────────────
--
-- Runs once per hour, on the hour. For each candidate user, inserts a
-- notification row. Migration 034's trigger fans it out as a push.
--
-- We intentionally don't deduplicate via a SELECT ... INSERT race —
-- the UPDATE...RETURNING claim on last_streak_nudge_at IS the lock.
-- Two concurrent cron runs CANNOT both claim the same user.

-- ── Localized text helper ───────────────────────────────────────────────
--
-- Server-side translation table for the streak-break push. Adding new
-- languages: append a WHEN branch. Falling-through to the default 'en'
-- block means an unknown language code still ships English text (better
-- than NULL bodies that violate the notifications schema).
--
-- We render TITLE and BODY as a single jsonb pair so the caller pulls
-- both fields in one go.

CREATE OR REPLACE FUNCTION public.streak_break_text(
  p_language TEXT,
  p_streak   INTEGER
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE COALESCE(p_language, 'en')
    WHEN 'es' THEN jsonb_build_object(
      'title', '🔥 Racha de ' || p_streak || ' días en riesgo',
      'body',  'Tu racha termina a medianoche. Un entrenamiento rápido la mantiene viva.'
    )
    WHEN 'fr' THEN jsonb_build_object(
      'title', '🔥 Série de ' || p_streak || ' jours en péril',
      'body',  'Votre série se termine à minuit. Un entraînement rapide la sauve.'
    )
    WHEN 'de' THEN jsonb_build_object(
      'title', '🔥 ' || p_streak || '-Tage-Streak in Gefahr',
      'body',  'Dein Streak endet um Mitternacht. Ein schnelles Training rettet ihn.'
    )
    WHEN 'pt' THEN jsonb_build_object(
      'title', '🔥 Sequência de ' || p_streak || ' dias em risco',
      'body',  'Sua sequência termina à meia-noite. Um treino rápido a salva.'
    )
    WHEN 'it' THEN jsonb_build_object(
      'title', '🔥 Serie di ' || p_streak || ' giorni a rischio',
      'body',  'La tua serie finisce a mezzanotte. Un allenamento veloce la salva.'
    )
    WHEN 'ja' THEN jsonb_build_object(
      'title', '🔥 ' || p_streak || '日連続記録が危険',
      'body',  '深夜にストリークが途切れます。短い運動で維持できます。'
    )
    WHEN 'ko' THEN jsonb_build_object(
      'title', '🔥 ' || p_streak || '일 연속 기록 위험',
      'body',  '자정에 연속 기록이 끊깁니다. 짧은 운동으로 유지하세요.'
    )
    WHEN 'zh' THEN jsonb_build_object(
      'title', '🔥 ' || p_streak || '天连胜面临中断',
      'body',  '你的连胜将在午夜结束。一次快速锻炼即可保持。'
    )
    WHEN 'ar' THEN jsonb_build_object(
      'title', '🔥 سلسلة ' || p_streak || ' أيام في خطر',
      'body',  'تنتهي سلسلتك عند منتصف الليل. تمرين سريع يحافظ عليها.'
    )
    WHEN 'hi' THEN jsonb_build_object(
      'title', '🔥 ' || p_streak || ' दिन की लकीर खतरे में',
      'body',  'आपकी लकीर आधी रात को समाप्त होगी। एक छोटा वर्कआउट इसे जीवित रखेगा।'
    )
    WHEN 'ru' THEN jsonb_build_object(
      'title', '🔥 Серия ' || p_streak || ' дней под угрозой',
      'body',  'Ваша серия закончится в полночь. Быстрая тренировка её сохранит.'
    )
    WHEN 'tr' THEN jsonb_build_object(
      'title', '🔥 ' || p_streak || ' günlük seri risk altında',
      'body',  'Serin gece yarısı sona eriyor. Hızlı bir antrenman onu kurtarır.'
    )
    WHEN 'pl' THEN jsonb_build_object(
      'title', '🔥 ' || p_streak || '-dniowa passa zagrożona',
      'body',  'Twoja passa kończy się o północy. Szybki trening ją uratuje.'
    )
    WHEN 'nl' THEN jsonb_build_object(
      'title', '🔥 ' || p_streak || '-daagse reeks loopt gevaar',
      'body',  'Je reeks eindigt om middernacht. Een snelle workout houdt hem in leven.'
    )
    ELSE jsonb_build_object(
      'title', '🔥 ' || p_streak || '-day streak at risk',
      'body',  'Your streak ends at midnight. A quick workout keeps it alive.'
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.streak_break_text(TEXT, INTEGER) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.run_streak_break_reminders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now        TIMESTAMPTZ := now();
  v_today_utc  DATE        := (v_now AT TIME ZONE 'UTC')::date;
  v_count      INTEGER     := 0;
  v_row        RECORD;
  v_streak     INTEGER;
  v_title      TEXT;
  v_body       TEXT;
  v_text       JSONB;
  v_lang       TEXT;
BEGIN
  -- Atomic claim: select all users whose LOCAL hour is in [18, 21) AND
  -- who have a streak ≥ 2 AND haven't worked out today (in their tz)
  -- AND haven't been nudged in the last 18 hours. The UPDATE claims them
  -- in one shot via last_streak_nudge_at = now() so a concurrent cron
  -- pass cannot re-claim the same rows.
  FOR v_row IN
    UPDATE public.user_profiles AS p
       SET last_streak_nudge_at = v_now
     WHERE p.timezone_offset_minutes IS NOT NULL
       AND p.workout_streak >= 2
       AND (
             p.last_workout_date IS NULL
             OR p.last_workout_date <> ((v_now + (p.timezone_offset_minutes || ' minutes')::interval) AT TIME ZONE 'UTC')::date
           )
       AND (
             p.last_streak_nudge_at IS NULL
             OR p.last_streak_nudge_at < v_now - INTERVAL '18 hours'
           )
       -- Local hour of day right now, derived from offset:
       AND EXTRACT(HOUR FROM (v_now + (p.timezone_offset_minutes || ' minutes')::interval) AT TIME ZONE 'UTC')
           BETWEEN 18 AND 20
    RETURNING p.id AS user_id, p.email AS user_email, p.workout_streak,
              p.full_name, p.preferred_language
  LOOP
    v_streak := v_row.workout_streak;

    -- Defensive: a profile row without an email cannot satisfy the
    -- notifications NOT NULL constraint on user_email. Skip it (the
    -- last_streak_nudge_at claim already happened, which is fine —
    -- we'd rather lose one nudge than crash the cron mid-batch).
    IF v_row.user_email IS NULL THEN
      CONTINUE;
    END IF;

    -- Server-side i18n. preferred_language is pulled in the RETURNING
    -- clause above so we don't do an extra round trip per row.
    v_lang  := COALESCE(v_row.preferred_language, 'en');
    v_text  := public.streak_break_text(v_lang, v_streak);
    v_title := v_text ->> 'title';
    v_body  := v_text ->> 'body';

    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_row.user_id,
       v_row.user_email,
       'streak_break_warning',
       v_title,
       v_body,
       '🔥',
       '/workouts',
       jsonb_build_object('workout_streak', v_streak));

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.run_streak_break_reminders() FROM PUBLIC;

-- ── Schedule with pg_cron ───────────────────────────────────────────────
--
-- pg_cron is preinstalled on Supabase. We schedule on the hour, every
-- hour. The function itself filters by local-time window so off-hour
-- runs are cheap no-ops.
--
-- Re-running this block is safe: cron.unschedule() is a no-op if the
-- job doesn't exist, and cron.schedule() returns the existing jobid.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_existing_jobid
    FROM cron.job
   WHERE jobname = 'streak_break_reminders_hourly';

  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
  END IF;

  PERFORM cron.schedule(
    'streak_break_reminders_hourly',
    '0 * * * *',                                   -- on the hour, every hour
    $cron$ SELECT public.run_streak_break_reminders(); $cron$
  );
END $$;

NOTIFY pgrst, 'reload schema';
