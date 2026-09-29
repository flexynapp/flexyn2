-- Bounties can no longer be rewritten by clients, and signed-out visitors
-- stop reading five tables that hold other people's activity.
--
-- 1. bounties_update was `USING (auth.uid() IS NOT NULL)` with no WITH CHECK
--    and UPDATE granted on every column. Any signed-in user, a one-tap guest
--    included, could set any bounty's reward, target_value and entry_fee,
--    then claim_bounty + complete_bounty_claim it: complete_bounty_claim pays
--    flex_coins = flex_coins + bounties.reward straight from the row. The
--    insert policy pins reward to difficulty, but an UPDATE never passes
--    through an insert policy. The app never updates bounties itself
--    (bounties.js only inserts and reads); claim_bounty, sweep_expired_bounties
--    and admin_purge_user_data are SECURITY DEFINER and keep working.
--    Measured 2026-09-29: all 14 existing rows still match their templates,
--    so nobody has used it.
--
-- 2. The insert policy accepted any target_value > 0, so a bounty targeting
--    1 lb was legal and paid 60 coins for a 10 coin fee. It now requires the
--    row to match one of the five templates the app generates from
--    (bounties.js generateBounties), within the app's own +/-10% jitter.
--
-- 3. bounties, poll_votes, crew_message_reactions, crew_war_contributions and
--    crew_wars had read policies `TO public`, so the anon key alone (no
--    account at all) could read them; poll_votes carries voters' emails.
--    Every reader in the app is signed in, so they move to authenticated.
--
-- 4. checklist_items is not used anywhere in the app, yet any signed-in user
--    could insert and update it. Client access is revoked; the 51 rows stay.

DROP POLICY IF EXISTS bounties_update ON public.bounties;
REVOKE UPDATE ON public.bounties FROM anon, authenticated;

DROP POLICY IF EXISTS bounties_insert ON public.bounties;
CREATE POLICY bounties_insert ON public.bounties
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND target_user_id IS DISTINCT FROM (SELECT auth.uid())
    AND expires_at > now()
    AND expires_at <= now() + interval '25 hours'
    AND claimed_by_id IS NULL
    AND NOT COALESCE(is_user_created, FALSE)
    AND (
         (metric = 'session_volume'     AND exercise_name IS NULL          AND difficulty = 'easy'   AND entry_fee = 10 AND reward = 60  AND target_value BETWEEN 13500 AND 16500)
      OR (metric = 'weekly_volume'      AND exercise_name IS NULL          AND difficulty = 'medium' AND entry_fee = 15 AND reward = 100 AND target_value BETWEEN 45000 AND 55000)
      OR (metric = 'weekly_volume'      AND exercise_name IS NULL          AND difficulty = 'hard'   AND entry_fee = 20 AND reward = 175 AND target_value BETWEEN 72000 AND 88000)
      OR (metric = 'single_lift_weight' AND exercise_name = 'Bench Press'  AND difficulty = 'hard'   AND entry_fee = 20 AND reward = 175 AND target_value BETWEEN 202 AND 248)
      OR (metric = 'single_lift_weight' AND exercise_name = 'Squat'        AND difficulty = 'medium' AND entry_fee = 15 AND reward = 100 AND target_value BETWEEN 166 AND 204)
    )
  );

ALTER POLICY bounties_read          ON public.bounties               TO authenticated;
ALTER POLICY poll_votes_select_any  ON public.poll_votes             TO authenticated;
ALTER POLICY poll_votes_insert_own  ON public.poll_votes             TO authenticated;
ALTER POLICY crew_rxns_select       ON public.crew_message_reactions TO authenticated;
ALTER POLICY crew_rxns_insert       ON public.crew_message_reactions TO authenticated;
ALTER POLICY crew_rxns_delete       ON public.crew_message_reactions TO authenticated;
ALTER POLICY crew_war_contrib_read  ON public.crew_war_contributions TO authenticated;
ALTER POLICY crew_wars_read         ON public.crew_wars              TO authenticated;

REVOKE ALL ON public.checklist_items FROM anon, authenticated;

-- Probe, rolled back: attempt each door as the role it is meant to stop,
-- and check the legitimate path still works.
DO $probe$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_target uuid := gen_random_uuid();
  v_bounty uuid;
  v_n      integer;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_user,   'probe_b_' || v_user   || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_target, 'probe_t_' || v_target || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email) VALUES
    (v_user,   'probe_b_' || v_user   || '@probe.invalid'),
    (v_target, 'probe_t_' || v_target || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  -- A template bounty, as the app generates it, is accepted.
  INSERT INTO public.bounties (target_user_id, target_username, metric, exercise_name,
                               target_value, difficulty, entry_fee, reward, expires_at)
  VALUES (v_target, 'probe', 'session_volume', NULL, 15000, 'easy', 10, 60, now() + interval '24 hours')
  RETURNING id INTO v_bounty;

  -- A 1 lb target is refused.
  BEGIN
    INSERT INTO public.bounties (target_user_id, target_username, metric, exercise_name,
                                 target_value, difficulty, entry_fee, reward, expires_at)
    VALUES (v_target, 'probe', 'session_volume', NULL, 1, 'easy', 10, 60, now() + interval '24 hours');
    RAISE EXCEPTION 'probe: 1 lb bounty was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Rewriting the reward is refused outright.
  BEGIN
    UPDATE public.bounties SET reward = 2500, target_value = 0 WHERE id = v_bounty;
    RAISE EXCEPTION 'probe: client rewrote a bounty';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- checklist_items is closed to clients.
  BEGIN
    PERFORM 1 FROM public.checklist_items LIMIT 1;
    RAISE EXCEPTION 'probe: client read checklist_items';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- The signed-in user still reads bounties.
  SELECT count(*) INTO v_n FROM public.bounties WHERE id = v_bounty;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: signed-in read lost'; END IF;

  -- Signed out: nothing.
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL role anon';
  SELECT count(*) INTO v_n FROM public.bounties;
  IF v_n <> 0 THEN RAISE EXCEPTION 'probe: anon read % bounties', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.poll_votes;
  IF v_n <> 0 THEN RAISE EXCEPTION 'probe: anon read % poll votes', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.crew_war_contributions;
  IF v_n <> 0 THEN RAISE EXCEPTION 'probe: anon read % war rows', v_n; END IF;

  EXECUTE 'RESET role';
  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
