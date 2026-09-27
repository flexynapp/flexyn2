-- Gym Rival: a match is seven days from acceptance, scored exactly, and a
-- no-show loses instead of cancelling the week.
--
-- Audited 2026-09-27 against the installed bodies. The contest is honest
-- input by design (plausibility is a flag, see CLAUDE.md), so the question
-- was whether honest input produces the honest winner. Four ways it did not:
--
-- 1. The window was the CALENDAR WEEK of acceptance, not the match.
--    date_trunc('week', accepted_at) counted every session since Monday,
--    including ones logged before the match existed, and ended on Sunday
--    night. Accept on a Friday having trained Monday to Thursday and you
--    started four sessions up; accept on a Sunday and the match lasted one
--    day. The pending screen promised "This week starts level", which was
--    false. Now: [accepted_at, accepted_at + 7 days), for display, AFK
--    check and payout alike, by created_at so a session is counted when it
--    was logged and cannot be backdated into or out of a match.
--
-- 2. Payout and display used different windows. week_state bounded the
--    week; settlement read net_rating with NO end, so anything logged
--    between Sunday midnight and the Monday cron counted toward the payout
--    and not the screen. Both now call gym_rival_score with the same bounds.
--
-- 3. Scores were rounded before comparing: volume / 100 and km * 20 to
--    integers, so a 99 lb or a 49 m lead was a draw. Now the raw lbs or
--    metres decide, and a draw is an exact tie.
--
-- 4. The 48h AFK rule voided the week if EITHER side had not logged, so the
--    person who showed up lost the match along with the one who did not.
--    Now the week is voided only when NEITHER has logged by then. If one has,
--    the match runs its seven days, the absent side can still come back, and
--    if they never log the other wins a walkover: it counts on the record
--    but pays 1,000 XP, 100 coins and 1 capsule rather than the full 5,000 /
--    500 / 5, so a second account that accepts and never trains is not
--    worth farming.
--
-- And one engagement gap: nothing told you when your rival moved. A
-- trigger on workout_logs and cardio_logs now tells the other side when
-- someone takes the lead, at most once per lead change. It can never block
-- a save: any error inside it is swallowed.

ALTER TABLE public.gym_rival_assignments ADD COLUMN IF NOT EXISTS leader_id uuid;

-- ── Score ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.gym_rival_score(
  p_uid uuid, p_type text, p_from timestamptz, p_to timestamptz)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v NUMERIC := 0;
BEGIN
  IF p_type = 'cardio' THEN
    SELECT COALESCE(SUM(distance_meters), 0) INTO v
      FROM public.cardio_logs
     WHERE user_id = p_uid AND created_at >= p_from AND created_at < p_to;
  ELSE
    v := public.gym_rival_volume_lbs(p_uid, p_from, p_to);
  END IF;
  RETURN COALESCE(v, 0);
END;
$$;
ALTER FUNCTION public.gym_rival_score(uuid, text, timestamptz, timestamptz) OWNER TO postgres;
-- Takes any user id and returns their training volume; internal only.
REVOKE ALL ON FUNCTION public.gym_rival_score(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gym_rival_score(uuid, text, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.gym_rival_has_logged(
  p_uid uuid, p_type text, p_from timestamptz, p_to timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN p_type = 'cardio' THEN
    EXISTS (SELECT 1 FROM public.cardio_logs
             WHERE user_id = p_uid AND created_at >= p_from AND created_at < p_to)
  ELSE
    EXISTS (SELECT 1 FROM public.workout_logs
             WHERE user_id = p_uid AND created_at >= p_from AND created_at < p_to)
  END;
$$;
ALTER FUNCTION public.gym_rival_has_logged(uuid, text, timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gym_rival_has_logged(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gym_rival_has_logged(uuid, text, timestamptz, timestamptz) TO service_role;

-- ── What the menu shows ──────────────────────────────────────────────────
-- Same columns as before so the client is unchanged; only the window moves.

CREATE OR REPLACE FUNCTION public.gym_rival_week_state(p_assignment_id uuid)
RETURNS TABLE(week_since timestamptz, week_ends timestamptz, you_volume numeric, them_volume numeric,
              you_distance numeric, them_distance numeric, you_logged boolean, them_logged boolean,
              afk_deadline timestamptz, is_stalled boolean, you_bw_missing boolean, them_bw_missing boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID; v_rival UUID; v_status TEXT; v_type TEXT;
  v_accepted TIMESTAMPTZ; v_assigned TIMESTAMPTZ;
  v_you UUID; v_them UUID;
  v_since TIMESTAMPTZ; v_ends TIMESTAMPTZ; v_deadline TIMESTAMPTZ;
  v_yv NUMERIC := 0; v_tv NUMERIC := 0; v_yd NUMERIC := 0; v_td NUMERIC := 0;
  v_yl BOOLEAN := FALSE; v_tl BOOLEAN := FALSE; v_stalled BOOLEAN := FALSE;
  v_ybw BOOLEAN := FALSE; v_tbw BOOLEAN := FALSE;
  v_w NUMERIC; v_bwsets INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT user_id, rival_id, status, rival_type, accepted_at, assigned_at
    INTO v_owner, v_rival, v_status, v_type, v_accepted, v_assigned
    FROM public.gym_rival_assignments WHERE id = p_assignment_id;

  IF v_owner IS NULL OR (v_uid <> v_owner AND v_uid <> v_rival) THEN
    RAISE EXCEPTION 'not_part_of_match' USING ERRCODE = '42501';
  END IF;

  IF v_uid = v_owner THEN v_you := v_owner; v_them := v_rival;
  ELSE v_you := v_rival; v_them := v_owner; END IF;

  v_stalled  := (v_status = 'active' AND v_accepted IS NULL);
  -- Before acceptance nothing counts yet, so the window starts "now" and
  -- both sides read zero, which is what "starts level" means.
  v_since    := COALESCE(v_accepted, now());
  v_ends     := v_since + interval '7 days';
  v_deadline := v_accepted + interval '48 hours';

  v_yv := public.gym_rival_score(v_you,  'gym', v_since, v_ends);
  v_tv := public.gym_rival_score(v_them, 'gym', v_since, v_ends);
  v_yd := public.gym_rival_score(v_you,  'cardio', v_since, v_ends);
  v_td := public.gym_rival_score(v_them, 'cardio', v_since, v_ends);

  IF v_accepted IS NOT NULL THEN
    v_yl := public.gym_rival_has_logged(v_you,  v_type, v_since, v_ends);
    v_tl := public.gym_rival_has_logged(v_them, v_type, v_since, v_ends);
  END IF;

  IF v_type <> 'cardio' THEN
    SELECT weight_lbs INTO v_w FROM public.user_profiles WHERE id = v_you;
    SELECT COUNT(*) INTO v_bwsets
      FROM public.workout_logs,
           jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
           jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
     WHERE user_id = v_you AND created_at >= v_since AND created_at < v_ends
       AND public.bodyweight_load_factor(ex->>'name') > 0;
    v_ybw := (COALESCE(v_w, 0) <= 0 AND COALESCE(v_bwsets, 0) > 0);

    SELECT weight_lbs INTO v_w FROM public.user_profiles WHERE id = v_them;
    SELECT COUNT(*) INTO v_bwsets
      FROM public.workout_logs,
           jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
           jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
     WHERE user_id = v_them AND created_at >= v_since AND created_at < v_ends
       AND public.bodyweight_load_factor(ex->>'name') > 0;
    v_tbw := (COALESCE(v_w, 0) <= 0 AND COALESCE(v_bwsets, 0) > 0);
  END IF;

  RETURN QUERY SELECT v_since, v_ends, v_yv, v_tv, v_yd, v_td, v_yl, v_tl,
                      v_deadline, v_stalled, v_ybw, v_tbw;
END;
$$;

-- ── AFK: void only when nobody showed up ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.gym_rival_void_stale(p_assignment_id uuid)
RETURNS SETOF gym_rival_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID; v_rival UUID; v_status TEXT; v_type TEXT; v_accepted TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, rival_id, status, rival_type, accepted_at
    INTO v_owner, v_rival, v_status, v_type, v_accepted
    FROM public.gym_rival_assignments
   WHERE id = p_assignment_id;

  IF v_owner IS NULL OR (v_uid <> v_owner AND v_uid <> v_rival) THEN
    RAISE EXCEPTION 'not_part_of_match' USING ERRCODE = '42501';
  END IF;

  IF v_status = 'active' AND v_accepted IS NOT NULL
     AND now() >= v_accepted + interval '48 hours'
     AND NOT public.gym_rival_has_logged(v_owner, v_type, v_accepted, v_accepted + interval '7 days')
     AND NOT public.gym_rival_has_logged(v_rival, v_type, v_accepted, v_accepted + interval '7 days') THEN
    UPDATE public.gym_rival_assignments SET status = 'void' WHERE id = p_assignment_id;
  END IF;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = p_assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.gym_rival_void_stale_all()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count INT;
BEGIN
  UPDATE public.gym_rival_assignments a
     SET status = 'void'
   WHERE a.status = 'active'
     AND a.accepted_at IS NOT NULL
     AND now() >= a.accepted_at + interval '48 hours'
     AND NOT public.gym_rival_has_logged(a.user_id,  a.rival_type, a.accepted_at, a.accepted_at + interval '7 days')
     AND NOT public.gym_rival_has_logged(a.rival_id, a.rival_type, a.accepted_at, a.accepted_at + interval '7 days');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── Settlement ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.gym_rival_settle_week()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id UUID; v_owner UUID; v_rival UUID; v_accepted TIMESTAMPTZ; v_ends TIMESTAMPTZ; v_type TEXT;
  v_a NUMERIC; v_b NUMERIC; v_loser_score NUMERIC; v_winner UUID; v_loser UUID;
  v_walkover BOOLEAN;
  v_xp INT; v_coins INT; v_caps INT; v_wemail TEXT; v_wname TEXT; v_lname TEXT; v_settled INT := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.gym_rival_assignments
     WHERE status = 'active' AND accepted_at IS NOT NULL
       AND accepted_at + interval '7 days' <= now()
  LOOP
    SELECT user_id, rival_id, accepted_at, rival_type INTO v_owner, v_rival, v_accepted, v_type
      FROM public.gym_rival_assignments WHERE id = v_id;
    v_ends := v_accepted + interval '7 days';
    v_a := public.gym_rival_score(v_owner, v_type, v_accepted, v_ends);
    v_b := public.gym_rival_score(v_rival, v_type, v_accepted, v_ends);

    IF v_a > v_b THEN v_winner := v_owner; v_loser := v_rival; v_loser_score := v_b;
    ELSIF v_b > v_a THEN v_winner := v_rival; v_loser := v_owner; v_loser_score := v_a;
    ELSE v_winner := NULL; v_loser := NULL; END IF;

    IF v_winner IS NOT NULL THEN
      -- A loser who logged nothing all week is a walkover: it counts, but a
      -- second account that accepts and never trains is not worth farming.
      v_walkover := NOT public.gym_rival_has_logged(v_loser, v_type, v_accepted, v_ends);
      IF v_walkover THEN v_xp := 1000; v_coins := 100; v_caps := 1;
      ELSE v_xp := 5000; v_coins := 500; v_caps := 5; END IF;

      PERFORM public.award_xp_internal(v_winner, v_xp);
      UPDATE public.user_profiles SET flex_coins = COALESCE(flex_coins, 0) + v_coins WHERE id = v_winner;
      SELECT email INTO v_wemail FROM auth.users WHERE id = v_winner;
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      SELECT v_winner, v_wemail, 'standard' FROM generate_series(1, v_caps);
      SELECT username INTO v_lname FROM public.user_profiles WHERE id = v_loser;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      SELECT v_winner, email, 'nemesis_overthrown',
        CASE WHEN v_walkover THEN 'You won your Rival week by walkover' ELSE '🏆 You won your Rival week!' END,
        CASE WHEN v_walkover
          THEN '@' || COALESCE(v_lname, 'Your rival') || ' never logged a session. +' || v_xp || ' XP, +' || v_coins || ' coins, ' || v_caps || ' capsule.'
          ELSE 'You out-trained @' || COALESCE(v_lname, 'your rival') || '. +' || v_xp || ' XP, +' || v_coins || ' coins, ' || v_caps || ' capsules.' END,
        '🏆', '/workout',
        jsonb_build_object('assignment_id', v_id, 'result', CASE WHEN v_walkover THEN 'walkover' ELSE 'win' END,
                           'xp', v_xp, 'coins', v_coins, 'capsules', v_caps)
      FROM auth.users WHERE id = v_winner;
      SELECT username INTO v_wname FROM public.user_profiles WHERE id = v_winner;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      SELECT v_loser, email, 'nemesis_overthrown', 'Your Rival week ended',
        CASE WHEN v_walkover
          THEN 'No session was logged, so @' || COALESCE(v_wname, 'your rival') || ' took the week. Roll a new rival when you''re ready.'
          ELSE '@' || COALESCE(v_wname, 'your rival') || ' edged you out this week. Roll a new rival and get them next time.' END,
        '🎯', '/workout', jsonb_build_object('assignment_id', v_id, 'result', 'loss')
      FROM auth.users WHERE id = v_loser;
    ELSE
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      SELECT u.id, u.email, 'nemesis_overthrown', 'Your Rival week ended in a draw',
        'Dead even, so no winner this week. Roll a new rival.', '🤝', '/workout',
        jsonb_build_object('assignment_id', v_id, 'result', 'draw')
      FROM auth.users u WHERE u.id IN (v_owner, v_rival);
    END IF;

    UPDATE public.gym_rival_assignments SET status = 'completed', winner_id = v_winner, settled_at = now() WHERE id = v_id;
    v_settled := v_settled + 1;
  END LOOP;
  RETURN v_settled;
END;
$$;

-- The window no longer ends on a Monday, so settle hourly rather than once
-- a week or a match accepted on Tuesday waits six days for its result.
SELECT cron.schedule('gym-rival-settle', '5 * * * *', $$SELECT public.gym_rival_settle_week();$$);

-- ── Lead changes ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.gym_rival_on_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_type TEXT := CASE WHEN TG_TABLE_NAME = 'cardio_logs' THEN 'cardio' ELSE 'gym' END;
  v_id UUID; v_owner UUID; v_rival UUID; v_accepted TIMESTAMPTZ; v_prev UUID;
  v_me UUID := NEW.user_id; v_other UUID;
  v_mine NUMERIC; v_theirs NUMERIC; v_leader UUID; v_name TEXT;
BEGIN
  IF v_me IS NULL THEN RETURN NULL; END IF;

  SELECT id, user_id, rival_id, accepted_at, leader_id
    INTO v_id, v_owner, v_rival, v_accepted, v_prev
    FROM public.gym_rival_assignments
   WHERE status = 'active' AND accepted_at IS NOT NULL
     AND rival_type = v_type
     AND now() < accepted_at + interval '7 days'
     AND (user_id = v_me OR rival_id = v_me)
   ORDER BY accepted_at DESC
   LIMIT 1
   FOR UPDATE;
  IF v_id IS NULL THEN RETURN NULL; END IF;

  v_other  := CASE WHEN v_me = v_owner THEN v_rival ELSE v_owner END;
  v_mine   := public.gym_rival_score(v_me,    v_type, v_accepted, v_accepted + interval '7 days');
  v_theirs := public.gym_rival_score(v_other, v_type, v_accepted, v_accepted + interval '7 days');
  v_leader := CASE WHEN v_mine > v_theirs THEN v_me WHEN v_theirs > v_mine THEN v_other ELSE NULL END;

  IF v_leader IS NOT DISTINCT FROM v_prev OR v_leader IS NULL THEN RETURN NULL; END IF;

  UPDATE public.gym_rival_assignments SET leader_id = v_leader WHERE id = v_id;

  -- Only a lead TAKEN is news, and only to the person who lost it. An edit
  -- that hands the lead back just updates the row.
  IF v_leader = v_me THEN
    SELECT username INTO v_name FROM public.user_profiles WHERE id = v_me;
    INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
    SELECT v_other, email, 'nemesis_overthrown',
      '@' || COALESCE(v_name, 'Your rival') || ' just took the lead',
      'Your Rival week is still open. Log a session to take it back.',
      '⚔️', '/workout',
      jsonb_build_object('assignment_id', v_id, 'result', 'lead_change')
    FROM auth.users WHERE id = v_other;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A rival notification is never worth losing a workout over.
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.gym_rival_on_log() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gym_rival_on_log() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS gym_rival_on_workout_log ON public.workout_logs;
CREATE TRIGGER gym_rival_on_workout_log
  AFTER INSERT OR UPDATE OF exercises ON public.workout_logs
  FOR EACH ROW EXECUTE FUNCTION public.gym_rival_on_log();

DROP TRIGGER IF EXISTS gym_rival_on_cardio_log ON public.cardio_logs;
CREATE TRIGGER gym_rival_on_cardio_log
  AFTER INSERT OR UPDATE OF distance_meters ON public.cardio_logs
  FOR EACH ROW EXECUTE FUNCTION public.gym_rival_on_log();

-- ── Attempt it ───────────────────────────────────────────────────────────
-- Seeded on throwaway ids and rolled back by the closing RAISE. No real
-- user is touched, and nobody seeded has an auth.users row, so no
-- notification is written.

DO $$
DECLARE
  a UUID := gen_random_uuid();
  b UUID := gen_random_uuid();
  m UUID;
  v_acc TIMESTAMPTZ := now() - interval '3 days';
  v_status TEXT;
  set10 JSONB := '[{"name":"Bench Press","sets":[{"weight":"100","reps":"10"}]}]';
BEGIN
  BEGIN
    INSERT INTO public.gym_rival_assignments
      (user_id, rival_id, status, rival_type, initiator_confirmed, rival_confirmed, accepted_at)
    VALUES (a, b, 'active', 'gym', TRUE, TRUE, v_acc)
    RETURNING id INTO m;

    -- Logged before the match began: must not count.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, set10, v_acc - interval '1 hour');
    IF public.gym_rival_score(a, 'gym', v_acc, v_acc + interval '7 days') <> 0 THEN
      RAISE EXCEPTION 'probe: a pre-match session counted';
    END IF;

    -- One side logs inside the window: 1,000 lb, and they take the lead.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, set10, v_acc + interval '1 hour');
    IF public.gym_rival_score(a, 'gym', v_acc, v_acc + interval '7 days') <> 1000 THEN
      RAISE EXCEPTION 'probe: in-window volume was %, expected 1000',
        public.gym_rival_score(a, 'gym', v_acc, v_acc + interval '7 days');
    END IF;
    IF (SELECT leader_id FROM public.gym_rival_assignments WHERE id = m) IS DISTINCT FROM a THEN
      RAISE EXCEPTION 'probe: lead change was not recorded';
    END IF;

    -- 48h passed and only one side logged: the match must stay live.
    PERFORM public.gym_rival_void_stale_all();
    SELECT status INTO v_status FROM public.gym_rival_assignments WHERE id = m;
    IF v_status <> 'active' THEN
      RAISE EXCEPTION 'probe: a one-sided match was voided (%)', v_status;
    END IF;

    -- Nobody logged: that one does void.
    UPDATE public.gym_rival_assignments SET user_id = gen_random_uuid() WHERE id = m;
    PERFORM public.gym_rival_void_stale_all();
    SELECT status INTO v_status FROM public.gym_rival_assignments WHERE id = m;
    IF v_status <> 'void' THEN
      RAISE EXCEPTION 'probe: a match nobody trained in was not voided (%)', v_status;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$$;
