-- 103_crew_challenge_notifications.sql
--
-- Wires push notifications for crew_challenges (added in migration 098).
-- Until now the entire lifecycle was silent — a crew admin could create
-- a challenge with a one-week deadline and members would never know it
-- existed unless they happened to open the crew chat. End-of-challenge
-- (status flipping to 'completed') likewise vanished without
-- acknowledgement.
--
-- This migration follows the same pattern as 069_competitive_notifications
-- (notify_crew_war_*_for): SECURITY DEFINER RPCs that fan out per-
-- member notification rows, with text rendered server-side in each
-- recipient's preferred_language across all 15 supported languages.
-- The 034 trigger handles push delivery on each notifications INSERT.
--
-- Two events:
--   • crew_challenge_created  — admin just created a challenge. Every
--     other crew member gets a push so they can plan their week
--     around the goal.
--   • crew_challenge_completed — the challenge hit target_value.
--     Every member gets a celebration push. This is the WIN moment;
--     also the moment members feel proudest of their crew.
--
-- Excluded:
--   • Progress milestones (25/50/75%) — too noisy. The chat header
--     already shows progress.
--   • Expiry (status='expired' without hitting target) — explicitly
--     a quiet failure. Silent expiration is kinder than a "you
--     missed your goal" push.
--   • The creator/admin themselves — they obviously know they just
--     created the thing. Excluded from the created fanout to avoid
--     self-spam.

-- ── Text helpers (i18n) ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crew_challenge_created_text(
  p_language       TEXT,
  p_challenge_title TEXT,
  p_crew_name      TEXT
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN '🎯 Nuevo reto del crew'
        WHEN 'fr' THEN '🎯 Nouveau défi du crew'
        WHEN 'de' THEN '🎯 Neue Crew-Challenge'
        WHEN 'pt' THEN '🎯 Novo desafio do crew'
        WHEN 'it' THEN '🎯 Nuova sfida del crew'
        WHEN 'ja' THEN '🎯 新しいクルーチャレンジ'
        WHEN 'ko' THEN '🎯 새로운 크루 챌린지'
        WHEN 'zh' THEN '🎯 全新战队挑战'
        WHEN 'ar' THEN '🎯 تحدٍ جديد للفريق'
        WHEN 'hi' THEN '🎯 नई क्रू चुनौती'
        WHEN 'ru' THEN '🎯 Новый вызов команды'
        WHEN 'tr' THEN '🎯 Yeni Crew Mücadelesi'
        WHEN 'pl' THEN '🎯 Nowe wyzwanie ekipy'
        WHEN 'nl' THEN '🎯 Nieuwe crew-uitdaging'
        ELSE              '🎯 New crew challenge'
      END,
    'body',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN COALESCE(p_crew_name, 'Tu crew') || ': ' || p_challenge_title
        WHEN 'fr' THEN COALESCE(p_crew_name, 'Votre crew') || ' : ' || p_challenge_title
        WHEN 'de' THEN COALESCE(p_crew_name, 'Dein Crew') || ': ' || p_challenge_title
        WHEN 'pt' THEN COALESCE(p_crew_name, 'Seu crew') || ': ' || p_challenge_title
        WHEN 'it' THEN COALESCE(p_crew_name, 'Il tuo crew') || ': ' || p_challenge_title
        WHEN 'ja' THEN COALESCE(p_crew_name, 'あなたのクルー') || '：' || p_challenge_title
        WHEN 'ko' THEN COALESCE(p_crew_name, '내 크루') || ': ' || p_challenge_title
        WHEN 'zh' THEN COALESCE(p_crew_name, '你的战队') || '：' || p_challenge_title
        WHEN 'ar' THEN COALESCE(p_crew_name, 'فريقك') || '：' || p_challenge_title
        WHEN 'hi' THEN COALESCE(p_crew_name, 'आपका क्रू') || ': ' || p_challenge_title
        WHEN 'ru' THEN COALESCE(p_crew_name, 'Ваша команда') || ': ' || p_challenge_title
        WHEN 'tr' THEN COALESCE(p_crew_name, 'Crew''iniz') || ': ' || p_challenge_title
        WHEN 'pl' THEN COALESCE(p_crew_name, 'Twoja ekipa') || ': ' || p_challenge_title
        WHEN 'nl' THEN COALESCE(p_crew_name, 'Je crew') || ': ' || p_challenge_title
        ELSE              COALESCE(p_crew_name, 'Your crew') || ': ' || p_challenge_title
      END
  );
$$;

REVOKE ALL ON FUNCTION public.crew_challenge_created_text(TEXT, TEXT, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.crew_challenge_completed_text(
  p_language       TEXT,
  p_challenge_title TEXT,
  p_crew_name      TEXT
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN '🏆 Reto del crew completado'
        WHEN 'fr' THEN '🏆 Défi du crew terminé'
        WHEN 'de' THEN '🏆 Crew-Challenge geschafft'
        WHEN 'pt' THEN '🏆 Desafio do crew concluído'
        WHEN 'it' THEN '🏆 Sfida del crew completata'
        WHEN 'ja' THEN '🏆 クルーチャレンジ達成'
        WHEN 'ko' THEN '🏆 크루 챌린지 달성'
        WHEN 'zh' THEN '🏆 战队挑战达成'
        WHEN 'ar' THEN '🏆 تم إنجاز تحدي الفريق'
        WHEN 'hi' THEN '🏆 क्रू चुनौती पूरी'
        WHEN 'ru' THEN '🏆 Вызов команды выполнен'
        WHEN 'tr' THEN '🏆 Crew Mücadelesi tamamlandı'
        WHEN 'pl' THEN '🏆 Wyzwanie ekipy ukończone'
        WHEN 'nl' THEN '🏆 Crew-uitdaging voltooid'
        ELSE              '🏆 Crew challenge complete'
      END,
    'body',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN COALESCE(p_crew_name, 'Tu crew') || ' alcanzó la meta: ' || p_challenge_title
        WHEN 'fr' THEN COALESCE(p_crew_name, 'Votre crew') || ' a atteint l''objectif : ' || p_challenge_title
        WHEN 'de' THEN COALESCE(p_crew_name, 'Dein Crew') || ' hat das Ziel erreicht: ' || p_challenge_title
        WHEN 'pt' THEN COALESCE(p_crew_name, 'Seu crew') || ' bateu a meta: ' || p_challenge_title
        WHEN 'it' THEN COALESCE(p_crew_name, 'Il tuo crew') || ' ha raggiunto l''obiettivo: ' || p_challenge_title
        WHEN 'ja' THEN COALESCE(p_crew_name, 'あなたのクルー') || 'が目標達成：' || p_challenge_title
        WHEN 'ko' THEN COALESCE(p_crew_name, '내 크루') || '가 목표 달성: ' || p_challenge_title
        WHEN 'zh' THEN COALESCE(p_crew_name, '你的战队') || '达成目标：' || p_challenge_title
        WHEN 'ar' THEN COALESCE(p_crew_name, 'فريقك') || ' حقق الهدف: ' || p_challenge_title
        WHEN 'hi' THEN COALESCE(p_crew_name, 'आपका क्रू') || ' ने लक्ष्य पूरा किया: ' || p_challenge_title
        WHEN 'ru' THEN COALESCE(p_crew_name, 'Ваша команда') || ' выполнила цель: ' || p_challenge_title
        WHEN 'tr' THEN COALESCE(p_crew_name, 'Crew''iniz') || ' hedefe ulaştı: ' || p_challenge_title
        WHEN 'pl' THEN COALESCE(p_crew_name, 'Twoja ekipa') || ' osiągnęła cel: ' || p_challenge_title
        WHEN 'nl' THEN COALESCE(p_crew_name, 'Je crew') || ' heeft het doel bereikt: ' || p_challenge_title
        ELSE              COALESCE(p_crew_name, 'Your crew') || ' hit the goal: ' || p_challenge_title
      END
  );
$$;

REVOKE ALL ON FUNCTION public.crew_challenge_completed_text(TEXT, TEXT, TEXT) FROM PUBLIC;

-- ── notify_crew_challenge_created_for ────────────────────────────────
--
-- Fans out to every member of the crew EXCEPT the creator. Only the
-- creator (an admin per the RLS policy in 098) can authoritatively
-- call this RPC — the SECURITY DEFINER posture is "caller must be a
-- crew member" for permission, and "caller is the challenge creator"
-- for intent. We don't want a random member to spam crewmates.

CREATE OR REPLACE FUNCTION public.notify_crew_challenge_created_for(p_challenge_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $crew_chal_created$
DECLARE
  v_caller    UUID := auth.uid();
  v_chal      public.crew_challenges%ROWTYPE;
  v_crew      public.crews%ROWTYPE;
  v_member    RECORD;
  v_count     INT := 0;
  v_text      JSONB;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_challenge_id IS NULL THEN
    RAISE EXCEPTION 'challenge_id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_chal FROM public.crew_challenges WHERE id = p_challenge_id;
  IF v_chal.id IS NULL THEN RETURN 0; END IF;

  -- The caller must be a member of this crew. Being THE creator is a
  -- stronger check (they wrote the row); we accept either for
  -- robustness — a co-admin who saw the creation and re-triggered
  -- fanout to recover from a partial failure shouldn't be blocked.
  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members
     WHERE crew_id = v_chal.crew_id
       AND user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'not a crew member' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_crew FROM public.crews WHERE id = v_chal.crew_id;

  -- Fan out to every member EXCEPT the creator.
  FOR v_member IN
    SELECT cm.user_id, up.email, up.preferred_language
      FROM public.crew_members cm
      JOIN public.user_profiles up ON up.id = cm.user_id
     WHERE cm.crew_id = v_chal.crew_id
       AND cm.user_id <> v_chal.created_by
       AND up.email IS NOT NULL
  LOOP
    v_text := public.crew_challenge_created_text(
      COALESCE(v_member.preferred_language, 'en'),
      v_chal.title,
      COALESCE(v_crew.name, NULL)
    );
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_member.user_id,
       v_member.email,
       'crew_challenge_created',
       v_text ->> 'title',
       v_text ->> 'body',
       '🎯',
       '/hub',
       jsonb_build_object(
         'challenge_id', p_challenge_id,
         'crew_id',      v_chal.crew_id,
         'metric',       v_chal.metric,
         'target_value', v_chal.target_value,
         'ends_at',      v_chal.ends_at
       ));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$crew_chal_created$;

REVOKE ALL ON FUNCTION public.notify_crew_challenge_created_for(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_crew_challenge_created_for(UUID) TO authenticated;

-- ── notify_crew_challenge_completed_for ──────────────────────────────
--
-- Fans out to EVERY member of the crew including the creator — the
-- whole point is to celebrate the collective win. Caller must be a
-- member.

CREATE OR REPLACE FUNCTION public.notify_crew_challenge_completed_for(p_challenge_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $crew_chal_completed$
DECLARE
  v_caller    UUID := auth.uid();
  v_chal      public.crew_challenges%ROWTYPE;
  v_crew      public.crews%ROWTYPE;
  v_member    RECORD;
  v_count     INT := 0;
  v_text      JSONB;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_challenge_id IS NULL THEN
    RAISE EXCEPTION 'challenge_id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_chal FROM public.crew_challenges WHERE id = p_challenge_id;
  IF v_chal.id IS NULL THEN RETURN 0; END IF;
  -- Only fan out if the challenge is actually completed. Calling with
  -- a still-active or expired challenge is a no-op rather than an
  -- error, so an over-eager client retry doesn't blow up.
  IF v_chal.status <> 'completed' THEN RETURN 0; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members
     WHERE crew_id = v_chal.crew_id
       AND user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'not a crew member' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_crew FROM public.crews WHERE id = v_chal.crew_id;

  FOR v_member IN
    SELECT cm.user_id, up.email, up.preferred_language
      FROM public.crew_members cm
      JOIN public.user_profiles up ON up.id = cm.user_id
     WHERE cm.crew_id = v_chal.crew_id
       AND up.email IS NOT NULL
  LOOP
    v_text := public.crew_challenge_completed_text(
      COALESCE(v_member.preferred_language, 'en'),
      v_chal.title,
      COALESCE(v_crew.name, NULL)
    );
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_member.user_id,
       v_member.email,
       'crew_challenge_completed',
       v_text ->> 'title',
       v_text ->> 'body',
       '🏆',
       '/hub',
       jsonb_build_object(
         'challenge_id', p_challenge_id,
         'crew_id',      v_chal.crew_id,
         'metric',       v_chal.metric,
         'target_value', v_chal.target_value
       ));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$crew_chal_completed$;

REVOKE ALL ON FUNCTION public.notify_crew_challenge_completed_for(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_crew_challenge_completed_for(UUID) TO authenticated;

-- ── Category mapping ─────────────────────────────────────────────────
-- Add the two new types to notification_type_category (which mig 102
-- repaired into the full union). Crew challenges are competitive in
-- spirit — they're a team-coordination effort to push collective
-- numbers, gated by the user's "competitive" preference.

CREATE OR REPLACE FUNCTION public.notification_type_category(p_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    -- streak
    WHEN 'streak_break_warning'    THEN 'streak'
    WHEN 'streak_milestone'        THEN 'streak'
    WHEN 'streak_rescue_available' THEN 'streak'
    -- quests
    WHEN 'quest_expiring'          THEN 'quests'
    WHEN 'quest_expiry_warning'    THEN 'quests'
    WHEN 'quest_completed'         THEN 'quests'
    WHEN 'quest_claimed'           THEN 'quests'
    WHEN 'quest_reset'             THEN 'quests'
    -- league
    WHEN 'league_promoted'         THEN 'league'
    WHEN 'league_promotion'        THEN 'league'
    WHEN 'league_demoted'          THEN 'league'
    WHEN 'league_demotion'         THEN 'league'
    WHEN 'league_held'             THEN 'league'
    WHEN 'league_resolution'       THEN 'league'
    WHEN 'league_starting_soon'    THEN 'league'
    -- social
    WHEN 'friend_post'             THEN 'social'
    WHEN 'friend_follow'           THEN 'social'
    WHEN 'comment_reply'           THEN 'social'
    WHEN 'post_reaction'           THEN 'social'
    WHEN 'post_like'               THEN 'social'
    WHEN 'sticker_reaction'        THEN 'social'
    WHEN 'trade_offer'             THEN 'social'
    WHEN 'crew_everyone'           THEN 'social'
    -- achievements
    WHEN 'pr_set'                  THEN 'achievements'
    WHEN 'capsule_earned'          THEN 'achievements'
    WHEN 'coin_milestone'          THEN 'achievements'
    -- engagement
    WHEN 'welcome_back'            THEN 'engagement'
    WHEN 'weekly_gauntlet_started' THEN 'engagement'
    WHEN 'memory_reengagement'     THEN 'engagement'
    -- competitive
    WHEN 'duel_invite'             THEN 'competitive'
    WHEN 'duel_result'             THEN 'competitive'
    WHEN 'bounty_claim'            THEN 'competitive'
    WHEN 'bounty_beaten'           THEN 'competitive'
    WHEN 'crew_war_started'        THEN 'competitive'
    WHEN 'crew_war_resolved'       THEN 'competitive'
    WHEN 'nemesis_assigned'        THEN 'competitive'
    WHEN 'nemesis_overthrown'      THEN 'competitive'
    WHEN 'crew_challenge_created'  THEN 'competitive'  -- NEW
    WHEN 'crew_challenge_completed' THEN 'competitive' -- NEW
    ELSE NULL
  END;
$$;

NOTIFY pgrst, 'reload schema';
