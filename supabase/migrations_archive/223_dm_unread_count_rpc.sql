-- 223_dm_unread_count_rpc.sql
--
-- Viral-load prep, pass 5: stop pulling message rows to count them.
--
-- The DM inbox badge (hubMessages.unreadCountFor) pulled the 400
-- newest readable messages over the wire every poll and counted
-- unread client-side — the code's own TODO(scale) flagged this. At N
-- polling clients that's 400·N rows of steady-state read traffic for
-- a single integer, and the 400-row window still undercounts on very
-- active accounts.
--
-- dm_unread_count() runs the COUNT server-side, replicating the
-- client's _isUnread semantics exactly:
--   • only messages in conversations the caller participates in
--     (scoped on auth.email() server-side — SECURITY DEFINER bypasses
--     RLS, so the participant check is re-implemented here rather
--     than trusting a client-supplied email);
--   • the caller's own messages never count;
--   • poll-vote control messages never count (body prefix
--     '[POLL_VOTE_V1]' — see src/lib/dmPolls.js; left() not LIKE, so
--     the underscores aren't treated as wildcards);
--   • p_last_reads carries the client's per-conversation localStorage
--     last-read timestamps ({ "<conversation_id>": <epoch_ms> }) so
--     the instant badge-clear on opening a conversation keeps working:
--     for those conversations, unread = newer than last-read; for the
--     rest, unread = read_at IS NULL (the DB fallback, same as JS).
--
-- The client keeps the old 400-row path as a fallback until this
-- migration is applied (42883 → legacy behavior), mirroring the
-- set_post_reaction rollout pattern from migration 024.

CREATE OR REPLACE FUNCTION public.dm_unread_count(p_last_reads JSONB DEFAULT '{}'::jsonb)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $dm_unread$
  WITH me AS (
    SELECT lower(auth.email()) AS my_email
  ),
  my_convs AS (
    SELECT id AS conv_id
      FROM public.hub_conversations
     WHERE EXISTS (
             SELECT 1 FROM unnest(participant_emails) AS pe
              WHERE lower(pe) = (SELECT my_email FROM me)
           )
  )
  SELECT COALESCE(count(*), 0)::integer
    FROM public.hub_messages
   WHERE conversation_id IN (SELECT conv_id FROM my_convs)
     AND lower(COALESCE(sender_email, '')) IS DISTINCT FROM (SELECT my_email FROM me)
     AND left(COALESCE(NULLIF(body, ''), content, ''), 14) <> '[POLL_VOTE_V1]'
     AND CASE
           WHEN p_last_reads ? conversation_id::text
             THEN COALESCE(created_date, created_at)
                  > to_timestamp(((p_last_reads ->> conversation_id::text)::numeric) / 1000.0)
           ELSE read_at IS NULL
         END;
$dm_unread$;

REVOKE ALL ON FUNCTION public.dm_unread_count(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dm_unread_count(JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
