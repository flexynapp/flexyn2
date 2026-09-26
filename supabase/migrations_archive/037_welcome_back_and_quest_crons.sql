-- 037_welcome_back_and_quest_crons.sql
--
-- Two more retention pushes, sharing the infrastructure built in 034/035:
--
--   1. WELCOME-BACK — users who haven't logged in for 3+ days (but used
--      to be active) get one nudge: "Your friends miss you." Sent once
--      per ~5-day cycle to avoid harassing churned users.
--
--   2. QUEST-EXPIRY — users with at least one daily quest near
--      completion at 21:00 LOCAL time get nudged before midnight wipes
--      the row. "Finish your last quest before midnight."
--
-- Both honor notification_prefs (migration 036). The fan-out is handled
-- by the trigger in 034.
--
-- Schedule:
--   • welcome-back: hourly, sends only within the user's local 18:00-20:00
--   • quest-expiry: every 15 min, sends only within the user's local 21:00-23:00
--
-- Cooldown columns added to user_profiles to enforce dedup. Cooldown
-- gate is the same UPDATE...RETURNING claim pattern as 035 — atomic,
-- safe under concurrent cron runs.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS last_welcome_back_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_quest_nudge_at  TIMESTAMPTZ;

-- ── Welcome-back text helper ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.welcome_back_text(p_language TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE COALESCE(p_language, 'en')
    WHEN 'es' THEN jsonb_build_object('title', '👋 Te echamos de menos',         'body', 'Tu progreso te espera. ¿Una sesión rápida hoy?')
    WHEN 'fr' THEN jsonb_build_object('title', '👋 Vous nous manquez',           'body', 'Vos progrès vous attendent. Une séance rapide aujourd''hui ?')
    WHEN 'de' THEN jsonb_build_object('title', '👋 Wir vermissen dich',          'body', 'Dein Fortschritt wartet. Heute eine kurze Einheit?')
    WHEN 'pt' THEN jsonb_build_object('title', '👋 Sentimos sua falta',          'body', 'Seu progresso espera. Um treino rápido hoje?')
    WHEN 'it' THEN jsonb_build_object('title', '👋 Ci manchi',                   'body', 'I tuoi progressi ti aspettano. Una sessione veloce oggi?')
    WHEN 'ja' THEN jsonb_build_object('title', '👋 お久しぶりです',              'body', '進捗が待っています。今日少しだけ運動しませんか？')
    WHEN 'ko' THEN jsonb_build_object('title', '👋 보고 싶었어요',                'body', '진행 상황이 기다리고 있어요. 오늘 짧은 운동 어때요?')
    WHEN 'zh' THEN jsonb_build_object('title', '👋 我们想你了',                  'body', '你的进度在等你。今天来一次快速锻炼？')
    WHEN 'ar' THEN jsonb_build_object('title', '👋 افتقدناك',                    'body', 'تقدمك ينتظرك. تمرين سريع اليوم؟')
    WHEN 'hi' THEN jsonb_build_object('title', '👋 हमें आपकी याद आई',           'body', 'आपकी प्रगति इंतज़ार कर रही है। आज एक छोटा वर्कआउट?')
    WHEN 'ru' THEN jsonb_build_object('title', '👋 Мы скучали',                  'body', 'Ваш прогресс ждёт. Быстрая тренировка сегодня?')
    WHEN 'tr' THEN jsonb_build_object('title', '👋 Seni özledik',                'body', 'İlerlemen seni bekliyor. Bugün hızlı bir antrenman?')
    WHEN 'pl' THEN jsonb_build_object('title', '👋 Tęskniliśmy',                 'body', 'Twoje postępy czekają. Szybki trening dzisiaj?')
    WHEN 'nl' THEN jsonb_build_object('title', '👋 We hebben je gemist',         'body', 'Je voortgang wacht. Vandaag een snelle sessie?')
    ELSE              jsonb_build_object('title', '👋 We miss you',              'body', 'Your progress is waiting. Quick session today?')
  END;
$$;

REVOKE ALL ON FUNCTION public.welcome_back_text(TEXT) FROM PUBLIC;

-- ── Quest-expiry text helper ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.quest_expiry_text(p_language TEXT, p_remaining INTEGER)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE COALESCE(p_language, 'en')
    WHEN 'es' THEN jsonb_build_object('title', '⏳ ' || p_remaining || ' misiones por terminar', 'body', 'Las misiones se reinician a medianoche. ¡No pierdas las monedas!')
    WHEN 'fr' THEN jsonb_build_object('title', '⏳ ' || p_remaining || ' missions à terminer',   'body', 'Les missions se réinitialisent à minuit. Ne perdez pas les pièces !')
    WHEN 'de' THEN jsonb_build_object('title', '⏳ ' || p_remaining || ' Quests offen',          'body', 'Quests werden um Mitternacht zurückgesetzt. Hol dir die Münzen!')
    WHEN 'pt' THEN jsonb_build_object('title', '⏳ ' || p_remaining || ' missões pendentes',     'body', 'As missões reiniciam à meia-noite. Não perca as moedas!')
    WHEN 'it' THEN jsonb_build_object('title', '⏳ ' || p_remaining || ' missioni da finire',    'body', 'Le missioni si resettano a mezzanotte. Non perdere le monete!')
    WHEN 'ja' THEN jsonb_build_object('title', '⏳ ' || p_remaining || '個のクエスト未達成',     'body', '深夜にリセットされます。コインを取り逃さないで！')
    WHEN 'ko' THEN jsonb_build_object('title', '⏳ ' || p_remaining || '개의 퀘스트 미완료',     'body', '자정에 초기화됩니다. 코인을 놓치지 마세요!')
    WHEN 'zh' THEN jsonb_build_object('title', '⏳ 还有 ' || p_remaining || ' 个任务未完成',     'body', '任务将在午夜重置。别错过金币！')
    WHEN 'ar' THEN jsonb_build_object('title', '⏳ ' || p_remaining || ' مهام متبقية',           'body', 'تُعاد المهام عند منتصف الليل. لا تفوّت العملات!')
    WHEN 'hi' THEN jsonb_build_object('title', '⏳ ' || p_remaining || ' क्वेस्ट बाकी',           'body', 'क्वेस्ट आधी रात को रीसेट होते हैं। सिक्के मत खोएं!')
    WHEN 'ru' THEN jsonb_build_object('title', '⏳ Осталось ' || p_remaining || ' заданий',      'body', 'Задания сбрасываются в полночь. Не упустите монеты!')
    WHEN 'tr' THEN jsonb_build_object('title', '⏳ ' || p_remaining || ' görev bitmedi',         'body', 'Görevler gece yarısı sıfırlanır. Madeni paraları kaçırma!')
    WHEN 'pl' THEN jsonb_build_object('title', '⏳ ' || p_remaining || ' zadań do ukończenia',   'body', 'Zadania resetują się o północy. Nie trać monet!')
    WHEN 'nl' THEN jsonb_build_object('title', '⏳ ' || p_remaining || ' quests open',           'body', 'Quests resetten om middernacht. Mis de munten niet!')
    ELSE              jsonb_build_object('title', '⏳ ' || p_remaining || ' quests left today',  'body', 'Quests reset at midnight. Don''t miss the coins!')
  END;
$$;

REVOKE ALL ON FUNCTION public.quest_expiry_text(TEXT, INTEGER) FROM PUBLIC;

-- ── Welcome-back cron worker ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.run_welcome_back_reminders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now    TIMESTAMPTZ := now();
  v_count  INTEGER := 0;
  v_row    RECORD;
  v_text   JSONB;
BEGIN
  -- Criteria:
  --   • last_login_date >= 3 days ago AND <= 30 days ago (don't spam fresh
  --     users; don't keep pestering users churned for over a month)
  --   • prefs.engagement is not false
  --   • haven't been welcomed back in the last 5 days
  --   • local hour 18-20
  --
  -- Atomic claim via UPDATE...RETURNING last_welcome_back_at = now().
  FOR v_row IN
    UPDATE public.user_profiles AS p
       SET last_welcome_back_at = v_now
     WHERE p.timezone_offset_minutes IS NOT NULL
       AND p.last_login_date IS NOT NULL
       AND p.last_login_date <= (v_now AT TIME ZONE 'UTC')::date - INTERVAL '3 days'
       AND p.last_login_date >  (v_now AT TIME ZONE 'UTC')::date - INTERVAL '30 days'
       AND (
             p.last_welcome_back_at IS NULL
             OR p.last_welcome_back_at < v_now - INTERVAL '5 days'
           )
       AND (
             p.notification_prefs IS NULL
             OR (p.notification_prefs ->> 'engagement') IS NULL
             OR (p.notification_prefs ->> 'engagement') <> 'false'
           )
       AND EXTRACT(HOUR FROM (v_now + (p.timezone_offset_minutes || ' minutes')::interval) AT TIME ZONE 'UTC')
           BETWEEN 18 AND 20
    RETURNING p.id AS user_id, p.email AS user_email, p.preferred_language
  LOOP
    IF v_row.user_email IS NULL THEN CONTINUE; END IF;

    v_text := public.welcome_back_text(COALESCE(v_row.preferred_language, 'en'));

    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_row.user_id, v_row.user_email, 'welcome_back',
       v_text ->> 'title', v_text ->> 'body', '👋', '/dashboard',
       '{}'::jsonb);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.run_welcome_back_reminders() FROM PUBLIC;

-- ── Quest-expiry cron worker ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.run_quest_expiry_reminders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now      TIMESTAMPTZ := now();
  v_count    INTEGER := 0;
  v_row      RECORD;
  v_text     JSONB;
  v_remaining INTEGER;
BEGIN
  -- Atomic claim. We push only to users who:
  --   • have at least one INCOMPLETE quest for today (in their tz)
  --   • haven't been nudged in the last 6 hours (cron runs every 15min;
  --     6h cooldown means at most one nudge per evening per user)
  --   • prefs.quests is not false
  --   • local hour 21-22
  FOR v_row IN
    UPDATE public.user_profiles AS p
       SET last_quest_nudge_at = v_now
     WHERE p.timezone_offset_minutes IS NOT NULL
       AND (
             p.last_quest_nudge_at IS NULL
             OR p.last_quest_nudge_at < v_now - INTERVAL '6 hours'
           )
       AND (
             p.notification_prefs IS NULL
             OR (p.notification_prefs ->> 'quests') IS NULL
             OR (p.notification_prefs ->> 'quests') <> 'false'
           )
       AND EXTRACT(HOUR FROM (v_now + (p.timezone_offset_minutes || ' minutes')::interval) AT TIME ZONE 'UTC')
           BETWEEN 21 AND 22
       AND EXISTS (
             SELECT 1 FROM public.user_daily_quests q
              WHERE q.user_id = p.id
                AND q.quest_date = ((v_now + (p.timezone_offset_minutes || ' minutes')::interval) AT TIME ZONE 'UTC')::date
                AND q.completed_at IS NULL
           )
    RETURNING p.id AS user_id, p.email AS user_email, p.preferred_language,
              p.timezone_offset_minutes
  LOOP
    IF v_row.user_email IS NULL THEN CONTINUE; END IF;

    -- Count how many quests are still incomplete in their local "today"
    -- so we can render a meaningful headline ("3 quests left today").
    SELECT COUNT(*) INTO v_remaining
      FROM public.user_daily_quests q
     WHERE q.user_id = v_row.user_id
       AND q.quest_date = ((v_now + (v_row.timezone_offset_minutes || ' minutes')::interval) AT TIME ZONE 'UTC')::date
       AND q.completed_at IS NULL;

    IF v_remaining < 1 THEN
      -- Race condition: user completed all quests between the EXISTS check
      -- and the COUNT. Skip the push; the row claim already happened, which
      -- is fine (next cron firing will re-evaluate).
      CONTINUE;
    END IF;

    v_text := public.quest_expiry_text(COALESCE(v_row.preferred_language, 'en'), v_remaining);

    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_row.user_id, v_row.user_email, 'quest_expiry_warning',
       v_text ->> 'title', v_text ->> 'body', '⏳', '/dashboard',
       jsonb_build_object('remaining', v_remaining));

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.run_quest_expiry_reminders() FROM PUBLIC;

-- ── Schedule both with pg_cron ──────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
DECLARE
  v_id BIGINT;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'welcome_back_hourly';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule(
    'welcome_back_hourly',
    '0 * * * *',
    $cron$ SELECT public.run_welcome_back_reminders(); $cron$
  );

  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'quest_expiry_15min';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule(
    'quest_expiry_15min',
    '*/15 * * * *',
    $cron$ SELECT public.run_quest_expiry_reminders(); $cron$
  );
END $$;

NOTIFY pgrst, 'reload schema';
