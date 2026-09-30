-- Group DMs can be started from user ids.
--
-- create_group_conversation takes the participants' emails, so the group
-- picker had to read the email of everyone the user follows off
-- hub_follows. This overload takes user ids and resolves the emails on the
-- server, which lets the app stop reading followee_email before that column
-- is locked. The email version is unchanged and still does every check.
--
-- An unknown id is dropped rather than refused, the same as an empty email
-- is in the original; the size checks then decide.

CREATE OR REPLACE FUNCTION public.create_group_conversation_by_ids(
  p_user_ids uuid[],
  p_title    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  RETURN public.create_group_conversation(
    ARRAY(SELECT p.email FROM public.user_profiles p
           WHERE p.id = ANY (COALESCE(p_user_ids, '{}'::uuid[]))
             AND p.id <> auth.uid()
             AND NULLIF(p.email, '') IS NOT NULL),
    p_title);
END;
$$;
REVOKE ALL ON FUNCTION public.create_group_conversation_by_ids(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_conversation_by_ids(uuid[], text) TO authenticated;

-- Probe, as a real signed-in user, rolled back: a group of three built from
-- two ids lands with all three participants; one id is too few.
DO $probe$
DECLARE
  v_me   uuid := gen_random_uuid();
  v_a    uuid := gen_random_uuid();
  v_b    uuid := gen_random_uuid();
  v_conv uuid;
  v_n    int;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_me, 'probe_d_' || v_me || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_a,  'probe_d_' || v_a  || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_b,  'probe_d_' || v_b  || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email) VALUES
    (v_me, 'probe_d_' || v_me || '@probe.invalid'),
    (v_a,  'probe_d_' || v_a  || '@probe.invalid'),
    (v_b,  'probe_d_' || v_b  || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated',
                      'email', 'probe_d_' || v_me || '@probe.invalid')::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  v_conv := public.create_group_conversation_by_ids(ARRAY[v_a, v_b, v_me], 'probe');
  SELECT cardinality(participant_emails) INTO v_n
    FROM public.hub_conversations WHERE id = v_conv;
  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'probe: group has % participants', v_n;
  END IF;

  BEGIN
    PERFORM public.create_group_conversation_by_ids(ARRAY[v_a], NULL);
    RAISE EXCEPTION 'probe: a group of two was allowed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END
$probe$;
