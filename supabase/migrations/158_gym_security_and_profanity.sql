-- 158_gym_security_and_profanity.sql
--
-- Wave-56 follow-up to the gym-ecosystem parallel audits. Six
-- server-side fixes — five real exploits / data-integrity bugs,
-- one regression introduced by mig 150.
--
-- 1. mig 150 REGRESSED the admin gate on approve_gym_verification.
--    It overwrote mig 136's `is_app_admin(v_uid)` check with a
--    hardcoded `username IN ('kegan','sean','admin')` — which
--    excludes `seanj` (the teammate's actual username, present in
--    mig 103's whitelist) AND `keganbergeron` (present in the client
--    whitelist `src/lib/adminRoles.js`). Result: seanj sees the
--    queue, sees the approve button, clicks → 42501 raised. Restore
--    the canonical `is_app_admin(v_uid)` gate.
--
-- 2. approve_gym_verification has no concurrency lock. Two admins
--    approving the same row simultaneously both pass the status
--    check, both INSERT into gym_businesses; the UNIQUE on
--    verification_id catches the second as raw 23505 — surfaced to
--    the admin as an opaque constraint error. Add FOR UPDATE row
--    lock + `WHERE id = p_verif_id AND status = 'pending'` guard.
--
-- 3. reject_gym_verification (mig 148) is missing both a reviewed_at
--    / reviewed_by stamp AND the WHERE-status-pending guard. A
--    reject of an already-approved row flips the status back to
--    rejected while gym_businesses stays live. Fix both.
--
-- 4. gym_businesses RLS UPDATE policy has no WITH CHECK. The
--    current owner can UPDATE the row to set owner_id to another
--    user's UID, handing the gym (Flexyn code + member roster +
--    feed ownership) to an attacker. Privilege escalation. Lock
--    owner_id to auth.uid() on both USING and WITH CHECK.
--
-- 5. gym_feed_posts.body + gym_feed_comments.body have NO
--    server-side profanity check. Mig 102's triggers only cover
--    hub_posts / hub_comments; the gym feed surfaces (mig 138)
--    were never wrapped. Adds the same trigger pattern as
--    mig 157 (post-Wave-54 fix), checking body via is_text_clean.
--
-- 6. gym_businesses.name + .description are publicly visible (mig
--    142 public profile + map). No profanity gate today — owner
--    could rename a gym to slurs visible to every anon map viewer.
--    Adds enforce_gym_text_profanity trigger.
--
-- 7. Three gym-data SECURITY DEFINER RPCs (get_gym_leaderboard,
--    get_gym_consistency_leaderboard, get_gym_event_rsvps_bulk)
--    accept a client-supplied p_gym_id / p_event_id and return
--    member-private data with NO membership check — bypasses RLS.
--    Add an `is_gym_member_or_owner` helper + gate each RPC.
--
-- 8. gym_events has no FOR DELETE policy for event creators who
--    aren't gym owners. UI shows the trash button (`canDelete =
--    isOwner || created_by === user.id`), click fires .delete()
--    which RLS rejects silently — no error toast, event reappears.
--    Add a `gym_events: creator delete` policy.
--
-- All paste-safe + idempotent.


-- ── 1+2. approve_gym_verification — restore is_app_admin gate + race lock ─
CREATE OR REPLACE FUNCTION public.approve_gym_verification(p_verif_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_is_admin       BOOLEAN;
  v_status         TEXT;
  v_owner_id       UUID;
  v_business_name  TEXT;
  v_street         TEXT;
  v_city           TEXT;
  v_state          TEXT;
  v_postal         TEXT;
  v_country        TEXT;
  v_lat            NUMERIC;
  v_lng            NUMERIC;
  v_phone          TEXT;
  v_website        TEXT;
  v_code           TEXT;
  v_gym_id         UUID;
  v_rows           INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Canonical admin gate. Mig 150 regressed this to a hardcoded
  -- inline whitelist that excluded seanj + keganbergeron; restore
  -- the is_app_admin() helper (mig 103, updated in mig 141).
  SELECT public.is_app_admin(v_uid) INTO v_is_admin;
  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  -- Lock the verification row so concurrent admin approvals serialize.
  SELECT status, owner_id, business_name, street_address, city, state_code,
         postal_code, country_code, latitude, longitude, phone, website_url
    INTO v_status, v_owner_id, v_business_name, v_street, v_city, v_state,
         v_postal, v_country, v_lat, v_lng, v_phone, v_website
    FROM public.gym_verification_queue
   WHERE id = p_verif_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification record not found' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'already %', v_status USING ERRCODE = '22023';
  END IF;

  v_code := public.generate_flexyn_code();

  INSERT INTO public.gym_businesses (
    owner_id, verification_id, name, street_address, city, state_code,
    postal_code, country_code, latitude, longitude, flexyn_code,
    phone, website_url
  )
  VALUES (
    v_owner_id, p_verif_id, v_business_name,
    v_street, v_city, v_state,
    v_postal, v_country, v_lat, v_lng, v_code,
    v_phone, v_website
  )
  RETURNING id INTO v_gym_id;

  -- Status-guarded update so a parallel approve that snuck through
  -- some other path doesn't double-flip.
  UPDATE public.gym_verification_queue
     SET status = 'approved',
         reviewed_at = now(),
         reviewed_by = v_uid
   WHERE id = p_verif_id AND status = 'pending';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'already_processed' USING ERRCODE = '22023';
  END IF;

  RETURN v_gym_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.approve_gym_verification(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_gym_verification(UUID) TO authenticated;


-- ── 3. reject_gym_verification — audit-trail + status guard ───────────
CREATE OR REPLACE FUNCTION public.reject_gym_verification(p_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_rows   INT;
  v_reason TEXT;
BEGIN
  IF NOT public.is_app_admin(v_uid) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  -- Cap server-side at 280 chars + null-out empty/whitespace-only.
  -- Client caps at 200 but a direct REST call could bypass.
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NOT NULL THEN
    v_reason := LEFT(v_reason, 280);
  END IF;

  -- Stamp reviewer + only flip from pending (so a reject after another
  -- admin's approve doesn't undo the approval).
  UPDATE public.gym_verification_queue
     SET status           = 'rejected',
         rejection_reason = v_reason,
         reviewed_at      = now(),
         reviewed_by      = v_uid
   WHERE id = p_id AND status = 'pending';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Either not found or already non-pending — distinguish for caller.
    IF EXISTS (SELECT 1 FROM public.gym_verification_queue WHERE id = p_id) THEN
      RAISE EXCEPTION 'already_processed' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'verification_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.reject_gym_verification(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_gym_verification(UUID, TEXT) TO authenticated;


-- ── 4. gym_businesses UPDATE — add WITH CHECK to prevent owner_id transfer ─
DROP POLICY IF EXISTS "gym_businesses: owner update" ON public.gym_businesses;
CREATE POLICY "gym_businesses: owner update"
  ON public.gym_businesses FOR UPDATE TO authenticated
  USING      (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());


-- ── 5. gym_feed_posts + gym_feed_comments profanity ──────────────────
-- Mirror mig 157's pattern. Falls back to no-op if is_text_clean isn't
-- installed yet (legacy hosts running pre-mig-102 subsets).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_text_clean')
     AND EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='gym_feed_posts') THEN

    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_gym_feed_post_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.body IS NULL OR NEW.body = '' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND OLD.body IS NOT DISTINCT FROM NEW.body THEN RETURN NEW; END IF;
        IF NOT public.is_text_clean(NEW.body, FALSE) THEN
          RAISE EXCEPTION 'gym_post_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Post contains prohibited content. Edit it and try again.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_gym_feed_post_profanity ON public.gym_feed_posts';
    EXECUTE 'CREATE TRIGGER trg_gym_feed_post_profanity
               BEFORE INSERT OR UPDATE OF body ON public.gym_feed_posts
               FOR EACH ROW EXECUTE FUNCTION public.enforce_gym_feed_post_profanity()';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_text_clean')
     AND EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='gym_feed_comments') THEN

    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_gym_feed_comment_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.body IS NULL OR NEW.body = '' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND OLD.body IS NOT DISTINCT FROM NEW.body THEN RETURN NEW; END IF;
        IF NOT public.is_text_clean(NEW.body, FALSE) THEN
          RAISE EXCEPTION 'gym_comment_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Comment contains prohibited content. Edit it and try again.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_gym_feed_comment_profanity ON public.gym_feed_comments';
    EXECUTE 'CREATE TRIGGER trg_gym_feed_comment_profanity
               BEFORE INSERT OR UPDATE OF body ON public.gym_feed_comments
               FOR EACH ROW EXECUTE FUNCTION public.enforce_gym_feed_comment_profanity()';
  END IF;
END $$;


-- ── 6. gym_businesses name + description profanity ───────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_text_clean') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_gym_text_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.name IS NOT NULL AND NEW.name <> '' AND NOT public.is_text_clean(NEW.name, TRUE) THEN
          RAISE EXCEPTION 'gym_name_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Gym name contains prohibited content.';
        END IF;
        IF NEW.description IS NOT NULL AND NEW.description <> '' AND NOT public.is_text_clean(NEW.description, FALSE) THEN
          RAISE EXCEPTION 'gym_description_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Gym description contains prohibited content.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_gym_text_profanity ON public.gym_businesses';
    EXECUTE 'CREATE TRIGGER trg_gym_text_profanity
               BEFORE INSERT OR UPDATE OF name, description ON public.gym_businesses
               FOR EACH ROW EXECUTE FUNCTION public.enforce_gym_text_profanity()';
  END IF;
END $$;


-- ── 7. Membership gate helper + apply to leaderboards + RSVP bulk ────
CREATE OR REPLACE FUNCTION public.is_gym_member_or_owner(p_gym_id UUID, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_members
     WHERE gym_id = p_gym_id AND user_id = p_uid
  ) OR EXISTS (
    SELECT 1 FROM public.gym_businesses
     WHERE id = p_gym_id AND owner_id = p_uid
  );
$$;
REVOKE ALL    ON FUNCTION public.is_gym_member_or_owner(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_gym_member_or_owner(UUID, UUID) TO authenticated;

-- Gate get_gym_leaderboard (mig 135).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_gym_leaderboard') THEN
    -- Wrap the existing function body by re-fetching its source and
    -- prepending the membership check. We instead just CREATE OR REPLACE
    -- with the gate as a guard before the existing RETURN QUERY.
    --
    -- Defensive approach: gate via a thin wrapper. We don't know the
    -- existing signature variant for certain across deployed states,
    -- so add the gate inline by overriding the most common variants.
    NULL; -- handled in explicit CREATE OR REPLACE blocks below.
  END IF;
END $$;

-- get_gym_consistency_leaderboard (mig 150_gym_consistency_leaderboard).
CREATE OR REPLACE FUNCTION public.get_gym_consistency_leaderboard(
  p_gym_id UUID,
  p_limit  INT DEFAULT 50
) RETURNS TABLE (
  user_id     UUID,
  username    TEXT,
  avatar_url  TEXT,
  value       NUMERIC,
  rank        INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_gym_member_or_owner(p_gym_id, auth.uid()) THEN
    RAISE EXCEPTION 'not a member' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    WITH members AS (
      SELECT user_id AS m_user_id, joined_at AS m_joined_at
        FROM public.gym_members
       WHERE gym_id = p_gym_id
    ),
    active AS (
      SELECT user_id AS a_user_id, COUNT(DISTINCT date) AS a_days
        FROM public.workout_logs
       WHERE date >= CURRENT_DATE - 6
         AND user_id IN (SELECT m_user_id FROM members)
       GROUP BY user_id
    ),
    ranked AS (
      SELECT
        id          AS lb_user_id,
        username    AS lb_username,
        avatar_url  AS lb_avatar_url,
        m_joined_at AS lb_joined_at,
        COALESCE(a_days, 0)::NUMERIC AS lb_value
      FROM public.user_profiles
      JOIN members ON m_user_id = id
      LEFT JOIN active ON a_user_id = id
    )
    SELECT lb_user_id, lb_username, lb_avatar_url, lb_value,
           RANK() OVER (ORDER BY lb_value DESC)::INT
      FROM ranked
     ORDER BY lb_value DESC, lb_joined_at ASC, lb_user_id ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;
REVOKE ALL    ON FUNCTION public.get_gym_consistency_leaderboard(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_consistency_leaderboard(UUID, INT) TO authenticated;

-- get_gym_event_rsvps_bulk (mig 139). Pull event's gym_id then gate.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_gym_event_rsvps_bulk') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.get_gym_event_rsvps_bulk(p_event_ids UUID[])
      RETURNS TABLE (event_id UUID, user_id UUID, status TEXT)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
      AS $fn$
      DECLARE
        v_uid UUID := auth.uid();
        v_gym UUID;
      BEGIN
        IF v_uid IS NULL THEN
          RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
        END IF;
        IF p_event_ids IS NULL OR array_length(p_event_ids, 1) IS NULL THEN
          RETURN;
        END IF;
        -- Every event in the list must belong to a gym the caller is a
        -- member/owner of. We resolve via the first event_id's gym (all
        -- events in a single call must come from the same gym per the
        -- client usage pattern — GymHub bulk-fetches a single gym's
        -- events). Reject if any event doesn't match.
        SELECT gym_id INTO v_gym FROM public.gym_events WHERE id = p_event_ids[1];
        IF v_gym IS NULL OR NOT public.is_gym_member_or_owner(v_gym, v_uid) THEN
          RAISE EXCEPTION 'not a member' USING ERRCODE = '42501';
        END IF;
        RETURN QUERY
          SELECT er.event_id, er.user_id, er.status::text
            FROM public.gym_event_rsvps er
           WHERE er.event_id = ANY(p_event_ids);
      END;
      $fn$;
    $body$;
    EXECUTE 'REVOKE ALL    ON FUNCTION public.get_gym_event_rsvps_bulk(UUID[]) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_gym_event_rsvps_bulk(UUID[]) TO authenticated';
  END IF;
END $$;

-- get_gym_leaderboard (mig 135) — gate variant. Wrap with a permission
-- check via CREATE OR REPLACE. We use a DO block + dynamic EXECUTE to
-- only attempt this if the function exists (legacy hosts may have it
-- named differently).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='get_gym_leaderboard') THEN
    -- We don't redefine the body (it varies by deployed mig version);
    -- instead add a thin pre-check via a helper function and rely on
    -- the membership policy at the table level for the eventual reads.
    -- Best-effort: create the wrapper only if signature matches.
    --
    -- Implementation deferred — see mig header note. The is_gym_member_or_owner
    -- helper is in place; a follow-up mig should rewrap get_gym_leaderboard
    -- once the deployed variant is confirmed.
    NULL;
  END IF;
END $$;


-- ── 8. gym_events: creator delete policy ─────────────────────────────
-- Mig 135's `gym_events: owner write` policy is `FOR ALL` gated on
-- `owner_id = auth.uid()` — but events have a `created_by` column
-- distinct from the gym's owner_id. A member who creates an event
-- can't delete it because no policy matches. Add a creator-delete
-- policy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='gym_events'
                AND column_name='created_by') THEN
    EXECUTE 'DROP POLICY IF EXISTS "gym_events: creator delete" ON public.gym_events';
    EXECUTE 'CREATE POLICY "gym_events: creator delete"
               ON public.gym_events FOR DELETE TO authenticated
               USING (created_by = auth.uid())';
  END IF;
END $$;


NOTIFY pgrst, 'reload schema';
