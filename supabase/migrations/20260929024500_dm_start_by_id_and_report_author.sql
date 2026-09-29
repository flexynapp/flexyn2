-- Start a DM by user id, and let the server name who a report is about.
--
-- 1. start_dm_conversation(p_other_id uuid). The only way to open a DM was
--    start_dm_conversation(p_other_email), so the app first fetched the
--    other person's email through resolve_profile_email, which hands any
--    signed-in caller any user's email. The id version looks the email up
--    server-side and hands off to the email version, so the request-vs-
--    direct decision, the request block and the stale-decline cleanup are
--    the same code.
-- 2. hub_reports: reported_author_email and reporter_email are taken from
--    the reported post, comment or story and from the reporter's profile.
--    The client sent both, which let a report name anyone as the author, and
--    made the story report the last reason the profile page needed the
--    owner's email.

CREATE OR REPLACE FUNCTION public.start_dm_conversation(p_other_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_other text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT email INTO v_other FROM public.user_profiles WHERE id = p_other_id;
  IF v_other IS NULL OR p_other_id = auth.uid() THEN
    RAISE EXCEPTION 'invalid_recipient' USING ERRCODE = '22023';
  END IF;
  RETURN public.start_dm_conversation(v_other);
END;
$fn$;

REVOKE ALL ON FUNCTION public.start_dm_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_dm_conversation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pin_report_identities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_author text;
BEGIN
  IF NEW.reporter_user_id IS NOT NULL THEN
    SELECT email INTO NEW.reporter_email
      FROM public.user_profiles WHERE id = NEW.reporter_user_id;
  END IF;

  IF NEW.reported_type = 'post' THEN
    SELECT author_email INTO v_author FROM public.hub_posts WHERE id = NEW.reported_id;
  ELSIF NEW.reported_type = 'comment' THEN
    SELECT author_email INTO v_author FROM public.hub_comments WHERE id = NEW.reported_id;
  ELSIF NEW.reported_type = 'story' THEN
    SELECT p.email INTO v_author
      FROM public.stories s JOIN public.user_profiles p ON p.id = s.user_id
     WHERE s.id = NEW.reported_id;
  END IF;
  -- Whatever the client sent is never kept: an unknown target records NULL.
  NEW.reported_author_email := v_author;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pin_report_identities() FROM PUBLIC, anon, authenticated;

-- Before the AFTER INSERT trigger that emails the report, so the email
-- carries the derived values.
DROP TRIGGER IF EXISTS hub_reports_a_pin_identities ON public.hub_reports;
CREATE TRIGGER hub_reports_a_pin_identities
  BEFORE INSERT ON public.hub_reports
  FOR EACH ROW EXECUTE FUNCTION public.pin_report_identities();

-- Probe, rolled back.
DO $probe$
DECLARE
  v_me     uuid := gen_random_uuid();
  v_a      uuid := gen_random_uuid();
  v_me_em  text;
  v_a_em   text;
  v_post   uuid;
  v_conv   uuid;
  v_conv2  uuid;
  v_em     text;
  v_rep    text;
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

  -- A post by A, written as A.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated', 'email', v_a_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';
  INSERT INTO public.hub_posts (created_by, user_id, body, privacy)
  VALUES (v_a_em, v_a, 'probe', 'public') RETURNING id INTO v_post;
  EXECUTE 'RESET role';

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated', 'email', v_me_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  -- DM by id lands on the same conversation as DM by email.
  v_conv := public.start_dm_conversation(v_a);
  v_conv2 := public.start_dm_conversation(v_a_em);
  IF v_conv IS NULL OR v_conv IS DISTINCT FROM v_conv2 THEN
    RAISE EXCEPTION 'probe: id and email start different conversations';
  END IF;
  BEGIN
    PERFORM public.start_dm_conversation(v_me);
    RAISE EXCEPTION 'probe: DM to self accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.start_dm_conversation(gen_random_uuid());
    RAISE EXCEPTION 'probe: DM to nobody accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- A report naming the wrong author and reporter is corrected.
  INSERT INTO public.hub_reports (reporter_user_id, reporter_email, reported_type,
                                  reported_id, reported_author_email, reason)
  VALUES (v_me, 'someone@else.invalid', 'post', v_post, 'victim@else.invalid', 'spam')
  RETURNING reported_author_email, reporter_email INTO v_em, v_rep;
  IF lower(v_em) IS DISTINCT FROM lower(v_a_em) OR lower(v_rep) IS DISTINCT FROM lower(v_me_em) THEN
    RAISE EXCEPTION 'probe: report kept client emails (%, %)', v_em, v_rep;
  END IF;

  EXECUTE 'RESET role';
  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
