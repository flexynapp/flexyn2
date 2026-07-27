-- 244_dm_purge_unsend_guest_identity.sql
--
-- Re-issues the half of migration 241 that did not land.
--
-- "Could not withdraw that request. Try again."
--
-- 241 moved DM identity resolution onto public.current_user_email(), which
-- prefers auth.email() and falls back to user_profiles.email by auth.uid()
-- for anonymous sessions (their JWT carries no email, so auth.email() is
-- the empty string). Verified against the live catalog, three of the four
-- functions took the change and two did not:
--
--   current_user_email       APPLIED
--   accept_conversation      APPLIED
--   dm_pending_send_allowed  APPLIED
--   purge_message_request    NOT APPLIED  (still raw auth.email())
--   unsend_message_request   NOT APPLIED  (still raw auth.email())
--
-- So Delete and Unsend still open with
--
--   v_email TEXT := lower(coalesce(auth.email(), ''));
--   IF v_email = '' THEN RAISE EXCEPTION 'unauthenticated' ...
--
-- and a guest session hits that RAISE every time. Confirmed against the
-- failing row: the thread showing "Unsend request" belongs to the guest
-- account (participant_emails holds guest_8d3b3405-...@flexyn.guest plus
-- the recipient, accepted_emails holds only the guest), so the caller is
-- the guest and auth.email() is ''.
--
-- Worth recording what this is NOT: the UI and the RPC agree about what
-- "pending" means. isOutgoingPendingRequest returns true for that row
-- (I accepted, the other side has not) and false for the kegan/sean
-- thread where both parties are in accepted_emails — which is exactly
-- when unsend would refuse. No predicate mismatch; the identity lookup
-- was the whole failure.
--
-- Bodies below are identical to 241's. CREATE OR REPLACE, so re-running
-- this on a database that somehow did get 241 in full is a no-op.
--
-- REQUIRES: migration 241 part 1 (public.current_user_email), which is
-- confirmed applied.
--
-- Paste-safe: public.<table>, auth.<fn>(), bare columns, NOT (a = b), and
-- no bare angle-bracket comparison operators in any statement body.

CREATE OR REPLACE FUNCTION public.purge_message_request(
  p_conv_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email    TEXT := public.current_user_email();
  v_parts    TEXT[];
  v_accepted TEXT[];
  v_group    BOOLEAN;
  v_paths    TEXT[];
  v_other    TEXT;
  v_deleted  INTEGER := 0;
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_conv_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT participant_emails, accepted_emails, coalesce(is_group, FALSE)
    INTO v_parts, v_accepted, v_group
    FROM public.hub_conversations
   WHERE id = p_conv_id;

  IF v_parts IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT (
    v_email = ANY (
      ARRAY(
        SELECT lower(participant_email)
          FROM unnest(v_parts) AS participant_email
      )
    )
  ) THEN
    RAISE EXCEPTION 'not_a_participant' USING ERRCODE = '42501';
  END IF;

  IF v_group OR NOT (coalesce(array_length(v_parts, 1), 0) = 2) THEN
    RAISE EXCEPTION 'not_a_message_request' USING ERRCODE = '42501';
  END IF;

  IF v_email = ANY (
    ARRAY(
      SELECT lower(accepted_email)
        FROM unnest(coalesce(v_accepted, ARRAY[]::text[])) AS accepted_email
    )
  ) THEN
    RAISE EXCEPTION 'conversation_already_accepted' USING ERRCODE = '42501';
  END IF;

  SELECT lower(participant_email)
    INTO v_other
    FROM unnest(v_parts) AS participant_email
   WHERE NOT (lower(participant_email) = v_email)
   LIMIT 1;

  IF v_other IS NOT NULL THEN
    INSERT INTO public.dm_request_blocks (blocker_email, blocked_email)
    VALUES (v_email, v_other)
    ON CONFLICT (blocker_email, blocked_email) DO NOTHING;
  END IF;

  SELECT array_agg(split_part(attachment_url, '/uploads/', 2))
    INTO v_paths
    FROM public.hub_messages
   WHERE conversation_id = p_conv_id
     AND attachment_url IS NOT NULL
     AND attachment_url LIKE '%/uploads/%';

  IF v_paths IS NOT NULL THEN
    PERFORM public.enqueue_storage_cleanup('uploads', v_paths, 'dm_request_purge');
  END IF;

  DELETE FROM public.hub_conversations WHERE id = p_conv_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN (v_deleted = 1);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_message_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_message_request(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.purge_message_request(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.unsend_message_request(
  p_conv_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email    TEXT := public.current_user_email();
  v_parts    TEXT[];
  v_accepted TEXT[];
  v_group    BOOLEAN;
  v_paths    TEXT[];
  v_others   INTEGER;
  v_deleted  INTEGER := 0;
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_conv_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT participant_emails, accepted_emails, coalesce(is_group, FALSE)
    INTO v_parts, v_accepted, v_group
    FROM public.hub_conversations
   WHERE id = p_conv_id;

  IF v_parts IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT (
    v_email = ANY (
      ARRAY(
        SELECT lower(participant_email)
          FROM unnest(v_parts) AS participant_email
      )
    )
  ) THEN
    RAISE EXCEPTION 'not_a_participant' USING ERRCODE = '42501';
  END IF;

  IF v_group OR NOT (coalesce(array_length(v_parts, 1), 0) = 2) THEN
    RAISE EXCEPTION 'not_a_message_request' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)
    INTO v_others
    FROM unnest(v_parts) AS participant_email
   WHERE NOT (lower(participant_email) = v_email)
     AND lower(participant_email) = ANY (
       SELECT lower(accepted_email)
         FROM unnest(coalesce(v_accepted, ARRAY[]::text[])) AS accepted_email
     );

  IF NOT (v_others = 0) THEN
    RAISE EXCEPTION 'conversation_already_accepted' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(split_part(attachment_url, '/uploads/', 2))
    INTO v_paths
    FROM public.hub_messages
   WHERE conversation_id = p_conv_id
     AND attachment_url IS NOT NULL
     AND attachment_url LIKE '%/uploads/%';

  IF v_paths IS NOT NULL THEN
    PERFORM public.enqueue_storage_cleanup('uploads', v_paths, 'dm_request_unsend');
  END IF;

  DELETE FROM public.hub_conversations WHERE id = p_conv_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN (v_deleted = 1);
END;
$$;

REVOKE ALL ON FUNCTION public.unsend_message_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unsend_message_request(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.unsend_message_request(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
