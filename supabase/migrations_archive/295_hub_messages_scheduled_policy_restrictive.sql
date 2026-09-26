-- Migration 295: every DM in the app was readable by every signed-in user
--
-- SEVERITY: highest of this audit. Not a leak of metadata or counts — the
-- message bodies themselves.
--
-- `hub_messages` had two PERMISSIVE SELECT policies. Postgres OR's permissive
-- policies together, so a row is visible if EITHER passes:
--
--   "hub_messages: select"                      -- correct, participant-gated
--     created_by = me OR user_id = me
--     OR EXISTS (conversation where I am a participant)
--
--   "hub_messages: scheduled visible to sender only"
--     status IS DISTINCT FROM 'scheduled' OR created_by = me OR user_id = me
--
-- The second was written to NARROW access — hide scheduled sends from
-- everyone but their sender. Written as PERMISSIVE it does the opposite: its
-- first clause is TRUE for every message that isn't scheduled, which is
-- essentially all of them, so it grants SELECT on the whole table to anyone
-- authenticated and the participant check beside it never gets to matter.
--
-- Verified against production before writing this. As a user who is in
-- neither participant array of a 14-message thread:
--
--   outsider reads that conversation's messages   -> 14   (should be 0)
--   outsider reads ALL messages app-wide          -> 46 of 46
--   outsider reads the conversation ROW           -> 0    (correctly gated)
--   participant reads that conversation           -> 14   (correct)
--   anon                                          -> DENIED
--
-- `hub_conversations` was gated correctly the whole time, which is what made
-- this hard to see: the thread list looks right, because you only ever see
-- your own conversations. It's the message rows underneath that were open,
-- and only a direct PostgREST query on hub_messages shows it.
--
-- The account used in that test was a guest, so this was reachable by anyone
-- who tapped "continue as guest" — no account approval, no follow, nothing.
--
-- THE FIX: make it RESTRICTIVE. Restrictive policies AND with the permissive
-- set, which is the semantics the name always described:
--
--   (participant check)  AND  (not scheduled OR I am the sender)
--
-- Nothing else changes. The participant policy is already correct and is left
-- exactly as it is.
--
-- GENERAL RULE worth keeping: a policy whose NAME contains "only", or that
-- exists to hide a subset of rows, must be RESTRICTIVE. A PERMISSIVE policy
-- can never remove access — it can only add it. Check `polpermissive` in
-- pg_policy when a table has more than one policy for the same command.
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE.

DROP POLICY IF EXISTS "hub_messages: scheduled visible to sender only" ON public.hub_messages;

CREATE POLICY "hub_messages: scheduled visible to sender only"
  ON public.hub_messages
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    status IS DISTINCT FROM 'scheduled'
    OR created_by = (SELECT NULLIF(public.current_user_email(), ''))
    OR user_id    = (SELECT auth.uid())
  );
