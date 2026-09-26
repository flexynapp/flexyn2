-- 086_comment_reply_notifications_i18n.sql
--
-- Wires hub comments + replies into the notification/push pipeline.
-- Closes the last social-loop gap: replying to someone's comment (or
-- commenting on their post) currently produces no notification, so a
-- user has to manually open the Hub tab to discover engagement on their
-- content. With push notifications now live, this is the single highest-
-- value retention wire-up remaining.
--
-- TWO EVENT CASES, ONE RPC
-- ────────────────────────
-- A single notify_comment_reply_for(p_comment_id) RPC handles both:
--
--   1. Top-level comment (parent_comment_id IS NULL)
--      → notify the POST AUTHOR
--      → title: "alice commented on your post"
--
--   2. Reply to a comment (parent_comment_id IS NOT NULL)
--      → notify the PARENT COMMENT AUTHOR
--      → title: "alice replied to your comment"
--
-- The recipient is computed server-side so the client can't lie about
-- who's getting notified. Validates the caller authored the comment
-- (auth.uid() = hub_comments.user_id) so a hostile client can't fan out
-- notifications for someone else's comment.
--
-- The notification.type is 'comment_reply' in both cases — migration
-- 083 already maps that type to the 'social' category, so users who
-- muted 'social' in Settings get neither the in-app row nor the push.
-- Two separate types (comment_on_post + comment_reply) would have
-- needed two separate category mappings; consolidating keeps the
-- mental model and the toggles clean.
--
-- BODY SNIPPET POLICY
-- ───────────────────
-- We include the first 80 chars of the comment in the push body so the
-- recipient sees WHAT the comment said, not just "alice replied". This
-- matters because:
--   • Users on lockscreens decide whether to engage from the preview.
--   • The full body is one tap away in the in-app notifications panel.
-- 80 chars is the iOS push body limit before truncation; Android shows
-- more but cuts off too. Anything longer wastes screen real estate.

-- ── i18n: comment_reply_text ────────────────────────────────────────────
--
-- p_is_reply distinguishes the two cases for the title. Body is the
-- same snippet in either case.

CREATE OR REPLACE FUNCTION public.comment_reply_text(
  p_language    TEXT,
  p_commenter   TEXT,
  p_snippet     TEXT,
  p_is_reply    BOOLEAN
) RETURNS JSONB
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE
        WHEN p_is_reply THEN
          CASE COALESCE(p_language, 'en')
            WHEN 'es' THEN p_commenter || ' respondió a tu comentario'
            WHEN 'fr' THEN p_commenter || ' a répondu à votre commentaire'
            WHEN 'de' THEN p_commenter || ' hat auf deinen Kommentar geantwortet'
            WHEN 'pt' THEN p_commenter || ' respondeu ao seu comentário'
            WHEN 'it' THEN p_commenter || ' ha risposto al tuo commento'
            WHEN 'ja' THEN p_commenter || 'があなたのコメントに返信しました'
            WHEN 'ko' THEN p_commenter || '님이 당신의 댓글에 답글을 달았어요'
            WHEN 'zh' THEN p_commenter || ' 回复了你的评论'
            WHEN 'ar' THEN p_commenter || ' ردّ على تعليقك'
            WHEN 'hi' THEN p_commenter || ' ने आपकी टिप्पणी का जवाब दिया'
            WHEN 'ru' THEN p_commenter || ' ответил(а) на ваш комментарий'
            WHEN 'tr' THEN p_commenter || ' yorumuna yanıt verdi'
            WHEN 'pl' THEN p_commenter || ' odpowiedział(a) na twój komentarz'
            WHEN 'nl' THEN p_commenter || ' heeft op je reactie geantwoord'
            ELSE              p_commenter || ' replied to your comment'
          END
        ELSE
          CASE COALESCE(p_language, 'en')
            WHEN 'es' THEN p_commenter || ' comentó en tu publicación'
            WHEN 'fr' THEN p_commenter || ' a commenté votre publication'
            WHEN 'de' THEN p_commenter || ' hat deinen Beitrag kommentiert'
            WHEN 'pt' THEN p_commenter || ' comentou na sua publicação'
            WHEN 'it' THEN p_commenter || ' ha commentato il tuo post'
            WHEN 'ja' THEN p_commenter || 'があなたの投稿にコメントしました'
            WHEN 'ko' THEN p_commenter || '님이 당신의 게시물에 댓글을 달았어요'
            WHEN 'zh' THEN p_commenter || ' 评论了你的帖子'
            WHEN 'ar' THEN p_commenter || ' علّق على منشورك'
            WHEN 'hi' THEN p_commenter || ' ने आपकी पोस्ट पर टिप्पणी की'
            WHEN 'ru' THEN p_commenter || ' прокомментировал(а) вашу публикацию'
            WHEN 'tr' THEN p_commenter || ' gönderine yorum yaptı'
            WHEN 'pl' THEN p_commenter || ' skomentował(a) twój post'
            WHEN 'nl' THEN p_commenter || ' heeft je bericht becommentarieerd'
            ELSE              p_commenter || ' commented on your post'
          END
      END,
    'body', COALESCE(p_snippet, '')
  );
$$;

REVOKE ALL  ON FUNCTION public.comment_reply_text(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comment_reply_text(TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ── notify_comment_reply_for ────────────────────────────────────────────
--
-- Called by the client immediately after hub_comments.create() succeeds.
-- The RPC determines whether it's a top-level comment or a reply, looks
-- up the appropriate recipient (post author vs parent comment author),
-- renders the title in the recipient's preferred language, and inserts
-- one notifications row. The 034 trigger fans out a Web Push if the
-- recipient is subscribed and hasn't muted 'social' in their prefs.
--
-- Validates:
--   • caller is authenticated
--   • caller is the comment's author (auth.uid() = hub_comments.user_id)
--   • the comment exists
--   • recipient ≠ caller (no self-notifications when commenting on your
--     own post or replying to your own comment)

CREATE OR REPLACE FUNCTION public.notify_comment_reply_for(p_comment_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       UUID := auth.uid();
  v_comment      RECORD;
  v_parent       RECORD;
  v_post         RECORD;
  v_recipient_id UUID;
  v_recipient_email TEXT;
  v_recipient_lang  TEXT;
  v_commenter_name  TEXT;
  v_snippet      TEXT;
  v_is_reply     BOOLEAN;
  v_text         JSONB;
  v_id           UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_comment_id IS NULL THEN
    RAISE EXCEPTION 'comment_id required' USING ERRCODE = '22023';
  END IF;

  -- Pull the comment. Subscription to hub_comments columns covers
  -- author identity + the body we'll snippet from.
  SELECT id, user_id, post_id, parent_comment_id, content, body,
         author_name, author_email
    INTO v_comment
    FROM public.hub_comments
   WHERE id = p_comment_id;

  IF v_comment.id IS NULL THEN
    -- Comment row doesn't exist (race against deletion). Bail.
    RETURN NULL;
  END IF;
  IF v_comment.user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'not your comment' USING ERRCODE = '42501';
  END IF;

  v_is_reply := v_comment.parent_comment_id IS NOT NULL;

  -- Resolve recipient.
  IF v_is_reply THEN
    -- Reply → parent comment author.
    SELECT user_id INTO v_parent
      FROM public.hub_comments
     WHERE id = v_comment.parent_comment_id;
    v_recipient_id := v_parent.user_id;
  ELSE
    -- Top-level comment → post author.
    SELECT user_id, author_email INTO v_post
      FROM public.hub_posts
     WHERE id = v_comment.post_id;
    v_recipient_id := v_post.user_id;
  END IF;

  IF v_recipient_id IS NULL THEN
    -- Parent / post author missing (deleted? RLS-hidden?). Nothing to do.
    RETURN NULL;
  END IF;
  IF v_recipient_id = v_caller THEN
    -- Commenting on your own post or replying to your own comment.
    -- Skip silently — self-notifications would be noise.
    RETURN NULL;
  END IF;

  -- Recipient email + language.
  SELECT u.email, prof.preferred_language
    INTO v_recipient_email, v_recipient_lang
    FROM auth.users u
    LEFT JOIN public.user_profiles prof ON prof.id = u.id
   WHERE u.id = v_recipient_id;
  IF v_recipient_email IS NULL THEN
    -- Auth row gone (account deletion mid-flight).
    RETURN NULL;
  END IF;

  -- Commenter display name. Fall back to email local-part so the title
  -- never reads "null commented on your post".
  SELECT username INTO v_commenter_name
    FROM public.user_profiles
   WHERE id = v_caller;
  v_commenter_name := COALESCE(
    v_commenter_name,
    split_part(COALESCE(v_comment.author_email, ''), '@', 1),
    'Someone'
  );

  -- Snippet: first 80 chars of the comment body. Use COALESCE because
  -- the legacy `content` column may hold the value if `body` is null
  -- (migration 004 introduced body but didn't backfill).
  v_snippet := substring(
    COALESCE(v_comment.body, v_comment.content, '') FROM 1 FOR 80
  );
  -- Add ellipsis if truncated.
  IF length(COALESCE(v_comment.body, v_comment.content, '')) > 80 THEN
    v_snippet := v_snippet || '…';
  END IF;

  v_text := public.comment_reply_text(
    COALESCE(v_recipient_lang, 'en'),
    v_commenter_name,
    v_snippet,
    v_is_reply
  );

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (v_recipient_id,
     v_recipient_email,
     'comment_reply',
     v_text ->> 'title',
     v_text ->> 'body',
     '💬',
     '/hub',
     jsonb_build_object(
       'comment_id',       p_comment_id,
       'post_id',          v_comment.post_id,
       'parent_comment_id', v_comment.parent_comment_id,
       'commenter_id',     v_caller,
       'commenter_name',   v_commenter_name,
       'is_reply',         v_is_reply
     ))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_comment_reply_for(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
