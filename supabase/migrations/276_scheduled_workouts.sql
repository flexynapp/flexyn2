-- 276_scheduled_workouts.sql
--
-- Scheduled workouts — "Schedule it" on the AI Coach plan card.
--
-- WHY THIS EXISTS
-- Saving a generated session to Regimens produces an artefact the user has to
-- remember to come back to. Implementation-intention research (Gollwitzer) is
-- one of the more reliably replicated findings in behaviour change: naming
-- WHEN and WHERE a behaviour will happen roughly doubles follow-through versus
-- intention alone. So the card now lets someone pin the session to a day and
-- an hour, and this table plus its hourly cron is what turns that into an
-- actual trigger at the actual time.
--
-- LOCAL DATE + LOCAL HOUR, NOT A TIMESTAMPTZ
-- "Thursday at 7am" means 7am wherever the user wakes up, not a fixed instant.
-- Storing an absolute timestamp would silently shift the reminder for anyone
-- who travels, and would need rewriting on every timezone change. We store the
-- local date and local hour the user picked and resolve them against
-- user_profiles.timezone_offset_minutes at fire time — the same approach
-- migration 035 uses for streak reminders.
--
-- PASTE-SAFE
-- Written without table aliases, dotted record access or %ROWTYPE, per the
-- clipboard-mangling rule in CLAUDE.md: every statement is single-table with
-- bare column names, and the per-user local clock is a function call rather
-- than a join, so nothing here can arrive as `s.status` or `v_row.id`.

-- ── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.scheduled_workouts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email     TEXT NOT NULL,
  -- The user's LOCAL calendar date and hour. See the header note.
  scheduled_date DATE NOT NULL,
  scheduled_hour SMALLINT NOT NULL CHECK (scheduled_hour BETWEEN 0 AND 23),
  title          TEXT NOT NULL,
  -- The generateWorkout() session, stored whole so starting it later needs no
  -- regenerating: the workout someone scheduled is the workout they get, even
  -- if the generator's catalog or their history has moved on since.
  workout        JSONB NOT NULL,
  -- pending → notified → completed, or cancelled / missed.
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'notified', 'completed', 'cancelled', 'missed')),
  notified_at    TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The cron's claim query filters on status and orders by nothing; this index
-- keeps that scan proportional to what's actually pending rather than to every
-- workout anyone has ever scheduled.
CREATE INDEX IF NOT EXISTS idx_scheduled_workouts_pending
  ON public.scheduled_workouts(status, scheduled_date)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scheduled_workouts_user
  ON public.scheduled_workouts(user_id, scheduled_date DESC);

ALTER TABLE public.scheduled_workouts ENABLE ROW LEVEL SECURITY;

-- ── 2. RLS — a schedule is private to the person who set it ─────────────────

DROP POLICY IF EXISTS "Users read own scheduled workouts" ON public.scheduled_workouts;
CREATE POLICY "Users read own scheduled workouts"
  ON public.scheduled_workouts FOR SELECT
  USING (user_id = auth.uid());

-- No INSERT policy on purpose: rows are created only through
-- schedule_workout(), which derives user_id and user_email from auth.uid().
-- A client INSERT policy would let someone attach a schedule to another user,
-- and user_email is what the notification fan-out delivers to.

DROP POLICY IF EXISTS "Users update own scheduled workouts" ON public.scheduled_workouts;
CREATE POLICY "Users update own scheduled workouts"
  ON public.scheduled_workouts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own scheduled workouts" ON public.scheduled_workouts;
CREATE POLICY "Users delete own scheduled workouts"
  ON public.scheduled_workouts FOR DELETE
  USING (user_id = auth.uid());

GRANT SELECT, UPDATE, DELETE ON public.scheduled_workouts TO authenticated;

-- ── 3. The user's local wall clock ──────────────────────────────────────────
--
-- Factored into its own function so the cron's WHERE clause stays a
-- single-table statement with bare column names. A user who has never had
-- their offset recorded is treated as UTC rather than skipped: a reminder at
-- a possibly-wrong hour still beats a reminder that never arrives.

CREATE OR REPLACE FUNCTION public.user_local_now(p_user_id UUID)
RETURNS TIMESTAMP
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (now() + (COALESCE(timezone_offset_minutes, 0) || ' minutes')::interval)
           AT TIME ZONE 'UTC'
    FROM public.user_profiles
   WHERE id = p_user_id;
$$;

-- ── 4. Create a schedule ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.schedule_workout(
  p_date    DATE,
  p_hour    SMALLINT,
  p_title   TEXT,
  p_workout JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email   TEXT;
  v_pending INTEGER;
  v_id      UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_hour IS NULL OR p_hour < 0 OR p_hour > 23 THEN
    RAISE EXCEPTION 'hour must be 0-23';
  END IF;

  IF p_workout IS NULL OR jsonb_typeof(p_workout) <> 'object' THEN
    RAISE EXCEPTION 'workout payload required';
  END IF;

  -- A year out is not a plan, it's a way to fill the table.
  IF p_date IS NULL OR p_date > (CURRENT_DATE + 365) THEN
    RAISE EXCEPTION 'date out of range';
  END IF;

  SELECT email INTO v_email
    FROM public.user_profiles
   WHERE id = v_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'profile has no email to notify';
  END IF;

  -- Anti-spam ceiling. Nobody legitimately has 100 workouts queued, and each
  -- row carries a full session payload.
  SELECT COUNT(*) INTO v_pending
    FROM public.scheduled_workouts
   WHERE user_id = v_user_id
     AND status = 'pending';

  IF v_pending >= 100 THEN
    RAISE EXCEPTION 'too many scheduled workouts';
  END IF;

  INSERT INTO public.scheduled_workouts
    (user_id, user_email, scheduled_date, scheduled_hour, title, workout)
  VALUES
    (v_user_id, v_email, p_date, p_hour, COALESCE(NULLIF(p_title, ''), 'Workout'), p_workout)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_workout(DATE, SMALLINT, TEXT, JSONB) TO authenticated;

-- ── 5. The reminder cron ────────────────────────────────────────────────────
--
-- Runs hourly. Two passes:
--   • Anything more than 12 hours past its slot is marked 'missed' WITHOUT
--     notifying. If the cron was down, or the user's offset moved, a reminder
--     for yesterday morning arriving this evening is worse than silence — it
--     reads as the app being broken and it can't be acted on.
--   • Everything else that is due gets claimed atomically (UPDATE … RETURNING
--     sets status in the same statement that selects it) so two overlapping
--     cron passes can't both notify for the same row.

CREATE OR REPLACE FUNCTION public.fire_scheduled_workout_reminders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     UUID;
  v_user   UUID;
  v_email  TEXT;
  v_title  TEXT;
  v_count  INTEGER := 0;
BEGIN
  UPDATE public.scheduled_workouts
     SET status = 'missed'
   WHERE status = 'pending'
     AND public.user_local_now(user_id)
         > (scheduled_date + (scheduled_hour || ' hours')::interval + INTERVAL '12 hours');

  FOR v_id IN
    UPDATE public.scheduled_workouts
       SET status = 'notified', notified_at = now()
     WHERE status = 'pending'
       AND public.user_local_now(user_id)
           >= (scheduled_date + (scheduled_hour || ' hours')::interval)
    RETURNING id
  LOOP
    SELECT user_id, user_email, title
      INTO v_user, v_email, v_title
      FROM public.scheduled_workouts
     WHERE id = v_id;

    -- Deep-links straight to the session rather than to the Workout page in
    -- general: a reminder that lands you somewhere you still have to go find
    -- the thing is most of a reminder that didn't work.
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_user,
       v_email,
       'workout_reminder',
       'Time to train 💪',
       COALESCE(v_title, 'Your workout') || ' is ready when you are.',
       '🏋️',
       '/workout?scheduled=' || v_id::text,
       jsonb_build_object('scheduledWorkoutId', v_id));

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 'workout_reminder' is deliberately NOT added to notification_type_category.
-- Unmapped types fall through the preference check and always deliver (see
-- migration 083), which is the behaviour we want here: the user explicitly
-- asked for THIS reminder at THIS hour, so muting the broad "engagement"
-- category — which exists for nudges we initiate — should not silence it.
-- Quiet hours (migration 098) still apply, and a user-chosen training hour is
-- very unlikely to land inside them.

-- ── 6. Schedule it ──────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('scheduled-workout-reminders');
EXCEPTION WHEN OTHERS THEN
  NULL; -- not scheduled yet
END;
$$;

SELECT cron.schedule(
  'scheduled-workout-reminders',
  '5 * * * *',
  $$ SELECT public.fire_scheduled_workout_reminders(); $$
);
