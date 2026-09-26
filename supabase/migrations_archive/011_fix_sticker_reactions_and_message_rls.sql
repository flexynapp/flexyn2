-- 011_fix_sticker_reactions_and_message_rls.sql
-- Run in Supabase SQL Editor.
--
-- Fix 1: post_sticker_reactions was created by the seed script without
--         item_rarity, so migration 010's CREATE TABLE IF NOT EXISTS was a
--         no-op. Add the missing column.
--
-- Fix 2: hub_messages RLS "with check" only lets the sender update rows.
--         Recipients cannot set read_at. Split into per-operation policies
--         so any conversation participant can mark messages read.

-- ── Fix 1: sticker reactions schema ──────────────────────────────────────────
ALTER TABLE public.post_sticker_reactions
  ADD COLUMN IF NOT EXISTS item_rarity TEXT NOT NULL DEFAULT 'common';

-- Also add item_name if it was missing from the seed-created table
-- (migration 010 didn't include it but it's useful for display)
ALTER TABLE public.post_sticker_reactions
  ADD COLUMN IF NOT EXISTS item_name TEXT;

-- ── Fix 2: hub_messages RLS — allow participants to mark messages read ────────
-- Drop the single all-operations policy and replace with per-operation policies.
DROP POLICY IF EXISTS "hub_messages: participant read/write" ON public.hub_messages;

-- SELECT: any conversation participant can read
CREATE POLICY "hub_messages: select"
  ON public.hub_messages FOR SELECT
  USING (
    auth.email() = created_by
    OR auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.hub_conversations c
      WHERE c.id = conversation_id
        AND (auth.email() = ANY(c.participant_emails)
             OR auth.uid() = ANY(c.participant_ids))
    )
  );

-- INSERT: only the sender
CREATE POLICY "hub_messages: insert"
  ON public.hub_messages FOR INSERT
  WITH CHECK (auth.email() = created_by OR auth.uid() = user_id);

-- UPDATE: any participant can update (needed for setting read_at on received messages)
CREATE POLICY "hub_messages: update"
  ON public.hub_messages FOR UPDATE
  USING (
    auth.email() = created_by
    OR auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.hub_conversations c
      WHERE c.id = conversation_id
        AND (auth.email() = ANY(c.participant_emails)
             OR auth.uid() = ANY(c.participant_ids))
    )
  )
  WITH CHECK (
    auth.email() = created_by
    OR auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.hub_conversations c
      WHERE c.id = conversation_id
        AND (auth.email() = ANY(c.participant_emails)
             OR auth.uid() = ANY(c.participant_ids))
    )
  );

-- DELETE: only the original sender
CREATE POLICY "hub_messages: delete"
  ON public.hub_messages FOR DELETE
  USING (auth.email() = created_by OR auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
