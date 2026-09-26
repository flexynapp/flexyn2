-- 087_streak_rescue.sql
--
-- One-tap streak rescue. Migration 035 already pushes a "your streak is
-- about to break" notification in the user's local 18-21h window when a
-- 2+ day streak is at risk. That warning has no recovery affordance —
-- the user sees the push, doesn't have time/energy to work out, and
-- watches the streak die. Two days later they get a smaller streak that
-- carries less identity weight. Multiply by a churn risk and we lose
-- engaged users at exactly the moment they're most fragile.
--
-- This migration adds the missing escape hatch: a once-per-month rescue
-- the user can spend to keep a broken streak alive. Triggers when the
-- user MISSED yesterday (days_since_last_workout = 2) and had a streak
-- of at least 3 going. The rescue resets last_workout_date to yesterday
-- so the next real workout extends instead of resetting.
--
-- ELIGIBILITY (server-enforced in the RPC)
-- ────────────────────────────────────────
-- All four must hold:
--   1. Caller is authenticated.
--   2. workout_streak >= 3 — don't burn a rescue on a 2-day streak; not
--      enough identity invested yet to matter.
--   3. days_since_last_workout = 2 — they missed exactly yesterday. A
--      streak broken longer than that is already psychologically gone;
--      rescuing a 7-day-old corpse is bad UX.
--   4. No rescue used this calendar month. Enforced atomically by a
--      UNIQUE (user_id, month_start) constraint on streak_rescues — two
--      concurrent tap-and-tap requests can't double-spend.
--
-- STRUCTURE
-- ─────────
--   • streak_rescues table — audit log + cap enforcement
--   • use_streak_rescue() RPC — atomic eligibility check + extension
--   • streak_rescue_status() RPC — read-only eligibility for the banner

-- ── Audit + cap table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.streak_rescues (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_start  DATE NOT NULL,
  used_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  streak_saved INT  NOT NULL,
  -- One rescue per (user, calendar month). The UNIQUE constraint is the
  -- atomic cap — the RPC just attempts the INSERT and catches the
  -- unique_violation rather than reading-then-writing.
  CONSTRAINT streak_rescues_one_per_month UNIQUE (user_id, month_start)
);

CREATE INDEX IF NOT EXISTS idx_streak_rescues_user_month
  ON public.streak_rescues (user_id, month_start DESC);

ALTER TABLE public.streak_rescues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "streak_rescues: own row" ON public.streak_rescues;
CREATE POLICY "streak_rescues: own row"
  ON public.streak_rescues FOR SELECT
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy — writes happen exclusively through
-- the SECURITY DEFINER RPC below. Migration 085's ALTER DEFAULT
-- PRIVILEGES grants service_role full DML on new tables automatically,
-- so the RPC can write through.

-- ── use_streak_rescue() ───────────────────────────────────────────────
--
-- Atomic: locks the user_profiles row FOR UPDATE so two concurrent
-- presses can't both pass eligibility. Then attempts the INSERT into
-- streak_rescues — the UNIQUE constraint rejects duplicates so even if
-- two RPC calls slipped past the eligibility check at the same instant,
-- only one INSERT succeeds.
--
-- Returns a JSONB envelope so the client can show a specific toast per
-- failure reason. Never raises on a normal "can't use rescue" condition
-- (would cause a generic 500 toast); only raises on auth / db errors.

CREATE OR REPLACE FUNCTION public.use_streak_rescue()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_today       DATE := (now() AT TIME ZONE 'UTC')::date;
  v_month_start DATE := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v_yesterday   DATE := ((now() AT TIME ZONE 'UTC')::date - INTERVAL '1 day')::date;
  v_streak      INT;
  v_last_date   DATE;
  v_diff        INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Lock the profile row. Prevents concurrent rescue attempts from
  -- both reading old state.
  SELECT workout_streak, last_workout_date
    INTO v_streak, v_last_date
    FROM public.user_profiles
   WHERE id = v_uid
   FOR UPDATE;

  IF v_streak IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_profile');
  END IF;

  IF v_streak < 3 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'streak_too_short',
      'current_streak', v_streak
    );
  END IF;

  IF v_last_date IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_last_workout');
  END IF;

  v_diff := v_today - v_last_date;
  IF v_diff <> 2 THEN
    -- diff=0: logged today, no rescue needed
    -- diff=1: at risk but not broken — just work out
    -- diff>=3: too late, streak too cold to rescue
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'not_eligible',
      'current_streak', v_streak,
      'days_since', v_diff
    );
  END IF;

  -- Atomic cap. The UNIQUE constraint on (user_id, month_start) is the
  -- monthly limit. We try the insert; a duplicate means rescue was
  -- already used this month.
  BEGIN
    INSERT INTO public.streak_rescues (user_id, month_start, streak_saved)
    VALUES (v_uid, v_month_start, v_streak);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'already_used_this_month',
      'current_streak', v_streak
    );
  END;

  -- Extend the streak: set last_workout_date to yesterday. Now when the
  -- user next records a workout, recordWorkoutDay computes diff=1 and
  -- increments instead of resetting. The streak is preserved as if they
  -- had logged something yesterday.
  --
  -- Why not set last_workout_date to today? Setting to today would mean
  -- the streak counter is already incremented without any actual
  -- workout — gaming the streak system. Setting to yesterday requires
  -- the rescue PLUS a real workout to keep the chain alive, which
  -- preserves the spirit of the streak (you did a workout most days)
  -- while only allowing one missed day per month.
  UPDATE public.user_profiles
     SET last_workout_date = v_yesterday
   WHERE id = v_uid;

  RETURN jsonb_build_object(
    'ok',                            true,
    'streak_saved',                  v_streak,
    'next_workout_continues_streak', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.use_streak_rescue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.use_streak_rescue() TO authenticated;

-- ── streak_rescue_status() ────────────────────────────────────────────
--
-- Read-only eligibility check. The Dashboard banner calls this on each
-- mount to decide whether to render the rescue offer. Returns the same
-- shape as use_streak_rescue()'s failure envelope so the UI can map
-- reason → message uniformly.

CREATE OR REPLACE FUNCTION public.streak_rescue_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_today       DATE := (now() AT TIME ZONE 'UTC')::date;
  v_month_start DATE := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v_streak      INT;
  v_last_date   DATE;
  v_diff        INT;
  v_used        INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT workout_streak, last_workout_date
    INTO v_streak, v_last_date
    FROM public.user_profiles
   WHERE id = v_uid;

  IF v_streak IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'no_profile');
  END IF;

  SELECT COUNT(*) INTO v_used
    FROM public.streak_rescues
   WHERE user_id = v_uid
     AND month_start = v_month_start;

  IF v_used > 0 THEN
    RETURN jsonb_build_object(
      'available',      false,
      'reason',         'already_used_this_month',
      'current_streak', v_streak
    );
  END IF;

  IF v_streak < 3 THEN
    RETURN jsonb_build_object(
      'available',      false,
      'reason',         'streak_too_short',
      'current_streak', v_streak
    );
  END IF;

  IF v_last_date IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'no_last_workout');
  END IF;

  v_diff := v_today - v_last_date;
  IF v_diff <> 2 THEN
    RETURN jsonb_build_object(
      'available',      false,
      'reason',         'not_at_risk',
      'current_streak', v_streak,
      'days_since',     v_diff
    );
  END IF;

  RETURN jsonb_build_object(
    'available',      true,
    'current_streak', v_streak,
    'days_since',     v_diff
  );
END;
$$;

REVOKE ALL ON FUNCTION public.streak_rescue_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.streak_rescue_status() TO authenticated;

NOTIFY pgrst, 'reload schema';
