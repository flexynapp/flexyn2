-- 234_dm_message_requests.sql
--
-- "Message requests" for 1:1 DMs — the send-gating half.
--
-- NOTE (same-session amendment): an earlier draft of this file added a
-- `declined_emails` tombstone column + decline_conversation() so that
-- "Delete" on a request hid the thread for the decliner only. Product
-- decision reversed that — Delete is now a REAL destructive purge — so
-- the column and the RPC are gone rather than shipped dead. This file
-- has never been applied to any database, so it was amended in place
-- instead of being followed by a drop-column migration. If your DB
-- somehow already has hub_conversations.declined_emails, it is unused
-- and safe to drop.
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
--  1. `start_dm_conversation(p_other_email)` — SECURITY DEFINER creator
--     for 1:1 DMs that decides acceptance SERVER-SIDE at creation time:
--       • recipient already follows the sender → accepted by BOTH
--         (thread lands straight in the recipient's Inbox)
--       • otherwise                            → accepted by the sender
--         only (thread lands in the recipient's Requests)
--     Gated on auth.uid()/auth.email() — the caller identity is never
--     taken from a client-supplied parameter (mig 108's lesson). Only
--     the PEER is passed in, exactly like mig 116's group RPC.
--
--  2. `dm_pending_send_allowed(p_conv_id)` + a RESTRICTIVE INSERT policy
--     on hub_messages — the anti-spam rule. While a 1:1 conversation is
--     still pending (some other participant has not accepted), the
--     sender may have at most ONE message in it. Enforced in the
--     database so a hand-rolled client can't bypass it.
--
--  3. `purge_message_request(p_conv_id)` — the Requests-row "Delete"
--     action, and a genuinely destructive delete. Removes the
--     conversation row, which cascades to hub_messages and everything
--     hanging off it, so nothing is orphaned.
--
--     Deliberately NARROW. The conversation row is shared, so the purge
--     is only permitted when ALL of these hold, checked server-side
--     against the stored row:
--       • the caller is a participant
--       • the thread is non-group with exactly 2 participants
--       • the caller has NOT accepted it — i.e. it is still a pending
--         REQUEST for them
--     An accepted, active conversation therefore cannot be nuked out
--     from under the other person; that path raises. Archive
--     (per-device localStorage) stays the way to bury an accepted thread.
--
-- Group conversations are exempt from BOTH the one-message cap and the
-- purge: a group creator legitimately talks into a group whose members
-- have not accepted yet, and no single member should be able to delete
-- a group thread for everyone.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS before
-- CREATE POLICY, DROP FUNCTION IF EXISTS for the retired RPC.
-- Paste-safe: public.<table>, auth.<fn>(), NEW./OLD., bare columns.

-- ─────────────────────────────────────────────────────────────────────
-- 1. start_dm_conversation — server-decided acceptance at create time
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
     accepted_emails, is_group,
     last_message_at, last_message_preview,
     created_at, created_date, updated_at)
  VALUES
    (v_email, v_uid, v_key, v_parts,
     v_accepted, FALSE,
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
-- 2. Anti-spam: one message per pending 1:1 request
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
-- 3. purge_message_request — the Requests-row "Delete" action
-- ─────────────────────────────────────────────────────────────────────
-- Hard-deletes the conversation. Cascade chain (all pre-existing
-- ON DELETE CASCADE, verified against the migrations that declare them):
--
--   hub_conversations
--     ├─ hub_messages             (conversation_id, mig 001)
--     │    ├─ dm_message_reactions  (message_id, mig 064)
--     │    ├─ dm_polls              (message_id, mig 144)
--     │    │    └─ dm_poll_votes    (poll_id,    mig 144)
--     │    └─ hub_messages.replied_to_message_id → ON DELETE SET NULL
--     │       (self-ref; a reply can only target a message in the same
--     │        conversation, so those rows are being deleted anyway)
--     └─ dm_polls                 (conversation_id, mig 144)
--
-- So a single DELETE on hub_conversations leaves nothing orphaned. Read
-- receipts live on hub_messages itself (read_at / read_by), and the
-- per-device last-read map is localStorage, so neither needs cleanup.
--
-- Returns TRUE when a row was deleted, FALSE when there was nothing to
-- delete (already purged) — the client treats FALSE as success so a
-- double-tap doesn't surface an error.
CREATE OR REPLACE FUNCTION public.purge_message_request(
  p_conv_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email    TEXT := lower(coalesce(auth.email(), ''));
  v_parts    TEXT[];
  v_accepted TEXT[];
  v_group    BOOLEAN;
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

  -- Already gone. Idempotent no-op so a double-tap stays silent.
  IF v_parts IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Must be a participant. Read off the STORED row — never a
  -- client-passed email.
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

  -- Groups are never purgeable by a single member.
  IF v_group OR coalesce(array_length(v_parts, 1), 0) <> 2 THEN
    RAISE EXCEPTION 'not_a_message_request' USING ERRCODE = '42501';
  END IF;

  -- Only a thread the caller has NOT accepted — i.e. one that is still
  -- a pending request for them. Once accepted, the other person has a
  -- real conversation here and it is not this caller's to destroy.
  IF v_email = ANY (
    ARRAY(
      SELECT lower(accepted_email)
        FROM unnest(coalesce(v_accepted, ARRAY[]::text[])) AS accepted_email
    )
  ) THEN
    RAISE EXCEPTION 'conversation_already_accepted' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.hub_conversations WHERE id = p_conv_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_message_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_message_request(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.purge_message_request(UUID) TO authenticated;

-- Retired with the tombstone design. Harmless if it was never created.
DROP FUNCTION IF EXISTS public.decline_conversation(UUID);

NOTIFY pgrst, 'reload schema';
