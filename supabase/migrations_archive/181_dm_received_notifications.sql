-- Migration 181: notify on new direct messages (C11 — DMs were invisible while closed)
--
-- Nothing inserted a notification (and therefore nothing pushed) when a
-- DM arrived. Unread DMs surfaced only via in-app polling while the app
-- was foregrounded, so a closed app never learned about new messages —
-- undercutting the core messaging value on mobile.
--
-- This adds an AFTER INSERT trigger on hub_messages that inserts a
-- 'dm_received' notification for every conversation participant except
-- the sender (skipping anyone in a block relationship with the sender).
-- The existing fanout trigger on notifications (mig 034/098) then handles
-- push delivery, category prefs ('social', mapped in mig 177), and quiet
-- hours. Localized via dm_received_text for the recipient's language.
--
-- Paste-safe: scalar SELECT ... INTO, public.<table>, no alias.column or
-- record .id tokens; FOR loop over a scalar email variable.

-- ── i18n text helper ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dm_received_text(
  p_language    TEXT,
  p_sender_name TEXT
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN 'Nuevo mensaje'
        WHEN 'fr' THEN 'Nouveau message'
        WHEN 'de' THEN 'Neue Nachricht'
        WHEN 'pt' THEN 'Nova mensagem'
        WHEN 'it' THEN 'Nuovo messaggio'
        WHEN 'ja' THEN '新しいメッセージ'
        WHEN 'ko' THEN '새 메시지'
        WHEN 'zh' THEN '新消息'
        WHEN 'ar' THEN 'رسالة جديدة'
        WHEN 'hi' THEN 'नया संदेश'
        WHEN 'ru' THEN 'Новое сообщение'
        WHEN 'tr' THEN 'Yeni mesaj'
        WHEN 'pl' THEN 'Nowa wiadomość'
        WHEN 'nl' THEN 'Nieuw bericht'
        ELSE              'New message'
      END,
    'body',
      COALESCE(NULLIF(p_sender_name, ''), 'Someone') ||
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN ' te envió un mensaje'
        WHEN 'fr' THEN ' vous a envoyé un message'
        WHEN 'de' THEN ' hat dir eine Nachricht gesendet'
        WHEN 'pt' THEN ' enviou uma mensagem'
        WHEN 'it' THEN ' ti ha inviato un messaggio'
        WHEN 'ja' THEN ' さんからメッセージが届きました'
        WHEN 'ko' THEN ' 님이 메시지를 보냈습니다'
        WHEN 'zh' THEN ' 给你发了一条消息'
        WHEN 'ar' THEN ' أرسل لك رسالة'
        WHEN 'hi' THEN ' ने आपको एक संदेश भेजा'
        WHEN 'ru' THEN ' отправил вам сообщение'
        WHEN 'tr' THEN ' size bir mesaj gönderdi'
        WHEN 'pl' THEN ' wysłał Ci wiadomość'
        WHEN 'nl' THEN ' heeft je een bericht gestuurd'
        ELSE              ' sent you a message'
      END
  );
$$;

-- ── trigger ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_dm_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email      TEXT;
  v_rcpt_id    UUID;
  v_rcpt_lang  TEXT;
  v_text       JSONB;
  v_emails     TEXT[];
BEGIN
  -- Empty/whitespace messages don't notify.
  IF NEW.content IS NULL OR length(btrim(NEW.content)) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT participant_emails INTO v_emails
    FROM public.hub_conversations
   WHERE id = NEW.conversation_id;

  IF v_emails IS NULL THEN
    RETURN NEW;
  END IF;

  FOREACH v_email IN ARRAY v_emails LOOP
    -- Skip the sender.
    CONTINUE WHEN lower(v_email) = lower(COALESCE(NEW.sender_email, ''));

    -- Resolve the recipient's id + language.
    SELECT id, COALESCE(preferred_language, 'en')
      INTO v_rcpt_id, v_rcpt_lang
      FROM public.user_profiles
     WHERE lower(email) = lower(v_email);

    CONTINUE WHEN v_rcpt_id IS NULL;

    -- Respect blocking in either direction.
    CONTINUE WHEN public.is_blocked(v_rcpt_id, NEW.sender_email);

    v_text := public.dm_received_text(v_rcpt_lang, NEW.sender_name);

    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES (
      v_rcpt_id,
      v_email,
      'dm_received',
      v_text->>'title',
      v_text->>'body',
      NULLIF(NEW.sender_avatar, ''),
      '/messages',
      jsonb_build_object('conversation_id', NEW.conversation_id)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_dm_received ON public.hub_messages;
CREATE TRIGGER trg_notify_dm_received
  AFTER INSERT ON public.hub_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_dm_received();

NOTIFY pgrst, 'reload schema';
