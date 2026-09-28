-- Duels audit, round four (2026-09-28).
--
-- 1. A negative set hid a fake one from the cheat check.
--    workout_logs_flag_implausible sums _duel_calc_volume, which added
--    weight x reps with no sign check. A log with Bench 100000 x 1 and
--    Curl -100000 x 1 summed to 0 and was not flagged. Every reader that
--    keeps only positive sets then saw a 100,000 lb set on a clean row,
--    and a Mirror duel took it at full value. Volume now counts only sets
--    with weight > 0 and reps > 0, the same rule as the app's setVolume().
--    Production has no negative sets (measured 2026-09-28), so no stored
--    row changes meaning.
--
-- 2. A Mirror's set target could not be reached. _duel_score_mirror
--    counted every set in the template, including sets with no reps and
--    exercises with no name. _duel_mirror_metrics can never credit those,
--    so completion topped out below 100% for both lifters. Both functions
--    now count the same sets: rep sets on named exercises.
--    _duel_mirror_template also skips a workout with none of those, which
--    would make a Mirror nobody can score.
--
-- 3. A duel invite sent two alerts. create_duel already sends the
--    duel_invite notification. The chat card the app sends next set off
--    notify_dm_received as well, so the opponent got "New message" on top.
--    The DM trigger now skips [DUEL_INVITE_V1] bodies, the same way it
--    skips poll votes. The card still shows up in the chat.
--
-- Nothing here changes or deletes rows.

CREATE OR REPLACE FUNCTION public._duel_calc_volume(p_exercises jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_total NUMERIC := 0;
  v_ex    JSONB;
  v_set   JSONB;
  v_w     NUMERIC;
  v_r     NUMERIC;
BEGIN
  IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array' THEN
    RETURN 0;
  END IF;
  FOR v_ex IN SELECT * FROM jsonb_array_elements(p_exercises) LOOP
    IF jsonb_typeof(v_ex->'sets') = 'array' THEN
      FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
        v_w := COALESCE((v_set->>'weight')::NUMERIC, 0);
        v_r := COALESCE((v_set->>'reps')::NUMERIC, 0);
        -- A negative set must not cancel a real one.
        IF v_w > 0 AND v_r > 0 THEN
          v_total := v_total + v_w * v_r;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public._duel_metrics_from_log(p_exercises jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_ex JSONB; v_set JSONB;
  v_vol NUMERIC := 0; v_max_reps NUMERIC := 0; v_max_weight NUMERIC := 0; v_sets INT := 0;
  v_w NUMERIC; v_r NUMERIC;
BEGIN
  IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array' THEN
    RETURN jsonb_build_object('volume', 0, 'reps', 0, 'weight', 0, 'sets_completed', 0);
  END IF;
  FOR v_ex IN SELECT * FROM jsonb_array_elements(p_exercises) LOOP
    IF jsonb_typeof(v_ex->'sets') = 'array' THEN
      FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
        v_w := COALESCE((v_set->>'weight')::NUMERIC, 0);
        v_r := COALESCE((v_set->>'reps')::NUMERIC, 0);
        IF v_w > 0 AND v_r > 0 THEN v_vol := v_vol + v_w * v_r; END IF;
        IF v_r > 0 THEN v_sets := v_sets + 1; END IF;
        IF v_r > v_max_reps THEN v_max_reps := v_r; END IF;
        IF v_w > v_max_weight THEN v_max_weight := v_w; END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('volume', v_vol, 'reps', v_max_reps, 'weight', v_max_weight, 'sets_completed', v_sets);
END;
$function$;

CREATE OR REPLACE FUNCTION public._duel_mirror_metrics(p_exercises jsonb, p_template jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_need       JSONB := '{}'::JSONB;  -- exercise -> rep sets prescribed
  v_done       JSONB := '{}'::JSONB;  -- exercise -> sets with reps logged
  v_ex         JSONB;
  v_set        JSONB;
  v_key        TEXT;
  v_n          INT;
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

  -- Only sets that carry reps are part of the target. A set row left
  -- empty in the template is not something anyone can finish.
  FOR v_ex IN SELECT * FROM jsonb_array_elements(p_template->'exercises') LOOP
    v_key := lower(btrim(COALESCE(v_ex->>'name', '')));
    IF v_key = '' OR jsonb_typeof(v_ex->'sets') IS DISTINCT FROM 'array' THEN CONTINUE; END IF;
    SELECT count(*) INTO v_n FROM jsonb_array_elements(v_ex->'sets') s
     WHERE jsonb_typeof(s->'reps') = 'number' AND (s->'reps')::NUMERIC > 0;
    IF v_n = 0 THEN CONTINUE; END IF;
    v_need := v_need || jsonb_build_object(v_key, COALESCE((v_need->>v_key)::INT, 0) + v_n);
  END LOOP;

  FOR v_ex IN SELECT * FROM jsonb_array_elements(p_exercises) LOOP
    v_key := lower(btrim(COALESCE(v_ex->>'name', '')));
    IF NOT (v_need ? v_key) OR jsonb_typeof(v_ex->'sets') IS DISTINCT FROM 'array' THEN CONTINUE; END IF;
    FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
      v_w := COALESCE((v_set->>'weight')::NUMERIC, 0);
      v_r := COALESCE((v_set->>'reps')::NUMERIC, 0);
      IF v_w > 0 AND v_r > 0 THEN v_vol := v_vol + v_w * v_r; END IF;
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
$function$;

-- The target and the reference volume are the template scored against
-- itself, so they count exactly the sets _duel_mirror_metrics can credit.
CREATE OR REPLACE FUNCTION public._duel_score_mirror(p_result jsonb, p_template jsonb)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_ref        JSONB;
  v_prescribed INT;
  v_completion NUMERIC;
  v_volume_pr  NUMERIC;
  v_volume_a   NUMERIC;
  v_ratio      NUMERIC;
BEGIN
  IF p_template IS NULL OR jsonb_typeof(p_template->'exercises') IS DISTINCT FROM 'array' THEN
    RETURN 0;
  END IF;
  v_ref        := public._duel_mirror_metrics(p_template->'exercises', p_template);
  v_prescribed := COALESCE((v_ref->>'sets_completed')::INT, 0);
  IF v_prescribed = 0 THEN RETURN 0; END IF;

  v_completion := LEAST(COALESCE((p_result->>'sets_completed')::INT, 0)::NUMERIC / v_prescribed, 1);
  v_volume_pr  := COALESCE((v_ref->>'volume')::NUMERIC, 0);
  v_volume_a   := COALESCE((p_result->>'volume')::NUMERIC, 0);
  v_ratio      := CASE WHEN v_volume_pr > 0 THEN LEAST(v_volume_a / v_volume_pr, 1.5) ELSE 1 END;

  RETURN ROUND((v_completion * 0.6 + (v_ratio / 1.5) * 0.4) * 1000)::INT;
END;
$function$;

CREATE OR REPLACE FUNCTION public._duel_mirror_template(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT jsonb_build_object('exercises', l.exercises, 'name', l.title, 'workout_log_id', l.id)
    FROM public.workout_logs l
   WHERE l.user_id = p_user_id
     AND NOT COALESCE(l.implausible, FALSE)
     AND jsonb_typeof(l.exercises) = 'array'
     -- At least one set a Mirror can score: reps on a named exercise.
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.exercises) e
                  WHERE btrim(COALESCE(e->>'name', '')) <> ''
                    AND jsonb_typeof(e->'sets') = 'array'
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements(e->'sets') s
                                 WHERE jsonb_typeof(s->'reps') = 'number'
                                   AND (s->'reps')::NUMERIC > 0))
   ORDER BY l.created_at DESC
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public._duel_calc_volume(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_metrics_from_log(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_mirror_metrics(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_score_mirror(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._duel_mirror_template(uuid) FROM PUBLIC, anon, authenticated;

-- Restated from the installed body. One change: duel invite cards are
-- skipped, because create_duel already sent the duel_invite notification.
CREATE OR REPLACE FUNCTION public.notify_dm_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email TEXT; v_rcpt_id UUID; v_rcpt_lang TEXT; v_text JSONB; v_emails TEXT[];
  v_content TEXT;
BEGIN
  -- Held for later delivery: the recipient cannot read it yet (mig 295),
  -- so announcing it now is a notification that leads nowhere.
  IF NEW.status = 'scheduled' THEN RETURN NEW; END IF;

  v_content := btrim(coalesce(NEW.content, NEW.body, ''));

  -- Poll votes are control messages, not chat.
  IF left(v_content, 14) = '[POLL_VOTE_V1]' THEN RETURN NEW; END IF;
  -- A duel invite card already came with its own duel_invite alert.
  IF left(v_content, 16) = '[DUEL_INVITE_V1]' THEN RETURN NEW; END IF;

  -- A message with no text is still a message when it carries media.
  IF v_content = ''
     AND NEW.attachment_url IS NULL
     AND NEW.sticker_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT participant_emails INTO v_emails
    FROM public.hub_conversations WHERE id = NEW.conversation_id;
  IF v_emails IS NULL THEN RETURN NEW; END IF;

  FOREACH v_email IN ARRAY v_emails LOOP
    CONTINUE WHEN lower(v_email) = lower(COALESCE(NEW.sender_email, ''));
    SELECT id, COALESCE(preferred_language, 'en') INTO v_rcpt_id, v_rcpt_lang
      FROM public.user_profiles WHERE lower(email) = lower(v_email);
    CONTINUE WHEN v_rcpt_id IS NULL;
    CONTINUE WHEN public.is_blocked(v_rcpt_id, NEW.sender_email);

    v_text := public.dm_received_text(v_rcpt_lang, NEW.sender_name);
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES (v_rcpt_id, v_email, 'dm_received', v_text->>'title', v_text->>'body',
            NULLIF(NEW.sender_avatar, ''), '/messages',
            jsonb_build_object('conversation_id', NEW.conversation_id));
  END LOOP;
  RETURN NEW;
END;
$function$;

-- Probe: attempt each fixed case and check both directions.
DO $$
DECLARE
  v_fake JSONB := '[{"name":"Bench Press","sets":[{"weight":100000,"reps":1}]},
                    {"name":"Curl","sets":[{"weight":-100000,"reps":1}]}]';
  v_tpl  JSONB := '{"exercises":[
                     {"name":"Bench Press","sets":[{"weight":135,"reps":8},{"weight":135,"reps":8},{"weight":null,"reps":null}]},
                     {"name":"","sets":[{"weight":20,"reps":10}]}]}';
  v_self JSONB;
BEGIN
  -- The fake set is now visible to the cheat check.
  IF public._duel_calc_volume(v_fake) <> 100000 THEN
    RAISE EXCEPTION 'probe: a negative set still cancels a positive one (got %)', public._duel_calc_volume(v_fake);
  END IF;
  -- An honest log is summed exactly as before.
  IF public._duel_calc_volume('[{"name":"Squat","sets":[{"weight":225,"reps":5},{"weight":225,"reps":5}]}]') <> 2250 THEN
    RAISE EXCEPTION 'probe: honest volume changed';
  END IF;
  IF (public._duel_metrics_from_log(v_fake)->>'volume')::NUMERIC <> 100000 THEN
    RAISE EXCEPTION 'probe: open duel volume still nets negatives';
  END IF;
  -- The template scored against itself finishes every set it can: 2 of 2,
  -- not 2 of 4, and lands on the same 867 an honest full redo always had.
  v_self := public._duel_mirror_metrics(v_tpl->'exercises', v_tpl);
  IF (v_self->>'sets_completed')::INT <> 2 THEN
    RAISE EXCEPTION 'probe: template target counts sets nobody can finish';
  END IF;
  IF public._duel_score_mirror(v_self, v_tpl) <> 867 THEN
    RAISE EXCEPTION 'probe: full redo scored % not 867', public._duel_score_mirror(v_self, v_tpl);
  END IF;
  -- Half the sets still scores less than all of them.
  IF public._duel_score_mirror('{"sets_completed":1,"volume":1080}', v_tpl) >= 867 THEN
    RAISE EXCEPTION 'probe: half a redo scores as a full one';
  END IF;
  IF has_function_privilege('authenticated', 'public._duel_calc_volume(jsonb)', 'execute') THEN
    RAISE EXCEPTION 'probe: _duel_calc_volume is callable by clients';
  END IF;
END;
$$;
