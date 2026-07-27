-- 250_crew_membership_door.sql
--
-- Puts a door on crew membership: approval, invitation, banning, and a way
-- to see who has stopped turning up.
--
-- THE HOLE, WHICH IS LIVE
--
-- join_crew_atomic (migration 075) never reads is_public. It locks the crew
-- row, checks capacity, and inserts. That means:
--
--   supabase.rpc('join_crew_atomic', { p_crew_id: '<any crew id>' })
--
-- seats the caller in ANY crew, public or private, as long as it has room.
-- is_public is only ever used to filter the discovery search
-- (searchPublicCrews), so it reads like a privacy control while being a
-- listing preference. A private crew is currently unlisted, not private.
--
-- There is also no ban: removeMember deletes the row, and the removed user
-- can rejoin immediately, which makes moderating a crew impossible.
--
-- INVITES ARE CURRENTLY BEARER TOKENS IN PLAINTEXT
--
-- The DM invite (CREW_INVITE_V1, sent by CrewCreationFlow) puts a raw crew
-- id in the message body. Nothing binds that invite to the person it was
-- sent to, so the capability is possession of the text. Once join_crew_atomic
-- starts refusing private crews, an invite has to grant something -- and it
-- should grant it to a named user, not to whoever can read the string. Hence
-- crew_invites, keyed by (crew_id, invited_user_id) with an expiry.
--
-- WHAT THIS ADDS
--
--   crew_bans           -- (crew, user), enforced inside the join path
--   crew_join_requests  -- pending / approved / rejected, leader-decided
--   crew_invites        -- bound to a user, expiring, single-use
--
-- and rewrites join_crew_atomic into the one door everything passes through:
-- banned is refused, invited joins directly, a public crew joins directly,
-- and a private crew produces a request instead of a membership.
--
-- ROLE, FINALLY
--
-- crew_members has carried both is_admin (boolean, what RLS reads) and role
-- (text, what the UI reads) since migration 065, kept in agreement only by
-- whichever call site happened to write both. Migration 248's notes flagged
-- this as debt. Rather than rewrite every policy that reads is_admin -- which
-- is a large, risky change to make in the same breath as adding a join door --
-- a trigger now keeps the two in sync in both directions, whichever one the
-- caller writes. is_admin stays the RLS primitive, role becomes reliable, and
-- the eventual cutover becomes a policy-only change with no data migration.
--
-- INACTIVITY IS SURFACED, NEVER AUTOMATIC. get_crew_inactive_members reports
-- who has not logged a session in 21 days so a leader can free a seat in a
-- sixteen-person cap. Nothing is auto-removed: in a fitness app, silently
-- ejecting someone during an injury or a bad month is the wrong default, and
-- the leader has context the query does not.
--
-- Paste-safe per repo convention: schema-qualified table names, no
-- short table-alias column tokens, no record field access, and no bare
-- angle-bracket comparison operators anywhere in a statement body
-- (GREATEST / LEAST / NOT (a = b) are used instead). The previous
-- join_crew_atomic used a %ROWTYPE record and dotted field access, which is
-- exactly the shape that mangles on paste; the rewrite below uses scalar
-- SELECT ... INTO instead.

-- ── 1. Bans ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_bans (
  crew_id    uuid        NOT NULL REFERENCES public.crews(id)  ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  banned_by  uuid        REFERENCES auth.users(id)             ON DELETE SET NULL,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crew_id, user_id)
);

ALTER TABLE public.crew_bans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crew_bans: admins read" ON public.crew_bans;
CREATE POLICY "crew_bans: admins read"
  ON public.crew_bans FOR SELECT TO authenticated
  USING (public.is_crew_admin(crew_id));

GRANT SELECT ON public.crew_bans TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crew_bans FROM authenticated, anon;

-- ── 2. Join requests ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_join_requests (
  crew_id    uuid        NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  status     text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'rejected')),
  message    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  PRIMARY KEY (crew_id, user_id)
);

CREATE INDEX IF NOT EXISTS crew_join_requests_pending_idx
  ON public.crew_join_requests (crew_id, created_at) WHERE status = 'pending';

ALTER TABLE public.crew_join_requests ENABLE ROW LEVEL SECURITY;

-- A requester sees their own request; a crew admin sees the queue.
DROP POLICY IF EXISTS "crew_join_requests: read" ON public.crew_join_requests;
CREATE POLICY "crew_join_requests: read"
  ON public.crew_join_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_crew_admin(crew_id));

GRANT SELECT ON public.crew_join_requests TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crew_join_requests FROM authenticated, anon;

-- ── 3. Invites, bound to a person ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_invites (
  crew_id         uuid        NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  invited_user_id uuid        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  invited_by      uuid        REFERENCES auth.users(id)            ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  accepted_at     timestamptz,
  PRIMARY KEY (crew_id, invited_user_id)
);

ALTER TABLE public.crew_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crew_invites: read" ON public.crew_invites;
CREATE POLICY "crew_invites: read"
  ON public.crew_invites FOR SELECT TO authenticated
  USING (invited_user_id = auth.uid() OR public.is_crew_admin(crew_id));

GRANT SELECT ON public.crew_invites TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crew_invites FROM authenticated, anon;

-- ── 4. role and is_admin stop drifting ───────────────────────────────
UPDATE public.crew_members
   SET role = CASE WHEN is_admin THEN 'leader' ELSE 'member' END
 WHERE role IS NULL;

UPDATE public.crew_members
   SET role = 'leader'
 WHERE is_admin = TRUE AND NOT (role = 'leader');

CREATE OR REPLACE FUNCTION public.crew_members_sync_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $sync_role$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.role := COALESCE(NEW.role,
                         CASE WHEN NEW.is_admin THEN 'leader' ELSE 'member' END);
    NEW.is_admin := (NEW.role = 'leader');
    RETURN NEW;
  END IF;

  -- Whichever of the pair the caller wrote wins, and the other follows.
  -- Existing code writes is_admin; the member directory writes role.
  IF NOT (COALESCE(NEW.role, '') = COALESCE(OLD.role, '')) THEN
    NEW.is_admin := (NEW.role = 'leader');
  ELSIF NOT (COALESCE(NEW.is_admin, FALSE) = COALESCE(OLD.is_admin, FALSE)) THEN
    NEW.role := CASE WHEN NEW.is_admin THEN 'leader' ELSE 'member' END;
  END IF;

  RETURN NEW;
END;
$sync_role$;

DROP TRIGGER IF EXISTS crew_members_sync_role_tr ON public.crew_members;
CREATE TRIGGER crew_members_sync_role_tr
  BEFORE INSERT OR UPDATE ON public.crew_members
  FOR EACH ROW
  EXECUTE FUNCTION public.crew_members_sync_role();

CREATE OR REPLACE FUNCTION public.is_crew_moderator(p_crew_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $is_mod$
  SELECT EXISTS (
    SELECT 1 FROM public.crew_members
     WHERE crew_id = p_crew_id
       AND user_id = auth.uid()
       AND (is_admin = TRUE OR role IN ('leader', 'moderator'))
  );
$is_mod$;

REVOKE ALL ON FUNCTION public.is_crew_moderator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_crew_moderator(uuid) TO authenticated, service_role;

-- ── 5. The one door ──────────────────────────────────────────────────
-- Replaces migration 075's version. Same capacity lock and the same return
-- keys, so existing callers keep working, plus a 'status' field describing
-- what actually happened: joined, already_member, requested or pending.
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

  -- Scalar reads under the row lock. The previous version selected the
  -- whole row into a %ROWTYPE and read v_crew.id, which is the token shape
  -- that mangles on paste.
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

  -- A ban outranks everything, including an invite issued before it.
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

  -- Private and uninvited: this becomes a request, not a membership.
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

-- ── 6. Deciding a request ────────────────────────────────────────────
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
  v_uid   uuid := auth.uid();
  v_admin integer;
  v_cap   integer;
  v_count integer;
  v_state text;
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

-- ── 7. The pending queue, with names ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_crew_join_requests(p_crew_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $list_requests$
DECLARE
  v_uid   uuid := auth.uid();
  v_admin integer;
  v_rows  jsonb;
BEGIN
  IF v_uid IS NULL OR p_crew_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COUNT(*) INTO v_admin
    FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = v_uid AND is_admin = TRUE;

  IF v_admin = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'user_id',    r_user,
             'message',    r_msg,
             'created_at', r_when,
             'username',   (SELECT username   FROM public.user_profiles WHERE id = r_user),
             'full_name',  (SELECT full_name  FROM public.user_profiles WHERE id = r_user),
             'avatar_url', (SELECT avatar_url FROM public.user_profiles WHERE id = r_user)
           ) ORDER BY r_when
         ), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT user_id AS r_user, message AS r_msg, created_at AS r_when
        FROM public.crew_join_requests
       WHERE crew_id = p_crew_id AND status = 'pending'
       LIMIT 100
    ) AS pending;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$list_requests$;

REVOKE ALL ON FUNCTION public.list_crew_join_requests(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_crew_join_requests(uuid) TO authenticated;

-- ── 8. Ban and unban ─────────────────────────────────────────────────
-- Banning removes the membership in the same transaction, so "kick and
-- they walk straight back in" stops being possible.
CREATE OR REPLACE FUNCTION public.ban_crew_member(
  p_crew_id uuid,
  p_user_id uuid,
  p_reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $ban_member$
DECLARE
  v_uid    uuid := auth.uid();
  v_admin  integer;
  v_target integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'crew_id and user_id required' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = v_uid THEN
    RAISE EXCEPTION 'cannot ban yourself' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_admin
    FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = v_uid AND is_admin = TRUE;

  IF v_admin = 0 THEN
    RAISE EXCEPTION 'only a crew leader can ban' USING ERRCODE = '42501';
  END IF;

  -- Leaders are peers; one cannot remove another. Demote first.
  SELECT COUNT(*) INTO v_target
    FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = p_user_id AND is_admin = TRUE;

  IF NOT (v_target = 0) THEN
    RAISE EXCEPTION 'cannot ban another leader' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.crew_bans (crew_id, user_id, banned_by, reason)
  VALUES (p_crew_id, p_user_id, v_uid, NULLIF(left(COALESCE(p_reason, ''), 200), ''))
  ON CONFLICT (crew_id, user_id) DO UPDATE
    SET banned_by = v_uid, reason = NULLIF(left(COALESCE(p_reason, ''), 200), ''),
        created_at = now();

  DELETE FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = p_user_id;

  -- A live request or invite would otherwise let them straight back in.
  DELETE FROM public.crew_invites
   WHERE crew_id = p_crew_id AND invited_user_id = p_user_id;

  UPDATE public.crew_join_requests
     SET status = 'rejected', decided_by = v_uid, decided_at = now()
   WHERE crew_id = p_crew_id AND user_id = p_user_id AND status = 'pending';

  RETURN jsonb_build_object('ok', TRUE, 'banned', TRUE);
END;
$ban_member$;

REVOKE ALL ON FUNCTION public.ban_crew_member(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ban_crew_member(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unban_crew_member(p_crew_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $unban_member$
DECLARE
  v_uid   uuid := auth.uid();
  v_admin integer;
  v_gone  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_admin
    FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = v_uid AND is_admin = TRUE;

  IF v_admin = 0 THEN
    RAISE EXCEPTION 'only a crew leader can unban' USING ERRCODE = '42501';
  END IF;

  WITH gone AS (
    DELETE FROM public.crew_bans
     WHERE crew_id = p_crew_id AND user_id = p_user_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_gone FROM gone;

  RETURN jsonb_build_object('ok', TRUE, 'removed', v_gone);
END;
$unban_member$;

REVOKE ALL ON FUNCTION public.unban_crew_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unban_crew_member(uuid, uuid) TO authenticated;

-- ── 9. Inviting a named person ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invite_to_crew(p_crew_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $invite_crew$
DECLARE
  v_uid    uuid := auth.uid();
  v_mod    integer;
  v_banned integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'crew_id and user_id required' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_mod
    FROM public.crew_members
   WHERE crew_id = p_crew_id
     AND user_id = v_uid
     AND (is_admin = TRUE OR role IN ('leader', 'moderator'));

  IF v_mod = 0 THEN
    RAISE EXCEPTION 'only a crew leader or moderator can invite'
      USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_banned
    FROM public.crew_bans WHERE crew_id = p_crew_id AND user_id = p_user_id;

  IF NOT (v_banned = 0) THEN
    RAISE EXCEPTION 'that person is banned from this crew' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.crew_invites (crew_id, invited_user_id, invited_by, expires_at)
  VALUES (p_crew_id, p_user_id, v_uid, now() + INTERVAL '14 days')
  ON CONFLICT (crew_id, invited_user_id) DO UPDATE
    SET invited_by = v_uid, created_at = now(),
        expires_at = now() + INTERVAL '14 days', accepted_at = NULL;

  RETURN jsonb_build_object('ok', TRUE, 'invited', TRUE);
END;
$invite_crew$;

REVOKE ALL ON FUNCTION public.invite_to_crew(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_to_crew(uuid, uuid) TO authenticated;

-- ── 10. Who has stopped turning up ───────────────────────────────────
-- Reported, never enforced. Ejecting somebody automatically during an
-- injury or a bad month is the wrong default for a fitness app; the leader
-- has context this query does not.
CREATE OR REPLACE FUNCTION public.get_crew_inactive_members(
  p_crew_id uuid,
  p_days    integer DEFAULT 21
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $inactive_members$
DECLARE
  v_uid    uuid := auth.uid();
  v_admin  integer;
  v_cutoff timestamptz;
  v_rows   jsonb;
BEGIN
  IF v_uid IS NULL OR p_crew_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COUNT(*) INTO v_admin
    FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = v_uid AND is_admin = TRUE;

  IF v_admin = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- make_interval's named-argument syntax uses =>, which is an angle
  -- bracket the paste pipeline mangles. Multiplication reads the same.
  v_cutoff := now() - (LEAST(365, GREATEST(1, COALESCE(p_days, 21))) * INTERVAL '1 day');

  -- Two stages on purpose. Correlating the workout lookup directly against
  -- public.crew_members.user_id would need a three-part name, and bare
  -- user_id inside the subquery would bind to workout_logs instead. Lifting
  -- the member list into a CTE renames the key to m_user, which is
  -- unambiguous in both scopes and paste-safe.
  WITH mem AS (
    SELECT user_id AS m_user, joined_at AS m_joined
      FROM public.crew_members
     WHERE crew_id = p_crew_id
       AND NOT (user_id = v_uid)
     LIMIT 40
  ),
  seen AS (
    SELECT
      m_user,
      m_joined,
      (SELECT MAX(created_at)
         FROM public.workout_logs
        WHERE user_id = m_user
           OR lower(created_by) = (SELECT lower(email) FROM public.user_profiles
                                    WHERE id = m_user)
      ) AS m_last
    FROM mem
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'user_id',    m_user,
             'joined_at',  m_joined,
             'last_seen',  m_last,
             'username',   (SELECT username   FROM public.user_profiles WHERE id = m_user),
             'full_name',  (SELECT full_name  FROM public.user_profiles WHERE id = m_user),
             'avatar_url', (SELECT avatar_url FROM public.user_profiles WHERE id = m_user)
           ) ORDER BY m_last NULLS FIRST
         ), '[]'::jsonb)
    INTO v_rows
    FROM seen
   WHERE m_last IS NULL OR m_last = LEAST(m_last, v_cutoff);

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$inactive_members$;

REVOKE ALL ON FUNCTION public.get_crew_inactive_members(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crew_inactive_members(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
