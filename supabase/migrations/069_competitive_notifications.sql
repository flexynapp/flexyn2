-- 069_competitive_notifications.sql
--
-- Wires the remaining competitive features into the existing
-- notifications + push pipeline. Follows the same cross-user RPC
-- pattern as migration 065 (duels) and 041 (friend follow/post):
-- server-side 15-language i18n, validates caller is a legitimate
-- participant, inserts into public.notifications so the 034 trigger
-- fans out a Web Push delivery.
--
-- Three event classes covered:
--
--   1. BOUNTY CLAIMED — somebody just claimed the bounty targeting
--      YOU. The target user learns their record is under attack.
--
--   2. BOUNTY BEATEN — your record was beaten by the claimant.
--      Target learns + losses entry fee, claimant wins reward.
--
--   3. CREW WAR EVENTS — war started (both crews) and war resolved
--      (win/loss outcome per crew). Cron / matchmaker triggers
--      both transitions, so we expose the fan-out as RPCs that the
--      matchmaker calls per war.
--
-- Per-category notification_type_category mapping is extended below
-- so the Settings opt-out toggle gates these too. Anyone who muted
-- the 'social' or 'competitive' categories gets neither the in-app
-- row nor the push.

-- ── notification_type_category extension ────────────────────────────────

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
    WHEN 'bounty_claim'         THEN 'competitive'
    WHEN 'bounty_beaten'        THEN 'competitive'
    WHEN 'crew_war_started'     THEN 'competitive'
    WHEN 'crew_war_resolved'    THEN 'competitive'
    ELSE NULL
  END;
$$;

-- ── i18n: bounty_claim_text ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bounty_claim_text(
  p_language   TEXT,
  p_claimant   TEXT
) RETURNS JSONB
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN p_claimant || ' viene por tu récord'
        WHEN 'fr' THEN p_claimant || ' s''attaque à ton record'
        WHEN 'de' THEN p_claimant || ' jagt deinen Rekord'
        WHEN 'pt' THEN p_claimant || ' está atrás do seu recorde'
        WHEN 'it' THEN p_claimant || ' punta al tuo record'
        WHEN 'ja' THEN p_claimant || 'があなたの記録を狙っています'
        WHEN 'ko' THEN p_claimant || '님이 당신의 기록을 노려요'
        WHEN 'zh' THEN p_claimant || ' 正在挑战你的记录'
        WHEN 'ar' THEN p_claimant || ' يستهدف رقمك القياسي'
        WHEN 'hi' THEN p_claimant || ' आपके रिकॉर्ड को चुनौती दे रहे हैं'
        WHEN 'ru' THEN p_claimant || ' идёт за вашим рекордом'
        WHEN 'tr' THEN p_claimant || ' rekorunun peşinde'
        WHEN 'pl' THEN p_claimant || ' poluje na twój rekord'
        WHEN 'nl' THEN p_claimant || ' gaat voor je record'
        ELSE              p_claimant || ' is coming for your record'
      END,
    'body',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN 'Una recompensa ha sido reclamada contra ti.'
        WHEN 'fr' THEN 'Une prime a été réclamée contre vous.'
        WHEN 'de' THEN 'Ein Kopfgeld wurde gegen dich beansprucht.'
        WHEN 'pt' THEN 'Uma recompensa foi reivindicada contra você.'
        WHEN 'it' THEN 'Una taglia è stata reclamata contro di te.'
        WHEN 'ja' THEN 'あなたに対する賞金が請求されました。'
        WHEN 'ko' THEN '당신에 대한 현상금이 청구되었어요.'
        WHEN 'zh' THEN '有人针对你领取了悬赏。'
        WHEN 'ar' THEN 'تمت المطالبة بمكافأة ضدك.'
        WHEN 'hi' THEN 'आपके ख़िलाफ़ इनाम का दावा किया गया है।'
        WHEN 'ru' THEN 'Против вас заявлено вознаграждение.'
        WHEN 'tr' THEN 'Sana karşı bir ödül talep edildi.'
        WHEN 'pl' THEN 'Wystawiono nagrodę przeciwko tobie.'
        WHEN 'nl' THEN 'Er is een premie tegen jou geclaimd.'
        ELSE              'A bounty has been claimed against you.'
      END
  );
$$;

REVOKE ALL  ON FUNCTION public.bounty_claim_text(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bounty_claim_text(TEXT, TEXT) TO authenticated;

-- ── i18n: bounty_beaten_text ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bounty_beaten_text(
  p_language   TEXT,
  p_claimant   TEXT
) RETURNS JSONB
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN p_claimant || ' superó tu marca'
        WHEN 'fr' THEN p_claimant || ' a battu votre record'
        WHEN 'de' THEN p_claimant || ' hat deinen Rekord geschlagen'
        WHEN 'pt' THEN p_claimant || ' bateu sua marca'
        WHEN 'it' THEN p_claimant || ' ha battuto il tuo record'
        WHEN 'ja' THEN p_claimant || 'があなたの記録を破りました'
        WHEN 'ko' THEN p_claimant || '님이 당신의 기록을 깼어요'
        WHEN 'zh' THEN p_claimant || ' 打破了你的记录'
        WHEN 'ar' THEN p_claimant || ' حطّم رقمك القياسي'
        WHEN 'hi' THEN p_claimant || ' ने आपका रिकॉर्ड तोड़ दिया'
        WHEN 'ru' THEN p_claimant || ' побил(а) ваш рекорд'
        WHEN 'tr' THEN p_claimant || ' rekorunu kırdı'
        WHEN 'pl' THEN p_claimant || ' pobił(a) twój rekord'
        WHEN 'nl' THEN p_claimant || ' heeft je record verbroken'
        ELSE              p_claimant || ' beat your record'
      END,
    'body',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN 'Recuperá tu corona con tu próxima sesión.'
        WHEN 'fr' THEN 'Reprenez votre couronne lors de votre prochaine séance.'
        WHEN 'de' THEN 'Hol dir deine Krone zurück in der nächsten Einheit.'
        WHEN 'pt' THEN 'Recupere sua coroa no próximo treino.'
        WHEN 'it' THEN 'Riprenditi la corona alla prossima sessione.'
        WHEN 'ja' THEN '次のセッションで王座を取り戻しましょう。'
        WHEN 'ko' THEN '다음 세션에서 왕좌를 되찾으세요.'
        WHEN 'zh' THEN '下一次训练夺回你的桂冠。'
        WHEN 'ar' THEN 'استعد تاجك في جلستك القادمة.'
        WHEN 'hi' THEN 'अगले सेशन में अपना ताज वापस लें।'
        WHEN 'ru' THEN 'Верните корону на следующей тренировке.'
        WHEN 'tr' THEN 'Tacını bir sonraki antrenmanda geri al.'
        WHEN 'pl' THEN 'Odzyskaj koronę na następnym treningu.'
        WHEN 'nl' THEN 'Pak je kroon terug in je volgende sessie.'
        ELSE              'Take your crown back on your next session.'
      END
  );
$$;

REVOKE ALL  ON FUNCTION public.bounty_beaten_text(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bounty_beaten_text(TEXT, TEXT) TO authenticated;

-- ── i18n: crew_war_started_text ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crew_war_started_text(
  p_language    TEXT,
  p_opponent    TEXT
) RETURNS JSONB
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN '⚔️ Guerra de crews vs ' || p_opponent
        WHEN 'fr' THEN '⚔️ Guerre de crews contre ' || p_opponent
        WHEN 'de' THEN '⚔️ Crew-Krieg gegen ' || p_opponent
        WHEN 'pt' THEN '⚔️ Guerra de crews contra ' || p_opponent
        WHEN 'it' THEN '⚔️ Guerra tra crew contro ' || p_opponent
        WHEN 'ja' THEN '⚔️ クルー対戦：' || p_opponent
        WHEN 'ko' THEN '⚔️ 크루 워: vs ' || p_opponent
        WHEN 'zh' THEN '⚔️ 战队对战：vs ' || p_opponent
        WHEN 'ar' THEN '⚔️ حرب الفِرَق ضد ' || p_opponent
        WHEN 'hi' THEN '⚔️ क्रू वॉर: vs ' || p_opponent
        WHEN 'ru' THEN '⚔️ Война крю против ' || p_opponent
        WHEN 'tr' THEN '⚔️ Mürettebat savaşı: ' || p_opponent
        WHEN 'pl' THEN '⚔️ Wojna ekip przeciwko ' || p_opponent
        WHEN 'nl' THEN '⚔️ Crew-oorlog tegen ' || p_opponent
        ELSE              '⚔️ Crew war vs ' || p_opponent
      END,
    'body',
      CASE COALESCE(p_language, 'en')
        WHEN 'es' THEN 'Cada sesión esta semana cuenta. ¡Vamos!'
        WHEN 'fr' THEN 'Chaque séance compte cette semaine. C''est parti !'
        WHEN 'de' THEN 'Jede Einheit zählt diese Woche. Auf geht''s!'
        WHEN 'pt' THEN 'Cada treino conta esta semana. Vamos!'
        WHEN 'it' THEN 'Ogni sessione conta questa settimana. Forza!'
        WHEN 'ja' THEN '今週はすべてのセッションが重要。さあ行こう！'
        WHEN 'ko' THEN '이번 주는 모든 세션이 중요해요. 가자!'
        WHEN 'zh' THEN '本周每次训练都至关重要。冲！'
        WHEN 'ar' THEN 'كل جلسة هذا الأسبوع تحتسب. هيا!'
        WHEN 'hi' THEN 'इस हफ़्ते हर सेशन मायने रखता है। चलो!'
        WHEN 'ru' THEN 'Каждая тренировка на этой неделе на счету. Вперёд!'
        WHEN 'tr' THEN 'Bu hafta her seans önemli. Hadi!'
        WHEN 'pl' THEN 'W tym tygodniu liczy się każdy trening. Naprzód!'
        WHEN 'nl' THEN 'Elke sessie deze week telt. Let''s go!'
        ELSE              'Every session this week counts. Let''s go.'
      END
  );
$$;

REVOKE ALL  ON FUNCTION public.crew_war_started_text(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crew_war_started_text(TEXT, TEXT) TO authenticated;

-- ── i18n: crew_war_resolved_text (15 langs × win/loss/tie) ─────────────

CREATE OR REPLACE FUNCTION public.crew_war_resolved_text(
  p_language  TEXT,
  p_opponent  TEXT,
  p_outcome   TEXT  -- 'won' | 'lost' | 'tied' from THIS crew's POV
) RETURNS JSONB
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'title',
      CASE
        WHEN p_outcome = 'won' THEN
          CASE COALESCE(p_language, 'en')
            WHEN 'es' THEN '🏆 Aplastaste a ' || p_opponent || '!'
            WHEN 'fr' THEN '🏆 Vous avez écrasé ' || p_opponent || ' !'
            WHEN 'de' THEN '🏆 Ihr habt ' || p_opponent || ' vernichtet!'
            WHEN 'pt' THEN '🏆 Vocês esmagaram ' || p_opponent || '!'
            WHEN 'it' THEN '🏆 Avete schiacciato ' || p_opponent || '!'
            WHEN 'ja' THEN '🏆 ' || p_opponent || 'を圧倒！'
            WHEN 'ko' THEN '🏆 ' || p_opponent || '를 박살냈어요!'
            WHEN 'zh' THEN '🏆 你们碾压了 ' || p_opponent || '！'
            WHEN 'ar' THEN '🏆 سحقتم ' || p_opponent || '!'
            WHEN 'hi' THEN '🏆 आपने ' || p_opponent || ' को कुचल दिया!'
            WHEN 'ru' THEN '🏆 Вы разгромили ' || p_opponent || '!'
            WHEN 'tr' THEN '🏆 ' || p_opponent || ' ekibini ezdiniz!'
            WHEN 'pl' THEN '🏆 Zmiażdżyliście ' || p_opponent || '!'
            WHEN 'nl' THEN '🏆 Jullie hebben ' || p_opponent || ' verpletterd!'
            ELSE              '🏆 You crushed ' || p_opponent || '!'
          END
        WHEN p_outcome = 'lost' THEN
          CASE COALESCE(p_language, 'en')
            WHEN 'es' THEN '💪 ' || p_opponent || ' ganó esta vez'
            WHEN 'fr' THEN '💪 ' || p_opponent || ' a gagné cette fois'
            WHEN 'de' THEN '💪 ' || p_opponent || ' hat diesmal gewonnen'
            WHEN 'pt' THEN '💪 ' || p_opponent || ' venceu desta vez'
            WHEN 'it' THEN '💪 ' || p_opponent || ' ha vinto stavolta'
            WHEN 'ja' THEN '💪 ' || p_opponent || 'が今回は勝利'
            WHEN 'ko' THEN '💪 이번에는 ' || p_opponent || '의 승리'
            WHEN 'zh' THEN '💪 这次 ' || p_opponent || ' 赢了'
            WHEN 'ar' THEN '💪 ' || p_opponent || ' فاز هذه المرة'
            WHEN 'hi' THEN '💪 इस बार ' || p_opponent || ' जीते'
            WHEN 'ru' THEN '💪 На этот раз победили ' || p_opponent
            WHEN 'tr' THEN '💪 Bu sefer ' || p_opponent || ' kazandı'
            WHEN 'pl' THEN '💪 Tym razem wygrało ' || p_opponent
            WHEN 'nl' THEN '💪 ' || p_opponent || ' heeft deze keer gewonnen'
            ELSE              '💪 ' || p_opponent || ' won this round'
          END
        ELSE  -- tied
          CASE COALESCE(p_language, 'en')
            WHEN 'es' THEN '🤝 Empate con ' || p_opponent
            WHEN 'fr' THEN '🤝 Égalité avec ' || p_opponent
            WHEN 'de' THEN '🤝 Unentschieden gegen ' || p_opponent
            WHEN 'pt' THEN '🤝 Empate com ' || p_opponent
            WHEN 'it' THEN '🤝 Pareggio con ' || p_opponent
            WHEN 'ja' THEN '🤝 ' || p_opponent || 'と引き分け'
            WHEN 'ko' THEN '🤝 ' || p_opponent || '와 무승부'
            WHEN 'zh' THEN '🤝 与 ' || p_opponent || ' 战平'
            WHEN 'ar' THEN '🤝 تعادل مع ' || p_opponent
            WHEN 'hi' THEN '🤝 ' || p_opponent || ' से बराबरी'
            WHEN 'ru' THEN '🤝 Ничья с ' || p_opponent
            WHEN 'tr' THEN '🤝 ' || p_opponent || ' ile berabere'
            WHEN 'pl' THEN '🤝 Remis z ' || p_opponent
            WHEN 'nl' THEN '🤝 Gelijkspel met ' || p_opponent
            ELSE              '🤝 Tied with ' || p_opponent
          END
      END
  );
$$;

REVOKE ALL  ON FUNCTION public.crew_war_resolved_text(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crew_war_resolved_text(TEXT, TEXT, TEXT) TO authenticated;

-- ── notify_bounty_claim_for ────────────────────────────────────────────
-- Called by the bounty claimant immediately after claim_bounty succeeds.
-- The target user learns their record is being chased. Validates the
-- caller is the claimant on the actual bounty row so a stranger can't
-- spam fake claim notifications by guessing bounty IDs.

CREATE OR REPLACE FUNCTION public.notify_bounty_claim_for(p_bounty_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender    UUID := auth.uid();
  v_bounty    public.bounties%ROWTYPE;
  v_email     TEXT;
  v_lang      TEXT;
  v_text      JSONB;
  v_id        UUID;
  v_claimant  TEXT;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_bounty_id IS NULL THEN
    RAISE EXCEPTION 'bounty_id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bounty FROM public.bounties WHERE id = p_bounty_id;
  IF v_bounty IS NULL THEN
    RETURN NULL;
  END IF;
  -- Caller must be the actual claimant; the target should never notify themselves.
  IF v_bounty.claimed_by_id IS DISTINCT FROM v_sender THEN
    RAISE EXCEPTION 'not your claim' USING ERRCODE = '42501';
  END IF;
  IF v_bounty.target_user_id = v_sender THEN
    RETURN NULL;
  END IF;

  SELECT u.email, prof.preferred_language
    INTO v_email, v_lang
    FROM auth.users u
    LEFT JOIN public.user_profiles prof ON prof.id = u.id
   WHERE u.id = v_bounty.target_user_id;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT username INTO v_claimant
    FROM public.user_profiles
   WHERE id = v_sender;

  v_text := public.bounty_claim_text(COALESCE(v_lang, 'en'), COALESCE(v_claimant, 'Someone'));

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (v_bounty.target_user_id,
     v_email,
     'bounty_claim',
     v_text ->> 'title',
     v_text ->> 'body',
     '🎯',
     '/bounties',
     jsonb_build_object(
       'bounty_id',       p_bounty_id,
       'claimant_id',     v_sender,
       'claimant_name',   v_claimant,
       'metric',          v_bounty.metric,
       'exercise_name',   v_bounty.exercise_name,
       'target_value',    v_bounty.target_value
     ))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_bounty_claim_for(UUID) TO authenticated;

-- ── notify_bounty_beaten_for ───────────────────────────────────────────
-- Called by the claimant after complete_bounty_claim succeeds. The
-- target learns their record fell.

CREATE OR REPLACE FUNCTION public.notify_bounty_beaten_for(p_bounty_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender    UUID := auth.uid();
  v_bounty    public.bounties%ROWTYPE;
  v_email     TEXT;
  v_lang      TEXT;
  v_text      JSONB;
  v_id        UUID;
  v_claimant  TEXT;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_bounty_id IS NULL THEN
    RAISE EXCEPTION 'bounty_id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bounty FROM public.bounties WHERE id = p_bounty_id;
  IF v_bounty IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_bounty.claimed_by_id IS DISTINCT FROM v_sender THEN
    RAISE EXCEPTION 'not your claim' USING ERRCODE = '42501';
  END IF;
  IF v_bounty.target_user_id = v_sender THEN
    RETURN NULL;
  END IF;

  SELECT u.email, prof.preferred_language
    INTO v_email, v_lang
    FROM auth.users u
    LEFT JOIN public.user_profiles prof ON prof.id = u.id
   WHERE u.id = v_bounty.target_user_id;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT username INTO v_claimant
    FROM public.user_profiles
   WHERE id = v_sender;

  v_text := public.bounty_beaten_text(COALESCE(v_lang, 'en'), COALESCE(v_claimant, 'Someone'));

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (v_bounty.target_user_id,
     v_email,
     'bounty_beaten',
     v_text ->> 'title',
     v_text ->> 'body',
     '👑',
     '/bounties',
     jsonb_build_object(
       'bounty_id',       p_bounty_id,
       'claimant_id',     v_sender,
       'claimant_name',   v_claimant
     ))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_bounty_beaten_for(UUID) TO authenticated;

-- ── notify_crew_war_started_for ────────────────────────────────────────
-- Fans out to every member of BOTH crews when a matchmaking war
-- becomes active. Designed to be called by the matchmaker — which
-- in this codebase is currently a client-side rendezvous, so we
-- restrict the caller to a participant of one of the two crews
-- (any member can trigger it, and the trigger is idempotent on the
-- war row state).

CREATE OR REPLACE FUNCTION public.notify_crew_war_started_for(p_war_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender    UUID := auth.uid();
  v_war       public.crew_wars%ROWTYPE;
  v_crew_a    public.crews%ROWTYPE;
  v_crew_b    public.crews%ROWTYPE;
  v_member    RECORD;
  v_count     INT := 0;
  v_text      JSONB;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_war_id IS NULL THEN
    RAISE EXCEPTION 'war_id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_war FROM public.crew_wars WHERE id = p_war_id;
  IF v_war IS NULL OR v_war.status <> 'active' OR v_war.crew_a_id IS NULL OR v_war.crew_b_id IS NULL THEN
    RETURN 0;
  END IF;
  -- Caller must be a member of one of the two crews.
  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members
     WHERE user_id = v_sender
       AND crew_id IN (v_war.crew_a_id, v_war.crew_b_id)
  ) THEN
    RAISE EXCEPTION 'not your war' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_crew_a FROM public.crews WHERE id = v_war.crew_a_id;
  SELECT * INTO v_crew_b FROM public.crews WHERE id = v_war.crew_b_id;

  -- Notify crew A members (opponent = crew B)
  FOR v_member IN
    SELECT cm.user_id, up.email, prof.preferred_language
      FROM public.crew_members cm
      JOIN public.user_profiles up   ON up.id = cm.user_id
      LEFT JOIN public.user_profiles prof ON prof.id = cm.user_id
     WHERE cm.crew_id = v_war.crew_a_id
       AND up.email IS NOT NULL
  LOOP
    v_text := public.crew_war_started_text(
      COALESCE(v_member.preferred_language, 'en'),
      COALESCE(v_crew_b.name, 'rival crew')
    );
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_member.user_id, v_member.email, 'crew_war_started',
       v_text ->> 'title', v_text ->> 'body',
       '⚔️', '/hub',
       jsonb_build_object('war_id', p_war_id, 'opponent_crew_id', v_war.crew_b_id));
    v_count := v_count + 1;
  END LOOP;

  -- Notify crew B members (opponent = crew A)
  FOR v_member IN
    SELECT cm.user_id, up.email, prof.preferred_language
      FROM public.crew_members cm
      JOIN public.user_profiles up   ON up.id = cm.user_id
      LEFT JOIN public.user_profiles prof ON prof.id = cm.user_id
     WHERE cm.crew_id = v_war.crew_b_id
       AND up.email IS NOT NULL
  LOOP
    v_text := public.crew_war_started_text(
      COALESCE(v_member.preferred_language, 'en'),
      COALESCE(v_crew_a.name, 'rival crew')
    );
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_member.user_id, v_member.email, 'crew_war_started',
       v_text ->> 'title', v_text ->> 'body',
       '⚔️', '/hub',
       jsonb_build_object('war_id', p_war_id, 'opponent_crew_id', v_war.crew_a_id));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_crew_war_started_for(UUID) TO authenticated;

-- ── notify_crew_war_resolved_for ───────────────────────────────────────
-- Called when a war's status flips to 'completed'. Notifies every
-- member of both crews with the OUTCOME from THEIR crew's POV.

CREATE OR REPLACE FUNCTION public.notify_crew_war_resolved_for(p_war_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender    UUID := auth.uid();
  v_war       public.crew_wars%ROWTYPE;
  v_crew_a    public.crews%ROWTYPE;
  v_crew_b    public.crews%ROWTYPE;
  v_member    RECORD;
  v_count     INT := 0;
  v_outcome   TEXT;
  v_opponent  TEXT;
  v_text      JSONB;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_war_id IS NULL THEN
    RAISE EXCEPTION 'war_id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_war FROM public.crew_wars WHERE id = p_war_id;
  IF v_war IS NULL OR v_war.status <> 'completed' THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members
     WHERE user_id = v_sender
       AND crew_id IN (v_war.crew_a_id, v_war.crew_b_id)
  ) THEN
    RAISE EXCEPTION 'not your war' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_crew_a FROM public.crews WHERE id = v_war.crew_a_id;
  SELECT * INTO v_crew_b FROM public.crews WHERE id = v_war.crew_b_id;

  -- Crew A side
  IF v_war.winner_crew_id IS NULL                    THEN v_outcome := 'tied';
  ELSIF v_war.winner_crew_id = v_war.crew_a_id       THEN v_outcome := 'won';
  ELSE                                                    v_outcome := 'lost'; END IF;
  v_opponent := COALESCE(v_crew_b.name, 'rival crew');

  FOR v_member IN
    SELECT cm.user_id, up.email, prof.preferred_language
      FROM public.crew_members cm
      JOIN public.user_profiles up   ON up.id = cm.user_id
      LEFT JOIN public.user_profiles prof ON prof.id = cm.user_id
     WHERE cm.crew_id = v_war.crew_a_id
       AND up.email IS NOT NULL
  LOOP
    v_text := public.crew_war_resolved_text(
      COALESCE(v_member.preferred_language, 'en'), v_opponent, v_outcome);
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_member.user_id, v_member.email, 'crew_war_resolved',
       v_text ->> 'title', NULL,
       CASE v_outcome WHEN 'won' THEN '🏆' WHEN 'lost' THEN '💪' ELSE '🤝' END,
       '/hub',
       jsonb_build_object('war_id', p_war_id, 'outcome', v_outcome,
                          'opponent_crew_id', v_war.crew_b_id,
                          'crew_a_score', v_war.crew_a_score,
                          'crew_b_score', v_war.crew_b_score));
    v_count := v_count + 1;
  END LOOP;

  -- Crew B side
  IF v_war.winner_crew_id IS NULL                    THEN v_outcome := 'tied';
  ELSIF v_war.winner_crew_id = v_war.crew_b_id       THEN v_outcome := 'won';
  ELSE                                                    v_outcome := 'lost'; END IF;
  v_opponent := COALESCE(v_crew_a.name, 'rival crew');

  FOR v_member IN
    SELECT cm.user_id, up.email, prof.preferred_language
      FROM public.crew_members cm
      JOIN public.user_profiles up   ON up.id = cm.user_id
      LEFT JOIN public.user_profiles prof ON prof.id = cm.user_id
     WHERE cm.crew_id = v_war.crew_b_id
       AND up.email IS NOT NULL
  LOOP
    v_text := public.crew_war_resolved_text(
      COALESCE(v_member.preferred_language, 'en'), v_opponent, v_outcome);
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_member.user_id, v_member.email, 'crew_war_resolved',
       v_text ->> 'title', NULL,
       CASE v_outcome WHEN 'won' THEN '🏆' WHEN 'lost' THEN '💪' ELSE '🤝' END,
       '/hub',
       jsonb_build_object('war_id', p_war_id, 'outcome', v_outcome,
                          'opponent_crew_id', v_war.crew_a_id,
                          'crew_a_score', v_war.crew_a_score,
                          'crew_b_score', v_war.crew_b_score));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_crew_war_resolved_for(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
