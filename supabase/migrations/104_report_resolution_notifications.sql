-- 104_report_resolution_notifications.sql
--
-- Close the loop with the user who filed a report. Today: they tap
-- Report, the dialog says "Thanks", and silence forever — no signal
-- whether the report was read, acted on, or dismissed. This adds:
--
--   • 15-language text helper for the three resolution outcomes
--   • AFTER UPDATE OF status trigger on hub_reports that inserts a
--     notifications row when status moves out of 'pending'
--
-- The existing migration 034 trigger on `notifications` then handles
-- push fanout for free — same pipeline that streak breaks, friend
-- follows, and league results use. No new push infrastructure needed.
--
-- Idempotent: CREATE OR REPLACE on functions; DROP TRIGGER IF EXISTS
-- before CREATE TRIGGER.

-- ─────────────────────────────────────────────────────────────────────
-- 1. 15-language text helper. Mirrors streak_break_text(p_language, …)
--    from migration 035. Returns { title, body } JSONB so the trigger
--    can pluck both fields without parsing.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_resolution_text(
  p_language TEXT,
  p_status   TEXT
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE COALESCE(p_language, 'en')
    WHEN 'es' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'Gracias', 'body', 'Eliminamos el contenido que reportaste.')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'Gracias', 'body', 'Revisamos tu reporte. No tomamos acción esta vez.')
      ELSE                  jsonb_build_object('title', 'Gracias', 'body', 'Revisamos tu reporte.')
    END
    WHEN 'fr' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'Merci', 'body', 'Nous avons supprimé le contenu que vous avez signalé.')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'Merci', 'body', 'Nous avons examiné votre signalement. Pas d''action cette fois.')
      ELSE                  jsonb_build_object('title', 'Merci', 'body', 'Nous avons examiné votre signalement.')
    END
    WHEN 'de' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'Danke', 'body', 'Wir haben den gemeldeten Inhalt entfernt.')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'Danke', 'body', 'Wir haben deine Meldung geprüft. Diesmal keine Maßnahmen.')
      ELSE                  jsonb_build_object('title', 'Danke', 'body', 'Wir haben deine Meldung geprüft.')
    END
    WHEN 'pt' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'Obrigado', 'body', 'Removemos o conteúdo denunciado.')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'Obrigado', 'body', 'Revisamos sua denúncia. Não tomamos medidas desta vez.')
      ELSE                  jsonb_build_object('title', 'Obrigado', 'body', 'Revisamos sua denúncia.')
    END
    WHEN 'it' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'Grazie', 'body', 'Abbiamo rimosso il contenuto segnalato.')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'Grazie', 'body', 'Abbiamo esaminato la segnalazione. Nessuna azione questa volta.')
      ELSE                  jsonb_build_object('title', 'Grazie', 'body', 'Abbiamo esaminato la tua segnalazione.')
    END
    WHEN 'ja' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'ありがとうございます', 'body', '報告されたコンテンツを削除しました。')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'ありがとうございます', 'body', 'ご報告を確認しました。今回は対処しません。')
      ELSE                  jsonb_build_object('title', 'ありがとうございます', 'body', 'ご報告を確認しました。')
    END
    WHEN 'ko' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', '감사합니다', 'body', '신고된 콘텐츠를 삭제했습니다.')
      WHEN 'dismissed' THEN jsonb_build_object('title', '감사합니다', 'body', '신고를 검토했습니다. 이번에는 조치하지 않았습니다.')
      ELSE                  jsonb_build_object('title', '감사합니다', 'body', '신고를 검토했습니다.')
    END
    WHEN 'zh' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', '感谢', 'body', '我们已删除你举报的内容。')
      WHEN 'dismissed' THEN jsonb_build_object('title', '感谢', 'body', '我们审查了你的举报。这次未采取行动。')
      ELSE                  jsonb_build_object('title', '感谢', 'body', '我们审查了你的举报。')
    END
    WHEN 'ar' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'شكراً', 'body', 'تمت إزالة المحتوى المُبلَّغ عنه.')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'شكراً', 'body', 'راجعنا بلاغك. لم نتخذ إجراء هذه المرة.')
      ELSE                  jsonb_build_object('title', 'شكراً', 'body', 'راجعنا بلاغك.')
    END
    WHEN 'hi' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'धन्यवाद', 'body', 'हमने रिपोर्ट की गई सामग्री हटा दी है।')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'धन्यवाद', 'body', 'हमने आपकी रिपोर्ट की समीक्षा की। इस बार कार्रवाई नहीं की गई।')
      ELSE                  jsonb_build_object('title', 'धन्यवाद', 'body', 'हमने आपकी रिपोर्ट की समीक्षा की।')
    END
    WHEN 'ru' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'Спасибо', 'body', 'Мы удалили жалобный контент.')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'Спасибо', 'body', 'Мы рассмотрели вашу жалобу. В этот раз без действий.')
      ELSE                  jsonb_build_object('title', 'Спасибо', 'body', 'Мы рассмотрели вашу жалобу.')
    END
    WHEN 'tr' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'Teşekkürler', 'body', 'Bildirdiğin içeriği kaldırdık.')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'Teşekkürler', 'body', 'Şikayetini inceledik. Bu sefer işlem yapmadık.')
      ELSE                  jsonb_build_object('title', 'Teşekkürler', 'body', 'Şikayetini inceledik.')
    END
    WHEN 'pl' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'Dziękujemy', 'body', 'Usunęliśmy zgłoszoną treść.')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'Dziękujemy', 'body', 'Sprawdziliśmy zgłoszenie. Tym razem bez działań.')
      ELSE                  jsonb_build_object('title', 'Dziękujemy', 'body', 'Sprawdziliśmy Twoje zgłoszenie.')
    END
    WHEN 'nl' THEN CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'Bedankt', 'body', 'We hebben de gerapporteerde inhoud verwijderd.')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'Bedankt', 'body', 'We hebben je melding bekeken. Geen actie deze keer.')
      ELSE                  jsonb_build_object('title', 'Bedankt', 'body', 'We hebben je melding bekeken.')
    END
    ELSE CASE p_status
      WHEN 'actioned'  THEN jsonb_build_object('title', 'Thanks', 'body', 'We removed the content you reported.')
      WHEN 'dismissed' THEN jsonb_build_object('title', 'Thanks', 'body', 'We reviewed your report. We didn''t take action this time.')
      ELSE                  jsonb_build_object('title', 'Thanks', 'body', 'We reviewed your report.')
    END
  END
$$;

REVOKE ALL ON FUNCTION public.report_resolution_text(TEXT, TEXT) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Trigger function. Fires AFTER UPDATE of status on hub_reports
--    when status transitions out of 'pending'. Looks up the reporter's
--    language, builds the localized text, inserts into notifications.
--
--    The notifications trigger from migration 034 then handles push
--    fanout transparently.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_report_resolved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lang     TEXT;
  v_text     JSONB;
  v_reporter UUID;
BEGIN
  -- Only fire when status changes AND new status is a terminal one.
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('reviewed', 'actioned', 'dismissed') THEN RETURN NEW; END IF;

  v_reporter := NEW.reporter_user_id;
  IF v_reporter IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(preferred_language, 'en')
    INTO v_lang
    FROM public.user_profiles
   WHERE id = v_reporter;
  v_lang := COALESCE(v_lang, 'en');

  v_text := public.report_resolution_text(v_lang, NEW.status);

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, metadata)
  VALUES (
    v_reporter,
    NEW.reporter_email,
    'report_resolved',
    v_text->>'title',
    v_text->>'body',
    CASE NEW.status
      WHEN 'actioned'  THEN '✅'
      WHEN 'dismissed' THEN '👀'
      ELSE                  '🛡️'
    END,
    jsonb_build_object(
      'report_id',     NEW.id,
      'status',        NEW.status,
      'reported_type', NEW.reported_type
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the underlying status
  -- update — the moderator's action still went through.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_report_resolved ON public.hub_reports;
CREATE TRIGGER trg_notify_report_resolved
  AFTER UPDATE OF status ON public.hub_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_report_resolved();
