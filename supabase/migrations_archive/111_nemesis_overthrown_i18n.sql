-- 111_nemesis_overthrown_i18n.sql
--
-- FIX: the nemesis_overthrown notification I shipped earlier this
-- session (mig 102 + nemesis.js performOverthrow change) bypassed
-- the server-side i18n pattern every other competitive notification
-- uses. The body was hardcoded English — Spanish/Japanese/Arabic
-- users got "You overthrew {username}. A new rival awaits." in
-- English regardless of their preferred_language.
--
-- This migration brings nemesis_overthrown in line with the
-- nemesis_assigned (mig 081), duel_*  (mig 065), bounty_* (mig 069),
-- crew_war_* (mig 069), and crew_challenge_* (mig 104) patterns:
--   • text helper renders title + body in 15 languages
--   • SECURITY DEFINER RPC that looks up the dethroned name + the
--     caller's preferred_language server-side and inserts the
--     notification with localized text
--
-- The client (nemesis.js performOverthrow) will be updated to call
-- this RPC instead of doing a direct .from('notifications').insert
-- with hardcoded English text.
--
-- Idempotency: the RPC checks that the assignment row exists and
-- belongs to the caller, and reads its current status. If the row
-- has not yet been transitioned to 'overthrown', the RPC bails
-- (the client must update status first, then call this — the
-- existing client order).

-- ── Text helper ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.nemesis_overthrown_text(
  p_language          TEXT,
  p_dethroned_name    TEXT
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $nemesis_overthrown_text$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN '👑 Némesis derrocado'
        WHEN 'fr' THEN '👑 Nemesis renversé'
        WHEN 'de' THEN '👑 Nemesis gestürzt'
        WHEN 'pt' THEN '👑 Némesis derrotado'
        WHEN 'it' THEN '👑 Nemesis sconfitto'
        WHEN 'ja' THEN '👑 宿敵を打ち破った'
        WHEN 'ko' THEN '👑 라이벌을 꺾었습니다'
        WHEN 'zh' THEN '👑 宿敌已被推翻'
        WHEN 'ar' THEN '👑 تمت الإطاحة بالخصم'
        WHEN 'hi' THEN '👑 प्रतिद्वंद्वी को हराया'
        WHEN 'ru' THEN '👑 Соперник повержен'
        WHEN 'tr' THEN '👑 Rakibi devirdin'
        WHEN 'pl' THEN '👑 Rywal pokonany'
        WHEN 'nl' THEN '👑 Nemesis verslagen'
        ELSE              '👑 Nemesis overthrown'
      END,
    'body',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN 'Derrocaste a ' || p_dethroned_name || '. Te espera un nuevo rival.'
        WHEN 'fr' THEN 'Vous avez renversé ' || p_dethroned_name || '. Un nouveau rival vous attend.'
        WHEN 'de' THEN 'Du hast ' || p_dethroned_name || ' gestürzt. Ein neuer Rivale wartet.'
        WHEN 'pt' THEN 'Você derrotou ' || p_dethroned_name || '. Um novo rival aguarda.'
        WHEN 'it' THEN 'Hai sconfitto ' || p_dethroned_name || '. Un nuovo rivale ti aspetta.'
        WHEN 'ja' THEN p_dethroned_name || ' を打ち破った。新たな宿敵が待っている。'
        WHEN 'ko' THEN p_dethroned_name || '을(를) 꺾었습니다. 새로운 라이벌이 기다립니다.'
        WHEN 'zh' THEN '你击败了 ' || p_dethroned_name || '。新的对手正在等待。'
        WHEN 'ar' THEN 'لقد أطحت بـ ' || p_dethroned_name || '. خصم جديد في انتظارك.'
        WHEN 'hi' THEN 'आपने ' || p_dethroned_name || ' को हरा दिया। एक नया प्रतिद्वंद्वी प्रतीक्षा कर रहा है।'
        WHEN 'ru' THEN 'Вы повергли ' || p_dethroned_name || '. Вас ждёт новый соперник.'
        WHEN 'tr' THEN p_dethroned_name || ' adlı rakibi devirdin. Yeni bir rakip seni bekliyor.'
        WHEN 'pl' THEN 'Pokonałeś gracza ' || p_dethroned_name || '. Czeka na ciebie nowy rywal.'
        WHEN 'nl' THEN 'Je hebt ' || p_dethroned_name || ' verslagen. Een nieuwe rivaal wacht.'
        ELSE              'You overthrew ' || p_dethroned_name || '. A new rival awaits.'
      END
  );
$nemesis_overthrown_text$;

REVOKE ALL ON FUNCTION public.nemesis_overthrown_text(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nemesis_overthrown_text(TEXT, TEXT) TO authenticated;

-- ── Self-targeted RPC ───────────────────────────────────────────────────
--
-- Caller is the recipient (the user who just overthrew their nemesis).
-- Looks up the assignment row to resolve the dethroned user's name,
-- renders text in the caller's preferred_language, inserts the
-- notification. The 034 trigger handles push fanout.

CREATE OR REPLACE FUNCTION public.notify_nemesis_overthrown_for(
  p_assignment_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $notify_nemesis_overthrown_for$
DECLARE
  v_user_id        UUID := auth.uid();
  v_user_email     TEXT;
  v_user_lang      TEXT;
  v_nemesis_id     UUID;
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

  -- Resolve the assignment. user_id is the OWNER of the assignment
  -- (the person whose nemesis was dethroned, i.e., the caller).
  -- nemesis_id is the user who got dethroned. We require user_id to
  -- match the caller so a malicious user can't trigger a celebration
  -- notification on someone else's behalf.
  SELECT user_id, nemesis_id, status
    INTO v_owner, v_nemesis_id, v_status
    FROM public.nemesis_assignments
   WHERE id = p_assignment_id;

  IF v_owner IS NULL THEN
    -- Assignment doesn't exist (or never did). Silent no-op rather
    -- than error — the underlying overthrow was the canonical event.
    RETURN NULL;
  END IF;
  IF v_owner <> v_user_id THEN
    RAISE EXCEPTION 'not your assignment' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'overthrown' THEN
    -- Client must transition the row to 'overthrown' first. If it's
    -- still 'active', the celebration is premature. No-op rather
    -- than error — defensive against client-side ordering bugs.
    RETURN NULL;
  END IF;

  -- Look up recipient's email + language (the caller).
  SELECT u.email, prof.preferred_language
    INTO v_user_email, v_user_lang
    FROM auth.users u
    LEFT JOIN public.user_profiles prof ON prof.id = u.id
   WHERE u.id = v_user_id;

  IF v_user_email IS NULL THEN
    RETURN NULL;
  END IF;

  -- Look up the dethroned user's display name. Fall back to a
  -- generic phrase if missing — better than rendering 'null' or
  -- leaking a UUID.
  SELECT username INTO v_dethroned_name
    FROM public.user_profiles
   WHERE id = v_nemesis_id;

  v_text := public.nemesis_overthrown_text(
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
       'dethroned_user_id', v_nemesis_id,
       'dethroned_name',    v_dethroned_name
     ))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$notify_nemesis_overthrown_for$;

REVOKE ALL ON FUNCTION public.notify_nemesis_overthrown_for(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_nemesis_overthrown_for(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
