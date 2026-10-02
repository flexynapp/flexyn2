-- Audit leftovers (app audit, second pass, 2026-10-02).
--
-- 1. Gym check-in counted the UTC day, not the lifter's day.
--    check_in_to_gym stamped checkin_date with the UTC date, and
--    grant_workout_xp / has_gym_checkin_today looked for a row on the UTC
--    date. For anyone west of UTC, checking in at 7pm and training at 9pm
--    landed on "tomorrow" in UTC, and a workout logged the next morning
--    could still collect yesterday's 1.2x. All three now use the user's
--    local date (user_local_now, the same clock streak reminders and
--    scheduled workouts use), falling back to UTC when no offset is known.
--
-- 2. Crew regimens could not be opened by crew members.
--    A regimen shared in crew chat or assigned to the crew is usually the
--    author's private regimen, and the regimens SELECT policy allows only
--    the owner, public regimens and purchases. So "Equip" failed with
--    "Regimen not found" and the assigned banner showed no name or
--    exercises for everyone but the author. get_crew_regimen returns the
--    regimen to a member of a crew where its AUTHOR shared or assigned it.
--    Requiring the author is what stops anyone posting a crew message that
--    points at somebody else's private regimen and reading it that way.
--    It never returns the author's email.
--
-- 3. A poll vote was remembered only on the device that cast it.
--    poll_votes hides user_email from clients, so the app could not read
--    its own vote back and kept it in localStorage. On another device (or
--    after clearing storage) the poll offered to vote again and the insert
--    failed with "You already voted". my_poll_vote returns the caller's
--    own choice.

-- 1. Check-in on the local day ----------------------------------------------

CREATE OR REPLACE FUNCTION public.check_in_to_gym(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    UUID := auth.uid();
  v_gym_id UUID;
  v_name   TEXT;
  v_today  DATE;
  v_rows   INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  v_today := COALESCE(public.user_local_now(v_uid)::date, (now() AT TIME ZONE 'UTC')::date);
  IF p_code IS NULL OR length(btrim(p_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CODE_REQUIRED');
  END IF;

  SELECT id, name INTO v_gym_id, v_name
    FROM public.gym_businesses
   WHERE flexyn_code = upper(btrim(p_code)) AND is_active = TRUE;

  IF v_gym_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'GYM_NOT_FOUND');
  END IF;

  INSERT INTO public.gym_checkins (user_id, gym_id, checkin_date)
    VALUES (v_uid, v_gym_id, v_today)
    ON CONFLICT (user_id, gym_id, checkin_date) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok',       true,
    'gym_id',   v_gym_id,
    'gym_name', v_name,
    'already',  v_rows = 0
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_gym_checkin_today()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_checkins
     WHERE user_id = auth.uid()
       AND checkin_date = COALESCE(public.user_local_now(auth.uid())::date,
                                   (now() AT TIME ZONE 'UTC')::date)
  );
$function$;

CREATE OR REPLACE FUNCTION public.grant_workout_xp(p_log_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_log       public.workout_logs%ROWTYPE;
  v_xp        integer;
  v_checkin   boolean := FALSE;
  v_comeback  boolean := FALSE;
  v_prev      timestamptz;
  v_credit    integer := 0;
  v_bonus     integer := 0;
  v_net       integer := 0;
  v_net_bonus integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_log FROM public.workout_logs WHERE id = p_log_id;
  IF NOT FOUND OR v_log.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_log.implausible, FALSE) OR v_log.created_at < now() - interval '24 hours' THEN
    RETURN jsonb_build_object('xp_awarded', 0, 'comeback_xp', 0, 'check_in_bonus', FALSE, 'eligible', FALSE);
  END IF;

  INSERT INTO public.xp_session_credits (kind, log_id, user_id)
  VALUES ('workout', p_log_id, v_uid)
  ON CONFLICT (kind, log_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('xp_awarded', 0, 'comeback_xp', 0, 'check_in_bonus', FALSE, 'already_credited', TRUE);
  END IF;

  v_xp := public.workout_xp_for(v_log.exercises, v_log.duration_min);
  IF v_xp > 0 AND EXISTS (
       SELECT 1 FROM public.gym_checkins
        WHERE user_id = v_uid
          AND checkin_date = COALESCE(public.user_local_now(v_uid)::date,
                                      (now() AT TIME ZONE 'UTC')::date)) THEN
    v_xp := round(v_xp * 1.2)::integer;
    v_checkin := TRUE;
  END IF;
  -- XP a deleted log already paid is spent before any new XP is granted.
  v_net := public._net_deleted_session_xp('workout', v_uid, p_log_id, v_xp);
  v_credit := public.grant_action_xp_internal('workout_completed', v_xp - v_net);

  -- Comeback: the client flags the exercises; the server checks the gap.
  IF jsonb_typeof(v_log.exercises) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_log.exercises) e
        WHERE (e->>'comeback') = 'true') THEN
    SELECT max(created_at) INTO v_prev FROM public.workout_logs
     WHERE user_id = v_uid AND id <> p_log_id
       AND NOT COALESCE(implausible, FALSE)
       AND created_at < v_log.created_at;
    v_comeback := v_prev IS NOT NULL AND v_prev < v_log.created_at - interval '72 hours';
    IF v_comeback THEN
      v_net_bonus := public._net_deleted_session_xp('workout', v_uid, p_log_id, 200);
      v_bonus := public.grant_action_xp_internal('comeback_bonus', 200 - v_net_bonus);
    END IF;
  END IF;

  UPDATE public.xp_session_credits
     SET xp = v_credit + v_net, bonus_xp = v_bonus + v_net_bonus
   WHERE kind = 'workout' AND log_id = p_log_id;
  RETURN jsonb_build_object('xp_awarded', v_credit, 'comeback_xp', v_bonus, 'check_in_bonus', v_checkin);
END;
$function$;

-- 2. Crew regimens -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_crew_regimen(p_regimen_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_r   public.regimens%ROWTYPE;
  v_author text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_r FROM public.regimens WHERE id = p_regimen_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT (
       v_r.user_id = v_uid
    OR COALESCE(v_r.is_public, FALSE)
    OR COALESCE(v_r.is_public_free, FALSE)
    OR EXISTS (SELECT 1 FROM public.crew_messages m
                 JOIN public.crew_members cm
                   ON cm.crew_id = m.crew_id AND cm.user_id = v_uid
                WHERE m.regimen_id = v_r.id AND m.sender_id = v_r.user_id)
    OR EXISTS (SELECT 1 FROM public.crew_assigned_regimens a
                 JOIN public.crew_members cm
                   ON cm.crew_id = a.crew_id AND cm.user_id = v_uid
                WHERE a.regimen_id = v_r.id AND a.assigned_by = v_r.user_id)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT username INTO v_author FROM public.user_profiles WHERE id = v_r.user_id;

  RETURN jsonb_build_object(
    'id',                       v_r.id,
    'user_id',                  v_r.user_id,
    'name',                     v_r.name,
    'description',              v_r.description,
    'exercises',                COALESCE(v_r.exercises, '[]'::jsonb),
    'original_author_username', COALESCE(v_r.original_author_username, v_author)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_crew_regimen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crew_regimen(uuid) TO authenticated;

-- The author check above is only as good as the two columns it reads, so
-- pin them. crew_assigned_regimens.assigned_by was whatever the client
-- sent, and the only UPDATE policy on crew_messages ("pin messages") let a
-- moderator rewrite ANY column of anyone's message: sender, content,
-- regimen. That was also an impersonation hole on its own, since a
-- moderator could put words in another member's mouth. A client update to
-- a crew message may now change is_pinned and nothing else.

ALTER POLICY "Crew admins can assign regimens" ON public.crew_assigned_regimens
  WITH CHECK (public.is_crew_moderator(crew_id) AND assigned_by = (SELECT auth.uid()));
ALTER POLICY "Crew admins can update assigned regimens" ON public.crew_assigned_regimens
  WITH CHECK (public.is_crew_moderator(crew_id) AND assigned_by = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.crew_messages_pin_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.id         := OLD.id;
    NEW.crew_id    := OLD.crew_id;
    NEW.sender_id  := OLD.sender_id;
    NEW.message_type := OLD.message_type;
    NEW.content    := OLD.content;
    NEW.media_url  := OLD.media_url;
    NEW.regimen_id := OLD.regimen_id;
    NEW.expires_at := OLD.expires_at;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_crew_messages_pin_only ON public.crew_messages;
CREATE TRIGGER trg_crew_messages_pin_only
  BEFORE UPDATE ON public.crew_messages
  FOR EACH ROW EXECUTE FUNCTION public.crew_messages_pin_only();

-- 3. Your own poll vote ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_poll_vote(p_post_id text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT v.option_index
    FROM public.poll_votes v
   WHERE v.post_id = p_post_id
     AND v.user_email = (SELECT p.email FROM public.user_profiles p WHERE p.id = auth.uid())
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.my_poll_vote(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_poll_vote(text) TO authenticated;

-- Probe ----------------------------------------------------------------------

DO $probe$
BEGIN
  IF has_function_privilege('anon', 'public.get_crew_regimen(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.my_poll_vote(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'probe: anon can call the new functions';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_crew_regimen(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.my_poll_vote(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'probe: signed-in users cannot call the new functions';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('check_in_to_gym', 'has_gym_checkin_today', 'grant_workout_xp')
         AND p.prosrc LIKE '%user_local_now%') <> 3 THEN
    RAISE EXCEPTION 'probe: a check-in reader still uses the UTC day';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_crew_messages_pin_only'
                    AND tgrelid = 'public.crew_messages'::regclass) THEN
    RAISE EXCEPTION 'probe: crew message pin guard missing';
  END IF;

  -- Without a session the regimen lookup refuses rather than returning data.
  BEGIN
    PERFORM public.get_crew_regimen(gen_random_uuid());
    RAISE EXCEPTION 'probe: get_crew_regimen answered with no user';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$probe$;
