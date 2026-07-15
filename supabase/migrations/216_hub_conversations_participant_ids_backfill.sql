-- 216_hub_conversations_participant_ids_backfill.sql
--
-- hub_conversations.participant_ids (uuid[]) exists but was never
-- populated — every row carried an empty array while participant_emails
-- held the real membership. This is the last email-keyed table without a
-- filled id twin, and it blocks migrating the DM read/write path (and,
-- transitively, dropping email from the public_profiles view) onto ids.
--
-- This migration is DATA-ONLY and non-breaking: nothing reads
-- participant_ids yet, so filling it changes no behavior. It installs a
-- BEFORE INSERT/UPDATE trigger that derives participant_ids from
-- participant_emails whenever the id array is null/empty, then touches
-- every existing row so the trigger backfills it. The client switch to
-- participant_ids (plus the RLS dual-predicate) is a separate later phase.
--
-- Verified pre-flight on prod: all 22 participant slots across 11
-- conversations resolve to a user_profiles id (0 orphans), so the
-- backfill leaves no nulls.

-- ── Trigger function: resolve participant_ids from participant_emails ──
-- SECURITY DEFINER so the email→id lookup can read user_profiles
-- regardless of the writer's RLS. Only fills the array when it is
-- currently null/empty, so it never clobbers an explicitly-set value and
-- is safe to run repeatedly (idempotent touch).
CREATE OR REPLACE FUNCTION public.sync_conversation_participant_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF NEW.participant_emails IS NOT NULL
     AND (NEW.participant_ids IS NULL OR array_length(NEW.participant_ids, 1) IS NULL) THEN
    SELECT array_agg(id ORDER BY id)
      INTO v_ids
      FROM public.user_profiles
     WHERE lower(email) = ANY (SELECT lower(e) FROM unnest(NEW.participant_emails) AS e);
    NEW.participant_ids := v_ids;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_conversation_participant_ids ON public.hub_conversations;
CREATE TRIGGER trg_sync_conversation_participant_ids
BEFORE INSERT OR UPDATE ON public.hub_conversations
FOR EACH ROW
EXECUTE FUNCTION public.sync_conversation_participant_ids();

-- ── Backfill: touch every under-populated row so the trigger fires ──
-- Assigning participant_emails to itself is a no-op write that trips the
-- BEFORE UPDATE trigger, which then fills participant_ids. Paste-safe:
-- single-table statement, bare columns only.
UPDATE public.hub_conversations
SET participant_emails = participant_emails
WHERE participant_ids IS NULL OR array_length(participant_ids, 1) IS NULL;
