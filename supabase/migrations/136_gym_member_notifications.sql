-- 136_gym_member_notifications.sql
--
-- Notify the gym owner when someone joins their gym. Trigger fires
-- AFTER INSERT on gym_members, looks up the owner, inserts a
-- notification row scoped to that owner. The existing push-fanout
-- trigger on `notifications` does the rest (in-app + push).
--
-- Throttled to avoid spam when a new gym goes viral: skip if the
-- owner already received a gym_member_joined notif in the last 10
-- minutes for the same gym. We aggregate batches under a single
-- "+N more joined today" feel via the count in the body — clients
-- can collapse repeats later if needed.

CREATE OR REPLACE FUNCTION public.notify_gym_owner_on_join()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id    UUID;
  v_owner_email TEXT;
  v_gym_name    TEXT;
  v_joiner_name TEXT;
  v_recent_count INT;
  v_total_members INT;
BEGIN
  -- Skip if the joiner IS the owner (e.g. owner test-joining their
  -- own gym shouldn't ping themselves).
  SELECT gb.owner_id, u.email, gb.name, gb.member_count
    INTO v_owner_id, v_owner_email, v_gym_name, v_total_members
    FROM public.gym_businesses gb
    JOIN auth.users u ON u.id = gb.owner_id
   WHERE gb.id = NEW.gym_id;

  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Throttle: at most one notif per gym per 10 minutes.
  SELECT COUNT(*) INTO v_recent_count
    FROM public.notifications
   WHERE user_id = v_owner_id
     AND type = 'gym_member_joined'
     AND (metadata ->> 'gymId') = NEW.gym_id::text
     AND created_at > now() - INTERVAL '10 minutes';
  IF v_recent_count > 0 THEN
    RETURN NEW;
  END IF;

  -- Resolve a friendly display name for the joiner.
  SELECT COALESCE(username, NULLIF(split_part(email, '@', 1), ''))
    INTO v_joiner_name
    FROM public.user_profiles
   WHERE id = NEW.user_id;

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (v_owner_id,
     v_owner_email,
     'gym_member_joined',
     'New gym member',
     COALESCE('@' || NULLIF(v_joiner_name, '') || ' joined ' || v_gym_name,
              'A new member joined ' || v_gym_name),
     '🏋',
     '/gym/' || NEW.gym_id::text,
     jsonb_build_object(
       'gymId',       NEW.gym_id,
       'joinerId',    NEW.user_id,
       'joinerName',  v_joiner_name,
       'memberCount', v_total_members
     ));

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_gym_owner_on_join() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_notify_gym_owner_on_join ON public.gym_members;
CREATE TRIGGER trg_notify_gym_owner_on_join
  AFTER INSERT ON public.gym_members
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_gym_owner_on_join();

-- Map the new notification type to its category for per-category
-- on/off + snooze + quiet-hours respect. Treat as 'social' since
-- it's a person-driven engagement event (mirrors friend_follow).
--
-- The notification_type_category function already exists from
-- migration 083 — we patch it via CREATE OR REPLACE to add the
-- new mapping. Function body is preserved exactly except for the
-- new WHEN branch.
CREATE OR REPLACE FUNCTION public.notification_type_category(p_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    -- Streak / login retention
    WHEN p_type IN ('streak_break', 'streak_rescued', 'login_streak') THEN 'streak'
    -- Quests / daily missions
    WHEN p_type IN ('quest_complete', 'quest_expiring', 'quest_streak') THEN 'quests'
    -- League / leaderboard
    WHEN p_type IN ('league_promoted', 'league_demoted', 'league_held',
                    'league_started', 'league_ending') THEN 'league'
    -- Achievements / milestones
    WHEN p_type IN ('achievement_unlocked', 'milestone_hit', 'pr_celebrated',
                    'first_workout', 'first_regimen', 'first_goal',
                    'capsule_milestone') THEN 'achievements'
    -- Competitive (duel / bounty / nemesis / crew war)
    WHEN p_type IN ('duel_invite', 'duel_result', 'duel_ending',
                    'bounty_claim', 'bounty_beaten', 'bounty_expiring',
                    'crew_war_started', 'crew_war_resolved',
                    'nemesis_assigned', 'nemesis_overthrown',
                    'gauntlet_unlocked', 'gauntlet_complete',
                    'weekly_gauntlet_started',
                    'crew_challenge_created', 'crew_challenge_complete') THEN 'competitive'
    -- Social (follows / posts / DMs / story reactions / coin gifts / gym joins)
    WHEN p_type IN ('friend_follow', 'friend_post', 'comment_reply',
                    'post_reaction', 'sticker_reaction', 'trade_offer',
                    'dm_received', 'memory_resurfaced',
                    'story_reaction', 'coin_gift',
                    'gym_member_joined') THEN 'social'
    -- Engagement / win-back
    WHEN p_type IN ('welcome_back', 'comeback_protocol', 'referral_credited') THEN 'engagement'
    ELSE NULL
  END;
$$;

-- ── Patch approve_gym_verification to use is_app_admin (mig 103) ─
-- The v1 version of this RPC (in mig 135) had a hardcoded username
-- list. Switch to the canonical is_app_admin(uid) function so admin
-- changes only need to land in ONE place.
CREATE OR REPLACE FUNCTION public.approve_gym_verification(p_verif_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_verif  public.gym_verification_queue%ROWTYPE;
  v_code   TEXT;
  v_gym_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_app_admin(v_uid) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_verif FROM public.gym_verification_queue WHERE id = p_verif_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification record not found' USING ERRCODE = '22023';
  END IF;
  IF v_verif.status <> 'pending' THEN
    RAISE EXCEPTION 'already %', v_verif.status USING ERRCODE = '22023';
  END IF;
  IF v_verif.latitude IS NULL OR v_verif.longitude IS NULL THEN
    RAISE EXCEPTION 'geo coords required before approval' USING ERRCODE = '22023';
  END IF;

  v_code := public.generate_flexyn_code();

  INSERT INTO public.gym_businesses (
    owner_id, verification_id, name, street_address, city, state_code,
    postal_code, country_code, latitude, longitude, flexyn_code,
    phone, website_url
  )
  VALUES (
    v_verif.owner_id, v_verif.id, v_verif.business_name, v_verif.street_address,
    v_verif.city, v_verif.state_code, v_verif.postal_code, v_verif.country_code,
    v_verif.latitude, v_verif.longitude, v_code,
    v_verif.phone, v_verif.website_url
  )
  RETURNING id INTO v_gym_id;

  UPDATE public.gym_verification_queue
     SET status = 'approved', reviewed_at = now(), reviewed_by = v_uid
   WHERE id = p_verif_id;

  RETURN v_gym_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_gym_verification(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_gym_verification(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
