-- Gauntlet community numbers the client could not compute.
--
-- 1. The completion popup's "Community Stats" read user_gauntlet_progress and
--    user_gauntlet_completions directly, but both tables are readable only
--    for your own rows, so every count was 1 or 0 ("You're the FIRST" for
--    everyone). It also read total_attempts/completions while the popup
--    expected attempt_count/completion_count, so Total Attempts always
--    showed 0. get_gauntlet_challenge_stats returns the real aggregates:
--    counts only, no names, plus the caller's own finishing position.
--
-- 2. weekly_gauntlets.attempt_count / completion_count never moved: the
--    client bumped them with a direct UPDATE, and the table has no client
--    UPDATE policy, so the write matched zero rows. A SECURITY DEFINER
--    trigger on weekly_gauntlet_attempts now derives both from the attempt
--    rows (count, not +1, so any drift heals on the next write), and the
--    existing rows are backfilled.
--
-- 3. Settings lists the message requests you declined by the other person's
--    user id, but dm_request_blocks only ever carried emails, so every row
--    read "an account". A SECURITY DEFINER trigger now fills blocker_id and
--    blocked_id from user_profiles (a caller can only read their own
--    profile row, hence definer). RLS on the table is unchanged.

CREATE OR REPLACE FUNCTION public.get_gauntlet_challenge_stats(p_sequence integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_reached bigint;
  v_done    bigint;
  v_rank    bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Everyone who has reached this challenge: their current step is at or
  -- past it, or they finished the whole path.
  SELECT count(*) INTO v_reached
    FROM public.user_gauntlet_progress
   WHERE current_challenge_sequence >= p_sequence OR path_completed;

  SELECT count(*) INTO v_done
    FROM public.user_gauntlet_completions
   WHERE sequence_number = p_sequence;

  v_reached := GREATEST(v_reached, v_done);

  SELECT r INTO v_rank FROM (
    SELECT user_id, row_number() OVER (ORDER BY completed_at, id) AS r
      FROM public.user_gauntlet_completions
     WHERE sequence_number = p_sequence
  ) s
  WHERE s.user_id = v_uid;

  RETURN jsonb_build_object(
    'attempt_count',       v_reached,
    'completion_count',    v_done,
    'completion_rate_pct', CASE WHEN v_reached > 0 THEN round(100.0 * v_done / v_reached)::int ELSE 0 END,
    'user_rank',           v_rank
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_gauntlet_challenge_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gauntlet_challenge_stats(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.weekly_gauntlet_counts_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_ids := ARRAY[NEW.gauntlet_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_ids := ARRAY[OLD.gauntlet_id];
  ELSE
    v_ids := ARRAY[NEW.gauntlet_id, OLD.gauntlet_id];
  END IF;

  UPDATE public.weekly_gauntlets g
     SET attempt_count    = (SELECT count(*) FROM public.weekly_gauntlet_attempts a
                              WHERE a.gauntlet_id = g.id),
         completion_count = (SELECT count(*) FROM public.weekly_gauntlet_attempts a
                              WHERE a.gauntlet_id = g.id AND a.status = 'completed')
   WHERE g.id = ANY (v_ids);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.weekly_gauntlet_counts_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_weekly_gauntlet_counts_sync ON public.weekly_gauntlet_attempts;
CREATE TRIGGER trg_weekly_gauntlet_counts_sync
  AFTER INSERT OR UPDATE OF status, gauntlet_id OR DELETE ON public.weekly_gauntlet_attempts
  FOR EACH ROW EXECUTE FUNCTION public.weekly_gauntlet_counts_sync();

-- Backfill.
UPDATE public.weekly_gauntlets g
   SET attempt_count    = (SELECT count(*) FROM public.weekly_gauntlet_attempts a
                            WHERE a.gauntlet_id = g.id),
       completion_count = (SELECT count(*) FROM public.weekly_gauntlet_attempts a
                            WHERE a.gauntlet_id = g.id AND a.status = 'completed');

ALTER TABLE public.dm_request_blocks
  ADD COLUMN IF NOT EXISTS blocker_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS blocked_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.dm_request_blocks_fill_ids()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.blocker_id := (SELECT id FROM public.user_profiles
                      WHERE lower(email) = lower(NEW.blocker_email) LIMIT 1);
  NEW.blocked_id := (SELECT id FROM public.user_profiles
                      WHERE lower(email) = lower(NEW.blocked_email) LIMIT 1);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.dm_request_blocks_fill_ids() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dm_request_blocks_fill_ids ON public.dm_request_blocks;
CREATE TRIGGER trg_dm_request_blocks_fill_ids
  BEFORE INSERT OR UPDATE OF blocker_email, blocked_email ON public.dm_request_blocks
  FOR EACH ROW EXECUTE FUNCTION public.dm_request_blocks_fill_ids();

-- Backfill through the trigger.
UPDATE public.dm_request_blocks SET blocked_email = blocked_email;

-- Prove all three, as the role that fires them, and roll the probe back.
DO $$
DECLARE
  v_g     uuid;
  v_u1    uuid := gen_random_uuid();
  v_u2    uuid := gen_random_uuid();
  v_stats jsonb;
  v_ac    int;
  v_cc    int;
BEGIN
  IF has_function_privilege('anon', 'public.get_gauntlet_challenge_stats(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.weekly_gauntlet_counts_sync()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.dm_request_blocks_fill_ids()', 'EXECUTE') THEN
    RAISE EXCEPTION 'gauntlet helpers have the wrong grants';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, aud, role, email, instance_id)
    VALUES (v_u1, 'authenticated', 'authenticated', 'gprobe1_' || v_u1 || '@x.test', '00000000-0000-0000-0000-000000000000'),
           (v_u2, 'authenticated', 'authenticated', 'gprobe2_' || v_u2 || '@x.test', '00000000-0000-0000-0000-000000000000');
    INSERT INTO public.weekly_gauntlets (title, description, flavor_text, week_start, week_end, status)
    VALUES ('probe', 'probe', 'probe', current_date, current_date + 6, 'active')
    RETURNING id INTO v_g;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    INSERT INTO public.weekly_gauntlet_attempts (gauntlet_id, user_id) VALUES (v_g, v_u1);
    UPDATE public.weekly_gauntlet_attempts SET status = 'completed', score = 20000
     WHERE gauntlet_id = v_g AND user_id = v_u1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u2, 'role', 'authenticated')::text, true);
    INSERT INTO public.weekly_gauntlet_attempts (gauntlet_id, user_id) VALUES (v_g, v_u2);
    v_stats := public.get_gauntlet_challenge_stats(1);
    PERFORM set_config('role', 'postgres', true);

    SELECT attempt_count, completion_count INTO v_ac, v_cc FROM public.weekly_gauntlets WHERE id = v_g;
    IF v_ac <> 2 OR v_cc <> 1 THEN
      RAISE EXCEPTION 'weekly counters wrong: % attempts, % completions', v_ac, v_cc;
    END IF;
    IF v_stats->>'attempt_count' IS NULL OR v_stats->>'completion_rate_pct' IS NULL THEN
      RAISE EXCEPTION 'challenge stats missing keys: %', v_stats;
    END IF;
    INSERT INTO public.dm_request_blocks (blocker_email, blocked_email)
    VALUES ('gprobe1_' || v_u1 || '@x.test', 'gprobe2_' || v_u2 || '@x.test');
    IF NOT EXISTS (SELECT 1 FROM public.dm_request_blocks
                    WHERE blocker_id = v_u1 AND blocked_id = v_u2) THEN
      RAISE EXCEPTION 'dm_request_blocks ids were not filled';
    END IF;
    RAISE EXCEPTION 'probe_ok';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
  END;
END $$;
