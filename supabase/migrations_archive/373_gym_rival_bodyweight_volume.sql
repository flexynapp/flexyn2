-- 373_gym_rival_bodyweight_volume.sql
--
-- Bodyweight training scores zero in Gym Rival, and the zero reaches the payout.
--
-- MEASURED, not inferred. Production holds a real set today:
--   exercise "Push-Up", weight "0", reps "5"
-- Every Gym Rival volume query is
--   SUM((s->>'weight')::numeric * (s->>'reps')::numeric)
--     WHERE (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
-- so that set contributes 0. Meanwhile `you_logged` is a bare
--   EXISTS (SELECT 1 FROM workout_logs WHERE user_id = … AND created_at >= …)
-- which is TRUE. The two disagree, and the disagreement is the whole bug:
--
--   • gym_rival_week_state shows the lifter 0 lb beside a rival's real number
--   • gym_rival_net_rating returns 0, so settlement can only draw or lose
--   • gym_rival_void_stale does NOT release them, because it voids on "did
--     not log" and they DID log. There is no exit. A calisthenics athlete is
--     locked into a week they cannot win.
--   • gym_rival_user_stats feeds weekly_output into matchmaking, so they are
--     also matched as though they never train.
--
-- THE SAME FORMULA WAS COPIED INTO FOUR PLACES (week_state computes it twice).
-- That is why this migration adds one function and makes all three callers use
-- it, rather than patching the expression four times and leaving the fifth
-- copy to be written next year.
--
-- HOW BODYWEIGHT COUNTS. load = bodyweight × factor, where the factor is the
-- fraction of the athlete's mass the movement actually translates:
--
--   pull-up / chin-up / muscle-up  1.00   whole body hangs from the bar
--   handstand push-up              0.90
--   dip                            0.95
--   pistol squat                   0.85
--   push-up                        0.65   measured ground-reaction fraction
--   burpee                         0.65
--   inverted row                   0.55
--   leg raise                      0.50
--   air squat                      0.45
--   sit-up / crunch                0.35
--   plank and every other hold     0.00   see below
--   anything unrecognised          0.00
--
-- Kegan set pull-up 1.0, dip 0.95 and push-up 0.65; the rest follow the same
-- basis. The vocabulary is deliberately the SAME set of movements
-- src/lib/exerciseEquipment.js already classifies as `bodyweight`, so the two
-- lists can be diffed rather than drifting silently.
--
-- HOLDS ARE ZERO ON PURPOSE. A plank's "reps" is seconds. Scoring
-- bodyweight × 60 for a one-minute plank would hand a 180 lb athlete 10,800 lb
-- of volume for one set and make the plank the strongest lift in the app. An
-- unrecognised exercise is 0 for the same reason: guessing a factor for a name
-- nobody listed is how a scoring system gets gamed.
--
-- WEIGHTED CALISTHENICS NOW COUNT PROPERLY TOO. The formula is
--   (bodyweight × factor + added_weight) × reps
-- so a +25 lb weighted pull-up scores the athlete's mass AND the belt. The old
-- expression scored 25 × reps for that set, which was not "zero" but was still
-- wrong by roughly the whole athlete.
--
-- NO BODYWEIGHT ON FILE MEANS NO CREDIT, and that is a deliberate choice
-- rather than an oversight: 27 of 56 profiles carry weight_lbs. Inventing a
-- default would let anyone score volume they never lifted, and the number
-- would be wrong for everybody rather than absent for some. week_state now
-- returns you_bw_missing / them_bw_missing so the card can ASK for the
-- weight instead of quietly showing a zero the athlete cannot explain.
--
-- SCOPE. This changes Gym Rival only. `workout_logs.total_volume` and
-- `get_gym_leaderboard` still treat a bodyweight set as 0, and that is
-- untouched here on purpose — it is a ranked column that users are compared
-- on, so changing it retroactively reorders a leaderboard and is its own
-- decision. Named, not fixed.
--
-- Paste-safe: no alias.column tokens, no record-field access, JSON arrows only.

-- ── The factor ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bodyweight_load_factor(p_name text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE
    -- Holds first: a plank matches nothing else, but an explicit 0 documents
    -- that it was considered rather than missed.
    WHEN lower(coalesce(p_name,'')) ~ '\m(plank|hold|hang|l[- ]?sit|wall sit)\M' THEN 0
    WHEN lower(coalesce(p_name,'')) ~ '\m(pull[- ]?up|chin[- ]?up|muscle[- ]?up)\M' THEN 1.00
    WHEN lower(coalesce(p_name,'')) ~ '\mdip\M'                                     THEN 0.95
    WHEN lower(coalesce(p_name,'')) ~ '\mhandstand\M'                               THEN 0.90
    WHEN lower(coalesce(p_name,'')) ~ '\mpistol squat\M'                            THEN 0.85
    WHEN lower(coalesce(p_name,'')) ~ '\m(push[- ]?up|burpee)\M'                    THEN 0.65
    WHEN lower(coalesce(p_name,'')) ~ '\minverted row\M'                            THEN 0.55
    WHEN lower(coalesce(p_name,'')) ~ '\mleg raise\M'                               THEN 0.50
    WHEN lower(coalesce(p_name,'')) ~ '\mair squat\M'                               THEN 0.45
    WHEN lower(coalesce(p_name,'')) ~ '\m(sit[- ]?up|crunch)\M'                     THEN 0.35
    ELSE 0
  END;
$function$;

-- ── The one volume formula ──────────────────────────────────────────────────
-- p_to NULL means "no upper bound", which is what net_rating and user_stats
-- want. Returns lbs.
CREATE OR REPLACE FUNCTION public.gym_rival_volume_lbs(
  p_uid  uuid,
  p_from timestamptz,
  p_to   timestamptz DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_bw  NUMERIC;
  v_vol NUMERIC := 0;
BEGIN
  SELECT weight_lbs INTO v_bw FROM public.user_profiles WHERE id = p_uid;
  IF v_bw IS NULL OR v_bw <= 0 THEN v_bw := 0; END IF;

  SELECT COALESCE(SUM(
           (COALESCE(v_bw * public.bodyweight_load_factor(ex->>'name'), 0)
            + COALESCE(NULLIF(s->>'weight','')::numeric, 0))
           * (s->>'reps')::numeric
         ), 0)
    INTO v_vol
    FROM public.workout_logs,
         jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
         jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
   WHERE user_id = p_uid
     AND created_at >= p_from
     AND (p_to IS NULL OR created_at < p_to)
     -- weight may legitimately be '', '0' or absent on a bodyweight set, so
     -- only reps has to be a number for the row to count. The old queries
     -- required BOTH, which discarded the bodyweight rows before the SUM.
     AND (s->>'reps') ~ '^[0-9]+$'
     AND (s->>'weight' IS NULL OR s->>'weight' = '' OR (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$');

  RETURN COALESCE(v_vol, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.gym_rival_volume_lbs(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bodyweight_load_factor(text) TO authenticated;

-- ── Settlement ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gym_rival_net_rating(p_uid uuid, p_since timestamp with time zone, p_type text DEFAULT 'gym'::text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_volume NUMERIC := 0; v_distance NUMERIC := 0;
BEGIN
  IF p_type = 'cardio' THEN
    SELECT COALESCE(SUM(distance_meters), 0) INTO v_distance
      FROM public.cardio_logs WHERE user_id = p_uid AND date >= p_since::date;
    RETURN round((v_distance / 1000) * 20);
  ELSE
    v_volume := public.gym_rival_volume_lbs(p_uid, p_since, NULL);
    RETURN round(v_volume / 100);
  END IF;
END;
$function$;

-- ── Matchmaking ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gym_rival_user_stats(p_uid uuid, p_type text DEFAULT 'gym'::text)
RETURNS TABLE(weekly_output numeric, cadence numeric, strength numeric, lifter_age numeric, lifter_level integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out    NUMERIC := 0;
  v_cad    NUMERIC := 0;
  v_str    NUMERIC;
  v_age    NUMERIC;
  v_lvl    INTEGER;
  v_weight NUMERIC;
  v_best   NUMERIC;
BEGIN
  SELECT weight_lbs, age, current_level
    INTO v_weight, v_age, v_lvl
    FROM public.user_profiles WHERE id = p_uid;

  IF p_type = 'cardio' THEN
    SELECT COALESCE(SUM(distance_meters), 0) / 4.0,
           COUNT(DISTINCT date)::numeric / 4.0
      INTO v_out, v_cad
      FROM public.cardio_logs
     WHERE user_id = p_uid AND date >= (now() - interval '28 days')::date;
  ELSE
    v_out := public.gym_rival_volume_lbs(p_uid, now() - interval '28 days', NULL) / 4.0;

    SELECT COUNT(DISTINCT created_at::date)::numeric / 4.0
      INTO v_cad
      FROM public.workout_logs
     WHERE user_id = p_uid AND created_at >= now() - interval '28 days';
  END IF;

  IF v_weight IS NOT NULL AND v_weight > 0 THEN
    SELECT MAX((public._best_1rm_from_exercises(exercises)->>'e1rm')::numeric)
      INTO v_best
      FROM public.workout_logs
     WHERE user_id = p_uid AND created_at > now() - interval '90 days';
    IF v_best IS NOT NULL THEN
      v_str := v_best / v_weight;
    END IF;
  END IF;

  RETURN QUERY SELECT COALESCE(v_out, 0), COALESCE(v_cad, 0), v_str, v_age, v_lvl;
END;
$function$;

-- ── The live screen ─────────────────────────────────────────────────────────
-- DROP + CREATE, not OR REPLACE: the RETURNS TABLE signature gains two
-- columns and Postgres refuses to replace a function whose OUT parameters
-- changed. The client reads named fields, so during the window between the
-- Netlify deploy and this SQL the two new fields are simply undefined.
DROP FUNCTION IF EXISTS public.gym_rival_week_state(uuid);

CREATE FUNCTION public.gym_rival_week_state(p_assignment_id uuid)
RETURNS TABLE(
  week_since timestamptz, week_ends timestamptz,
  you_volume numeric, them_volume numeric,
  you_distance numeric, them_distance numeric,
  you_logged boolean, them_logged boolean,
  afk_deadline timestamptz, is_stalled boolean,
  you_bw_missing boolean, them_bw_missing boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID; v_rival UUID; v_status TEXT; v_type TEXT;
  v_accepted TIMESTAMPTZ; v_assigned TIMESTAMPTZ;
  v_you UUID; v_them UUID;
  v_since TIMESTAMPTZ; v_ends TIMESTAMPTZ; v_deadline TIMESTAMPTZ;
  v_yv NUMERIC := 0; v_tv NUMERIC := 0; v_yd NUMERIC := 0; v_td NUMERIC := 0;
  v_yl BOOLEAN := FALSE; v_tl BOOLEAN := FALSE; v_stalled BOOLEAN := FALSE;
  v_ybw BOOLEAN := FALSE; v_tbw BOOLEAN := FALSE;
  v_w NUMERIC; v_bwsets INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT user_id, rival_id, status, rival_type, accepted_at, assigned_at
    INTO v_owner, v_rival, v_status, v_type, v_accepted, v_assigned
    FROM public.gym_rival_assignments WHERE id = p_assignment_id;

  IF v_owner IS NULL OR (v_uid <> v_owner AND v_uid <> v_rival) THEN
    RAISE EXCEPTION 'not_part_of_match' USING ERRCODE = '42501';
  END IF;

  IF v_uid = v_owner THEN v_you := v_owner; v_them := v_rival;
  ELSE v_you := v_rival; v_them := v_owner; END IF;

  v_stalled  := (v_status = 'active' AND v_accepted IS NULL);
  v_since    := date_trunc('week', COALESCE(v_accepted, v_assigned, now()));
  v_ends     := v_since + interval '7 days';
  v_deadline := v_accepted + interval '48 hours';

  v_yv := public.gym_rival_volume_lbs(v_you,  v_since, v_ends);
  v_tv := public.gym_rival_volume_lbs(v_them, v_since, v_ends);

  SELECT COALESCE(SUM(distance_meters), 0) INTO v_yd
    FROM public.cardio_logs
   WHERE user_id = v_you AND date >= v_since::date AND date < v_ends::date;

  SELECT COALESCE(SUM(distance_meters), 0) INTO v_td
    FROM public.cardio_logs
   WHERE user_id = v_them AND date >= v_since::date AND date < v_ends::date;

  IF v_accepted IS NOT NULL THEN
    IF v_type = 'cardio' THEN
      SELECT EXISTS (SELECT 1 FROM public.cardio_logs
                      WHERE user_id = v_you AND date >= v_accepted::date) INTO v_yl;
      SELECT EXISTS (SELECT 1 FROM public.cardio_logs
                      WHERE user_id = v_them AND date >= v_accepted::date) INTO v_tl;
    ELSE
      SELECT EXISTS (SELECT 1 FROM public.workout_logs
                      WHERE user_id = v_you AND created_at >= v_accepted) INTO v_yl;
      SELECT EXISTS (SELECT 1 FROM public.workout_logs
                      WHERE user_id = v_them AND created_at >= v_accepted) INTO v_tl;
    END IF;
  END IF;

  -- "Missing" is only worth saying to someone it actually costs: they logged
  -- bodyweight work THIS week and have no weight on file. Telling a barbell
  -- lifter to add their bodyweight would be noise on a screen that has none.
  IF v_type <> 'cardio' THEN
    SELECT weight_lbs INTO v_w FROM public.user_profiles WHERE id = v_you;
    SELECT COUNT(*) INTO v_bwsets
      FROM public.workout_logs,
           jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
           jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
     WHERE user_id = v_you AND created_at >= v_since AND created_at < v_ends
       AND public.bodyweight_load_factor(ex->>'name') > 0;
    v_ybw := (COALESCE(v_w, 0) <= 0 AND COALESCE(v_bwsets, 0) > 0);

    SELECT weight_lbs INTO v_w FROM public.user_profiles WHERE id = v_them;
    SELECT COUNT(*) INTO v_bwsets
      FROM public.workout_logs,
           jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
           jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
     WHERE user_id = v_them AND created_at >= v_since AND created_at < v_ends
       AND public.bodyweight_load_factor(ex->>'name') > 0;
    v_tbw := (COALESCE(v_w, 0) <= 0 AND COALESCE(v_bwsets, 0) > 0);
  END IF;

  RETURN QUERY SELECT v_since, v_ends, v_yv, v_tv, v_yd, v_td, v_yl, v_tl,
                      v_deadline, v_stalled, v_ybw, v_tbw;
END;
$function$;

REVOKE ALL ON FUNCTION public.gym_rival_week_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_rival_week_state(uuid) TO authenticated;

-- ── Self-verification ───────────────────────────────────────────────────────
-- Every column must read TRUE. These EXERCISE the functions rather than
-- checking that they exist — migration 372 in this same session passed every
-- catalog check while blocking nothing, which is the reason for the shape.
--
-- push_up_now_counts is the whole point: it re-scores the real production set
-- (Push-Up, weight 0, reps 5) for the user who owns it.
DO $$
DECLARE
  v_uid   UUID;
  v_from  TIMESTAMPTZ;
  v_old   NUMERIC;
  v_new   NUMERIC;
  v_bw    NUMERIC;
BEGIN
  SELECT user_id, min(created_at) INTO v_uid, v_from
    FROM public.workout_logs,
         jsonb_array_elements(COALESCE(exercises,'[]'::jsonb)) ex,
         jsonb_array_elements(COALESCE(ex->'sets','[]'::jsonb)) s
   WHERE public.bodyweight_load_factor(ex->>'name') > 0
   GROUP BY user_id LIMIT 1;

  IF v_uid IS NULL THEN
    CREATE TEMP TABLE gym_rival_bw_check ON COMMIT DROP AS
      SELECT (public.bodyweight_load_factor('Pull-Up') = 1.00) AS pullup_1,
             (public.bodyweight_load_factor('Push-Up') = 0.65) AS pushup_065,
             (public.bodyweight_load_factor('Plank')   = 0)    AS plank_0,
             (public.bodyweight_load_factor('Bench Press') = 0) AS barbell_0,
             NULL::boolean AS push_up_now_counts,
             'no bodyweight sets in the database' AS note;
    RETURN;
  END IF;

  SELECT weight_lbs INTO v_bw FROM public.user_profiles WHERE id = v_uid;

  -- The old expression, reproduced exactly, against the same window.
  SELECT COALESCE(SUM((s->>'weight')::numeric * (s->>'reps')::numeric), 0) INTO v_old
    FROM public.workout_logs,
         jsonb_array_elements(COALESCE(exercises,'[]'::jsonb)) ex,
         jsonb_array_elements(COALESCE(ex->'sets','[]'::jsonb)) s
   WHERE user_id = v_uid AND created_at >= v_from
     AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$' AND (s->>'reps') ~ '^[0-9]+$';

  v_new := public.gym_rival_volume_lbs(v_uid, v_from, NULL);

  CREATE TEMP TABLE gym_rival_bw_check ON COMMIT DROP AS
    SELECT (public.bodyweight_load_factor('Pull-Up') = 1.00) AS pullup_1,
           (public.bodyweight_load_factor('Push-Up') = 0.65) AS pushup_065,
           (public.bodyweight_load_factor('Plank')   = 0)    AS plank_0,
           (public.bodyweight_load_factor('Bench Press') = 0) AS barbell_0,
           -- With a bodyweight on file the total must RISE; without one it
           -- must be unchanged, which is the documented fallback rather than
           -- a failure.
           CASE WHEN COALESCE(v_bw,0) > 0 THEN v_new > v_old ELSE v_new = v_old END
             AS push_up_now_counts,
           'old ' || round(v_old) || ' lb, new ' || round(v_new)
             || ' lb, bodyweight ' || COALESCE(round(v_bw)::text, 'not on file') AS note;
END;
$$;

SELECT * FROM gym_rival_bw_check;
