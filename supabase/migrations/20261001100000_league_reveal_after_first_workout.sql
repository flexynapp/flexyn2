-- Your league is revealed after your first workout (Kegan, 2026-10-01: "let
-- the user input data prior to league placement, they have to complete a
-- workout to see placement, after their first workout play the animation for
-- league placement").
--
-- Onboarding still asks the questions and still stores the answers. Nothing
-- is placed from them until the account has a completed session: a saved
-- workout the plausibility check did not flag, or a saved cardio session.
-- That first session places you inside its own save:
--   the Strength Score if that session already gives one,
--   otherwise the onboarding answers (capped at Silver, #290),
--   otherwise Bronze.
--
-- league_strength.revealed_at   when that happened. NULL = not placed yet.
-- league_strength.reveal_seen_at when the app played the placement reveal.
-- my_league_strength() reports revealed / reveal_pending so Today knows when
-- to play it, and mark_my_league_reveal_seen() stops it replaying on another
-- device. While unrevealed, ensure_my_league() joins no weekly bracket and
-- returns {"revealed": false}, and every placement path answers 'unrevealed'.
--
-- Existing accounts: anyone with a completed session is marked revealed and
-- seen, so nobody who already sees a league gets it replayed. Accounts with
-- no session (139 on 2026-10-01) go back to unplaced: their onboarding
-- placement is cleared and their league reset to Bronze, the default every
-- unplaced account already has. No notification is sent for that. No rows
-- are deleted.

ALTER TABLE public.league_strength ADD COLUMN IF NOT EXISTS revealed_at timestamptz;
ALTER TABLE public.league_strength ADD COLUMN IF NOT EXISTS reveal_seen_at timestamptz;

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------

-- A completed session: a workout the plausibility check passed, or a cardio
-- session. Same predicate the competitive readers use for workout_logs.
CREATE OR REPLACE FUNCTION public.league_has_completed_session(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.workout_logs
                  WHERE user_id = p_user_id AND NOT COALESCE(implausible, FALSE))
      OR EXISTS (SELECT 1 FROM public.cardio_logs WHERE user_id = p_user_id);
$$;

CREATE OR REPLACE FUNCTION public.league_is_revealed(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.league_strength
                  WHERE user_id = p_user_id AND revealed_at IS NOT NULL);
$$;

-- Place an account for the first time, once it has a completed session.
-- Returns the placement outcome, or NULL when there is nothing to do.
CREATE OR REPLACE FUNCTION public.league_reveal_internal(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;
  -- Two sessions saved at once must not both place: the profile row lock
  -- serialises them, and the second sees the first's reveal.
  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF public.league_is_revealed(p_user_id) THEN RETURN NULL; END IF;
  IF NOT public.league_has_completed_session(p_user_id) THEN RETURN NULL; END IF;

  INSERT INTO public.league_strength (user_id, score, detail, computed_at, revealed_at)
  VALUES (p_user_id, NULL, '{}'::jsonb, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET revealed_at = now(), reveal_seen_at = NULL, placed_at = NULL, basis = NULL;

  RETURN public.league_apply_strength_placement(p_user_id);
END;
$$;

------------------------------------------------------------------------------
-- The first session's save reveals the league. A league is never worth
-- losing a workout over, so any failure here is swallowed.
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.league_reveal_on_workout_log()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NOT COALESCE(NEW.implausible, FALSE)
     AND NOT public.league_is_revealed(NEW.user_id) THEN
    PERFORM public.league_reveal_internal(NEW.user_id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.league_reveal_on_cardio_log()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NOT public.league_is_revealed(NEW.user_id) THEN
    PERFORM public.league_reveal_internal(NEW.user_id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS league_reveal_on_workout_log ON public.workout_logs;
CREATE TRIGGER league_reveal_on_workout_log
  AFTER INSERT ON public.workout_logs
  FOR EACH ROW EXECUTE FUNCTION public.league_reveal_on_workout_log();

DROP TRIGGER IF EXISTS league_reveal_on_cardio_log ON public.cardio_logs;
CREATE TRIGGER league_reveal_on_cardio_log
  AFTER INSERT ON public.cardio_logs
  FOR EACH ROW EXECUTE FUNCTION public.league_reveal_on_cardio_log();

------------------------------------------------------------------------------
-- Placement: restated from the installed body with one gate added at the
-- top. The Monday roll and ensure_my_league both call this, so an account
-- that has not trained yet is never placed by either.
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.league_apply_strength_placement(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_score   numeric;
  v_placed  timestamptz;
  v_basis   text;
  v_tier    text;
  v_shields integer;
  v_target  text;
  v_new     text;
  v_bwgiven boolean;
BEGIN
  IF p_user_id IS NULL THEN RETURN 'unscored'; END IF;
  -- Nothing is placed before the first completed session.
  IF NOT public.league_is_revealed(p_user_id) THEN RETURN 'unrevealed'; END IF;

  SELECT COALESCE(league_tier, 'bronze'), COALESCE(league_shields_owned, 0)
    INTO v_tier, v_shields
    FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unscored'; END IF;
  IF public.league_tier_rank(v_tier) = 1 AND v_tier <> 'bronze' THEN v_tier := 'bronze'; END IF;

  v_score := public.league_strength_refresh(p_user_id);
  SELECT placed_at, basis, COALESCE((detail->>'bodyweight_given')::boolean, TRUE)
    INTO v_placed, v_basis, v_bwgiven
    FROM public.league_strength WHERE user_id = p_user_id;

  -- No score yet: onboarding answers may place you once.
  IF v_score IS NULL THEN
    IF v_placed IS NOT NULL THEN RETURN 'hold'; END IF;
    v_target := public.league_onboarding_tier(p_user_id);
    IF v_target IS NULL THEN RETURN 'unscored'; END IF;
    INSERT INTO public.league_strength (user_id, score, detail, placed_at, basis, computed_at)
    VALUES (p_user_id, NULL, '{}'::jsonb, now(), 'onboarding', now())
    ON CONFLICT (user_id) DO UPDATE SET placed_at = now(), basis = 'onboarding';
    IF v_target IS DISTINCT FROM v_tier THEN
      UPDATE public.user_profiles SET league_tier = v_target WHERE id = p_user_id;
      PERFORM public.league_sync_open_member_tier(p_user_id, v_target);
    END IF;
    IF v_target <> 'bronze' THEN
      PERFORM public.notify_league_placement_internal(p_user_id, 'provisional', v_target);
    END IF;
    RETURN 'provisional';
  END IF;

  v_target := public.league_tier_for_score(v_score);
  -- A guessed bodyweight never places you above Gold.
  IF NOT v_bwgiven AND public.league_tier_rank(v_target) > 3 THEN v_target := 'gold'; END IF;

  -- First real score, or the first after an onboarding placement: the score
  -- decides outright, in either direction.
  IF v_placed IS NULL OR v_basis IS DISTINCT FROM 'lifts' THEN
    UPDATE public.league_strength SET placed_at = now(), basis = 'lifts' WHERE user_id = p_user_id;
    IF v_target IS DISTINCT FROM v_tier THEN
      UPDATE public.user_profiles SET league_tier = v_target WHERE id = p_user_id;
      PERFORM public.league_sync_open_member_tier(p_user_id, v_target);
    END IF;
    IF v_target <> 'bronze' OR v_target IS DISTINCT FROM v_tier THEN
      PERFORM public.notify_league_placement_internal(p_user_id, 'placed', v_target);
    END IF;
    RETURN 'placed';
  END IF;

  IF public.league_tier_rank(v_target) > public.league_tier_rank(v_tier) THEN
    v_new := public.league_tier_at(public.league_tier_rank(v_tier) + 1);
    UPDATE public.user_profiles SET league_tier = v_new WHERE id = p_user_id;
    PERFORM public.league_sync_open_member_tier(p_user_id, v_new);
    PERFORM public.notify_league_placement_internal(p_user_id, 'promote', v_new);
    RETURN 'promote';
  END IF;

  IF v_tier <> 'bronze'
     AND (v_score < public.league_tier_floor(v_tier) * 0.9
          OR (NOT v_bwgiven AND public.league_tier_rank(v_tier) > 3)) THEN
    IF v_shields >= 1 AND v_bwgiven THEN
      UPDATE public.user_profiles
         SET league_shields_owned = league_shields_owned - 1,
             league_shield_used_at = now()
       WHERE id = p_user_id;
      PERFORM public.notify_league_placement_internal(p_user_id, 'shielded', v_tier);
      RETURN 'shielded';
    END IF;
    v_new := public.league_tier_at(public.league_tier_rank(v_tier) - 1);
    UPDATE public.user_profiles SET league_tier = v_new WHERE id = p_user_id;
    PERFORM public.league_sync_open_member_tier(p_user_id, v_new);
    PERFORM public.notify_league_placement_internal(p_user_id, 'demote', v_new);
    RETURN 'demote';
  END IF;

  RETURN 'hold';
END;
$function$;

------------------------------------------------------------------------------
-- ensure_my_league: restated from the installed body. Reveals first (covers
-- a session saved before this migration), then joins a bracket only once
-- revealed.
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_my_league()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        UUID := auth.uid();
  v_email      TEXT := public.current_user_email();
  v_tier       TEXT;
  v_week_start DATE;
  v_week_end   DATE;
  v_league_id  UUID;
  v_member_id  UUID;
  v_same_tier  INTEGER;
  v_league     JSONB;
  v_member     JSONB;
BEGIN
  IF v_uid IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- No league, and no weekly bracket, before the first completed session.
  PERFORM public.league_reveal_internal(v_uid);
  IF NOT public.league_is_revealed(v_uid) THEN
    RETURN jsonb_build_object('revealed', false);
  END IF;

  -- First placement lands the moment you have a Strength Score, not on the
  -- next Monday. After that, tiers only move at the weekly roll.
  IF NOT EXISTS (SELECT 1 FROM public.league_strength
                  WHERE user_id = v_uid AND placed_at IS NOT NULL) THEN
    PERFORM public.league_apply_strength_placement(v_uid);
  END IF;

  SELECT coalesce(league_tier, 'bronze') INTO v_tier
    FROM public.user_profiles
   WHERE id = v_uid;

  v_tier := coalesce(v_tier, 'bronze');
  IF NOT (v_tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'legend')) THEN
    v_tier := 'bronze';
  END IF;

  v_week_start := (date_trunc('week', CURRENT_DATE))::DATE;
  v_week_end   := v_week_start + 6;

  SELECT id, league_id INTO v_member_id, v_league_id
    FROM public.league_members
   WHERE user_id = v_uid
     AND league_id IN (
       SELECT id FROM public.leagues WHERE week_start = v_week_start
     )
   ORDER BY joined_at DESC
   LIMIT 1;

  IF v_member_id IS NULL THEN
    -- A bracket at your own tier first.
    SELECT id INTO v_league_id
      FROM public.leagues
     WHERE tier = v_tier
       AND week_start = v_week_start
       AND is_resolved = FALSE
       AND member_count < 30
     ORDER BY member_count DESC, created_at ASC
     LIMIT 1;

    IF v_league_id IS NULL THEN
      -- The weekly race is on training days, so racing people from the next
      -- tier over is fair; racing nobody is not. Only once five people at
      -- your tier are active this week does your tier get brackets of its own.
      SELECT count(*) INTO v_same_tier
        FROM public.league_members m
        JOIN public.leagues l ON l.id = m.league_id
       WHERE l.week_start = v_week_start AND m.tier = v_tier;

      IF v_same_tier < 5 THEN
        SELECT id INTO v_league_id
          FROM public.leagues
         WHERE week_start = v_week_start
           AND is_resolved = FALSE
           AND member_count < 30
         ORDER BY abs(public.league_tier_rank(tier) - public.league_tier_rank(v_tier)),
                  member_count DESC, created_at ASC
         LIMIT 1;
      END IF;
    END IF;

    IF v_league_id IS NULL THEN
      INSERT INTO public.leagues (tier, week_start, week_end, member_count, is_resolved)
      VALUES (v_tier, v_week_start, v_week_end, 0, FALSE)
      RETURNING id INTO v_league_id;
    END IF;

    INSERT INTO public.league_members (league_id, user_id, user_email, weekly_xp, tier)
    VALUES (v_league_id, v_uid, v_email, 0, v_tier)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_member_id;

    IF v_member_id IS NULL THEN
      SELECT id INTO v_member_id
        FROM public.league_members
       WHERE league_id = v_league_id
         AND user_id = v_uid
       LIMIT 1;
    END IF;
  END IF;

  SELECT to_jsonb(leagues) INTO v_league
    FROM public.leagues
   WHERE id = v_league_id;

  SELECT to_jsonb(league_members) INTO v_member
    FROM public.league_members
   WHERE id = v_member_id;

  RETURN jsonb_build_object('revealed', true, 'league', v_league, 'member', v_member);
END;
$function$;

------------------------------------------------------------------------------
-- What the league screens show. Unrevealed: no tier at all, so nothing can
-- draw one. Revealed: as before, plus whether the reveal still has to play.
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_league_strength()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v          jsonb;
  v_tier     text;
  v_placed   timestamptz;
  v_basis    text;
  v_next     text;
  v_revealed timestamptz;
  v_seen     timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT placed_at, basis, revealed_at, reveal_seen_at
    INTO v_placed, v_basis, v_revealed, v_seen
    FROM public.league_strength WHERE user_id = v_uid;
  IF v_revealed IS NULL THEN
    RETURN jsonb_build_object('revealed', false, 'reveal_pending', false,
                              'revealed_at', NULL, 'tier', NULL, 'placed', false);
  END IF;

  v := public.league_strength_compute(v_uid);
  SELECT COALESCE(league_tier, 'bronze') INTO v_tier FROM public.user_profiles WHERE id = v_uid;
  v_next := CASE WHEN public.league_tier_rank(v_tier) < 6
                 THEN public.league_tier_at(public.league_tier_rank(v_tier) + 1) END;
  RETURN COALESCE(v, '{}'::jsonb) || jsonb_build_object(
    'revealed', true,
    'reveal_pending', v_seen IS NULL,
    'revealed_at', v_revealed,
    'tier', v_tier,
    'placed', v_placed IS NOT NULL,
    'basis', v_basis,
    'tier_floor', public.league_tier_floor(v_tier),
    'drop_below', CASE WHEN v_tier = 'bronze' THEN NULL
                       ELSE round(public.league_tier_floor(v_tier) * 0.9, 1) END,
    'next_tier', v_next,
    'next_floor', CASE WHEN v_next IS NULL THEN NULL ELSE public.league_tier_floor(v_next) END);
END;
$function$;

-- The app has played the placement reveal. Once per account, any device.
CREATE OR REPLACE FUNCTION public.mark_my_league_reveal_seen()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  UPDATE public.league_strength
     SET reveal_seen_at = now()
   WHERE user_id = v_uid AND revealed_at IS NOT NULL AND reveal_seen_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.league_has_completed_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_is_revealed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_reveal_internal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_reveal_on_workout_log() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_reveal_on_cardio_log() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_apply_strength_placement(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_league_strength() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_league_strength() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_my_league_reveal_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_my_league_reveal_seen() TO authenticated;

------------------------------------------------------------------------------
-- Existing accounts
------------------------------------------------------------------------------

-- Already trained: revealed, and the reveal counts as seen.
INSERT INTO public.league_strength (user_id, score, detail, computed_at, revealed_at, reveal_seen_at)
SELECT up.id, NULL, '{}'::jsonb, now(), now(), now()
  FROM public.user_profiles up
 WHERE public.league_has_completed_session(up.id)
ON CONFLICT (user_id) DO UPDATE
  SET revealed_at    = COALESCE(public.league_strength.revealed_at, now()),
      reveal_seen_at = COALESCE(public.league_strength.reveal_seen_at, now());

-- Not trained yet: unplaced, Bronze by default, no notification.
DO $unplace$
DECLARE v_uid uuid; v_tier text;
BEGIN
  FOR v_uid, v_tier IN
    SELECT up.id, COALESCE(up.league_tier, 'bronze')
      FROM public.user_profiles up
     WHERE NOT public.league_has_completed_session(up.id)
  LOOP
    BEGIN
      UPDATE public.league_strength
         SET placed_at = NULL, basis = NULL, revealed_at = NULL, reveal_seen_at = NULL
       WHERE user_id = v_uid;
      IF v_tier <> 'bronze' THEN
        UPDATE public.user_profiles SET league_tier = 'bronze' WHERE id = v_uid;
        PERFORM public.league_sync_open_member_tier(v_uid, 'bronze');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'league unplace failed for %: %', v_uid, SQLERRM;
    END;
  END LOOP;
END;
$unplace$;

------------------------------------------------------------------------------
-- Probe: the whole path as a real authenticated account, rolled back.
------------------------------------------------------------------------------
DO $probe$
DECLARE
  v_a     uuid := gen_random_uuid();
  v_email text := 'lr-probe-' || v_a || '@example.invalid';
  v_r     text;
  v_s     jsonb;
  v_e     jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_profiles up
              WHERE NOT public.league_is_revealed(up.id)
                AND COALESCE(up.league_tier, 'bronze') <> 'bronze') THEN
    RAISE EXCEPTION 'probe: an unrevealed account is above Bronze';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_profiles up
              WHERE public.league_has_completed_session(up.id)
                AND NOT public.league_is_revealed(up.id)) THEN
    RAISE EXCEPTION 'probe: an account that trained is not revealed';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (v_a, v_email, 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email, username)
    VALUES (v_a, v_email, 'zqlrprobe' || left(v_a::text, 6))
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username;
    UPDATE public.user_profiles
       SET league_tier = 'bronze', league_shields_owned = 0, weight_lbs = 180,
           gender = 'male', age = 28, fitness_level = 'advanced',
           fitness_assessment = '{"squat_bw15":"yes","bench_bw":"yes"}'::jsonb
     WHERE id = v_a;
    DELETE FROM public.league_strength WHERE user_id = v_a;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_a, 'role', 'authenticated', 'email', v_email)::text, true);

    -- Answers given, nothing trained: no placement anywhere.
    v_r := public.league_apply_strength_placement(v_a);
    IF v_r <> 'unrevealed' THEN RAISE EXCEPTION 'probe: placed before training: %', v_r; END IF;
    v_e := public.ensure_my_league();
    IF (v_e->>'revealed')::boolean IS DISTINCT FROM FALSE OR v_e ? 'league' THEN
      RAISE EXCEPTION 'probe: ensure_my_league before training returned %', v_e;
    END IF;
    IF EXISTS (SELECT 1 FROM public.league_members WHERE user_id = v_a) THEN
      RAISE EXCEPTION 'probe: joined a bracket before training';
    END IF;
    v_s := public.my_league_strength();
    IF (v_s->>'revealed')::boolean OR v_s->>'tier' IS NOT NULL THEN
      RAISE EXCEPTION 'probe: strength before training returned %', v_s;
    END IF;

    -- The first workout places from the answers, capped at Silver.
    INSERT INTO public.workout_logs (created_by, user_id, title, date, exercises)
    VALUES (v_email, v_a, 'Probe', CURRENT_DATE, '[]'::jsonb);
    IF NOT public.league_is_revealed(v_a) THEN RAISE EXCEPTION 'probe: first workout did not reveal'; END IF;
    IF (SELECT league_tier FROM public.user_profiles WHERE id = v_a) <> 'silver' THEN
      RAISE EXCEPTION 'probe: first workout placed %', (SELECT league_tier FROM public.user_profiles WHERE id = v_a);
    END IF;
    v_s := public.my_league_strength();
    IF NOT (v_s->>'revealed')::boolean OR NOT (v_s->>'reveal_pending')::boolean
       OR v_s->>'tier' <> 'silver' THEN
      RAISE EXCEPTION 'probe: strength after first workout returned %', v_s;
    END IF;

    -- A second workout does not reveal or place again.
    INSERT INTO public.workout_logs (created_by, user_id, title, date, exercises)
    VALUES (v_email, v_a, 'Probe 2', CURRENT_DATE, '[]'::jsonb);
    IF (SELECT count(*) FROM public.notifications
         WHERE user_id = v_a AND metadata->>'outcome' = 'provisional') <> 1 THEN
      RAISE EXCEPTION 'probe: placement notified % times',
        (SELECT count(*) FROM public.notifications WHERE user_id = v_a AND metadata->>'outcome' = 'provisional');
    END IF;

    -- Now a bracket, and the reveal plays once.
    v_e := public.ensure_my_league();
    IF NOT (v_e->>'revealed')::boolean OR v_e->'league' IS NULL THEN
      RAISE EXCEPTION 'probe: ensure_my_league after training returned %', v_e;
    END IF;
    PERFORM public.mark_my_league_reveal_seen();
    IF (public.my_league_strength()->>'reveal_pending')::boolean THEN
      RAISE EXCEPTION 'probe: reveal still pending after marking it seen';
    END IF;

    RAISE EXCEPTION 'probe_ok';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
  END;
END;
$probe$;
