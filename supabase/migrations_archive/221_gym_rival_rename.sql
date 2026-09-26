-- 221_gym_rival_rename.sql
--
-- Phase 1b of the Nemesis → Gym Rival rework: rename the DB objects that
-- back the feature. Scope is deliberately contained to avoid cascades:
--
--   RENAMED
--     • type   public.nemesis_status        -> public.gym_rival_status
--     • table  public.nemesis_assignments   -> public.gym_rival_assignments
--     • column nemesis_id                    -> rival_id   (CHECK/indexes
--       auto-follow the column rename)
--     • fns    nemesis_assigned_text         -> gym_rival_assigned_text
--              notify_nemesis_assigned_for   -> notify_gym_rival_assigned_for
--              nemesis_overthrown_text       -> gym_rival_overthrown_text
--              notify_nemesis_overthrown_for -> notify_gym_rival_overthrown_for
--       (increment_overthrow_count keeps its name — "overthrow" isn't a
--        Nemesis term — but its body is re-pointed at the renamed table.)
--
--   INTENTIONALLY LEFT ALONE (invisible to users, high cascade risk)
--     • user_profiles.nemesis_opt_out — the public_profiles view (mig 220)
--       exposes it; renaming would force a full view recreation. Kept.
--     • notification type strings 'nemesis_assigned' / 'nemesis_overthrown'
--       — mapped to 'competitive' by the category mapper and stamped on
--       historical rows. Kept for backward-compat; users only ever see the
--       title/body text, which now says "Gym Rival".
--
-- The renames are guarded so a partial/second paste is a no-op. All SQL is
-- paste-safe (no alias.column tokens; scalar SELECT ... INTO; public.<t>).

-- ── 1. Rename the enum type ───────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_type WHERE typname = 'nemesis_status') THEN
    ALTER TYPE public.nemesis_status RENAME TO gym_rival_status;
  END IF;
END $$;

-- ── 2. Rename the table + its rival column ────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'nemesis_assignments'
  ) THEN
    ALTER TABLE public.nemesis_assignments RENAME TO gym_rival_assignments;
  END IF;

  IF EXISTS (
    SELECT FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name  = 'gym_rival_assignments'
       AND column_name = 'nemesis_id'
  ) THEN
    ALTER TABLE public.gym_rival_assignments RENAME COLUMN nemesis_id TO rival_id;
  END IF;
END $$;

-- ── 3. Assigned-notification text (15 langs) ──────────────────────────────
DROP FUNCTION IF EXISTS public.nemesis_assigned_text(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.gym_rival_assigned_text(
  p_language   TEXT,
  p_rival_name TEXT
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $gym_rival_assigned_text$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN '🎯 Tu nuevo rival: ' || p_rival_name
        WHEN 'fr' THEN '🎯 Ton nouveau rival : ' || p_rival_name
        WHEN 'de' THEN '🎯 Dein neuer Rivale: ' || p_rival_name
        WHEN 'pt' THEN '🎯 Seu novo rival: ' || p_rival_name
        WHEN 'it' THEN '🎯 Il tuo nuovo rivale: ' || p_rival_name
        WHEN 'ja' THEN '🎯 新しいライバル: ' || p_rival_name
        WHEN 'ko' THEN '🎯 새로운 라이벌: ' || p_rival_name
        WHEN 'zh' THEN '🎯 你的新对手: ' || p_rival_name
        WHEN 'ar' THEN '🎯 منافسك الجديد: ' || p_rival_name
        WHEN 'hi' THEN '🎯 आपका नया प्रतिद्वंद्वी: ' || p_rival_name
        WHEN 'ru' THEN '🎯 Ваш новый соперник: ' || p_rival_name
        WHEN 'tr' THEN '🎯 Yeni rakibin: ' || p_rival_name
        WHEN 'pl' THEN '🎯 Twój nowy rywal: ' || p_rival_name
        WHEN 'nl' THEN '🎯 Je nieuwe rivaal: ' || p_rival_name
        ELSE              '🎯 Meet your Gym Rival: ' || p_rival_name
      END,
    'body',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN 'Están a tu nivel. Entrena más que ellos esta semana para ganar.'
        WHEN 'fr' THEN 'Ils sont à ton niveau. Entraîne-toi plus qu''eux cette semaine pour gagner.'
        WHEN 'de' THEN 'Sie sind auf deinem Level. Trainiere diese Woche mehr als sie, um zu gewinnen.'
        WHEN 'pt' THEN 'Estão no seu nível. Treine mais que eles nesta semana para vencer.'
        WHEN 'it' THEN 'Sono al tuo livello. Allenati più di loro questa settimana per vincere.'
        WHEN 'ja' THEN '相手はあなたと同じレベル。今週はもっとトレーニングして勝とう。'
        WHEN 'ko' THEN '당신과 비슷한 레벨이에요. 이번 주에 더 많이 훈련해서 이기세요.'
        WHEN 'zh' THEN '他们和你水平相当。这周比他们练得更多就能获胜。'
        WHEN 'ar' THEN 'إنهم في مستواك. تدرّب أكثر منهم هذا الأسبوع لتفوز.'
        WHEN 'hi' THEN 'वे आपके स्तर के हैं। इस हफ़्ते उनसे ज़्यादा ट्रेनिंग करके जीतें।'
        WHEN 'ru' THEN 'Они вашего уровня. Тренируйтесь больше них на этой неделе, чтобы победить.'
        WHEN 'tr' THEN 'Seninle aynı seviyedeler. Bu hafta onlardan çok antrenman yap, kazan.'
        WHEN 'pl' THEN 'Są na twoim poziomie. Trenuj więcej niż oni w tym tygodniu, by wygrać.'
        WHEN 'nl' THEN 'Ze zijn van jouw niveau. Train deze week meer dan zij om te winnen.'
        ELSE              'They''re around your level. Out-train them this week to win.'
      END
  );
$gym_rival_assigned_text$;

REVOKE ALL    ON FUNCTION public.gym_rival_assigned_text(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_rival_assigned_text(TEXT, TEXT) TO authenticated;

-- ── 4. Assigned-notification RPC (self-targeted) ──────────────────────────
DROP FUNCTION IF EXISTS public.notify_nemesis_assigned_for(UUID);

CREATE OR REPLACE FUNCTION public.notify_gym_rival_assigned_for(
  p_rival_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $notify_gym_rival_assigned_for$
DECLARE
  v_user_id    UUID := auth.uid();
  v_user_email TEXT;
  v_user_lang  TEXT;
  v_rival_name TEXT;
  v_text       JSONB;
  v_id         UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_rival_id IS NULL THEN
    RAISE EXCEPTION 'rival_id required' USING ERRCODE = '22023';
  END IF;
  IF p_rival_id = v_user_id THEN
    RAISE EXCEPTION 'cannot be your own rival' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT preferred_language INTO v_user_lang FROM public.user_profiles WHERE id = v_user_id;
  SELECT username INTO v_rival_name FROM public.user_profiles WHERE id = p_rival_id;

  v_text := public.gym_rival_assigned_text(
    COALESCE(v_user_lang, 'en'),
    COALESCE(v_rival_name, 'a rival')
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
       'rival_id',   p_rival_id,
       'rival_name', v_rival_name
     ))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$notify_gym_rival_assigned_for$;

GRANT EXECUTE ON FUNCTION public.notify_gym_rival_assigned_for(UUID) TO authenticated;

-- ── 5. Overthrown-notification text (15 langs) ────────────────────────────
DROP FUNCTION IF EXISTS public.nemesis_overthrown_text(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.gym_rival_overthrown_text(
  p_language       TEXT,
  p_dethroned_name TEXT
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $gym_rival_overthrown_text$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN '👑 Rival superado'
        WHEN 'fr' THEN '👑 Rival dépassé'
        WHEN 'de' THEN '👑 Rivale geschlagen'
        WHEN 'pt' THEN '👑 Rival superado'
        WHEN 'it' THEN '👑 Rivale battuto'
        WHEN 'ja' THEN '👑 ライバルに勝った'
        WHEN 'ko' THEN '👑 라이벌을 꺾었습니다'
        WHEN 'zh' THEN '👑 击败了对手'
        WHEN 'ar' THEN '👑 تغلبت على منافسك'
        WHEN 'hi' THEN '👑 प्रतिद्वंद्वी को हराया'
        WHEN 'ru' THEN '👑 Соперник повержен'
        WHEN 'tr' THEN '👑 Rakibini geçtin'
        WHEN 'pl' THEN '👑 Rywal pokonany'
        WHEN 'nl' THEN '👑 Rivaal verslagen'
        ELSE              '👑 Gym Rival beaten'
      END,
    'body',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN 'Superaste a ' || p_dethroned_name || '. Te espera un nuevo rival.'
        WHEN 'fr' THEN 'Tu as dépassé ' || p_dethroned_name || '. Un nouveau rival t''attend.'
        WHEN 'de' THEN 'Du hast ' || p_dethroned_name || ' geschlagen. Ein neuer Rivale wartet.'
        WHEN 'pt' THEN 'Você superou ' || p_dethroned_name || '. Um novo rival aguarda.'
        WHEN 'it' THEN 'Hai battuto ' || p_dethroned_name || '. Un nuovo rivale ti aspetta.'
        WHEN 'ja' THEN p_dethroned_name || ' に勝った。新たなライバルが待っている。'
        WHEN 'ko' THEN p_dethroned_name || '을(를) 꺾었습니다. 새로운 라이벌이 기다립니다.'
        WHEN 'zh' THEN '你击败了 ' || p_dethroned_name || '。新的对手正在等待。'
        WHEN 'ar' THEN 'لقد تغلبت على ' || p_dethroned_name || '. منافس جديد في انتظارك.'
        WHEN 'hi' THEN 'आपने ' || p_dethroned_name || ' को हरा दिया। एक नया प्रतिद्वंद्वी प्रतीक्षा कर रहा है।'
        WHEN 'ru' THEN 'Вы обошли ' || p_dethroned_name || '. Вас ждёт новый соперник.'
        WHEN 'tr' THEN p_dethroned_name || ' adlı rakibi geçtin. Yeni bir rakip seni bekliyor.'
        WHEN 'pl' THEN 'Pokonałeś gracza ' || p_dethroned_name || '. Czeka na ciebie nowy rywal.'
        WHEN 'nl' THEN 'Je hebt ' || p_dethroned_name || ' verslagen. Een nieuwe rivaal wacht.'
        ELSE              'You out-trained ' || p_dethroned_name || '. A new rival awaits.'
      END
  );
$gym_rival_overthrown_text$;

REVOKE ALL    ON FUNCTION public.gym_rival_overthrown_text(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_rival_overthrown_text(TEXT, TEXT) TO authenticated;

-- ── 6. Overthrown-notification RPC (self-targeted) ────────────────────────
DROP FUNCTION IF EXISTS public.notify_nemesis_overthrown_for(UUID);

CREATE OR REPLACE FUNCTION public.notify_gym_rival_overthrown_for(
  p_assignment_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $notify_gym_rival_overthrown_for$
DECLARE
  v_user_id        UUID := auth.uid();
  v_user_email     TEXT;
  v_user_lang      TEXT;
  v_rival_id       UUID;
  v_dethroned_name TEXT;
  v_status         TEXT;
  v_owner          UUID;
  v_text           JSONB;
  v_id             UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'assignment_id required' USING ERRCODE = '22023';
  END IF;

  SELECT user_id, rival_id, status
    INTO v_owner, v_rival_id, v_status
    FROM public.gym_rival_assignments
   WHERE id = p_assignment_id;

  IF v_owner IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_owner <> v_user_id THEN
    RAISE EXCEPTION 'not your assignment' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'overthrown' THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT preferred_language INTO v_user_lang FROM public.user_profiles WHERE id = v_user_id;
  SELECT username INTO v_dethroned_name FROM public.user_profiles WHERE id = v_rival_id;

  v_text := public.gym_rival_overthrown_text(
    COALESCE(v_user_lang, 'en'),
    COALESCE(v_dethroned_name, 'your rival')
  );

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (v_user_id,
     v_user_email,
     'nemesis_overthrown',
     v_text ->> 'title',
     v_text ->> 'body',
     '👑',
     '/dashboard',
     jsonb_build_object(
       'assignment_id',     p_assignment_id,
       'dethroned_user_id', v_rival_id,
       'dethroned_name',    v_dethroned_name
     ))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$notify_gym_rival_overthrown_for$;

REVOKE ALL    ON FUNCTION public.notify_gym_rival_overthrown_for(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_gym_rival_overthrown_for(UUID) TO authenticated;

-- ── 7. Re-point increment_overthrow_count at the renamed table ────────────
CREATE OR REPLACE FUNCTION public.increment_overthrow_count(
  p_user_id       UUID DEFAULT NULL,  -- IGNORED; kept for client-compat
  p_assignment_id UUID DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $increment_overthrow_count$
DECLARE
  v_uid       UUID := auth.uid();
  v_a_id      UUID;
  v_a_user    UUID;
  v_a_status  TEXT;
  v_a_counted BOOLEAN;
  v_new_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_a_id := p_assignment_id;
  IF v_a_id IS NULL THEN
    SELECT id INTO v_a_id
      FROM public.gym_rival_assignments
     WHERE user_id = v_uid
       AND status = 'overthrown'
       AND COALESCE(overthrow_counted, FALSE) = FALSE
     ORDER BY assigned_at DESC
     LIMIT 1;
    IF v_a_id IS NULL THEN
      SELECT overthrow_count INTO v_new_count FROM public.user_profiles WHERE id = v_uid;
      RETURN COALESCE(v_new_count, 0);
    END IF;
  END IF;

  SELECT user_id, status, overthrow_counted
    INTO v_a_user, v_a_status, v_a_counted
    FROM public.gym_rival_assignments
   WHERE id = v_a_id
   FOR UPDATE;
  IF v_a_user IS NULL THEN
    RAISE EXCEPTION 'assignment_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_a_user IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_your_assignment' USING ERRCODE = '42501';
  END IF;
  IF v_a_status IS DISTINCT FROM 'overthrown' THEN
    RAISE EXCEPTION 'assignment_not_overthrown' USING ERRCODE = '22023';
  END IF;
  IF v_a_counted THEN
    SELECT overthrow_count INTO v_new_count FROM public.user_profiles WHERE id = v_uid;
    RETURN COALESCE(v_new_count, 0);
  END IF;

  UPDATE public.gym_rival_assignments SET overthrow_counted = TRUE WHERE id = v_a_id;
  UPDATE public.user_profiles
     SET overthrow_count = COALESCE(overthrow_count, 0) + 1
   WHERE id = v_uid
   RETURNING overthrow_count INTO v_new_count;
  RETURN COALESCE(v_new_count, 1);
END;
$increment_overthrow_count$;

REVOKE ALL    ON FUNCTION public.increment_overthrow_count(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_overthrow_count(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
