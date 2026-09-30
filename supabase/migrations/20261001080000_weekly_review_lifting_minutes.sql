-- The weekly review's lifting time leaves out runs logged inside a workout.
--
-- Since 20260930170000 a run logged inside a workout is kept in the workout
-- AND saved as its own cardio_logs row. generate_weekly_review_for sums
-- workout_logs.duration_min into training.duration_min, which the review
-- shows as time "under load", and sums cardio_logs into
-- conditioning.duration_min. So a 30 minute run-only workout read as
-- "30 min under load" as well as "30 min moving".
--
-- training.duration_min now subtracts each workout's cardio entry minutes
-- (segments[].duration_s), the same minutes workout_xp_for already leaves
-- out of the workout's duration bonus. Rows with no cardio entries (every
-- row written before today) sum exactly as before. Nothing else in the
-- function changes.
--
-- The function is ~400 lines, so rather than restating it (and risking a
-- stale copy, the failure CLAUDE.md warns about) this reads the INSTALLED
-- body, replaces the one expression, and refuses to continue if that
-- expression is not found exactly once.

DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.generate_weekly_review_for(uuid,date)'::regprocedure);
  v_old text := 'COALESCE(SUM(COALESCE(duration_min, 0)), 0)::INT';
  v_new text := $new$COALESCE(SUM(GREATEST(COALESCE(duration_min, 0) - COALESCE((
             SELECT SUM(GREATEST(public.xp_safe_num(seg->>'duration_s'), 0)) / 60.0
               FROM jsonb_array_elements(
                      CASE WHEN jsonb_typeof(exercises) = 'array' THEN exercises ELSE '[]'::jsonb END) AS cx,
                    jsonb_array_elements(
                      CASE WHEN cx->>'kind' = 'cardio' AND jsonb_typeof(cx->'segments') = 'array'
                           THEN cx->'segments' ELSE '[]'::jsonb END) AS seg), 0), 0)), 0)::INT$new$;
  v_hits int;
BEGIN
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'weekly_review_lifting_minutes: expected the duration sum once, found %', v_hits;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch$;

REVOKE ALL ON FUNCTION public.generate_weekly_review_for(uuid, date) FROM PUBLIC, anon, authenticated;

-- ── Check it, both directions, rolled back ──────────────────────────────
-- A 60 minute lifting session reads 60 minutes under load. A 60 minute
-- session holding a 30 minute run reads 30. A run-only workout reads 0.
DO $check$
DECLARE
  v_uid  uuid;
  v_week date := DATE '2000-01-03';  -- a Monday no real account has data in
  v_res  jsonb;
BEGIN
  SELECT id INTO v_uid FROM auth.users LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'weekly_review_lifting_minutes check skipped: no users';
    RETURN;
  END IF;

  BEGIN
    -- The seeded rows only need to exist for the review to read them. Keep
    -- duel, rival, referral and credit triggers out of it; the whole block
    -- rolls back, which restores them.
    ALTER TABLE public.workout_logs DISABLE TRIGGER USER;
    INSERT INTO public.workout_logs (user_id, created_by, date, duration_min, exercises)
    VALUES
      (v_uid, 'migration-check', v_week, 60,
       '[{"name":"Bench Press","sets":[{"weight":135,"reps":5}]}]'),
      (v_uid, 'migration-check', v_week + 1, 60,
       '[{"name":"Bench Press","sets":[{"weight":135,"reps":5}]},
         {"kind":"cardio","activity":"running","sets":[],"segments":[{"duration_s":1800,"distance_m":5000}]}]'),
      (v_uid, 'migration-check', v_week + 2, 30,
       '[{"kind":"cardio","activity":"running","sets":[],"segments":[{"duration_s":1800,"distance_m":5000}]}]');

    v_res := public.generate_weekly_review_for(v_uid, v_week);
    IF (v_res #>> '{data,training,duration_min}')::int <> 90 THEN
      RAISE EXCEPTION 'weekly_review_lifting_minutes: expected 90 lifting minutes, got %',
        v_res #>> '{data,training,duration_min}';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'weekly_review_lifting_minutes_ok';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'weekly_review_lifting_minutes_ok' THEN RAISE; END IF;
  END;
END
$check$;
