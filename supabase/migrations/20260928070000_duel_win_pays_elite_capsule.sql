-- A duel win pays an Elite capsule (Kegan, 2026-09-28).
--
-- Until now a win added a W to your record and nothing else. The prize is
-- paid by the database the moment a duel completes with a winner, whichever
-- path completed it: the expiry sweep (expire_overdue_duels) or a Session
-- Duel beaten mid-window (_duel_refresh_side). A BEFORE UPDATE OF status
-- trigger is the one place both paths pass through, so neither is restated.
--
-- Only live duels pay, the same line the trophy count draws: in a Session
-- Duel the other lifter never agreed to play, so beating an old session of a
-- second account would be a capsule on demand. Those record
-- prize = {"withheld": "session"}.
--
-- A live win is withheld in three more cases, each recorded on the duel as
-- prize = {"withheld": <reason>} so the app can say why:
--   walkover     only one side trained. A win against someone who never
--                showed up is the easiest thing to farm with a second
--                account, so it keeps its W and pays nothing.
--   daily_limit  the winner was already paid for a duel in the last 24h.
--   pair_limit   these two lifters already paid out a duel in the last
--                7 days, in either direction. Two accounts trading wins
--                cannot turn into a capsule a day each.
-- A paid win records prize = {"capsule": "elite"} and prize_paid_at.
--
-- Adds two nullable columns. Nothing is deleted or rewritten, and no duel
-- has ever completed in production, so nobody is paid retroactively.
-- Clients hold SELECT only on duels, so neither column is client-writable.

ALTER TABLE public.duels ADD COLUMN IF NOT EXISTS prize jsonb;
ALTER TABLE public.duels ADD COLUMN IF NOT EXISTS prize_paid_at timestamptz;

-- The decision, kept apart from the write so the probe can exercise it.
CREATE OR REPLACE FUNCTION public._duel_prize_for(p_duel public.duels)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_loser UUID;
BEGIN
  IF p_duel.status IS DISTINCT FROM 'completed' OR p_duel.winner_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_duel.mode IS DISTINCT FROM 'live' THEN
    RETURN jsonb_build_object('withheld', 'session');
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

  RETURN jsonb_build_object('capsule', 'elite');
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
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' OR OLD.status = 'completed' OR NEW.prize IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_prize := public._duel_prize_for(NEW);
  IF v_prize IS NULL THEN RETURN NEW; END IF;

  IF v_prize ? 'capsule' THEN
    -- A prize that fails must never undo the result itself: the Session
    -- Duel path runs inside the workout_logs trigger, which swallows errors
    -- and would silently drop the completion along with the capsule.
    BEGIN
      SELECT email INTO v_email FROM public.user_profiles WHERE id = NEW.winner_id;
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (NEW.winner_id, COALESCE(v_email, ''), 'elite');
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

DROP TRIGGER IF EXISTS duels_pay_prize ON public.duels;
CREATE TRIGGER duels_pay_prize
  BEFORE UPDATE OF status ON public.duels
  FOR EACH ROW EXECUTE FUNCTION public.duels_pay_prize();

-- The win alert says the capsule landed. Restated from the installed body;
-- the one change is the body line on a paid win. en, es and fr are
-- written; the shelved languages read English, as the rule for them says.
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
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_recipient_id;
  IF v_email IS NULL THEN RETURN; END IF;
  SELECT preferred_language INTO v_lang FROM public.user_profiles WHERE id = p_recipient_id;
  v_text := public.duel_result_text(COALESCE(v_lang, 'en'), p_actor_name, p_outcome);

  IF p_outcome = 'won' AND EXISTS (SELECT 1 FROM public.duels
                                     WHERE id = p_duel_id AND winner_id = p_recipient_id
                                       AND prize ? 'capsule') THEN
    v_body := CASE COALESCE(v_lang, 'en')
      WHEN 'es' THEN 'Ganaste una cápsula Elite.'
      WHEN 'fr' THEN 'Vous avez gagné une capsule Elite.'
      ELSE           'You earned an Elite capsule.'
    END;
  END IF;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_recipient_id, v_email, 'duel_result', v_text ->> 'title', v_body, '⚔️',
          '/duels?duel=' || p_duel_id,
          jsonb_build_object('duel_id', p_duel_id, 'outcome', p_outcome));
END;
$function$;

REVOKE ALL ON FUNCTION public._notify_duel_result_inner(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Probe: each branch of the decision, the wiring, and the grants.
DO $$
DECLARE
  d public.duels%ROWTYPE;
BEGIN
  d.id := gen_random_uuid();
  d.challenger_id := gen_random_uuid();
  d.opponent_id := gen_random_uuid();
  d.status := 'completed';
  d.mode := 'live';
  d.winner_id := d.challenger_id;
  d.challenger_result := '{"volume": 5000}';
  d.opponent_result := '{"volume": 4000}';
  IF public._duel_prize_for(d) IS DISTINCT FROM '{"capsule": "elite"}'::jsonb THEN
    RAISE EXCEPTION 'probe: a fair win is not paid (got %)', public._duel_prize_for(d);
  END IF;

  d.opponent_result := NULL;
  IF public._duel_prize_for(d) IS DISTINCT FROM '{"withheld": "walkover"}'::jsonb THEN
    RAISE EXCEPTION 'probe: a walkover is paid';
  END IF;

  d.opponent_result := '{"volume": 4000}';
  d.mode := 'session';
  IF public._duel_prize_for(d) IS DISTINCT FROM '{"withheld": "session"}'::jsonb THEN
    RAISE EXCEPTION 'probe: a session duel is paid';
  END IF;
  d.mode := 'live';

  d.winner_id := NULL;
  IF public._duel_prize_for(d) IS NOT NULL THEN
    RAISE EXCEPTION 'probe: a tie is paid';
  END IF;

  d.winner_id := d.challenger_id;
  d.status := 'active';
  IF public._duel_prize_for(d) IS NOT NULL THEN
    RAISE EXCEPTION 'probe: an unfinished duel is paid';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.duels'::regclass AND tgname = 'duels_pay_prize') THEN
    RAISE EXCEPTION 'probe: prize trigger is not attached';
  END IF;
  IF has_function_privilege('authenticated', 'public._duel_prize_for(public.duels)', 'execute')
     OR has_table_privilege('authenticated', 'public.duels', 'UPDATE') THEN
    RAISE EXCEPTION 'probe: a client can reach the prize';
  END IF;
END;
$$;

-- Attempt it: two throwaway lifters play two live duels through the real
-- RPCs and the real workout trigger, rolled back by the closing RAISE.
-- The first win pays and the winner is told; the second, won by the other
-- lifter inside the week, is held by the pair limit.
DO $$
DECLARE
  a UUID := gen_random_uuid();
  b UUID := gen_random_uuid();
  d JSONB; v_id UUID; v_row public.duels%ROWTYPE;
  small JSONB := '[{"name":"Bench Press","sets":[{"weight":"100","reps":"10"},{"weight":"100","reps":"8"}]}]';
  mid   JSONB := '[{"name":"Bench Press","sets":[{"weight":"120","reps":"10"},{"weight":"120","reps":"10"}]}]';
  big   JSONB := '[{"name":"Bench Press","sets":[{"weight":"150","reps":"10"},{"weight":"150","reps":"10"}]}]';
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (a, 'dp-probe-a-' || a || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (b, 'dp-probe-b-' || b || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email, username, is_private)
    VALUES (a, 'dp-probe-a-' || a || '@example.invalid', 'dpprobe_a_' || left(a::text, 8), FALSE),
           (b, 'dp-probe-b-' || b || '@example.invalid', 'dpprobe_b_' || left(b::text, 8), FALSE)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username,
                                   is_private = EXCLUDED.is_private;

    -- Duel one: B outlifts A.
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
    IF v_row.winner_id IS DISTINCT FROM b OR v_row.prize IS DISTINCT FROM '{"capsule": "elite"}'::jsonb
       OR v_row.prize_paid_at IS NULL THEN
      RAISE EXCEPTION 'probe: fair win recorded winner % prize %', v_row.winner_id, v_row.prize;
    END IF;
    IF (SELECT count(*) FROM public.user_capsules WHERE user_id = b AND capsule_type = 'elite') <> 1
       OR EXISTS (SELECT 1 FROM public.user_capsules WHERE user_id = a) THEN
      RAISE EXCEPTION 'probe: the capsule did not land on the winner alone';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.notifications
                    WHERE user_id = b AND type = 'duel_result' AND body LIKE '%Elite capsule%') THEN
      RAISE EXCEPTION 'probe: the winner was not told about the capsule';
    END IF;
    IF EXISTS (SELECT 1 FROM public.notifications
                WHERE user_id = a AND type = 'duel_result' AND body IS NOT NULL) THEN
      RAISE EXCEPTION 'probe: the loser was told about a capsule';
    END IF;

    -- Duel two, same pair, A wins this time: held by the pair limit.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    d := public.create_duel(b, 'open', 24);
    v_id := (d->>'id')::uuid;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    PERFORM public.respond_to_duel(v_id, TRUE);
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, big, now()), ('probe', b, mid, now());
    UPDATE public.duels SET expires_at = now() - interval '1 minute' WHERE id = v_id;
    PERFORM public.expire_overdue_duels();
    SELECT * INTO v_row FROM public.duels WHERE id = v_id;
    IF v_row.winner_id IS DISTINCT FROM a OR v_row.prize IS DISTINCT FROM '{"withheld": "pair_limit"}'::jsonb THEN
      RAISE EXCEPTION 'probe: repeat pair recorded winner % prize %', v_row.winner_id, v_row.prize;
    END IF;
    IF EXISTS (SELECT 1 FROM public.user_capsules WHERE user_id = a) THEN
      RAISE EXCEPTION 'probe: the pair limit still paid';
    END IF;

    RAISE EXCEPTION 'dp-probe-ok';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'dp-probe-ok' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
