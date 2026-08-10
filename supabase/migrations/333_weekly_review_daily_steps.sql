-- 333_weekly_review_daily_steps.sql
--
-- Adds `daily_steps` (seven totals, Monday-first) and `prev_steps` to the
-- conditioning payload.
--
-- WHY: the steps block reported a TOTAL plus a progress bar, and the bar was
-- measuring the wrong thing entirely — it showed how many DAYS HAD BEEN
-- LOGGED, drawn in the same shape the app uses for progress toward a goal.
-- It read as "you are 2/7 of the way to something" when it meant "you typed in
-- two days". A bar that looks like progress and is not is worse than no bar.
--
-- Replacing it with a real seven-day chart needs per-day figures, which the
-- RPC did not return. Same shape as `training.day_flags`, but totals rather
-- than booleans.
--
-- `prev_steps` lets the section carry a week-over-week comparison, which is
-- what the volume and fuel sections already do and what CLAUDE.md's "data must
-- be earned" rule asks of any figure given screen space.
--
-- The client divides by days LOGGED rather than by seven, because steps here
-- are typed in by hand: a day with no row means "not recorded", not "did not
-- move". Dividing by seven would understate every honest week.
--
-- APPLIED BY TRANSFORMING THE INSTALLED FUNCTION rather than restating ~500
-- lines, for the reason migration 331 gives: retyping the body is how two
-- versions start to differ. Three anchored replaces, each of which aborts if
-- its anchor is missing, plus a refusal to run twice.
--
-- Prerequisite: 328, 330 and 331.

DO $mig$
DECLARE src TEXT; s2 TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'generate_weekly_review_for';

  IF src IS NULL THEN
    RAISE EXCEPTION 'generate_weekly_review_for missing — apply 328, 330 and 331 first';
  END IF;
  IF position('v_daily_steps' in src) > 0 THEN
    RAISE EXCEPTION 'already applied';
  END IF;

  -- 1 · declarations
  s2 := replace(src, $a$  v_steps_days     INT := 0;$a$,
$b$  v_steps_days     INT := 0;
  v_daily_steps    INT[];
  v_prev_steps     INT := 0;$b$);
  IF s2 = src THEN RAISE EXCEPTION 'declaration anchor missed'; END IF;
  src := s2;

  -- 2 · the two new reads, appended to the existing step_logs block
  s2 := replace(src, $a$    INTO v_steps, v_steps_days
    FROM public.step_logs
   WHERE user_id = v_user_id
     AND date BETWEEN v_week_start AND v_week_end;$a$,
$b$    INTO v_steps, v_steps_days
    FROM public.step_logs
   WHERE user_id = v_user_id
     AND date BETWEEN v_week_start AND v_week_end;

  SELECT ARRAY(
    SELECT COALESCE((SELECT SUM(COALESCE(steps, 0))::INT FROM public.step_logs
                      WHERE user_id = v_user_id AND date = v_week_start + offs), 0)
    FROM generate_series(0, 6) AS offs
  ) INTO v_daily_steps;

  SELECT COALESCE(SUM(COALESCE(steps, 0)), 0)::INT INTO v_prev_steps
    FROM public.step_logs
   WHERE user_id = v_user_id
     AND date BETWEEN (v_week_start - 7) AND (v_week_start - 1);$b$);
  IF s2 = src THEN RAISE EXCEPTION 'step query anchor missed'; END IF;
  src := s2;

  -- 3 · payload
  s2 := replace(src, $a$      'steps_days',   v_steps_days
    ),$a$,
$b$      'steps_days',   v_steps_days,
      'daily_steps',  COALESCE(to_jsonb(v_daily_steps), '[]'::jsonb),
      'prev_steps',   v_prev_steps
    ),$b$);
  IF s2 = src THEN RAISE EXCEPTION 'payload anchor missed'; END IF;

  EXECUTE s2;
END
$mig$;

NOTIFY pgrst, 'reload schema';
