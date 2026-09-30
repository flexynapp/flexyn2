-- Leagues audit after launch (2026-09-30). Four fixes to the strength
-- placement shipped in 20260930203000. No user data is deleted.
--
-- 1. Failed sets no longer count toward the Strength Score. The client
--    already drops them from PRs and progressive overload (is_failed); the
--    server counted a failed 1RM attempt as a lift.
-- 2. The per lift sanity caps now match the ones the logger enforces
--    (src/lib/realisticLimits.js: squat 3.0x, bench 2.2x, deadlift 3.5x,
--    overhead press 1.5x bodyweight, x0.72 for women). The server allowed
--    3x bodyweight on bench, so two forged bench sessions estimated a total
--    worth Legend (DOTS 645 at 165 lb). At the logger's caps the most a
--    165 lb man can reach is 468. An honest lifter loses nothing: the
--    logger will not accept a set above these caps in the first place.
-- 3. A tier change now also moves the member's row in this week's open
--    bracket. The roll runs Monday 12:10 UTC, after anyone who opened the
--    app that morning already joined the new week at their OLD tier, so
--    they raced and were paid a whole week at the tier they had just left.
--    First placement had the same gap mid-week.
-- 4. "Trap Bar Deadlift With High Handles" / "With Low Handles" (the
--    exercise library's names) count as a deadlift.

-- Moves this user's row in any unresolved bracket to their new tier. The
-- guard trigger lets the definer owner through; clients still cannot.
CREATE OR REPLACE FUNCTION public.league_sync_open_member_tier(p_user_id uuid, p_tier text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  UPDATE public.league_members m
     SET tier = p_tier
    FROM public.leagues l
   WHERE l.id = m.league_id
     AND l.is_resolved = FALSE
     AND m.user_id = p_user_id
     AND m.tier IS DISTINCT FROM p_tier;
$$;

CREATE OR REPLACE FUNCTION public.strength_lift_family(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_catalog' AS $$
  SELECT CASE
    WHEN n ~ '^(barbell )?(back |front |low[ -]bar |high[ -]bar )?squats?$' THEN 'squat'
    WHEN n ~ '^(barbell )?(flat )?bench( press)?$' THEN 'bench'
    WHEN n ~ '^(barbell |conventional |sumo |trap[ -]bar |hex[ -]bar )?deadlifts?( with (low|high) handles)?$' THEN 'deadlift'
    WHEN n ~ '^(barbell |standing |strict )?(overhead press|military press|ohp)$' THEN 'ohp'
    ELSE NULL END
  FROM (SELECT regexp_replace(lower(btrim(COALESCE(p_name, ''))), '\s+', ' ', 'g') AS n) x;
$$;

CREATE OR REPLACE FUNCTION public.league_strength_compute(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_bw       numeric;
  v_sex      text;
  v_lifts    jsonb := '{}'::jsonb;
  v_sessions jsonb := '{}'::jsonb;
  s numeric; b numeric; d numeric; o numeric;
  v_total    numeric;
  v_est      boolean := false;
  v_n        integer := 0;
  v_sum      numeric := 0;
  female     boolean;
  v_score    numeric;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT weight_lbs::numeric, lower(gender) INTO v_bw, v_sex
    FROM public.user_profiles WHERE id = p_user_id;
  IF v_bw IS NOT NULL AND (v_bw < 70 OR v_bw > 600) THEN v_bw := NULL; END IF;

  WITH sets AS (
    SELECT w.id AS log_id,
           public.strength_lift_family(e->>'name') AS fam,
           CASE WHEN (st->>'weight') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                THEN (st->>'weight')::numeric END AS wt,
           CASE WHEN (st->>'reps') ~ '^\s*[0-9]{1,4}\s*$'
                THEN (st->>'reps')::numeric END AS reps,
           COALESCE(st->>'is_failed', 'false') = 'true' AS failed
      FROM public.workout_logs w
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(w.exercises) = 'array' THEN w.exercises ELSE '[]'::jsonb END) e
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(e->'sets') = 'array' THEN e->'sets' ELSE '[]'::jsonb END) st
     WHERE w.user_id = p_user_id
       AND w.date >= CURRENT_DATE - 90
       AND w.date <= CURRENT_DATE
       AND NOT COALESCE(w.implausible, FALSE)
  ), best AS (
    SELECT log_id, fam,
           MAX(CASE WHEN reps = 1 THEN wt ELSE wt * (1 + reps / 30.0) END) AS e1rm
      FROM sets
     WHERE fam IS NOT NULL AND NOT failed AND wt > 0 AND wt <= 1500 AND reps BETWEEN 1 AND 10
     GROUP BY log_id, fam
  ), sane AS (
    SELECT * FROM best
     WHERE v_bw IS NULL
        OR e1rm <= v_bw * CASE WHEN v_sex = 'female' THEN 0.72 ELSE 1 END
                        * CASE fam WHEN 'squat' THEN 3.0 WHEN 'bench' THEN 2.2
                                   WHEN 'deadlift' THEN 3.5 ELSE 1.5 END
  ), ranked AS (
    SELECT fam, e1rm,
           COUNT(*) OVER (PARTITION BY fam) AS n,
           ROW_NUMBER() OVER (PARTITION BY fam ORDER BY e1rm DESC) AS rn
      FROM sane
  )
  SELECT COALESCE(jsonb_object_agg(fam, round(e1rm, 1)) FILTER (WHERE rn = 2), '{}'::jsonb),
         COALESCE(jsonb_object_agg(fam, n) FILTER (WHERE rn = 1), '{}'::jsonb)
    INTO v_lifts, v_sessions
    FROM ranked;

  IF v_bw IS NULL THEN
    RETURN jsonb_build_object('score', NULL, 'lifts', v_lifts, 'sessions', v_sessions,
      'bodyweight_lbs', NULL, 'reason', 'no_bodyweight');
  END IF;

  s := (v_lifts->>'squat')::numeric;
  b := (v_lifts->>'bench')::numeric;
  d := (v_lifts->>'deadlift')::numeric;
  o := (v_lifts->>'ohp')::numeric;

  IF s IS NOT NULL AND b IS NOT NULL AND d IS NOT NULL THEN
    v_total := s + b + d;
  ELSE
    -- Each lift's usual share of a squat+bench+deadlift total. Averaging the
    -- totals the present lifts imply lets someone who only benches be placed.
    female := (v_sex = 'female');
    IF s IS NOT NULL THEN v_sum := v_sum + s / CASE WHEN female THEN 0.37 ELSE 0.35 END; v_n := v_n + 1; END IF;
    IF b IS NOT NULL THEN v_sum := v_sum + b / CASE WHEN female THEN 0.21 ELSE 0.25 END; v_n := v_n + 1; END IF;
    IF d IS NOT NULL THEN v_sum := v_sum + d / CASE WHEN female THEN 0.42 ELSE 0.40 END; v_n := v_n + 1; END IF;
    IF o IS NOT NULL THEN v_sum := v_sum + o / CASE WHEN female THEN 0.14 ELSE 0.16 END; v_n := v_n + 1; END IF;
    IF v_n > 0 THEN v_total := v_sum / v_n; v_est := true; END IF;
  END IF;

  IF v_total IS NULL THEN
    RETURN jsonb_build_object('score', NULL, 'lifts', v_lifts, 'sessions', v_sessions,
      'bodyweight_lbs', v_bw, 'reason', 'no_lifts');
  END IF;

  v_score := round(public.league_dots(v_total * 0.45359237, v_bw * 0.45359237, v_sex), 1);

  RETURN jsonb_build_object('score', v_score, 'lifts', v_lifts, 'sessions', v_sessions,
    'total_lbs', round(v_total), 'estimated', v_est, 'bodyweight_lbs', v_bw, 'reason', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.league_apply_strength_placement(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_score   numeric;
  v_placed  timestamptz;
  v_tier    text;
  v_shields integer;
  v_target  text;
  v_new     text;
BEGIN
  IF p_user_id IS NULL THEN RETURN 'unscored'; END IF;

  SELECT COALESCE(league_tier, 'bronze'), COALESCE(league_shields_owned, 0)
    INTO v_tier, v_shields
    FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unscored'; END IF;
  IF public.league_tier_rank(v_tier) = 1 AND v_tier <> 'bronze' THEN v_tier := 'bronze'; END IF;

  v_score := public.league_strength_refresh(p_user_id);
  IF v_score IS NULL THEN RETURN 'unscored'; END IF;

  SELECT placed_at INTO v_placed FROM public.league_strength WHERE user_id = p_user_id;
  v_target := public.league_tier_for_score(v_score);

  IF v_placed IS NULL THEN
    UPDATE public.league_strength SET placed_at = now() WHERE user_id = p_user_id;
    IF v_target IS DISTINCT FROM v_tier THEN
      UPDATE public.user_profiles SET league_tier = v_target WHERE id = p_user_id;
      PERFORM public.league_sync_open_member_tier(p_user_id, v_target);
    END IF;
    PERFORM public.notify_league_placement_internal(p_user_id, 'placed', v_target);
    RETURN 'placed';
  END IF;

  IF public.league_tier_rank(v_target) > public.league_tier_rank(v_tier) THEN
    v_new := public.league_tier_at(public.league_tier_rank(v_tier) + 1);
    UPDATE public.user_profiles SET league_tier = v_new WHERE id = p_user_id;
    PERFORM public.league_sync_open_member_tier(p_user_id, v_new);
    PERFORM public.notify_league_placement_internal(p_user_id, 'promote', v_new);
    RETURN 'promote';
  END IF;

  IF v_tier <> 'bronze' AND v_score < public.league_tier_floor(v_tier) * 0.9 THEN
    IF v_shields >= 1 THEN
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
$$;

REVOKE EXECUTE ON FUNCTION public.league_sync_open_member_tier(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_strength_compute(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_apply_strength_placement(uuid) FROM PUBLIC, anon, authenticated;

-- Existing open-bracket rows that already disagree with the profile.
UPDATE public.league_members m
   SET tier = COALESCE(up.league_tier, 'bronze')
  FROM public.leagues l, public.user_profiles up
 WHERE l.id = m.league_id AND l.is_resolved = FALSE
   AND up.id = m.user_id
   AND m.tier IS DISTINCT FROM COALESCE(up.league_tier, 'bronze');

------------------------------------------------------------------------------
-- Probe: attempt each fix on seeded rows, then roll back.
------------------------------------------------------------------------------
DO $probe$
DECLARE
  v_u uuid := gen_random_uuid();
  v_l uuid;
  v   jsonb;
BEGIN
  IF public.strength_lift_family('Trap Bar Deadlift With High Handles') <> 'deadlift'
     OR public.strength_lift_family('Deadlift') <> 'deadlift'
     OR public.strength_lift_family('Romanian Deadlift') IS NOT NULL THEN
    RAISE EXCEPTION 'probe: deadlift names misread';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (v_u, 'la-probe-' || v_u || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email, username)
    VALUES (v_u, 'la-probe-' || v_u || '@example.invalid', 'zqlaprobe' || left(v_u::text, 6))
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username;
    UPDATE public.user_profiles SET weight_lbs = 165, gender = 'male', league_tier = 'bronze',
           league_shields_owned = 0 WHERE id = v_u;

    -- Two forged bench sessions at 2.9x bodyweight (under the old 3x cap),
    -- and a failed 500 lb attempt: none may count. Two honest sessions at
    -- 225 and one failed 300 must leave bench at the honest second best.
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises) VALUES
     (v_u, 'probe', CURRENT_DATE - 1, '[{"name":"Bench Press","sets":[{"weight":480,"reps":1}]}]'),
     (v_u, 'probe', CURRENT_DATE - 2, '[{"name":"Bench Press","sets":[{"weight":480,"reps":1}]}]'),
     (v_u, 'probe', CURRENT_DATE - 3, '[{"name":"Bench Press","sets":[{"weight":225,"reps":1},{"weight":300,"reps":1,"is_failed":true}]}]'),
     (v_u, 'probe', CURRENT_DATE - 4, '[{"name":"Bench Press","sets":[{"weight":225,"reps":1}]}]');

    v := public.league_strength_compute(v_u);
    IF (v->'lifts'->>'bench')::numeric IS DISTINCT FROM 225 THEN
      RAISE EXCEPTION 'probe: forged or failed bench counted: %', v;
    END IF;

    -- An open bracket row at bronze follows first placement.
    INSERT INTO public.leagues (tier, week_start, week_end, member_count, is_resolved)
    VALUES ('bronze', DATE '2001-01-01', DATE '2001-01-07', 0, FALSE) RETURNING id INTO v_l;
    INSERT INTO public.league_members (league_id, user_id, user_email, weekly_xp, tier)
    VALUES (v_l, v_u, 'la-probe-' || v_u || '@example.invalid', 0, 'bronze');
    DELETE FROM public.league_strength WHERE user_id = v_u;
    IF public.league_apply_strength_placement(v_u) <> 'placed' THEN
      RAISE EXCEPTION 'probe: not placed';
    END IF;
    IF (SELECT tier FROM public.league_members WHERE league_id = v_l AND user_id = v_u)
       IS DISTINCT FROM (SELECT league_tier FROM public.user_profiles WHERE id = v_u) THEN
      RAISE EXCEPTION 'probe: open bracket row kept the old tier';
    END IF;
    IF (SELECT league_tier FROM public.user_profiles WHERE id = v_u) = 'bronze' THEN
      RAISE EXCEPTION 'probe: a 225 bench at 165 lb should place above bronze';
    END IF;

    RAISE EXCEPTION 'probe_ok';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
  END;
END;
$probe$;
