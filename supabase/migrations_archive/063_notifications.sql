-- 063_notifications.sql  (corrected)
--
-- In-app notifications for three social events. This migration writes into
-- the EXISTING public.notifications table (migration 017) — no schema
-- changes, just new triggers + helper RPCs. The triggers fire on:
--
--   • Post likes        — hub_reactions row with reaction_type='like'
--                         → notify the post author
--   • Sticker reactions — post_sticker_reactions insert
--                         → notify the post author
--   • Crew @everyone    — crew_messages where content contains '@everyone'
--                         → notify every crew member except the sender
--
-- ── HISTORY (why this file is rewritten) ─────────────────────────────────
-- The original version of this migration referenced tables that don't
-- exist in this repo (hub_post_likes, hub_post_reactions) and columns
-- that don't match the actual schema (hub_posts.user_email instead of
-- author_email, crew_messages.user_id instead of sender_id, public.profiles
-- instead of public.user_profiles). It also tried to define a parallel
-- notifications schema (actor_email / actor_name / payload) that
-- conflicted with 017's (user_email NOT NULL / title NOT NULL / body /
-- icon / link_url / metadata).
--
-- The corrected version below uses the actual table + column names and
-- packs the actor identity into the 017 metadata jsonb so the existing
-- NotificationPanel keeps working unchanged.
--
-- ── TODO(i18n) ───────────────────────────────────────────────────────────
-- Pre-rendered text is English-only for now. To translate, mirror the
-- 041_friend_notifications_i18n.sql pattern — add a CASE-by-language
-- text helper per type (post_like_text, post_reaction_text,
-- crew_everyone_text) and call it from the INSERT below.

-- ── Cleanup any partial state from the broken first attempt ──────────────
-- If the broken 063 was attempted earlier it would have aborted at the
-- first CREATE TRIGGER (those reference tables that don't exist), so any
-- objects defined BEFORE that point may still be present. Drop them so we
-- can re-create cleanly. None of these references are guaranteed to
-- exist; IF EXISTS guards keep this safe to re-run.
DROP FUNCTION IF EXISTS public._notify_post_like()      CASCADE;
DROP FUNCTION IF EXISTS public._notify_post_reaction()  CASCADE;
DROP FUNCTION IF EXISTS public._notify_crew_everyone()  CASCADE;
DROP FUNCTION IF EXISTS public._email_to_user_id(TEXT)  CASCADE;
DROP POLICY   IF EXISTS "notifications_own"             ON public.notifications;
DROP INDEX    IF EXISTS public.idx_notifications_user;

-- ── Trigger: post like → notification ────────────────────────────────────
-- Fires on every hub_reactions insert. We only notify on reaction_type='like'
-- (dislikes are silent to avoid harassing the post author with negative
-- attention). The post author's user_id and author_email are both already
-- on hub_posts, so no auth.users join is needed.

CREATE OR REPLACE FUNCTION public._notify_post_like()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$
DECLARE
  v_post       RECORD;
  v_actor_name TEXT;
BEGIN
  -- Silent for non-like reactions (dislike, etc.).
  IF NEW.reaction_type IS DISTINCT FROM 'like' THEN
    RETURN NEW;
  END IF;

  -- Recipient = post author. hub_posts uses author_email / user_id.
  SELECT p.user_id, p.author_email
    INTO v_post
    FROM public.hub_posts p
   WHERE p.id = NEW.post_id;

  IF v_post.user_id IS NULL OR v_post.author_email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip self-likes — the user reacting to their own post.
  IF v_post.user_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Actor display name from user_profiles. Fall back to the email
  -- local-part when the username hasn't been set yet, so the
  -- notification title never reads "null liked your post".
  SELECT username INTO v_actor_name
    FROM public.user_profiles
   WHERE id = NEW.user_id
   LIMIT 1;

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (v_post.user_id,
     v_post.author_email,
     'post_like',
     COALESCE(v_actor_name, split_part(COALESCE(NEW.user_email, NEW.created_by, ''), '@', 1), 'Someone')
       || ' liked your post',
     NULL,
     '❤️',
     '/hub',
     jsonb_build_object(
       'actor_id',    NEW.user_id,
       'actor_email', NEW.user_email,
       'actor_name',  v_actor_name,
       'post_id',     NEW.post_id
     ));

  RETURN NEW;
END;
$x$;

DROP TRIGGER IF EXISTS trg_notify_post_like ON public.hub_reactions;
CREATE TRIGGER trg_notify_post_like
  AFTER INSERT ON public.hub_reactions
  FOR EACH ROW EXECUTE FUNCTION public._notify_post_like();

-- ── Trigger: sticker reaction → notification ─────────────────────────────
-- post_sticker_reactions denormalizes user_name, user_email, item_emoji on
-- the row itself, so we don't need any joins to render the title.

CREATE OR REPLACE FUNCTION public._notify_post_reaction()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$
DECLARE
  v_post RECORD;
BEGIN
  SELECT p.user_id, p.author_email
    INTO v_post
    FROM public.hub_posts p
   WHERE p.id = NEW.post_id;

  IF v_post.user_id IS NULL OR v_post.author_email IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_post.user_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (v_post.user_id,
     v_post.author_email,
     'post_reaction',
     COALESCE(NEW.user_name, split_part(COALESCE(NEW.user_email, ''), '@', 1), 'Someone')
       || ' reacted with ' || COALESCE(NEW.item_emoji, '🔥'),
     NULL,
     COALESCE(NEW.item_emoji, '🔥'),
     '/hub',
     jsonb_build_object(
       'actor_id',    NEW.user_id,
       'actor_email', NEW.user_email,
       'actor_name',  NEW.user_name,
       'item_id',     NEW.item_id,
       'item_emoji',  NEW.item_emoji,
       'post_id',     NEW.post_id
     ));

  RETURN NEW;
END;
$x$;

DROP TRIGGER IF EXISTS trg_notify_post_reaction ON public.post_sticker_reactions;
CREATE TRIGGER trg_notify_post_reaction
  AFTER INSERT ON public.post_sticker_reactions
  FOR EACH ROW EXECUTE FUNCTION public._notify_post_reaction();

-- ── Trigger: crew_messages @everyone → fan-out notifications ────────────
-- Skips the sender themselves. Pulls each crew_member's email from
-- user_profiles (denormalized) so we avoid an auth.users lookup per row.

CREATE OR REPLACE FUNCTION public._notify_crew_everyone()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$
DECLARE
  v_sender_name TEXT;
  v_member      RECORD;
  v_preview     TEXT;
BEGIN
  IF NEW.content IS NULL OR NEW.content NOT ILIKE '%@everyone%' THEN
    RETURN NEW;
  END IF;

  SELECT username INTO v_sender_name
    FROM public.user_profiles
   WHERE id = NEW.sender_id
   LIMIT 1;

  v_preview := left(NEW.content, 80);

  FOR v_member IN
    SELECT cm.user_id, up.email
      FROM public.crew_members cm
      JOIN public.user_profiles up ON up.id = cm.user_id
     WHERE cm.crew_id = NEW.crew_id
       AND cm.user_id <> NEW.sender_id
       AND up.email IS NOT NULL
  LOOP
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_member.user_id,
       v_member.email,
       'crew_everyone',
       COALESCE(v_sender_name, 'Someone') || ' called @everyone',
       v_preview,
       '📣',
       '/hub',
       jsonb_build_object(
         'crew_id',    NEW.crew_id,
         'message_id', NEW.id,
         'sender_id',  NEW.sender_id,
         'sender_name', v_sender_name
       ));
  END LOOP;

  RETURN NEW;
END;
$x$;

DROP TRIGGER IF EXISTS trg_notify_crew_everyone ON public.crew_messages;
CREATE TRIGGER trg_notify_crew_everyone
  AFTER INSERT ON public.crew_messages
  FOR EACH ROW EXECUTE FUNCTION public._notify_crew_everyone();

-- ── RPC: mark notifications read ─────────────────────────────────────────
-- Operates on the existing 017 schema (user_id, is_read). No-op on the
-- newly added columns because there are none — 017 already had is_read.

CREATE OR REPLACE FUNCTION public.mark_notifications_read()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.notifications
     SET is_read = TRUE
   WHERE user_id = auth.uid()
     AND is_read = FALSE;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notifications_read() TO authenticated;

-- ── RPC: unread count ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_unread_notification_count()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
    FROM public.notifications
   WHERE user_id = auth.uid()
     AND is_read = FALSE;
$$;

GRANT EXECUTE ON FUNCTION public.my_unread_notification_count() TO authenticated;

NOTIFY pgrst, 'reload schema';
