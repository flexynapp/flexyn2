-- League placement for every lifter (Kegan, 2026-09-30): "lifters of all
-- shapes, sizes and ages will come to the app; assign placements from
-- onboarding stats and previously saved completed workouts".
--
-- Until now a tier needed two sessions of one of four barbell lifts plus a
-- saved bodyweight, which left 144 of 145 profiles in Bronze. Three changes:
--
-- 1. ONBOARDING PLACES YOU. With no Strength Score yet, your experience
--    answer and the Quick Lift Check pick a starting league:
--      New -> Bronze, Returning or Consistent -> Silver, Advanced -> Gold;
--      "Squat 1.5x your bodyweight" yes -> at least Silver, and together
--      with 10 pull-ups (or the older "bench your bodyweight") -> Gold.
--    Self-reported, so never above Gold. league_strength.basis records it.
--
-- 2. MORE OF YOUR WORKOUTS COUNT. strength_lift_variant maps the exercise
--    library's variants to a barbell equivalent with a CONSERVATIVE factor:
--    incline and Smith machine presses, dumbbell bench and shoulder press
--    (weights are per hand), machine presses, front, hack and Smith squats,
--    leg press, Romanian and stiff legged deadlifts, and push-ups (60% of
--    bodyweight per rep, reps counted up to 15). Second-best session per lift
--    still applies, across variants. The first real score replaces an
--    onboarding placement in either direction; after that, one tier a week.
--
-- 3. BODY AND AGE. DOTS already adjusts for bodyweight and sex. The score is
--    now multiplied by the standard masters age factor from 40 (McCulloch)
--    and the teen factor below 23 (Foster), capped at x1.4 because age is
--    self-reported. With no bodyweight saved a conservative default is used
--    (185 lb men, 150 lb women, 170 lb otherwise, heavier than typical so it
--    never flatters) and the tier cannot go above Gold until one is saved.
--
-- Nobody is notified for landing in Bronze. No user data is deleted.

ALTER TABLE public.league_strength ADD COLUMN IF NOT EXISTS basis text;
UPDATE public.league_strength SET basis = 'lifts' WHERE placed_at IS NOT NULL AND basis IS NULL;
ALTER TABLE public.league_strength DROP CONSTRAINT IF EXISTS league_strength_basis_check;
ALTER TABLE public.league_strength ADD CONSTRAINT league_strength_basis_check
  CHECK (basis IS NULL OR basis IN ('onboarding', 'lifts'));

------------------------------------------------------------------------------
-- Lift variants
------------------------------------------------------------------------------

-- A logged exercise as a barbell lift: which of the four, the factor that
-- turns its load into a barbell equivalent, the share of bodyweight a rep
-- moves (push-ups), and whether the weight is per hand. NULL fam = not scored.
CREATE OR REPLACE FUNCTION public.strength_lift_variant(p_name text,
  OUT fam text, OUT factor numeric, OUT bw_share numeric, OUT per_hand boolean)
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_catalog' AS $$
DECLARE
  n text := regexp_replace(replace(lower(btrim(COALESCE(p_name, ''))), '-', ' '), '\s+', ' ', 'g');
BEGIN
  fam := public.strength_lift_family(p_name);
  factor := 1; bw_share := 0; per_hand := FALSE;
  IF fam IS NOT NULL THEN RETURN; END IF;

  -- Bench
  IF n ~ '^(barbell )?incline (barbell )?bench( press)?$' THEN fam := 'bench'; factor := 1.1;
  ELSIF n ~ '^(barbell )?(close grip|pause|paused|feet up|pin|spoto) bench( press)?$' THEN fam := 'bench';
  ELSIF n ~ '^smith machine (flat )?bench( press)?$' THEN fam := 'bench'; factor := 0.9;
  ELSIF n ~ '^incline (dumbbell|db) (bench |chest )?press$' THEN fam := 'bench'; factor := 2.3; per_hand := TRUE;
  ELSIF n ~ '^(flat )?(dumbbell|db) floor press$' THEN fam := 'bench'; factor := 2.0; per_hand := TRUE;
  ELSIF n ~ '^(flat )?(dumbbell|db) (bench |chest )?press$' THEN fam := 'bench'; factor := 2.2; per_hand := TRUE;
  ELSIF n ~ '^(seated )?(machine )?chest press( machine)?$' THEN fam := 'bench'; factor := 0.7;
  ELSIF n ~ '^push ?ups?$' THEN fam := 'bench'; factor := 0.9; bw_share := 0.6;
  -- Squat
  ELSIF n ~ '^(barbell )?(pause|paused|box|safety bar|ssb) squats?$' THEN fam := 'squat';
  ELSIF n ~ '^smith machine (back )?squats?$' THEN fam := 'squat'; factor := 0.85;
  ELSIF n ~ '^(barbell )?hack squats?( machine)?$' THEN fam := 'squat'; factor := 0.7;
  ELSIF n ~ '^(45 degree |vertical |seated )?leg press( machine)?$' THEN fam := 'squat'; factor := 0.4;
  -- Deadlift
  ELSIF n ~ '^(barbell )?(romanian|stiff legged|stiff leg|rdl)( deadlifts?)?$' THEN fam := 'deadlift'; factor := 1.2;
  ELSIF n ~ '^(barbell )?(pause|paused|deficit|block|rack) (deadlifts?|pulls?)$' THEN fam := 'deadlift';
  ELSIF n ~ '^smith machine deadlifts?$' THEN fam := 'deadlift'; factor := 0.9;
  -- Overhead press
  ELSIF n ~ '^seated (barbell )?(overhead|military|shoulder) press$' THEN fam := 'ohp';
  ELSIF n ~ '^(barbell )?push press$' THEN fam := 'ohp'; factor := 0.8;
  ELSIF n ~ '^(seated |standing )?(dumbbell|db) (shoulder|overhead|military) press$' THEN fam := 'ohp'; factor := 2.0; per_hand := TRUE;
  ELSIF n ~ '^(dumbbell )?arnold press$' THEN fam := 'ohp'; factor := 2.0; per_hand := TRUE;
  ELSIF n ~ '^(seated )?(machine )?shoulder press( machine)?$' THEN fam := 'ohp'; factor := 0.7;
  ELSE fam := NULL;
  END IF;
END;
$$;

-- Masters (McCulloch, from 40) and teen (Foster, below 23) age factors,
-- capped at 1.4 because age is self-reported.
CREATE OR REPLACE FUNCTION public.league_age_factor(p_age integer)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_catalog' AS $$
  SELECT LEAST(1.4, CASE
    WHEN p_age IS NULL OR p_age < 13 OR p_age > 100 THEN 1.0
    WHEN p_age < 23 THEN (ARRAY[1.23,1.23,1.18,1.13,1.08,1.06,1.04,1.03,1.02,1.01])[p_age - 12]
    WHEN p_age <= 40 THEN 1.0
    WHEN p_age <= 80 THEN (ARRAY[1.010,1.020,1.031,1.043,1.055,1.068,1.082,1.097,1.113,1.130,
                                 1.147,1.165,1.184,1.204,1.225,1.246,1.268,1.291,1.315,1.340,
                                 1.366,1.393,1.421,1.450,1.480,1.511,1.543,1.576,1.610,1.645,
                                 1.681,1.718,1.756,1.795,1.835,1.876,1.918,1.961,2.005,2.050])[p_age - 40]
    ELSE 2.050 END);
$$;

-- The starting league onboarding answers justify, or NULL if none given.
CREATE OR REPLACE FUNCTION public.league_onboarding_tier(p_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog' AS $$
DECLARE
  v_level text; a jsonb; r integer := 0;
BEGIN
  SELECT lower(fitness_level), COALESCE(fitness_assessment, '{}'::jsonb)
    INTO v_level, a FROM public.user_profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  r := CASE v_level WHEN 'newbie' THEN 1 WHEN 'returning' THEN 2
                    WHEN 'consistent' THEN 2 WHEN 'advanced' THEN 3 ELSE 0 END;
  IF a->>'squat_bw15' = 'yes' THEN
    r := GREATEST(r, CASE WHEN a->>'pullups_10' = 'yes' OR a->>'bench_bw' = 'yes' THEN 3 ELSE 2 END);
  END IF;
  IF r = 0 THEN RETURN NULL; END IF;
  RETURN public.league_tier_at(LEAST(r, 3));
END;
$$;

------------------------------------------------------------------------------
-- Strength Score
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.league_strength_compute(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_bw       numeric;
  v_bw_given boolean := TRUE;
  v_sex      text;
  v_age      integer;
  v_lifts    jsonb := '{}'::jsonb;
  v_sessions jsonb := '{}'::jsonb;
  v_conv     boolean := FALSE;
  s numeric; b numeric; d numeric; o numeric;
  v_total    numeric;
  v_est      boolean := false;
  v_n        integer := 0;
  v_sum      numeric := 0;
  female     boolean;
  v_dots     numeric;
  v_af       numeric;
  v_score    numeric;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT weight_lbs::numeric, lower(gender),
         COALESCE(CASE WHEN birthday IS NOT NULL
                       THEN date_part('year', age(CURRENT_DATE, birthday))::integer END, age)
    INTO v_bw, v_sex, v_age
    FROM public.user_profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  female := (v_sex = 'female');
  IF v_bw IS NULL OR v_bw < 70 OR v_bw > 600 THEN
    v_bw := CASE WHEN v_sex = 'male' THEN 185 WHEN female THEN 150 ELSE 170 END;
    v_bw_given := FALSE;
  END IF;

  WITH sets AS (
    SELECT w.id AS log_id, lv.fam, lv.factor, lv.bw_share, lv.per_hand,
           CASE WHEN (st->>'weight') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                THEN (st->>'weight')::numeric END AS wt,
           CASE WHEN (st->>'reps') ~ '^\s*[0-9]{1,4}\s*$'
                THEN (st->>'reps')::numeric END AS reps,
           COALESCE(st->>'is_failed', 'false') = 'true' AS failed
      FROM public.workout_logs w
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(w.exercises) = 'array' THEN w.exercises ELSE '[]'::jsonb END) e
      CROSS JOIN LATERAL public.strength_lift_variant(e->>'name') lv
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(e->'sets') = 'array' THEN e->'sets' ELSE '[]'::jsonb END) st
     WHERE w.user_id = p_user_id
       AND w.date >= CURRENT_DATE - 90
       AND w.date <= CURRENT_DATE
       AND NOT COALESCE(w.implausible, FALSE)
       AND lv.fam IS NOT NULL
  ), eq AS (
    -- Barbell-equivalent estimated max for each counted set. Loaded lifts
    -- take 1 to 10 reps; a bodyweight lift takes any count, credited up to 15.
    SELECT log_id, fam, (factor <> 1 OR bw_share > 0) AS converted,
           factor * (COALESCE(wt, 0) + bw_share * v_bw)
             * (1 + CASE WHEN bw_share > 0 THEN LEAST(reps, 15) ELSE reps END / 30.0)
             - CASE WHEN reps = 1 AND bw_share = 0 THEN factor * COALESCE(wt, 0) / 30.0 ELSE 0 END AS e1rm
      FROM sets
     WHERE NOT failed
       AND reps >= 1
       AND COALESCE(wt, 0) <= 1500
       AND (CASE WHEN bw_share > 0 THEN COALESCE(wt, 0) >= 0 ELSE COALESCE(wt, 0) > 0 AND reps <= 10 END)
  ), best AS (
    SELECT log_id, fam, MAX(e1rm) AS e1rm, bool_or(converted) AS converted
      FROM eq GROUP BY log_id, fam
  ), sane AS (
    -- The logger's own caps (src/lib/realisticLimits.js), on the barbell
    -- equivalent: anything above them is ignored, not trusted.
    SELECT * FROM best
     WHERE e1rm > 0
       AND e1rm <= v_bw * CASE WHEN female THEN 0.72 ELSE 1 END
                        * CASE fam WHEN 'squat' THEN 3.0 WHEN 'bench' THEN 2.2
                                   WHEN 'deadlift' THEN 3.5 ELSE 1.5 END
  ), ranked AS (
    SELECT fam, e1rm, converted,
           COUNT(*) OVER (PARTITION BY fam) AS n,
           ROW_NUMBER() OVER (PARTITION BY fam ORDER BY e1rm DESC) AS rn
      FROM sane
  )
  SELECT COALESCE(jsonb_object_agg(fam, round(e1rm, 1)) FILTER (WHERE rn = 2), '{}'::jsonb),
         COALESCE(jsonb_object_agg(fam, n) FILTER (WHERE rn = 1), '{}'::jsonb),
         COALESCE(bool_or(converted) FILTER (WHERE rn = 2), FALSE)
    INTO v_lifts, v_sessions, v_conv
    FROM ranked;

  s := (v_lifts->>'squat')::numeric;
  b := (v_lifts->>'bench')::numeric;
  d := (v_lifts->>'deadlift')::numeric;
  o := (v_lifts->>'ohp')::numeric;

  IF s IS NOT NULL AND b IS NOT NULL AND d IS NOT NULL THEN
    v_total := s + b + d;
  ELSE
    -- Each lift's usual share of a squat+bench+deadlift total. Averaging the
    -- totals the present lifts imply lets someone who only benches be placed.
    IF s IS NOT NULL THEN v_sum := v_sum + s / CASE WHEN female THEN 0.37 ELSE 0.35 END; v_n := v_n + 1; END IF;
    IF b IS NOT NULL THEN v_sum := v_sum + b / CASE WHEN female THEN 0.21 ELSE 0.25 END; v_n := v_n + 1; END IF;
    IF d IS NOT NULL THEN v_sum := v_sum + d / CASE WHEN female THEN 0.42 ELSE 0.40 END; v_n := v_n + 1; END IF;
    IF o IS NOT NULL THEN v_sum := v_sum + o / CASE WHEN female THEN 0.14 ELSE 0.16 END; v_n := v_n + 1; END IF;
    IF v_n > 0 THEN v_total := v_sum / v_n; v_est := true; END IF;
  END IF;

  v_af := public.league_age_factor(v_age);

  IF v_total IS NULL THEN
    RETURN jsonb_build_object('score', NULL, 'lifts', v_lifts, 'sessions', v_sessions,
      'bodyweight_lbs', v_bw, 'bodyweight_given', v_bw_given, 'age_factor', v_af,
      'reason', 'no_lifts');
  END IF;

  v_dots  := public.league_dots(v_total * 0.45359237, v_bw * 0.45359237, v_sex);
  v_score := round(v_dots * v_af, 1);

  RETURN jsonb_build_object('score', v_score, 'lifts', v_lifts, 'sessions', v_sessions,
    'total_lbs', round(v_total), 'estimated', v_est OR v_conv, 'converted', v_conv,
    'dots', round(v_dots, 1), 'age_factor', v_af,
    'bodyweight_lbs', v_bw, 'bodyweight_given', v_bw_given, 'reason', NULL);
END;
$$;

------------------------------------------------------------------------------
-- Notification copy: one more outcome, a placement from onboarding answers
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.league_placement_text(p_lang text, p_outcome text, p_tier text, p_coins integer DEFAULT 0, p_rank integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_catalog' AS $$
DECLARE
  l text := CASE WHEN p_lang IN ('es', 'fr') THEN p_lang ELSE 'en' END;
  i integer := public.league_tier_rank(p_tier);
  name text;
BEGIN
  name := CASE l
    WHEN 'es' THEN 'Liga ' || (ARRAY['Bronce','Plata','Oro','Platino','Diamante','Leyenda'])[i]
    WHEN 'fr' THEN 'Ligue ' || (ARRAY['Bronze','Argent','Or','Platine','Diamant','Légende'])[i]
    ELSE (ARRAY['Bronze','Silver','Gold','Platinum','Diamond','Legend'])[i] || ' League' END;

  RETURN CASE p_outcome
    WHEN 'placed' THEN jsonb_build_object(
      'title', CASE l WHEN 'es' THEN 'Estás en la ' || name
                      WHEN 'fr' THEN 'Vous êtes en ' || name
                      ELSE 'You''re in the ' || name END,
      'body',  CASE l WHEN 'es' THEN 'Tu Puntuación de fuerza te ha colocado aquí. Sube tus marcas para seguir escalando.'
                      WHEN 'fr' THEN 'Votre Score de force vous a placé ici. Progressez sur vos barres pour continuer à monter.'
                      ELSE 'Your Strength Score placed you here. Lift heavier to keep climbing.' END)
    WHEN 'provisional' THEN jsonb_build_object(
      'title', CASE l WHEN 'es' THEN 'Empiezas en la ' || name
                      WHEN 'fr' THEN 'Vous commencez en ' || name
                      ELSE 'You start in the ' || name END,
      'body',  CASE l WHEN 'es' THEN 'Según tus respuestas de inicio. Registra tus levantamientos para confirmarlo.'
                      WHEN 'fr' THEN 'D''après vos réponses de départ. Enregistrez vos séances pour le confirmer.'
                      ELSE 'Based on your onboarding answers. Log your lifts to confirm it.' END)
    WHEN 'promote' THEN jsonb_build_object(
      'title', CASE l WHEN 'es' THEN 'Has subido a la ' || name
                      WHEN 'fr' THEN 'Vous montez en ' || name
                      ELSE 'Promoted to the ' || name END,
      'body',  CASE l WHEN 'es' THEN 'Tu Puntuación de fuerza superó el mínimo de la liga.'
                      WHEN 'fr' THEN 'Votre Score de force a dépassé le seuil de la ligue.'
                      ELSE 'Your Strength Score cleared the league''s floor.' END)
    WHEN 'demote' THEN jsonb_build_object(
      'title', CASE l WHEN 'es' THEN 'Has bajado a la ' || name
                      WHEN 'fr' THEN 'Vous descendez en ' || name
                      ELSE 'Moved to the ' || name END,
      'body',  CASE l WHEN 'es' THEN 'Tu Puntuación de fuerza quedó por debajo de tu liga. Registra tus levantamientos pesados para volver a subir.'
                      WHEN 'fr' THEN 'Votre Score de force est passé sous votre ligue. Enregistrez vos grosses barres pour remonter.'
                      ELSE 'Your Strength Score fell below your league. Log your heavy lifts to climb back.' END)
    WHEN 'shielded' THEN jsonb_build_object(
      'title', CASE l WHEN 'es' THEN 'Tu escudo te ha protegido'
                      WHEN 'fr' THEN 'Votre bouclier vous a protégé'
                      ELSE 'Your shield held' END,
      'body',  CASE l WHEN 'es' THEN 'Tu Puntuación de fuerza bajó, pero sigues en la ' || name || '.'
                      WHEN 'fr' THEN 'Votre Score de force a baissé, mais vous restez en ' || name || '.'
                      ELSE 'Your Strength Score dipped, but you stay in the ' || name || '.' END)
    WHEN 'top' THEN jsonb_build_object(
      'title', CASE l WHEN 'es' THEN 'Terminaste #' || COALESCE(p_rank, 1) || ' de tu grupo'
                      WHEN 'fr' THEN 'Vous finissez #' || COALESCE(p_rank, 1) || ' de votre groupe'
                      ELSE 'You finished #' || COALESCE(p_rank, 1) || ' in your bracket' END,
      'body',  CASE l WHEN 'es' THEN '+' || COALESCE(p_coins, 0) || ' Flex Coins por tu semana de entrenamiento.'
                      WHEN 'fr' THEN '+' || COALESCE(p_coins, 0) || ' Flex Coins pour votre semaine d''entraînement.'
                      ELSE '+' || COALESCE(p_coins, 0) || ' Flex Coins for your week of training.' END)
    ELSE NULL END;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_league_placement_internal(p_user_id uuid, p_outcome text, p_tier text, p_coins integer DEFAULT 0, p_rank integer DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_email text; v_lang text; v_text jsonb; v_id uuid;
BEGIN
  SELECT email, preferred_language INTO v_email, v_lang
    FROM public.user_profiles WHERE id = p_user_id;
  v_text := public.league_placement_text(COALESCE(v_lang, 'en'), p_outcome, p_tier, p_coins, p_rank);
  IF v_text IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_user_id, v_email,
          CASE WHEN p_outcome IN ('promote', 'placed', 'provisional') THEN 'league_promoted'
               WHEN p_outcome = 'demote' THEN 'league_demoted' ELSE 'league_held' END,
          v_text->>'title', v_text->>'body', '🏆', '/dashboard',
          jsonb_build_object('outcome', p_outcome, 'tier', p_tier, 'coins', COALESCE(p_coins, 0)))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

------------------------------------------------------------------------------
-- Placement
------------------------------------------------------------------------------

-- 'unscored' | 'placed' | 'provisional' | 'promote' | 'demote' | 'shielded' | 'hold'
CREATE OR REPLACE FUNCTION public.league_apply_strength_placement(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
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
$$;

-- What the league screens show about your strength. Read only.
CREATE OR REPLACE FUNCTION public.my_league_strength()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v        jsonb;
  v_tier   text;
  v_placed timestamptz;
  v_basis  text;
  v_next   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  v := public.league_strength_compute(v_uid);
  SELECT COALESCE(league_tier, 'bronze') INTO v_tier FROM public.user_profiles WHERE id = v_uid;
  SELECT placed_at, basis INTO v_placed, v_basis FROM public.league_strength WHERE user_id = v_uid;
  v_next := CASE WHEN public.league_tier_rank(v_tier) < 6
                 THEN public.league_tier_at(public.league_tier_rank(v_tier) + 1) END;
  RETURN COALESCE(v, '{}'::jsonb) || jsonb_build_object(
    'tier', v_tier,
    'placed', v_placed IS NOT NULL,
    'basis', v_basis,
    'tier_floor', public.league_tier_floor(v_tier),
    'drop_below', CASE WHEN v_tier = 'bronze' THEN NULL
                       ELSE round(public.league_tier_floor(v_tier) * 0.9, 1) END,
    'next_tier', v_next,
    'next_floor', CASE WHEN v_next IS NULL THEN NULL ELSE public.league_tier_floor(v_next) END);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.league_onboarding_tier(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_strength_compute(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_apply_strength_placement(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_league_placement_internal(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_league_strength() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_league_strength() TO authenticated;

------------------------------------------------------------------------------
-- Probe: attempt each rule on seeded lifters, then roll back.
------------------------------------------------------------------------------
DO $probe$
DECLARE
  v_a uuid := gen_random_uuid();  -- onboarding "advanced", no lifts yet
  v_b uuid := gen_random_uuid();  -- dumbbell and machine lifter, 60 years old
  v_c uuid := gen_random_uuid();  -- no bodyweight, strong lifts
  v   jsonb;
  v_r text;
BEGIN
  -- Pure pieces.
  IF (public.strength_lift_variant('Dumbbell Bench Press')).fam <> 'bench'
     OR NOT (public.strength_lift_variant('Dumbbell Bench Press')).per_hand
     OR (public.strength_lift_variant('Leg Press')).fam <> 'squat'
     OR (public.strength_lift_variant('Romanian Deadlift')).fam <> 'deadlift'
     OR (public.strength_lift_variant('Push-Up')).bw_share <> 0.6
     OR (public.strength_lift_variant('Dumbbell Shoulder Press')).fam <> 'ohp'
     OR (public.strength_lift_variant('Squat')).factor <> 1
     OR (public.strength_lift_variant('Goblet Squat')).fam IS NOT NULL
     OR (public.strength_lift_variant('Bicep Curl')).fam IS NOT NULL THEN
    RAISE EXCEPTION 'probe: lift variants misread';
  END IF;
  IF public.league_age_factor(30) <> 1.0 OR public.league_age_factor(50) <> 1.130
     OR public.league_age_factor(75) <> 1.4 OR public.league_age_factor(16) <> 1.13 THEN
    RAISE EXCEPTION 'probe: age factors wrong';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (v_a, 'lp-probe-a-' || v_a || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (v_b, 'lp-probe-b-' || v_b || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (v_c, 'lp-probe-c-' || v_c || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email, username)
    VALUES (v_a, 'lp-probe-a-' || v_a || '@example.invalid', 'zqlpprobea' || left(v_a::text, 6)),
           (v_b, 'lp-probe-b-' || v_b || '@example.invalid', 'zqlpprobeb' || left(v_b::text, 6)),
           (v_c, 'lp-probe-c-' || v_c || '@example.invalid', 'zqlpprobec' || left(v_c::text, 6))
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username;
    UPDATE public.user_profiles SET league_tier = 'bronze', league_shields_owned = 0
     WHERE id IN (v_a, v_b, v_c);
    UPDATE public.user_profiles SET weight_lbs = 180, gender = 'male', age = 28,
           fitness_level = 'advanced', fitness_assessment = '{}'::jsonb WHERE id = v_a;
    UPDATE public.user_profiles SET weight_lbs = 150, gender = 'female', age = 60,
           fitness_level = 'newbie' WHERE id = v_b;
    UPDATE public.user_profiles SET weight_lbs = NULL, gender = 'male', age = 30,
           fitness_level = 'newbie' WHERE id = v_c;
    DELETE FROM public.league_strength WHERE user_id IN (v_a, v_b, v_c);

    -- A: onboarding says Advanced -> Gold, provisional.
    v_r := public.league_apply_strength_placement(v_a);
    IF v_r <> 'provisional' OR (SELECT league_tier FROM public.user_profiles WHERE id = v_a) <> 'gold' THEN
      RAISE EXCEPTION 'probe: A onboarding placement %', v_r;
    END IF;
    IF public.league_apply_strength_placement(v_a) <> 'hold' THEN
      RAISE EXCEPTION 'probe: A placed twice from onboarding';
    END IF;
    -- A then logs modest lifts: the first real score decides, downwards too.
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises) VALUES
     (v_a, 'probe', CURRENT_DATE - 2, '[{"name":"Bench Press","sets":[{"weight":135,"reps":5}]}]'),
     (v_a, 'probe', CURRENT_DATE - 1, '[{"name":"Bench Press","sets":[{"weight":135,"reps":5}]}]');
    v_r := public.league_apply_strength_placement(v_a);
    IF v_r <> 'placed' OR (SELECT league_tier FROM public.user_profiles WHERE id = v_a) = 'gold'
       OR (SELECT basis FROM public.league_strength WHERE user_id = v_a) <> 'lifts' THEN
      RAISE EXCEPTION 'probe: A real score did not replace onboarding: % %', v_r,
        (SELECT detail FROM public.league_strength WHERE user_id = v_a);
    END IF;

    -- B: dumbbells, leg press and push-ups only, 60 years old. Scored, and
    -- the age factor applies.
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises) VALUES
     (v_b, 'probe', CURRENT_DATE - 3, '[{"name":"Dumbbell Bench Press","sets":[{"weight":25,"reps":8}]},{"name":"Leg Press","sets":[{"weight":180,"reps":10}]},{"name":"Push-Up","sets":[{"weight":0,"reps":12}]}]'),
     (v_b, 'probe', CURRENT_DATE - 1, '[{"name":"Dumbbell Bench Press","sets":[{"weight":25,"reps":8}]},{"name":"Leg Press","sets":[{"weight":180,"reps":10}]}]');
    v := public.league_strength_compute(v_b);
    IF (v->>'score') IS NULL OR (v->>'age_factor')::numeric <> 1.340
       OR NOT (v->>'converted')::boolean OR (v->'lifts'->>'squat') IS NULL THEN
      RAISE EXCEPTION 'probe: B not scored from variants: %', v;
    END IF;

    -- C: no bodyweight saved. Scored on a default, capped at Gold.
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises) VALUES
     (v_c, 'probe', CURRENT_DATE - 2, '[{"name":"Squat","sets":[{"weight":455,"reps":1}]},{"name":"Bench Press","sets":[{"weight":335,"reps":1}]},{"name":"Deadlift","sets":[{"weight":545,"reps":1}]}]'),
     (v_c, 'probe', CURRENT_DATE - 1, '[{"name":"Squat","sets":[{"weight":455,"reps":1}]},{"name":"Bench Press","sets":[{"weight":335,"reps":1}]},{"name":"Deadlift","sets":[{"weight":545,"reps":1}]}]');
    v := public.league_strength_compute(v_c);
    IF (v->>'bodyweight_given')::boolean OR (v->>'score')::numeric < 400 THEN
      RAISE EXCEPTION 'probe: C default bodyweight wrong: %', v;
    END IF;
    PERFORM public.league_apply_strength_placement(v_c);
    IF (SELECT league_tier FROM public.user_profiles WHERE id = v_c) <> 'gold' THEN
      RAISE EXCEPTION 'probe: C not capped at gold without a bodyweight';
    END IF;

    RAISE EXCEPTION 'probe_ok';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
  END;
END;
$probe$;

------------------------------------------------------------------------------
-- Place everyone now: onboarding answers for those without lifts, the
-- Strength Score for those with them. Notifies only a move out of Bronze.
------------------------------------------------------------------------------
DO $place$
DECLARE v_uid uuid;
BEGIN
  FOR v_uid IN
    SELECT up.id FROM public.user_profiles up
     LEFT JOIN public.league_strength ls ON ls.user_id = up.id
     WHERE ls.placed_at IS NULL OR ls.basis IS DISTINCT FROM 'lifts'
  LOOP
    BEGIN
      PERFORM public.league_apply_strength_placement(v_uid);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'league placement failed for %: %', v_uid, SQLERRM;
    END;
  END LOOP;
END;
$place$;
