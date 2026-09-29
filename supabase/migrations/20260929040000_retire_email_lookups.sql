-- Retire the functions that let the app name other people by email.
--
-- resolve_profile_email(p_id, p_username) is SECURITY DEFINER and returned
-- any user's email to any signed-in caller: pass an id or a username, get
-- the address back. The profile page and the DM button used it because
-- blocking, muting and starting a DM all took an email.
--
-- Those now take a user id (block_user_full(uuid), unblock_user_full(uuid),
-- start_dm_conversation(uuid), migrations 20260929023500 and 024500), and
-- the published app calls only the id versions. So the email versions and
-- the lookup are revoked from client roles. The id versions are SECURITY
-- DEFINER and keep working; start_dm_conversation(uuid) calls the email
-- version as its owner, which this does not touch.
--
-- REVOKE rather than DROP, so this is undone with a GRANT if anything still
-- needs one of them.

REVOKE ALL ON FUNCTION public.resolve_profile_email(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_user_full(text)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unblock_user_full(text)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_dm_conversation(text)       FROM PUBLIC, anon, authenticated;

-- Probe, run as a real signed-in user and rolled back: each retired
-- function is refused, and starting a DM, blocking and unblocking by id
-- still work.
DO $probe$
DECLARE
  v_me    uuid := gen_random_uuid();
  v_a     uuid := gen_random_uuid();
  v_me_em text;
  v_a_em  text;
  v_conv  uuid;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_me, 'probe_m_' || v_me || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_a,  'probe_a_' || v_a  || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email) VALUES
    (v_me, 'probe_m_' || v_me || '@probe.invalid'),
    (v_a,  'probe_a_' || v_a  || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_me_em FROM public.user_profiles WHERE id = v_me;
  SELECT email INTO v_a_em  FROM public.user_profiles WHERE id = v_a;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated', 'email', v_me_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  BEGIN
    PERFORM public.resolve_profile_email(v_a, NULL);
    RAISE EXCEPTION 'probe: resolve_profile_email still callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.start_dm_conversation(v_a_em);
    RAISE EXCEPTION 'probe: start_dm_conversation(text) still callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.block_user_full(v_a_em);
    RAISE EXCEPTION 'probe: block_user_full(text) still callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.unblock_user_full(v_a_em);
    RAISE EXCEPTION 'probe: unblock_user_full(text) still callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  v_conv := public.start_dm_conversation(v_a);
  IF v_conv IS NULL THEN
    RAISE EXCEPTION 'probe: DM by id returned no conversation';
  END IF;
  PERFORM public.block_user_full(v_a);
  EXECUTE 'RESET role';
  IF NOT EXISTS (SELECT 1 FROM public.user_blocks WHERE blocker_id = v_me AND blocked_id = v_a) THEN
    RAISE EXCEPTION 'probe: block by id wrote no row';
  END IF;
  EXECUTE 'SET LOCAL role authenticated';
  PERFORM public.unblock_user_full(v_a);

  EXECUTE 'RESET role';
  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
