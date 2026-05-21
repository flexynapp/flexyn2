-- 063_notifications.sql
-- In-app notifications table + triggers for:
--   • Post likes (hub_post_likes → notify post author)
--   • Sticker reactions on posts (hub_post_reactions → notify post author)
--   • @everyone broadcasts in crew_messages (app-level, trigger records the notification)
-- Each notification row is read-once from the client via RLS (only the recipient can see it).

-- ── Table ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL,          -- 'post_like' | 'post_reaction' | 'crew_everyone'
  actor_email  TEXT,                          -- who triggered it
  actor_name   TEXT,                          -- display name of actor
  payload      JSONB       NOT NULL DEFAULT '{}',
  is_read      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id, is_read, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_own" ON public.notifications;
CREATE POLICY "notifications_own" ON public.notifications
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Trigger helper: resolve user_id from email ───────────────────────────────
-- Used by notification triggers that have an email but need a user_id.
CREATE OR REPLACE FUNCTION public._email_to_user_id(p_email TEXT)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

-- ── Trigger: post like → notification ────────────────────────────────────────
-- hub_post_likes table assumed to have: post_id, liker_email columns.
-- hub_posts assumed to have: id, user_email, author_name columns.
-- The trigger skips self-likes and only inserts if the author has a user_id.

CREATE OR REPLACE FUNCTION public._notify_post_like()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$
DECLARE
  v_post         RECORD;
  v_author_id    UUID;
  v_liker_name   TEXT;
BEGIN
  -- Fetch post details
  SELECT p.user_email, p.author_name
  INTO v_post
  FROM public.hub_posts p
  WHERE p.id = NEW.post_id;

  -- Skip self-likes and posts without an identified author
  IF v_post.user_email IS NULL THEN RETURN NEW; END IF;
  IF lower(v_post.user_email) = lower(NEW.liker_email) THEN RETURN NEW; END IF;

  v_author_id := public._email_to_user_id(v_post.user_email);
  IF v_author_id IS NULL THEN RETURN NEW; END IF;

  -- Actor display name from profiles
  SELECT username INTO v_liker_name FROM public.profiles
  WHERE email = NEW.liker_email LIMIT 1;

  INSERT INTO public.notifications (user_id, type, actor_email, actor_name, payload)
  VALUES (
    v_author_id,
    'post_like',
    NEW.liker_email,
    COALESCE(v_liker_name, split_part(NEW.liker_email, '@', 1)),
    jsonb_build_object('post_id', NEW.post_id)
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$x$;

DROP TRIGGER IF EXISTS trg_notify_post_like ON public.hub_post_likes;
CREATE TRIGGER trg_notify_post_like
  AFTER INSERT ON public.hub_post_likes
  FOR EACH ROW EXECUTE FUNCTION public._notify_post_like();

-- ── Trigger: post sticker reaction → notification ─────────────────────────────
-- hub_post_reactions assumed to have: post_id, reactor_email, sticker_emoji columns.

CREATE OR REPLACE FUNCTION public._notify_post_reaction()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$
DECLARE
  v_post         RECORD;
  v_author_id    UUID;
  v_reactor_name TEXT;
BEGIN
  SELECT p.user_email, p.author_name
  INTO v_post
  FROM public.hub_posts p
  WHERE p.id = NEW.post_id;

  IF v_post.user_email IS NULL THEN RETURN NEW; END IF;
  IF lower(v_post.user_email) = lower(NEW.reactor_email) THEN RETURN NEW; END IF;

  v_author_id := public._email_to_user_id(v_post.user_email);
  IF v_author_id IS NULL THEN RETURN NEW; END IF;

  SELECT username INTO v_reactor_name FROM public.profiles
  WHERE email = NEW.reactor_email LIMIT 1;

  INSERT INTO public.notifications (user_id, type, actor_email, actor_name, payload)
  VALUES (
    v_author_id,
    'post_reaction',
    NEW.reactor_email,
    COALESCE(v_reactor_name, split_part(NEW.reactor_email, '@', 1)),
    jsonb_build_object(
      'post_id',      NEW.post_id,
      'sticker_emoji', COALESCE(NEW.sticker_emoji, NEW.emoji, '🔥')
    )
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$x$;

DROP TRIGGER IF EXISTS trg_notify_post_reaction ON public.hub_post_reactions;
CREATE TRIGGER trg_notify_post_reaction
  AFTER INSERT ON public.hub_post_reactions
  FOR EACH ROW EXECUTE FUNCTION public._notify_post_reaction();

-- ── Trigger: @everyone in crew message → fan-out notifications ───────────────
-- Fires when a new crew_message body contains '@everyone'.
-- Inserts one notification row per crew member (except the sender).

CREATE OR REPLACE FUNCTION public._notify_crew_everyone()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$
DECLARE
  v_sender_name  TEXT;
  v_member       RECORD;
BEGIN
  -- Only fan-out if the message literally contains @everyone
  IF NOT (NEW.content ILIKE '%@everyone%') THEN RETURN NEW; END IF;

  SELECT username INTO v_sender_name FROM public.profiles
  WHERE id = NEW.user_id LIMIT 1;

  FOR v_member IN
    SELECT user_id FROM public.crew_members
    WHERE crew_id = NEW.crew_id
      AND user_id <> NEW.user_id
  LOOP
    INSERT INTO public.notifications (user_id, type, actor_name, payload)
    VALUES (
      v_member.user_id,
      'crew_everyone',
      COALESCE(v_sender_name, 'Someone'),
      jsonb_build_object(
        'crew_id',    NEW.crew_id,
        'message_id', NEW.id,
        'preview',    left(NEW.content, 80)
      )
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$x$;

DROP TRIGGER IF EXISTS trg_notify_crew_everyone ON public.crew_messages;
CREATE TRIGGER trg_notify_crew_everyone
  AFTER INSERT ON public.crew_messages
  FOR EACH ROW EXECUTE FUNCTION public._notify_crew_everyone();

-- ── RPC: mark notifications read ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_notifications_read()
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notifications
  SET is_read = TRUE
  WHERE user_id = auth.uid() AND is_read = FALSE;
$$;

-- ── RPC: get unread notification count ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_unread_notification_count()
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::INT FROM public.notifications
  WHERE user_id = auth.uid() AND is_read = FALSE;
$$;
