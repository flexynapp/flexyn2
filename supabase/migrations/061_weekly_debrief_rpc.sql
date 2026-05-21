-- 061_weekly_debrief_rpc.sql
-- generate_my_weekly_debrief: SECURITY DEFINER RPC that computes and upserts
-- a user's weekly debrief from workout_logs + nutrition_logs.
-- Replaces the placeholder Edge Function approach.

ALTER TABLE public.weekly_debriefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_debriefs_own" ON public.weekly_debriefs;
CREATE POLICY "weekly_debriefs_own" ON public.weekly_debriefs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.generate_my_weekly_debrief(
  p_week_start DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $x$
DECLARE
  v_user_id         UUID := auth.uid();
  v_week_start      DATE;
  v_week_end        DATE;
  v_week_num        INT;
  v_year            INT;
  v_week_label      TEXT;
  v_workouts_count  INT;
  v_volume_lbs      NUMERIC;
  v_prev_volume     NUMERIC;
  v_change_pct      INT;
  v_top_lift_name   TEXT;
  v_top_lift_weight NUMERIC;
  v_top_lift_reps   INT;
  v_top_lift_is_pr  BOOLEAN := FALSE;
  v_all_time_max    NUMERIC := 0;
  v_streak          INT := 0;
  v_muscles         TEXT[];
  v_nutrition_days  INT := 0;
  v_macro_pct       INT := 0;
  v_xp_earned       INT := 0;
  v_insight         TEXT;
  v_data            JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  v_week_start := COALESCE(p_week_start, date_trunc('week', CURRENT_DATE)::DATE);
  v_week_end   := v_week_start + 6;
  v_week_num   := EXTRACT(week FROM v_week_start)::INT;
  v_year       := EXTRACT(year FROM v_week_start)::INT;
  v_week_label := 'Week ' || v_week_num || ', ' || v_year;

  -- Workout stats
  SELECT
    COALESCE(COUNT(*), 0)::INT,
    COALESCE(SUM(COALESCE(total_volume, 0)), 0)
  INTO v_workouts_count, v_volume_lbs
  FROM public.workout_logs
  WHERE user_id = v_user_id
    AND date BETWEEN v_week_start AND v_week_end;

  SELECT COALESCE(SUM(COALESCE(total_volume, 0)), 0)
  INTO v_prev_volume
  FROM public.workout_logs
  WHERE user_id = v_user_id
    AND date BETWEEN (v_week_start - 7) AND (v_week_start - 1);

  IF v_prev_volume > 0 THEN
    v_change_pct := ROUND(((v_volume_lbs - v_prev_volume) / v_prev_volume) * 100)::INT;
  END IF;

  -- Top lift (heaviest single set this week)
  SELECT sub.ex_name, sub.ex_weight, sub.ex_reps
  INTO v_top_lift_name, v_top_lift_weight, v_top_lift_reps
  FROM (
    SELECT
      (ex->>'name')           AS ex_name,
      (s->>'weight')::NUMERIC AS ex_weight,
      (s->>'reps')::INT       AS ex_reps
    FROM public.workout_logs wl,
         jsonb_array_elements(COALESCE(wl.exercises, '[]'::jsonb)) AS ex,
         jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb))   AS s
    WHERE wl.user_id = v_user_id
      AND wl.date BETWEEN v_week_start AND v_week_end
      AND (s->>'weight') IS NOT NULL AND (s->>'weight') <> ''
      AND (s->>'reps')   IS NOT NULL AND (s->>'reps')   <> ''
      AND (s->>'weight')::NUMERIC > 0
      AND (s->>'reps')::INT       > 0
  ) sub
  ORDER BY sub.ex_weight DESC LIMIT 1;

  -- PR check
  IF v_top_lift_name IS NOT NULL THEN
    SELECT COALESCE(MAX((s->>'weight')::NUMERIC), 0)
    INTO v_all_time_max
    FROM public.workout_logs wl,
         jsonb_array_elements(COALESCE(wl.exercises, '[]'::jsonb)) AS ex,
         jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb))   AS s
    WHERE wl.user_id = v_user_id
      AND wl.date < v_week_start
      AND lower(ex->>'name') = lower(v_top_lift_name)
      AND (s->>'weight') IS NOT NULL AND (s->>'weight') <> ''
      AND (s->>'weight')::NUMERIC > 0;
    v_top_lift_is_pr := (v_top_lift_weight > v_all_time_max);
  END IF;

  -- Muscle groups trained this week
  SELECT ARRAY_AGG(DISTINCT mg)
  INTO v_muscles
  FROM (
    SELECT ex->>'muscle_group' AS mg
    FROM public.workout_logs wl,
         jsonb_array_elements(COALESCE(wl.exercises, '[]'::jsonb)) AS ex
    WHERE wl.user_id = v_user_id
      AND wl.date BETWEEN v_week_start AND v_week_end
      AND (ex->>'muscle_group') IS NOT NULL AND (ex->>'muscle_group') <> ''
  ) sub;

  -- Streak (consecutive days, most-recent run)
  WITH asc_dates AS (
    SELECT DISTINCT date FROM public.workout_logs
    WHERE user_id = v_user_id AND date <= v_week_end
  ),
  gapped AS (
    SELECT date, date - (ROW_NUMBER() OVER (ORDER BY date ASC))::INTEGER AS grp
    FROM asc_dates
  ),
  groups AS (
    SELECT grp, MAX(date) AS last_d, COUNT(*)::INT AS len FROM gapped GROUP BY grp
  )
  SELECT COALESCE((
    SELECT len FROM groups
    WHERE last_d = (SELECT MAX(date) FROM asc_dates) LIMIT 1
  ), 0) INTO v_streak;

  -- Nutrition days tracked
  SELECT COUNT(DISTINCT date)::INT INTO v_nutrition_days
  FROM public.nutrition_logs
  WHERE user_id = v_user_id AND date BETWEEN v_week_start AND v_week_end;

  v_macro_pct := LEAST(ROUND(v_nutrition_days::NUMERIC / 7 * 100)::INT, 100);
  v_xp_earned := GREATEST(0, ROUND(v_volume_lbs / 15 + v_workouts_count * 50)::INT);

  -- Insight
  v_insight := CASE
    WHEN v_workouts_count = 0
      THEN 'Rest week logged. Recovery is where the gains happen.'
    WHEN v_top_lift_is_pr AND v_top_lift_name IS NOT NULL
      THEN 'New PR on ' || v_top_lift_name || '. That isn''t luck — that''s accumulated work paying off.'
    WHEN v_change_pct IS NOT NULL AND v_change_pct >= 20
      THEN 'Volume up ' || v_change_pct || '% from last week. The adaptation curve is real.'
    WHEN v_change_pct IS NOT NULL AND v_change_pct <= -15
      THEN 'Lighter week than usual. Planned deload or life got in the way — either way, come back fresh.'
    WHEN v_workouts_count >= 5
      THEN v_workouts_count || ' sessions this week. That''s elite-tier consistency.'
    WHEN v_streak >= 7
      THEN v_streak || '-day streak. At this point it''s a habit, not a decision.'
    WHEN v_nutrition_days >= 5
      THEN 'Nutrition tracked ' || v_nutrition_days || ' days. What gets measured gets managed.'
    ELSE 'Every rep logged is a data point. The trend is what matters — keep stacking.'
  END;

  v_data := jsonb_build_object(
    'volume_lbs',            v_volume_lbs,
    'volume_change_pct',     v_change_pct,
    'workouts_count',        v_workouts_count,
    'top_lift_name',         v_top_lift_name,
    'top_lift_weight',       v_top_lift_weight,
    'top_lift_reps',         v_top_lift_reps,
    'top_lift_is_pr',        v_top_lift_is_pr,
    'workout_streak',        v_streak,
    'muscle_groups_trained', COALESCE(v_muscles, ARRAY[]::TEXT[]),
    'macro_adherence_pct',   v_macro_pct,
    'macro_days_tracked',    v_nutrition_days,
    'xp_earned',             v_xp_earned,
    'ai_insight',            v_insight,
    'week_start',            v_week_start::TEXT,
    'week_end',              v_week_end::TEXT
  );

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
