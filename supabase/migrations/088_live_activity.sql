-- 088_live_activity.sql
--
-- Strava-style "live activity" presence. When a user starts a workout,
-- we mark them active until a TTL elapses (default 90 minutes). The
-- Hub follow list + feed surfaces this with a green pulsing dot next
-- to active friends. Drives FOMO + copy-cat workouts — a social
-- mechanic that compounds with the crew wars / duels / nemesis stack
-- we already have.
--
-- DESIGN
-- ──────
-- A single column on user_profiles (active_until TIMESTAMPTZ NULL) is
-- enough. NULL means not active; a value in the future means active
-- until that timestamp. Past timestamps are equivalent to NULL — the
-- "is active now" predicate is `active_until > now()`, which is
-- index-safe.
--
-- Why a column on user_profiles rather than a separate presence
-- table:
--   • The presence read happens alongside the user_profiles read on
--     every follow-list render. Co-locating avoids a JOIN.
--   • The cardinality is at most one row per user — a dedicated table
--     would have the same row count plus a FK overhead.
--   • An UPDATE-in-place is fewer writes than INSERT-then-DELETE.
--
-- RPCs (instead of direct UPDATE):
--   • mark_workout_active(p_duration_minutes) — caps duration at 4h to
--     prevent forever-active gaming. Returns the new active_until.
--   • clear_workout_active() — explicit clear when a workout is saved
--     or cancelled. Idempotent; sets active_until = NULL.
--
-- Indexes:
--   • A partial index on active_until WHERE active_until > now() would
--     be ideal but Postgres requires immutable predicates in partial
--     indexes (now() isn't). A plain index on active_until DESC
--     handles the "list active friends" query well enough at typical
--     scales — the planner uses the index for the > comparison.

-- ── Schema ────────────────────────────────────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS active_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_profiles_active_until
  ON public.user_profiles (active_until DESC)
  WHERE active_until IS NOT NULL;

-- ── mark_workout_active(p_duration_minutes INT DEFAULT 90) ────────────
--
-- Called by the client at the START of a workout. Cap the duration at
-- 4 hours so a buggy or hostile client can't keep someone "active"
-- forever — long workouts are real but 4h is already an absurd ceiling.

CREATE OR REPLACE FUNCTION public.mark_workout_active(
  p_duration_minutes INT DEFAULT 90
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_capped INT  := LEAST(GREATEST(COALESCE(p_duration_minutes, 90), 1), 240);
  v_until  TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_until := now() + (v_capped || ' minutes')::interval;

  UPDATE public.user_profiles
     SET active_until = v_until
   WHERE id = v_uid;

  RETURN v_until;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_workout_active(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_workout_active(INT) TO authenticated;

-- ── clear_workout_active() ────────────────────────────────────────────
-- Called when the workout is saved or explicitly abandoned. Idempotent.

CREATE OR REPLACE FUNCTION public.clear_workout_active()
RETURNS VOID
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

  UPDATE public.user_profiles
     SET active_until = NULL
   WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_workout_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_workout_active() TO authenticated;

-- ── get_active_followees() ─────────────────────────────────────────────
-- Returns the set of users this caller follows who are CURRENTLY active.
-- Single round-trip — replaces a client-side N×N join. SECURITY DEFINER
-- so it can read user_profiles.active_until without that column needing
-- a public SELECT policy.

CREATE OR REPLACE FUNCTION public.get_active_followees()
RETURNS TABLE (
  user_id      UUID,
  username     TEXT,
  avatar_url   TEXT,
  active_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  RETURN QUERY
    SELECT p.id, p.username, p.avatar_url, p.active_until
      FROM public.hub_follows hf
      JOIN public.user_profiles p ON p.email = hf.followee_email
     WHERE hf.follower_email = v_email
       AND p.active_until > now()
     ORDER BY p.active_until DESC
     LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_followees() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_followees() TO authenticated;

NOTIFY pgrst, 'reload schema';
