-- App audit, second pass (2026-10-01). Server holes found by probing
-- production as a real authenticated user (all probes rolled back).
--
-- 1. bounty_claims: clients held INSERT and UPDATE on every column, with
--    policies that only checked claimant_id. A user could insert an
--    'active' claim with no entry fee, complete it, flip it back to
--    'active' and complete it again with the same workout: coins went
--    80 -> 255 -> 430 in the probe. A forged 'completed' row also paid the
--    weekly bounty_1 league quest. claim_bounty and complete_bounty_claim
--    (both SECURITY DEFINER) are the only writers the app uses.
-- 2. solo_challenge_claims: same shape. A client-inserted claim with
--    progress = 1e9 let complete_solo_challenge pay every challenge's
--    reward with no workouts (810 coins in the probe). claim_solo_challenge
--    and update_solo_challenge_progress are the writers.
-- 3. food_items: the moderation split migration 345 describes never made it
--    into the baseline; production still has one ALL policy, so a member
--    could publish a row with is_verified = TRUE and source =
--    'member_request', which every scanner reads. The app has no client
--    writer at all (foodItems.js), so the owner policy becomes read only.
-- 4. can_view_post had no branch for privacy = 'crew'. Crewmates who do not
--    follow the author could see a crew post but none of its comments, and
--    commenting failed with 42501 (the comments policy is RESTRICTIVE).
-- 5. Gym feed reaction counts and event RSVP counts never moved for
--    ordinary members: the counter triggers ran as the caller and RLS
--    dropped the UPDATE in silence. Now SECURITY DEFINER and derived with
--    count(*), the same as gym_feed_comment_count_sync; backfilled.
-- 6. notify_crew_war_resolved_for fanned out to both crews every time any
--    member opened the finished war (the client dedupe is per device).
--    It now sends once per war.
-- 7. Scheduled workouts were never marked completed, so the reminder fired
--    after the user had already trained. The reminder cron now closes a
--    pending or notified schedule once a log exists for that day.

-- 1 -------------------------------------------------------------------------
DROP POLICY IF EXISTS bounty_claims_insert ON public.bounty_claims;
DROP POLICY IF EXISTS bounty_claims_update ON public.bounty_claims;
REVOKE INSERT, UPDATE, DELETE ON public.bounty_claims FROM anon, authenticated;

-- 2 -------------------------------------------------------------------------
DROP POLICY IF EXISTS "solo_challenge_claims: own insert" ON public.solo_challenge_claims;
REVOKE INSERT, UPDATE, DELETE ON public.solo_challenge_claims FROM anon, authenticated;

-- 3 -------------------------------------------------------------------------
-- Same USING as the old ALL policy, so an owner keeps reading their own rows.
DROP POLICY IF EXISTS "food_items: owner full access" ON public.food_items;
DROP POLICY IF EXISTS "food_items: owner read" ON public.food_items;
CREATE POLICY "food_items: owner read" ON public.food_items
  FOR SELECT TO authenticated
  USING (
    ((SELECT NULLIF(public.current_user_email(), ''::text)) = created_by)
    OR ((SELECT auth.uid()) = user_id)
  );
REVOKE INSERT, UPDATE, DELETE ON public.food_items FROM anon, authenticated;

-- 4 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_email text; v_author text;
  v_author_id uuid; v_privacy text; v_publish_at timestamptz;
  v_crew_id uuid;
BEGIN
  IF v_uid IS NULL OR p_post_id IS NULL THEN RETURN FALSE; END IF;
  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
  SELECT author_email, user_id, privacy, publish_at, crew_id
    INTO v_author, v_author_id, v_privacy, v_publish_at, v_crew_id
    FROM public.hub_posts WHERE id = p_post_id;
  IF v_author IS NULL AND v_author_id IS NULL THEN RETURN FALSE; END IF;
  IF v_author_id = v_uid
     OR (v_email IS NOT NULL AND lower(COALESCE(v_author,'')) = lower(v_email))
  THEN RETURN TRUE; END IF;
  IF v_publish_at IS NOT NULL AND v_publish_at > now() THEN RETURN FALSE; END IF;
  IF public.is_blocked(v_uid, v_author) THEN RETURN FALSE; END IF;
  -- Mirrors the hub_posts read policy: a crew post is for the crew.
  IF v_privacy = 'crew' THEN
    RETURN v_crew_id IS NOT NULL AND public.is_crew_member(v_crew_id);
  END IF;
  IF v_privacy = 'public' THEN RETURN TRUE; END IF;
  RETURN EXISTS (SELECT 1 FROM public.hub_follows
    WHERE (follower_id = v_uid AND followee_id = v_author_id)
       OR (v_email IS NOT NULL
           AND lower(follower_email) = lower(v_email)
           AND lower(followee_email) = lower(COALESCE(v_author,''))));
END; $function$;

-- 5 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gym_feed_rxn_count_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_post uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;
BEGIN
  UPDATE public.gym_feed_posts
     SET reaction_count = (SELECT count(*) FROM public.gym_feed_post_reactions r
                            WHERE r.post_id = v_post)
   WHERE id = v_post;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.gym_event_rsvp_count_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_event uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END;
BEGIN
  UPDATE public.gym_events
     SET rsvp_count = (SELECT count(*) FROM public.gym_event_rsvps r
                        WHERE r.event_id = v_event AND r.status = 'going')
   WHERE id = v_event;
  IF TG_OP = 'UPDATE' AND OLD.event_id IS DISTINCT FROM NEW.event_id THEN
    UPDATE public.gym_events
       SET rsvp_count = (SELECT count(*) FROM public.gym_event_rsvps r
                          WHERE r.event_id = OLD.event_id AND r.status = 'going')
     WHERE id = OLD.event_id;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.gym_feed_rxn_count_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gym_event_rsvp_count_sync() FROM PUBLIC, anon, authenticated;

UPDATE public.gym_feed_posts p
   SET reaction_count = (SELECT count(*) FROM public.gym_feed_post_reactions r WHERE r.post_id = p.id)
 WHERE reaction_count IS DISTINCT FROM (SELECT count(*) FROM public.gym_feed_post_reactions r WHERE r.post_id = p.id);
UPDATE public.gym_events e
   SET rsvp_count = (SELECT count(*) FROM public.gym_event_rsvps r WHERE r.event_id = e.id AND r.status = 'going')
 WHERE rsvp_count IS DISTINCT FROM (SELECT count(*) FROM public.gym_event_rsvps r WHERE r.event_id = e.id AND r.status = 'going');

-- 6 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_crew_war_resolved_for(p_war_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sender    UUID := auth.uid();
  v_war       public.crew_wars%ROWTYPE;
  v_crew_a    public.crews%ROWTYPE;
  v_crew_b    public.crews%ROWTYPE;
  v_member    RECORD;
  v_count     INT := 0;
  v_outcome   TEXT;
  v_opponent  TEXT;
  v_text      JSONB;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_war_id IS NULL THEN
    RAISE EXCEPTION 'war_id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_war FROM public.crew_wars WHERE id = p_war_id;
  IF v_war IS NULL OR v_war.status <> 'completed' THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members
     WHERE user_id = v_sender
       AND crew_id IN (v_war.crew_a_id, v_war.crew_b_id)
  ) THEN
    RAISE EXCEPTION 'not your war' USING ERRCODE = '42501';
  END IF;

  -- Once per war. Every member who opens the finished war calls this, so
  -- serialise the callers and stop if the result has already gone out.
  PERFORM pg_advisory_xact_lock(hashtextextended('crew_war_resolved:' || p_war_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.notifications
     WHERE type = 'crew_war_resolved'
       AND metadata ->> 'war_id' = p_war_id::text
  ) THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_crew_a FROM public.crews WHERE id = v_war.crew_a_id;
  SELECT * INTO v_crew_b FROM public.crews WHERE id = v_war.crew_b_id;

  -- Crew A side
  IF v_war.winner_crew_id IS NULL                    THEN v_outcome := 'tied';
  ELSIF v_war.winner_crew_id = v_war.crew_a_id       THEN v_outcome := 'won';
  ELSE                                                    v_outcome := 'lost'; END IF;
  v_opponent := COALESCE(v_crew_b.name, 'rival crew');

  FOR v_member IN
    SELECT cm.user_id, up.email, prof.preferred_language
      FROM public.crew_members cm
      JOIN public.user_profiles up   ON up.id = cm.user_id
      LEFT JOIN public.user_profiles prof ON prof.id = cm.user_id
     WHERE cm.crew_id = v_war.crew_a_id
       AND up.email IS NOT NULL
  LOOP
    v_text := public.crew_war_resolved_text(
      COALESCE(v_member.preferred_language, 'en'), v_opponent, v_outcome);
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_member.user_id, v_member.email, 'crew_war_resolved',
       v_text ->> 'title', NULL,
       CASE v_outcome WHEN 'won' THEN '🏆' WHEN 'lost' THEN '💪' ELSE '🤝' END,
       '/hub',
       jsonb_build_object('war_id', p_war_id, 'outcome', v_outcome,
                          'opponent_crew_id', v_war.crew_b_id,
                          'crew_a_score', v_war.crew_a_score,
                          'crew_b_score', v_war.crew_b_score));
    v_count := v_count + 1;
  END LOOP;

  -- Crew B side
  IF v_war.winner_crew_id IS NULL                    THEN v_outcome := 'tied';
  ELSIF v_war.winner_crew_id = v_war.crew_b_id       THEN v_outcome := 'won';
  ELSE                                                    v_outcome := 'lost'; END IF;
  v_opponent := COALESCE(v_crew_a.name, 'rival crew');

  FOR v_member IN
    SELECT cm.user_id, up.email, prof.preferred_language
      FROM public.crew_members cm
      JOIN public.user_profiles up   ON up.id = cm.user_id
      LEFT JOIN public.user_profiles prof ON prof.id = cm.user_id
     WHERE cm.crew_id = v_war.crew_b_id
       AND up.email IS NOT NULL
  LOOP
    v_text := public.crew_war_resolved_text(
      COALESCE(v_member.preferred_language, 'en'), v_opponent, v_outcome);
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_member.user_id, v_member.email, 'crew_war_resolved',
       v_text ->> 'title', NULL,
       CASE v_outcome WHEN 'won' THEN '🏆' WHEN 'lost' THEN '💪' ELSE '🤝' END,
       '/hub',
       jsonb_build_object('war_id', p_war_id, 'outcome', v_outcome,
                          'opponent_crew_id', v_war.crew_a_id,
                          'crew_a_score', v_war.crew_a_score,
                          'crew_b_score', v_war.crew_b_score));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- 7 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fire_scheduled_workout_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id    UUID;
  v_user  UUID;
  v_email TEXT;
  v_title TEXT;
  v_count INTEGER := 0;
BEGIN
  -- Already trained that day: close the schedule instead of reminding.
  -- A cardio schedule counts a cardio log, anything else a workout log.
  UPDATE public.scheduled_workouts s
     SET status = 'completed', completed_at = now()
   WHERE s.status IN ('pending', 'notified')
     AND CASE WHEN s.workout ->> 'kind' = 'cardio'
              THEN EXISTS (SELECT 1 FROM public.cardio_logs c
                            WHERE c.user_id = s.user_id AND c.date = s.scheduled_date)
              ELSE EXISTS (SELECT 1 FROM public.workout_logs w
                            WHERE w.user_id = s.user_id AND w.date = s.scheduled_date)
         END;

  UPDATE public.scheduled_workouts
     SET status = 'missed'
   WHERE status = 'pending'
     AND public.user_local_now(user_id)
         > (scheduled_date + (scheduled_hour || ' hours')::interval + INTERVAL '12 hours');

  FOR v_id IN
    UPDATE public.scheduled_workouts
       SET status = 'notified', notified_at = now()
     WHERE status = 'pending'
       AND public.user_local_now(user_id)
           >= (scheduled_date + (scheduled_hour || ' hours')::interval)
    RETURNING id
  LOOP
    SELECT user_id, user_email, title INTO v_user, v_email, v_title
      FROM public.scheduled_workouts WHERE id = v_id;

    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_user, v_email, 'workout_reminder', 'Time to train 💪',
       COALESCE(v_title, 'Your workout') || ' is ready when you are.',
       '🏋️', '/workout?scheduled=' || v_id::text,
       jsonb_build_object('scheduledWorkoutId', v_id));

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.fire_scheduled_workout_reminders() FROM PUBLIC, anon, authenticated;

-- Probe: attempt the writes as a client role and expect refusal. ------------
DO $probe$
DECLARE
  v_refused int := 0;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.bounty_claims (claimant_id, status) VALUES (gen_random_uuid(), 'completed');
  EXCEPTION WHEN insufficient_privilege THEN v_refused := v_refused + 1;
  END;
  BEGIN
    UPDATE public.bounty_claims SET status = 'active' WHERE false;
  EXCEPTION WHEN insufficient_privilege THEN v_refused := v_refused + 1;
  END;
  BEGIN
    INSERT INTO public.solo_challenge_claims (user_id, progress) VALUES (gen_random_uuid(), 1e9);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := v_refused + 1;
  END;
  BEGIN
    INSERT INTO public.food_items (name, is_verified) VALUES ('probe', TRUE);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := v_refused + 1;
  END;
  EXECUTE 'RESET ROLE';

  IF v_refused <> 4 THEN
    RAISE EXCEPTION 'probe: expected 4 refused client writes, got %', v_refused;
  END IF;
  -- Reads the app relies on are still granted.
  IF NOT has_table_privilege('authenticated', 'public.bounty_claims', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.solo_challenge_claims', 'SELECT')
     -- food_items grants SELECT column by column (emails hidden).
     OR NOT has_column_privilege('authenticated', 'public.food_items', 'name', 'SELECT') THEN
    RAISE EXCEPTION 'probe: a client read was revoked';
  END IF;
  IF NOT (SELECT bool_and(prosecdef) FROM pg_proc
           WHERE oid IN ('public.gym_feed_rxn_count_sync'::regproc,
                         'public.gym_event_rsvp_count_sync'::regproc)) THEN
    RAISE EXCEPTION 'probe: gym counter triggers are not definer';
  END IF;
  IF has_function_privilege('anon', 'public.fire_scheduled_workout_reminders()', 'EXECUTE') THEN
    RAISE EXCEPTION 'probe: anon can fire reminders';
  END IF;
END
$probe$;
