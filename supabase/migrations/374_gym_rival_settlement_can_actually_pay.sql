-- 374_gym_rival_settlement_can_actually_pay.sql
--
-- Gym Rival settlement has never once completed, and it never could have.
--
-- PROVEN BY EXECUTION against production, seeded and rolled back, with
-- auth.uid() NULL — which is exactly the context the pg_cron job runs in
-- (jobid 15, `gym-rival-settle`, `SELECT public.gym_rival_settle_week();`,
-- Mondays 00:05):
--
--   auth.uid() during the call ............ NULL, same as the cron job
--   net rating A ......................... 23
--   net rating B ......................... 7
--   settleable rows the loop selects ..... 1
--   gym_rival_settle_week() .............. RAISED 42501 unauthenticated
--   assignments completed ................ 0
--   winner XP changed .................... NO
--   nemesis_overthrown notifications ..... 0
--
-- The cause is one line. `gym_rival_settle_week` calls
--
--   PERFORM public.increment_user_xp(v_winner, v_xp);
--
-- and increment_user_xp — read from the INSTALLED body, not migration 042 —
-- opens with `v_uid UUID := auth.uid();` then `IF v_uid IS NULL THEN RAISE
-- EXCEPTION 'unauthenticated'`. Its p_user_id parameter is accepted and then
-- never referenced; every statement in it keys on v_uid. That is deliberate
-- and correct: 042 made it ignore the client-supplied id precisely so a
-- caller cannot credit somebody else. It is simply the wrong tool for a cron
-- settler, which has no session and legitimately must credit a third party.
--
-- So the exception propagates, the whole `gym_rival_settle_week()` statement
-- aborts, and every Monday for as long as this has been scheduled the job has
-- rolled back with nothing done. It also means the second failure mode never
-- got a chance to bite: had the settler ever been invoked from a user session
-- instead, increment_user_xp would have credited THE CALLER 5,000 XP
-- regardless of who won the match.
--
-- This is upstream of the reason the numbers look empty, and worth separating
-- from it: 44 assignments exist, 41 reassigned and 3 active, and accepted_at
-- is NULL on ALL of them, with initiator_confirmed and rival_confirmed FALSE
-- on all 44. So the settler's WHERE clause has never selected a row in
-- production either. Two independent reasons nothing has settled. Fixing this
-- one does not make the feature work; it makes it capable of working the
-- first time someone accepts.
--
-- THE ACCEPT PATH ITSELF IS FINE, and it is worth writing down that this was
-- checked rather than assumed — the first probe said otherwise and the probe
-- was wrong. Calling gym_rival_confirm as both participants of one of the
-- three ACTIVE rows returns success and writes nothing, which reads exactly
-- like a broken button. It is not: the function early-returns unless
-- `status = 'pending'`, and those three are legacy rows from before migration
-- 222 added the handshake — active, never accepted, which is precisely the
-- `is_stalled` state gym_rival_week_state already reports. Re-run against a
-- genuinely pending row, the shape gym_rival_roll actually inserts, the
-- handshake is correct end to end:
--   A confirms -> initiator=true, rival=false, status still pending
--   B confirms -> initiator=true, rival=true, status active, accepted_at set
-- So nobody has completed the two-sided handshake. That is an adoption fact,
-- not a defect, and it is why the payout below had never been reached.
--
-- THE FIX. A dedicated internal awarder that takes the recipient as a
-- parameter, in the shape CLAUDE.md documents for `is_blocked`: SECURITY
-- DEFINER, REVOKEd from PUBLIC / anon / authenticated, reachable only from
-- other SECURITY DEFINER callers. It is NOT a relaxation of 042 — the
-- client-callable increment_user_xp is untouched and still ignores its
-- parameter. Anything a client can reach still credits auth.uid() and only
-- auth.uid().
--
-- The awarder keeps BOTH protections from the function it mirrors, because
-- the append-only ledger is what drives the rolling cap and is the
-- tamper-proof log (migration 188). Dropping either to "just UPDATE the row"
-- would put an unlogged, uncapped XP write into the codebase, which is the
-- exact hole the ledger exists to close.
--
-- Paste-safe: NEW./OLD. and bare columns only, no alias.column tokens.

CREATE OR REPLACE FUNCTION public.award_xp_internal(p_user_id uuid, p_xp integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_total_xp  BIGINT;
  v_level     INTEGER := 1;
  v_today     INTEGER;
  v_grant     INTEGER;
  v_daily_cap CONSTANT INTEGER := 50000;
BEGIN
  -- INTERNAL. The recipient is a parameter on purpose, which is safe only
  -- because nothing a client can reach may EXECUTE this. See the REVOKEs
  -- below; they are the whole security argument for this function.
  IF p_user_id IS NULL THEN RETURN; END IF;
  IF p_xp IS NULL OR p_xp <= 0 THEN RETURN; END IF;
  IF p_xp > 100000 THEN
    RAISE EXCEPTION 'xp out of range' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_today
    FROM public.xp_grant_log
   WHERE user_id = p_user_id
     AND granted_at > now() - interval '24 hours';

  v_grant := LEAST(p_xp, GREATEST(0, v_daily_cap - v_today));
  IF v_grant <= 0 THEN RETURN; END IF;

  INSERT INTO public.xp_grant_log (user_id, amount) VALUES (p_user_id, v_grant);

  UPDATE public.user_profiles
     SET total_xp   = COALESCE(total_xp, 0) + v_grant,
         updated_at = now()
   WHERE id = p_user_id
   RETURNING total_xp INTO v_total_xp;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(MAX(level), 1) INTO v_level
    FROM public.xp_level_thresholds
   WHERE total_xp_required <= v_total_xp;

  UPDATE public.user_profiles SET current_level = v_level WHERE id = p_user_id;
END;
$function$;

-- The security boundary. Without these this function is a "give anyone XP"
-- endpoint over PostgREST, which is strictly worse than the bug it fixes.
REVOKE ALL ON FUNCTION public.award_xp_internal(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_xp_internal(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.award_xp_internal(uuid, integer) FROM authenticated;

-- ── The settler, with one line changed ──────────────────────────────────────
-- Everything else is byte-for-byte the installed body. Restating it in full is
-- deliberate: a later migration replacing this from a stale template is the
-- failure mode CLAUDE.md opens with, so the whole function is here rather than
-- a patch that reads correctly only next to its neighbour.
CREATE OR REPLACE FUNCTION public.gym_rival_settle_week()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID; v_owner UUID; v_rival UUID; v_accepted TIMESTAMPTZ; v_since TIMESTAMPTZ; v_type TEXT;
  v_net_a INT; v_net_b INT; v_winner UUID; v_loser UUID;
  v_xp INT; v_coins INT; v_caps INT; v_wemail TEXT; v_wname TEXT; v_lname TEXT; v_settled INT := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.gym_rival_assignments
     WHERE status = 'active' AND accepted_at IS NOT NULL
       AND date_trunc('week', accepted_at) + interval '7 days' <= now()
  LOOP
    SELECT user_id, rival_id, accepted_at, rival_type INTO v_owner, v_rival, v_accepted, v_type
      FROM public.gym_rival_assignments WHERE id = v_id;
    v_since := date_trunc('week', v_accepted);
    v_net_a := public.gym_rival_net_rating(v_owner, v_since, v_type);
    v_net_b := public.gym_rival_net_rating(v_rival, v_since, v_type);
    IF v_net_a > v_net_b THEN v_winner := v_owner; v_loser := v_rival;
    ELSIF v_net_b > v_net_a THEN v_winner := v_rival; v_loser := v_owner;
    ELSE v_winner := NULL; v_loser := NULL; END IF;

    IF v_winner IS NOT NULL THEN
      v_xp := 5000; v_coins := 500; v_caps := 5;
      -- WAS increment_user_xp(v_winner, v_xp), which raises 42501 with no
      -- session and credits the caller with one. See this file's header.
      PERFORM public.award_xp_internal(v_winner, v_xp);
      UPDATE public.user_profiles SET flex_coins = COALESCE(flex_coins, 0) + v_coins WHERE id = v_winner;
      SELECT email INTO v_wemail FROM auth.users WHERE id = v_winner;
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      SELECT v_winner, v_wemail, 'standard' FROM generate_series(1, v_caps);
      SELECT username INTO v_lname FROM public.user_profiles WHERE id = v_loser;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      SELECT v_winner, email, 'nemesis_overthrown', '🏆 You won your Rival week!',
        'You out-trained @' || COALESCE(v_lname, 'your rival') || '. +' || v_xp || ' XP, +' || v_coins || ' coins, ' || v_caps || ' capsules.',
        '🏆', '/workout', jsonb_build_object('assignment_id', v_id, 'result', 'win', 'xp', v_xp, 'coins', v_coins, 'capsules', v_caps)
      FROM auth.users WHERE id = v_winner;
      SELECT username INTO v_wname FROM public.user_profiles WHERE id = v_winner;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      SELECT v_loser, email, 'nemesis_overthrown', 'Your Rival week ended',
        '@' || COALESCE(v_wname, 'your rival') || ' edged you out this week. Roll a new rival and get them next time.',
        '🎯', '/workout', jsonb_build_object('assignment_id', v_id, 'result', 'loss')
      FROM auth.users WHERE id = v_loser;
    ELSE
      SELECT email INTO v_wemail FROM auth.users WHERE id = v_owner;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      VALUES (v_owner, v_wemail, 'nemesis_overthrown', 'Your Rival week ended in a draw',
        'Dead even — no winner this week. Roll a new rival.', '🤝', '/workout',
        jsonb_build_object('assignment_id', v_id, 'result', 'draw'));
      SELECT email INTO v_wemail FROM auth.users WHERE id = v_rival;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      VALUES (v_rival, v_wemail, 'nemesis_overthrown', 'Your Rival week ended in a draw',
        'Dead even — no winner this week. Roll a new rival.', '🤝', '/workout',
        jsonb_build_object('assignment_id', v_id, 'result', 'draw'));
    END IF;

    UPDATE public.gym_rival_assignments SET status = 'completed', winner_id = v_winner, settled_at = now() WHERE id = v_id;
    v_settled := v_settled + 1;
  END LOOP;
  RETURN v_settled;
END;
$function$;

-- ── Self-verification ───────────────────────────────────────────────────────
-- Seeds a real settleable match, runs the settler with NO session — the cron
-- context — checks every downstream effect, and rolls the seed back inside
-- its own savepoint so production is left exactly as it was.
--
-- Every boolean must read TRUE. `xp_went_to_the_winner` is the one that
-- matters most: it fails both if nobody was paid AND if the wrong person was.
DO $$
DECLARE
  v_a UUID; v_b UUID; v_ea TEXT; v_since TIMESTAMPTZ; v_asg UUID;
  v_xp_a BIGINT; v_xp_b BIGINT; v_n INT := -1;
  v_ok_settled BOOLEAN := FALSE; v_ok_xp BOOLEAN := FALSE;
  v_ok_notif BOOLEAN := FALSE; v_ok_caps BOOLEAN := FALSE; v_ok_coins BOOLEAN := FALSE;
  v_err TEXT := 'none';
BEGIN
  SELECT p.id, u.email INTO v_a, v_ea
    FROM public.user_profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email IS NOT NULL ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_b
    FROM public.user_profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email IS NOT NULL AND p.id <> v_a ORDER BY p.id LIMIT 1;

  IF v_a IS NULL OR v_b IS NULL THEN
    CREATE TEMP TABLE gym_rival_settle_check ON COMMIT DROP AS
      SELECT NULL::boolean AS settled_one, NULL::boolean AS xp_went_to_the_winner,
             NULL::boolean AS coins_paid, NULL::boolean AS capsules_granted,
             NULL::boolean AS both_notified, 'need two users with emails' AS note;
    RETURN;
  END IF;

  v_since := date_trunc('week', now() - interval '8 days');

  BEGIN
    INSERT INTO public.gym_rival_assignments
      (user_id, rival_id, assigned_at, status, overthrow_counted,
       initiator_confirmed, rival_confirmed, accepted_at, rival_type)
    VALUES (v_a, v_b, v_since, 'active', FALSE, TRUE, TRUE, v_since, 'gym')
    RETURNING id INTO v_asg;

    INSERT INTO public.workout_logs (user_id, created_by, created_at, exercises)
    VALUES (v_a, v_ea, v_since + interval '1 day',
            '[{"name":"Bench Press","sets":[{"weight":"225","reps":"10"}]}]'::jsonb);

    SELECT total_xp INTO v_xp_a FROM public.user_profiles WHERE id = v_a;
    SELECT total_xp INTO v_xp_b FROM public.user_profiles WHERE id = v_b;

    SELECT public.gym_rival_settle_week() INTO v_n;

    SELECT (status = 'completed' AND winner_id = v_a AND settled_at IS NOT NULL)
      INTO v_ok_settled FROM public.gym_rival_assignments WHERE id = v_asg;

    -- The winner gained XP and the loser did not. Catches "nobody paid" and
    -- "wrong person paid" with one assertion.
    SELECT (SELECT total_xp FROM public.user_profiles WHERE id = v_a) > v_xp_a
       AND (SELECT total_xp FROM public.user_profiles WHERE id = v_b) IS NOT DISTINCT FROM v_xp_b
      INTO v_ok_xp;

    SELECT EXISTS (SELECT 1 FROM public.xp_grant_log
                    WHERE user_id = v_a AND granted_at > now() - interval '1 minute')
      INTO v_ok_coins;

    -- user_capsules stamps `earned_at`, not created_at.
    SELECT (COUNT(*) = 5) INTO v_ok_caps
      FROM public.user_capsules
     WHERE user_id = v_a AND earned_at > now() - interval '1 minute';

    SELECT (COUNT(*) = 2) INTO v_ok_notif
      FROM public.notifications
     WHERE type = 'nemesis_overthrown' AND metadata->>'assignment_id' = v_asg::text;

    RAISE EXCEPTION 'rollback_seed';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM <> 'rollback_seed' THEN v_err := SQLSTATE || ' ' || SQLERRM; END IF;
  END;

  CREATE TEMP TABLE gym_rival_settle_check ON COMMIT DROP AS
    SELECT v_ok_settled AS settled_one, v_ok_xp AS xp_went_to_the_winner,
           v_ok_coins AS xp_ledger_written, v_ok_caps AS capsules_granted,
           v_ok_notif AS both_notified,
           'settled ' || v_n || ', error: ' || v_err AS note;
END;
$$;

SELECT * FROM gym_rival_settle_check;
