-- Message reactions are visible only to the people who can see the message.
--
-- Found in the 2026-09-30 app audit, as a signed-in guest:
--
-- * crew_message_reactions had SELECT USING (true), so any signed-in user
--   could list every reaction in every crew chat, private crews included:
--   who reacted, to which message, with what. crew_messages itself is
--   members-only (is_crew_member), so the reactions leaked activity the
--   messages they hang off do not.
-- * Its INSERT policy, and dm_message_reactions' INSERT policy, only checked
--   user_id = auth.uid(), so anyone holding a message id could react to a
--   crew chat or DM they are not part of. toggle_crew_reaction and
--   toggle_dm_reaction (the RPCs the app calls) had the same gap.
--
-- The fix leans on the message tables' own RLS: an EXISTS over
-- crew_messages / hub_messages only finds a row the caller may already
-- see, so each policy stays bare columns and inherits the membership rule
-- instead of restating it. The two RPCs are SECURITY DEFINER and bypass
-- RLS, so they check membership explicitly.

-- crew_message_reactions -------------------------------------------------

DROP POLICY IF EXISTS crew_rxns_select ON public.crew_message_reactions;
CREATE POLICY crew_rxns_select ON public.crew_message_reactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.crew_messages m WHERE m.id = message_id));

DROP POLICY IF EXISTS crew_rxns_insert ON public.crew_message_reactions;
CREATE POLICY crew_rxns_insert ON public.crew_message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.crew_messages m WHERE m.id = message_id)
  );

-- dm_message_reactions ---------------------------------------------------

DROP POLICY IF EXISTS dm_rxns_insert ON public.dm_message_reactions;
CREATE POLICY dm_rxns_insert ON public.dm_message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.hub_messages m WHERE m.id = message_id)
  );

ALTER POLICY dm_rxns_delete ON public.dm_message_reactions TO authenticated;

-- toggle RPCs ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.toggle_crew_reaction(p_message_id uuid, p_user_id uuid, p_emoji text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    UUID := auth.uid();
  v_crew   UUID;
  v_exists BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_message_id IS NULL OR p_emoji IS NULL THEN
    RAISE EXCEPTION 'message_id and emoji required' USING ERRCODE = '22023';
  END IF;
  IF char_length(p_emoji) > 10 THEN
    RAISE EXCEPTION 'emoji too long' USING ERRCODE = '22023';
  END IF;

  SELECT crew_id INTO v_crew FROM public.crew_messages WHERE id = p_message_id;
  IF v_crew IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.crew_members WHERE crew_id = v_crew AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'not a member of this crew' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.crew_message_reactions
     WHERE message_id = p_message_id AND user_id = v_uid AND emoji = p_emoji
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.crew_message_reactions
     WHERE message_id = p_message_id AND user_id = v_uid AND emoji = p_emoji;
    RETURN FALSE;
  ELSE
    INSERT INTO public.crew_message_reactions (message_id, user_id, emoji)
    VALUES (p_message_id, v_uid, p_emoji)
    ON CONFLICT DO NOTHING;
    RETURN TRUE;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.toggle_dm_reaction(p_message_id uuid, p_user_id uuid, p_emoji text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    UUID := auth.uid();
  v_exists BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_message_id IS NULL OR p_emoji IS NULL THEN
    RAISE EXCEPTION 'message_id and emoji required' USING ERRCODE = '22023';
  END IF;
  IF char_length(p_emoji) > 10 THEN
    RAISE EXCEPTION 'emoji too long' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.hub_messages m
      JOIN public.hub_conversations c ON c.id = m.conversation_id
     WHERE m.id = p_message_id
       AND v_uid = ANY (c.participant_ids)
  ) THEN
    RAISE EXCEPTION 'not a participant in this conversation' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.dm_message_reactions
     WHERE message_id = p_message_id AND user_id = v_uid AND emoji = p_emoji
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.dm_message_reactions
     WHERE message_id = p_message_id AND user_id = v_uid AND emoji = p_emoji;
    RETURN FALSE;
  ELSE
    INSERT INTO public.dm_message_reactions (message_id, user_id, emoji)
    VALUES (p_message_id, v_uid, p_emoji)
    ON CONFLICT DO NOTHING;
    RETURN TRUE;
  END IF;
END;
$function$;

-- Fail the migration if any reaction read policy is still open to everyone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('crew_message_reactions', 'dm_message_reactions')
       AND cmd = 'SELECT'
       AND qual = 'true'
  ) THEN
    RAISE EXCEPTION 'a message reaction SELECT policy is still USING (true)';
  END IF;
END $$;
