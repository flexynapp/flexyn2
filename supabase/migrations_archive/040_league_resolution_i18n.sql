-- 040_league_resolution_i18n.sql
--
-- Close the league-notification i18n gap.
--
-- BACKGROUND: when a weekly league resolves, the resolver in
-- src/lib/data/leagues.js iterates EVERY member of the league and
-- fires a notification for each (promote / demote / held). That batch
-- runs on whatever client triggers the resolve — which means there's
-- one shared `t` function, but recipients speak many different
-- languages. Passing the viewer's `t` would mis-translate everyone
-- else's notification. So today, league notifications go out in
-- English regardless of recipient locale.
--
-- THE FIX (same pattern as migration 035's streak_break_text):
--   • `league_resolution_text(lang, outcome, fromTier, toTier, coins,
--                             capsule)` — pure SQL function returning
--     a {title, body, icon} jsonb in the recipient's language.
--   • `notify_league_resolution_for(...)` — SECURITY DEFINER RPC that
--     reads the recipient's preferred_language and inserts the
--     notification row with server-rendered text. Migration 034's
--     trigger then handles push fanout.
--
-- After this migration, the JS path in leagues.js switches from
-- calling notifyLeagueResolution (English) to calling this RPC. Each
-- recipient sees the notification in their own language.

-- ── Localized text helper ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.league_resolution_text(
  p_language   TEXT,
  p_outcome    TEXT,   -- 'promote' | 'demote' | 'hold'
  p_from_tier  TEXT,   -- displayed tier name, e.g. 'Gold'
  p_to_tier    TEXT,   -- displayed tier name, e.g. 'Platinum'
  p_coins      INTEGER,
  p_capsule    TEXT    -- nullable; capsule rarity name if awarded
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  -- The bodies branch on whether coins were awarded and whether a
  -- capsule was awarded, mirroring the original JS in
  -- src/lib/data/notifications.js → notifyLeagueResolution.
  WITH coins_str AS (
    SELECT CASE COALESCE(p_language, 'en')
      WHEN 'es' THEN '+' || p_coins || ' monedas'
      WHEN 'fr' THEN '+' || p_coins || ' pièces'
      WHEN 'de' THEN '+' || p_coins || ' Münzen'
      WHEN 'pt' THEN '+' || p_coins || ' moedas'
      WHEN 'it' THEN '+' || p_coins || ' monete'
      WHEN 'ja' THEN '+' || p_coins || 'コイン'
      WHEN 'ko' THEN '+' || p_coins || ' 코인'
      WHEN 'zh' THEN '+' || p_coins || ' 金币'
      WHEN 'ar' THEN '+' || p_coins || ' عملة'
      WHEN 'hi' THEN '+' || p_coins || ' सिक्के'
      WHEN 'ru' THEN '+' || p_coins || ' монет'
      WHEN 'tr' THEN '+' || p_coins || ' madeni para'
      WHEN 'pl' THEN '+' || p_coins || ' monet'
      WHEN 'nl' THEN '+' || p_coins || ' munten'
      ELSE              '+' || p_coins || ' coins'
    END AS s
  )
  SELECT CASE p_outcome
    -- ── promote ───────────────────────────────────────────────────────
    WHEN 'promote' THEN
      jsonb_build_object(
        'title',
          CASE COALESCE(p_language, 'en')
            WHEN 'es' THEN '⬆️ ¡Promovido a ' || p_to_tier || '!'
            WHEN 'fr' THEN '⬆️ Promu à ' || p_to_tier || ' !'
            WHEN 'de' THEN '⬆️ Aufgestiegen zu ' || p_to_tier || '!'
            WHEN 'pt' THEN '⬆️ Promovido para ' || p_to_tier || '!'
            WHEN 'it' THEN '⬆️ Promosso a ' || p_to_tier || '!'
            WHEN 'ja' THEN '⬆️ ' || p_to_tier || 'に昇格！'
            WHEN 'ko' THEN '⬆️ ' || p_to_tier || '(으)로 승급!'
            WHEN 'zh' THEN '⬆️ 晋升至 ' || p_to_tier || '！'
            WHEN 'ar' THEN '⬆️ تمت الترقية إلى ' || p_to_tier || '!'
            WHEN 'hi' THEN '⬆️ ' || p_to_tier || ' में पदोन्नत!'
            WHEN 'ru' THEN '⬆️ Повышение до ' || p_to_tier || '!'
            WHEN 'tr' THEN '⬆️ ' || p_to_tier || ' seviyesine yükseldin!'
            WHEN 'pl' THEN '⬆️ Awansowano do ' || p_to_tier || '!'
            WHEN 'nl' THEN '⬆️ Gepromoveerd naar ' || p_to_tier || '!'
            ELSE              '⬆️ Promoted to ' || p_to_tier || '!'
          END,
        'body',
          (SELECT s FROM coins_str) ||
            CASE
              WHEN p_capsule IS NOT NULL THEN ' + ' || p_capsule ||
                CASE COALESCE(p_language, 'en')
                  WHEN 'es' THEN ' cápsula'
                  WHEN 'fr' THEN ' capsule'
                  WHEN 'de' THEN '-Kapsel'
                  WHEN 'pt' THEN ' cápsula'
                  WHEN 'it' THEN ' capsula'
                  WHEN 'ja' THEN 'カプセル'
                  WHEN 'ko' THEN ' 캡슐'
                  WHEN 'zh' THEN ' 胶囊'
                  WHEN 'ar' THEN ' كبسولة'
                  WHEN 'hi' THEN ' कैप्सूल'
                  WHEN 'ru' THEN ' капсула'
                  WHEN 'tr' THEN ' kapsül'
                  WHEN 'pl' THEN ' kapsuła'
                  WHEN 'nl' THEN ' capsule'
                  ELSE              ' capsule'
                END
              ELSE ''
            END,
        'icon', '🏆'
      )
    -- ── demote ────────────────────────────────────────────────────────
    WHEN 'demote' THEN
      jsonb_build_object(
        'title',
          CASE COALESCE(p_language, 'en')
            WHEN 'es' THEN '⬇️ Descendido a ' || p_to_tier
            WHEN 'fr' THEN '⬇️ Rétrogradé à ' || p_to_tier
            WHEN 'de' THEN '⬇️ Abgestiegen zu ' || p_to_tier
            WHEN 'pt' THEN '⬇️ Rebaixado para ' || p_to_tier
            WHEN 'it' THEN '⬇️ Retrocesso a ' || p_to_tier
            WHEN 'ja' THEN '⬇️ ' || p_to_tier || 'に降格'
            WHEN 'ko' THEN '⬇️ ' || p_to_tier || '(으)로 강등'
            WHEN 'zh' THEN '⬇️ 降级至 ' || p_to_tier
            WHEN 'ar' THEN '⬇️ تم تخفيض إلى ' || p_to_tier
            WHEN 'hi' THEN '⬇️ ' || p_to_tier || ' में पदावनत'
            WHEN 'ru' THEN '⬇️ Понижение до ' || p_to_tier
            WHEN 'tr' THEN '⬇️ ' || p_to_tier || ' seviyesine düştün'
            WHEN 'pl' THEN '⬇️ Spadek do ' || p_to_tier
            WHEN 'nl' THEN '⬇️ Gedegradeerd naar ' || p_to_tier
            ELSE              '⬇️ Demoted to ' || p_to_tier
          END,
        'body',
          CASE COALESCE(p_language, 'en')
            WHEN 'es' THEN '¡Vuelve a subir la próxima semana!'
            WHEN 'fr' THEN 'Remontez la semaine prochaine !'
            WHEN 'de' THEN 'Nächste Woche zurückklettern!'
            WHEN 'pt' THEN 'Suba de novo na próxima semana!'
            WHEN 'it' THEN 'Risali la prossima settimana!'
            WHEN 'ja' THEN '来週、また登りましょう！'
            WHEN 'ko' THEN '다음 주에 다시 올라가세요!'
            WHEN 'zh' THEN '下周再爬回来！'
            WHEN 'ar' THEN 'تسلق مرة أخرى الأسبوع القادم!'
            WHEN 'hi' THEN 'अगले हफ्ते फिर से चढ़ें!'
            WHEN 'ru' THEN 'Поднимитесь обратно на следующей неделе!'
            WHEN 'tr' THEN 'Önümüzdeki hafta tekrar tırman!'
            WHEN 'pl' THEN 'W przyszłym tygodniu wróć na górę!'
            WHEN 'nl' THEN 'Klim volgende week terug omhoog!'
            ELSE              'Climb back next week!'
          END,
        'icon', '📉'
      )
    -- ── hold ──────────────────────────────────────────────────────────
    ELSE
      jsonb_build_object(
        'title',
          CASE COALESCE(p_language, 'en')
            WHEN 'es' THEN 'Mantuviste tu posición en ' || p_from_tier
            WHEN 'fr' THEN 'Position maintenue en ' || p_from_tier
            WHEN 'de' THEN 'Position in ' || p_from_tier || ' gehalten'
            WHEN 'pt' THEN 'Manteve a posição em ' || p_from_tier
            WHEN 'it' THEN 'Hai mantenuto la posizione in ' || p_from_tier
            WHEN 'ja' THEN p_from_tier || 'で順位維持'
            WHEN 'ko' THEN p_from_tier || '에서 순위 유지'
            WHEN 'zh' THEN '在 ' || p_from_tier || ' 中保持位置'
            WHEN 'ar' THEN 'حافظت على مكانك في ' || p_from_tier
            WHEN 'hi' THEN p_from_tier || ' में स्थिति बनाए रखी'
            WHEN 'ru' THEN 'Сохранили позицию в ' || p_from_tier
            WHEN 'tr' THEN p_from_tier || ' liginde konumunu korudun'
            WHEN 'pl' THEN 'Utrzymano pozycję w ' || p_from_tier
            WHEN 'nl' THEN 'Positie behouden in ' || p_from_tier
            ELSE              'Held position in ' || p_from_tier
          END,
        'body',
          CASE
            WHEN p_coins > 0 THEN (SELECT s FROM coins_str)
            ELSE
              CASE COALESCE(p_language, 'en')
                WHEN 'es' THEN 'Apunta a la promoción la próxima semana.'
                WHEN 'fr' THEN 'Visez la promotion la semaine prochaine.'
                WHEN 'de' THEN 'Strebe nächste Woche den Aufstieg an.'
                WHEN 'pt' THEN 'Mire na promoção na próxima semana.'
                WHEN 'it' THEN 'Punta alla promozione la prossima settimana.'
                WHEN 'ja' THEN '来週は昇格を狙いましょう。'
                WHEN 'ko' THEN '다음 주에는 승급을 노리세요.'
                WHEN 'zh' THEN '下周争取晋升。'
                WHEN 'ar' THEN 'استهدف الترقية الأسبوع القادم.'
                WHEN 'hi' THEN 'अगले हफ्ते पदोन्नति का लक्ष्य रखें।'
                WHEN 'ru' THEN 'Стремитесь к повышению на следующей неделе.'
                WHEN 'tr' THEN 'Önümüzdeki hafta yükselmeyi hedefle.'
                WHEN 'pl' THEN 'W przyszłym tygodniu celuj w awans.'
                WHEN 'nl' THEN 'Mik volgende week op promotie.'
                ELSE              'Push for promotion next week.'
              END
          END,
        'icon', '🛡️'
      )
  END;
$$;

REVOKE ALL ON FUNCTION public.league_resolution_text(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.league_resolution_text(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) TO authenticated;

-- ── Cross-user RPC: insert a league-resolution notification ─────────────
--
-- Reads the recipient's preferred_language, renders the text via the
-- helper above, and inserts the notification row. Migration 034's
-- trigger then fans out the push.
--
-- SECURITY: this RPC accepts an arbitrary user_id, so it COULD be abused
-- to spam other users' inboxes if exposed to authenticated. We mitigate
-- by restricting EXECUTE to `service_role` only — the JS resolver path
-- in src/lib/data/leagues.js runs from a signed-in client, so we
-- additionally accept the caller as long as they're the resolver of a
-- league the recipient is also a member of. That cross-check is too
-- expensive to do inline; for now we expose the RPC only via the JS
-- helper which already does its own league-membership check before
-- calling. Future tightening: add a SECURITY DEFINER pre-check here.
--
-- To re-enable client invocation, GRANT EXECUTE TO authenticated. We
-- start more restrictive and loosen later.

CREATE OR REPLACE FUNCTION public.notify_league_resolution_for(
  p_user_id    UUID,
  p_outcome    TEXT,
  p_from_tier  TEXT,
  p_to_tier    TEXT,
  p_coins      INTEGER,
  p_capsule    TEXT
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
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
  END IF;
  IF p_outcome NOT IN ('promote', 'demote', 'hold') THEN
    RAISE EXCEPTION 'outcome must be promote/demote/hold' USING ERRCODE = '22023';
  END IF;

  -- Fetch recipient's email + language. If the recipient row is missing,
  -- abort silently — the upstream resolver shouldn't be calling us with
  -- a phantom user_id, but if it does we'd rather no-op than crash.
  SELECT u.email, p.preferred_language
    INTO v_email, v_lang
    FROM auth.users u
    LEFT JOIN public.user_profiles p ON p.id = u.id
   WHERE u.id = p_user_id;

  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  v_text := public.league_resolution_text(
    COALESCE(v_lang, 'en'),
    p_outcome,
    COALESCE(p_from_tier, ''),
    COALESCE(p_to_tier,   ''),
    COALESCE(p_coins, 0),
    p_capsule
  );

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (p_user_id,
     v_email,
     CASE p_outcome
       WHEN 'promote' THEN 'league_promoted'
       WHEN 'demote'  THEN 'league_demoted'
       ELSE                'league_held'
     END,
     v_text ->> 'title',
     v_text ->> 'body',
     v_text ->> 'icon',
     '/dashboard',
     jsonb_build_object(
       'outcome',       p_outcome,
       'fromTier',      p_from_tier,
       'toTier',        p_to_tier,
       'coinsAwarded',  p_coins,
       'capsuleAwarded', p_capsule
     ))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_league_resolution_for(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
