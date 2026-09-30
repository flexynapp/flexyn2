-- Strength decides your league, training decides your week (Kegan, 2026-09-30).
--
-- Before: your league tier moved by weekly XP rank, and only when 5 or more
-- members of a bracket qualified. No bracket ever had 5, so all 145 profiles
-- were Bronze and nobody had ever been promoted. Every 28 days the season end
-- dropped everyone a tier on top of that.
--
-- After:
--   * A Strength Score, computed here from logged sets and nowhere else, sets
--     your tier. It is DOTS (bodyweight and sex adjusted) on your squat, bench,
--     deadlift and overhead press over the last 90 days.
--   * Your first placement happens as soon as you have a score and can land
--     on any tier. After that you move one tier per Monday: up when your score
--     clears the next tier's floor, down only when it falls 10% below your own
--     tier's floor. A shield still blocks a demotion. No score (no bodyweight,
--     or no main lift in 90 days) holds your tier rather than dropping it.
--   * The weekly bracket is a race on training days, then XP. It pays coins
--     and capsules at each member's own tier and never moves anyone's tier.
--     When your tier has too few people active this week, you are bracketed
--     with the nearest tiers instead of racing alone.
--   * The quiet-week decay and the season-end tier drop are gone. Seasons keep
--     their titles and trophies.
--
-- Why each anti-cheat rule exists:
--   * Only workouts not flagged implausible count (the 360 trigger).
--   * Only sets of 1 to 10 reps count, with Epley above one rep. A 60-rep set
--     read as a max is the easiest forgery there is.
--   * A lift counts at your SECOND-best session for it. One typo or one forged
--     session cannot place you; a real PR counts once you get near it again.
--   * An estimated max beyond a multiple of bodyweight no human has shown
--     (squat 4x, bench 3x, deadlift 4.5x, press 2.2x) is ignored.
--   * Nothing here takes a number from the client. The only client entry
--     points are ensure_my_league (which places you from your own logs) and
--     my_league_strength (read only).

------------------------------------------------------------------------------
-- 1. Tier helpers
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.league_tier_rank(p_tier text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_catalog' AS $$
  SELECT CASE p_tier
    WHEN 'bronze' THEN 1 WHEN 'silver' THEN 2 WHEN 'gold' THEN 3
    WHEN 'platinum' THEN 4 WHEN 'diamond' THEN 5 WHEN 'legend' THEN 6
    ELSE 1 END;
$$;

CREATE OR REPLACE FUNCTION public.league_tier_at(p_rank integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_catalog' AS $$
  SELECT (ARRAY['bronze','silver','gold','platinum','diamond','legend'])
         [LEAST(6, GREATEST(1, COALESCE(p_rank, 1)))];
$$;

-- The Strength Score a tier starts at. Mirrors STRENGTH_FLOORS in
-- src/lib/leagueTiers.js; move both together.
CREATE OR REPLACE FUNCTION public.league_tier_floor(p_tier text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_catalog' AS $$
  SELECT CASE p_tier
    WHEN 'silver' THEN 150 WHEN 'gold' THEN 250 WHEN 'platinum' THEN 325
    WHEN 'diamond' THEN 400 WHEN 'legend' THEN 475 ELSE 0 END::numeric;
$$;

CREATE OR REPLACE FUNCTION public.league_tier_for_score(p_score numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_catalog' AS $$
  SELECT CASE
    WHEN p_score IS NULL THEN 'bronze'
    WHEN p_score >= 475 THEN 'legend'
    WHEN p_score >= 400 THEN 'diamond'
    WHEN p_score >= 325 THEN 'platinum'
    WHEN p_score >= 250 THEN 'gold'
    WHEN p_score >= 150 THEN 'silver'
    ELSE 'bronze' END;
$$;

------------------------------------------------------------------------------
-- 2. Strength Score
------------------------------------------------------------------------------

-- Which of the four scored lifts an exercise name is, or NULL. Barbell
-- competition lifts only: a goblet squat, a dumbbell press or an incline
-- bench is a different lift and would make the score mean less.
CREATE OR REPLACE FUNCTION public.strength_lift_family(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_catalog' AS $$
  SELECT CASE
    WHEN n ~ '^(barbell )?(back |front |low[ -]bar |high[ -]bar )?squats?$' THEN 'squat'
    WHEN n ~ '^(barbell )?(flat )?bench( press)?$' THEN 'bench'
    WHEN n ~ '^(barbell |conventional |sumo |trap[ -]bar |hex[ -]bar )?deadlifts?$' THEN 'deadlift'
    WHEN n ~ '^(barbell |standing |strict )?(overhead press|military press|ohp)$' THEN 'ohp'
    ELSE NULL END
  FROM (SELECT regexp_replace(lower(btrim(COALESCE(p_name, ''))), '\s+', ' ', 'g') AS n) x;
$$;

-- DOTS points for a total and bodyweight, both in kg. For a lifter who did
-- not give a sex (or chose not to say) it is the mean of the two formulas,
-- which neither flatters nor penalises them.
CREATE OR REPLACE FUNCTION public.league_dots(p_total_kg numeric, p_bw_kg numeric, p_sex text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_catalog' AS $$
DECLARE
  m numeric := LEAST(210, GREATEST(40, p_bw_kg));
  f numeric := LEAST(150, GREATEST(40, p_bw_kg));
  v_m numeric;
  v_f numeric;
BEGIN
  IF p_total_kg IS NULL OR p_bw_kg IS NULL OR p_total_kg <= 0 THEN RETURN NULL; END IF;
  v_m := p_total_kg * 500 / (-307.75076 + 24.0900756 * m - 0.1918759221 * m^2
                             + 0.0007391293 * m^3 - 0.000001093 * m^4);
  v_f := p_total_kg * 500 / (-57.96288 + 13.6175032 * f - 0.1126655495 * f^2
                             + 0.0005158568 * f^3 - 0.0000010706 * f^4);
  RETURN CASE lower(COALESCE(p_sex, ''))
           WHEN 'male' THEN v_m
           WHEN 'female' THEN v_f
           ELSE (v_m + v_f) / 2 END;
END;
$$;

-- The whole score, as data. Pure: reads, never writes.
--   score     numeric or null
--   lifts     {squat: lbs, ...}  the second-best session's estimated max
--   sessions  {squat: n, ...}    sessions in the window with that lift
--   total_lbs the total DOTS was taken on
--   estimated true when a missing lift was estimated from the others
--   bodyweight_lbs, reason ('no_bodyweight' | 'no_lifts' | null)
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
                THEN (st->>'reps')::numeric END AS reps
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
     WHERE fam IS NOT NULL AND wt > 0 AND wt <= 1500 AND reps BETWEEN 1 AND 10
     GROUP BY log_id, fam
  ), sane AS (
    SELECT * FROM best
     WHERE v_bw IS NULL
        OR e1rm <= v_bw * CASE fam WHEN 'squat' THEN 4.0 WHEN 'bench' THEN 3.0
                                   WHEN 'deadlift' THEN 4.5 ELSE 2.2 END
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

CREATE TABLE IF NOT EXISTS public.league_strength (
  user_id     uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  score       numeric,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  placed_at   timestamptz,
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.league_strength ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.league_strength FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.league_strength TO authenticated;
DROP POLICY IF EXISTS league_strength_own_read ON public.league_strength;
CREATE POLICY league_strength_own_read ON public.league_strength
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.league_strength_refresh(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE v jsonb := public.league_strength_compute(p_user_id);
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.league_strength (user_id, score, detail, computed_at)
  VALUES (p_user_id, (v->>'score')::numeric, v, now())
  ON CONFLICT (user_id) DO UPDATE
    SET score = EXCLUDED.score, detail = EXCLUDED.detail, computed_at = now();
  RETURN (v->>'score')::numeric;
END;
$$;

------------------------------------------------------------------------------
-- 3. Notifications for a tier move (en, es, fr; other languages read English)
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
          CASE p_outcome WHEN 'promote' THEN 'league_promoted' WHEN 'placed' THEN 'league_promoted'
                         WHEN 'demote' THEN 'league_demoted' ELSE 'league_held' END,
          v_text->>'title', v_text->>'body', '🏆', '/dashboard',
          jsonb_build_object('outcome', p_outcome, 'tier', p_tier, 'coins', COALESCE(p_coins, 0)))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

------------------------------------------------------------------------------
-- 4. Placement
------------------------------------------------------------------------------

-- Moves one user's tier from their Strength Score. Returns what happened:
-- 'unscored' | 'placed' | 'promote' | 'demote' | 'shielded' | 'hold'.
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
    END IF;
    PERFORM public.notify_league_placement_internal(p_user_id, 'placed', v_target);
    RETURN 'placed';
  END IF;

  IF public.league_tier_rank(v_target) > public.league_tier_rank(v_tier) THEN
    v_new := public.league_tier_at(public.league_tier_rank(v_tier) + 1);
    UPDATE public.user_profiles SET league_tier = v_new WHERE id = p_user_id;
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
  v_next   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  v := public.league_strength_compute(v_uid);
  SELECT COALESCE(league_tier, 'bronze') INTO v_tier FROM public.user_profiles WHERE id = v_uid;
  SELECT placed_at INTO v_placed FROM public.league_strength WHERE user_id = v_uid;
  v_next := CASE WHEN public.league_tier_rank(v_tier) < 6
                 THEN public.league_tier_at(public.league_tier_rank(v_tier) + 1) END;
  RETURN COALESCE(v, '{}'::jsonb) || jsonb_build_object(
    'tier', v_tier,
    'placed', v_placed IS NOT NULL,
    'tier_floor', public.league_tier_floor(v_tier),
    'drop_below', CASE WHEN v_tier = 'bronze' THEN NULL
                       ELSE round(public.league_tier_floor(v_tier) * 0.9, 1) END,
    'next_tier', v_next,
    'next_floor', CASE WHEN v_next IS NULL THEN NULL ELSE public.league_tier_floor(v_next) END);
END;
$$;

------------------------------------------------------------------------------
-- 5. Brackets carry each member's own tier
------------------------------------------------------------------------------

ALTER TABLE public.league_members ADD COLUMN IF NOT EXISTS tier text;
UPDATE public.league_members m SET tier = l.tier
  FROM public.leagues l WHERE l.id = m.league_id AND m.tier IS NULL;
ALTER TABLE public.league_members DROP CONSTRAINT IF EXISTS league_members_tier_check;
ALTER TABLE public.league_members ADD CONSTRAINT league_members_tier_check
  CHECK (tier IS NULL OR tier IN ('bronze','silver','gold','platinum','diamond','legend'));
GRANT SELECT (tier) ON public.league_members TO authenticated;

-- ensure_my_league is the only way in. The client INSERT policy checked who
-- was joining but not which bracket, so anyone could join any bracket.
DROP POLICY IF EXISTS "league_members: insert own" ON public.league_members;
REVOKE INSERT ON public.league_members FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.league_members_guard_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN RETURN NEW; END IF;
  NEW.weekly_xp := 0;
  NEW.rank      := NULL;
  NEW.tier      := (SELECT COALESCE(league_tier, 'bronze') FROM public.user_profiles WHERE id = NEW.user_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.league_members_guard_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;
  NEW.weekly_xp  := OLD.weekly_xp;
  NEW.rank       := OLD.rank;
  NEW.league_id  := OLD.league_id;
  NEW.user_id    := OLD.user_id;
  NEW.user_email := OLD.user_email;
  NEW.joined_at  := OLD.joined_at;
  NEW.tier       := OLD.tier;
  RETURN NEW;
END;
$function$;

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

  RETURN jsonb_build_object('league', v_league, 'member', v_member);
END;
$function$;

-- Also refreshes active_days, which the standings rank on first. It used to
-- be written only when the week resolved, so mid-week every member read 0
-- days and the card said "Log a workout to qualify" to people who had.
CREATE OR REPLACE FUNCTION public.sync_my_weekly_league()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        UUID := auth.uid();
  v_member_id  UUID;
  v_league_id  UUID;
  v_week_start DATE;
  v_week_end   DATE;
  v_xp         INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_week_start := (date_trunc('week', CURRENT_DATE))::DATE;
  v_week_end   := v_week_start + 6;

  SELECT id INTO v_league_id
    FROM public.leagues
   WHERE week_start = v_week_start
     AND id IN (SELECT league_id FROM public.league_members WHERE user_id = v_uid)
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_league_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_member_id
    FROM public.league_members
   WHERE league_id = v_league_id AND user_id = v_uid
   LIMIT 1;

  IF v_member_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_xp
    FROM public.xp_grant_log
   WHERE user_id = v_uid
     AND granted_at >= v_week_start::TIMESTAMPTZ
     AND granted_at < (v_week_end + 1)::TIMESTAMPTZ;

  UPDATE public.league_members
     SET weekly_xp   = LEAST(150000, GREATEST(0, v_xp)),
         active_days = public.league_active_days(v_uid, v_week_start, v_week_end)
   WHERE id = v_member_id;
END;
$function$;

------------------------------------------------------------------------------
-- 6. The weekly race
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_league_bracket_internal(p_league_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Below this many qualified members nobody wins the top prize; everyone who
  -- qualified still gets the participation payout. A bracket of one must not
  -- be a guaranteed first place every week.
  c_min_bracket CONSTANT INTEGER := 5;

  v_tier        TEXT;
  v_week_start  DATE;
  v_week_end    DATE;
  v_prize_pct   NUMERIC;

  v_qualified   INTEGER := 0;
  v_prize_n     INTEGER := 0;
  v_rank        INTEGER := 0;
  v_touched     INTEGER := 0;

  v_mid         UUID;
  v_uid         UUID;
  v_email       TEXT;
  v_mtier       TEXT;
  v_days        INTEGER;
  v_xp          INTEGER;
  v_min_days    INTEGER;
  v_coins       INTEGER;
  v_capsule     TEXT;
  v_outcome     TEXT;
  v_pay         INTEGER;
  v_cap         TEXT;
BEGIN
  SELECT tier, week_start, week_end
    INTO v_tier, v_week_start, v_week_end
    FROM public.leagues
   WHERE id = p_league_id;

  IF v_tier IS NULL THEN
    RETURN 0;
  END IF;

  v_prize_pct := CASE v_tier WHEN 'bronze' THEN 0.50 WHEN 'silver' THEN 0.40
                             WHEN 'gold' THEN 0.30 WHEN 'platinum' THEN 0.25
                             ELSE 0.20 END;

  FOR v_mid IN
    SELECT id FROM public.league_members WHERE league_id = p_league_id
  LOOP
    SELECT user_id, COALESCE(tier, v_tier) INTO v_uid, v_mtier
      FROM public.league_members WHERE id = v_mid;

    v_days := public.league_active_days(v_uid, v_week_start, v_week_end);
    v_min_days := CASE v_mtier WHEN 'bronze' THEN 1 WHEN 'silver' THEN 1
                               WHEN 'gold' THEN 2 WHEN 'platinum' THEN 2 ELSE 3 END;

    UPDATE public.league_members
       SET active_days = v_days, qualified = (v_days >= v_min_days)
     WHERE id = v_mid;
  END LOOP;

  SELECT COUNT(*) INTO v_qualified
    FROM public.league_members
   WHERE league_id = p_league_id AND qualified = TRUE;

  IF v_qualified >= c_min_bracket THEN
    v_prize_n := GREATEST(1, CEIL(v_qualified * v_prize_pct))::INTEGER;
  END IF;

  FOR v_mid IN
    SELECT id FROM public.league_members
     WHERE league_id = p_league_id AND qualified = TRUE
     ORDER BY active_days DESC, weekly_xp DESC NULLS LAST, joined_at ASC
  LOOP
    v_rank := v_rank + 1;

    SELECT user_id, user_email, COALESCE(weekly_xp, 0), COALESCE(tier, v_tier)
      INTO v_uid, v_email, v_xp, v_mtier
      FROM public.league_members WHERE id = v_mid;

    v_coins := CASE v_mtier WHEN 'bronze' THEN 50 WHEN 'silver' THEN 100 WHEN 'gold' THEN 200
                            WHEN 'platinum' THEN 350 WHEN 'diamond' THEN 600 ELSE 1000 END;
    v_capsule := CASE v_mtier WHEN 'gold' THEN 'standard' WHEN 'platinum' THEN 'premium'
                              WHEN 'diamond' THEN 'premium' WHEN 'legend' THEN 'elite' ELSE NULL END;

    IF v_rank <= v_prize_n THEN
      v_outcome := 'top';
      v_pay := CASE WHEN v_rank = 1 THEN (v_coins * 3) / 2 ELSE v_coins END;
      v_cap := v_capsule;
    ELSE
      v_outcome := 'hold';
      v_pay := GREATEST(1, v_coins / 4);
      v_cap := NULL;
    END IF;

    UPDATE public.league_members
       SET rank = v_rank, outcome = v_outcome, coins_awarded = v_pay
     WHERE id = v_mid;

    UPDATE public.user_profiles
       SET league_inactive_weeks = 0,
           flex_coins = COALESCE(flex_coins, 0) + v_pay
     WHERE id = v_uid;

    IF v_cap IS NOT NULL THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (v_uid, v_email, v_cap);
    END IF;

    PERFORM public.league_season_record_internal(v_uid, v_email, v_mtier, TRUE, v_xp);

    IF v_outcome = 'top' THEN
      PERFORM public.notify_league_placement_internal(v_uid, 'top', v_mtier, v_pay, v_rank);
    END IF;

    v_touched := v_touched + 1;
  END LOOP;

  -- Not training this week costs your payout and nothing else. Your tier is
  -- your strength, and a rest week does not make you weaker.
  FOR v_mid IN
    SELECT id FROM public.league_members
     WHERE league_id = p_league_id AND qualified = FALSE
  LOOP
    SELECT user_id, user_email, COALESCE(tier, v_tier) INTO v_uid, v_email, v_mtier
      FROM public.league_members WHERE id = v_mid;

    UPDATE public.league_members
       SET outcome = 'unranked', coins_awarded = 0
     WHERE id = v_mid;

    UPDATE public.user_profiles
       SET league_inactive_weeks = COALESCE(league_inactive_weeks, 0) + 1
     WHERE id = v_uid;

    PERFORM public.league_season_record_internal(v_uid, v_email, v_mtier, FALSE, 0);

    v_touched := v_touched + 1;
  END LOOP;

  UPDATE public.leagues
     SET qualified_count = v_qualified,
         resolved_at = now()
   WHERE id = p_league_id;

  RETURN v_touched;
END;
$function$;

CREATE OR REPLACE FUNCTION public.roll_weekly_leagues()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id      UUID;
  v_start   DATE;
  v_end     DATE;
  v_uid     UUID;
  v_claimed INTEGER := 0;
BEGIN
  FOR v_id, v_start, v_end IN
    SELECT id, week_start, week_end FROM public.leagues
     WHERE is_resolved = FALSE
       AND week_end = LEAST(week_end, CURRENT_DATE)
       AND NOT (week_end = CURRENT_DATE)
     ORDER BY week_start
  LOOP
    UPDATE public.leagues
       SET is_resolved = TRUE
     WHERE id = v_id AND is_resolved = FALSE;

    IF FOUND THEN
      UPDATE public.league_members m
         SET weekly_xp = LEAST(150000, GREATEST(0, COALESCE((
               SELECT SUM(g.amount) FROM public.xp_grant_log g
                WHERE g.user_id = m.user_id
                  AND g.granted_at >= v_start::TIMESTAMPTZ
                  AND g.granted_at < (v_end + 1)::TIMESTAMPTZ), 0)))
       WHERE m.league_id = v_id;

      PERFORM public.resolve_league_bracket_internal(v_id);

      -- Then the tier moves, from strength. One lifter's failure must not
      -- stop everyone else's placement or roll back the week's payouts.
      FOR v_uid IN SELECT DISTINCT user_id FROM public.league_members WHERE league_id = v_id LOOP
        BEGIN
          PERFORM public.league_apply_strength_placement(v_uid);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'league placement failed for %: %', v_uid, SQLERRM;
        END;
      END LOOP;

      v_claimed := v_claimed + 1;
    END IF;
  END LOOP;

  RETURN v_claimed;
END;
$function$;

------------------------------------------------------------------------------
-- 7. Seasons no longer drop everyone a tier
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.roll_league_seasons()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_min_weeks CONSTANT INTEGER := 2;

  v_season   UUID;
  v_number   INTEGER;
  v_next     INTEGER;
  v_uid      UUID;
  v_email    TEXT;
  v_tier     TEXT;
  v_weeks    INTEGER;
  v_champ    UUID;
  v_rank     INTEGER := 0;
  v_awarded  INTEGER := 0;
BEGIN
  SELECT id, season_number INTO v_season, v_number
    FROM public.league_seasons
   WHERE status = 'active'
     AND now() = GREATEST(now(), ends_at)
     AND NOT (now() = ends_at)
   ORDER BY season_number
   LIMIT 1;

  IF v_season IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.league_seasons
     SET status = 'completed'
   WHERE id = v_season AND status = 'active';

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  FOR v_uid IN
    SELECT user_id FROM public.league_season_stats
     WHERE season_id = v_season
     ORDER BY season_xp DESC, weeks_qualified DESC
  LOOP
    v_rank := v_rank + 1;
    UPDATE public.league_season_stats
       SET final_rank = v_rank
     WHERE season_id = v_season AND user_id = v_uid;
  END LOOP;

  SELECT user_id INTO v_champ
    FROM public.league_season_stats
   WHERE season_id = v_season
     AND best_tier = 'legend'
     AND weeks_qualified >= c_min_weeks
   ORDER BY season_xp DESC, weeks_qualified DESC
   LIMIT 1;

  FOR v_uid IN
    SELECT user_id FROM public.league_season_stats
     WHERE season_id = v_season
       AND weeks_qualified >= c_min_weeks
  LOOP
    SELECT user_email, best_tier, weeks_qualified
      INTO v_email, v_tier, v_weeks
      FROM public.league_season_stats
     WHERE season_id = v_season AND user_id = v_uid;

    PERFORM public.award_league_season_internal(v_uid, v_email, v_number, v_tier, FALSE);

    IF v_champ IS NOT NULL AND v_uid = v_champ THEN
      PERFORM public.award_league_season_internal(v_uid, v_email, v_number, v_tier, TRUE);
    END IF;

    UPDATE public.league_season_stats
       SET awarded_at = now()
     WHERE season_id = v_season AND user_id = v_uid;

    PERFORM public.notify_league_resolution_internal(
      v_uid, 'hold', v_tier, v_tier, 0, NULL);

    v_awarded := v_awarded + 1;
  END LOOP;

  -- The season-end drop that lived here is gone: a tier is a strength band
  -- now, and a calendar boundary does not make anyone weaker.

  v_next := v_number + 1;
  INSERT INTO public.league_seasons (season_number, name, starts_at, ends_at, status)
  VALUES (v_next, public.league_season_name(v_next), now(), now() + INTERVAL '28 days', 'active')
  ON CONFLICT DO NOTHING;

  RETURN v_awarded;
END;
$function$;

------------------------------------------------------------------------------
-- 8. Grants. Everything internal is closed to the app.
------------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.league_strength_compute(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_strength_refresh(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_apply_strength_placement(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_league_placement_internal(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_league_bracket_internal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.roll_weekly_leagues() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.roll_league_seasons() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_league_strength() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_league_strength() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_my_league() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ensure_my_league() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_my_weekly_league() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sync_my_weekly_league() TO authenticated;

------------------------------------------------------------------------------
-- 9. Probe: play the real flow on seeded lifters, then roll it all back.
------------------------------------------------------------------------------

DO $probe$
DECLARE
  v_a uuid; v_b uuid; v_c uuid;
  v   jsonb;
  v_t text;
  v_r text;
  v_league uuid;
BEGIN
  -- Pure pieces first; these run on an empty preview database too.
  IF public.strength_lift_family('Barbell Back Squat') <> 'squat'
     OR public.strength_lift_family('Bench Press') <> 'bench'
     OR public.strength_lift_family('Sumo Deadlift') <> 'deadlift'
     OR public.strength_lift_family('Overhead Press') <> 'ohp'
     OR public.strength_lift_family('Goblet Squat') IS NOT NULL
     OR public.strength_lift_family('Incline Bench Press') IS NOT NULL
     OR public.strength_lift_family('Romanian Deadlift') IS NOT NULL
     OR public.strength_lift_family('Dumbbell Shoulder Press') IS NOT NULL THEN
    RAISE EXCEPTION 'probe: lift names misread';
  END IF;
  -- 165 lb man, 185/245/315 singles: about 243 DOTS.
  IF round(public.league_dots(745 * 0.45359237, 165 * 0.45359237, 'male')) NOT BETWEEN 240 AND 246 THEN
    RAISE EXCEPTION 'probe: DOTS off (%)', public.league_dots(745 * 0.45359237, 165 * 0.45359237, 'male');
  END IF;
  IF public.league_tier_for_score(243) <> 'silver' OR public.league_tier_for_score(250) <> 'gold'
     OR public.league_tier_for_score(NULL) <> 'bronze' THEN
    RAISE EXCEPTION 'probe: tier bands wrong';
  END IF;
  IF has_function_privilege('authenticated', 'public.league_apply_strength_placement(uuid)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.league_members', 'INSERT') THEN
    RAISE EXCEPTION 'probe: a client door is open';
  END IF;

  -- Seeded flow needs three real profiles to borrow (rolled back).
  -- Seeded lifters, created and rolled back inside the block below, so this
  -- runs the same on an empty preview database as on production.
  v_a := gen_random_uuid(); v_b := gen_random_uuid(); v_c := gen_random_uuid();

  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (v_a, 'sl-probe-a-' || v_a || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (v_b, 'sl-probe-b-' || v_b || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (v_c, 'sl-probe-c-' || v_c || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email, username)
    VALUES (v_a, 'sl-probe-a-' || v_a || '@example.invalid', 'zqslprobea' || left(v_a::text, 6)),
           (v_b, 'sl-probe-b-' || v_b || '@example.invalid', 'zqslprobeb' || left(v_b::text, 6)),
           (v_c, 'sl-probe-c-' || v_c || '@example.invalid', 'zqslprobec' || left(v_c::text, 6))
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username;
    UPDATE public.user_profiles SET weight_lbs = 165, gender = 'male', league_tier = 'bronze',
           league_shields_owned = 0 WHERE id IN (v_a, v_b, v_c);

    -- A: two honest sessions of the big three -> placed straight into Gold.
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises) VALUES
     (v_a, 'probe', CURRENT_DATE - 3, '[{"name":"Squat","sets":[{"weight":275,"reps":1}]},{"name":"Bench Press","sets":[{"weight":205,"reps":1}]},{"name":"Deadlift","sets":[{"weight":345,"reps":1}]}]'),
     (v_a, 'probe', CURRENT_DATE - 1, '[{"name":"Squat","sets":[{"weight":275,"reps":1}]},{"name":"Bench Press","sets":[{"weight":205,"reps":1}]},{"name":"Deadlift","sets":[{"weight":345,"reps":1}]}]');
    -- B: one absurd session plus one modest one. The absurd one must not count.
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises) VALUES
     (v_b, 'probe', CURRENT_DATE - 2, '[{"name":"Bench Press","sets":[{"weight":135,"reps":5}]}]'),
     (v_b, 'probe', CURRENT_DATE - 1, '[{"name":"Bench Press","sets":[{"weight":400,"reps":1},{"weight":100,"reps":60}]}]');
    -- C: a single session only -> not placed yet.
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises) VALUES
     (v_c, 'probe', CURRENT_DATE - 1, '[{"name":"Deadlift","sets":[{"weight":315,"reps":3}]}]');

    v := public.league_strength_compute(v_a);
    IF (v->>'score')::numeric NOT BETWEEN 265 AND 272 OR (v->>'estimated')::boolean THEN
      RAISE EXCEPTION 'probe: A scored %', v;
    END IF;
    v := public.league_strength_compute(v_b);
    IF (v->'lifts'->>'bench')::numeric > 160 THEN
      RAISE EXCEPTION 'probe: forged bench counted (%)', v;
    END IF;
    v := public.league_strength_compute(v_c);
    IF v->>'score' IS NOT NULL OR v->>'reason' <> 'no_lifts' THEN
      RAISE EXCEPTION 'probe: one session placed C (%)', v;
    END IF;

    v_r := public.league_apply_strength_placement(v_a);
    SELECT league_tier INTO v_t FROM public.user_profiles WHERE id = v_a;
    IF v_r <> 'placed' OR v_t <> 'gold' THEN RAISE EXCEPTION 'probe: A placed % in %', v_r, v_t; END IF;

    -- Already placed: a small dip holds, a real drop demotes one tier.
    IF public.league_apply_strength_placement(v_a) <> 'hold' THEN RAISE EXCEPTION 'probe: A did not hold'; END IF;
    UPDATE public.workout_logs SET exercises = '[{"name":"Squat","sets":[{"weight":185,"reps":1}]},{"name":"Bench Press","sets":[{"weight":135,"reps":1}]},{"name":"Deadlift","sets":[{"weight":225,"reps":1}]}]'
     WHERE user_id = v_a AND created_by = 'probe';
    v_r := public.league_apply_strength_placement(v_a);
    SELECT league_tier INTO v_t FROM public.user_profiles WHERE id = v_a;
    IF v_r <> 'demote' OR v_t <> 'silver' THEN RAISE EXCEPTION 'probe: A demote gave % in %', v_r, v_t; END IF;

    -- No lifts at all in the window holds the tier.
    DELETE FROM public.workout_logs WHERE user_id = v_a AND created_by = 'probe';
    IF public.league_apply_strength_placement(v_a) <> 'unscored' THEN RAISE EXCEPTION 'probe: empty log moved A'; END IF;
    SELECT league_tier INTO v_t FROM public.user_profiles WHERE id = v_a;
    IF v_t <> 'silver' THEN RAISE EXCEPTION 'probe: empty log changed tier to %', v_t; END IF;

    -- A resolved week pays by the member's own tier and never touches tiers.
    INSERT INTO public.leagues (tier, week_start, week_end, member_count, is_resolved)
    VALUES ('bronze', DATE '2001-01-01', DATE '2001-01-07', 0, FALSE) RETURNING id INTO v_league;
    INSERT INTO public.league_members (league_id, user_id, user_email, weekly_xp, tier)
    VALUES (v_league, v_b, 'probe-b@example.invalid', 0, 'bronze'),
           (v_league, v_c, 'probe-c@example.invalid', 0, 'bronze');
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises)
    VALUES (v_b, 'probe', DATE '2001-01-03', '[{"name":"Squat","sets":[{"weight":95,"reps":5}]}]');
    PERFORM public.resolve_league_bracket_internal(v_league);
    IF (SELECT outcome FROM public.league_members WHERE league_id = v_league AND user_id = v_b) <> 'hold'
       OR (SELECT coins_awarded FROM public.league_members WHERE league_id = v_league AND user_id = v_b) <> 12
       OR (SELECT outcome FROM public.league_members WHERE league_id = v_league AND user_id = v_c) <> 'unranked' THEN
      RAISE EXCEPTION 'probe: weekly race resolved wrong';
    END IF;
    IF (SELECT league_tier FROM public.user_profiles WHERE id = v_c) <> 'bronze' THEN
      RAISE EXCEPTION 'probe: resolver moved a tier';
    END IF;

    RAISE EXCEPTION 'probe_ok';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
  END;
END
$probe$;

------------------------------------------------------------------------------
-- 10. Place everyone who already has a score. Nobody has one today except a
-- couple of lifters, and they get one "You're in the ... League" alert each.
------------------------------------------------------------------------------

DO $place$
DECLARE v_uid uuid;
BEGIN
  FOR v_uid IN
    SELECT DISTINCT user_id FROM public.workout_logs
     WHERE date >= CURRENT_DATE - 90 AND user_id IS NOT NULL
       AND user_id IN (SELECT id FROM public.user_profiles)
  LOOP
    BEGIN
      PERFORM public.league_apply_strength_placement(v_uid);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'placement failed for %: %', v_uid, SQLERRM;
    END;
  END LOOP;
END
$place$;
