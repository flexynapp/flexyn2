-- 358_crew_war_start_is_leader_only.sql
--
-- Starting a crew war goes back to LEADER ONLY. Kegan's call, 2026-08-15.
--
-- Migration 357 put it at rank 2 on the reasoning that entering
-- matchmaking is operational rather than structural — the same place
-- Clash of Clans puts it. That was my judgement call filling a gap in the
-- brief, which named only what a MEMBER may not do; the decision is the
-- product owner's and it is now made. Rank 3 only.
--
-- WHY THIS IS A NEW FILE AND NOT AN EDIT TO 357
--
-- 357 is applied in production. Editing it would leave the file and the
-- database describing different functions, and a later migration
-- redefining a function is invisible in the file that "owns" the feature
-- — which is precisely how push notifications sat dead for months (see
-- the top of CLAUDE.md). So 357 stays as the record of what was applied,
-- and this supersedes two of its function bodies.
--
--   join_crew_war_queue   rank 2 -> rank 3
--   leave_crew_war_queue  rank 2 -> rank 3
--
-- Nothing else about 357 changes: moderators keep pinning, deleting any
-- message, assigning regimens, crew challenges, roll call and removing
-- rank-1 members. Only the war gate moves.
--
-- The matchmaking body below is byte-identical to 356/357 — the profile
-- snapshot, crew_match_gap ranking and patience widening are untouched.
-- Only the permission check at the top differs, and only in the one
-- comparison. Mirrored in src/lib/crewPermissions.js.
--
-- Paste-safe per repo convention.

CREATE OR REPLACE FUNCTION public.join_crew_war_queue(p_crew_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $join_crew_war_queue$
DECLARE
  v_uid       uuid := auth.uid();
  v_rank      integer;
  v_members   integer;
  v_existing  uuid;
  v_opponent  uuid;
  v_my_div    integer;
  v_my_age    numeric;
  v_my_str    numeric;
  v_my_cad    numeric;
  v_claimed   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL THEN
    RAISE EXCEPTION 'crew_id required' USING ERRCODE = '22023';
  END IF;

  v_rank := public.crew_rank(p_crew_id, v_uid);

  IF NOT (v_rank = 3) THEN
    RAISE EXCEPTION 'only a crew leader can enter matchmaking'
      USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_members
    FROM public.crew_members
   WHERE crew_id = p_crew_id;

  IF v_members = LEAST(v_members, 1) THEN
    RAISE EXCEPTION 'crew needs at least two members to battle'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existing
    FROM public.crew_wars
   WHERE status IN ('matchmaking', 'active')
     AND (crew_a_id = p_crew_id OR crew_b_id = p_crew_id)
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'status', 'already_queued',
                              'war_id', v_existing);
  END IF;

  PERFORM public.ensure_crew_season_entry(p_crew_id);

  SELECT COALESCE(MIN(division), 1) INTO v_my_div
    FROM public.crew_season_stats
   WHERE crew_id = p_crew_id
     AND season_id = public.current_crew_season();

  v_my_age := public.crew_match_age(p_crew_id);
  v_my_str := public.crew_match_strength(p_crew_id);
  v_my_cad := public.crew_match_cadence(p_crew_id);

  FOR v_opponent IN
    SELECT w_id FROM (
      SELECT
        id AS w_id,
        created_at AS w_since,
        public.crew_match_gap(
          v_members, v_my_age, v_my_str, v_my_cad, v_my_div,
          match_roster, match_age, match_strength, match_cadence, match_division
        ) AS w_gap,
        FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 43200) AS w_patience
      FROM public.crew_wars
      WHERE crew_b_id IS NULL
        AND status = 'matchmaking'
        AND NOT (crew_a_id = p_crew_id)
      LIMIT 50
    ) AS candidates
    WHERE w_gap = LEAST(w_gap, 0.15 + 0.15 * w_patience)
    ORDER BY w_gap, w_since
    LIMIT 5
  LOOP
    UPDATE public.crew_wars
       SET crew_b_id    = p_crew_id,
           status       = 'active',
           starts_at    = now(),
           ends_at      = now() + INTERVAL '7 days',
           crew_a_score = 0,
           crew_b_score = 0
     WHERE id = v_opponent
       AND crew_b_id IS NULL
       AND status = 'matchmaking';

    GET DIAGNOSTICS v_claimed = ROW_COUNT;

    IF v_claimed = 1 THEN
      PERFORM public.notify_crew_war_started_for(v_opponent);
      RETURN jsonb_build_object('ok', TRUE, 'status', 'matched',
                                'war_id', v_opponent);
    END IF;
  END LOOP;

  INSERT INTO public.crew_wars
    (crew_a_id, crew_b_id, status,
     match_roster, match_age, match_strength, match_cadence, match_division)
  VALUES
    (p_crew_id, NULL, 'matchmaking',
     v_members, v_my_age, v_my_str, v_my_cad, v_my_div)
  RETURNING id INTO v_existing;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'queued',
                            'war_id', v_existing);
END;
$join_crew_war_queue$;

CREATE OR REPLACE FUNCTION public.leave_crew_war_queue(p_crew_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $leave_crew_war_queue$
DECLARE
  v_uid     uuid := auth.uid();
  v_rank    integer;
  v_removed integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_rank := public.crew_rank(p_crew_id, v_uid);

  IF NOT (v_rank = 3) THEN
    RAISE EXCEPTION 'only a crew leader can leave the queue'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.crew_wars
   WHERE crew_a_id = p_crew_id
     AND crew_b_id IS NULL
     AND status = 'matchmaking';

  GET DIAGNOSTICS v_removed = ROW_COUNT;

  RETURN jsonb_build_object('ok', TRUE, 'removed', v_removed);
END;
$leave_crew_war_queue$;
