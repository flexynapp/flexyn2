-- 357_crew_ranks_and_the_door.sql
--
-- Crew ranks 1-3, and the hole that made them decorative.
--
-- THE HOLE, PROVED BEFORE IT WAS FIXED
--
-- `crew_members` had exactly one INSERT policy:
--
--     crew_members_insert  WITH CHECK (user_id = auth.uid())
--
-- It constrains WHICH USER the row is for and says nothing about WHICH
-- CREW or WHICH RANK. `crew_members_sync_role` then does
-- `NEW.role := COALESCE(NEW.role, ...)` on INSERT, so a client-supplied
-- role is KEPT and `is_admin` is derived from it.
--
-- Executed against production as a real authenticated guest account with
-- no invite, against a crew with is_public = FALSE:
--
--     INSERT INTO public.crew_members (crew_id, user_id, is_admin, role)
--     VALUES ('<a private crew>', '<me>', TRUE, 'leader');
--     -- accepted. is_crew_admin('<that crew>') then returned TRUE.
--
-- Two separate failures in one statement: any signed-in user could join
-- any crew by id, private or not, bypassing capacity, bans and join
-- requests; and could name their own rank on the way in. `is_crew_admin`
-- gates editing the crew, assigning regimens, creating challenges,
-- kicking members, changing roles and starting wars — so this was full
-- control of any crew whose id you had seen. Rolled back; nothing was
-- left behind.
--
-- The policy was never load-bearing. `join_crew_atomic` (mig 075/250) is
-- SECURITY DEFINER, checks capacity under a row lock, honours bans and
-- private-crew join requests, and hardcodes `FALSE, 'member'`. The direct
-- INSERT existed only as the pre-075 fallback in joinCrew, plus the
-- founder row in createCrew, which is what this migration replaces.
--
-- THE RANKS
--
--     3  leader     every permission
--     2  moderator  runs the crew day to day; cannot change who runs it
--     1  member     trains, talks and fights; changes nothing
--
-- The names already existed in `crew_members.role` and a legacy is_admin
-- boolean sits beside them, kept in step by the 250 trigger. What did not
-- exist was an ORDERING, so "can this person act on that person" had no
-- answer and every gate collapsed to admin-or-not. `crew_rank` is that
-- ordering, and every policy below compares numbers.
--
-- WHERE THE LINE SITS
--
-- Starting a war moves from leader to moderator: it is an operational act
-- with a seven-day clock, not a structural one. Everything that changes
-- the crew's IDENTITY (name, tag, avatar, privacy) or its ROSTER
-- STRUCTURE (who is a moderator) stays leader-only, because those are the
-- acts a member cannot undo by leaving. Mirrored in
-- src/lib/crewPermissions.js, which decides which controls render; that
-- file is not enforcement and says so.
--
-- Paste-safe per repo convention: schema-qualified tables, no
-- alias.column tokens, no record field access, no bare <> operators.

-- ── 1. Rank ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crew_rank(p_crew_id uuid, p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $crew_rank$
  SELECT COALESCE(MAX(
           CASE
             WHEN role = 'leader'    THEN 3
             WHEN role = 'moderator' THEN 2
             WHEN is_admin           THEN 3
             ELSE 1
           END), 0)
    FROM public.crew_members
   WHERE crew_id = p_crew_id
     AND user_id = p_user_id;
$crew_rank$;

-- The caller's own rank. Safe to expose — it answers only about the
-- person asking, and returns 0 for a crew they do not belong to.
CREATE OR REPLACE FUNCTION public.my_crew_rank(p_crew_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $my_crew_rank$
  SELECT public.crew_rank(p_crew_id, auth.uid());
$my_crew_rank$;

-- crew_rank takes the user as a parameter, so it answers "what rank is X
-- in crew Y" for pairs the caller is not part of. Internal only, same
-- reasoning as is_blocked in CLAUDE.md.
--
-- CONSEQUENCE, and it is not obvious: nothing running as `authenticated`
-- may call it. That rules it out of RLS policies (evaluated as the
-- querying role) and out of SECURITY INVOKER trigger bodies. A first cut
-- of this migration used it in both, and the probe caught it — the
-- function does not return false, it RAISES 42501, and a throwing
-- permissive policy takes the whole statement with it. The DELETE policy
-- would have refused a member LEAVING THEIR OWN CREW, and the guard
-- trigger would have refused every promotion including a leader's.
--
-- So anything a client role has to evaluate gets a purpose-built helper
-- that derives the actor from auth.uid() and answers only about them.
REVOKE ALL ON FUNCTION public.crew_rank(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_crew_rank(uuid) TO authenticated;

-- "May I remove this person from this crew?" — never a general rank
-- probe. Leaving is always yours; a leader may remove anyone below them;
-- a moderator may remove plain members only. Equal ranks cannot remove
-- each other, so two moderators cannot race to eject one another.
CREATE OR REPLACE FUNCTION public.can_remove_crew_member(p_crew_id uuid, p_target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $can_remove_crew_member$
  SELECT p_target = auth.uid()
      OR (public.crew_rank(p_crew_id, auth.uid())
            = GREATEST(public.crew_rank(p_crew_id, auth.uid()), 2)
          AND public.crew_rank(p_crew_id, auth.uid())
                > public.crew_rank(p_crew_id, p_target));
$can_remove_crew_member$;

GRANT EXECUTE ON FUNCTION public.can_remove_crew_member(uuid, uuid) TO authenticated;

-- is_crew_moderator predates this and already means rank >= 2. Restated
-- in terms of crew_rank so there is one definition of the ordering.
CREATE OR REPLACE FUNCTION public.is_crew_moderator(p_crew_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $is_crew_moderator$
  SELECT public.crew_rank(p_crew_id, auth.uid()) = GREATEST(public.crew_rank(p_crew_id, auth.uid()), 2);
$is_crew_moderator$;

-- ── 2. Creating a crew — the founder's door ──────────────────────────
--
-- createCrew inserted the crews row and then the founder's membership as
-- two separate client statements, with a client-side DELETE to clean up
-- if the second failed. That compensating delete can itself fail, and an
-- orphaned crew with no members is unreachable and unremovable. One RPC,
-- one transaction, and the client INSERT can then be revoked.

CREATE OR REPLACE FUNCTION public.create_crew_atomic(p_name text)
RETURNS public.crews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $create_crew_atomic$
DECLARE
  v_uid  uuid := auth.uid();
  v_have integer;
  v_crew public.crews;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'crew name required' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_have
    FROM public.crew_members
   WHERE user_id = v_uid;

  IF NOT (v_have = 0) THEN
    RAISE EXCEPTION 'already_in_crew' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.crews (name, created_by)
  VALUES (btrim(p_name), v_uid)
  RETURNING * INTO v_crew;

  INSERT INTO public.crew_members (crew_id, user_id, is_admin, role)
  VALUES (v_crew.id, v_uid, TRUE, 'leader');

  RETURN v_crew;
END;
$create_crew_atomic$;

GRANT EXECUTE ON FUNCTION public.create_crew_atomic(text) TO authenticated;

-- ── 3. Close the door ────────────────────────────────────────────────
--
-- join_crew_atomic and create_crew_atomic are both SECURITY DEFINER and
-- bypass RLS, so removing the client's INSERT costs nothing legitimate
-- and closes the escalation above. Same posture as scheduled_workouts
-- (mig 276) and crew_wars (mig 247): no client INSERT policy at all.

DROP POLICY IF EXISTS "crew_members_insert" ON public.crew_members;
REVOKE INSERT ON public.crew_members FROM authenticated, anon;

-- Defence in depth: even a future permissive policy cannot let a client
-- name its own rank. The two RPCs run as the owner and are exempt.
CREATE OR REPLACE FUNCTION public.crew_members_guard_rank()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $crew_members_guard_rank$
DECLARE
  v_leaders      integer;
  v_actor_leader integer;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Anything reaching this trigger from a client role joins as a plain
    -- member, whatever it asked for.
    NEW.role     := 'member';
    NEW.is_admin := FALSE;
    RETURN NEW;
  END IF;

  -- Only a leader may change a rank. The UPDATE policy says so too; this
  -- says it again for the column rather than the row.
  --
  -- Read crew_members directly rather than calling crew_rank: this
  -- trigger is SECURITY INVOKER (deliberately — that is what makes the
  -- current_user check above able to tell a client write from an RPC),
  -- and crew_rank is revoked from authenticated. The SELECT policy on
  -- this table is is_crew_member(crew_id), so a leader can always see
  -- their own crew's rows.
  IF NOT (COALESCE(NEW.role, '') = COALESCE(OLD.role, ''))
     OR NOT (COALESCE(NEW.is_admin, FALSE) = COALESCE(OLD.is_admin, FALSE)) THEN

    SELECT COUNT(*) INTO v_actor_leader
      FROM public.crew_members
     WHERE crew_id = OLD.crew_id
       AND user_id = auth.uid()
       AND is_admin = TRUE;

    IF v_actor_leader = 0 THEN
      RAISE EXCEPTION 'only a crew leader can change ranks'
        USING ERRCODE = '42501';
    END IF;

    -- A crew must never be left with nobody who can run it. Demoting the
    -- last leader is the one role change that cannot be undone by the
    -- person who made it.
    IF OLD.role = 'leader' AND NOT (NEW.role = 'leader') THEN
      SELECT COUNT(*) INTO v_leaders
        FROM public.crew_members
       WHERE crew_id = OLD.crew_id
         AND role = 'leader'
         AND NOT (user_id = OLD.user_id);

      IF v_leaders = 0 THEN
        RAISE EXCEPTION 'a crew must keep at least one leader'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$crew_members_guard_rank$;

DROP TRIGGER IF EXISTS crew_members_guard_rank_tr ON public.crew_members;
CREATE TRIGGER crew_members_guard_rank_tr
  BEFORE INSERT OR UPDATE ON public.crew_members
  FOR EACH ROW
  EXECUTE FUNCTION public.crew_members_guard_rank();

-- ── 4. Kicking — moderators may remove members, and only members ─────

DROP POLICY IF EXISTS "crew_members_delete" ON public.crew_members;
CREATE POLICY "crew_members_delete" ON public.crew_members
  FOR DELETE USING (
    public.can_remove_crew_member(crew_id, user_id)
  );

-- ── 5. Moderator capabilities ────────────────────────────────────────
--
-- Each of these was is_crew_admin. They are the day-to-day running of a
-- crew, which is what rank 2 exists for.

DROP POLICY IF EXISTS "Crew admins can assign regimens" ON public.crew_assigned_regimens;
CREATE POLICY "Crew admins can assign regimens" ON public.crew_assigned_regimens
  FOR INSERT WITH CHECK (public.is_crew_moderator(crew_id));

DROP POLICY IF EXISTS "Crew admins can update assigned regimens" ON public.crew_assigned_regimens;
CREATE POLICY "Crew admins can update assigned regimens" ON public.crew_assigned_regimens
  FOR UPDATE USING (public.is_crew_moderator(crew_id))
         WITH CHECK (public.is_crew_moderator(crew_id));

DROP POLICY IF EXISTS "Crew admins can remove assigned regimens" ON public.crew_assigned_regimens;
CREATE POLICY "Crew admins can remove assigned regimens" ON public.crew_assigned_regimens
  FOR DELETE USING (public.is_crew_moderator(crew_id));

DROP POLICY IF EXISTS "crew_challenges: admins insert" ON public.crew_challenges;
CREATE POLICY "crew_challenges: admins insert" ON public.crew_challenges
  FOR INSERT WITH CHECK (created_by = auth.uid() AND public.is_crew_moderator(crew_id));

DROP POLICY IF EXISTS "crew_challenges: admins delete" ON public.crew_challenges;
CREATE POLICY "crew_challenges: admins delete" ON public.crew_challenges
  FOR DELETE USING (public.is_crew_moderator(crew_id));

DROP POLICY IF EXISTS "crew_messages_delete" ON public.crew_messages;
CREATE POLICY "crew_messages_delete" ON public.crew_messages
  FOR DELETE USING (sender_id = auth.uid() OR public.is_crew_moderator(crew_id));

-- ── 6. Leader-only, restated ─────────────────────────────────────────
--
-- Two duplicate UPDATE policies on crew_members carried identical
-- expressions; permissive policies OR together, so it was redundancy
-- rather than a hole, but two names for one rule is how a later edit
-- changes only one of them.

DROP POLICY IF EXISTS "Crew leaders can update member roles" ON public.crew_members;
DROP POLICY IF EXISTS "crew_members_update" ON public.crew_members;
CREATE POLICY "crew_members_update" ON public.crew_members
  FOR UPDATE USING (public.is_crew_admin(crew_id))
         WITH CHECK (public.is_crew_admin(crew_id));

DROP POLICY IF EXISTS "Crew leaders can update their crew" ON public.crews;
DROP POLICY IF EXISTS "crews_update" ON public.crews;
CREATE POLICY "crews_update" ON public.crews
  FOR UPDATE USING (public.is_crew_admin(id))
         WITH CHECK (public.is_crew_admin(id));

-- ── 7. Starting a war is a moderator act ─────────────────────────────
--
-- Only the gate changes; 356's matchmaking body is untouched below it.

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

  IF NOT (v_rank = GREATEST(v_rank, 2)) THEN
    RAISE EXCEPTION 'only a crew leader or moderator can enter matchmaking'
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

  IF NOT (v_rank = GREATEST(v_rank, 2)) THEN
    RAISE EXCEPTION 'only a crew leader or moderator can leave the queue'
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
