-- Reward economy audit, part one (2026-09-28).
--
-- Two holes found by running them as a guest against production, both
-- reproduced in rolled-back transactions before this file was written.
--
-- 1. THE WELCOME CAPSULE COULD BE FARMED FOREVER.
--    grant_welcome_capsule() decides "already granted" by counting the
--    caller's user_capsules rows, and clients held DELETE on that table.
--    So: open the capsule, delete the row, call again. Five loops produced
--    five inventory items. Deleting opened capsules also rewrites the
--    history the pity roll reads. Nothing in the app deletes a capsule, so
--    the fix is to take DELETE away from clients entirely.
--
-- 2. LIFETIME VOLUME AND DISTANCE WERE WHATEVER THE CLIENT SAID.
--    increment_user_volume(p_delta) and increment_user_distance(p_delta)
--    credited any number up to 300,000 lb and 500 km a day, with no log
--    behind it. total_volume_lbs ranks crews (get_top_crews,
--    get_public_crews) and gym members, and total_distance_meters is the
--    Distance leaderboard and a Rival stat. Nobody had to lift anything.
--
--    The totals are now maintained by the database from the logs
--    themselves. Each row remembers exactly what it added
--    (volume_credited_lbs / distance_credited_m), so an edit moves the
--    total by the difference and a delete takes back exactly that row's
--    share. Volume is recomputed from the exercises JSON and a row the
--    plausibility trigger flags adds nothing. Distance is capped at a
--    human speed and at 200 km per session and 500 km per calendar day.
--
--    The two RPCs stay (old installed PWAs still call them) but do
--    nothing. If they kept crediting, every save from an old build would
--    count twice.
--
-- Existing totals are left exactly as they are. Rows already credited are
-- backfilled with what they most likely added, so deleting an old log
-- still subtracts it.


-- ---------------------------------------------------------------------
-- 1. Capsules: no client DELETE.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_pol text;
BEGIN
  FOR v_pol IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'user_capsules' AND cmd = 'DELETE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_capsules', v_pol);
  END LOOP;
END $$;

REVOKE DELETE, TRUNCATE ON public.user_capsules FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2a. Volume, owned by workout_logs.
-- ---------------------------------------------------------------------
ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS volume_credited_lbs numeric;

COMMENT ON COLUMN public.workout_logs.volume_credited_lbs IS
  'What this row added to user_profiles.total_volume_lbs. Written only by '
  'workout_logs_volume_credit(); NULL on a legacy row never credited.';

-- Rows the old client path already credited: it credited total_volume.
UPDATE public.workout_logs
   SET volume_credited_lbs = GREATEST(0, COALESCE(total_volume, 0))
 WHERE volume_credited_at IS NOT NULL
   AND volume_credited_lbs IS NULL;

CREATE OR REPLACE FUNCTION public.workout_logs_volume_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_new   numeric := 0;
  v_old   numeric := 0;
  v_user  uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.user_id IS NOT NULL AND COALESCE(OLD.volume_credited_lbs, 0) > 0 THEN
      UPDATE public.user_profiles
         SET total_volume_lbs = GREATEST(0, COALESCE(total_volume_lbs, 0) - OLD.volume_credited_lbs)
       WHERE id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;

  -- Runs after workout_logs_flag_implausible_tr (triggers fire by name),
  -- so NEW.implausible is already the server's verdict.
  IF NOT COALESCE(NEW.implausible, FALSE) THEN
    v_new := GREATEST(0, COALESCE(public._duel_calc_volume(NEW.exercises), 0));
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := COALESCE(OLD.volume_credited_lbs, 0);
    -- A row that changes hands is not a thing the app does; keep the old
    -- owner's credit with the old owner rather than moving it.
    IF OLD.user_id IS DISTINCT FROM NEW.user_id AND OLD.user_id IS NOT NULL AND v_old > 0 THEN
      UPDATE public.user_profiles
         SET total_volume_lbs = GREATEST(0, COALESCE(total_volume_lbs, 0) - v_old)
       WHERE id = OLD.user_id;
      v_old := 0;
    END IF;
  END IF;

  v_user := NEW.user_id;
  IF v_user IS NULL THEN
    NEW.volume_credited_lbs := NULL;
    RETURN NEW;
  END IF;

  IF v_new <> v_old THEN
    UPDATE public.user_profiles
       SET total_volume_lbs = GREATEST(0, COALESCE(total_volume_lbs, 0) + (v_new - v_old))
     WHERE id = v_user;
  END IF;

  NEW.volume_credited_lbs := v_new;
  NEW.volume_credited_at  := CASE WHEN TG_OP = 'UPDATE'
                                  THEN COALESCE(OLD.volume_credited_at, now())
                                  ELSE now() END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.workout_logs_volume_credit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS workout_logs_volume_credit_tr ON public.workout_logs;
CREATE TRIGGER workout_logs_volume_credit_tr
  BEFORE INSERT OR UPDATE OR DELETE ON public.workout_logs
  FOR EACH ROW EXECUTE FUNCTION public.workout_logs_volume_credit();

-- The client door closes. Kept so old builds get a clean no-op, not 404.
CREATE OR REPLACE FUNCTION public.increment_user_volume(p_delta numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  -- Lifetime volume is maintained by workout_logs_volume_credit_tr from the
  -- logs themselves. A client-supplied delta is ignored in both directions.
  RETURN;
END;
$function$;

-- Reconcile used to call increment_user_volume with the rows' client
-- total_volume. Touching the row now lets the trigger credit what the
-- exercises actually add up to.
CREATE OR REPLACE FUNCTION public.reconcile_my_workout_volume()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_count int  := 0;
  v_delta numeric := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  WITH touched AS (
    UPDATE public.workout_logs
       SET volume_credited_at = volume_credited_at
     WHERE user_id = v_uid
       AND volume_credited_at IS NULL
       AND created_at > now() - INTERVAL '7 days'
    RETURNING volume_credited_lbs
  )
  SELECT count(*), COALESCE(sum(volume_credited_lbs), 0) INTO v_count, v_delta FROM touched;

  RETURN jsonb_build_object('reconciled', v_count, 'delta', v_delta);
END;
$function$;

-- ---------------------------------------------------------------------
-- 2b. Distance, owned by cardio_logs.
-- ---------------------------------------------------------------------
ALTER TABLE public.cardio_logs
  ADD COLUMN IF NOT EXISTS distance_credited_m numeric;

COMMENT ON COLUMN public.cardio_logs.distance_credited_m IS
  'What this row added to user_profiles.total_distance_meters. Written only '
  'by cardio_logs_distance_credit().';

-- Every existing row was credited by the client at save time.
UPDATE public.cardio_logs
   SET distance_credited_m = GREATEST(0, COALESCE(distance_meters, 0))
 WHERE distance_credited_m IS NULL;

CREATE OR REPLACE FUNCTION public.cardio_logs_distance_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  c_max_speed_mps CONSTANT numeric := 25;       -- 90 km/h, beyond any human-powered session
  c_session_cap   CONSTANT numeric := 200000;   -- 200 km
  c_day_cap       CONSTANT numeric := 500000;   -- 500 km per calendar day
  v_secs     numeric;
  v_dist     numeric;
  v_new      numeric := 0;
  v_old      numeric := 0;
  v_same_day numeric := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.user_id IS NOT NULL AND COALESCE(OLD.distance_credited_m, 0) > 0 THEN
      UPDATE public.user_profiles
         SET total_distance_meters = GREATEST(0, COALESCE(total_distance_meters, 0) - OLD.distance_credited_m)
       WHERE id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := COALESCE(OLD.distance_credited_m, 0);
    IF OLD.user_id IS DISTINCT FROM NEW.user_id AND OLD.user_id IS NOT NULL AND v_old > 0 THEN
      UPDATE public.user_profiles
         SET total_distance_meters = GREATEST(0, COALESCE(total_distance_meters, 0) - v_old)
       WHERE id = OLD.user_id;
      v_old := 0;
    END IF;
  END IF;

  IF NEW.user_id IS NULL THEN
    NEW.distance_credited_m := NULL;
    RETURN NEW;
  END IF;

  v_dist := GREATEST(0, COALESCE(NEW.distance_meters, 0));
  v_secs := COALESCE(NULLIF(NEW.duration_seconds, 0)::numeric,
                     NULLIF(NEW.duration_min, 0)::numeric * 60, 0);

  -- A distance with no duration, or one covered faster than 90 km/h,
  -- adds nothing. The row itself still saves.
  IF v_dist > 0 AND v_secs > 0 AND v_dist <= v_secs * c_max_speed_mps THEN
    SELECT COALESCE(sum(distance_credited_m), 0) INTO v_same_day
      FROM public.cardio_logs
     WHERE user_id = NEW.user_id
       AND "date" IS NOT DISTINCT FROM NEW."date"
       AND id <> NEW.id;
    v_new := LEAST(v_dist, c_session_cap, GREATEST(0, c_day_cap - v_same_day));
  END IF;

  IF v_new <> v_old THEN
    UPDATE public.user_profiles
       SET total_distance_meters = GREATEST(0, COALESCE(total_distance_meters, 0) + (v_new - v_old))
     WHERE id = NEW.user_id;
  END IF;

  NEW.distance_credited_m := v_new;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.cardio_logs_distance_credit() FROM PUBLIC, anon, authenticated;

-- Named to sort after trg_sync_cardio_type, the other BEFORE trigger.
DROP TRIGGER IF EXISTS zz_cardio_logs_distance_credit_tr ON public.cardio_logs;
CREATE TRIGGER zz_cardio_logs_distance_credit_tr
  BEFORE INSERT OR UPDATE OR DELETE ON public.cardio_logs
  FOR EACH ROW EXECUTE FUNCTION public.cardio_logs_distance_credit();

CREATE OR REPLACE FUNCTION public.increment_user_distance(p_delta numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  -- Lifetime distance is maintained by zz_cardio_logs_distance_credit_tr.
  -- A client-supplied delta is ignored in both directions.
  RETURN;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. Probe: attempt every door as a real authenticated guest, then roll
--    back. P0003 is the success signal.
-- ---------------------------------------------------------------------
DO $probe$
DECLARE
  u      uuid := gen_random_uuid();
  mail   text := 'guest_' || u || '@flexyn.guest';
  cid    uuid;
  wid    uuid;
  kid    uuid;
  res    jsonb;
  n      int;
  vol    numeric;
  dist   numeric;
  refused boolean;
BEGIN
  INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES (u, 'authenticated', 'authenticated', TRUE);
  INSERT INTO public.user_profiles (id, email) VALUES (u, mail) ON CONFLICT (id) DO NOTHING;
  UPDATE public.user_profiles SET total_volume_lbs = 0, total_distance_meters = 0 WHERE id = u;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', u, 'role', 'authenticated', 'is_anonymous', TRUE)::text, TRUE);
  SET LOCAL ROLE authenticated;

  -- Welcome capsule: granted once, and the row cannot be deleted to reset it.
  res := public.grant_welcome_capsule();
  IF NOT (res->>'granted')::boolean THEN RAISE EXCEPTION 'probe: first welcome grant refused'; END IF;
  SELECT id INTO cid FROM public.user_capsules WHERE user_id = u LIMIT 1;
  PERFORM public.open_capsule_atomic(cid, '[]'::jsonb);
  refused := FALSE;
  BEGIN
    DELETE FROM public.user_capsules WHERE user_id = u;
  EXCEPTION WHEN insufficient_privilege THEN refused := TRUE;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'probe: capsule DELETE was allowed'; END IF;
  res := public.grant_welcome_capsule();
  IF (res->>'granted')::boolean THEN RAISE EXCEPTION 'probe: welcome capsule granted twice'; END IF;

  -- Volume: the RPC credits nothing.
  PERFORM public.increment_user_volume(100000);
  PERFORM public.increment_user_distance(100000);
  RESET ROLE;
  SELECT total_volume_lbs, total_distance_meters INTO vol, dist FROM public.user_profiles WHERE id = u;
  IF vol <> 0 OR dist <> 0 THEN RAISE EXCEPTION 'probe: RPC still credited (% lb, % m)', vol, dist; END IF;
  SET LOCAL ROLE authenticated;

  -- A saved log credits what its sets add up to, not what the client
  -- claims in total_volume or volume_credited_lbs.
  INSERT INTO public.workout_logs (user_id, created_by, "date", exercises, total_volume, volume_credited_lbs)
  VALUES (u, mail, current_date,
          '[{"name":"Bench Press","sets":[{"weight":100,"reps":10},{"weight":100,"reps":10}]}]'::jsonb,
          999999, 999999)
  RETURNING id INTO wid;
  RESET ROLE;
  SELECT total_volume_lbs INTO vol FROM public.user_profiles WHERE id = u;
  IF vol <> 2000 THEN RAISE EXCEPTION 'probe: insert credited % lb, expected 2000', vol; END IF;
  SET LOCAL ROLE authenticated;

  -- An edit moves the total by the difference.
  UPDATE public.workout_logs
     SET exercises = '[{"name":"Bench Press","sets":[{"weight":100,"reps":5}]}]'::jsonb,
         volume_credited_lbs = 0, volume_credited_at = NULL
   WHERE id = wid;
  RESET ROLE;
  SELECT total_volume_lbs INTO vol FROM public.user_profiles WHERE id = u;
  IF vol <> 500 THEN RAISE EXCEPTION 'probe: edit left % lb, expected 500', vol; END IF;
  SELECT count(*) INTO n FROM public.workout_logs WHERE id = wid AND volume_credited_at IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'probe: client cleared volume_credited_at'; END IF;
  SET LOCAL ROLE authenticated;

  -- A flagged log adds nothing.
  INSERT INTO public.workout_logs (user_id, created_by, "date", exercises)
  VALUES (u, mail, current_date,
          '[{"name":"Squat","sets":[{"weight":1000,"reps":1000}]}]'::jsonb);
  RESET ROLE;
  SELECT total_volume_lbs INTO vol FROM public.user_profiles WHERE id = u;
  IF vol <> 500 THEN RAISE EXCEPTION 'probe: implausible log credited, total %', vol; END IF;
  SET LOCAL ROLE authenticated;

  -- Delete takes back exactly this row's share.
  DELETE FROM public.workout_logs WHERE id = wid;
  RESET ROLE;
  SELECT total_volume_lbs INTO vol FROM public.user_profiles WHERE id = u;
  IF vol <> 0 THEN RAISE EXCEPTION 'probe: delete left % lb, expected 0', vol; END IF;
  SET LOCAL ROLE authenticated;

  -- Distance: a 5 km run in 30 minutes counts.
  INSERT INTO public.cardio_logs (user_id, created_by, "date", activity_type, distance_meters, duration_seconds)
  VALUES (u, mail, current_date, 'run', 5000, 1800)
  RETURNING id INTO kid;
  -- 400 km in 10 minutes does not.
  INSERT INTO public.cardio_logs (user_id, created_by, "date", activity_type, distance_meters, duration_seconds)
  VALUES (u, mail, current_date, 'run', 400000, 600);
  -- Neither does distance with no duration.
  INSERT INTO public.cardio_logs (user_id, created_by, "date", activity_type, distance_meters)
  VALUES (u, mail, current_date, 'run', 10000);
  RESET ROLE;
  SELECT total_distance_meters INTO dist FROM public.user_profiles WHERE id = u;
  IF dist <> 5000 THEN RAISE EXCEPTION 'probe: distance total %, expected 5000', dist; END IF;
  SET LOCAL ROLE authenticated;

  -- 190 km bike sessions: the day stops at 500 km.
  FOR n IN 1..3 LOOP
    INSERT INTO public.cardio_logs (user_id, created_by, "date", activity_type, distance_meters, duration_seconds)
    VALUES (u, mail, current_date, 'bike', 190000, 36000);
  END LOOP;
  DELETE FROM public.cardio_logs WHERE id = kid;
  RESET ROLE;
  SELECT total_distance_meters INTO dist FROM public.user_profiles WHERE id = u;
  IF dist <> 495000 THEN RAISE EXCEPTION 'probe: day cap total %, expected 495000', dist; END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe ok';
EXCEPTION WHEN SQLSTATE 'P0003' THEN
  RESET ROLE;
  RAISE NOTICE 'server-owned volume/distance probe passed';
END
$probe$;

