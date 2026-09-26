-- 252_one_crew_per_user_and_leaving.sql
--
-- A user belongs to one crew, and can leave the one they're in.
--
-- WHY ONE CREW
--
-- Everything 248-251 built assumes a crew is *your* crew. A division
-- placing, a war record, a treasury and a level only mean something if the
-- member is committed to one of them; somebody in four crews contributes
-- their training to four war scores at once, which makes every score a
-- measure of how many crews they joined rather than how hard they trained.
-- Migration 249 made scoring server-derived from workout_logs precisely so
-- the number would be honest, and multi-membership quietly undoes that.
--
-- ENFORCED IN TWO PLACES, ON PURPOSE
--
-- A BEFORE INSERT trigger on crew_members is the catch-all. It has to be,
-- because createCrew inserts a membership row straight from the client
-- rather than going through an RPC, and joinCrew still has a pre-075
-- fallback that does the same. A check that lives only in
-- join_crew_atomic would be trivially bypassed by the create path.
--
-- The RPCs also check first, so the common cases return a friendly reason
-- instead of a raw trigger exception. Same belt-and-braces shape as the
-- grants-plus-guard-triggers pattern in 246-251.
--
-- Note the trigger deliberately does NOT bypass for postgres. The join RPCs
-- are SECURITY DEFINER and therefore run as postgres, so a bypass would
-- make the trigger useless exactly where it matters most.
--
-- EXISTING DATA IS GRANDFATHERED
--
-- No UNIQUE constraint on crew_members(user_id), and nothing here deletes a
-- membership. At the time of writing one account is in three crews and
-- leads all three; a unique index would simply fail to build, and silently
-- dropping two of someone's crews is not a migration's decision to make.
-- The trigger only governs new rows, so that account keeps what it has and
-- can leave down to one whenever it wants.
--
-- LEAVING
--
--   * A sole leader with other members must promote somebody first —
--     otherwise the crew is left with nobody who can approve, ban or
--     enter a war. Same rule Nakama applies to a sole superadmin.
--   * The last member leaving deletes the crew, because an empty crew is a
--     zombie that still appears in discovery and can never be led.
--   * Except during an active war: the crew_wars foreign keys cascade, so
--     deleting a crew mid-war would delete the war row out from under the
--     opponent. That is refused until the war resolves.
--
-- Paste-safe per repo convention: schema-qualified table names, no
-- short table-alias column tokens, no record field access, and no bare
-- angle-bracket comparison operators anywhere in a statement body
-- (GREATEST / LEAST / NOT (a = b) are used instead).

-- ── 1. How many crews is this user in ────────────────────────────────
CREATE OR REPLACE FUNCTION public.crew_count_for(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $crew_count$
  SELECT COUNT(*)::integer FROM public.crew_members WHERE user_id = p_user_id;
$crew_count$;

REVOKE ALL ON FUNCTION public.crew_count_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crew_count_for(uuid) TO authenticated, service_role;

-- ── 2. The catch-all ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crew_members_one_crew()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $one_crew$
DECLARE
  v_have integer;
BEGIN
  SELECT COUNT(*) INTO v_have
    FROM public.crew_members
   WHERE user_id = NEW.user_id
     AND NOT (crew_id = NEW.crew_id);

  IF NOT (v_have = 0) THEN
    RAISE EXCEPTION 'already_in_crew' USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$one_crew$;

DROP TRIGGER IF EXISTS crew_members_one_crew_tr ON public.crew_members;
CREATE TRIGGER crew_members_one_crew_tr
  BEFORE INSERT ON public.crew_members
  FOR EACH ROW
  EXECUTE FUNCTION public.crew_members_one_crew();

-- ── 3. Joining checks first, so the error is friendly ────────────────
CREATE OR REPLACE FUNCTION public.join_crew_atomic(p_crew_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $join_crew$
DECLARE
  v_uid       uuid := auth.uid();
  v_public    boolean;
  v_cap       integer;
  v_count     integer;
  v_existing  integer;
  v_elsewhere integer;
  v_banned    integer;
  v_invited   integer;
  v_req       text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL THEN
    RAISE EXCEPTION 'crew_id required' USING ERRCODE = '22023';
  END IF;

  SELECT is_public, COALESCE(max_capacity, 16)
    INTO v_public, v_cap
    FROM public.crews
   WHERE id = p_crew_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'crew not found' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_existing
    FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = v_uid;

  IF NOT (v_existing = 0) THEN
    RETURN jsonb_build_object('success', TRUE, 'already_member', TRUE,
                              'status', 'already_member', 'crew_id', p_crew_id);
  END IF;

  -- One crew per user. Checked before the ban and invite branches so the
  -- reason returned is the one the member can actually act on.
  SELECT COUNT(*) INTO v_elsewhere
    FROM public.crew_members
   WHERE user_id = v_uid AND NOT (crew_id = p_crew_id);

  IF NOT (v_elsewhere = 0) THEN
    RAISE EXCEPTION 'already_in_crew' USING ERRCODE = '23505';
  END IF;

  SELECT COUNT(*) INTO v_banned
    FROM public.crew_bans
   WHERE crew_id = p_crew_id AND user_id = v_uid;

  IF NOT (v_banned = 0) THEN
    RAISE EXCEPTION 'banned_from_crew' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_invited
    FROM public.crew_invites
   WHERE crew_id = p_crew_id
     AND invited_user_id = v_uid
     AND accepted_at IS NULL
     AND expires_at = GREATEST(expires_at, now());

  IF v_public IS NOT TRUE AND v_invited = 0 THEN
    SELECT status INTO v_req
      FROM public.crew_join_requests
     WHERE crew_id = p_crew_id AND user_id = v_uid;

    IF v_req = 'pending' THEN
      RETURN jsonb_build_object('success', TRUE, 'already_member', FALSE,
                                'status', 'pending', 'crew_id', p_crew_id);
    END IF;

    INSERT INTO public.crew_join_requests (crew_id, user_id, status, created_at)
    VALUES (p_crew_id, v_uid, 'pending', now())
    ON CONFLICT (crew_id, user_id) DO UPDATE
      SET status = 'pending', created_at = now(),
          decided_by = NULL, decided_at = NULL;

    RETURN jsonb_build_object('success', TRUE, 'already_member', FALSE,
                              'status', 'requested', 'crew_id', p_crew_id);
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.crew_members
   WHERE crew_id = p_crew_id;

  IF v_count = GREATEST(v_count, v_cap) THEN
    RAISE EXCEPTION 'crew_full' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.crew_members (crew_id, user_id, is_admin, role)
  VALUES (p_crew_id, v_uid, FALSE, 'member');

  UPDATE public.crew_invites
     SET accepted_at = now()
   WHERE crew_id = p_crew_id AND invited_user_id = v_uid AND accepted_at IS NULL;

  RETURN jsonb_build_object('success', TRUE, 'already_member', FALSE,
                            'status', 'joined', 'crew_id', p_crew_id);
END;
$join_crew$;

REVOKE ALL ON FUNCTION public.join_crew_atomic(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_crew_atomic(uuid) TO authenticated;

-- ── 4. Approving somebody who joined elsewhere meanwhile ─────────────
CREATE OR REPLACE FUNCTION public.decide_crew_join_request(
  p_crew_id uuid,
  p_user_id uuid,
  p_approve boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $decide_join$
DECLARE
  v_uid       uuid := auth.uid();
  v_admin     integer;
  v_cap       integer;
  v_count     integer;
  v_elsewhere integer;
  v_state     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'crew_id and user_id required' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_admin
    FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = v_uid AND is_admin = TRUE;

  IF v_admin = 0 THEN
    RAISE EXCEPTION 'only a crew leader can decide join requests'
      USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_state
    FROM public.crew_join_requests
   WHERE crew_id = p_crew_id AND user_id = p_user_id;

  IF v_state IS NULL THEN
    RAISE EXCEPTION 'no such request' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_state = 'pending') THEN
    RETURN jsonb_build_object('ok', TRUE, 'status', v_state, 'changed', FALSE);
  END IF;

  IF p_approve IS NOT TRUE THEN
    UPDATE public.crew_join_requests
       SET status = 'rejected', decided_by = v_uid, decided_at = now()
     WHERE crew_id = p_crew_id AND user_id = p_user_id;
    RETURN jsonb_build_object('ok', TRUE, 'status', 'rejected', 'changed', TRUE);
  END IF;

  -- They may have joined somewhere else between asking and being approved.
  SELECT COUNT(*) INTO v_elsewhere
    FROM public.crew_members
   WHERE user_id = p_user_id AND NOT (crew_id = p_crew_id);

  IF NOT (v_elsewhere = 0) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'already_in_crew');
  END IF;

  SELECT COALESCE(max_capacity, 16) INTO v_cap
    FROM public.crews WHERE id = p_crew_id FOR UPDATE;

  SELECT COUNT(*) INTO v_count
    FROM public.crew_members WHERE crew_id = p_crew_id;

  IF v_count = GREATEST(v_count, v_cap) THEN
    RAISE EXCEPTION 'crew_full' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.crew_members (crew_id, user_id, is_admin, role)
  VALUES (p_crew_id, p_user_id, FALSE, 'member')
  ON CONFLICT DO NOTHING;

  UPDATE public.crew_join_requests
     SET status = 'approved', decided_by = v_uid, decided_at = now()
   WHERE crew_id = p_crew_id AND user_id = p_user_id;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'approved', 'changed', TRUE);
END;
$decide_join$;

REVOKE ALL ON FUNCTION public.decide_crew_join_request(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_crew_join_request(uuid, uuid, boolean) TO authenticated;

-- ── 5. Leaving ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.leave_crew(p_crew_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $leave_crew$
DECLARE
  v_uid      uuid := auth.uid();
  v_member   integer;
  v_leader   boolean;
  v_leaders  integer;
  v_members  integer;
  v_war      integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL THEN
    RAISE EXCEPTION 'crew_id required' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_member
    FROM public.crew_members WHERE crew_id = p_crew_id AND user_id = v_uid;

  IF v_member = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'not_a_member');
  END IF;

  SELECT is_admin INTO v_leader
    FROM public.crew_members WHERE crew_id = p_crew_id AND user_id = v_uid;

  SELECT COUNT(*) INTO v_members
    FROM public.crew_members WHERE crew_id = p_crew_id;

  SELECT COUNT(*) INTO v_leaders
    FROM public.crew_members WHERE crew_id = p_crew_id AND is_admin = TRUE;

  -- A crew with members but no leader can't approve, ban or enter a war.
  IF v_leader IS TRUE AND v_leaders = 1 AND NOT (v_members = 1) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'promote_first');
  END IF;

  IF v_members = 1 THEN
    -- Last one out deletes the crew. crew_wars cascades on both crew
    -- columns, so doing that mid-war would delete the war out from under
    -- the opponent -- refuse until it resolves.
    SELECT COUNT(*) INTO v_war
      FROM public.crew_wars
     WHERE status IN ('matchmaking', 'active')
       AND (crew_a_id = p_crew_id OR crew_b_id = p_crew_id);

    IF NOT (v_war = 0) THEN
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'active_war');
    END IF;

    DELETE FROM public.crew_members WHERE crew_id = p_crew_id AND user_id = v_uid;
    DELETE FROM public.crews WHERE id = p_crew_id;

    RETURN jsonb_build_object('ok', TRUE, 'left', TRUE, 'crew_deleted', TRUE);
  END IF;

  DELETE FROM public.crew_members WHERE crew_id = p_crew_id AND user_id = v_uid;

  RETURN jsonb_build_object('ok', TRUE, 'left', TRUE, 'crew_deleted', FALSE);
END;
$leave_crew$;

REVOKE ALL ON FUNCTION public.leave_crew(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_crew(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
