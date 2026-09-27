-- Past You and the Rival month bonus notify in the user's language.
--
-- The language audit (2026-09-27) found every Past You notice was English
-- for everyone: the weekly result, the day 3 and day 5 checkpoints, both
-- nudges, and (new since) the monthly bonus. Duels already reads
-- user_profiles.preferred_language; these now do the same.
--
-- Released locales only: en, es, fr. Every other language, and a NULL
-- preference, gets English, which is what the app itself shows them. No
-- machine translation of shelved locales (CLAUDE.md i18n rules).
--
-- Numbers follow the language too: 7,000 lb in English, 7.000 lb in
-- Spanish, 7 000 lb in French. Levels stay "Lv. N" in every language
-- (design decision 2026-09-27).
--
-- Only the text changes. Every body below is the installed one, read with
-- pg_get_functiondef, with its title and body swapped for a lookup. Payouts,
-- checks and metadata are byte for byte what production runs.

-- ── Helpers ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.past_you_lang(p_uid UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT CASE WHEN l IN ('es', 'fr') THEN l ELSE 'en' END
    FROM (SELECT lower(left(COALESCE(
            (SELECT preferred_language FROM public.user_profiles WHERE id = p_uid), 'en'), 2)) AS l) s;
$$;

-- Re-punctuates an English-formatted number ("7,000.5") for the language.
CREATE OR REPLACE FUNCTION public.past_you_num(p_lang TEXT, p_en TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT CASE p_lang
    WHEN 'es' THEN translate(p_en, ',.', '.,')
    WHEN 'fr' THEN translate(p_en, ',.', U&'\00A0,')
    ELSE p_en END;
$$;

CREATE OR REPLACE FUNCTION public.past_you_fmt(p_type TEXT, p_v NUMERIC, p_lang TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT public.past_you_num(p_lang, public.past_you_fmt(p_type, p_v));
$$;

-- "+100 XP, +10 coins, 1 capsule. " in the language, or NULL when nothing landed.
CREATE OR REPLACE FUNCTION public.past_you_paid(p_lang TEXT, p_xp NUMERIC, p_coins NUMERIC, p_caps INTEGER)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT CASE WHEN s = '' THEN NULL ELSE s || '. ' END
    FROM (SELECT concat_ws(', ',
      CASE WHEN COALESCE(p_xp, 0) > 0
        THEN '+' || public.past_you_num(p_lang, to_char(p_xp, 'FM999,999,990')) || ' XP' END,
      CASE WHEN COALESCE(p_coins, 0) > 0
        THEN '+' || public.past_you_num(p_lang, to_char(round(p_coins), 'FM999,999,990')) || ' '
             || CASE p_lang WHEN 'es' THEN 'monedas' WHEN 'fr' THEN 'pièces' ELSE 'coins' END END,
      CASE WHEN COALESCE(p_caps, 0) > 0
        THEN p_caps || ' ' || CASE
          WHEN p_lang IN ('es', 'fr') THEN CASE WHEN p_caps = 1 THEN 'Capsule' ELSE 'Capsules' END
          ELSE CASE WHEN p_caps = 1 THEN 'capsule' ELSE 'capsules' END END END) AS s) x;
$$;

CREATE OR REPLACE FUNCTION public.past_you_month_name(p_lang TEXT, p_month DATE)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT CASE p_lang
    WHEN 'es' THEN (ARRAY['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                          'septiembre','octubre','noviembre','diciembre'])[extract(month FROM p_month)::int]
    WHEN 'fr' THEN (ARRAY['janvier','février','mars','avril','mai','juin','juillet','août',
                          'septembre','octobre','novembre','décembre'])[extract(month FROM p_month)::int]
    ELSE (ARRAY['January','February','March','April','May','June','July','August',
                'September','October','November','December'])[extract(month FROM p_month)::int] END;
$$;

REVOKE ALL ON FUNCTION public.past_you_lang(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.past_you_num(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.past_you_fmt(text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.past_you_paid(text, numeric, numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.past_you_month_name(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_lang(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.past_you_num(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.past_you_fmt(text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.past_you_paid(text, numeric, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.past_you_month_name(text, date) TO service_role;

-- ── Weekly result ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.past_you_settle_match(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  m public.past_you_matches%ROWTYPE;
  v_score NUMERIC; v_won BOOLEAN; v_prs INTEGER; v_next INTEGER; v_goals JSONB; v_met INTEGER;
  v_you TEXT; v_goal TEXT; v_email TEXT; v_paid TEXT; v_lang TEXT;
  v_xp0 BIGINT; v_xp1 BIGINT; v_c0 NUMERIC; v_c1 NUMERIC;
BEGIN
  SELECT * INTO m FROM public.past_you_matches
   WHERE id = p_id AND status = 'active' AND ends_at <= now()
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  v_score := public.gym_rival_score(m.user_id, m.rival_type, m.started_at, m.ends_at);
  v_won   := v_score >= m.target;
  v_prs   := public.past_you_pr_count(m.user_id, m.rival_type, m.started_at, m.ends_at);
  v_next  := LEAST(20, GREATEST(1, m.level + CASE WHEN v_won THEN 1 ELSE -1 END + LEAST(v_prs, 2)));
  v_goals := public.past_you_objectives(m.user_id, m.rival_type, m.started_at, m.ends_at);
  SELECT count(*) INTO v_met FROM jsonb_array_elements(v_goals) g WHERE (g->>'done')::boolean;
  v_lang := public.past_you_lang(m.user_id);
  v_you  := public.past_you_fmt(m.rival_type, v_score, v_lang);
  v_goal := public.past_you_fmt(m.rival_type, m.target, v_lang);

  UPDATE public.past_you_matches
     SET status = 'completed', final_score = v_score, won = v_won, prs = v_prs,
         next_level = v_next, objectives = v_goals, settled_at = now()
   WHERE id = m.id;

  SELECT email INTO v_email FROM auth.users WHERE id = m.user_id;

  IF v_won OR v_met > 0 THEN
    SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp0, v_c0
      FROM public.user_profiles WHERE id = m.user_id;
    PERFORM public.award_xp_internal(m.user_id, CASE WHEN v_won THEN 1000 ELSE 0 END + 150 * v_met);
    UPDATE public.user_profiles
       SET flex_coins = COALESCE(flex_coins, 0) + CASE WHEN v_won THEN 100 ELSE 0 END + 15 * v_met
     WHERE id = m.user_id;
    IF v_won THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (m.user_id, v_email, 'standard');
    END IF;
    SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp1, v_c1
      FROM public.user_profiles WHERE id = m.user_id;
    v_paid := public.past_you_paid(v_lang, v_xp1 - v_xp0, v_c1 - v_c0, CASE WHEN v_won THEN 1 ELSE 0 END);
  END IF;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (m.user_id, v_email, 'nemesis_overthrown',
    CASE v_lang
      WHEN 'es' THEN CASE WHEN v_won THEN '🏆 Venciste a Past You' ELSE 'Past You aguantó esta semana' END
      WHEN 'fr' THEN CASE WHEN v_won THEN '🏆 Vous avez battu Past You' ELSE 'Past You a tenu bon cette semaine' END
      ELSE CASE WHEN v_won THEN '🏆 You beat Past You' ELSE 'Past You held on this week' END
    END,
    CASE v_lang
      WHEN 'es' THEN 'Registraste ' || v_you || ' frente a un objetivo de ' || v_goal || '. '
        || v_met || ' de 3 metas semanales cumplidas. ' || COALESCE(v_paid, '')
        || 'Past You será Lv. ' || v_next || ' la próxima semana.'
      WHEN 'fr' THEN 'Vous avez enregistré ' || v_you || ' pour un objectif de ' || v_goal || '. '
        || v_met || ' objectifs hebdomadaires sur 3 atteints. ' || COALESCE(v_paid, '')
        || 'Past You sera Lv. ' || v_next || ' la semaine prochaine.'
      ELSE 'You logged ' || v_you || ' against a target of ' || v_goal || '. '
        || v_met || ' of 3 weekly goals met. ' || COALESCE(v_paid, '')
        || 'Past You is Lv. ' || v_next || ' next week.'
    END,
    CASE WHEN v_won THEN '🏆' ELSE '👻' END, '/workout',
    jsonb_build_object('past_you_id', m.id, 'result', CASE WHEN v_won THEN 'past_you_win' ELSE 'past_you_loss' END,
                       'prs', v_prs, 'next_level', v_next, 'goals_met', v_met));
  RETURN TRUE;
END;
$function$;

-- ── Day 3 and day 5 checkpoints ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.past_you_checkpoint_match(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  c_days CONSTANT INTEGER[] := ARRAY[3, 5];
  m public.past_you_matches%ROWTYPE;
  k INTEGER; v_day INTEGER; v_next INTEGER; v_at TIMESTAMPTZ;
  v_score NUMERIC; v_pace NUMERIC; v_hit BOOLEAN;
  v_email TEXT; v_paid TEXT; v_lang TEXT; v_s TEXT; v_p TEXT;
  v_xp0 BIGINT; v_xp1 BIGINT; v_c0 NUMERIC; v_c1 NUMERIC;
BEGIN
  SELECT * INTO m FROM public.past_you_matches
   WHERE id = p_id AND status = 'active'
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  k := jsonb_array_length(m.checkpoints);
  IF k >= array_length(c_days, 1) THEN RETURN FALSE; END IF;
  v_day := c_days[k + 1];
  v_at  := m.started_at + make_interval(days => v_day);
  IF v_at > now() OR v_at >= m.ends_at THEN RETURN FALSE; END IF;

  v_score := public.gym_rival_score(m.user_id, m.rival_type, m.started_at, v_at);
  v_pace  := round(m.target * v_day / 7.0);
  v_hit   := v_score >= v_pace;
  v_next  := CASE WHEN k + 2 <= array_length(c_days, 1) THEN c_days[k + 2] ELSE 7 END;

  SELECT email INTO v_email FROM auth.users WHERE id = m.user_id;
  v_lang := public.past_you_lang(m.user_id);
  v_s := public.past_you_fmt(m.rival_type, v_score, v_lang);
  v_p := public.past_you_fmt(m.rival_type, v_pace, v_lang);

  IF v_hit THEN
    SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp0, v_c0
      FROM public.user_profiles WHERE id = m.user_id;
    PERFORM public.award_xp_internal(m.user_id, 100);
    UPDATE public.user_profiles SET flex_coins = COALESCE(flex_coins, 0) + 10 WHERE id = m.user_id;
    SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp1, v_c1
      FROM public.user_profiles WHERE id = m.user_id;
    v_paid := public.past_you_paid(v_lang, v_xp1 - v_xp0, v_c1 - v_c0, 0);
  END IF;

  UPDATE public.past_you_matches
     SET checkpoints = checkpoints || jsonb_build_array(jsonb_build_object(
           'day', v_day, 'at', v_at, 'score', v_score, 'pace', v_pace, 'hit', v_hit,
           'xp', COALESCE(v_xp1 - v_xp0, 0), 'coins', COALESCE(round(v_c1 - v_c0), 0)))
   WHERE id = m.id;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (m.user_id, v_email, 'past_you_checkpoint',
    CASE v_lang
      WHEN 'es' THEN CASE WHEN v_hit THEN 'Control del día ' || v_day || ' superado'
                          ELSE 'Past You va por delante en el día ' || v_day END
      WHEN 'fr' THEN CASE WHEN v_hit THEN 'Point de contrôle du jour ' || v_day || ' validé'
                          ELSE 'Past You mène au jour ' || v_day END
      ELSE CASE WHEN v_hit THEN 'Day ' || v_day || ' checkpoint cleared'
                ELSE 'Past You is ahead on day ' || v_day END
    END,
    CASE v_lang
      WHEN 'es' THEN CASE WHEN v_hit
        THEN 'Vas al ritmo con ' || v_s || '. ' || COALESCE(v_paid, '')
             || CASE WHEN v_next < 7 THEN 'Próximo control el día ' || v_next || '.' ELSE 'La carrera termina el día 7.' END
        ELSE 'Llevas ' || v_s || ' y el ritmo de Past You era ' || v_p || '. '
             || CASE WHEN v_next < 7 THEN 'Recupera antes del control del día ' || v_next || '.'
                     ELSE 'Aún tienes hasta el día 7 para superar el objetivo.' END
      END
      WHEN 'fr' THEN CASE WHEN v_hit
        THEN 'Vous suivez le rythme avec ' || v_s || '. ' || COALESCE(v_paid, '')
             || CASE WHEN v_next < 7 THEN 'Prochain point de contrôle au jour ' || v_next || '.' ELSE 'La course se termine au jour 7.' END
        ELSE 'Vous avez ' || v_s || ', le rythme de Past You était de ' || v_p || '. '
             || CASE WHEN v_next < 7 THEN 'Rattrapez votre retard avant le point de contrôle du jour ' || v_next || '.'
                     ELSE 'Vous avez jusqu''au jour 7 pour dépasser l''objectif.' END
      END
      ELSE CASE WHEN v_hit
        THEN 'You''re on pace with ' || v_s || '. ' || COALESCE(v_paid, '')
             || CASE WHEN v_next < 7 THEN 'Next checkpoint on day ' || v_next || '.' ELSE 'The race ends on day 7.' END
        ELSE 'You have ' || v_s || ', Past You''s pace was ' || v_p || '. '
             || CASE WHEN v_next < 7 THEN 'Catch up before the day ' || v_next || ' checkpoint.'
                     ELSE 'You still have until day 7 to beat the target.' END
      END
    END,
    CASE WHEN v_hit THEN '✅' ELSE '👻' END, '/workout',
    jsonb_build_object('past_you_id', m.id, 'checkpoint_day', v_day, 'hit', v_hit));
  RETURN TRUE;
END;
$function$;

-- ── Nudges ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.past_you_nudge_active(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  m public.past_you_matches%ROWTYPE;
  v_score NUMERIC; v_pace NUMERIC; v_days INTEGER; v_email TEXT; v_lang TEXT; v_gap TEXT;
BEGIN
  SELECT * INTO m FROM public.past_you_matches
   WHERE id = p_id AND status = 'active'
     AND ends_at - now() > interval '24 hours'
     AND started_at <= now() - interval '48 hours'
     AND (last_nudge_at IS NULL OR last_nudge_at <= now() - interval '48 hours')
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF NOT public.past_you_local_daytime(m.user_id) THEN RETURN FALSE; END IF;
  IF public.gym_rival_has_logged(m.user_id, 'gym', now() - interval '48 hours', now())
     OR public.gym_rival_has_logged(m.user_id, 'cardio', now() - interval '48 hours', now()) THEN
    RETURN FALSE;
  END IF;

  v_score := public.gym_rival_score(m.user_id, m.rival_type, m.started_at, now());
  v_pace  := round(m.target * LEAST(1, extract(epoch FROM now() - m.started_at)
                                      / extract(epoch FROM m.ends_at - m.started_at)));
  v_days  := GREATEST(1, ceil(extract(epoch FROM m.ends_at - now()) / 86400)::int);
  v_lang  := public.past_you_lang(m.user_id);
  v_gap   := public.past_you_fmt(m.rival_type, v_pace - v_score, v_lang);

  UPDATE public.past_you_matches SET last_nudge_at = now() WHERE id = m.id;
  SELECT email INTO v_email FROM auth.users WHERE id = m.user_id;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (m.user_id, v_email, 'past_you_nudge',
    CASE v_lang
      WHEN 'es' THEN CASE WHEN v_score < v_pace THEN 'Past You se está adelantando' ELSE 'Past You te está alcanzando' END
      WHEN 'fr' THEN CASE WHEN v_score < v_pace THEN 'Past You prend de l''avance' ELSE 'Past You vous rattrape' END
      ELSE CASE WHEN v_score < v_pace THEN 'Past You is pulling ahead' ELSE 'Past You is catching up' END
    END,
    CASE v_lang
      WHEN 'es' THEN CASE WHEN v_score < v_pace
          THEN 'Vas ' || v_gap || ' por detrás de su ritmo. '
          ELSE 'Sigues por delante, pero entrena todos los días. ' END
        || CASE WHEN v_days = 1 THEN 'Queda 1 día de carrera.' ELSE 'Quedan ' || v_days || ' días de carrera.' END
      WHEN 'fr' THEN CASE WHEN v_score < v_pace
          THEN 'Vous avez ' || v_gap || ' de retard sur son rythme. '
          ELSE 'Vous êtes encore devant, mais il s''entraîne tous les jours. ' END
        || CASE WHEN v_days = 1 THEN 'Il reste 1 jour de course.' ELSE 'Il reste ' || v_days || ' jours de course.' END
      ELSE CASE WHEN v_score < v_pace
          THEN 'You''re ' || v_gap || ' behind its pace. '
          ELSE 'You''re still ahead, but it trains every day. ' END
        || v_days || CASE WHEN v_days = 1 THEN ' day' ELSE ' days' END || ' left in the race.'
    END,
    '👻', '/workout',
    jsonb_build_object('past_you_id', m.id, 'nudge', 'inactive'));
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.past_you_nudge_rematch(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  m public.past_you_matches%ROWTYPE;
  v_email TEXT; v_lang TEXT; v_lv INTEGER;
BEGIN
  SELECT * INTO m FROM public.past_you_matches
   WHERE id = p_id AND status = 'completed' AND last_nudge_at IS NULL
     AND settled_at <= now() - interval '48 hours'
     AND settled_at >  now() - interval '14 days'
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- A newer race of either kind means they already came back.
  IF EXISTS (SELECT 1 FROM public.past_you_matches
              WHERE user_id = m.user_id AND started_at > m.started_at)
     OR EXISTS (SELECT 1 FROM public.gym_rival_assignments
                 WHERE (user_id = m.user_id OR rival_id = m.user_id)
                   AND status IN ('pending', 'active')) THEN
    UPDATE public.past_you_matches SET last_nudge_at = now() WHERE id = m.id;
    RETURN FALSE;
  END IF;
  IF NOT public.past_you_local_daytime(m.user_id) THEN RETURN FALSE; END IF;

  UPDATE public.past_you_matches SET last_nudge_at = now() WHERE id = m.id;
  SELECT email INTO v_email FROM auth.users WHERE id = m.user_id;
  v_lang := public.past_you_lang(m.user_id);
  v_lv   := COALESCE(m.next_level, m.level);

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (m.user_id, v_email, 'past_you_nudge',
    CASE v_lang WHEN 'es' THEN 'Past You te espera' WHEN 'fr' THEN 'Past You vous attend'
                ELSE 'Past You is waiting' END,
    CASE v_lang
      WHEN 'es' THEN 'Lv. ' || v_lv || ' está listo para la revancha. Empieza una nueva carrera esta semana.'
      WHEN 'fr' THEN 'Lv. ' || v_lv || ' est prêt pour la revanche. Lancez une nouvelle course cette semaine.'
      ELSE 'Lv. ' || v_lv || ' is ready for a rematch. Start a new race this week.'
    END,
    '👻', '/workout',
    jsonb_build_object('past_you_id', m.id, 'nudge', 'rematch'));
  RETURN TRUE;
END;
$function$;

-- ── Monthly bonus ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rival_pay_month(p_uid uuid, p_month date)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_wins INTEGER; v_email TEXT; v_lang TEXT;
  v_xp0 BIGINT; v_xp1 BIGINT; v_c0 NUMERIC; v_c1 NUMERIC;
BEGIN
  v_wins := public.rival_month_wins(p_uid, p_month);
  IF v_wins < 3 THEN RETURN FALSE; END IF;

  INSERT INTO public.rival_month_bonuses (user_id, month, wins)
  VALUES (p_uid, p_month, v_wins)
  ON CONFLICT (user_id, month) DO NOTHING;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_uid;
  SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp0, v_c0 FROM public.user_profiles WHERE id = p_uid;
  PERFORM public.award_xp_internal(p_uid, 2000);
  UPDATE public.user_profiles SET flex_coins = COALESCE(flex_coins, 0) + 200 WHERE id = p_uid;
  INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
  SELECT p_uid, v_email, 'standard' FROM generate_series(1, 2);
  SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp1, v_c1 FROM public.user_profiles WHERE id = p_uid;

  UPDATE public.rival_month_bonuses
     SET xp = (v_xp1 - v_xp0)::int, coins = round(v_c1 - v_c0)::int, capsules = 2
   WHERE user_id = p_uid AND month = p_month;

  v_lang := public.past_you_lang(p_uid);
  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_uid, v_email, 'rival_month_bonus',
    '🏆 ' || v_wins || CASE v_lang
      WHEN 'es' THEN ' semanas ganadas en '
      WHEN 'fr' THEN ' semaines gagnées en '
      ELSE ' weeks won in ' END || public.past_you_month_name(v_lang, p_month),
    public.past_you_paid(v_lang, v_xp1 - v_xp0, v_c1 - v_c0, 2)
      || CASE v_lang WHEN 'es' THEN 'Empieza un nuevo mes.' WHEN 'fr' THEN 'Un nouveau mois commence.'
                     ELSE 'A new month starts now.' END,
    '🏆', '/workout',
    jsonb_build_object('month', p_month, 'wins', v_wins));
  RETURN TRUE;
END;
$function$;

-- ── Probe (rolled back) ────────────────────────────────────────────────────
-- A Spanish user gets both checkpoints, both nudges and a weekly result; a
-- French user gets the monthly bonus; an unset language stays English.

DO $$
DECLARE
  a UUID := gen_random_uuid();
  f UUID := gen_random_uuid();
  v_mid UUID; v_mid2 UUID; v_mid3 UUID;
  v_off INTEGER;
  v_month DATE := date_trunc('month', now() - interval '3 months')::date;
  t TEXT; b TEXT;
  real JSONB := '[{"name":"Bench Press","sets":[{"weight":"100","reps":"10"},{"weight":"100","reps":"10"},{"weight":"100","reps":"10"}]}]';
BEGIN
  BEGIN
    v_off := (12 - extract(hour FROM now() AT TIME ZONE 'UTC')::int) * 60;
    IF v_off > 720 THEN v_off := v_off - 1440; ELSIF v_off < -720 THEN v_off := v_off + 1440; END IF;

    INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
      (a, 'loc-probe-' || a || '@example.invalid', 'authenticated', 'authenticated', FALSE),
      (f, 'loc-probe-' || f || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email) VALUES
      (a, 'loc-probe-' || a || '@example.invalid'), (f, 'loc-probe-' || f || '@example.invalid')
    ON CONFLICT (id) DO NOTHING;
    UPDATE public.user_profiles SET timezone_offset_minutes = v_off, preferred_language = 'es' WHERE id = a;
    UPDATE public.user_profiles SET timezone_offset_minutes = 0, preferred_language = 'fr' WHERE id = f;

    -- Helpers.
    IF public.past_you_lang(a) <> 'es' OR public.past_you_lang(f) <> 'fr' THEN
      RAISE EXCEPTION 'probe: language lookup wrong';
    END IF;
    UPDATE public.user_profiles SET preferred_language = 'de' WHERE id = f;
    IF public.past_you_lang(f) <> 'en' THEN RAISE EXCEPTION 'probe: shelved locale did not fall back to en'; END IF;
    UPDATE public.user_profiles SET preferred_language = NULL WHERE id = f;
    IF public.past_you_lang(f) <> 'en' THEN RAISE EXCEPTION 'probe: NULL language did not fall back to en'; END IF;
    UPDATE public.user_profiles SET preferred_language = 'fr' WHERE id = f;
    IF public.past_you_fmt('gym', 12345, 'en') <> '12,345 lb'
       OR public.past_you_fmt('gym', 12345, 'es') <> '12.345 lb'
       OR public.past_you_fmt('gym', 12345, 'fr') <> U&'12\00A0345 lb'
       OR public.past_you_fmt('cardio', 5500, 'es') <> '5,5 km' THEN
      RAISE EXCEPTION 'probe: number formatting wrong: % / % / % / %',
        public.past_you_fmt('gym', 12345, 'en'), public.past_you_fmt('gym', 12345, 'es'),
        public.past_you_fmt('gym', 12345, 'fr'), public.past_you_fmt('cardio', 5500, 'es');
    END IF;
    IF public.past_you_paid('es', 1000, 100, 1) <> '+1.000 XP, +100 monedas, 1 Capsule. '
       OR public.past_you_paid('en', 0, 0, 0) IS NOT NULL THEN
      RAISE EXCEPTION 'probe: paid line wrong: %', public.past_you_paid('es', 1000, 100, 1);
    END IF;

    -- Checkpoints: day 3 hit, day 5 miss, in Spanish.
    INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target, started_at, ends_at)
    VALUES (a, 'gym', 1, 7000, 1, 7000, now() - interval '5 days 12 hours', now() + interval '1 day 12 hours')
    RETURNING id INTO v_mid;
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, real, now() - interval '4 days 12 hours');
    PERFORM public.past_you_checkpoint_match(v_mid);
    PERFORM public.past_you_checkpoint_match(v_mid);
    SELECT title, body INTO t, b FROM public.notifications
     WHERE user_id = a AND type = 'past_you_checkpoint' AND (metadata->>'checkpoint_day')::int = 3;
    IF t <> 'Control del día 3 superado'
       OR b <> 'Vas al ritmo con 3.000 lb. +100 XP, +10 monedas. Próximo control el día 5.' THEN
      RAISE EXCEPTION 'probe: day 3 notice wrong: % / %', t, b;
    END IF;
    SELECT title, body INTO t, b FROM public.notifications
     WHERE user_id = a AND type = 'past_you_checkpoint' AND (metadata->>'checkpoint_day')::int = 5;
    IF t <> 'Past You va por delante en el día 5'
       OR b <> 'Llevas 3.000 lb y el ritmo de Past You era 5.000 lb. Aún tienes hasta el día 7 para superar el objetivo.' THEN
      RAISE EXCEPTION 'probe: day 5 notice wrong: % / %', t, b;
    END IF;

    -- Inactive nudge in Spanish (no session in the last 48h).
    UPDATE public.past_you_matches SET status = 'abandoned' WHERE id = v_mid;
    INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target, started_at, ends_at)
    VALUES (a, 'gym', 1, 7000, 1, 7000, now() - interval '3 days 12 hours', now() + interval '3 days 12 hours')
    RETURNING id INTO v_mid2;
    IF NOT public.past_you_nudge_active(v_mid2) THEN RAISE EXCEPTION 'probe: inactive race not nudged'; END IF;
    SELECT title, body INTO t, b FROM public.notifications
     WHERE user_id = a AND type = 'past_you_nudge' AND metadata->>'nudge' = 'inactive';
    IF t <> 'Past You se está adelantando' OR b NOT LIKE 'Vas % lb por detrás de su ritmo. Quedan 4 días de carrera.' THEN
      RAISE EXCEPTION 'probe: inactive nudge wrong: % / %', t, b;
    END IF;

    -- Weekly result in Spanish: the race above, ended now, 3,000 lb against 7,000.
    UPDATE public.past_you_matches SET started_at = now() - interval '7 days', ends_at = now() - interval '1 minute'
     WHERE id = v_mid2;
    IF NOT public.past_you_settle_match(v_mid2) THEN RAISE EXCEPTION 'probe: race not settled'; END IF;
    SELECT title, body INTO t, b FROM public.notifications
     WHERE user_id = a AND metadata->>'past_you_id' = v_mid2::text AND metadata ? 'result';
    IF t <> 'Past You aguantó esta semana'
       OR b NOT LIKE 'Registraste 3.000 lb frente a un objetivo de 7.000 lb. _ de 3 metas semanales cumplidas. %Past You será Lv. _ la próxima semana.' THEN
      RAISE EXCEPTION 'probe: weekly result wrong: % / %', t, b;
    END IF;

    -- Rematch nudge in Spanish. The abandoned race must be the older one,
    -- or it reads as a newer race and suppresses the nudge.
    UPDATE public.past_you_matches SET started_at = now() - interval '10 days' WHERE id = v_mid;
    UPDATE public.past_you_matches SET settled_at = now() - interval '3 days', next_level = 2, last_nudge_at = NULL
     WHERE id = v_mid2;
    IF NOT public.past_you_nudge_rematch(v_mid2) THEN RAISE EXCEPTION 'probe: rematch not nudged'; END IF;
    SELECT title, body INTO t, b FROM public.notifications
     WHERE user_id = a AND type = 'past_you_nudge' AND metadata->>'nudge' = 'rematch';
    IF t <> 'Past You te espera'
       OR b <> 'Lv. 2 está listo para la revancha. Empieza una nueva carrera esta semana.' THEN
      RAISE EXCEPTION 'probe: rematch nudge wrong: % / %', t, b;
    END IF;

    -- Monthly bonus in French: three won races ending mid-month.
    INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target,
                                         started_at, ends_at, status, won, settled_at)
    SELECT f, 'gym', 1, 1, 1, 1, v_month + (i * 7) - 7 + interval '12 hours', v_month + (i * 7) + interval '12 hours',
           'completed', TRUE, v_month + (i * 7) + interval '13 hours'
      FROM generate_series(1, 3) i;
    IF NOT public.rival_pay_month(f, v_month) THEN RAISE EXCEPTION 'probe: month bonus not paid'; END IF;
    SELECT title, body INTO t, b FROM public.notifications WHERE user_id = f AND type = 'rival_month_bonus';
    IF t <> '🏆 3 semaines gagnées en ' || public.past_you_month_name('fr', v_month)
       OR b NOT LIKE '+2%000 XP, +200 pièces, 2 Capsules. Un nouveau mois commence.' THEN
      RAISE EXCEPTION 'probe: month bonus notice wrong: % / %', t, b;
    END IF;

    -- English is unchanged for an unset language.
    UPDATE public.user_profiles SET preferred_language = NULL WHERE id = a;
    INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target, started_at, ends_at)
    VALUES (a, 'gym', 1, 7000, 1, 7000, now() - interval '3 days 1 hour', now() + interval '3 days 23 hours')
    RETURNING id INTO v_mid3;
    PERFORM public.past_you_checkpoint_match(v_mid3);
    SELECT title, body INTO t, b FROM public.notifications
     WHERE user_id = a AND metadata->>'past_you_id' = v_mid3::text;
    IF t <> 'Past You is ahead on day 3'
       OR b <> 'You have 0 lb, Past You''s pace was 3,000 lb. Catch up before the day 5 checkpoint.' THEN
      RAISE EXCEPTION 'probe: English checkpoint wrong: % / %', t, b;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$$;
