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
  ADD COLUMN IF NOT EXISTS last_streak_nudge_at TIMESTAMPTZ;

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
    RETURNING p.id AS user_id, p.email AS user_email, p.workout_streak, p.full_name
  LOOP
    v_streak := v_row.workout_streak;

    -- Defensive: a profile row without an email cannot satisfy the
    -- notifications NOT NULL constraint on user_email. Skip it (the
    -- last_streak_nudge_at claim already happened, which is fine —
    -- we'd rather lose one nudge than crash the cron mid-batch).
    IF v_row.user_email IS NULL THEN
      CONTINUE;
    END IF;

    -- Pre-rendered, English. Client doesn't translate notification body
    -- text on render (it stores already-translated strings — see
    -- migration 017 schema notes). If we add server-side i18n later, we
    -- look up the user's language column here.
    v_title := '🔥 ' || v_streak || '-day streak at risk';
    v_body  := 'Your streak ends at midnight. A quick workout keeps it alive.';

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
