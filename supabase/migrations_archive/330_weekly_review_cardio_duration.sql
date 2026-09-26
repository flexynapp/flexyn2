-- 330_weekly_review_cardio_duration.sql
--
-- Identical to 328's function except for ONE statement: the conditioning
-- block now reads cardio duration from duration_seconds when duration_min is
-- NULL. A plpgsql body cannot be patched in place, so the whole function is
-- restated — diff it against 328 and only the cardio SELECT moves.
--
-- WHY: cardio_logs.duration_min is NULL on 5 of 5 rows in production. The
-- cardio tracker writes duration_seconds. This is the same defect that made
-- volume read zero — a denormalised column every reader trusted and no writer
-- ever filled — found by sweeping the rest of the columns this RPC reads
-- after the volume fix landed, rather than waiting to be told.
--
-- The other columns in that sweep, for the record: workout_logs.duration_min
-- is NULL on 3 of 3 rows and has no other source for a lifting session, so
-- "under load" is dropped in the UI rather than faked here; sleep quality
-- (1 of 7) and soreness (0 of 7) are genuinely optional form fields; and
-- league_members.rank is NULL on all 42 rows because it is only written when
-- the league resolves — all three are handled client-side.

CREATE OR REPLACE FUNCTION public.generate_my_weekly_review(
  p_week_start DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $x$
DECLARE
  v_user_id        UUID := auth.uid();
  v_week_start     DATE;
  v_week_end       DATE;
  v_week_num       INT;
  v_year           INT;
  v_week_label     TEXT;

  -- training
  v_sessions       INT := 0;
  v_days_trained   INT := 0;
  v_day_flags      BOOLEAN[];
  v_volume         NUMERIC := 0;
  v_prev_volume    NUMERIC := 0;
  v_change_pct     INT;
  v_baseline       NUMERIC := 0;
  v_load_ratio     NUMERIC;
  v_sets           INT := 0;
  v_reps           INT := 0;
  v_duration       INT := 0;
  v_muscle_sets    JSONB := '{}'::JSONB;
  v_top_name       TEXT;
  v_top_weight     NUMERIC;
  v_top_reps       INT;
  v_top_is_pr      BOOLEAN := FALSE;
  v_all_time_max   NUMERIC := 0;
  v_pr_count       INT := 0;
  v_streak         INT := 0;

  -- conditioning
  v_cardio_n       INT := 0;
  v_cardio_dist    NUMERIC := 0;
  v_cardio_min     INT := 0;
  v_cardio_kcal    NUMERIC := 0;
  v_steps          INT := 0;
  v_steps_days     INT := 0;

  -- fuel
  v_fuel_days      INT := 0;
  v_kcal           NUMERIC := 0;
  v_protein        NUMERIC := 0;
  v_carbs          NUMERIC := 0;
  v_fat            NUMERIC := 0;
  v_prev_kcal      NUMERIC := 0;
  v_prev_protein   NUMERIC := 0;

  -- recovery
  v_sleep_nights   INT := 0;
  v_sleep_hours    NUMERIC;
  v_sleep_quality  NUMERIC;
  v_soreness       NUMERIC;
  v_mood_days      INT := 0;
  v_mood_avg       NUMERIC;
  v_weight_start   NUMERIC;
  v_weight_end     NUMERIC;

  -- game
  v_xp_earned      INT := 0;
  v_total_xp       INT := 0;
  v_level_end      INT := 1;
  v_level_start    INT := 1;
  v_quests_done    INT := 0;
  v_coins          INT := 0;
  v_trophies       TEXT[];

  -- people
  v_crew_name      TEXT;
  v_crew_msgs      INT := 0;
  v_duels_played   INT := 0;
  v_duels_won      INT := 0;
  v_league_tier    TEXT;
  v_league_rank    INT;
  v_league_xp      INT;
  v_league_days    INT;
  v_gym_days       INT := 0;

  -- goals
  v_goals_active   INT := 0;
  v_goals_done     INT := 0;

  v_insight        TEXT;
  v_data           JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  v_week_start := COALESCE(p_week_start, date_trunc('week', CURRENT_DATE)::DATE);
  v_week_end   := v_week_start + 6;
  v_week_num   := EXTRACT(week   FROM v_week_start)::INT;
  v_year       := EXTRACT(isoyear FROM v_week_start)::INT;
  v_week_label := 'Week ' || v_week_num || ', ' || v_year;

  -- ── Training: sessions, days, duration ───────────────────────────────────
  SELECT COUNT(*)::INT,
         COUNT(DISTINCT date)::INT,
         COALESCE(SUM(COALESCE(duration_min, 0)), 0)::INT
    INTO v_sessions, v_days_trained, v_duration
    FROM public.workout_logs
   WHERE user_id = v_user_id
     AND date BETWEEN v_week_start AND v_week_end;

  -- Seven booleans, Monday-first, for the day strip.
  SELECT ARRAY(
    SELECT EXISTS (
      SELECT 1 FROM public.workout_logs
       WHERE user_id = v_user_id
         AND date = v_week_start + offs
    )
    FROM generate_series(0, 6) AS offs
  ) INTO v_day_flags;

  -- ── Volume, sets, reps — DERIVED from the sets, never from total_volume.
  SELECT COALESCE(SUM(set_weight * set_reps), 0),
         COUNT(*)::INT,
         COALESCE(SUM(set_reps), 0)::INT
    INTO v_volume, v_sets, v_reps
    FROM (
      SELECT (s->>'weight')::NUMERIC AS set_weight,
             (s->>'reps')::NUMERIC   AS set_reps
        FROM public.workout_logs,
             jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
             jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
       WHERE user_id = v_user_id
         AND date BETWEEN v_week_start AND v_week_end
         AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
         AND (s->>'reps')   ~ '^[0-9]+(\.[0-9]+)?$'
    ) AS derived;

  -- Previous week + the four-week baseline behind it.
  SELECT COALESCE(SUM(set_weight * set_reps), 0)
    INTO v_prev_volume
    FROM (
      SELECT (s->>'weight')::NUMERIC AS set_weight,
             (s->>'reps')::NUMERIC   AS set_reps
        FROM public.workout_logs,
             jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
             jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
       WHERE user_id = v_user_id
         AND date BETWEEN (v_week_start - 7) AND (v_week_start - 1)
         AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
         AND (s->>'reps')   ~ '^[0-9]+(\.[0-9]+)?$'
    ) AS derived_prev;

  SELECT COALESCE(SUM(set_weight * set_reps), 0) / 4.0
    INTO v_baseline
    FROM (
      SELECT (s->>'weight')::NUMERIC AS set_weight,
             (s->>'reps')::NUMERIC   AS set_reps
        FROM public.workout_logs,
             jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
             jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
       WHERE user_id = v_user_id
         AND date BETWEEN (v_week_start - 28) AND (v_week_start - 1)
         AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
         AND (s->>'reps')   ~ '^[0-9]+(\.[0-9]+)?$'
    ) AS derived_base;

  IF v_prev_volume > 0 THEN
    v_change_pct := ROUND(((v_volume - v_prev_volume) / v_prev_volume) * 100)::INT;
  END IF;
  IF v_baseline > 0 THEN
    v_load_ratio := ROUND((v_volume / v_baseline)::NUMERIC, 2);
  END IF;

  -- ── Sets per muscle group. Counts a set once per group the exercise
  --    names, so a compound credits every group it actually trains.
  -- jsonb_array_elements_text is set-returning, so it has to be a LATERAL
  -- FROM item — Postgres rejects it inside COALESCE in the select list.
  SELECT COALESCE(jsonb_object_agg(grp, n), '{}'::JSONB)
    INTO v_muscle_sets
    FROM (
      SELECT COALESCE(NULLIF(grp_raw, ''), 'Other') AS grp, COUNT(*)::INT AS n
        FROM public.workout_logs,
             jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
             jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s,
             LATERAL jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(ex->'muscle_groups') = 'array'
                      AND jsonb_array_length(ex->'muscle_groups') > 0
                    THEN ex->'muscle_groups'
                    ELSE jsonb_build_array(COALESCE(ex->>'muscle_group', 'Other'))
               END) AS grp_raw
       WHERE user_id = v_user_id
         AND date BETWEEN v_week_start AND v_week_end
       GROUP BY COALESCE(NULLIF(grp_raw, ''), 'Other')
    ) AS per_group;

  -- ── Top lift this week, and whether it beat the all-time best.
  SELECT lift_name, lift_weight, lift_reps
    INTO v_top_name, v_top_weight, v_top_reps
    FROM (
      SELECT (ex->>'name')           AS lift_name,
             (s->>'weight')::NUMERIC AS lift_weight,
             (s->>'reps')::INT       AS lift_reps
        FROM public.workout_logs,
             jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
             jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
       WHERE user_id = v_user_id
         AND date BETWEEN v_week_start AND v_week_end
         AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
         AND (s->>'reps')   ~ '^[0-9]+$'
         AND (s->>'weight')::NUMERIC > 0
         AND (s->>'reps')::INT > 0
    ) AS lifts
   ORDER BY lift_weight DESC
   LIMIT 1;

  IF v_top_name IS NOT NULL THEN
    SELECT COALESCE(MAX((s->>'weight')::NUMERIC), 0)
      INTO v_all_time_max
      FROM public.workout_logs,
           jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
           jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
     WHERE user_id = v_user_id
       AND date < v_week_start
       AND lower(ex->>'name') = lower(v_top_name)
       AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$';
    v_top_is_pr := (v_top_weight > v_all_time_max);
  END IF;

  -- How many distinct exercises set a new all-time best this week.
  SELECT COUNT(*)::INT INTO v_pr_count
    FROM (
      SELECT lower(ex->>'name') AS lift_key,
             MAX((s->>'weight')::NUMERIC) AS best_now
        FROM public.workout_logs,
             jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
             jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
       WHERE user_id = v_user_id
         AND date BETWEEN v_week_start AND v_week_end
         AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
         AND (s->>'weight')::NUMERIC > 0
       GROUP BY lower(ex->>'name')
    ) AS this_week
   WHERE best_now > COALESCE((
     SELECT MAX((s2->>'weight')::NUMERIC)
       FROM public.workout_logs,
            jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex2,
            jsonb_array_elements(COALESCE(ex2->'sets', '[]'::jsonb)) AS s2
      WHERE user_id = v_user_id
        AND date < v_week_start
        AND lower(ex2->>'name') = lift_key
        AND (s2->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
   ), 0);

  -- ── Streak (consecutive training days ending in or before this week).
  WITH asc_dates AS (
    SELECT DISTINCT date AS d FROM public.workout_logs
     WHERE user_id = v_user_id AND date <= v_week_end
  ),
  gapped AS (
    SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d ASC))::INTEGER AS grp FROM asc_dates
  ),
  runs AS (
    SELECT grp, MAX(d) AS last_d, COUNT(*)::INT AS len FROM gapped GROUP BY grp
  )
  SELECT COALESCE((
    SELECT len FROM runs
     WHERE last_d = (SELECT MAX(d) FROM asc_dates) LIMIT 1
  ), 0) INTO v_streak;

  -- ── Conditioning ─────────────────────────────────────────────────────────
  -- duration_min is NULL on 5 of 5 production cardio_logs rows — the cardio
  -- tracker writes duration_seconds and nothing has ever written the minutes
  -- column. Same defect as workout_logs.total_volume: a denormalised column
  -- that every reader trusted and no writer filled. Prefer it when set, fall
  -- back to the seconds the app actually records.
  SELECT COUNT(*)::INT,
         COALESCE(SUM(COALESCE(distance_meters, 0)), 0),
         COALESCE(SUM(COALESCE(duration_min, ROUND(duration_seconds / 60.0), 0)), 0)::INT,
         COALESCE(SUM(COALESCE(calories, 0)), 0)
    INTO v_cardio_n, v_cardio_dist, v_cardio_min, v_cardio_kcal
    FROM public.cardio_logs
   WHERE user_id = v_user_id
     AND date BETWEEN v_week_start AND v_week_end;

  SELECT COALESCE(SUM(COALESCE(steps, 0)), 0)::INT, COUNT(*)::INT
    INTO v_steps, v_steps_days
    FROM public.step_logs
   WHERE user_id = v_user_id
     AND date BETWEEN v_week_start AND v_week_end;

  -- ── Fuel. Averages are PER LOGGED DAY, not per seven — a 3-day week
  --    should report what those 3 days looked like, not a diluted number
  --    that makes honest logging look like undereating.
  SELECT COUNT(DISTINCT date)::INT INTO v_fuel_days
    FROM public.nutrition_logs
   WHERE user_id = v_user_id AND date BETWEEN v_week_start AND v_week_end;

  IF v_fuel_days > 0 THEN
    SELECT ROUND(COALESCE(SUM(COALESCE(calories, 0)), 0) / v_fuel_days),
           ROUND(COALESCE(SUM(COALESCE(protein,  0)), 0) / v_fuel_days),
           ROUND(COALESCE(SUM(COALESCE(carbs,    0)), 0) / v_fuel_days),
           ROUND(COALESCE(SUM(COALESCE(fat,      0)), 0) / v_fuel_days)
      INTO v_kcal, v_protein, v_carbs, v_fat
      FROM public.nutrition_logs
     WHERE user_id = v_user_id AND date BETWEEN v_week_start AND v_week_end;
  END IF;

  SELECT COALESCE(ROUND(AVG(day_kcal)), 0), COALESCE(ROUND(AVG(day_protein)), 0)
    INTO v_prev_kcal, v_prev_protein
    FROM (
      SELECT date,
             SUM(COALESCE(calories, 0)) AS day_kcal,
             SUM(COALESCE(protein,  0)) AS day_protein
        FROM public.nutrition_logs
       WHERE user_id = v_user_id
         AND date BETWEEN (v_week_start - 7) AND (v_week_start - 1)
       GROUP BY date
    ) AS prev_days;

  -- ── Recovery ─────────────────────────────────────────────────────────────
  SELECT COUNT(*)::INT,
         ROUND(AVG(hours)::NUMERIC, 1),
         ROUND(AVG(quality)::NUMERIC, 1),
         ROUND(AVG(soreness)::NUMERIC, 1)
    INTO v_sleep_nights, v_sleep_hours, v_sleep_quality, v_soreness
    FROM public.sleep_logs
   WHERE user_id = v_user_id AND date BETWEEN v_week_start AND v_week_end;

  SELECT COUNT(*)::INT, ROUND(AVG(mood)::NUMERIC, 1)
    INTO v_mood_days, v_mood_avg
    FROM public.mood_logs
   WHERE user_id = v_user_id AND date BETWEEN v_week_start AND v_week_end;

  SELECT weight_lbs INTO v_weight_start
    FROM public.body_metrics
   WHERE user_id = v_user_id AND date <= v_week_start AND weight_lbs IS NOT NULL
   ORDER BY date DESC LIMIT 1;

  SELECT weight_lbs INTO v_weight_end
    FROM public.body_metrics
   WHERE user_id = v_user_id AND date <= v_week_end AND weight_lbs IS NOT NULL
   ORDER BY date DESC LIMIT 1;

  -- ── The game layer. XP comes from the LEDGER (mig 188), never a formula.
  SELECT COALESCE(SUM(amount), 0)::INT INTO v_xp_earned
    FROM public.xp_grant_log
   WHERE user_id = v_user_id
     AND granted_at >= v_week_start::TIMESTAMPTZ
     AND granted_at <  (v_week_end + 1)::TIMESTAMPTZ;

  SELECT COALESCE(total_xp, 0), COALESCE(current_level, 1), league_tier
    INTO v_total_xp, v_level_end, v_league_tier
    FROM public.user_profiles WHERE id = v_user_id;

  -- Level at the start of the week = highest threshold cleared by the XP
  -- the user held before this week's grants landed.
  SELECT COALESCE(MAX(level), 1) INTO v_level_start
    FROM public.xp_level_thresholds
   WHERE total_xp_required <= GREATEST(0, v_total_xp - v_xp_earned);

  SELECT COUNT(*)::INT INTO v_quests_done
    FROM public.user_daily_quests
   WHERE user_id = v_user_id
     AND quest_date BETWEEN v_week_start AND v_week_end
     AND completed_at IS NOT NULL;

  SELECT COALESCE(SUM(delta), 0)::INT INTO v_coins
    FROM public.flex_coin_ledger
   WHERE user_id = v_user_id
     AND delta > 0
     AND created_at >= v_week_start::TIMESTAMPTZ
     AND created_at <  (v_week_end + 1)::TIMESTAMPTZ;

  SELECT ARRAY_AGG(trophy_id) INTO v_trophies
    FROM public.user_trophies
   WHERE user_id = v_user_id
     AND earned_at >= v_week_start::TIMESTAMPTZ
     AND earned_at <  (v_week_end + 1)::TIMESTAMPTZ;

  -- ── People ───────────────────────────────────────────────────────────────
  SELECT name INTO v_crew_name
    FROM public.crews
   WHERE id = (SELECT crew_id FROM public.crew_members WHERE user_id = v_user_id LIMIT 1);

  SELECT COUNT(*)::INT INTO v_crew_msgs
    FROM public.crew_messages
   WHERE sender_id = v_user_id
     AND created_at >= v_week_start::TIMESTAMPTZ
     AND created_at <  (v_week_end + 1)::TIMESTAMPTZ;

  SELECT COUNT(*)::INT,
         COUNT(*) FILTER (WHERE winner_id = v_user_id)::INT
    INTO v_duels_played, v_duels_won
    FROM public.duels
   WHERE (challenger_id = v_user_id OR opponent_id = v_user_id)
     AND created_at >= v_week_start::TIMESTAMPTZ
     AND created_at <  (v_week_end + 1)::TIMESTAMPTZ;

  SELECT rank, weekly_xp, active_days
    INTO v_league_rank, v_league_xp, v_league_days
    FROM public.league_members
   WHERE user_id = v_user_id
     AND league_id IN (SELECT id FROM public.leagues WHERE week_start = v_week_start)
   LIMIT 1;

  SELECT COUNT(DISTINCT checkin_date)::INT INTO v_gym_days
    FROM public.gym_checkins
   WHERE user_id = v_user_id
     AND checkin_date BETWEEN v_week_start AND v_week_end;

  -- ── Goals ────────────────────────────────────────────────────────────────
  SELECT COUNT(*) FILTER (WHERE status = 'active')::INT,
         COUNT(*) FILTER (
           WHERE completed_at >= v_week_start::TIMESTAMPTZ
             AND completed_at <  (v_week_end + 1)::TIMESTAMPTZ
         )::INT
    INTO v_goals_active, v_goals_done
    FROM public.goals
   WHERE user_id = v_user_id;

  -- ── Insight. One sentence, and it must name something specific from the
  --    week — a generic line is decoration, and decoration trains people to
  --    stop reading it.
  v_insight := CASE
    WHEN v_sessions = 0 AND v_fuel_days = 0 AND v_cardio_n = 0
      THEN 'Nothing logged this week. The next one starts with a single set.'
    WHEN v_sessions = 0 AND (v_fuel_days > 0 OR v_cardio_n > 0)
      THEN 'No lifting this week, but you kept logging. That habit is what makes the return easy.'
    WHEN v_pr_count > 1
      THEN v_pr_count || ' personal records this week. That is not a good day — that is a training block working.'
    WHEN v_top_is_pr AND v_top_name IS NOT NULL
      THEN 'New PR on ' || v_top_name || '. Accumulated work, paid out.'
    WHEN v_load_ratio IS NOT NULL AND v_load_ratio >= 1.5
      THEN 'Volume ran ' || ROUND(v_load_ratio, 1) || '× your four-week normal. Worth watching sleep and soreness before you repeat it.'
    WHEN v_load_ratio IS NOT NULL AND v_load_ratio <= 0.6 AND v_sessions > 0
      THEN 'A lighter week than your recent normal. Deload or life — either way the baseline is still there.'
    WHEN v_days_trained >= 5
      THEN v_days_trained || ' training days. That is the top of the consistency curve.'
    WHEN v_sleep_hours IS NOT NULL AND v_sleep_hours < 6.5 AND v_sessions >= 3
      THEN 'You trained ' || v_sessions || ' times on ' || v_sleep_hours || 'h average sleep. Recovery is the ceiling on the next block.'
    WHEN v_protein > 0 AND v_sessions >= 3
      THEN v_sessions || ' sessions and ' || ROUND(v_protein) || 'g protein a day. The training and the fuel are pointing the same way.'
    WHEN v_sessions > 0
      THEN v_sessions || ' session' || CASE WHEN v_sessions = 1 THEN '' ELSE 's' END || ' logged. The trend is what matters — keep stacking.'
    ELSE 'Every rep logged is a data point. Keep stacking.'
  END;

  -- ── Payload ──────────────────────────────────────────────────────────────
  v_data := jsonb_build_object(
    'schema_version', 2,
    'week_start', v_week_start::TEXT,
    'week_end',   v_week_end::TEXT,

    -- v1 keys, preserved verbatim for Progress.jsx and the legacy card.
    'volume_lbs',            v_volume,
    'volume_prev_lbs',       v_prev_volume,
    'volume_change_pct',     v_change_pct,
    'workouts_count',        v_sessions,
    'workout_streak',        v_streak,
    'top_lift_name',         v_top_name,
    'top_lift_weight',       v_top_weight,
    'top_lift_reps',         v_top_reps,
    'top_lift_is_pr',        v_top_is_pr,
    'muscle_groups_trained', COALESCE((SELECT ARRAY_AGG(k) FROM jsonb_object_keys(v_muscle_sets) AS k), ARRAY[]::TEXT[]),
    'macro_days_tracked',    v_fuel_days,
    'macro_adherence_pct',   LEAST(ROUND(v_fuel_days::NUMERIC / 7 * 100)::INT, 100),
    'xp_earned',             v_xp_earned,
    'total_xp_end',          v_total_xp,
    'level_start',           v_level_start,
    'level_end',             v_level_end,
    'ai_insight',            v_insight,

    'training', jsonb_build_object(
      'sessions',      v_sessions,
      'days_trained',  v_days_trained,
      'day_flags',     COALESCE(to_jsonb(v_day_flags), '[]'::jsonb),
      'volume_lbs',    v_volume,
      'prev_lbs',      v_prev_volume,
      'change_pct',    v_change_pct,
      'baseline_lbs',  ROUND(v_baseline),
      'load_ratio',    v_load_ratio,
      'sets',          v_sets,
      'reps',          v_reps,
      'duration_min',  v_duration,
      'muscle_sets',   v_muscle_sets,
      'pr_count',      v_pr_count,
      'streak',        v_streak,
      'top_lift',      jsonb_build_object(
        'name', v_top_name, 'weight', v_top_weight,
        'reps', v_top_reps, 'is_pr', v_top_is_pr)
    ),
    'conditioning', jsonb_build_object(
      'sessions',     v_cardio_n,
      'distance_m',   v_cardio_dist,
      'duration_min', v_cardio_min,
      'calories',     ROUND(v_cardio_kcal),
      'steps',        v_steps,
      'steps_days',   v_steps_days
    ),
    'fuel', jsonb_build_object(
      'days_logged',  v_fuel_days,
      'avg_calories', v_kcal,
      'avg_protein',  v_protein,
      'avg_carbs',    v_carbs,
      'avg_fat',      v_fat,
      'prev_calories',v_prev_kcal,
      'prev_protein', v_prev_protein
    ),
    'recovery', jsonb_build_object(
      'sleep_nights',  v_sleep_nights,
      'sleep_hours',   v_sleep_hours,
      'sleep_quality', v_sleep_quality,
      'soreness',      v_soreness,
      'mood_days',     v_mood_days,
      'mood_avg',      v_mood_avg,
      'weight_start',  v_weight_start,
      'weight_end',    v_weight_end,
      'weight_change', CASE WHEN v_weight_start IS NOT NULL AND v_weight_end IS NOT NULL
                            THEN ROUND(v_weight_end - v_weight_start, 1) END
    ),
    'game', jsonb_build_object(
      'xp_earned',   v_xp_earned,
      'total_xp',    v_total_xp,
      'level_start', v_level_start,
      'level_end',   v_level_end,
      'quests_done', v_quests_done,
      'coins',       v_coins,
      'trophies',    COALESCE(to_jsonb(v_trophies), '[]'::jsonb),
      'trophy_count',COALESCE(array_length(v_trophies, 1), 0)
    ),
    'people', jsonb_build_object(
      'crew_name',     v_crew_name,
      'crew_messages', v_crew_msgs,
      'duels_played',  v_duels_played,
      'duels_won',     v_duels_won,
      'league_tier',   v_league_tier,
      'league_rank',   v_league_rank,
      'league_xp',     v_league_xp,
      'league_days',   v_league_days,
      'gym_days',      v_gym_days
    ),
    'goals', jsonb_build_object(
      'active',    v_goals_active,
      'completed', v_goals_done
    )
  );

  -- A week in which the user did NOTHING gets no row. v1 inserted
  -- unconditionally, and because the vault auto-generated the previous week
  -- on every open, it manufactured "Week 31 · 0 lbs · 0 sessions · +0 XP"
  -- cards for weeks the user had simply not used the app. An empty review is
  -- not a record of a rest week — it is the app inventing a failure and
  -- filing it under the user's name. We still REFRESH an existing row (the
  -- user may have deleted logs, and the row must follow), so this only
  -- suppresses creation.
  IF v_sessions = 0 AND v_cardio_n = 0 AND v_steps_days = 0 AND v_fuel_days = 0
     AND v_sleep_nights = 0 AND v_mood_days = 0 AND v_xp_earned = 0
     AND NOT EXISTS (
       SELECT 1 FROM public.weekly_debriefs
        WHERE user_id = v_user_id AND week_number = v_week_num AND year = v_year
     )
  THEN
    RETURN jsonb_build_object(
      'week_start', v_week_start, 'week_label', v_week_label,
      'week_number', v_week_num, 'year', v_year,
      'skipped', TRUE, 'reason', 'no_activity'
    );
  END IF;

  INSERT INTO public.weekly_debriefs (user_id, week_number, year, week_label, data)
  VALUES (v_user_id, v_week_num, v_year, v_week_label, v_data)
  ON CONFLICT (user_id, week_number, year) DO UPDATE
    SET week_label = EXCLUDED.week_label,
        data       = EXCLUDED.data;

  RETURN jsonb_build_object(
    'week_start',  v_week_start,
    'week_label',  v_week_label,
    'week_number', v_week_num,
    'year',        v_year,
    'data',        v_data
  );
END;
$x$;

-- The v1 name stays as a thin forwarder: Progress.jsx, the vault and the
-- Edge Function all call it, and they deploy independently of this file.
CREATE OR REPLACE FUNCTION public.generate_my_weekly_debrief(
  p_week_start DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $y$
  SELECT public.generate_my_weekly_review(p_week_start);
$y$;

-- Both are user-facing RPCs invoked from the client with the caller's JWT,
-- so `authenticated` keeps EXECUTE. `anon` must not: they derive the user
-- from auth.uid() and would raise not_authenticated, but an anon-callable
-- SECURITY DEFINER endpoint is exactly the shape mig 276 warned about.
REVOKE ALL ON FUNCTION public.generate_my_weekly_review(DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_my_weekly_debrief(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_my_weekly_review(DATE)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_my_weekly_debrief(DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
