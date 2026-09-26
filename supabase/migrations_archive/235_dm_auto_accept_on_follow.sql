-- 235_dm_auto_accept_on_follow.sql
--
-- "Once they are following them, messages are then direct" — the
-- RETROACTIVE half of the message-requests feature.
--
-- Migration 234 decides acceptance at conversation-creation time. This
-- one closes the loop for conversations that already exist: the moment
-- A follows B, any pending 1:1 request FROM B TO A flips to accepted
-- for A, so it moves out of A's Requests and into their Inbox with no
-- data migration and no client round-trip.
--
-- Implemented as an AFTER INSERT trigger on hub_follows. Columns are
-- follower_email / followee_email — NOT followed_email (mig 109 fixed
-- that typo, which had broken 100% of Block-button clicks). Both the
-- id and email columns are trigger-maintained bidirectionally (mig 208
-- + 217), so an id-only client write still lands here with the emails
-- populated because THIS trigger fires AFTER the BEFORE-trigger fill.
--
-- Group conversations are skipped: following one member of a group is
-- not consent to hear from the rest of it.
--
-- The trigger also clears any pair-keyed request block the follower
-- holds on the followee (mig 234's dm_request_blocks). Deleting
-- someone's message request quietly blocks them from opening a new one;
-- choosing to follow that person is an unambiguous reversal of that, so
-- the block must not outlive it.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS. The
-- backfill at the bottom is an append-if-absent, so re-running is a
-- no-op.
-- Paste-safe: public.<table>, NEW./OLD., bare columns only.

CREATE OR REPLACE FUNCTION public.dm_accept_conversations_on_follow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_follower TEXT := lower(coalesce(NEW.follower_email, ''));
  v_followee TEXT := lower(coalesce(NEW.followee_email, ''));
BEGIN
  IF v_follower = '' OR v_followee = '' OR v_follower = v_followee THEN
    RETURN NEW;
  END IF;

  -- Following someone reverses any request block placed on them.
  DELETE FROM public.dm_request_blocks
   WHERE blocker_email = v_follower
     AND blocked_email = v_followee;

  UPDATE public.hub_conversations
     SET accepted_emails = array_append(
           coalesce(accepted_emails, ARRAY[]::text[]), v_follower),
         updated_at = now()
   WHERE coalesce(is_group, FALSE) = FALSE
     AND coalesce(array_length(participant_emails, 1), 0) = 2
     AND v_follower = ANY (
       ARRAY(
         SELECT lower(participant_email)
           FROM unnest(participant_emails) AS participant_email
       )
     )
     AND v_followee = ANY (
       ARRAY(
         SELECT lower(participant_email)
           FROM unnest(participant_emails) AS participant_email
       )
     )
     AND NOT (
       v_follower = ANY (
         ARRAY(
           SELECT lower(accepted_email)
             FROM unnest(coalesce(accepted_emails, ARRAY[]::text[]))
               AS accepted_email
         )
       )
     );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A follow must never fail because of DM bookkeeping.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dm_accept_conversations_on_follow ON public.hub_follows;
CREATE TRIGGER trg_dm_accept_conversations_on_follow
  AFTER INSERT ON public.hub_follows
  FOR EACH ROW
  EXECUTE FUNCTION public.dm_accept_conversations_on_follow();

-- ─────────────────────────────────────────────────────────────────────
-- Backfill: apply the same rule to every follow that already exists.
--
-- Two reasons this matters:
--   • Existing threads between people who already follow each other were
--     never explicitly accepted (mig 113's backfill only covered rows
--     that predated it), so without this they would read as "pending"
--     and mig 234's one-message cap would start blocking real,
--     long-running conversations.
--   • It makes the client's follow-graph Inbox rule (which has always
--     treated "I follow them" as Inbox) match the stored server state.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_follower TEXT;
  v_followee TEXT;
BEGIN
  FOR v_follower, v_followee IN
    SELECT lower(follower_email), lower(followee_email)
      FROM public.hub_follows
     WHERE follower_email IS NOT NULL
       AND followee_email IS NOT NULL
  LOOP
    UPDATE public.hub_conversations
       SET accepted_emails = array_append(
             coalesce(accepted_emails, ARRAY[]::text[]), v_follower),
           updated_at = now()
     WHERE coalesce(is_group, FALSE) = FALSE
       AND coalesce(array_length(participant_emails, 1), 0) = 2
       AND v_follower = ANY (
         ARRAY(
           SELECT lower(participant_email)
             FROM unnest(participant_emails) AS participant_email
         )
       )
       AND v_followee = ANY (
         ARRAY(
           SELECT lower(participant_email)
             FROM unnest(participant_emails) AS participant_email
         )
       )
       AND NOT (
         v_follower = ANY (
           ARRAY(
             SELECT lower(accepted_email)
               FROM unnest(coalesce(accepted_emails, ARRAY[]::text[]))
                 AS accepted_email
           )
         )
       );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
