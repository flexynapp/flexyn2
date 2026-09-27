-- Duels audit, round two (2026-09-27).
--
-- Four fixes, all found by reading the installed bodies against what the
-- app tells people.
--
-- 1. A Mirror duel ignored WHICH exercises were done. _duel_score_mirror
--    compares a set COUNT and a volume total against the template, and
--    _duel_metrics_from_log counted every set in the log, so leg press could
--    stand in for squats and twenty sets of anything "completed" a
--    twelve-set session. The rules say "your exact session" and the Session
--    Duel hint says "finish every set". _duel_mirror_metrics now counts only
--    sets on exercises the template names (matched on the name, trimmed and
--    lower-cased), capped per exercise at what the template prescribes, and
--    counts volume only on those exercises. Open duels are unchanged.
--
-- 2. A Session Duel pushed "you lost a duel" to the person being taken on.
--    They never accepted and are never asked, so any account could send that
--    push to anyone it can see, ten times a day. expire_overdue_duels already
--    notified only the challenger ("only the lifter who chose to play hears
--    how it went"); the instant-win path in _duel_refresh_side did not.
--
-- 3. claim_pending_duel_invite skipped two checks every other door makes:
--    a block in either direction, and an already-open duel between the pair.
--    A blocked person holding an old link could still start a duel.
--
-- 4. create_session_duel froze the opponent's score with the old metrics.
--    It now uses the same function, so both sides are measured one way.
--
-- Nothing here deletes data. Production held 19 duels, all live mode and all
-- finished (18 expired, 1 declined), so no score in flight changes.

-- ── 1. Exercise-aware Mirror metrics ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._duel_mirror_metrics(p_exercises JSONB, p_template JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_need       JSONB := '{}'::JSONB;  -- exercise -> sets prescribed
  v_done       JSONB := '{}'::JSONB;  -- exercise -> sets with reps logged
  v_ex         JSONB;
  v_set        JSONB;
  v_key        TEXT;
  v_w          NUMERIC;
  v_r          NUMERIC;
  v_vol        NUMERIC := 0;
  v_max_reps   NUMERIC := 0;
  v_max_weight NUMERIC := 0;
  v_sets       INT := 0;
BEGIN
  IF p_template IS NULL OR jsonb_typeof(p_template->'exercises') IS DISTINCT FROM 'array'
     OR p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array' THEN
    RETURN jsonb_build_object('volume', 0, 'reps', 0, 'weight', 0, 'sets_completed', 0);
  END IF;

  FOR v_ex IN SELECT * FROM jsonb_array_elements(p_template->'exercises') LOOP
    v_key := lower(btrim(COALESCE(v_ex->>'name', '')));
    IF v_key = '' OR jsonb_typeof(v_ex->'sets') IS DISTINCT FROM 'array' THEN CONTINUE; END IF;
    v_need := v_need || jsonb_build_object(v_key,
      COALESCE((v_need->>v_key)::INT, 0) + jsonb_array_length(v_ex->'sets'));
  END LOOP;

  FOR v_ex IN SELECT * FROM jsonb_array_elements(p_exercises) LOOP
    v_key := lower(btrim(COALESCE(v_ex->>'name', '')));
    IF NOT (v_need ? v_key) OR jsonb_typeof(v_ex->'sets') IS DISTINCT FROM 'array' THEN CONTINUE; END IF;
    FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
      v_w := COALESCE((v_set->>'weight')::NUMERIC, 0);
      v_r := COALESCE((v_set->>'reps')::NUMERIC, 0);
      v_vol := v_vol + v_w * v_r;
      IF v_r > 0 THEN
        v_done := v_done || jsonb_build_object(v_key, COALESCE((v_done->>v_key)::INT, 0) + 1);
      END IF;
      IF v_r > v_max_reps THEN v_max_reps := v_r; END IF;
      IF v_w > v_max_weight THEN v_max_weight := v_w; END IF;
    END LOOP;
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_done) LOOP
    v_sets := v_sets + LEAST((v_done->>v_key)::INT, (v_need->>v_key)::INT);
  END LOOP;

  RETURN jsonb_build_object('volume', v_vol, 'reps', v_max_reps, 'weight', v_max_weight,
                            'sets_completed', v_sets);
END;
$$;

REVOKE ALL ON FUNCTION public._duel_mirror_metrics(JSONB, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._duel_side_result(p_duel duels, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  l       RECORD;
  v_m     JSONB;
  v_s     NUMERIC;
  v_best  JSONB;
  v_top   NUMERIC := -1;
BEGIN
  FOR l IN
    SELECT id, exercises FROM public.workout_logs
     WHERE user_id = p_user
       AND NOT COALESCE(implausible, FALSE)
       AND created_at >= COALESCE(p_duel.accepted_at, p_duel.created_at)
       AND created_at <= p_duel.expires_at
  LOOP
    BEGIN
      -- A Mirror is scored on the template's own exercises only.
      v_m := CASE WHEN p_duel.type = 'mirror'
                  THEN public._duel_mirror_metrics(l.exercises, p_duel.session_template)
                  ELSE public._duel_metrics_from_log(l.exercises) END;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
    IF COALESCE((v_m->>'sets_completed')::INT, 0) = 0 THEN CONTINUE; END IF;
    v_s := public._duel_score(p_duel.type, v_m, p_duel.session_template);
    IF v_s > v_top THEN
      v_top  := v_s;
      v_best := v_m || jsonb_build_object('workout_log_id', l.id, 'score', v_s, 'server_computed', TRUE);
    END IF;
  END LOOP;
  RETURN v_best;
END;
$function$;

-- ── 2. The person taken on in a Session Duel is not told they lost ─────────
CREATE OR REPLACE FUNCTION public._duel_refresh_side(p_duel_id uuid, p_user uuid)
RETURNS duels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  d     public.duels%ROWTYPE;
  v_res JSONB;
BEGIN
  SELECT * INTO d FROM public.duels WHERE id = p_duel_id;
  IF d.id IS NULL OR d.status <> 'active' OR d.expires_at <= now() THEN RETURN d; END IF;
  -- In a session duel the opponent's side is the session being taken on.
  IF p_user = d.opponent_id AND d.mode = 'session' THEN RETURN d; END IF;
  IF p_user NOT IN (d.challenger_id, d.opponent_id) THEN RETURN d; END IF;

  v_res := public._duel_side_result(d, p_user);
  IF p_user = d.challenger_id THEN
    UPDATE public.duels SET challenger_result = v_res WHERE id = d.id RETURNING * INTO d;
  ELSE
    UPDATE public.duels SET opponent_result = v_res WHERE id = d.id RETURNING * INTO d;
  END IF;

  IF d.mode = 'session' AND v_res IS NOT NULL
     AND public._duel_score(d.type, d.challenger_result, d.session_template)
       > public._duel_score(d.type, d.opponent_result, d.session_template) THEN
    UPDATE public.duels SET status = 'completed', winner_id = d.challenger_id
     WHERE id = d.id RETURNING * INTO d;
    -- Only the lifter who chose to play hears how it went, the same rule as
    -- expire_overdue_duels. The opponent never agreed to this duel.
    PERFORM public._notify_duel_result_inner(d.challenger_id, d.id, 'won', public._duel_name(d.opponent_id));
  END IF;
  RETURN d;
END;
$function$;

-- ── 3. Invite links respect blocks and open duels ──────────────────────────
CREATE OR REPLACE FUNCTION public.claim_pending_duel_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid                 UUID := auth.uid();
  v_invite_id           UUID;
  v_challenger_id       UUID;
  v_claimed_by_id       UUID;
  v_resulting_duel_id   UUID;
  v_expires_at          TIMESTAMPTZ;
  v_window_hours        INT;
  v_duel_type           TEXT;
  v_session_template    JSONB;
  v_duel_id             UUID;
  v_new_expires         TIMESTAMPTZ;
  v_challenger_email    TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL THEN
    RAISE EXCEPTION 'token required' USING ERRCODE = '22023';
  END IF;

  SELECT id, challenger_id, claimed_by_id, resulting_duel_id, expires_at,
         window_hours, duel_type, session_template
    INTO v_invite_id, v_challenger_id, v_claimed_by_id, v_resulting_duel_id, v_expires_at,
         v_window_hours, v_duel_type, v_session_template
    FROM public.pending_duel_invites
   WHERE claim_token = p_token
   FOR UPDATE;

  IF v_invite_id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_claimed_by_id IS NOT NULL THEN
    IF v_claimed_by_id = v_uid AND v_resulting_duel_id IS NOT NULL THEN
      RETURN jsonb_build_object('duel_id', v_resulting_duel_id, 'already_claimed_by_you', TRUE);
    END IF;
    RAISE EXCEPTION 'invite_already_claimed' USING ERRCODE = '22023';
  END IF;
  IF v_expires_at < NOW() THEN
    RAISE EXCEPTION 'invite_expired' USING ERRCODE = '22023';
  END IF;
  IF v_challenger_id = v_uid THEN
    RAISE EXCEPTION 'cannot_claim_own_invite' USING ERRCODE = '22023';
  END IF;
  IF public._duel_is_guest(v_uid) THEN
    RAISE EXCEPTION 'guest_account' USING ERRCODE = '42501';
  END IF;

  -- is_blocked checks both directions. The invite stays unclaimed, so the
  -- challenger can still send it to someone else.
  SELECT email INTO v_challenger_email FROM public.user_profiles WHERE id = v_challenger_id;
  IF v_challenger_email IS NULL OR public.is_blocked(v_uid, v_challenger_email) THEN
    RAISE EXCEPTION 'opponent_unavailable' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.duels
              WHERE status IN ('pending', 'active') AND expires_at > now()
                AND ((challenger_id = v_uid AND opponent_id = v_challenger_id)
                  OR (challenger_id = v_challenger_id AND opponent_id = v_uid))) THEN
    RAISE EXCEPTION 'duel_already_open' USING ERRCODE = '22023';
  END IF;

  -- An invite minted before this migration can carry an Exercise type or a
  -- Mirror with no template, and both score as a guaranteed tie. Play it as
  -- an Open duel instead of refusing a link someone already shared.
  IF v_duel_type NOT IN ('open', 'mirror') OR (v_duel_type = 'mirror' AND v_session_template IS NULL) THEN
    v_duel_type := 'open';
    v_session_template := NULL;
  END IF;

  v_new_expires := NOW() + (v_window_hours || ' hours')::INTERVAL;

  INSERT INTO public.duels
    (challenger_id, opponent_id, type, status, session_template,
     window_hours, expires_at, accepted_at)
  VALUES
    (v_challenger_id, v_uid, v_duel_type::public.duel_type, 'active',
     v_session_template, v_window_hours, v_new_expires, NOW())
  RETURNING id INTO v_duel_id;

  UPDATE public.pending_duel_invites
     SET claimed_by_id     = v_uid,
         claimed_at        = NOW(),
         resulting_duel_id = v_duel_id
   WHERE id = v_invite_id;

  RETURN jsonb_build_object(
    'duel_id',                v_duel_id,
    'already_claimed_by_you', FALSE
  );
END;
$function$;

-- ── 4. The session being taken on is measured the same way ────────────────
CREATE OR REPLACE FUNCTION public.create_session_duel(p_opponent_id uuid, p_window_hours integer DEFAULT 48)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_opp_email TEXT;
  v_private   BOOLEAN;
  v_template  JSONB;
  v_theirs    JSONB;
  v_row       public.duels%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF public._duel_is_guest(v_uid) THEN RAISE EXCEPTION 'guest_account' USING ERRCODE = '42501'; END IF;
  IF p_opponent_id IS NULL THEN RAISE EXCEPTION 'opponent_required' USING ERRCODE = '22023'; END IF;
  IF p_opponent_id = v_uid THEN RAISE EXCEPTION 'cannot_duel_self' USING ERRCODE = '22023'; END IF;
  IF p_window_hours IS NULL OR p_window_hours < 1 OR p_window_hours > 168 THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = '22023';
  END IF;

  SELECT email, COALESCE(is_private, FALSE) INTO v_opp_email, v_private
    FROM public.user_profiles WHERE id = p_opponent_id;
  IF v_opp_email IS NULL OR public._duel_is_guest(p_opponent_id)
     OR public.is_blocked(v_uid, v_opp_email)
     OR (v_private AND NOT public.viewer_follows(v_opp_email)) THEN
    RAISE EXCEPTION 'opponent_unavailable' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.duels
              WHERE status IN ('pending', 'active') AND expires_at > now()
                AND ((challenger_id = v_uid AND opponent_id = p_opponent_id)
                  OR (challenger_id = p_opponent_id AND opponent_id = v_uid))) THEN
    RAISE EXCEPTION 'duel_already_open' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.duels
       WHERE challenger_id = v_uid AND created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'too_many_duels' USING ERRCODE = '22023';
  END IF;

  v_template := public._duel_mirror_template(p_opponent_id);
  IF v_template IS NULL THEN RAISE EXCEPTION 'opponent_no_session' USING ERRCODE = '22023'; END IF;
  v_theirs := public._duel_mirror_metrics(v_template->'exercises', v_template);
  v_theirs := v_theirs || jsonb_build_object(
    'workout_log_id', v_template->'workout_log_id',
    'score', public._duel_score('mirror', v_theirs, v_template),
    'server_computed', TRUE);

  INSERT INTO public.duels (challenger_id, opponent_id, type, mode, status, session_template,
                            opponent_result, window_hours, accepted_at, expires_at)
  VALUES (v_uid, p_opponent_id, 'mirror', 'session', 'active', v_template,
          v_theirs, p_window_hours, now(), now() + make_interval(hours => p_window_hours))
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$;

-- ── Probe: attempt the things, then assert both directions ─────────────────
DO $$
DECLARE
  v_tpl JSONB := jsonb_build_object('exercises', jsonb_build_array(
    jsonb_build_object('name', 'Back Squat', 'sets', jsonb_build_array(
      jsonb_build_object('weight', 225, 'reps', 5),
      jsonb_build_object('weight', 225, 'reps', 5),
      jsonb_build_object('weight', 225, 'reps', 5))),
    jsonb_build_object('name', 'Bench Press', 'sets', jsonb_build_array(
      jsonb_build_object('weight', 185, 'reps', 5),
      jsonb_build_object('weight', 185, 'reps', 5)))));
  v_m JSONB;
BEGIN
  -- The template against itself: every set, full volume.
  v_m := public._duel_mirror_metrics(v_tpl->'exercises', v_tpl);
  IF (v_m->>'sets_completed')::INT <> 5 OR (v_m->>'volume')::NUMERIC <> 5225 THEN
    RAISE EXCEPTION 'probe: template against itself gave %', v_m;
  END IF;

  -- Ten sets of leg press count for nothing against a squat and bench session.
  v_m := public._duel_mirror_metrics(jsonb_build_array(
    jsonb_build_object('name', 'Leg Press', 'sets',
      (SELECT jsonb_agg(jsonb_build_object('weight', 600, 'reps', 10)) FROM generate_series(1, 10)))), v_tpl);
  IF (v_m->>'sets_completed')::INT <> 0 OR (v_m->>'volume')::NUMERIC <> 0 THEN
    RAISE EXCEPTION 'probe: off-template exercise counted %', v_m;
  END IF;

  -- Extra squat sets are capped at the three prescribed; casing and spaces match.
  v_m := public._duel_mirror_metrics(jsonb_build_array(
    jsonb_build_object('name', '  back squat ', 'sets',
      (SELECT jsonb_agg(jsonb_build_object('weight', 225, 'reps', 5)) FROM generate_series(1, 8)))), v_tpl);
  IF (v_m->>'sets_completed')::INT <> 3 THEN
    RAISE EXCEPTION 'probe: per-exercise cap failed %', v_m;
  END IF;
END;
$$;
