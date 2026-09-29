-- Muting and blocking can name the other person by user id.
--
-- Until now the only way to mute or block someone was by their email:
-- block_user_full(p_blocked_email) and a client INSERT into user_mutes with
-- muted_email. The app has no email for anyone else, so every mute and
-- block button first fetched one through resolve_profile_email, which hands
-- any signed-in caller any user's email. That RPC is being retired, and
-- these buttons are among its last callers.
--
-- 1. block_user_full(p_blocked_id uuid) and unblock_user_full(p_blocked_id
--    uuid). Same effect as the email versions: the block, the story block,
--    and the follow rows in both directions (matched by id here). The
--    target's email is looked up server-side and never returned. The email
--    versions stay for the published build until it is replaced.
-- 2. user_mutes: when the client names the target by muted_id, the row's
--    muted_email and muted_username are taken from that profile, whatever
--    the client sent. Nobody can mute "user A" while recording someone
--    else's address against it.
--
-- Measured before: 0 rows in user_mutes, user_blocks and story_blocks.

CREATE OR REPLACE FUNCTION public.block_user_full(p_blocked_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid      uuid := auth.uid();
  v_email    text;
  v_target   text;
  v_username text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_blocked_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user' USING ERRCODE = '22023';
  END IF;
  IF p_blocked_id = v_uid THEN
    RAISE EXCEPTION 'cannot_block_self' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT email, username INTO v_target, v_username
    FROM public.user_profiles WHERE id = p_blocked_id;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.user_blocks (blocker_id, blocker_email, blocked_email, blocked_id, blocked_username)
  VALUES (v_uid, v_email, v_target, p_blocked_id, v_username)
  ON CONFLICT (blocker_id, blocked_email) DO NOTHING;

  INSERT INTO public.story_blocks (blocker_id, blocker_email, blocked_email, blocked_id, blocked_username)
  VALUES (v_uid, v_email, v_target, p_blocked_id, v_username)
  ON CONFLICT (blocker_id, blocked_email) DO NOTHING;

  DELETE FROM public.hub_follows
   WHERE (follower_id = v_uid AND followee_id = p_blocked_id)
      OR (follower_id = p_blocked_id AND followee_id = v_uid);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.unblock_user_full(p_blocked_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_target text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT email INTO v_target FROM public.user_profiles WHERE id = p_blocked_id;
  DELETE FROM public.user_blocks
   WHERE blocker_id = v_uid
     AND (blocked_id = p_blocked_id
          OR (v_target IS NOT NULL AND lower(blocked_email) = lower(v_target)));
END;
$fn$;

REVOKE ALL ON FUNCTION public.block_user_full(uuid)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unblock_user_full(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_user_full(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_user_full(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pin_mute_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_email    text;
  v_username text;
BEGIN
  IF NEW.muted_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT email, username INTO v_email, v_username
    FROM public.user_profiles WHERE id = NEW.muted_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
  NEW.muted_email    := v_email;
  NEW.muted_username := v_username;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pin_mute_target() FROM PUBLIC, anon, authenticated;

-- Named to fire after trg_user_mutes_fill_id (triggers run in name order),
-- so the profile named by id has the last word.
DROP TRIGGER IF EXISTS user_mutes_pin_target ON public.user_mutes;
CREATE TRIGGER user_mutes_pin_target
  BEFORE INSERT ON public.user_mutes
  FOR EACH ROW EXECUTE FUNCTION public.pin_mute_target();

-- Probe, rolled back: mute and block by id as a signed-in user, and check
-- the rows, the severed follows and the refusals.
DO $probe$
DECLARE
  v_me     uuid := gen_random_uuid();
  v_a      uuid := gen_random_uuid();
  v_b      uuid := gen_random_uuid();
  v_me_em  text;
  v_a_em   text;
  v_b_em   text;
  v_em     text;
  v_n      integer;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_me, 'probe_m_' || v_me || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_a,  'probe_a_' || v_a  || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_b,  'probe_b_' || v_b  || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email) VALUES
    (v_me, 'probe_m_' || v_me || '@probe.invalid'),
    (v_a,  'probe_a_' || v_a  || '@probe.invalid'),
    (v_b,  'probe_b_' || v_b  || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_me_em FROM public.user_profiles WHERE id = v_me;
  SELECT email INTO v_a_em  FROM public.user_profiles WHERE id = v_a;
  SELECT email INTO v_b_em  FROM public.user_profiles WHERE id = v_b;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated',
                      'email', v_me_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  -- A mute by id records that profile's email, even when the client sends
  -- a different one.
  INSERT INTO public.user_mutes (muter_id, muter_email, muted_id, muted_email)
  VALUES (v_me, v_me_em, v_a, v_b_em);
  SELECT muted_email INTO v_em FROM public.user_mutes
   WHERE muter_id = v_me AND muted_id = v_a;
  IF lower(v_em) IS DISTINCT FROM lower(v_a_em) THEN
    RAISE EXCEPTION 'probe: mute kept the client email';
  END IF;

  -- Unmute by id.
  DELETE FROM public.user_mutes WHERE muter_id = v_me AND muted_id = v_a;
  SELECT count(*) INTO v_n FROM public.user_mutes WHERE muter_id = v_me;
  IF v_n <> 0 THEN RAISE EXCEPTION 'probe: unmute by id left % rows', v_n; END IF;

  -- Block by id severs follows both ways.
  INSERT INTO public.hub_follows (created_by, user_id, followee_id) VALUES (v_me_em, v_me, v_a);
  PERFORM public.block_user_full(v_a);
  SELECT count(*) INTO v_n FROM public.user_blocks
   WHERE blocker_id = v_me AND blocked_id = v_a AND lower(blocked_email) = lower(v_a_em);
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: block row missing'; END IF;
  SELECT count(*) INTO v_n FROM public.hub_follows WHERE follower_id = v_me AND followee_id = v_a;
  IF v_n <> 0 THEN RAISE EXCEPTION 'probe: follow survived the block'; END IF;

  -- Blocking again is a no-op, blocking yourself is refused.
  PERFORM public.block_user_full(v_a);
  BEGIN
    PERFORM public.block_user_full(v_me);
    RAISE EXCEPTION 'probe: blocked self';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- Unblock by id.
  PERFORM public.unblock_user_full(v_a);
  SELECT count(*) INTO v_n FROM public.user_blocks WHERE blocker_id = v_me;
  IF v_n <> 0 THEN RAISE EXCEPTION 'probe: unblock by id left % rows', v_n; END IF;

  EXECUTE 'RESET role';
  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
