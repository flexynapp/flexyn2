-- 241_dm_identity_guest_safe.sql
--
-- "Two account test failed, receiving user could not accept the message
-- request."
--
-- WHAT BROKE
--
-- Migration 240 taught start_dm_conversation that an anonymous ("Continue
-- as guest") session has no JWT email, so auth.email() returns ''. It did
-- not teach that to any of the OTHER functions in the DM request flow,
-- and every one of them makes the same assumption:
--
--   accept_conversation      (mig 113) - silent no-op for guests
--   purge_message_request    (mig 234) - raises 'unauthenticated'
--   unsend_message_request   (mig 234) - raises 'unauthenticated'
--   dm_pending_send_allowed  (mig 234) - fails OPEN, guest skips the cap
--
-- The reported failure is accept_conversation, and it is the nastiest of
-- the four because it fails SILENTLY. Its body is
--
--   v_email TEXT := auth.email();
--   IF v_email IS NULL THEN RAISE ... END IF;
--   UPDATE public.hub_conversations
--      SET accepted_emails = ...
--    WHERE id = p_conv_id AND v_email = ANY(participant_emails);
--
-- For a guest, auth.email() is the empty string, not NULL, so the guard
-- passes. Then '' = ANY(participant_emails) is false, the UPDATE matches
-- zero rows, and an UPDATE that matches nothing is not an error. The RPC
-- returns success, the client's `if (error) throw` never fires, and the
-- request sits in Requests looking untouched. Confirmed against the live
-- row from the failing test:
--
--   participant_emails: {guest_8d3b3405-...@flexyn.guest, kegan...@gmail.com}
--   accepted_emails:    {kegan...@gmail.com}
--
-- The sender was the real account; the RECIPIENT was the guest.
--
-- A second, independent bug in the same function: v_email is the RAW
-- auth.email(), but participant_emails is stored lower-cased. Any user
-- whose JWT carries display-case email (common with OAuth) would fail the
-- same membership test and get the same silent no-op.
--
-- THE FIX
--
-- One shared identity resolver, public.current_user_email(), so this
-- cannot drift apart again: prefer auth.email(), fall back to
-- user_profiles.email looked up by auth.uid(), always lower-cased,
-- returning '' when there is no session at all. Identity still comes from
-- the session and never from a client parameter (mig 108's lesson).
--
-- accept_conversation additionally:
--   * compares membership case-insensitively on BOTH sides, so legacy
--     mixed-case participant_emails rows still match
--   * RAISES when it matched no row instead of reporting a silent
--     success, so this failure mode can never be invisible again. Still
--     idempotent: re-accepting matches the row and the CASE leaves
--     accepted_emails alone.
--
-- dm_pending_send_allowed's guest path was failing OPEN, which let a
-- guest bypass the one-message cap on a pending request entirely. Now it
-- resolves the same way as everything else and the cap applies.
--
-- Paste-safe: public.<table>, auth.<fn>(), bare columns, NOT (a = b),
-- and no bare angle-bracket comparison operators in any statement body.

CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT := lower(coalesce(auth.email(), ''));
BEGIN
  IF NOT (v_email = '') THEN
    RETURN v_email;
  END IF;
  IF v_uid IS NULL THEN
    RETURN '';
  END IF;
  SELECT lower(coalesce(email, '')) INTO v_email
    FROM public.user_profiles
   WHERE id = v_uid;
  RETURN coalesce(v_email, '');
END;
$$;

REVOKE ALL ON FUNCTION public.current_user_email() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_email() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_email() TO authenticated;

-- ── accept_conversation ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_conversation(p_conv_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := public.current_user_email();
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_conv_id IS NULL THEN
    RAISE EXCEPTION 'invalid_conversation' USING ERRCODE = '22023';
  END IF;

  UPDATE public.hub_conversations
     SET accepted_emails = (
       CASE
         WHEN v_email = ANY (
           ARRAY(
             SELECT lower(accepted_email)
               FROM unnest(coalesce(accepted_emails, ARRAY[]::text[]))
                 AS accepted_email
           )
         )
           THEN accepted_emails
         ELSE array_append(coalesce(accepted_emails, ARRAY[]::text[]), v_email)
       END
     ),
     updated_at = now()
   WHERE id = p_conv_id
     AND v_email = ANY (
       ARRAY(
         SELECT lower(participant_email)
           FROM unnest(coalesce(participant_emails, ARRAY[]::text[]))
             AS participant_email
       )
     );

  -- An UPDATE that matches nothing is not an error in Postgres, which is
  -- exactly how this failed invisibly before. Make it loud.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_participant' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_conversation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_conversation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_conversation(UUID) TO authenticated;

-- ── dm_pending_send_allowed ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dm_pending_send_allowed(
  p_conv_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email    TEXT := public.current_user_email();
  v_parts    TEXT[];
  v_accepted TEXT[];
  v_group    BOOLEAN;
  v_pending  INTEGER;
  v_sent     INTEGER;
BEGIN
  IF p_conv_id IS NULL OR v_email = '' THEN
    RETURN TRUE;
  END IF;

  SELECT participant_emails, accepted_emails, coalesce(is_group, FALSE)
    INTO v_parts, v_accepted, v_group
    FROM public.hub_conversations
   WHERE id = p_conv_id;

  IF v_parts IS NULL THEN
    RETURN TRUE;
  END IF;

  IF v_group OR NOT (coalesce(array_length(v_parts, 1), 0) = 2) THEN
    RETURN TRUE;
  END IF;

  SELECT count(*)
    INTO v_pending
    FROM unnest(v_parts) AS participant_email
   WHERE NOT (lower(participant_email) = v_email)
     AND NOT (
       lower(participant_email) = ANY (
         SELECT lower(accepted_email)
           FROM unnest(coalesce(v_accepted, ARRAY[]::text[])) AS accepted_email
       )
     );

  IF v_pending = 0 THEN
    RETURN TRUE;
  END IF;

  SELECT count(*)
    INTO v_sent
    FROM public.hub_messages
   WHERE conversation_id = p_conv_id
     AND lower(coalesce(sender_email, created_by, '')) = v_email;

  RETURN (v_sent = 0);
END;
$$;

REVOKE ALL ON FUNCTION public.dm_pending_send_allowed(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dm_pending_send_allowed(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.dm_pending_send_allowed(UUID) TO authenticated;

-- ── purge_message_request ─────────────────────────────────────────────
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

-- ── unsend_message_request ────────────────────────────────────────────
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
