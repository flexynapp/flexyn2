-- Past You: mid-week checkpoints and return nudges.
--
-- Kegan, 2026-09-27: "Add enough engagement so that users need to come back
-- at least 1 every 3 days." A Past You race used to have one moment, the
-- result on day 7, and nothing in between. Now it has a touch every two or
-- three days:
--
--   day 3  checkpoint: are you on Past You's pace (target x 3/7)?
--   day 5  checkpoint: same, at 5/7
--   day 7  the result (past_you_settle_match, unchanged)
--
-- Being on pace at a checkpoint pays 100 XP and 10 coins. Missing it pays
-- nothing and says how far behind you are and when the next one is, which is
-- the reason to open the app. The score is the same server-side scorer the
-- race itself uses, over [started_at, checkpoint), so nothing new can be
-- gamed: a session logged after the checkpoint does not count toward it, and
-- created_at is pinned by the a_pin_created_at trigger.
--
-- Two nudges, each sent at most once per 48 hours, only between 09:00 and
-- 20:59 in the user's local time (quiet hours still apply on top, mig 098):
--
--   in a race, no session of any kind for 48 hours, more than a day left
--   a race finished 48 hours ago and no new one started (sent once per race,
--   and only within 14 days, so a user who has left is not chased)
--
-- Checkpoints are 'competitive' notifications (a result the user earned);
-- nudges are 'engagement' (something we initiate), so muting engagement in
-- Settings silences them without touching results.

ALTER TABLE public.past_you_matches
  ADD COLUMN IF NOT EXISTS checkpoints   JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_nudge_at TIMESTAMPTZ;

-- ── Formatting ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.past_you_fmt(p_type TEXT, p_v NUMERIC)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT CASE WHEN p_type = 'cardio'
    THEN to_char(COALESCE(p_v, 0) / 1000, 'FM999,990.0') || ' km'
    ELSE to_char(COALESCE(p_v, 0), 'FM999,999,990') || ' lb' END;
$$;

REVOKE ALL ON FUNCTION public.past_you_fmt(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_fmt(text, numeric) TO service_role;

-- ── Checkpoints ────────────────────────────────────────────────────────────
-- Evaluates the next due checkpoint of one race. Returns TRUE when one was
-- recorded. The row lock plus the array length makes it idempotent: a second
-- call for the same checkpoint finds it already appended.

CREATE OR REPLACE FUNCTION public.past_you_checkpoint_match(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  c_days CONSTANT INTEGER[] := ARRAY[3, 5];
  m public.past_you_matches%ROWTYPE;
  k INTEGER; v_day INTEGER; v_next INTEGER; v_at TIMESTAMPTZ;
  v_score NUMERIC; v_pace NUMERIC; v_hit BOOLEAN;
  v_email TEXT; v_paid TEXT;
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

  IF v_hit THEN
    SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp0, v_c0
      FROM public.user_profiles WHERE id = m.user_id;
    PERFORM public.award_xp_internal(m.user_id, 100);
    UPDATE public.user_profiles SET flex_coins = COALESCE(flex_coins, 0) + 10 WHERE id = m.user_id;
    SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp1, v_c1
      FROM public.user_profiles WHERE id = m.user_id;
    v_paid := concat_ws(', ',
      CASE WHEN v_xp1 - v_xp0 > 0 THEN '+' || (v_xp1 - v_xp0) || ' XP' END,
      CASE WHEN v_c1 - v_c0 > 0 THEN '+' || round(v_c1 - v_c0) || ' coins' END);
    v_paid := CASE WHEN v_paid = '' THEN NULL ELSE v_paid || '. ' END;
  END IF;

  UPDATE public.past_you_matches
     SET checkpoints = checkpoints || jsonb_build_array(jsonb_build_object(
           'day', v_day, 'at', v_at, 'score', v_score, 'pace', v_pace, 'hit', v_hit,
           'xp', COALESCE(v_xp1 - v_xp0, 0), 'coins', COALESCE(round(v_c1 - v_c0), 0)))
   WHERE id = m.id;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (m.user_id, v_email, 'past_you_checkpoint',
    CASE WHEN v_hit THEN 'Day ' || v_day || ' checkpoint cleared' ELSE 'Past You is ahead on day ' || v_day END,
    CASE WHEN v_hit
      THEN 'You''re on pace with ' || public.past_you_fmt(m.rival_type, v_score) || '. '
           || COALESCE(v_paid, '')
           || CASE WHEN v_next < 7 THEN 'Next checkpoint on day ' || v_next || '.' ELSE 'The race ends on day 7.' END
      ELSE 'You have ' || public.past_you_fmt(m.rival_type, v_score) || ', Past You''s pace was '
           || public.past_you_fmt(m.rival_type, v_pace) || '. '
           || CASE WHEN v_next < 7 THEN 'Catch up before the day ' || v_next || ' checkpoint.'
                   ELSE 'You still have until day 7 to beat the target.' END
    END,
    CASE WHEN v_hit THEN '✅' ELSE '👻' END, '/workout',
    jsonb_build_object('past_you_id', m.id, 'checkpoint_day', v_day, 'hit', v_hit));
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.past_you_checkpoint_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_checkpoint_match(uuid) TO service_role;

-- ── Nudges ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.past_you_local_daytime(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT COALESCE(extract(hour FROM public.user_local_now(p_uid)) BETWEEN 9 AND 20, FALSE);
$$;

REVOKE ALL ON FUNCTION public.past_you_local_daytime(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_local_daytime(uuid) TO service_role;

-- A race in progress: nothing logged for 48 hours. Returns TRUE when sent.
CREATE OR REPLACE FUNCTION public.past_you_nudge_active(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  m public.past_you_matches%ROWTYPE;
  v_score NUMERIC; v_pace NUMERIC; v_days INTEGER; v_email TEXT;
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

  UPDATE public.past_you_matches SET last_nudge_at = now() WHERE id = m.id;
  SELECT email INTO v_email FROM auth.users WHERE id = m.user_id;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (m.user_id, v_email, 'past_you_nudge',
    CASE WHEN v_score < v_pace THEN 'Past You is pulling ahead' ELSE 'Past You is catching up' END,
    CASE WHEN v_score < v_pace
      THEN 'You''re ' || public.past_you_fmt(m.rival_type, v_pace - v_score) || ' behind its pace. '
      ELSE 'You''re still ahead, but it trains every day. ' END
      || v_days || CASE WHEN v_days = 1 THEN ' day' ELSE ' days' END || ' left in the race.',
    '👻', '/workout',
    jsonb_build_object('past_you_id', m.id, 'nudge', 'inactive'));
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.past_you_nudge_active(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_nudge_active(uuid) TO service_role;

-- A race finished 48 hours ago and nothing new has started. Once per race.
CREATE OR REPLACE FUNCTION public.past_you_nudge_rematch(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  m public.past_you_matches%ROWTYPE;
  v_email TEXT;
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

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (m.user_id, v_email, 'past_you_nudge',
    'Past You is waiting',
    'Lv. ' || COALESCE(m.next_level, m.level) || ' is ready for a rematch. Start a new race this week.',
    '👻', '/workout',
    jsonb_build_object('past_you_id', m.id, 'nudge', 'rematch'));
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.past_you_nudge_rematch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_nudge_rematch(uuid) TO service_role;

-- ── The tick (cron) ────────────────────────────────────────────────────────
-- One failing race never stops the rest, the same shape as past_you_settle.

CREATE OR REPLACE FUNCTION public.past_you_engagement_tick()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  r RECORD;
  n INTEGER := 0;
BEGIN
  FOR r IN SELECT id FROM public.past_you_matches WHERE status = 'active' LOOP
    BEGIN
      IF public.past_you_checkpoint_match(r.id) THEN n := n + 1; END IF;
      IF public.past_you_nudge_active(r.id) THEN n := n + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'past_you_engagement_tick: race % failed: %', r.id, SQLERRM;
    END;
  END LOOP;

  FOR r IN SELECT id FROM public.past_you_matches
            WHERE status = 'completed' AND last_nudge_at IS NULL
              AND settled_at <= now() - interval '48 hours'
              AND settled_at >  now() - interval '14 days' LOOP
    BEGIN
      IF public.past_you_nudge_rematch(r.id) THEN n := n + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'past_you_engagement_tick: rematch % failed: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.past_you_engagement_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_engagement_tick() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('past-you-engagement')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'past-you-engagement');
END;
$$;
SELECT cron.schedule('past-you-engagement', '20 * * * *', $$SELECT public.past_you_engagement_tick()$$);

-- ── Notification categories ────────────────────────────────────────────────
-- Restated from the installed body (pg_get_functiondef), plus the two new
-- types. Unmapped types always deliver (mig 083), which is wrong for a nudge.

CREATE OR REPLACE FUNCTION public.notification_type_category(p_type text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE p_type
    WHEN 'streak_milestone'         THEN 'streak'
    WHEN 'streak_break_warning'     THEN 'streak'
    WHEN 'streak_rescued'           THEN 'streak'
    WHEN 'quest_claimed'            THEN 'quests'
    WHEN 'quest_expiry_warning'     THEN 'quests'
    WHEN 'league_promoted'          THEN 'league'
    WHEN 'league_demoted'           THEN 'league'
    WHEN 'league_held'              THEN 'league'
    WHEN 'league_promotion'         THEN 'league'
    WHEN 'league_demotion'          THEN 'league'
    WHEN 'friend_post'              THEN 'social'
    WHEN 'friend_follow'            THEN 'social'
    WHEN 'comment_reply'            THEN 'social'
    WHEN 'post_reaction'            THEN 'social'
    WHEN 'post_like'                THEN 'social'
    WHEN 'sticker_reaction'         THEN 'social'
    WHEN 'trade_offer'              THEN 'social'
    WHEN 'crew_everyone'            THEN 'social'
    WHEN 'coin_gift'                THEN 'social'
    WHEN 'gym_member_joined'        THEN 'social'
    WHEN 'story_reaction'           THEN 'social'
    WHEN 'dm_received'              THEN 'social'
    WHEN 'pr_set'                   THEN 'achievements'
    WHEN 'capsule_earned'           THEN 'achievements'
    WHEN 'coin_milestone'           THEN 'achievements'
    WHEN 'welcome_back'             THEN 'engagement'
    WHEN 'weekly_gauntlet_started'  THEN 'engagement'
    WHEN 'memory_reengagement'      THEN 'engagement'
    WHEN 'referral_success'         THEN 'engagement'
    WHEN 'comeback_protocol'        THEN 'engagement'
    WHEN 'past_you_nudge'           THEN 'engagement'
    WHEN 'duel_invite'              THEN 'competitive'
    WHEN 'duel_result'              THEN 'competitive'
    WHEN 'bounty_claim'             THEN 'competitive'
    WHEN 'bounty_beaten'            THEN 'competitive'
    WHEN 'crew_war_started'         THEN 'competitive'
    WHEN 'crew_war_resolved'        THEN 'competitive'
    WHEN 'nemesis_assigned'         THEN 'competitive'
    WHEN 'nemesis_overthrown'       THEN 'competitive'
    WHEN 'gauntlet_path_completed'  THEN 'competitive'
    WHEN 'crew_challenge_created'   THEN 'competitive'
    WHEN 'crew_challenge_completed' THEN 'competitive'
    WHEN 'past_you_checkpoint'      THEN 'competitive'
    ELSE NULL
  END;
$function$;

-- ── Attempt it ─────────────────────────────────────────────────────────────
-- Rolled back by the closing RAISE. Both directions for each piece.

DO $$
DECLARE
  a UUID := gen_random_uuid();
  v_mid UUID; v_mid2 UUID;
  v_xp0 BIGINT; v_xp1 BIGINT;
  v_off INTEGER;
  cp JSONB;
  real JSONB := '[{"name":"Bench Press","sets":[{"weight":"100","reps":"10"},{"weight":"100","reps":"10"},{"weight":"100","reps":"10"}]}]';
BEGIN
  BEGIN
    -- Local noon for the probe user, so the daytime window is open.
    v_off := (12 - extract(hour FROM now() AT TIME ZONE 'UTC')::int) * 60;
    IF v_off > 720 THEN v_off := v_off - 1440; ELSIF v_off < -720 THEN v_off := v_off + 1440; END IF;

    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (a, 'cp-probe-' || a || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email) VALUES (a, 'cp-probe-' || a || '@example.invalid')
    ON CONFLICT (id) DO NOTHING;
    UPDATE public.user_profiles SET timezone_offset_minutes = v_off WHERE id = a;

    -- Started 5.5 days ago, target 7,000 lb: pace is 3,000 by day 3 and
    -- 5,000 by day 5. One 3,000 lb session on day 1 clears day 3 only.
    INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target, started_at, ends_at)
    VALUES (a, 'gym', 1, 7000, 1, 7000, now() - interval '5 days 12 hours', now() + interval '1 day 12 hours')
    RETURNING id INTO v_mid;
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, real, now() - interval '4 days 12 hours');

    -- Nothing due twice, and nothing before its time.
    SELECT COALESCE(total_xp, 0) INTO v_xp0 FROM public.user_profiles WHERE id = a;
    IF NOT public.past_you_checkpoint_match(v_mid) THEN RAISE EXCEPTION 'probe: day 3 not recorded'; END IF;
    IF NOT public.past_you_checkpoint_match(v_mid) THEN RAISE EXCEPTION 'probe: day 5 not recorded'; END IF;
    IF public.past_you_checkpoint_match(v_mid) THEN RAISE EXCEPTION 'probe: a third checkpoint was recorded'; END IF;
    SELECT COALESCE(total_xp, 0) INTO v_xp1 FROM public.user_profiles WHERE id = a;
    SELECT checkpoints INTO cp FROM public.past_you_matches WHERE id = v_mid;
    IF NOT (cp->0->>'hit')::boolean OR (cp->1->>'hit')::boolean THEN
      RAISE EXCEPTION 'probe: expected day 3 hit and day 5 miss, got %', cp;
    END IF;
    IF v_xp1 - v_xp0 <> 100 THEN RAISE EXCEPTION 'probe: checkpoints paid % XP (want 100)', v_xp1 - v_xp0; END IF;
    IF (SELECT count(*) FROM public.notifications WHERE user_id = a AND type = 'past_you_checkpoint') <> 2 THEN
      RAISE EXCEPTION 'probe: expected two checkpoint notices';
    END IF;

    -- A session after the checkpoint does not reach back into it.
    UPDATE public.past_you_matches SET status = 'abandoned' WHERE id = v_mid;
    INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target, started_at, ends_at)
    VALUES (a, 'gym', 1, 7000, 1, 7000, now() - interval '3 days 12 hours', now() + interval '3 days 12 hours')
    RETURNING id INTO v_mid2;
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, real, now() - interval '1 hour');
    PERFORM public.past_you_checkpoint_match(v_mid2);
    IF (SELECT (checkpoints->0->>'hit')::boolean FROM public.past_you_matches WHERE id = v_mid2) THEN
      RAISE EXCEPTION 'probe: a late session counted toward day 3';
    END IF;

    -- Inactive nudge: none while they trained in the last 48h, one after.
    IF public.past_you_nudge_active(v_mid2) THEN RAISE EXCEPTION 'probe: nudged someone who just trained'; END IF;
    DELETE FROM public.workout_logs WHERE user_id = a AND created_at > now() - interval '48 hours';
    IF NOT public.past_you_nudge_active(v_mid2) THEN RAISE EXCEPTION 'probe: inactive race not nudged'; END IF;
    IF public.past_you_nudge_active(v_mid2) THEN RAISE EXCEPTION 'probe: nudged twice in 48 hours'; END IF;

    -- Rematch nudge: once, and not when a newer race exists.
    UPDATE public.past_you_matches
       SET status = 'completed', settled_at = now() - interval '3 days', next_level = 2, last_nudge_at = NULL
     WHERE id = v_mid2;
    IF NOT public.past_you_nudge_rematch(v_mid2) THEN RAISE EXCEPTION 'probe: rematch not nudged'; END IF;
    IF public.past_you_nudge_rematch(v_mid2) THEN RAISE EXCEPTION 'probe: rematch nudged twice'; END IF;
    UPDATE public.past_you_matches SET last_nudge_at = NULL WHERE id = v_mid2;
    INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target, started_at, ends_at)
    VALUES (a, 'gym', 2, 7000, 1, 7280, now(), now() + interval '7 days');
    IF public.past_you_nudge_rematch(v_mid2) THEN RAISE EXCEPTION 'probe: nudged a user already racing again'; END IF;

    IF public.notification_type_category('past_you_nudge') <> 'engagement'
       OR public.notification_type_category('past_you_checkpoint') <> 'competitive'
       OR public.notification_type_category('duel_result') <> 'competitive' THEN
      RAISE EXCEPTION 'probe: notification categories wrong';
    END IF;

    -- The tick runs clean over everything.
    PERFORM public.past_you_engagement_tick();

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$$;
