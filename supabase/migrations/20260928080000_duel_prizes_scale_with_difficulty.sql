-- Duel prizes scale with how hard the win was (Kegan, 2026-09-28: "divy out
-- rewards based on how difficult it is to complete").
--
-- 20260928070000 paid one Elite capsule for any fair live win and nothing
-- for a Session Duel. A win now pays a tier, and each tier is a capsule plus
-- XP plus Flex Coins:
--
--   tier 1  Standard capsule, 150 XP, 15 coins
--   tier 2  Premium capsule,  300 XP, 30 coins
--   tier 3  Elite capsule,    500 XP, 50 coins
--   tier 4  Elite capsule,    800 XP, 80 coins
--
-- The base tier is the duel type:
--   Session  1  You pick whose last workout to beat, so you can pick an easy
--               one, and it never moves while you chase it.
--   Open     2  Two people training against each other; the other side can
--               answer every session you log.
--   Mirror   3  Finish every set of the same workout AND lift more, against
--               someone who can answer.
-- An upset adds one tier: the loser was 5 or more levels above the winner.
-- Levels are server-owned (current_level), so nobody can inflate the gap.
--
-- Unchanged from 070000: a walkover pays nothing (nobody was beaten), one
-- paid win per lifter per 24 hours, one paid duel per pair per 7 days.
-- XP goes through award_xp_internal, so the rolling XP cap and its ledger
-- apply; coins go through the flex coin ledger trigger (264), which may clamp.
-- What actually landed is measured and recorded on the duel, so the app
-- never shows a number that did not arrive.
--
-- Nothing is deleted. No duel has completed in production yet, so no prize
-- recorded under 070000 is rewritten.

CREATE OR REPLACE FUNCTION public._duel_prize_for(p_duel public.duels)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_loser   UUID;
  v_win_lvl INTEGER;
  v_lose_lvl INTEGER;
  v_tier    INTEGER;
  v_upset   BOOLEAN;
BEGIN
  IF p_duel.status IS DISTINCT FROM 'completed' OR p_duel.winner_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_duel.challenger_result IS NULL OR p_duel.opponent_result IS NULL THEN
    RETURN jsonb_build_object('withheld', 'walkover');
  END IF;
  v_loser := CASE WHEN p_duel.winner_id = p_duel.challenger_id
                  THEN p_duel.opponent_id ELSE p_duel.challenger_id END;

  IF EXISTS (SELECT 1 FROM public.duels
              WHERE id <> p_duel.id
                AND winner_id = p_duel.winner_id
                AND prize_paid_at > now() - interval '24 hours') THEN
    RETURN jsonb_build_object('withheld', 'daily_limit');
  END IF;
  IF EXISTS (SELECT 1 FROM public.duels
              WHERE id <> p_duel.id
                AND prize_paid_at > now() - interval '7 days'
                AND ((challenger_id = p_duel.winner_id AND opponent_id = v_loser)
                  OR (challenger_id = v_loser AND opponent_id = p_duel.winner_id))) THEN
    RETURN jsonb_build_object('withheld', 'pair_limit');
  END IF;

  v_tier := CASE
    WHEN p_duel.mode = 'session' THEN 1
    WHEN p_duel.type = 'mirror'  THEN 3
    ELSE 2
  END;
  SELECT COALESCE(current_level, 1) INTO v_win_lvl  FROM public.user_profiles WHERE id = p_duel.winner_id;
  SELECT COALESCE(current_level, 1) INTO v_lose_lvl FROM public.user_profiles WHERE id = v_loser;
  v_upset := COALESCE(v_lose_lvl, 1) >= COALESCE(v_win_lvl, 1) + 5;
  IF v_upset THEN v_tier := v_tier + 1; END IF;

  RETURN jsonb_build_object(
    'tier',    v_tier,
    'upset',   v_upset,
    'capsule', CASE v_tier WHEN 1 THEN 'standard' WHEN 2 THEN 'premium' ELSE 'elite' END,
    'xp',      CASE v_tier WHEN 1 THEN 150 WHEN 2 THEN 300 WHEN 3 THEN 500 ELSE 800 END,
    'coins',   CASE v_tier WHEN 1 THEN 15  WHEN 2 THEN 30  WHEN 3 THEN 50  ELSE 80  END);
END;
$function$;

REVOKE ALL ON FUNCTION public._duel_prize_for(public.duels) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.duels_pay_prize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_prize JSONB;
  v_email TEXT;
  v_xp0   BIGINT; v_xp1 BIGINT;
  v_c0    NUMERIC; v_c1 NUMERIC;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' OR OLD.status = 'completed' OR NEW.prize IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_prize := public._duel_prize_for(NEW);
  IF v_prize IS NULL THEN RETURN NEW; END IF;

  IF v_prize ? 'capsule' THEN
    -- A prize that fails must never undo the result itself: the Session
    -- Duel path runs inside the workout_logs trigger, which swallows errors
    -- and would silently drop the completion along with the prize. A failure
    -- rolls back all three parts together.
    BEGIN
      SELECT email, COALESCE(total_xp, 0), COALESCE(flex_coins, 0)
        INTO v_email, v_xp0, v_c0
        FROM public.user_profiles WHERE id = NEW.winner_id;
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (NEW.winner_id, COALESCE(v_email, ''), v_prize->>'capsule');
      PERFORM public.award_xp_internal(NEW.winner_id, (v_prize->>'xp')::INT);
      UPDATE public.user_profiles
         SET flex_coins = COALESCE(flex_coins, 0) + (v_prize->>'coins')::INT
       WHERE id = NEW.winner_id;
      SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp1, v_c1
        FROM public.user_profiles WHERE id = NEW.winner_id;
      -- Record what landed, not what was due: the XP cap and the coin
      -- ledger can both clamp.
      v_prize := v_prize || jsonb_build_object(
        'xp',    GREATEST(v_xp1 - v_xp0, 0)::INT,
        'coins', GREATEST(round(v_c1 - v_c0), 0)::INT);
      NEW.prize_paid_at := now();
    EXCEPTION WHEN OTHERS THEN
      v_prize := jsonb_build_object('withheld', 'error');
    END;
  END IF;
  NEW.prize := v_prize;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.duels_pay_prize() FROM PUBLIC, anon, authenticated;

-- The win alert names what landed. Restated from 070000; only the body
-- changes. en, es and fr are written; shelved languages read English.
CREATE OR REPLACE FUNCTION public._notify_duel_result_inner(p_recipient_id uuid, p_duel_id uuid, p_outcome text, p_actor_name text DEFAULT 'Someone'::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email TEXT;
  v_lang  TEXT;
  v_text  JSONB;
  v_body  TEXT;
  v_prize JSONB;
  v_cap   TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_recipient_id;
  IF v_email IS NULL THEN RETURN; END IF;
  SELECT preferred_language INTO v_lang FROM public.user_profiles WHERE id = p_recipient_id;
  v_lang := COALESCE(v_lang, 'en');
  v_text := public.duel_result_text(v_lang, p_actor_name, p_outcome);

  IF p_outcome = 'won' THEN
    SELECT prize INTO v_prize FROM public.duels
     WHERE id = p_duel_id AND winner_id = p_recipient_id AND prize ? 'capsule';
  END IF;
  IF v_prize IS NOT NULL THEN
    v_cap := CASE v_lang
      WHEN 'es' THEN CASE v_prize->>'capsule' WHEN 'standard' THEN 'Estándar' WHEN 'premium' THEN 'Premium' ELSE 'Élite' END
      WHEN 'fr' THEN CASE v_prize->>'capsule' WHEN 'standard' THEN 'Standard' WHEN 'premium' THEN 'Premium' ELSE 'Élite' END
      ELSE           CASE v_prize->>'capsule' WHEN 'standard' THEN 'Standard' WHEN 'premium' THEN 'Premium' ELSE 'Elite' END
    END;
    v_body := CASE v_lang
      WHEN 'es' THEN format('Ganaste una cápsula %s, %s XP y %s Flex Coins.', v_cap, v_prize->>'xp', v_prize->>'coins')
      WHEN 'fr' THEN format('Vous avez gagné une capsule %s, %s XP et %s Flex Coins.', v_cap, v_prize->>'xp', v_prize->>'coins')
      ELSE           format('You earned a %s capsule, %s XP and %s Flex Coins.', v_cap, v_prize->>'xp', v_prize->>'coins')
    END;
  END IF;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_recipient_id, v_email, 'duel_result', v_text ->> 'title', v_body, '⚔️',
          '/duels?duel=' || p_duel_id,
          jsonb_build_object('duel_id', p_duel_id, 'outcome', p_outcome));
END;
$function$;

REVOKE ALL ON FUNCTION public._notify_duel_result_inner(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Probe: the tier table, pure. Winner and loser ids have no profile, so both
-- read as level 1 and there is no upset.
DO $$
DECLARE
  d public.duels%ROWTYPE;
  r JSONB;
BEGIN
  d.id := gen_random_uuid();
  d.challenger_id := gen_random_uuid();
  d.opponent_id := gen_random_uuid();
  d.status := 'completed';
  d.winner_id := d.challenger_id;
  d.challenger_result := '{"volume": 5000}';
  d.opponent_result := '{"volume": 4000}';

  d.mode := 'session'; d.type := 'mirror';
  r := public._duel_prize_for(d);
  IF r->>'capsule' <> 'standard' OR (r->>'xp')::int <> 150 OR (r->>'upset')::boolean THEN
    RAISE EXCEPTION 'probe: session tier was %', r;
  END IF;
  d.mode := 'live'; d.type := 'open';
  r := public._duel_prize_for(d);
  IF r->>'capsule' <> 'premium' OR (r->>'xp')::int <> 300 THEN RAISE EXCEPTION 'probe: open tier was %', r; END IF;
  d.type := 'mirror';
  r := public._duel_prize_for(d);
  IF r->>'capsule' <> 'elite' OR (r->>'xp')::int <> 500 THEN RAISE EXCEPTION 'probe: mirror tier was %', r; END IF;

  d.opponent_result := NULL;
  IF public._duel_prize_for(d) IS DISTINCT FROM '{"withheld": "walkover"}'::jsonb THEN
    RAISE EXCEPTION 'probe: a walkover is paid';
  END IF;
END;
$$;

-- Attempt it: throwaway lifters play real duels through the RPCs and the
-- workout trigger, rolled back by the closing RAISE.
--   1. Open duel, B (level 1) beats A (level 1): Premium, no upset.
--   2. Mirror duel between C (level 2) and D (level 9); C wins: an upset on
--      a Mirror pays tier 4, Elite with 800 XP due.
--   3. Session Duel, A beats B's session again inside the week: pair limit.
DO $$
DECLARE
  a UUID := gen_random_uuid();
  b UUID := gen_random_uuid();
  c UUID := gen_random_uuid();
  e UUID := gen_random_uuid();
  d JSONB; v_id UUID; v_row public.duels%ROWTYPE;
  small JSONB := '[{"name":"Bench Press","sets":[{"weight":"100","reps":"10"},{"weight":"100","reps":"8"}]}]';
  mid   JSONB := '[{"name":"Bench Press","sets":[{"weight":"120","reps":"10"},{"weight":"120","reps":"10"}]}]';
  big   JSONB := '[{"name":"Bench Press","sets":[{"weight":"150","reps":"10"},{"weight":"150","reps":"10"}]}]';
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (a, 'dt-probe-a-' || a || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (b, 'dt-probe-b-' || b || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (c, 'dt-probe-c-' || c || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (e, 'dt-probe-e-' || e || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email, username, is_private)
    VALUES (a, 'dt-probe-a-' || a || '@example.invalid', 'dtprobe_a_' || left(a::text, 8), FALSE),
           (b, 'dt-probe-b-' || b || '@example.invalid', 'dtprobe_b_' || left(b::text, 8), FALSE),
           (c, 'dt-probe-c-' || c || '@example.invalid', 'dtprobe_c_' || left(c::text, 8), FALSE),
           (e, 'dt-probe-e-' || e || '@example.invalid', 'dtprobe_e_' || left(e::text, 8), FALSE)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username,
                                   is_private = EXCLUDED.is_private;
    UPDATE public.user_profiles SET current_level = 1 WHERE id IN (a, b);
    UPDATE public.user_profiles SET current_level = 2 WHERE id = c;
    UPDATE public.user_profiles SET current_level = 9 WHERE id = e;

    -- 1. Open duel, B wins.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    d := public.create_duel(b, 'open', 24);
    v_id := (d->>'id')::uuid;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    PERFORM public.respond_to_duel(v_id, TRUE);
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, small, now()), ('probe', b, mid, now());
    UPDATE public.duels SET expires_at = now() - interval '1 minute' WHERE id = v_id;
    PERFORM public.expire_overdue_duels();
    SELECT * INTO v_row FROM public.duels WHERE id = v_id;
    IF v_row.winner_id IS DISTINCT FROM b OR v_row.prize->>'capsule' IS DISTINCT FROM 'premium'
       OR (v_row.prize->>'upset')::boolean OR v_row.prize_paid_at IS NULL THEN
      RAISE EXCEPTION 'probe: open win recorded winner % prize %', v_row.winner_id, v_row.prize;
    END IF;
    IF (SELECT count(*) FROM public.user_capsules WHERE user_id = b AND capsule_type = 'premium') <> 1
       OR EXISTS (SELECT 1 FROM public.user_capsules WHERE user_id = a) THEN
      RAISE EXCEPTION 'probe: the Premium capsule did not land on the winner alone';
    END IF;
    IF (v_row.prize->>'xp')::int <= 0 OR (v_row.prize->>'xp')::int > 300 THEN
      RAISE EXCEPTION 'probe: recorded XP % is not what landed', v_row.prize->>'xp';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.notifications
                    WHERE user_id = b AND type = 'duel_result' AND body LIKE 'You earned a Premium capsule%') THEN
      RAISE EXCEPTION 'probe: the winner was not told what they earned';
    END IF;

    -- 2. Mirror duel, the level 2 lifter beats the level 9 lifter: an upset.
    -- A Mirror is built from the challenger's latest workout.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', e, mid, now() - interval '1 day');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
    d := public.create_duel(c, 'mirror', 24);
    v_id := (d->>'id')::uuid;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
    PERFORM public.respond_to_duel(v_id, TRUE);
    SELECT * INTO v_row FROM public.duels WHERE id = v_id;
    IF v_row.status = 'active' THEN
      UPDATE public.duels SET challenger_result = '{"volume": 1000, "sets_completed": 1, "score": 1}'::jsonb,
                              opponent_result   = '{"volume": 3000, "sets_completed": 2, "score": 2}'::jsonb
       WHERE id = v_id;
      UPDATE public.duels SET status = 'completed', winner_id = c WHERE id = v_id;
      SELECT * INTO v_row FROM public.duels WHERE id = v_id;
      IF v_row.prize->>'capsule' IS DISTINCT FROM 'elite' OR (v_row.prize->>'tier')::int <> 4
         OR NOT (v_row.prize->>'upset')::boolean THEN
        RAISE EXCEPTION 'probe: mirror upset recorded %', v_row.prize;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.user_capsules WHERE user_id = c AND capsule_type = 'elite') THEN
        RAISE EXCEPTION 'probe: the upset Elite capsule did not land';
      END IF;
    ELSE
      RAISE EXCEPTION 'probe: mirror duel did not start (status %)', v_row.status;
    END IF;

    -- 3. Session Duel against the same pair inside the week: held.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    d := public.create_session_duel(b, 48);
    v_id := (d->>'id')::uuid;
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, big, now());
    SELECT * INTO v_row FROM public.duels WHERE id = v_id;
    IF v_row.status <> 'completed' OR v_row.prize IS DISTINCT FROM '{"withheld": "pair_limit"}'::jsonb THEN
      RAISE EXCEPTION 'probe: repeat pair session duel was % with prize %', v_row.status, v_row.prize;
    END IF;
    IF EXISTS (SELECT 1 FROM public.user_capsules WHERE user_id = a) THEN
      RAISE EXCEPTION 'probe: the pair limit still paid';
    END IF;

    RAISE EXCEPTION 'dt-probe-ok';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'dt-probe-ok' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
