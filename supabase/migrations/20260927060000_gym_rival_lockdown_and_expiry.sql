-- Gym Rival: close client writes, expire matches nobody answered, and make
-- "Clear it and find a new rival" actually clear.
--
-- Measured on production 2026-09-27 before writing this: 44 matches have
-- ever been rolled and not one has settled. Three rows sit at
-- status = 'active' with accepted_at NULL, assigned 2026-05-31 to
-- 2026-06-08. 'active' is the column default, and those rows predate the
-- two-sided confirm flow, so they were never accepted. The weekly
-- settlement and the 48h AFK sweep both require accepted_at, so nothing
-- could ever finish or clear them, and the roll excludes anyone in a
-- pending or active row, so both people in each were locked out of
-- matchmaking for four months.
--
-- 1. Client writes are closed.
--    "nemesis_own" was an ALL policy with only user_id = auth.uid() as its
--    check, left over from when the client assigned rivals itself. Executed
--    as a real authenticated user and rolled back: an INSERT of
--    status = 'active', both confirm flags TRUE and accepted_at two weeks
--    ago against a user who never agreed was ACCEPTED, and so was an UPDATE
--    setting status = 'completed', winner_id = self. The first is picked up
--    by gym_rival_settle_week on Monday and pays 5,000 XP, 500 coins and 5
--    capsules to whoever out-lifts the victim; the second writes wins into
--    gym_rival_record. Every write path in the app is already a SECURITY
--    DEFINER RPC (roll, confirm, decline, void_stale), so the initiator
--    keeps SELECT only, matching the rival's existing read policy.
--
-- 2. gym_rival_expire_stale() retires rows that can never finish:
--    - status 'active' with accepted_at NULL (the legacy rows above), and
--    - status 'pending' older than 48 hours: the rival never answered. Until
--      now a pending row lived forever and locked both people out of the
--      pool. The initiator is told, the same way a decline tells them.
--    Both become 'reassigned', the status a decline already uses for "ended
--    without a result". The client never shows a reassigned row, so the
--    card falls back to "find a rival". Rows are updated, never deleted.
--    Runs hourly from cron and at the start of every roll.
--
-- 3. gym_rival_roll calls it first, so the stalled screen's "Clear it and
--    find a new rival" clears the stuck row even when no rival is free.
--    Before, the roll only retired old rows AFTER finding a candidate, so
--    with an empty pool the button did nothing and the match stayed.
--    Restated from pg_get_functiondef on production; the only other change
--    is the invite body, which promised an AFK "forfeit" that does not
--    exist (the sweep voids the week with no winner) and carried a dash.

-- ── 1. Close client writes ────────────────────────────────────────────────

DROP POLICY IF EXISTS "nemesis_own" ON public.gym_rival_assignments;
DROP POLICY IF EXISTS "gym_rival_own_read" ON public.gym_rival_assignments;
CREATE POLICY "gym_rival_own_read" ON public.gym_rival_assignments
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gym_rival_assignments FROM anon, authenticated;

-- ── 2. Expire rows that can never finish ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.gym_rival_expire_stale()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count INT := 0;
  v_n     INT;
BEGIN
  -- Never accepted by both sides, so settlement and the AFK sweep skip it.
  UPDATE public.gym_rival_assignments
     SET status = 'reassigned'
   WHERE status = 'active' AND accepted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_count := v_count + v_n;

  -- An invite nobody answered within 48 hours.
  WITH expired AS (
    UPDATE public.gym_rival_assignments
       SET status = 'reassigned'
     WHERE status = 'pending' AND assigned_at < now() - interval '48 hours'
    RETURNING id, user_id, rival_id
  ), notified AS (
    INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
    SELECT e.user_id, u.email, 'nemesis_assigned',
      'Your rival challenge expired',
      '@' || COALESCE(p.username, 'Your rival') || ' didn''t answer within 48 hours. Roll a new rival when you''re ready.',
      '🎯', '/workout',
      jsonb_build_object('assignment_id', e.id, 'result', 'expired')
    FROM expired e
    JOIN auth.users u ON u.id = e.user_id
    LEFT JOIN public.user_profiles p ON p.id = e.rival_id
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM expired;
  v_count := v_count + v_n;

  RETURN v_count;
END;
$$;

ALTER FUNCTION public.gym_rival_expire_stale() OWNER TO postgres;
-- Cron and gym_rival_roll only. It sweeps every user's rows, so it must not
-- be a PostgREST endpoint.
REVOKE ALL ON FUNCTION public.gym_rival_expire_stale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gym_rival_expire_stale() TO service_role;

SELECT cron.schedule('gym-rival-expire', '15 * * * *', $$SELECT public.gym_rival_expire_stale();$$);

-- ── 3. Roll clears first ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.gym_rival_roll(p_type text DEFAULT 'gym'::text)
 RETURNS SETOF gym_rival_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_type TEXT := CASE WHEN p_type = 'cardio' THEN 'cardio' ELSE 'gym' END;
  v_label TEXT := CASE WHEN p_type = 'cardio' THEN 'Cardio Rival' ELSE 'Gym Rival' END;
  v_out_a NUMERIC; v_cad_a NUMERIC; v_str_a NUMERIC; v_age_a NUMERIC; v_lvl_a INTEGER;
  v_out_b NUMERIC; v_cad_b NUMERIC; v_str_b NUMERIC; v_age_b NUMERIC; v_lvl_b INTEGER;
  v_pass INTEGER; v_cand UUID; v_gap NUMERIC; v_best_gap NUMERIC;
  v_rival UUID; v_new_id UUID; v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  -- Retire dead rows before searching: the caller's own stuck match must
  -- clear even when nobody is free, and a dead row elsewhere must not keep
  -- a real candidate out of the pool.
  PERFORM public.gym_rival_expire_stale();

  SELECT weekly_output, cadence, strength, lifter_age, lifter_level
    INTO v_out_a, v_cad_a, v_str_a, v_age_a, v_lvl_a
    FROM public.gym_rival_user_stats(v_uid, v_type);

  FOR v_pass IN 1..2 LOOP
    EXIT WHEN v_rival IS NOT NULL;
    FOR v_cand IN
      SELECT id FROM public.user_profiles
       WHERE id <> v_uid
         AND COALESCE(nemesis_opt_out, FALSE) = FALSE
         AND username IS NOT NULL
         AND last_active_at IS NOT NULL
         AND last_active_at >= now() - interval '7 days'
         AND id NOT IN (SELECT id FROM auth.users WHERE email IS NULL)
         AND id NOT IN (
           SELECT user_id FROM public.gym_rival_assignments WHERE status IN ('pending','active')
           UNION
           SELECT rival_id FROM public.gym_rival_assignments WHERE status IN ('pending','active'))
         AND (v_pass = 2 OR id NOT IN (
           SELECT rival_id FROM public.gym_rival_assignments
            WHERE user_id = v_uid AND assigned_at >= now() - interval '21 days'
           UNION
           SELECT user_id FROM public.gym_rival_assignments
            WHERE rival_id = v_uid AND assigned_at >= now() - interval '21 days'))
       LIMIT 200
    LOOP
      SELECT weekly_output, cadence, strength, lifter_age, lifter_level
        INTO v_out_b, v_cad_b, v_str_b, v_age_b, v_lvl_b
        FROM public.gym_rival_user_stats(v_cand, v_type);
      v_gap := public.gym_rival_match_gap(v_out_a, v_cad_a, v_str_a, v_age_a, v_lvl_a,
                                          v_out_b, v_cad_b, v_str_b, v_age_b, v_lvl_b);
      IF v_best_gap IS NULL
         OR v_gap < v_best_gap - 0.02
         OR (ABS(v_gap - v_best_gap) <= 0.02 AND random() < 0.5) THEN
        v_best_gap := v_gap; v_rival := v_cand;
      END IF;
    END LOOP;
  END LOOP;

  IF v_rival IS NULL THEN RETURN; END IF;

  UPDATE public.gym_rival_assignments SET status = 'reassigned'
   WHERE status IN ('pending','active') AND (user_id = v_uid OR rival_id = v_uid);

  INSERT INTO public.gym_rival_assignments
    (user_id, rival_id, status, rival_type, initiator_confirmed, rival_confirmed, match_gap)
  VALUES (v_uid, v_rival, 'pending', v_type, FALSE, FALSE, v_best_gap)
  RETURNING id INTO v_new_id;

  SELECT username INTO v_name FROM public.user_profiles WHERE id = v_uid;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  SELECT v_rival, email, 'nemesis_assigned',
    '🎯 @' || COALESCE(v_name, 'someone') || ' wants to be your ' || v_label,
    'Accept within 48 hours to start this week''s challenge.',
    '🎯', '/workout',
    jsonb_build_object('assignment_id', v_new_id, 'initiator_id', v_uid, 'rival_type', v_type)
  FROM auth.users WHERE id = v_rival AND email IS NOT NULL;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = v_new_id;
END;
$function$;

-- ── 4. Apply once, then attempt the attack ───────────────────────────────

SELECT public.gym_rival_expire_stale();

DO $$
DECLARE
  v_uid UUID := gen_random_uuid();
BEGIN
  -- An INSERT and an UPDATE as a signed-in user must both be refused.
  -- SET LOCAL inside the inner block is undone when its exception is
  -- caught, so the role never leaks into the rest of the migration.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    INSERT INTO public.gym_rival_assignments
      (user_id, rival_id, status, initiator_confirmed, rival_confirmed, accepted_at)
    VALUES (v_uid, gen_random_uuid(), 'active', TRUE, TRUE, now() - interval '14 days');
    RAISE EXCEPTION 'probe: client INSERT into gym_rival_assignments was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    UPDATE public.gym_rival_assignments SET winner_id = v_uid WHERE user_id = v_uid;
    RAISE EXCEPTION 'probe: client UPDATE on gym_rival_assignments was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- And reading your own rows still works.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    PERFORM 1 FROM public.gym_rival_assignments WHERE user_id = v_uid;
    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'read ok';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.gym_rival_assignments
              WHERE status = 'active' AND accepted_at IS NULL) THEN
    RAISE EXCEPTION 'probe: an unaccepted active match survived the sweep';
  END IF;
END;
$$;
