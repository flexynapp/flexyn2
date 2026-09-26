-- 081_nemesis_notifications_i18n.sql
--
-- Server-side i18n + SECURITY DEFINER RPC for the "Meet your nemesis"
-- notification fired when a user gets a new rival assigned.
--
-- BEFORE: src/lib/data/nemesis.js → assignNemesis() inserts a row directly
-- into public.notifications with hardcoded English text. The push pipeline
-- (migrations 033 → 080 + send-push Edge Function) fans it out, so users
-- DO get a push — but only an English one, regardless of the recipient's
-- preferred_language. A Spanish-speaking user opening the Nemesis card
-- gets "🎯 Meet your nemesis: alice" in English.
--
-- AFTER: client calls notify_nemesis_assigned_for(p_nemesis_id) which
-- reads the caller's preferred_language and renders title + body server-
-- side in all 15 supported languages. Self-targeted RPC (the user IS
-- the recipient), so it runs with the caller's auth.uid() and inserts
-- into THEIR notifications row.
--
-- The notification fanout trigger in 034/038/080 picks up the row and
-- delivers a push via the send-push Edge Function automatically. No
-- client-side push dispatch needed — the same notifications table
-- INSERT path that powers in-app notifications powers Web Push.
--
-- Categories: nemesis_assigned is intentionally LEFT UNMAPPED in
-- notification_type_category (036). Unmapped types fall through — they
-- always send, never muted by category prefs. This is the documented
-- pattern from migration 034 ("better to over-deliver an unmapped
-- type than silently drop a new type that wasn't added to the mapping
-- yet"). A future migration can map it to 'competitive' once that
-- category is properly whitelisted in update_notification_pref.

-- ── Text helper ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.nemesis_assigned_text(
  p_language     TEXT,
  p_nemesis_name TEXT
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN '🎯 Tu nuevo némesis: ' || p_nemesis_name
        WHEN 'fr' THEN '🎯 Votre nouveau nemesis : ' || p_nemesis_name
        WHEN 'de' THEN '🎯 Dein neuer Nemesis: ' || p_nemesis_name
        WHEN 'pt' THEN '🎯 Seu novo némesis: ' || p_nemesis_name
        WHEN 'it' THEN '🎯 Il tuo nuovo nemesis: ' || p_nemesis_name
        WHEN 'ja' THEN '🎯 新しい宿敵: ' || p_nemesis_name
        WHEN 'ko' THEN '🎯 새로운 라이벌: ' || p_nemesis_name
        WHEN 'zh' THEN '🎯 你的新宿敌: ' || p_nemesis_name
        WHEN 'ar' THEN '🎯 خصمك الجديد: ' || p_nemesis_name
        WHEN 'hi' THEN '🎯 आपका नया प्रतिद्वंद्वी: ' || p_nemesis_name
        WHEN 'ru' THEN '🎯 Ваш новый соперник: ' || p_nemesis_name
        WHEN 'tr' THEN '🎯 Yeni rakibin: ' || p_nemesis_name
        WHEN 'pl' THEN '🎯 Twój nowy rywal: ' || p_nemesis_name
        WHEN 'nl' THEN '🎯 Je nieuwe nemesis: ' || p_nemesis_name
        ELSE              '🎯 Meet your nemesis: ' || p_nemesis_name
      END,
    'body',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN 'Están un paso por encima. Supera sus estadísticas, reclama su rango.'
        WHEN 'fr' THEN 'Ils sont un cran au-dessus. Battez leurs stats, prenez leur place.'
        WHEN 'de' THEN 'Sie sind eine Stufe über dir. Schlag ihre Stats, hol dir ihren Rang.'
        WHEN 'pt' THEN 'Estão um nível acima. Supere as estatísticas, conquiste o posto.'
        WHEN 'it' THEN 'Sono un passo avanti. Supera le loro statistiche, prendi il loro posto.'
        WHEN 'ja' THEN '彼らは一歩先にいます。ステータスを超えて、その座を奪い取れ。'
        WHEN 'ko' THEN '그들은 한 단계 위에 있어요. 스탯을 이기고 자리를 차지하세요.'
        WHEN 'zh' THEN '他们略高你一筹。击败他们的数据，夺取他们的位置。'
        WHEN 'ar' THEN 'هم مستوى أعلى منك. تجاوز إحصائياتهم، واحتل مكانهم.'
        WHEN 'hi' THEN 'वे आपसे एक कदम आगे हैं। उनके आंकड़े मात दें, उनकी जगह पाएं।'
        WHEN 'ru' THEN 'Они на шаг впереди. Превзойдите их статистику, заберите их место.'
        WHEN 'tr' THEN 'Senden bir adım önde. İstatistiklerini geç, yerini al.'
        WHEN 'pl' THEN 'Są o krok wyżej. Pobij ich statystyki, zajmij ich miejsce.'
        WHEN 'nl' THEN 'Ze staan een stap boven je. Versla hun stats, claim hun rang.'
        ELSE              'They''re a step above you. Beat their stats, claim their rank.'
      END
  );
$$;

REVOKE ALL ON FUNCTION public.nemesis_assigned_text(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nemesis_assigned_text(TEXT, TEXT) TO authenticated;

-- ── Self-targeted RPC ───────────────────────────────────────────────────
--
-- Caller and recipient are the same person (the user who just got a
-- nemesis assigned). RLS allows users to insert their own notification
-- rows, so SECURITY DEFINER isn't strictly required — but using it
-- keeps the pattern uniform with the cross-user notify_* RPCs and
-- guarantees the SET search_path lock-down for security audit.
--
-- The nemesis's username is looked up server-side so the client can
-- pass just the UUID without trusting a client-supplied display name.

CREATE OR REPLACE FUNCTION public.notify_nemesis_assigned_for(
  p_nemesis_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_user_email   TEXT;
  v_user_lang    TEXT;
  v_nemesis_name TEXT;
  v_text         JSONB;
  v_id           UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_nemesis_id IS NULL THEN
    RAISE EXCEPTION 'nemesis_id required' USING ERRCODE = '22023';
  END IF;
  IF p_nemesis_id = v_user_id THEN
    RAISE EXCEPTION 'cannot be your own nemesis' USING ERRCODE = '22023';
  END IF;

  -- Look up the recipient's email + language (single row read).
  SELECT u.email, prof.preferred_language
    INTO v_user_email, v_user_lang
    FROM auth.users u
    LEFT JOIN public.user_profiles prof ON prof.id = u.id
   WHERE u.id = v_user_id;

  IF v_user_email IS NULL THEN
    -- Auth row gone (account deletion mid-flight). Bail without erroring.
    RETURN NULL;
  END IF;

  -- Look up the nemesis's display name. We accept a NULL username and
  -- fall back to a generic phrase in the text helper — better than
  -- leaking "uid 3f8b…" or rendering a literal "null" in the message.
  SELECT prof.username
    INTO v_nemesis_name
    FROM public.user_profiles prof
   WHERE prof.id = p_nemesis_id;

  v_text := public.nemesis_assigned_text(
    COALESCE(v_user_lang, 'en'),
    COALESCE(v_nemesis_name, 'a rival')
  );

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (v_user_id,
     v_user_email,
     'nemesis_assigned',
     v_text ->> 'title',
     v_text ->> 'body',
     '🎯',
     '/dashboard',
     jsonb_build_object(
       'nemesis_id',   p_nemesis_id,
       'nemesis_name', v_nemesis_name
     ))
  RETURNING id INTO v_id;

  -- The INSERT above fires trg_notifications_push_fanout (migration 034 +
  -- 080), which queues a Web Push via net.http_post. The push lands on
  -- the user's subscribed device within seconds. Nothing else to do here.

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_nemesis_assigned_for(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
