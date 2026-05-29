-- 167_earned_trophies.sql
--
-- Auto-awarded milestone trophies — distinct from the existing
-- decorative trophy_case JSONB on user_profiles (that one stores
-- 5 emoji slots the user picks for display). This system tracks
-- actual achievements they've unlocked.
--
-- Server checks each trophy's criteria via SQL, INSERTs the newly
-- earned ones, and returns the list of new grants so the client can
-- celebrate. Idempotent — re-calling the RPC won't double-grant
-- because of the UNIQUE (user_id, trophy_id) constraint.
--
-- Catalog mirror lives in src/lib/trophyDefinitions.js — keep in sync.
-- Paste-safe per CLAUDE.md.

-- ── Earned trophies table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_trophies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  TEXT NOT NULL,
  trophy_id   TEXT NOT NULL,
  earned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, trophy_id)
);

CREATE INDEX IF NOT EXISTS idx_user_trophies_user_id
  ON public.user_trophies (user_id);

CREATE INDEX IF NOT EXISTS idx_user_trophies_user_earned
  ON public.user_trophies (user_id, earned_at DESC);

ALTER TABLE public.user_trophies ENABLE ROW LEVEL SECURITY;

-- Anyone can READ another user's earned trophies (they show on the
-- public profile). Owner-only via the RPC for writes.
DROP POLICY IF EXISTS "trophies: read all" ON public.user_trophies;
CREATE POLICY "trophies: read all"
  ON public.user_trophies FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.user_trophies TO authenticated;


-- ── Grant RPC — checks criteria + inserts newly earned ───────────

CREATE OR REPLACE FUNCTION public.grant_eligible_trophies()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid               UUID := auth.uid();
  v_email             TEXT := auth.email();
  v_workout_count     INTEGER;
  v_streak            INTEGER;
  v_level             INTEGER;
  v_duel_wins         INTEGER;
  v_crew_count        INTEGER;
  v_max_distance      INTEGER;
  v_newly_granted     TEXT[] := ARRAY[]::TEXT[];

  -- Helper inserts a trophy if eligible AND not already earned.
  -- Returns true if newly inserted, false if it was already there.
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- ── Gather criteria signals in one read each ──────────────────

  SELECT COUNT(*) INTO v_workout_count
    FROM public.workout_logs
   WHERE user_id = v_uid OR created_by = v_email;

  SELECT COALESCE(workout_streak, 0),
         COALESCE(current_level, 1)
    INTO v_streak, v_level
    FROM public.user_profiles
   WHERE id = v_uid;

  SELECT COUNT(*) INTO v_duel_wins
    FROM public.duels
   WHERE winner_id = v_uid;

  SELECT COUNT(*) INTO v_crew_count
    FROM public.crew_members
   WHERE user_id = v_uid;

  SELECT COALESCE(MAX(distance_meters), 0)::INTEGER INTO v_max_distance
    FROM public.cardio_logs
   WHERE user_id = v_uid OR created_by = v_email;

  -- ── Insert-or-skip each eligible trophy ───────────────────────

  -- Workout count
  IF v_workout_count >= 1 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'first_rep')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'first_rep'); END IF;
  END IF;
  IF v_workout_count >= 10 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'consistent')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'consistent'); END IF;
  END IF;
  IF v_workout_count >= 50 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'committed')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'committed'); END IF;
  END IF;
  IF v_workout_count >= 100 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'centurion')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'centurion'); END IF;
  END IF;

  -- Streak
  IF v_streak >= 7 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'streak_spark')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'streak_spark'); END IF;
  END IF;
  IF v_streak >= 30 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'streak_blaze')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'streak_blaze'); END IF;
  END IF;
  IF v_streak >= 100 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'streak_inferno')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'streak_inferno'); END IF;
  END IF;
  IF v_streak >= 365 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'streak_eternal')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'streak_eternal'); END IF;
  END IF;

  -- Level
  IF v_level >= 10 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'level_tier1')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'level_tier1'); END IF;
  END IF;
  IF v_level >= 25 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'level_tier2')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'level_tier2'); END IF;
  END IF;
  IF v_level >= 50 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'level_tier3')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'level_tier3'); END IF;
  END IF;
  IF v_level >= 100 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'level_apex')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'level_apex'); END IF;
  END IF;

  -- Duels
  IF v_duel_wins >= 1 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'duel_challenger')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'duel_challenger'); END IF;
  END IF;
  IF v_duel_wins >= 10 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'duel_champion')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'duel_champion'); END IF;
  END IF;

  -- Crew
  IF v_crew_count >= 1 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'crew_squad')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'crew_squad'); END IF;
  END IF;

  -- Cardio
  IF v_max_distance >= 5000 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'cardio_5k')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'cardio_5k'); END IF;
  END IF;
  IF v_max_distance >= 10000 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'cardio_10k')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'cardio_10k'); END IF;
  END IF;
  IF v_max_distance >= 21097 THEN
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_uid, v_email, 'cardio_half')
    ON CONFLICT (user_id, trophy_id) DO NOTHING;
    IF FOUND THEN v_newly_granted := array_append(v_newly_granted, 'cardio_half'); END IF;
  END IF;

  RETURN jsonb_build_object(
    'newly_granted', to_jsonb(v_newly_granted)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_eligible_trophies() TO authenticated;

NOTIFY pgrst, 'reload schema';
