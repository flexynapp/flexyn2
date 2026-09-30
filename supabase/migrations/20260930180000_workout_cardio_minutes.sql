-- A run logged inside a workout is paid once, as a run.
--
-- Until now a cardio entry in a workout (kind 'cardio', its time in
-- `segments`) was thrown away on save, so production holds none. The app now
-- keeps the entry in the workout AND saves it as its own cardio_logs row,
-- which grant_cardio_xp scores like any other run and which running goals
-- and lifetime distance read.
--
-- The one place that would count the run twice is the workout's duration
-- bonus: workout_xp_for pays 4 XP per 10 minutes of the session, and the
-- session's minutes include the run that grant_cardio_xp already paid for.
-- So the bonus now leaves out the minutes the workout's own cardio entries
-- record. Sets pay exactly as before; a cardio entry has no sets.
--
-- Rows without cardio entries (every row in production today) score the
-- same as before. Understating a run's time only raises the workout's
-- bonus back to what it was, never above it.
--
-- The installed body (pg_get_functiondef, 2026-09-30) plus the cardio
-- minutes; nothing else changed.

CREATE OR REPLACE FUNCTION public.workout_xp_for(p_exercises jsonb, p_duration_min numeric)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_ex     jsonb;
  v_set    jsonb;
  v_seg    jsonb;
  v_w      numeric;
  v_r      numeric;
  v_rep_xp numeric := 0;
  v_volume numeric := 0;
  v_sets   integer := 0;
  v_mult   numeric;
  v_cardio numeric := 0;
  v_dur    numeric := LEAST(GREATEST(COALESCE(p_duration_min, 0), 0), 600);
BEGIN
  IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array'
     OR jsonb_array_length(p_exercises) = 0 THEN
    RETURN 0;
  END IF;
  FOR v_ex IN SELECT * FROM jsonb_array_elements(p_exercises) LOOP
    -- Minutes a cardio entry records are paid by grant_cardio_xp.
    IF v_ex->>'kind' = 'cardio' AND jsonb_typeof(v_ex->'segments') = 'array' THEN
      FOR v_seg IN SELECT * FROM jsonb_array_elements(v_ex->'segments') LOOP
        v_cardio := v_cardio + GREATEST(public.xp_safe_num(v_seg->>'duration_s'), 0) / 60.0;
      END LOOP;
    END IF;
    IF jsonb_typeof(v_ex->'sets') <> 'array' THEN CONTINUE; END IF;
    FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
      v_sets := v_sets + 1;
      v_w := public.xp_safe_num(v_set->>'weight');
      v_r := public.xp_safe_num(v_set->>'reps');
      v_volume := v_volume + v_w * v_r;
      IF v_w > 0 AND v_r > 0 THEN
        v_mult := CASE
          WHEN v_w < 25  THEN 0.6
          WHEN v_w < 50  THEN 0.8
          WHEN v_w < 95  THEN 1.0
          WHEN v_w < 135 THEN 1.3
          WHEN v_w < 185 THEN 1.7
          WHEN v_w < 225 THEN 2.1
          WHEN v_w < 275 THEN 2.6
          ELSE 3.2
        END;
        v_rep_xp := v_rep_xp + v_r * v_mult * 0.7;
      ELSIF v_r > 0 THEN
        v_rep_xp := v_rep_xp + LEAST(v_r * 0.5, 20);
      END IF;
    END LOOP;
  END LOOP;
  v_dur := GREATEST(v_dur - v_cardio, 0);
  RETURN LEAST(round(v_sets * 12 + v_rep_xp + floor(GREATEST(v_volume, 0) / 400)
                     + floor(v_dur / 10) * 4)::integer, 1000);
END;
$function$;

-- ── Check it, both directions ───────────────────────────────────────────
-- A lifting session scores as before; the same 60 minute session with a
-- 30 minute run inside it loses exactly the run's duration bonus (12 XP);
-- a run-only workout of 30 minutes earns nothing from the workout side.
DO $check$
DECLARE
  v_lift  jsonb := '[{"name":"Bench Press","sets":[{"weight":135,"reps":5}]}]';
  v_run   jsonb := '[{"kind":"cardio","activity":"running","sets":[],"segments":[{"duration_s":1800,"distance_m":5000}]}]';
  a int; b int; c int;
BEGIN
  a := public.workout_xp_for(v_lift, 60);
  b := public.workout_xp_for(v_lift || v_run, 60);
  c := public.workout_xp_for(v_run, 30);
  IF a <> 12 + round(5 * 1.7 * 0.7) + floor(675 / 400.0) + 24 THEN
    RAISE EXCEPTION 'workout_cardio_minutes: lifting session changed (%)', a;
  END IF;
  IF a - b <> 12 THEN
    RAISE EXCEPTION 'workout_cardio_minutes: run minutes not taken out (% vs %)', a, b;
  END IF;
  IF c <> 0 THEN
    RAISE EXCEPTION 'workout_cardio_minutes: run-only workout paid % from the workout side', c;
  END IF;
END
$check$;
