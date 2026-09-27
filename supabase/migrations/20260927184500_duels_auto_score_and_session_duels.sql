-- Duels score themselves, and you can take on someone's session without them.
--
-- Kegan, 2026-09-27 (Duels thread, "start"), on the two changes proposed after
-- the lockdown in 20260927161000:
--
-- 1. Automatic scoring. A duel used to need a trip back to the duel to tap
--    Submit and pick a workout. In production nobody ever did: 19 duels, not
--    one result. Now a trigger on workout_logs keeps each side's result as the
--    BEST plausible session logged inside the duel window, the same way Rival
--    scores itself from logs. A live duel settles when its window closes
--    (expire_overdue_duels, every 15 minutes), so both sides can answer until
--    then. `submit_duel_result_atomic` stays for installed builds that still
--    call it, and now just refreshes the caller's side.
--
-- 2. Session duels ("beat my session"). With about one active registered user
--    a week, a duel that needs the other person to accept rarely starts. A
--    session duel is a Mirror against the opponent's latest plausible
--    workout: it starts at once, the opponent's side is that workout, and
--    only the challenger trains. It ends the moment the challenger beats it,
--    or when the window closes. `duels.mode` tells the two apart. The
--    opponent hears about it only if their session is beaten.
--
--    Privacy: the session is the opponent's exercises and weights, so a
--    private profile can be taken on only by someone who follows it (the
--    public_profiles full_view rule). Guests are refused both ways.
--
--    Trophies: session duels do not count toward the Arena trophies. Picking
--    a weak session to beat would otherwise mint wins, and the opponent never
--    agreed to play. Live duels count as before.

-- ── Mode ───────────────────────────────────────────────────────────────────

ALTER TABLE public.duels ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'live';
ALTER TABLE public.duels DROP CONSTRAINT IF EXISTS duels_mode_check;
ALTER TABLE public.duels ADD CONSTRAINT duels_mode_check CHECK (mode IN ('live', 'session'));

-- ── Scoring helpers ────────────────────────────────────────────────────────

-- One number per side, the same rule _duel_resolve_winner applies.
CREATE OR REPLACE FUNCTION public._duel_score(p_type public.duel_type, p_result JSONB, p_template JSONB)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT CASE
    WHEN p_result IS NULL THEN NULL
    WHEN p_type = 'mirror' THEN public._duel_score_mirror(p_result, p_template)::NUMERIC
    WHEN p_type = 'open'   THEN COALESCE((p_result->>'volume')::NUMERIC, 0)
    ELSE COALESCE((p_result->>'reps')::NUMERIC, (p_result->>'weight')::NUMERIC, 0)
  END;
$$;

-- A side's result: its best plausible session inside the window, or NULL.
-- A log whose sets cannot be read (a crafted weight of '') is skipped rather
-- than failing the whole calculation.
CREATE OR REPLACE FUNCTION public._duel_side_result(p_duel public.duels, p_user UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
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
      v_m := public._duel_metrics_from_log(l.exercises);
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
$$;

-- Result pushes open the duel itself, not the list.
CREATE OR REPLACE FUNCTION public._notify_duel_result_inner(p_recipient_id uuid, p_duel_id uuid, p_outcome text, p_actor_name text DEFAULT 'Someone'::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email TEXT;
  v_lang  TEXT;
  v_text  JSONB;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_recipient_id;
  IF v_email IS NULL THEN RETURN; END IF;
  SELECT preferred_language INTO v_lang FROM public.user_profiles WHERE id = p_recipient_id;
  v_text := public.duel_result_text(COALESCE(v_lang, 'en'), p_actor_name, p_outcome);
  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_recipient_id, v_email, 'duel_result', v_text ->> 'title', NULL, '⚔️',
          '/duels?duel=' || p_duel_id,
          jsonb_build_object('duel_id', p_duel_id, 'outcome', p_outcome));
END;
$$;

CREATE OR REPLACE FUNCTION public._duel_name(p_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT COALESCE((SELECT NULLIF(username, '') FROM public.user_profiles WHERE id = p_user), 'Someone');
$$;

-- Recompute one side of one duel and finish a session duel that was just won.
-- Callers hold the row lock.
CREATE OR REPLACE FUNCTION public._duel_refresh_side(p_duel_id UUID, p_user UUID)
RETURNS public.duels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
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
    PERFORM public._notify_duel_result_inner(d.challenger_id, d.id, 'won', public._duel_name(d.opponent_id));
    PERFORM public._notify_duel_result_inner(d.opponent_id, d.id, 'lost', public._duel_name(d.challenger_id));
  END IF;
  RETURN d;
END;
$$;

-- ── Trigger: every saved, edited or deleted workout re-scores open duels ───

CREATE OR REPLACE FUNCTION public.duels_on_workout_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_id  UUID;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  FOR v_id IN
    SELECT id FROM public.duels
     WHERE status = 'active' AND expires_at > now()
       AND (challenger_id = v_uid OR (opponent_id = v_uid AND mode = 'live'))
     ORDER BY id
     FOR UPDATE
  LOOP
    PERFORM public._duel_refresh_side(v_id, v_uid);
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A duel score is never worth losing a workout over.
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS duels_on_workout_log ON public.workout_logs;
CREATE TRIGGER duels_on_workout_log
  AFTER INSERT OR UPDATE OF exercises OR DELETE ON public.workout_logs
  FOR EACH ROW EXECUTE FUNCTION public.duels_on_workout_log();

-- ── Session duels ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_session_duel(
  p_opponent_id  UUID,
  p_window_hours INTEGER DEFAULT 48
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
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
  v_theirs := public._duel_metrics_from_log(v_template->'exercises');
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
$$;

-- ── Manual refresh (installed builds still call this) ──────────────────────

CREATE OR REPLACE FUNCTION public.submit_duel_result_atomic(p_duel_id uuid, p_result jsonb, p_workout_log_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  d     public.duels%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.duels WHERE id = p_duel_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'duel not found' USING ERRCODE = '22023'; END IF;
  IF v_uid NOT IN (d.challenger_id, d.opponent_id) THEN
    RAISE EXCEPTION 'not your duel' USING ERRCODE = '42501';
  END IF;
  IF d.status IN ('completed', 'expired', 'declined') THEN
    RETURN jsonb_build_object('duel_id', d.id, 'status', d.status, 'winner_id', d.winner_id, 'already_final', TRUE);
  END IF;
  IF d.status <> 'active' THEN RAISE EXCEPTION 'duel_not_active' USING ERRCODE = '22023'; END IF;
  IF d.expires_at <= now() THEN RAISE EXCEPTION 'duel_expired' USING ERRCODE = '22023'; END IF;
  d := public._duel_refresh_side(d.id, v_uid);
  RETURN jsonb_build_object('duel_id', d.id, 'status', d.status, 'winner_id', d.winner_id,
                            'completed', d.status = 'completed', 'already_final', FALSE);
END;
$$;

-- ── Settle when the window closes ──────────────────────────────────────────
-- Live: both trained, the better best-session wins (a tie has no winner); one
-- trained, a walkover; neither, expired. Session: the challenger's best
-- missed the bar, the opponent's session holds (winner, or a tie); the
-- challenger never trained, expired quietly. A beaten session finished the
-- moment it was beaten, in _duel_refresh_side.

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
  v_n     INTEGER := 0;
BEGIN
  FOR d IN
    SELECT * FROM public.duels
     WHERE status = 'active' AND expires_at < now()
       AND (challenger_result IS NOT NULL OR (mode = 'live' AND opponent_result IS NOT NULL))
     FOR UPDATE SKIP LOCKED
  LOOP
    IF d.challenger_result IS NOT NULL AND d.opponent_result IS NOT NULL THEN
      v_win := public._duel_resolve_winner(d);
      UPDATE public.duels SET status = 'completed', winner_id = v_win WHERE id = d.id;
      IF d.mode = 'session' THEN
        -- Only the lifter who chose to play hears how it went.
        PERFORM public._notify_duel_result_inner(d.challenger_id, d.id,
          CASE WHEN v_win IS NULL THEN 'tied' ELSE 'lost' END, public._duel_name(d.opponent_id));
      ELSE
        PERFORM public._notify_duel_result_inner(d.challenger_id, d.id,
          CASE WHEN v_win IS NULL THEN 'tied' WHEN v_win = d.challenger_id THEN 'won' ELSE 'lost' END,
          public._duel_name(d.opponent_id));
        PERFORM public._notify_duel_result_inner(d.opponent_id, d.id,
          CASE WHEN v_win IS NULL THEN 'tied' WHEN v_win = d.opponent_id THEN 'won' ELSE 'lost' END,
          public._duel_name(d.challenger_id));
      END IF;
    ELSE
      -- Live walkover: only one side trained.
      v_win  := CASE WHEN d.challenger_result IS NOT NULL THEN d.challenger_id ELSE d.opponent_id END;
      v_lose := CASE WHEN v_win = d.challenger_id THEN d.opponent_id ELSE d.challenger_id END;
      UPDATE public.duels SET status = 'completed', winner_id = v_win WHERE id = d.id;
      PERFORM public._notify_duel_result_inner(v_win, d.id, 'won', public._duel_name(v_lose));
      PERFORM public._notify_duel_result_inner(v_lose, d.id, 'lost', public._duel_name(v_win));
    END IF;
    v_n := v_n + 1;
  END LOOP;

  UPDATE public.duels SET status = 'expired'
   WHERE status IN ('pending', 'active') AND expires_at < now();
  RETURN v_n;
END;
$$;

-- ── Trophies: only live duels count ────────────────────────────────────────
-- Restated from 20260927161000; only the two duel lines differ.

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
  SELECT COUNT(*) INTO v_duelwins FROM public.duels WHERE winner_id=v_uid AND status='completed' AND mode='live';
  SELECT COUNT(*) INTO v_duelplay FROM public.duels WHERE (challenger_id=v_uid OR opponent_id=v_uid) AND status='completed' AND mode='live';
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

REVOKE ALL ON FUNCTION public.create_session_duel(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_session_duel(UUID, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public._duel_score(public.duel_type, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_side_result(public.duels, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_refresh_side(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_name(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._notify_duel_result_inner(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.duels_on_workout_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_overdue_duels() FROM PUBLIC, anon, authenticated;

-- ── Attempt it ─────────────────────────────────────────────────────────────
-- Throwaway accounts, rolled back by the closing RAISE. Workouts are inserted
-- as they are by the app, so the trigger does the scoring.

DO $$
DECLARE
  a UUID := gen_random_uuid();   -- challenger
  b UUID := gen_random_uuid();   -- opponent
  c UUID := gen_random_uuid();   -- walkover opponent
  p UUID := gen_random_uuid();   -- private lifter
  d JSONB; r JSONB; v_row public.duels%ROWTYPE;
  v_id UUID; v_log UUID;
  v_failed BOOLEAN;
  small JSONB := '[{"name":"Bench Press","sets":[{"weight":"100","reps":"10"},{"weight":"100","reps":"8"}]}]';
  mid   JSONB := '[{"name":"Bench Press","sets":[{"weight":"120","reps":"10"},{"weight":"120","reps":"10"}]}]';
  big   JSONB := '[{"name":"Bench Press","sets":[{"weight":"150","reps":"10"},{"weight":"150","reps":"10"}]}]';
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (a, 'ds-probe-a-' || a || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (b, 'ds-probe-b-' || b || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (c, 'ds-probe-c-' || c || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (p, 'ds-probe-p-' || p || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email, username, is_private)
    VALUES (a, 'ds-probe-a-' || a || '@example.invalid', 'dsprobe_a_' || left(a::text, 8), FALSE),
           (b, 'ds-probe-b-' || b || '@example.invalid', 'dsprobe_b_' || left(b::text, 8), FALSE),
           (c, 'ds-probe-c-' || c || '@example.invalid', 'dsprobe_c_' || left(c::text, 8), FALSE),
           (p, 'ds-probe-p-' || p || '@example.invalid', 'dsprobe_p_' || left(p::text, 8), TRUE)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username,
                                   is_private = EXCLUDED.is_private;
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', b, mid, now() - interval '2 days'),
           ('probe', p, mid, now() - interval '2 days');

    -- ── Live duel scores itself ──
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    d := public.create_duel(b, 'open', 24);
    v_id := (d->>'id')::uuid;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    PERFORM public.respond_to_duel(v_id, TRUE);

    -- A saves a workout: their side fills in with no Submit.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, small, now());
    SELECT * INTO v_row FROM public.duels WHERE id = v_id;
    IF (v_row.challenger_result->>'volume')::numeric IS DISTINCT FROM 1800 THEN
      RAISE EXCEPTION 'probe: challenger result after a save was %', v_row.challenger_result;
    END IF;
    -- A better session replaces it; a worse one does not. (An unreadable set,
    -- a weight of '', never reaches the table: workout_logs_flag_implausible
    -- refuses the insert, so there is nothing to probe there.)
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, big, now()) RETURNING id INTO v_log;
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, small, now());
    SELECT * INTO v_row FROM public.duels WHERE id = v_id;
    IF (v_row.challenger_result->>'workout_log_id')::uuid IS DISTINCT FROM v_log THEN
      RAISE EXCEPTION 'probe: best session not kept, result %', v_row.challenger_result;
    END IF;
    -- Deleting the best session falls back to the next best.
    DELETE FROM public.workout_logs WHERE id = v_log;
    SELECT * INTO v_row FROM public.duels WHERE id = v_id;
    IF (v_row.challenger_result->>'volume')::numeric IS DISTINCT FROM 1800 THEN
      RAISE EXCEPTION 'probe: delete did not rescore, result %', v_row.challenger_result;
    END IF;
    -- B answers with more; a live duel stays open until the window closes.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', b, mid, now());
    SELECT * INTO v_row FROM public.duels WHERE id = v_id;
    IF v_row.status <> 'active' OR v_row.opponent_result IS NULL THEN
      RAISE EXCEPTION 'probe: live duel was % with opponent result %', v_row.status, v_row.opponent_result;
    END IF;
    UPDATE public.duels SET expires_at = now() - interval '1 minute' WHERE id = v_id;
    PERFORM public.expire_overdue_duels();
    SELECT * INTO v_row FROM public.duels WHERE id = v_id;
    IF v_row.status <> 'completed' OR v_row.winner_id IS DISTINCT FROM b THEN
      RAISE EXCEPTION 'probe: live settle gave % to %', v_row.status, v_row.winner_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = a AND type = 'duel_result'
                    AND link_url = '/duels?duel=' || v_id) THEN
      RAISE EXCEPTION 'probe: loser got no result push linking the duel';
    END IF;

    -- ── Walkover still works ──
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    d := public.create_duel(c, 'open', 24);
    v_id := (d->>'id')::uuid;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
    PERFORM public.respond_to_duel(v_id, TRUE);
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', c, small, now());
    UPDATE public.duels SET expires_at = now() - interval '1 minute' WHERE id = v_id;
    PERFORM public.expire_overdue_duels();
    IF (SELECT winner_id FROM public.duels WHERE id = v_id) IS DISTINCT FROM c THEN
      RAISE EXCEPTION 'probe: walkover did not go to the lifter who trained';
    END IF;

    -- ── Session duels ──
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    -- A private profile you do not follow cannot be taken on.
    v_failed := FALSE;
    BEGIN PERFORM public.create_session_duel(p, 48); EXCEPTION WHEN invalid_parameter_value THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: took on a private session'; END IF;
    -- Someone with no session cannot be taken on.
    v_failed := FALSE;
    BEGIN PERFORM public.create_session_duel(c, 48); EXCEPTION WHEN invalid_parameter_value THEN v_failed := TRUE; END;
    IF v_failed THEN
      -- c trained above, so this must succeed; cancel by expiring it.
      RAISE EXCEPTION 'probe: session duel against a lifter with a session was refused';
    END IF;
    UPDATE public.duels SET status = 'expired' WHERE challenger_id = a AND opponent_id = c AND mode = 'session';

    d := public.create_session_duel(b, 48);
    v_id := (d->>'id')::uuid;
    IF d->>'status' <> 'active' OR d->>'mode' <> 'session' OR d->'opponent_result' IS NULL THEN
      RAISE EXCEPTION 'probe: session duel started as %', d;
    END IF;
    -- B training now does not move the bar.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', b, big, now());
    IF (SELECT opponent_result FROM public.duels WHERE id = v_id) IS DISTINCT FROM d->'opponent_result' THEN
      RAISE EXCEPTION 'probe: the opponent moved their own bar';
    END IF;
    -- A falls short: still open.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, small, now());
    IF (SELECT status FROM public.duels WHERE id = v_id) <> 'active' THEN
      RAISE EXCEPTION 'probe: a losing attempt closed the session duel';
    END IF;
    -- A beats it: finished at once, B hears about it.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, big, now());
    SELECT * INTO v_row FROM public.duels WHERE id = v_id;
    IF v_row.status <> 'completed' OR v_row.winner_id IS DISTINCT FROM a THEN
      RAISE EXCEPTION 'probe: beating the session left % winner %', v_row.status, v_row.winner_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = b AND type = 'duel_result'
                    AND link_url = '/duels?duel=' || v_id) THEN
      RAISE EXCEPTION 'probe: the beaten lifter was not told';
    END IF;

    -- Clients still cannot write duels.
    SET LOCAL ROLE authenticated;
    v_failed := FALSE;
    BEGIN UPDATE public.duels SET mode = 'live' WHERE id = v_id;
    EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
    RESET ROLE;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: a client rewrote a duel'; END IF;

    -- Trophies count the live duels only: A played 2 live, won none.
    r := public.get_trophy_progress();
    IF (r->>'duelsPlayed')::int <> 2 OR (r->>'duelWins')::int <> 0 THEN
      RAISE EXCEPTION 'probe: trophy progress played % won %', r->>'duelsPlayed', r->>'duelWins';
    END IF;

    RAISE EXCEPTION 'ds-probe-ok';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ds-probe-ok' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
