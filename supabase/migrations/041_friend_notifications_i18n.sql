-- 041_friend_notifications_i18n.sql
--
-- Per-recipient i18n for cross-user "friend_post" + "friend_follow"
-- notifications. Same pattern as migrations 035/037/040.
--
-- BEFORE: src/lib/data/notifications.js → notifyFriendPost /
-- notifyFriendFollow render text using the SENDER's t function. The
-- recipient sees the notification in the sender's language, which is
-- wrong for any non-English-speaking recipient.
--
-- AFTER: leagues.js style — call `notify_friend_*_for` RPCs which
-- read the recipient's preferred_language and render server-side.
-- Each recipient gets the notification in their own language.

-- ── friend_post text helper ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.friend_post_text(
  p_language TEXT,
  p_name     TEXT
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN p_name || ' publicó'
        WHEN 'fr' THEN p_name || ' a publié'
        WHEN 'de' THEN p_name || ' hat gepostet'
        WHEN 'pt' THEN p_name || ' publicou'
        WHEN 'it' THEN p_name || ' ha pubblicato'
        WHEN 'ja' THEN p_name || 'が投稿しました'
        WHEN 'ko' THEN p_name || '님이 게시했어요'
        WHEN 'zh' THEN p_name || ' 发布了'
        WHEN 'ar' THEN 'نشر ' || p_name
        WHEN 'hi' THEN p_name || ' ने पोस्ट किया'
        WHEN 'ru' THEN p_name || ' опубликовал(а)'
        WHEN 'tr' THEN p_name || ' yeni paylaşım yaptı'
        WHEN 'pl' THEN p_name || ' opublikował(a)'
        WHEN 'nl' THEN p_name || ' heeft gepost'
        ELSE              p_name || ' posted'
      END
  );
$$;

REVOKE ALL ON FUNCTION public.friend_post_text(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.friend_post_text(TEXT, TEXT) TO authenticated;

-- ── friend_follow text helper ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.friend_follow_text(
  p_language TEXT,
  p_name     TEXT
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN p_name || ' te sigue'
        WHEN 'fr' THEN p_name || ' vous suit'
        WHEN 'de' THEN p_name || ' folgt dir jetzt'
        WHEN 'pt' THEN p_name || ' te seguiu'
        WHEN 'it' THEN p_name || ' ti segue'
        WHEN 'ja' THEN p_name || 'があなたをフォローしました'
        WHEN 'ko' THEN p_name || '님이 팔로우했어요'
        WHEN 'zh' THEN p_name || ' 关注了你'
        WHEN 'ar' THEN 'بدأ ' || p_name || ' بمتابعتك'
        WHEN 'hi' THEN p_name || ' आपको फ़ॉलो कर रहे हैं'
        WHEN 'ru' THEN p_name || ' подписался(ась) на вас'
        WHEN 'tr' THEN p_name || ' seni takip ediyor'
        WHEN 'pl' THEN p_name || ' obserwuje cię'
        WHEN 'nl' THEN p_name || ' volgt je nu'
        ELSE              p_name || ' followed you'
      END,
    'body',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN 'Toca para ver su perfil.'
        WHEN 'fr' THEN 'Touchez pour voir son profil.'
        WHEN 'de' THEN 'Tippe, um das Profil zu sehen.'
        WHEN 'pt' THEN 'Toque para ver o perfil.'
        WHEN 'it' THEN 'Tocca per vedere il profilo.'
        WHEN 'ja' THEN 'タップしてプロフィールを見る。'
        WHEN 'ko' THEN '탭하여 프로필을 확인하세요.'
        WHEN 'zh' THEN '点击查看其个人资料。'
        WHEN 'ar' THEN 'انقر لرؤية الملف الشخصي.'
        WHEN 'hi' THEN 'प्रोफ़ाइल देखने के लिए टैप करें।'
        WHEN 'ru' THEN 'Нажмите, чтобы посмотреть профиль.'
        WHEN 'tr' THEN 'Profili görüntülemek için dokun.'
        WHEN 'pl' THEN 'Dotknij, aby zobaczyć profil.'
        WHEN 'nl' THEN 'Tik om het profiel te bekijken.'
        ELSE              'Tap to view their profile.'
      END
  );
$$;

REVOKE ALL ON FUNCTION public.friend_follow_text(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.friend_follow_text(TEXT, TEXT) TO authenticated;

-- ── Cross-user RPC: friend_post ─────────────────────────────────────────
--
-- The body of the notification is the post preview — user-supplied
-- text that's never translated. Only the title is templated.

CREATE OR REPLACE FUNCTION public.notify_friend_post_for(
  p_user_id      UUID,
  p_poster_name  TEXT,
  p_post_preview TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender UUID := auth.uid();
  v_email  TEXT;
  v_lang   TEXT;
  v_text   JSONB;
  v_id     UUID;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_poster_name IS NULL THEN
    RAISE EXCEPTION 'user_id and poster_name required' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = v_sender THEN
    RETURN NULL; -- never notify yourself about your own post
  END IF;

  SELECT u.email, prof.preferred_language
    INTO v_email, v_lang
    FROM auth.users u
    LEFT JOIN public.user_profiles prof ON prof.id = u.id
   WHERE u.id = p_user_id;

  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  v_text := public.friend_post_text(COALESCE(v_lang, 'en'), p_poster_name);

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (p_user_id,
     v_email,
     'friend_post',
     v_text ->> 'title',
     COALESCE(SUBSTRING(p_post_preview FROM 1 FOR 100), ''),
     '✨',
     '/hub',
     jsonb_build_object('posterName', p_poster_name))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_friend_post_for(UUID, TEXT, TEXT) TO authenticated;

-- ── Cross-user RPC: friend_follow ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_friend_follow_for(
  p_user_id       UUID,
  p_follower_name TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender UUID := auth.uid();
  v_email  TEXT;
  v_lang   TEXT;
  v_text   JSONB;
  v_id     UUID;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_follower_name IS NULL THEN
    RAISE EXCEPTION 'user_id and follower_name required' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = v_sender THEN
    RETURN NULL; -- can't follow yourself, but defensive
  END IF;

  SELECT u.email, prof.preferred_language
    INTO v_email, v_lang
    FROM auth.users u
    LEFT JOIN public.user_profiles prof ON prof.id = u.id
   WHERE u.id = p_user_id;

  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  v_text := public.friend_follow_text(COALESCE(v_lang, 'en'), p_follower_name);

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (p_user_id,
     v_email,
     'friend_follow',
     v_text ->> 'title',
     v_text ->> 'body',
     '👋',
     '/hub',
     jsonb_build_object('followerName', p_follower_name))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_friend_follow_for(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
