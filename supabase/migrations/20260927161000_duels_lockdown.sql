-- Duels: lock the table, give the opponent a real accept, make Mirror scorable.
--
-- Audit 2026-09-27 (Duels thread). What production held: 19 duels ever, the
-- last on 2026-08-05; 18 expired and 1 declined; not one ever finished and no
-- result was ever submitted. What was wrong, in order of weight:
--
-- 1. `duels_participants` was a FOR ALL policy whose only check was "you are
--    one of the two ids". A participant could INSERT a row against anyone,
--    already `completed` with `winner_id` set to themselves, or UPDATE their
--    own live duel to a win. `get_trophy_progress` counts `winner_id` and
--    every row a user is on, so the Arena trophy ladder (Challenger up to
--    Immortal, which gates a capstone) could be minted from the browser, and
--    `notify_duel_result_for` would then push "you lost" to the victim. Same
--    shape as the Rival hole closed in 20260927071000.
--    Now: clients read only. Every write goes through a SECURITY DEFINER RPC
--    that derives the actor from auth.uid().
--
-- 2. The opponent could not accept from the Duels page. The invite push says
--    "Tap to accept or decline" and links to /duels, where the pending row had
--    no button; Accept existed only on the DM card, which is sent separately
--    and silently fails for anyone without a DM thread. `respond_to_duel` is
--    the one door now and the page calls it.
--
-- 3. The window started at creation, not acceptance. `createDuel` wrote
--    expires_at = now + window and accepting never moved it, so a 24h duel
--    accepted 20 hours in left 4 hours to train, while the DM card promised
--    "24h to complete after accepting". Accepting now starts the window, and
--    `accepted_at` is the floor for which workout counts.
--
-- 4. Mirror duels always tied 0 to 0. No caller ever passed a session
--    template (the Duels page, a profile and the invite link all omit it),
--    and `_duel_score_mirror` returns 0 for a NULL template. The template is
--    now built server-side from the challenger's latest plausible workout,
--    and a Mirror challenge with no workout to copy is refused up front.
--
-- 5. Exercise duels had no exercise. Nothing ever set `target_exercise_id`,
--    so the score was "highest reps in any set of anything". New Exercise
--    duels are refused until a picker exists; the enum value stays.
--
-- 6. A duel where one side trained and the other never did expired with no
--    winner, so showing up earned nothing. The expiry sweep now completes it
--    as a walkover win for the side that submitted.
--
-- Guests: same rule as Rival (Kegan, 2026-09-27): guest accounts do not
-- compete. Creating, accepting and claiming an invite all refuse an anonymous
-- caller with 42501 'guest_account'.

-- ── Table: read-only to clients ────────────────────────────────────────────

ALTER TABLE public.duels ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

DROP POLICY IF EXISTS "duels_participants" ON public.duels;
DROP POLICY IF EXISTS "duels_participants_read" ON public.duels;
CREATE POLICY "duels_participants_read" ON public.duels
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = challenger_id OR (SELECT auth.uid()) = opponent_id);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.duels FROM anon, authenticated;

-- ── Helpers ────────────────────────────────────────────────────────────────

-- The Mirror template: the challenger's latest plausible workout that has
-- sets in it. Built here rather than accepted from the client, because the
-- template is the yardstick both sides are scored against.
CREATE OR REPLACE FUNCTION public._duel_mirror_template(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT jsonb_build_object('exercises', l.exercises, 'name', l.title, 'workout_log_id', l.id)
    FROM public.workout_logs l
   WHERE l.user_id = p_user_id
     AND NOT COALESCE(l.implausible, FALSE)
     AND jsonb_typeof(l.exercises) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.exercises) e
                  WHERE jsonb_typeof(e->'sets') = 'array' AND jsonb_array_length(e->'sets') > 0)
   ORDER BY l.created_at DESC
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._duel_is_guest(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id AND (is_anonymous OR email IS NULL));
$$;

-- ── create_duel ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_duel(
  p_opponent_id  UUID,
  p_type         TEXT    DEFAULT 'open',
  p_window_hours INTEGER DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_opp_email  TEXT;
  v_opp_lang   TEXT;
  v_me_name    TEXT;
  v_template   JSONB;
  v_row        public.duels%ROWTYPE;
  v_text       JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF public._duel_is_guest(v_uid) THEN RAISE EXCEPTION 'guest_account' USING ERRCODE = '42501'; END IF;
  IF p_opponent_id IS NULL THEN RAISE EXCEPTION 'opponent_required' USING ERRCODE = '22023'; END IF;
  IF p_opponent_id = v_uid THEN RAISE EXCEPTION 'cannot_duel_self' USING ERRCODE = '22023'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('open', 'mirror') THEN
    RAISE EXCEPTION 'invalid_duel_type' USING ERRCODE = '22023';
  END IF;
  IF p_window_hours IS NULL OR p_window_hours < 1 OR p_window_hours > 168 THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = '22023';
  END IF;

  SELECT email, preferred_language INTO v_opp_email, v_opp_lang
    FROM public.user_profiles WHERE id = p_opponent_id;
  IF v_opp_email IS NULL OR public._duel_is_guest(p_opponent_id) THEN
    RAISE EXCEPTION 'opponent_unavailable' USING ERRCODE = '22023';
  END IF;
  -- Either direction. is_blocked(viewer, email) covers "I block them" and
  -- "they block me".
  IF public.is_blocked(v_uid, v_opp_email) THEN
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

  IF p_type = 'mirror' THEN
    v_template := public._duel_mirror_template(v_uid);
    IF v_template IS NULL THEN RAISE EXCEPTION 'mirror_needs_workout' USING ERRCODE = '22023'; END IF;
  END IF;

  -- Pending rows expire when the opponent has had the window to answer.
  -- Accepting restarts it (respond_to_duel).
  INSERT INTO public.duels (challenger_id, opponent_id, type, status, session_template,
                            window_hours, expires_at)
  VALUES (v_uid, p_opponent_id, p_type::public.duel_type, 'pending', v_template,
          p_window_hours, now() + make_interval(hours => p_window_hours))
  RETURNING * INTO v_row;

  SELECT username INTO v_me_name FROM public.user_profiles WHERE id = v_uid;
  v_text := public.duel_invite_text(COALESCE(v_opp_lang, 'en'), COALESCE(v_me_name, 'Someone'), p_type);
  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_opponent_id, v_opp_email, 'duel_invite', v_text->>'title', v_text->>'body', '⚔️',
          '/duels?duel=' || v_row.id,
          jsonb_build_object('duel_id', v_row.id, 'duel_type', p_type,
                             'challenger_id', v_uid, 'challenger_name', v_me_name));

  RETURN to_jsonb(v_row);
END;
$$;

-- ── respond_to_duel / cancel_duel ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.respond_to_duel(p_duel_id UUID, p_accept BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.duels%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_row FROM public.duels WHERE id = p_duel_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.opponent_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_your_duel' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'duel_not_pending' USING ERRCODE = '22023'; END IF;
  IF v_row.expires_at <= now() THEN
    UPDATE public.duels SET status = 'expired' WHERE id = p_duel_id;
    RAISE EXCEPTION 'duel_expired' USING ERRCODE = '22023';
  END IF;

  IF p_accept THEN
    IF public._duel_is_guest(v_uid) THEN RAISE EXCEPTION 'guest_account' USING ERRCODE = '42501'; END IF;
    UPDATE public.duels
       SET status = 'active', accepted_at = now(),
           expires_at = now() + make_interval(hours => window_hours)
     WHERE id = p_duel_id
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.duels SET status = 'declined' WHERE id = p_duel_id RETURNING * INTO v_row;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_duel(p_duel_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.duels%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_row FROM public.duels WHERE id = p_duel_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.challenger_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_your_duel' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'duel_not_pending' USING ERRCODE = '22023'; END IF;
  UPDATE public.duels SET status = 'declined' WHERE id = p_duel_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

-- ── submit_duel_result_atomic: only an active duel, window from acceptance ──
-- Restated from the installed body (pg_get_functiondef, 2026-09-27). Changes:
-- refuses a pending or overdue duel, counts workouts from accepted_at, and
-- sends the result push itself so the client no longer needs
-- notify_duel_result_for.

CREATE OR REPLACE FUNCTION public.submit_duel_result_atomic(p_duel_id uuid, p_result jsonb, p_workout_log_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_duel public.duels%ROWTYPE;
  v_role TEXT; v_winner UUID; v_completed BOOLEAN := FALSE;
  v_log_owner UUID; v_log_created TIMESTAMPTZ; v_log_exercises JSONB; v_volume NUMERIC;
  v_safe_result JSONB; v_other UUID; v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_duel_id IS NULL OR p_result IS NULL THEN RAISE EXCEPTION 'duel_id and result required' USING ERRCODE = '22023'; END IF;
  IF p_workout_log_id IS NULL THEN RAISE EXCEPTION 'workout_log_required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_duel FROM public.duels WHERE id = p_duel_id FOR UPDATE;
  IF v_duel.id IS NULL THEN RAISE EXCEPTION 'duel not found' USING ERRCODE = '22023'; END IF;
  IF v_uid NOT IN (v_duel.challenger_id, v_duel.opponent_id) THEN
    RAISE EXCEPTION 'not your duel' USING ERRCODE = '42501';
  END IF;
  IF v_duel.status IN ('completed', 'expired', 'declined') THEN
    RETURN jsonb_build_object('duel_id', p_duel_id, 'status', v_duel.status, 'winner_id', v_duel.winner_id, 'already_final', TRUE);
  END IF;
  IF v_duel.status <> 'active' THEN RAISE EXCEPTION 'duel_not_active' USING ERRCODE = '22023'; END IF;
  IF v_duel.expires_at <= now() THEN RAISE EXCEPTION 'duel_expired' USING ERRCODE = '22023'; END IF;
  IF (v_uid = v_duel.challenger_id AND v_duel.challenger_result IS NOT NULL)
     OR (v_uid = v_duel.opponent_id AND v_duel.opponent_result IS NOT NULL) THEN
    RAISE EXCEPTION 'result_already_submitted' USING ERRCODE = '22023';
  END IF;

  SELECT user_id, created_at, exercises INTO v_log_owner, v_log_created, v_log_exercises
    FROM public.workout_logs WHERE id = p_workout_log_id;
  IF v_log_owner IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501'; END IF;
  -- Migration 362: a flagged log cannot buy an award.
  IF public.workout_log_is_flagged(p_workout_log_id) THEN
    RAISE EXCEPTION 'implausible_workout_log' USING ERRCODE = '22023';
  END IF;
  IF v_log_created < COALESCE(v_duel.accepted_at, v_duel.created_at) OR v_log_created > v_duel.expires_at THEN
    RAISE EXCEPTION 'workout_outside_duel_window' USING ERRCODE = '22023';
  END IF;

  v_safe_result := public._duel_metrics_from_log(v_log_exercises)
                    || jsonb_build_object('workout_log_id', p_workout_log_id, 'server_computed', TRUE);
  v_volume := COALESCE((v_safe_result->>'volume')::NUMERIC, 0);
  IF v_duel.challenger_id = v_uid THEN
    v_role := 'challenger'; v_other := v_duel.opponent_id;
    UPDATE public.duels SET challenger_result = v_safe_result WHERE id = p_duel_id RETURNING * INTO v_duel;
  ELSE
    v_role := 'opponent'; v_other := v_duel.challenger_id;
    UPDATE public.duels SET opponent_result = v_safe_result WHERE id = p_duel_id RETURNING * INTO v_duel;
  END IF;

  IF v_duel.challenger_result IS NOT NULL AND v_duel.opponent_result IS NOT NULL THEN
    v_winner := public._duel_resolve_winner(v_duel);
    UPDATE public.duels SET status = 'completed', winner_id = v_winner WHERE id = p_duel_id;
    v_completed := TRUE;
    SELECT COALESCE(NULLIF(username, ''), 'Someone') INTO v_name FROM public.user_profiles WHERE id = v_uid;
    PERFORM public._notify_duel_result_inner(v_other, p_duel_id,
      CASE WHEN v_winner IS NULL THEN 'tied' WHEN v_winner = v_other THEN 'won' ELSE 'lost' END,
      COALESCE(v_name, 'Someone'));
  END IF;

  RETURN jsonb_build_object('duel_id', p_duel_id, 'role', v_role,
    'status', CASE WHEN v_completed THEN 'completed' ELSE 'active' END,
    'winner_id', v_winner, 'completed', v_completed, 'already_final', FALSE, 'server_volume', v_volume);
END;
$function$;

-- ── Expiry sweep: a no-show loses by walkover ──────────────────────────────

CREATE OR REPLACE FUNCTION public.expire_overdue_duels()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  d       public.duels%ROWTYPE;
  v_win   UUID;
  v_lose  UUID;
  v_name  TEXT;
  v_n     INTEGER := 0;
BEGIN
  FOR d IN
    SELECT * FROM public.duels
     WHERE status = 'active' AND expires_at < now()
       AND ((challenger_result IS NULL) <> (opponent_result IS NULL))
     FOR UPDATE SKIP LOCKED
  LOOP
    v_win  := CASE WHEN d.challenger_result IS NOT NULL THEN d.challenger_id ELSE d.opponent_id END;
    v_lose := CASE WHEN v_win = d.challenger_id THEN d.opponent_id ELSE d.challenger_id END;
    UPDATE public.duels SET status = 'completed', winner_id = v_win WHERE id = d.id;
    SELECT COALESCE(NULLIF(username, ''), 'Someone') INTO v_name FROM public.user_profiles WHERE id = v_lose;
    PERFORM public._notify_duel_result_inner(v_win, d.id, 'won', COALESCE(v_name, 'Someone'));
    SELECT COALESCE(NULLIF(username, ''), 'Someone') INTO v_name FROM public.user_profiles WHERE id = v_win;
    PERFORM public._notify_duel_result_inner(v_lose, d.id, 'lost', COALESCE(v_name, 'Someone'));
    v_n := v_n + 1;
  END LOOP;

  UPDATE public.duels SET status = 'expired'
   WHERE status IN ('pending', 'active') AND expires_at < now();
  RETURN v_n;
END;
$$;

SELECT cron.schedule('expire-overdue-duels', '*/15 * * * *', $$SELECT public.expire_overdue_duels();$$);

-- ── Invite links: no guests, no Exercise, Mirror gets a template ───────────
-- Both restated from the installed bodies (pg_get_functiondef, 2026-09-27).

CREATE OR REPLACE FUNCTION public.create_pending_duel_invite(p_duel_type text DEFAULT 'open'::text, p_session_template jsonb DEFAULT NULL::jsonb, p_target_exercise_id text DEFAULT NULL::text, p_window_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_username  TEXT;
  v_avatar    TEXT;
  v_token     TEXT;
  v_invite_id UUID;
  v_expires   TIMESTAMPTZ;
  v_template  JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF public._duel_is_guest(v_uid) THEN
    RAISE EXCEPTION 'guest_account' USING ERRCODE = '42501';
  END IF;
  IF p_duel_type NOT IN ('open', 'mirror') THEN
    RAISE EXCEPTION 'invalid duel_type' USING ERRCODE = '22023';
  END IF;
  IF p_window_hours IS NULL OR p_window_hours < 1 OR p_window_hours > 168 THEN
    RAISE EXCEPTION 'window_hours must be between 1 and 168' USING ERRCODE = '22023';
  END IF;
  IF p_duel_type = 'mirror' THEN
    v_template := public._duel_mirror_template(v_uid);
    IF v_template IS NULL THEN RAISE EXCEPTION 'mirror_needs_workout' USING ERRCODE = '22023'; END IF;
  END IF;

  SELECT username, avatar_url
    INTO v_username, v_avatar
    FROM public.user_profiles
   WHERE id = v_uid;

  v_token   := encode(gen_random_bytes(16), 'hex');
  v_expires := NOW() + (p_window_hours || ' hours')::INTERVAL + INTERVAL '7 days';

  INSERT INTO public.pending_duel_invites
    (claim_token, challenger_id, challenger_username, challenger_avatar_url,
     duel_type, session_template, target_exercise_id, window_hours, expires_at)
  VALUES
    (v_token, v_uid, v_username, v_avatar,
     p_duel_type, v_template, NULL, p_window_hours, v_expires)
  RETURNING id INTO v_invite_id;

  RETURN jsonb_build_object(
    'id',           v_invite_id,
    'token',        v_token,
    'expires_at',   v_expires,
    'duel_type',    p_duel_type,
    'window_hours', p_window_hours
  );
END;
$function$;

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

-- ── Trophies: a duel counts once it was fought ─────────────────────────────
-- "Fought your first duel" was granted for sending a challenge nobody
-- answered (2 of the 2 duelplay_1 trophies in production came that way; they
-- are left alone). Played and won now both require status = 'completed'.
-- Restated from the installed body (pg_get_functiondef, 2026-09-27); only the
-- two duel lines differ.

CREATE OR REPLACE FUNCTION public.get_trophy_progress()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid(); v_email TEXT := COALESCE(auth.email(), '');
  v_workouts NUMERIC := 0; v_volume NUMERIC := 0; v_lifts NUMERIC := 0;
  v_streak NUMERIC := 0; v_months NUMERIC := 0; v_quests NUMERIC := 0;
  v_perfect NUMERIC := 0; v_maxdist NUMERIC := 0; v_totdist NUMERIC := 0;
  v_acttypes NUMERIC := 0; v_level NUMERIC := 1; v_prestige NUMERIC := 0;
  v_goals NUMERIC := 0; v_duelwins NUMERIC := 0; v_bounties NUMERIC := 0;
  v_gaunt NUMERIC := 0; v_gauntpath NUMERIC := 0; v_crew NUMERIC := 0;
  v_crewwars NUMERIC := 0; v_posts NUMERIC := 0; v_checkins NUMERIC := 0;
  v_capsules NUMERIC := 0; v_relics NUMERIC := 0;
  v_meals NUMERIC := 0; v_ndays NUMERIC := 0; v_sleep NUMERIC := 0;
  v_journal NUMERIC := 0; v_debriefs NUMERIC := 0; v_regimens NUMERIC := 0;
  v_duelplay NUMERIC := 0; v_comments NUMERIC := 0; v_followers NUMERIC := 0;
  v_coins NUMERIC := 0; v_market NUMERIC := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;

  SELECT workout_streak, current_level, prestige_level, total_volume_lbs
    INTO v_streak, v_level, v_prestige, v_volume FROM public.user_profiles WHERE id = v_uid;
  v_streak := COALESCE(v_streak,0); v_level := COALESCE(v_level,1);
  v_prestige := COALESCE(v_prestige,0); v_volume := COALESCE(v_volume,0);

  SELECT COUNT(*) INTO v_workouts FROM public.workout_logs WHERE user_id=v_uid OR created_by=v_email;
  SELECT COUNT(DISTINCT date_trunc('month', date)) INTO v_months FROM public.workout_logs
   WHERE (user_id=v_uid OR created_by=v_email) AND date IS NOT NULL;
  SELECT COUNT(DISTINCT lower(trim(elem ->> 'name'))) INTO v_lifts FROM public.workout_logs
    CROSS JOIN LATERAL jsonb_array_elements(exercises) AS elem
   WHERE (user_id=v_uid OR created_by=v_email) AND jsonb_typeof(exercises)='array'
     AND COALESCE(trim(elem ->> 'name'),'') <> '';
  SELECT COALESCE(MAX(distance_meters),0), COALESCE(SUM(distance_meters),0), COUNT(DISTINCT activity_type)
    INTO v_maxdist, v_totdist, v_acttypes FROM public.cardio_logs WHERE user_id=v_uid OR created_by=v_email;
  SELECT quests_claimed, perfect_days INTO v_quests, v_perfect FROM public.user_quest_stats WHERE user_id=v_uid;
  v_quests := COALESCE(v_quests,0); v_perfect := COALESCE(v_perfect,0);
  SELECT COUNT(*) INTO v_goals FROM public.goals WHERE (user_id=v_uid OR created_by=v_email) AND status='completed';
  SELECT COUNT(*) INTO v_duelwins FROM public.duels WHERE winner_id=v_uid AND status='completed';
  SELECT COUNT(*) INTO v_duelplay FROM public.duels WHERE (challenger_id=v_uid OR opponent_id=v_uid) AND status='completed';
  SELECT COUNT(*) INTO v_bounties FROM public.bounties WHERE claimed_by_id=v_uid;
  SELECT challenges_completed, CASE WHEN COALESCE(path_completed,false) THEN 1 ELSE 0 END
    INTO v_gaunt, v_gauntpath FROM public.user_gauntlet_progress WHERE user_id=v_uid;
  v_gaunt := COALESCE(v_gaunt,0); v_gauntpath := COALESCE(v_gauntpath,0);
  SELECT COUNT(*) INTO v_crew FROM public.crew_members WHERE user_id=v_uid;
  SELECT COUNT(DISTINCT war_id) INTO v_crewwars FROM public.crew_war_contributions WHERE user_id=v_uid;
  SELECT COUNT(*) INTO v_posts FROM public.hub_posts WHERE user_id=v_uid OR created_by=v_email;
  SELECT COUNT(*) INTO v_checkins FROM public.gym_checkins WHERE user_id=v_uid;
  SELECT COUNT(*) INTO v_capsules FROM public.user_capsules WHERE user_id=v_uid AND COALESCE(is_opened,false);
  SELECT COUNT(*) INTO v_relics FROM public.user_inventory
   WHERE user_id=v_uid AND item_rarity IN ('legendary','mythic','animated');

  SELECT COUNT(*) INTO v_meals FROM public.nutrition_logs WHERE user_id=v_uid OR created_by=v_email;
  SELECT COUNT(DISTINCT date) INTO v_ndays FROM public.nutrition_logs
   WHERE (user_id=v_uid OR created_by=v_email) AND date IS NOT NULL;
  SELECT COUNT(*) INTO v_sleep FROM public.sleep_logs WHERE user_id=v_uid;
  SELECT COUNT(*) INTO v_journal FROM public.journal_entries WHERE user_id=v_uid;
  SELECT COUNT(*) INTO v_debriefs FROM public.weekly_debriefs WHERE user_id=v_uid;
  SELECT COUNT(*) INTO v_regimens FROM public.regimens WHERE user_id=v_uid OR created_by=v_email;
  SELECT COUNT(*) INTO v_comments FROM public.hub_comments WHERE user_id=v_uid OR created_by=v_email;
  SELECT COUNT(*) INTO v_followers FROM public.hub_follows WHERE followee_id=v_uid;
  SELECT COALESCE(SUM(delta),0) INTO v_coins FROM public.flex_coin_ledger WHERE user_id=v_uid AND delta>0;
  SELECT COUNT(*) INTO v_market FROM public.marketplace_listings WHERE seller_user_id=v_uid AND status='completed';

  RETURN jsonb_build_object(
    'workouts',v_workouts,'volumeLbs',v_volume,'distinctLifts',v_lifts,'workoutStreak',v_streak,
    'activeMonths',v_months,'questsClaimed',v_quests,'perfectDays',v_perfect,'maxDistanceM',v_maxdist,
    'totalDistanceM',v_totdist,'activityTypes',v_acttypes,'level',v_level,'prestige',v_prestige,
    'goalsDone',v_goals,'duelWins',v_duelwins,'bountiesClaimed',v_bounties,'gauntletDone',v_gaunt,
    'gauntletPath',v_gauntpath,'crewCount',v_crew,'crewWars',v_crewwars,'posts',v_posts,
    'checkins',v_checkins,'capsulesOpened',v_capsules,'legendaries',v_relics,
    'meals',v_meals,'nutritionDays',v_ndays,'sleepLogs',v_sleep,'journalEntries',v_journal,
    'debriefs',v_debriefs,'regimens',v_regimens,'duelsPlayed',v_duelplay,'comments',v_comments,
    'followers',v_followers,'coinsEarned',v_coins,'marketSales',v_market);
END; $function$;

-- ── Grants ─────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.create_duel(UUID, TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_duel(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_duel(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_duel(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_duel(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_duel(UUID) TO authenticated;

-- Internal. The two notify RPCs let a participant re-send the same push as
-- often as they liked; the RPCs above now send them exactly once.
REVOKE ALL ON FUNCTION public.expire_overdue_duels() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_mirror_template(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_is_guest(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_duel_invite_for(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_duel_result_for(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_resolve_winner(public.duels) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_calc_volume(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_score_mirror(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_metrics_from_log(JSONB) FROM PUBLIC, anon, authenticated;

-- ── Attempt it ─────────────────────────────────────────────────────────────
-- Throwaway accounts, rolled back by the closing RAISE. RPCs run with a real
-- JWT claim so auth.uid() resolves as it does for a client; the direct writes
-- run as `authenticated` so RLS and grants apply.

DO $$
DECLARE
  a UUID := gen_random_uuid();   -- challenger with a workout
  b UUID := gen_random_uuid();   -- opponent
  c UUID := gen_random_uuid();   -- third party
  g UUID := gen_random_uuid();   -- guest
  d JSONB; m JSONB; r JSONB;
  v_id UUID; v_log UUID; v_old UUID;
  v_failed BOOLEAN;
  sets JSONB := '[{"name":"Bench Press","sets":[{"weight":"100","reps":"10"},{"weight":"100","reps":"8"}]}]';
  big  JSONB := '[{"name":"Bench Press","sets":[{"weight":"150","reps":"10"},{"weight":"150","reps":"10"}]}]';
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (a, 'duel-probe-a-' || a || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (b, 'duel-probe-b-' || b || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (c, 'duel-probe-c-' || c || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (g, NULL, 'authenticated', 'authenticated', TRUE);
    INSERT INTO public.user_profiles (id, email, username)
    VALUES (a, 'duel-probe-a-' || a || '@example.invalid', 'probe_a_' || left(a::text, 8)),
           (b, 'duel-probe-b-' || b || '@example.invalid', 'probe_b_' || left(b::text, 8)),
           (c, 'duel-probe-c-' || c || '@example.invalid', 'probe_c_' || left(c::text, 8))
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username;
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, sets, now() - interval '1 day');

    -- A guest cannot challenge.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
    v_failed := FALSE;
    BEGIN PERFORM public.create_duel(b, 'open', 24); EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: a guest created a duel'; END IF;

    -- Nobody can challenge a guest, and Exercise is refused.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    v_failed := FALSE;
    BEGIN PERFORM public.create_duel(g, 'open', 24); EXCEPTION WHEN invalid_parameter_value THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: challenged a guest'; END IF;
    v_failed := FALSE;
    BEGIN PERFORM public.create_duel(b, 'exercise', 24); EXCEPTION WHEN invalid_parameter_value THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: created an Exercise duel'; END IF;

    -- Mirror copies the challenger's own last workout.
    m := public.create_duel(b, 'mirror', 24);
    IF m->'session_template'->'exercises' IS DISTINCT FROM sets THEN
      RAISE EXCEPTION 'probe: mirror template was %', m->'session_template';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = b AND type = 'duel_invite'
                    AND link_url = '/duels?duel=' || (m->>'id')) THEN
      RAISE EXCEPTION 'probe: no invite notification for the opponent';
    END IF;
    -- One open duel per pair.
    v_failed := FALSE;
    BEGIN PERFORM public.create_duel(b, 'open', 24); EXCEPTION WHEN invalid_parameter_value THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: second open duel against the same person'; END IF;
    PERFORM public.cancel_duel((m->>'id')::uuid);

    d := public.create_duel(b, 'open', 24);
    v_id := (d->>'id')::uuid;

    -- Clients can no longer write the table: no forged win, no forged row.
    SET LOCAL ROLE authenticated;
    v_failed := FALSE;
    BEGIN UPDATE public.duels SET status = 'completed', winner_id = a WHERE id = v_id;
    EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RESET ROLE; RAISE EXCEPTION 'probe: a participant wrote their own win'; END IF;
    v_failed := FALSE;
    BEGIN INSERT INTO public.duels (challenger_id, opponent_id, status, winner_id) VALUES (a, c, 'completed', a);
    EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RESET ROLE; RAISE EXCEPTION 'probe: a client inserted a finished duel'; END IF;
    -- They can still read their own duel.
    IF NOT EXISTS (SELECT 1 FROM public.duels WHERE id = v_id) THEN
      RESET ROLE; RAISE EXCEPTION 'probe: a participant cannot read their duel';
    END IF;
    RESET ROLE;

    -- Only the opponent answers, and a result before acceptance is refused.
    v_failed := FALSE;
    BEGIN PERFORM public.respond_to_duel(v_id, TRUE); EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: the challenger accepted their own duel'; END IF;
    SELECT id INTO v_old FROM public.workout_logs WHERE user_id = a ORDER BY created_at DESC LIMIT 1;
    v_failed := FALSE;
    BEGIN PERFORM public.submit_duel_result_atomic(v_id, '{}'::jsonb, v_old); EXCEPTION WHEN invalid_parameter_value THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: submitted to a pending duel'; END IF;

    -- Accepting starts the window from now.
    UPDATE public.duels SET created_at = now() - interval '20 hours',
                            expires_at = now() + interval '4 hours' WHERE id = v_id;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    r := public.respond_to_duel(v_id, TRUE);
    IF r->>'status' <> 'active' OR (r->>'expires_at')::timestamptz < now() + interval '23 hours' THEN
      RAISE EXCEPTION 'probe: accept left status % expiring %', r->>'status', r->>'expires_at';
    END IF;

    -- A workout from before the duel was accepted does not count.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    v_failed := FALSE;
    BEGIN PERFORM public.submit_duel_result_atomic(v_id, '{}'::jsonb, v_old); EXCEPTION WHEN invalid_parameter_value THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: counted a workout from before the duel'; END IF;

    -- Both train; the bigger session wins and the loser is told.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, big, now()) RETURNING id INTO v_log;
    PERFORM public.submit_duel_result_atomic(v_id, '{}'::jsonb, v_log);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', b, sets, now()) RETURNING id INTO v_log;
    r := public.submit_duel_result_atomic(v_id, '{}'::jsonb, v_log);
    IF (r->>'winner_id')::uuid IS DISTINCT FROM a OR r->>'status' <> 'completed' THEN
      RAISE EXCEPTION 'probe: result was %', r;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = a AND type = 'duel_result') THEN
      RAISE EXCEPTION 'probe: winner got no result notification';
    END IF;

    -- Walkover: C accepts, only C trains, the window closes, C wins.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    d := public.create_duel(c, 'open', 24);
    v_id := (d->>'id')::uuid;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
    PERFORM public.respond_to_duel(v_id, TRUE);
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', c, sets, now()) RETURNING id INTO v_log;
    PERFORM public.submit_duel_result_atomic(v_id, '{}'::jsonb, v_log);
    UPDATE public.duels SET expires_at = now() - interval '1 minute' WHERE id = v_id;
    PERFORM public.expire_overdue_duels();
    IF (SELECT winner_id FROM public.duels WHERE id = v_id) IS DISTINCT FROM c
       OR (SELECT status FROM public.duels WHERE id = v_id) <> 'completed' THEN
      RAISE EXCEPTION 'probe: walkover did not go to the lifter who trained';
    END IF;

    -- Trophy progress counts only fought duels: A has two completed.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    r := public.get_trophy_progress();
    IF (r->>'duelsPlayed')::int <> 2 OR (r->>'duelWins')::int <> 1 THEN
      RAISE EXCEPTION 'probe: trophy progress played % won %', r->>'duelsPlayed', r->>'duelWins';
    END IF;

    RAISE EXCEPTION 'duel-probe-ok';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'duel-probe-ok' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
