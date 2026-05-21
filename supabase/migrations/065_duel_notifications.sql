-- 065_duel_notifications.sql
--
-- Wires Duels into the existing notifications + push pipeline. Follows
-- the cross-user RPC pattern from 041_friend_notifications_i18n.sql:
--
--   • duel_invite_text(lang, name, type)        — server-side i18n
--   • duel_result_text(lang, name, outcome)     — server-side i18n
--   • notify_duel_invite_for(opponent, duel, type)
--   • notify_duel_result_for(recipient, duel, outcome)
--
-- Each RPC inserts into public.notifications (created by 017). The
-- AFTER INSERT trigger from 034 fans out a Web Push delivery via the
-- send-push Edge Function, gated by the recipient's notification_prefs
-- (036) — users who muted 'duels' get neither the push nor the in-app
-- row.
--
-- Both RPCs validate that the caller is a participant in the duel
-- before inserting, so a hostile client can't spam fake duel
-- notifications into arbitrary inboxes by guessing duel IDs.

-- ── notification_type_category mapping (extends 036) ────────────────────
-- Duels belong to the 'duels' category so the per-category opt-out
-- toggle in Settings works. The function from 036 already handles
-- 'friend_follow' / 'streak' / etc.; we append three new cases via
-- CREATE OR REPLACE so the dispatch trigger (034) sees the mapping.

CREATE OR REPLACE FUNCTION public.notification_type_category(p_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'streak_break_warning' THEN 'streaks'
    WHEN 'welcome_back'         THEN 'engagement'
    WHEN 'quest_expiry_warning' THEN 'quests'
    WHEN 'friend_follow'        THEN 'social'
    WHEN 'friend_post'          THEN 'social'
    WHEN 'league_promotion'     THEN 'leagues'
    WHEN 'league_demotion'      THEN 'leagues'
    WHEN 'post_like'            THEN 'social'
    WHEN 'post_reaction'        THEN 'social'
    WHEN 'crew_everyone'        THEN 'social'
    WHEN 'duel_invite'          THEN 'duels'
    WHEN 'duel_result'          THEN 'duels'
    ELSE NULL
  END;
$$;

-- ── duel_invite text helper (15 languages) ──────────────────────────────

CREATE OR REPLACE FUNCTION public.duel_invite_text(
  p_language    TEXT,
  p_challenger  TEXT,
  p_duel_type   TEXT  -- 'open' | 'mirror' | 'exercise'
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN p_challenger || ' te ha desafiado a un duelo'
        WHEN 'fr' THEN p_challenger || ' vous défie en duel'
        WHEN 'de' THEN p_challenger || ' fordert dich zum Duell'
        WHEN 'pt' THEN p_challenger || ' te desafiou para um duelo'
        WHEN 'it' THEN p_challenger || ' ti ha sfidato a duello'
        WHEN 'ja' THEN p_challenger || 'からの決闘の挑戦'
        WHEN 'ko' THEN p_challenger || '님이 결투를 신청했어요'
        WHEN 'zh' THEN p_challenger || ' 向你发起了对决'
        WHEN 'ar' THEN p_challenger || ' تحدّاك في مبارزة'
        WHEN 'hi' THEN p_challenger || ' ने आपको द्वंद्व के लिए ललकारा है'
        WHEN 'ru' THEN p_challenger || ' вызвал(а) вас на дуэль'
        WHEN 'tr' THEN p_challenger || ' seni düelloya çağırdı'
        WHEN 'pl' THEN p_challenger || ' wyzwał(a) cię na pojedynek'
        WHEN 'nl' THEN p_challenger || ' daagt je uit voor een duel'
        ELSE              p_challenger || ' challenged you to a duel'
      END,
    'body',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN 'Toca para aceptar o rechazar.'
        WHEN 'fr' THEN 'Touchez pour accepter ou refuser.'
        WHEN 'de' THEN 'Tippe, um anzunehmen oder abzulehnen.'
        WHEN 'pt' THEN 'Toque para aceitar ou recusar.'
        WHEN 'it' THEN 'Tocca per accettare o rifiutare.'
        WHEN 'ja' THEN 'タップして受諾または辞退。'
        WHEN 'ko' THEN '탭하여 수락 또는 거절하세요.'
        WHEN 'zh' THEN '点击接受或拒绝。'
        WHEN 'ar' THEN 'انقر للقبول أو الرفض.'
        WHEN 'hi' THEN 'स्वीकार या अस्वीकार करने के लिए टैप करें।'
        WHEN 'ru' THEN 'Нажмите, чтобы принять или отклонить.'
        WHEN 'tr' THEN 'Kabul veya reddetmek için dokun.'
        WHEN 'pl' THEN 'Dotknij, aby zaakceptować lub odrzucić.'
        WHEN 'nl' THEN 'Tik om te accepteren of weigeren.'
        ELSE              'Tap to accept or decline.'
      END
  );
$$;

REVOKE ALL  ON FUNCTION public.duel_invite_text(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.duel_invite_text(TEXT, TEXT, TEXT) TO authenticated;

-- ── duel_result text helper (15 languages × win/lose/tie) ───────────────

CREATE OR REPLACE FUNCTION public.duel_result_text(
  p_language  TEXT,
  p_opponent  TEXT,
  p_outcome   TEXT  -- 'won' | 'lost' | 'tied'  (from recipient's POV)
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE
        WHEN p_outcome = 'won' THEN
          CASE COALESCE(p_language, 'en')
            WHEN 'es' THEN '¡Venciste a ' || p_opponent || '!'
            WHEN 'fr' THEN 'Vous avez battu ' || p_opponent || ' !'
            WHEN 'de' THEN 'Du hast ' || p_opponent || ' besiegt!'
            WHEN 'pt' THEN 'Você venceu ' || p_opponent || '!'
            WHEN 'it' THEN 'Hai battuto ' || p_opponent || '!'
            WHEN 'ja' THEN p_opponent || 'に勝利！'
            WHEN 'ko' THEN p_opponent || '님을 이겼어요!'
            WHEN 'zh' THEN '你击败了 ' || p_opponent || '！'
            WHEN 'ar' THEN 'هزمت ' || p_opponent || '!'
            WHEN 'hi' THEN 'आपने ' || p_opponent || ' को हरा दिया!'
            WHEN 'ru' THEN 'Вы победили ' || p_opponent || '!'
            WHEN 'tr' THEN p_opponent || ' rakibini yendin!'
            WHEN 'pl' THEN 'Pokonałeś(aś) ' || p_opponent || '!'
            WHEN 'nl' THEN 'Je hebt ' || p_opponent || ' verslagen!'
            ELSE              'You beat ' || p_opponent || '!'
          END
        WHEN p_outcome = 'lost' THEN
          CASE COALESCE(p_language, 'en')
            WHEN 'es' THEN p_opponent || ' te ganó'
            WHEN 'fr' THEN p_opponent || ' vous a battu'
            WHEN 'de' THEN p_opponent || ' hat dich besiegt'
            WHEN 'pt' THEN p_opponent || ' te venceu'
            WHEN 'it' THEN p_opponent || ' ti ha battuto'
            WHEN 'ja' THEN p_opponent || 'に敗北'
            WHEN 'ko' THEN p_opponent || '님에게 졌어요'
            WHEN 'zh' THEN p_opponent || ' 击败了你'
            WHEN 'ar' THEN 'هزمك ' || p_opponent
            WHEN 'hi' THEN p_opponent || ' ने आपको हरा दिया'
            WHEN 'ru' THEN p_opponent || ' победил(а) вас'
            WHEN 'tr' THEN p_opponent || ' seni yendi'
            WHEN 'pl' THEN p_opponent || ' pokonał(a) cię'
            WHEN 'nl' THEN p_opponent || ' heeft je verslagen'
            ELSE              p_opponent || ' beat you'
          END
        ELSE  -- tied
          CASE COALESCE(p_language, 'en')
            WHEN 'es' THEN 'Empate con ' || p_opponent
            WHEN 'fr' THEN 'Égalité avec ' || p_opponent
            WHEN 'de' THEN 'Unentschieden gegen ' || p_opponent
            WHEN 'pt' THEN 'Empate com ' || p_opponent
            WHEN 'it' THEN 'Pareggio con ' || p_opponent
            WHEN 'ja' THEN p_opponent || 'と引き分け'
            WHEN 'ko' THEN p_opponent || '님과 무승부'
            WHEN 'zh' THEN '与 ' || p_opponent || ' 战平'
            WHEN 'ar' THEN 'تعادل مع ' || p_opponent
            WHEN 'hi' THEN p_opponent || ' से बराबरी'
            WHEN 'ru' THEN 'Ничья с ' || p_opponent
            WHEN 'tr' THEN p_opponent || ' ile berabere'
            WHEN 'pl' THEN 'Remis z ' || p_opponent
            WHEN 'nl' THEN 'Gelijkspel met ' || p_opponent
            ELSE              'Tied with ' || p_opponent
          END
      END
  );
$$;

REVOKE ALL  ON FUNCTION public.duel_result_text(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.duel_result_text(TEXT, TEXT, TEXT) TO authenticated;

-- ── Cross-user RPC: duel_invite ─────────────────────────────────────────
-- Called by the challenger immediately after createDuel succeeds. Renders
-- the title in the opponent's preferred language and writes one row to
-- public.notifications. Validates the caller is the duel's challenger so
-- a hostile client can't fan out fake invites by guessing duel IDs.

CREATE OR REPLACE FUNCTION public.notify_duel_invite_for(
  p_opponent_id UUID,
  p_duel_id     UUID,
  p_duel_type   TEXT DEFAULT 'open'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender     UUID := auth.uid();
  v_email      TEXT;
  v_lang       TEXT;
  v_text       JSONB;
  v_id         UUID;
  v_challenger TEXT;
  v_is_real    BOOLEAN;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_opponent_id IS NULL OR p_duel_id IS NULL THEN
    RAISE EXCEPTION 'opponent_id and duel_id required' USING ERRCODE = '22023';
  END IF;
  IF p_opponent_id = v_sender THEN
    RETURN NULL; -- never notify yourself
  END IF;

  -- Caller MUST be the actual challenger on the duel row.
  SELECT TRUE INTO v_is_real
    FROM public.duels
   WHERE id = p_duel_id
     AND challenger_id = v_sender
     AND opponent_id   = p_opponent_id
   LIMIT 1;
  IF v_is_real IS NOT TRUE THEN
    RAISE EXCEPTION 'not your duel' USING ERRCODE = '42501';
  END IF;

  -- Recipient: email + language.
  SELECT u.email, prof.preferred_language
    INTO v_email, v_lang
    FROM auth.users u
    LEFT JOIN public.user_profiles prof ON prof.id = u.id
   WHERE u.id = p_opponent_id;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  -- Challenger display name (the caller's username).
  SELECT username INTO v_challenger
    FROM public.user_profiles
   WHERE id = v_sender;

  v_text := public.duel_invite_text(
    COALESCE(v_lang, 'en'),
    COALESCE(v_challenger, 'Someone'),
    COALESCE(p_duel_type, 'open')
  );

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (p_opponent_id,
     v_email,
     'duel_invite',
     v_text ->> 'title',
     v_text ->> 'body',
     '⚔️',
     '/duels',
     jsonb_build_object(
       'duel_id',         p_duel_id,
       'duel_type',       COALESCE(p_duel_type, 'open'),
       'challenger_id',   v_sender,
       'challenger_name', v_challenger
     ))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_duel_invite_for(UUID, UUID, TEXT) TO authenticated;

-- ── Cross-user RPC: duel_result ─────────────────────────────────────────
-- Called by either participant once submitDuelResult completes the duel.
-- Notifies the RECIPIENT (the other party) with the result from THEIR
-- perspective: won / lost / tied. Validates caller is the OTHER participant
-- so a stranger can't fabricate result notifications.

CREATE OR REPLACE FUNCTION public.notify_duel_result_for(
  p_recipient_id UUID,
  p_duel_id      UUID,
  p_outcome      TEXT  -- recipient's outcome: 'won' | 'lost' | 'tied'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender    UUID := auth.uid();
  v_email     TEXT;
  v_lang      TEXT;
  v_text      JSONB;
  v_id        UUID;
  v_opponent  TEXT;
  v_is_real   BOOLEAN;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_id IS NULL OR p_duel_id IS NULL THEN
    RAISE EXCEPTION 'recipient_id and duel_id required' USING ERRCODE = '22023';
  END IF;
  IF p_outcome NOT IN ('won', 'lost', 'tied') THEN
    RAISE EXCEPTION 'invalid outcome' USING ERRCODE = '22023';
  END IF;
  IF p_recipient_id = v_sender THEN
    RETURN NULL;
  END IF;

  -- Caller and recipient must be the two participants on this duel.
  SELECT TRUE INTO v_is_real
    FROM public.duels
   WHERE id = p_duel_id
     AND status = 'completed'
     AND ((challenger_id = v_sender AND opponent_id = p_recipient_id)
       OR (opponent_id   = v_sender AND challenger_id = p_recipient_id))
   LIMIT 1;
  IF v_is_real IS NOT TRUE THEN
    RAISE EXCEPTION 'not your duel' USING ERRCODE = '42501';
  END IF;

  -- Recipient: email + language.
  SELECT u.email, prof.preferred_language
    INTO v_email, v_lang
    FROM auth.users u
    LEFT JOIN public.user_profiles prof ON prof.id = u.id
   WHERE u.id = p_recipient_id;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  -- Opponent display name from the recipient's perspective = the caller.
  SELECT username INTO v_opponent
    FROM public.user_profiles
   WHERE id = v_sender;

  v_text := public.duel_result_text(
    COALESCE(v_lang, 'en'),
    COALESCE(v_opponent, 'Someone'),
    p_outcome
  );

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (p_recipient_id,
     v_email,
     'duel_result',
     v_text ->> 'title',
     NULL,
     CASE p_outcome WHEN 'won' THEN '🏆' WHEN 'lost' THEN '💪' ELSE '🤝' END,
     '/duels',
     jsonb_build_object(
       'duel_id',  p_duel_id,
       'outcome',  p_outcome,
       'opponent_id',   v_sender,
       'opponent_name', v_opponent
     ))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_duel_result_for(UUID, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
