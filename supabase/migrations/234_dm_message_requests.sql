-- 234_dm_message_requests.sql
--
-- "Message requests" for 1:1 DMs — the send-gating half.
--
-- Builds ON TOP of migration 113's accepted_emails system (do NOT invent
-- a second accept-state store). 113 gave us:
--   • hub_conversations.accepted_emails TEXT[]
--   • accept_conversation(p_conv_id)     — appends auth.email()
--   • trg_auto_accept_on_send            — sending implicitly accepts
-- and 116's create_group_conversation already seeds accepted_emails with
-- just the creator for groups.
--
-- What was missing, and what this migration adds:
--
--  1. `declined_emails TEXT[]` — a per-viewer "delete this request"
--     tombstone. Deleting the shared conversation row would also wipe
--     the sender's copy, so a decline hides the thread for the decliner
--     only. Cleared again if they later start the conversation
--     themselves or follow the other person (mig 235).
--
--  2. `start_dm_conversation(p_other_email)` — SECURITY DEFINER creator
--     for 1:1 DMs that decides acceptance SERVER-SIDE at creation time:
--       • recipient already follows the sender → accepted by BOTH
--         (thread lands straight in the recipient's Inbox)
--       • otherwise                            → accepted by the sender
--         only (thread lands in the recipient's Requests)
--     Gated on auth.uid()/auth.email() — the caller identity is never
--     taken from a client-supplied parameter (mig 108's lesson). Only
--     the PEER is passed in, exactly like mig 116's group RPC.
--
--  3. `dm_pending_send_allowed(p_conv_id)` + a RESTRICTIVE INSERT policy
--     on hub_messages — the anti-spam rule. While a 1:1 conversation is
--     still pending (some other participant has not accepted), the
--     sender may have at most ONE message in it. Enforced in the
--     database so a hand-rolled client can't bypass it.
--
--  4. `decline_conversation(p_conv_id)` — the Requests-row "Delete"
--     action. Also used by "Block" (block_user_full runs first, this
--     hides the thread).
--
--  5. `accept_conversation` is re-created so accepting also clears the
--     caller's decline tombstone.
--
-- Group conversations are deliberately EXEMPT from the one-message cap:
-- a group creator legitimately talks into a group whose members have
-- not accepted yet, and capping that would break mig 116's flow.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP POLICY IF EXISTS before CREATE POLICY.
-- Paste-safe: public.<table>, auth.<fn>(), NEW./OLD., bare columns.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Per-viewer decline tombstone
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.hub_conversations
  ADD COLUMN IF NOT EXISTS declined_emails TEXT[] DEFAULT '{}'::text[];

-- ─────────────────────────────────────────────────────────────────────
-- 2. start_dm_conversation — server-decided acceptance at create time
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_dm_conversation(
  p_other_email TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_email     TEXT := lower(coalesce(auth.email(), ''));
  v_other     TEXT := lower(trim(coalesce(p_other_email, '')));
  v_key       TEXT;
  v_parts     TEXT[];
  v_accepted  TEXT[];
  v_follows   BOOLEAN := FALSE;
  v_conv_id   UUID;
BEGIN
  IF v_uid IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_other = '' OR v_other = v_email THEN
    RAISE EXCEPTION 'invalid_recipient' USING ERRCODE = '22023';
  END IF;

  -- Same stable pair key the client builds (sorted, '|'-joined), so the
  -- partial UNIQUE index on participant_key keeps this idempotent.
  IF v_email < v_other THEN
    v_key   := v_email || '|' || v_other;
    v_parts := ARRAY[v_email, v_other];
  ELSE
    v_key   := v_other || '|' || v_email;
    v_parts := ARRAY[v_other, v_email];
  END IF;

  SELECT id INTO v_conv_id
    FROM public.hub_conversations
   WHERE participant_key = v_key
   LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    -- Re-opening a thread the caller had previously declined un-hides
    -- it for them; otherwise they would compose into an invisible
    -- conversation. Acceptance is NOT forced here — mig 113's
    -- trg_auto_accept_on_send handles that the moment they send.
    UPDATE public.hub_conversations
       SET declined_emails = array_remove(
             coalesce(declined_emails, ARRAY[]::text[]), v_email),
           updated_at = now()
     WHERE id = v_conv_id;
    RETURN v_conv_id;
  END IF;

  -- Does the RECIPIENT already follow the SENDER? If so this is a
  -- direct message, not a request. hub_follows uses follower_email /
  -- followee_email (mig 109 fixed the followed_email typo) and both
  -- id + email columns are trigger-maintained (mig 208 + 217).
  SELECT EXISTS (
    SELECT 1
      FROM public.hub_follows
     WHERE lower(follower_email) = v_other
       AND lower(followee_email) = v_email
  ) INTO v_follows;

  IF v_follows THEN
    v_accepted := ARRAY[v_email, v_other];
  ELSE
    v_accepted := ARRAY[v_email];
  END IF;

  -- participant_ids is intentionally omitted — mig 216's BEFORE INSERT
  -- trigger resolves it from participant_emails.
  INSERT INTO public.hub_conversations
    (created_by, user_id, participant_key, participant_emails,
     accepted_emails, declined_emails, is_group,
     last_message_at, last_message_preview,
     created_at, created_date, updated_at)
  VALUES
    (v_email, v_uid, v_key, v_parts,
     v_accepted, ARRAY[]::text[], FALSE,
     now(), '',
     now(), now(), now())
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
EXCEPTION WHEN unique_violation THEN
  -- Concurrent double-tap: the other transaction won the partial UNIQUE
  -- index on participant_key. Return the row it inserted.
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

-- ─────────────────────────────────────────────────────────────────────
-- 3. Anti-spam: one message per pending 1:1 request
-- ─────────────────────────────────────────────────────────────────────
-- Returns TRUE when the CALLER is allowed to insert another message in
-- p_conv_id. FALSE only for the narrow case: a 2-person, non-group
-- conversation where the other participant has not accepted and the
-- caller already has a message in it.
--
-- SECURITY DEFINER so the check can read hub_conversations /
-- hub_messages without recursing through their own RLS. Caller identity
-- comes from auth.email() — never from a parameter.
CREATE OR REPLACE FUNCTION public.dm_pending_send_allowed(
  p_conv_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email    TEXT := lower(coalesce(auth.email(), ''));
  v_parts    TEXT[];
  v_accepted TEXT[];
  v_group    BOOLEAN;
  v_pending  INTEGER;
  v_sent     INTEGER;
BEGIN
  -- No conversation context (or no session) → nothing to gate; the
  -- existing permissive policies still decide the insert.
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

  -- Groups and malformed membership are exempt.
  IF v_group OR coalesce(array_length(v_parts, 1), 0) <> 2 THEN
    RETURN TRUE;
  END IF;

  SELECT count(*)
    INTO v_pending
    FROM unnest(v_parts) AS participant_email
   WHERE lower(participant_email) <> v_email
     AND NOT (
       lower(participant_email) = ANY (
         SELECT lower(accepted_email)
           FROM unnest(coalesce(v_accepted, ARRAY[]::text[])) AS accepted_email
       )
     );

  -- Everyone else already accepted → normal direct messaging.
  IF v_pending = 0 THEN
    RETURN TRUE;
  END IF;

  SELECT count(*)
    INTO v_sent
    FROM public.hub_messages
   WHERE conversation_id = p_conv_id
     AND lower(coalesce(sender_email, created_by, '')) = v_email;

  RETURN v_sent < 1;
END;
$$;

REVOKE ALL ON FUNCTION public.dm_pending_send_allowed(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dm_pending_send_allowed(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.dm_pending_send_allowed(UUID) TO authenticated;

-- RESTRICTIVE so it ANDs with mig 011's permissive "hub_messages: insert"
-- policy instead of widening it. Scoped TO authenticated so service_role
-- fanouts and SECURITY DEFINER RPCs (scheduled sends, etc.) are untouched.
DROP POLICY IF EXISTS "hub_messages: pending request send cap" ON public.hub_messages;
CREATE POLICY "hub_messages: pending request send cap"
  ON public.hub_messages
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.dm_pending_send_allowed(conversation_id));

-- ─────────────────────────────────────────────────────────────────────
-- 4. decline_conversation — the Requests-row "Delete" action
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decline_conversation(
  p_conv_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(coalesce(auth.email(), ''));
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.hub_conversations
     SET declined_emails = (
           CASE
             WHEN v_email = ANY (coalesce(declined_emails, ARRAY[]::text[]))
               THEN declined_emails
             ELSE array_append(coalesce(declined_emails, ARRAY[]::text[]), v_email)
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
END;
$$;

REVOKE ALL ON FUNCTION public.decline_conversation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decline_conversation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.decline_conversation(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5. accept_conversation — same contract as mig 113, plus it clears the
--    caller's decline tombstone so Accept always wins over a stale
--    Delete. Still idempotent.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_conversation(
  p_conv_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := auth.email();
  v_lc    TEXT := lower(coalesce(auth.email(), ''));
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.hub_conversations
     SET accepted_emails = (
           CASE
             WHEN v_lc = ANY (
               ARRAY(
                 SELECT lower(accepted_email)
                   FROM unnest(coalesce(accepted_emails, ARRAY[]::text[]))
                     AS accepted_email
               )
             )
               THEN accepted_emails
             ELSE array_append(coalesce(accepted_emails, ARRAY[]::text[]), v_lc)
           END
         ),
         declined_emails = array_remove(
           coalesce(declined_emails, ARRAY[]::text[]), v_lc),
         updated_at = now()
   WHERE id = p_conv_id
     AND v_lc = ANY (
       ARRAY(
         SELECT lower(participant_email)
           FROM unnest(coalesce(participant_emails, ARRAY[]::text[]))
             AS participant_email
       )
     );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_conversation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_conversation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_conversation(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
