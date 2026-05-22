-- 116_group_conversations.sql
--
-- Group DMs. hub_conversations.participant_emails is already a text[]
-- (mig 001) and the RLS policy uses `auth.email() = any(...)`, so the
-- table already supports N-participant threads. What's missing is:
--
--   • A `title` column for the group's display name.
--   • An `is_group` flag for the inbox/header to render differently.
--   • A creation RPC that validates participant count + permissions
--     and auto-accepts the creator (mig 113's accepted_emails system).
--
-- Group cap = 10 participants total (creator + 9 others). Bigger
-- groups should become Crews; that's a different surface with its own
-- mod tooling.

ALTER TABLE public.hub_conversations
  ADD COLUMN IF NOT EXISTS title    TEXT,
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE;

-- ─────────────────────────────────────────────────────────────────────
-- RPC: create_group_conversation
--
-- Creates a new conversation with the caller + p_emails as participants.
-- Auto-accepts the caller (so the group lands in their main inbox, not
-- Requests). Other participants land in their Requests folder until
-- they reply or explicitly accept — same flow as 1:1 DMs.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_group_conversation(
  p_emails TEXT[],
  p_title  TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_email     TEXT := auth.email();
  v_all       TEXT[];
  v_total     INTEGER;
  v_conv_id   UUID;
  v_title     TEXT;
BEGIN
  IF v_uid IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_emails IS NULL OR array_length(p_emails, 1) IS NULL THEN
    RAISE EXCEPTION 'no_participants' USING ERRCODE = '22023';
  END IF;

  -- De-dupe (case-insensitive) and exclude the caller — they're added
  -- below to guarantee they're a participant even if absent from input.
  SELECT ARRAY(
    SELECT DISTINCT lower(e)
      FROM unnest(p_emails) AS e
     WHERE e IS NOT NULL
       AND length(trim(e)) > 0
       AND lower(e) <> lower(v_email)
  ) INTO v_all;

  v_total := coalesce(array_length(v_all, 1), 0) + 1; -- +1 for caller
  IF v_total < 3 THEN
    -- A "group" of 2 is just a 1:1; route the caller through the
    -- existing findOrCreateConversation path instead.
    RAISE EXCEPTION 'too_few_participants' USING ERRCODE = '22023';
  END IF;
  IF v_total > 10 THEN
    RAISE EXCEPTION 'too_many_participants' USING ERRCODE = '22023';
  END IF;

  -- Trim the user-supplied title; NULL out empty strings so the header
  -- renders the generated participant list instead.
  v_title := nullif(trim(coalesce(p_title, '')), '');

  INSERT INTO public.hub_conversations
    (created_by, user_id, participant_emails, participant_ids,
     is_group, title, accepted_emails,
     last_message_at, created_at, updated_at)
  VALUES
    (v_email, v_uid,
     v_all || ARRAY[lower(v_email)],
     ARRAY[v_uid]::uuid[],
     TRUE, v_title, ARRAY[lower(v_email)],
     now(), now(), now())
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_group_conversation(TEXT[], TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
