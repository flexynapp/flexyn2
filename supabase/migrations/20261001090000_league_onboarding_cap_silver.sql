-- Onboarding answers place you no higher than Silver.
--
-- 20260930224000 let onboarding answers alone (experience "advanced", or
-- "squat 1.5x bodyweight" plus "bench bodyweight" or "10 pull-ups") start
-- someone in Gold. Nothing verifies those answers, and the weekly bracket
-- pays at your league's rate, so a self-reported Gold earned Gold rewards
-- for as long as that person never logged a lift. Kegan chose to cap it.
--
-- A real lifter loses nothing: the first scored lift places them straight
-- on their Strength Score's league, in either direction
-- (league_apply_strength_placement, "first score after an onboarding
-- placement"). This file only lowers the ceiling of the guess.

CREATE OR REPLACE FUNCTION public.league_onboarding_tier(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_level text; a jsonb; r integer := 0;
BEGIN
  SELECT lower(fitness_level), COALESCE(fitness_assessment, '{}'::jsonb)
    INTO v_level, a FROM public.user_profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- newbie Bronze; returning, consistent and advanced Silver.
  r := CASE v_level WHEN 'newbie' THEN 1 WHEN 'returning' THEN 2
                    WHEN 'consistent' THEN 2 WHEN 'advanced' THEN 2 ELSE 0 END;
  -- A yes to the squat check lifts a newbie to Silver.
  IF a->>'squat_bw15' = 'yes' THEN r := GREATEST(r, 2); END IF;
  IF r = 0 THEN RETURN NULL; END IF;
  RETURN public.league_tier_at(LEAST(r, 2));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.league_onboarding_tier(uuid) FROM PUBLIC, anon, authenticated;

-- Everyone sitting in Gold on answers alone moves to Silver. No
-- notification: they were told "You start in the Gold League" an hour ago,
-- and a second alert to walk it back reads as a demotion they did not earn.
DO $cap$
DECLARE v_uid uuid;
BEGIN
  FOR v_uid IN
    SELECT up.id FROM public.user_profiles up
      JOIN public.league_strength ls ON ls.user_id = up.id
     WHERE ls.basis = 'onboarding' AND ls.score IS NULL
       AND public.league_tier_rank(COALESCE(up.league_tier, 'bronze')) > 2
  LOOP
    UPDATE public.user_profiles SET league_tier = 'silver' WHERE id = v_uid;
    PERFORM public.league_sync_open_member_tier(v_uid, 'silver');
  END LOOP;
END;
$cap$;

-- Probe: the strongest possible answers start in Silver, and the cap left
-- nobody above Silver on answers alone.
DO $probe$
DECLARE
  v_a uuid := gen_random_uuid();
  v_r text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_profiles up
               JOIN public.league_strength ls ON ls.user_id = up.id
              WHERE ls.basis = 'onboarding' AND ls.score IS NULL
                AND public.league_tier_rank(COALESCE(up.league_tier, 'bronze')) > 2) THEN
    RAISE EXCEPTION 'probe: an onboarding placement is still above Silver';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (v_a, 'lc-probe-' || v_a || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email, username)
    VALUES (v_a, 'lc-probe-' || v_a || '@example.invalid', 'zqlcprobe' || left(v_a::text, 6))
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username;
    UPDATE public.user_profiles
       SET league_tier = 'bronze', league_shields_owned = 0, weight_lbs = 180,
           gender = 'male', age = 28, fitness_level = 'advanced',
           fitness_assessment = '{"squat_bw15":"yes","bench_bw":"yes","pullups_10":"yes"}'::jsonb
     WHERE id = v_a;
    DELETE FROM public.league_strength WHERE user_id = v_a;

    v_r := public.league_apply_strength_placement(v_a);
    IF v_r <> 'provisional'
       OR (SELECT league_tier FROM public.user_profiles WHERE id = v_a) <> 'silver' THEN
      RAISE EXCEPTION 'probe: best answers placed % as %', v_r,
        (SELECT league_tier FROM public.user_profiles WHERE id = v_a);
    END IF;

    -- A newbie who says yes to the squat check still reaches Silver.
    UPDATE public.user_profiles SET fitness_level = 'newbie',
           fitness_assessment = '{"squat_bw15":"yes"}'::jsonb WHERE id = v_a;
    IF public.league_onboarding_tier(v_a) <> 'silver' THEN
      RAISE EXCEPTION 'probe: newbie squat check no longer reaches silver';
    END IF;
    UPDATE public.user_profiles SET fitness_assessment = '{}'::jsonb WHERE id = v_a;
    IF public.league_onboarding_tier(v_a) <> 'bronze' THEN
      RAISE EXCEPTION 'probe: plain newbie not bronze';
    END IF;

    RAISE EXCEPTION 'probe_ok';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
  END;
END;
$probe$;
