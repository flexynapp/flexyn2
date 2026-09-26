-- 240_start_dm_conversation_guest_email.sql
--
-- Fixes "Could not start conversation. Try again." for every guest
-- ("Continue as guest") session.
--
-- WHAT BREAKS
--
-- Anonymous Supabase sessions carry NO email in the JWT — auth.users.email
-- is empty and is_anonymous is true — so auth.email() returns ''. Migration
-- 234's start_dm_conversation opens with:
--
--   v_email TEXT := lower(coalesce(auth.email(), ''));
--   IF v_uid IS NULL OR v_email = '' THEN
--     RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
--
-- so it raises 'unauthenticated' for every guest, on every attempt to open
-- a DM. The client (src/lib/data/hubMessages.js findOrCreateConversation)
-- only falls through to the legacy insert path on 42883 / 42P01 — a
-- deliberate choice, because the RPC is the request-block GATE and must not
-- be bypassable. 42501 is therefore rethrown and surfaces as the generic
-- "Could not start conversation. Try again." toast.
--
-- WHY THE CLIENT DOESN'T CATCH IT FIRST
--
-- src/lib/AuthContext.jsx builds the user object as
-- `{ id, email: authUser.email, ...profile }`. The profile spread lands
-- AFTER, so user.email resolves to user_profiles.email — which for a guest
-- is the synthetic `guest_<uuid>@flexyn.guest` address, not ''. The client
-- guard sees a non-empty email and proceeds; only the database disagrees.
--
-- WHY THE FALLBACK IS CORRECT, NOT A LOOSENING
--
-- Guests are already first-class in the DM system. hub_conversations' RLS
-- policy is
--
--   (auth.email() = ANY (participant_emails))
--     OR (auth.uid() = ANY (participant_ids))
--
-- and that second branch exists precisely so emailless sessions can read
-- and write their own threads. Every other surface identifies a guest by
-- the synthetic user_profiles.email. start_dm_conversation was the only
-- place that assumed auth.email() is always populated.
--
-- So: keep auth.email() as the primary identity, and fall back to
-- user_profiles.email looked up by auth.uid() when the JWT carries none.
-- The caller's identity is still taken from the session — never from a
-- client-supplied parameter (mig 108's lesson). A caller with neither is
-- still rejected as unauthenticated.
--
-- Everything below the identity resolution is byte-identical to 234.
--
-- Impact at time of writing: 9 of 36 accounts are anonymous, 2 active in
-- the last 7 days.
--
-- Paste-safe: public.<table>, auth.<fn>(), bare columns, least/greatest,
-- and no bare angle-bracket comparison operators in any statement body.

CREATE OR REPLACE FUNCTION public.start_dm_conversation(
  p_other_email TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_email_raw  TEXT := coalesce(auth.email(), '');
  v_email      TEXT := lower(coalesce(auth.email(), ''));
  v_other      TEXT := lower(trim(coalesce(p_other_email, '')));
  v_key        TEXT;
  v_parts      TEXT[];
  v_accepted   TEXT[];
  v_follows    BOOLEAN := FALSE;
  v_blocked    BOOLEAN := FALSE;
  v_conv_id    UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Guest sessions have no JWT email. Fall back to the profile address
  -- that the rest of the DM system already treats as their identity.
  IF v_email = '' THEN
    SELECT lower(coalesce(email, '')) INTO v_email
      FROM public.user_profiles
     WHERE id = v_uid;
    v_email := coalesce(v_email, '');
    v_email_raw := v_email;
  END IF;

  IF v_email = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF v_other = '' OR v_other = v_email THEN
    RAISE EXCEPTION 'invalid_recipient' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.dm_request_blocks
   WHERE blocker_email = v_email
     AND blocked_email = v_other;

  v_key   := least(v_email, v_other) || '|' || greatest(v_email, v_other);
  v_parts := ARRAY[least(v_email, v_other), greatest(v_email, v_other)];

  SELECT id INTO v_conv_id
    FROM public.hub_conversations
   WHERE participant_key = v_key
   LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.hub_follows
     WHERE lower(follower_email) = v_other
       AND lower(followee_email) = v_email
  ) INTO v_follows;

  IF v_follows THEN
    v_accepted := ARRAY[v_email, v_other];
  ELSE
    SELECT EXISTS (
      SELECT 1
        FROM public.dm_request_blocks
       WHERE blocker_email = v_other
         AND blocked_email = v_email
    ) INTO v_blocked;

    IF v_blocked THEN
      RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
    END IF;

    v_accepted := ARRAY[v_email];
  END IF;

  INSERT INTO public.hub_conversations
    (created_by, user_id, participant_key, participant_emails,
     accepted_emails, is_group,
     last_message_at, last_message_preview,
     created_at, created_date, updated_at)
  VALUES
    (v_email_raw, v_uid, v_key, v_parts,
     v_accepted, FALSE,
     now(), '',
     now(), now(), now())
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_conv_id
    FROM public.hub_conversations
   WHERE participant_key = v_key
   LIMIT 1;
  RETURN v_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_dm_conversation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_dm_conversation(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_dm_conversation(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
