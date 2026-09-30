-- Other people's emails stop being readable on regimens, trophies and gym
-- members.
--
-- Batch 3 of 20260930150000. Public regimens carried their owner's email
-- (created_by) and, on copies, the original author's (original_author_email).
-- Trophies and gym memberships are readable by anyone who can see that
-- person's activity or shares their gym, and each row carried user_email.
-- Since #271 the app reads all three by explicit column list without the
-- email and looks people up by user id only. Row policies cannot hide a
-- column, so SELECT is now granted column by column: every column except the
-- email ones.
--
-- Unchanged: which rows anyone can see (policies are untouched, and a policy
-- may still read an email column, as the regimen owner policy and the trophy
-- read policy do), plain INSERT, UPDATE and DELETE (the app still writes
-- regimens.created_by on insert), and SECURITY DEFINER functions, which run
-- as the table owner. No SECURITY INVOKER function or view reads these
-- tables (checked against production on 2026-09-30).
--
-- The same consequences as batches 1 and 2:
--   * select('*'), and a filter on an email column, now fail with 42501.
--   * A column added to one of these tables later is NOT readable by the
--     app until it is granted here too.
-- Undo is a plain GRANT SELECT ON <table> TO anon, authenticated.

REVOKE SELECT ON public.regimens FROM anon, authenticated;
GRANT SELECT (id, user_id, name, description, days, is_active, created_at,
              updated_at, created_date, is_public, copy_count,
              original_template_id, original_author_username, exercises,
              is_template, template_id, difficulty, is_public_free,
              copied_from_post_id)
  ON public.regimens TO anon, authenticated;

REVOKE SELECT ON public.user_trophies FROM anon, authenticated;
GRANT SELECT (id, user_id, trophy_id, earned_at)
  ON public.user_trophies TO anon, authenticated;

-- anon never held SELECT here, so it gets none now either.
REVOKE SELECT ON public.gym_members FROM anon, authenticated;
GRANT SELECT (id, gym_id, user_id, joined_at)
  ON public.gym_members TO authenticated;

-- Probe, run as a real signed-in user and rolled back. The email columns and
-- select * are refused; every statement the app sends on these tables still
-- works, in the shape the app sends it.
DO $probe$
DECLARE
  v_me     uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_me_em  text;
  v_ot_em  text;
  v_pub    uuid;
  v_mine   uuid;
  v_copy   uuid;
  v_gym    uuid;
  v_code   text;
  v_join   jsonb;
  v_n      int;
  v_b      boolean;
  v_tbl    text;
  v_col    text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_me,    'probe_r_' || v_me    || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_other, 'probe_r_' || v_other || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email) VALUES
    (v_me,    'probe_r_' || v_me    || '@probe.invalid'),
    (v_other, 'probe_r_' || v_other || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_me_em FROM public.user_profiles WHERE id = v_me;
  SELECT email INTO v_ot_em FROM public.user_profiles WHERE id = v_other;

  -- The other user's public regimen, a trophy, and a gym we both belong to.
  INSERT INTO public.regimens (created_by, user_id, name, is_public, exercises)
  VALUES (v_ot_em, v_other, 'probe public', true, '[]'::jsonb) RETURNING id INTO v_pub;
  INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
  VALUES (v_other, v_ot_em, 'probe_trophy');
  v_code := upper('P' || substr(md5(v_me::text), 1, 7));
  INSERT INTO public.gym_businesses (name, flexyn_code, source)
  VALUES ('Probe Gym', v_code, 'community')
  RETURNING id INTO v_gym;
  INSERT INTO public.gym_members (gym_id, user_id, user_email)
  VALUES (v_gym, v_other, v_ot_em);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated', 'email', v_me_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  FOR v_tbl, v_col IN VALUES
    ('regimens', 'created_by'),
    ('regimens', 'original_author_email'),
    ('user_trophies', 'user_email'),
    ('gym_members', 'user_email')
  LOOP
    BEGIN
      EXECUTE format('SELECT %I FROM public.%I LIMIT 1', v_col, v_tbl);
      RAISE EXCEPTION 'probe: %.% still readable', v_tbl, v_col;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('SELECT * FROM public.%I LIMIT 1', v_tbl);
      RAISE EXCEPTION 'probe: select * on % still allowed', v_tbl;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- regimens.js: create (ownedRows sends created_by and user_id, returns
  -- OWN_COLUMNS), list, get, update, listPublic, copyTemplate, remove.
  INSERT INTO public.regimens (created_by, user_id, name, exercises)
  VALUES (v_me_em, v_me, 'probe mine', '[]'::jsonb)
  RETURNING id INTO v_mine;
  SELECT count(*) INTO v_n FROM (
    SELECT id, user_id, name, description, days, created_at, created_date,
           is_public, is_public_free, copy_count, original_template_id,
           original_author_username, exercises, is_template, template_id,
           difficulty, is_active, updated_at, copied_from_post_id
      FROM public.regimens WHERE user_id = v_me ORDER BY created_date DESC) s;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: own regimen list %', v_n; END IF;
  UPDATE public.regimens SET is_active = true WHERE id = v_mine
  RETURNING is_active INTO v_b;
  IF v_b IS NOT TRUE THEN RAISE EXCEPTION 'probe: regimen update did nothing'; END IF;
  SELECT count(*) INTO v_n FROM (
    SELECT id, user_id, name, copy_count FROM public.regimens
     WHERE (is_public OR is_public_free) AND id = v_pub) s;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: public regimen not listed (%)', v_n; END IF;
  INSERT INTO public.regimens (created_by, user_id, name, exercises, is_public,
                               original_template_id, original_author_username)
  VALUES (v_me_em, v_me, 'probe public', '[]'::jsonb, false, v_pub, 'probe')
  RETURNING id INTO v_copy;
  PERFORM public.increment_copy_count('regimens', v_pub);
  SELECT count(*) INTO v_n FROM public.regimens
   WHERE original_template_id = v_pub AND user_id = v_me;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: copy not found (%)', v_n; END IF;
  DELETE FROM public.regimens WHERE id = v_copy;
  DELETE FROM public.regimens WHERE id = v_mine;
  IF EXISTS (SELECT 1 FROM public.regimens WHERE id IN (v_copy, v_mine)) THEN
    RAISE EXCEPTION 'probe: regimen delete did nothing';
  END IF;

  -- trophies.js / crews.js: another user's trophies by user id.
  SELECT count(*) INTO v_n FROM (
    SELECT user_id, trophy_id, earned_at FROM public.user_trophies
     WHERE user_id = v_other ORDER BY earned_at DESC) s;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: trophy not readable (%)', v_n; END IF;

  -- Join by code (the app's door), then GymHub and gymBusinesses.js: am I a
  -- member, the roster, leave.
  v_join := public.join_gym_by_code(v_code);
  IF (v_join->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'probe: join by code failed %', v_join;
  END IF;
  PERFORM id FROM public.gym_members WHERE gym_id = v_gym AND user_id = v_me;
  SELECT count(*) INTO v_n FROM (
    SELECT joined_at, user_id FROM public.gym_members WHERE gym_id = v_gym) s;
  IF v_n <> 2 THEN RAISE EXCEPTION 'probe: gym roster %', v_n; END IF;
  DELETE FROM public.gym_members WHERE gym_id = v_gym AND user_id = v_me;
  IF EXISTS (SELECT 1 FROM public.gym_members WHERE gym_id = v_gym AND user_id = v_me) THEN
    RAISE EXCEPTION 'probe: leaving the gym did nothing';
  END IF;

  EXECUTE 'RESET role';

  SELECT member_count INTO v_n FROM public.gym_businesses WHERE id = v_gym;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'probe: member count %', v_n; END IF;

  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
