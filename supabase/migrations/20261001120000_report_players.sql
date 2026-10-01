-- Report a player, not just a post.
--
-- Until now a report could only be about a post, a comment or a story, so a
-- lifter sitting at the top of a league bracket with numbers nobody believes
-- could not be flagged at all. Competition is where cheating pays, and it is
-- where nobody could say anything.
--
-- This extends the existing queue rather than adding a second one:
-- hub_reports already has the admin page (/admin/reports), the email to the
-- moderator inbox (notify_report_email) and the "we reviewed your report"
-- notification back to the reporter (notify_report_resolved).
--
-- 1. hub_reports gains reported_type 'user', two reasons that only make
--    sense about a player ('cheating' for impossible lifts or numbers,
--    'fake_activity' for workouts or cardio that never happened), and
--    `context` / `context_id`, which say where the report was filed from
--    (the league bracket, a duel, a crew war...) so the reviewer knows what
--    to look at.
-- 2. report_user() is the only way to file one. It derives the reporter from
--    auth.uid(), refuses self-reports and unknown targets, answers
--    'already' for a second pending report with the same reason, and caps a
--    reporter at 10 player reports a day so the queue cannot be flooded.
--    A direct INSERT with reported_type 'user' is refused by the identity
--    trigger, so the cap cannot be walked around.
-- 3. The reported player is never told, and never learns who reported them:
--    hub_reports is readable only by the reporter (hub_reports_select_own)
--    and nothing here notifies the target.
-- 4. list_reports_for_admin returns the context, the player's username and
--    their last 30 days at a glance (sessions, and how many the plausibility
--    trigger flagged), and can filter to player reports or content reports.
-- 5. delete_reported_content and resolve_report refuse 'actioned' on a
--    player report: there is no content to delete, and the reporter's
--    notification for 'actioned' says "we removed the content you reported".

ALTER TABLE public.hub_reports
  ADD COLUMN IF NOT EXISTS context text,
  ADD COLUMN IF NOT EXISTS context_id uuid;

ALTER TABLE public.hub_reports DROP CONSTRAINT IF EXISTS hub_reports_reported_type_check;
ALTER TABLE public.hub_reports ADD CONSTRAINT hub_reports_reported_type_check
  CHECK (reported_type = ANY (ARRAY['post', 'comment', 'story', 'user']));

ALTER TABLE public.hub_reports DROP CONSTRAINT IF EXISTS hub_reports_reason_check;
ALTER TABLE public.hub_reports ADD CONSTRAINT hub_reports_reason_check
  CHECK (reason = ANY (ARRAY['harassment', 'hate_speech', 'spam', 'inappropriate',
                             'impersonation', 'other', 'cheating', 'fake_activity']));

ALTER TABLE public.hub_reports DROP CONSTRAINT IF EXISTS hub_reports_context_check;
ALTER TABLE public.hub_reports ADD CONSTRAINT hub_reports_context_check
  CHECK (context IS NULL OR context = ANY (ARRAY['league', 'leaderboard', 'duel', 'gym_rival',
                                                 'cardio_rival', 'crew_war', 'gym', 'profile']));

CREATE INDEX IF NOT EXISTS hub_reports_user_target
  ON public.hub_reports (reported_id, created_at DESC) WHERE reported_type = 'user';

-- Identity trigger: same job as before, plus the player case and the guard
-- that keeps player reports going through report_user().
CREATE OR REPLACE FUNCTION public.pin_report_identities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_author text;
BEGIN
  IF NEW.reported_type = 'user'
     AND COALESCE(current_setting('flexyn.report_user_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION 'use_report_user' USING ERRCODE = '42501';
  END IF;

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
  ELSIF NEW.reported_type = 'user' THEN
    SELECT email INTO v_author FROM public.user_profiles WHERE id = NEW.reported_id;
  END IF;
  -- Whatever the client sent is never kept: an unknown target records NULL.
  NEW.reported_author_email := v_author;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pin_report_identities() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.report_user(
  p_user_id    uuid,
  p_reason     text,
  p_context    text DEFAULT NULL,
  p_context_id uuid DEFAULT NULL,
  p_detail     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_me    uuid := auth.uid();
  v_count int;
  v_id    uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_user_id = v_me
     OR NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'invalid_target' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('cheating', 'fake_activity', 'harassment',
                                          'inappropriate', 'spam', 'other') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF p_context IS NOT NULL AND p_context NOT IN ('league', 'leaderboard', 'duel', 'gym_rival',
                                                 'cardio_rival', 'crew_war', 'gym', 'profile') THEN
    RAISE EXCEPTION 'invalid_context' USING ERRCODE = '22023';
  END IF;

  -- One open report per reporter, player and reason.
  IF EXISTS (
    SELECT 1 FROM public.hub_reports
     WHERE reporter_user_id = v_me AND reported_type = 'user'
       AND reported_id = p_user_id AND reason = p_reason AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('status', 'already');
  END IF;

  SELECT count(*) INTO v_count
    FROM public.hub_reports
   WHERE reporter_user_id = v_me AND reported_type = 'user'
     AND created_at > now() - interval '24 hours';
  IF v_count >= 10 THEN
    RAISE EXCEPTION 'report_rate_limited' USING ERRCODE = '54000';
  END IF;

  PERFORM set_config('flexyn.report_user_rpc', 'on', true);
  INSERT INTO public.hub_reports (reporter_user_id, reporter_email, reported_type, reported_id,
                                  reason, detail, context, context_id)
  VALUES (v_me, '', 'user', p_user_id, p_reason,
          NULLIF(left(btrim(COALESCE(p_detail, '')), 400), ''),
          p_context, p_context_id)
  RETURNING id INTO v_id;
  PERFORM set_config('flexyn.report_user_rpc', '', true);

  RETURN jsonb_build_object('status', 'filed', 'id', v_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.report_user(uuid, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_user(uuid, text, text, uuid, text) TO authenticated;

-- The admin list. Return type changes, so drop and recreate.
DROP FUNCTION IF EXISTS public.list_reports_for_admin(text, integer);
DROP FUNCTION IF EXISTS public.list_reports_for_admin(text, integer, text);
CREATE FUNCTION public.list_reports_for_admin(
  p_status text DEFAULT 'pending',
  p_limit  integer DEFAULT 50,
  p_kind   text DEFAULT NULL   -- NULL = all, 'user' = players, 'content' = posts/comments/stories
)
RETURNS TABLE(id uuid, reporter_email text, reported_type text, reported_id uuid,
              reported_author_email text, reason text, detail text, status text,
              content_snippet text, created_at timestamptz, context text, context_id uuid,
              reported_username text, sessions_30d integer, flagged_30d integer,
              reports_against integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT
      r.id,
      r.reporter_email,
      r.reported_type,
      r.reported_id,
      r.reported_author_email,
      r.reason,
      r.detail,
      r.status,
      CASE r.reported_type
        WHEN 'post'    THEN (SELECT substring(hp.content FROM 1 FOR 280) FROM public.hub_posts hp WHERE hp.id = r.reported_id)
        WHEN 'comment' THEN (SELECT substring(hc.content FROM 1 FOR 280) FROM public.hub_comments hc WHERE hc.id = r.reported_id)
        ELSE NULL
      END,
      r.created_at,
      r.context,
      r.context_id,
      CASE WHEN r.reported_type = 'user'
        THEN (SELECT up.username FROM public.user_profiles up WHERE up.id = r.reported_id) END,
      CASE WHEN r.reported_type = 'user'
        THEN (SELECT count(*)::int FROM public.workout_logs w
               WHERE w.user_id = r.reported_id AND w.date >= (current_date - 30)) END,
      CASE WHEN r.reported_type = 'user'
        THEN (SELECT count(*)::int FROM public.workout_logs w
               WHERE w.user_id = r.reported_id AND w.date >= (current_date - 30)
                 AND COALESCE(w.implausible, FALSE)) END,
      CASE WHEN r.reported_type = 'user'
        THEN (SELECT count(DISTINCT o.reporter_user_id)::int FROM public.hub_reports o
               WHERE o.reported_type = 'user' AND o.reported_id = r.reported_id) END
    FROM public.hub_reports r
    WHERE r.status = p_status
      AND (p_kind IS NULL
           OR (p_kind = 'user' AND r.reported_type = 'user')
           OR (p_kind = 'content' AND r.reported_type <> 'user'))
    ORDER BY r.created_at DESC
    LIMIT p_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_reports_for_admin(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_reports_for_admin(text, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_report(p_report_id uuid, p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('reviewed', 'actioned', 'dismissed') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'actioned' AND EXISTS (
    SELECT 1 FROM public.hub_reports WHERE id = p_report_id AND reported_type = 'user'
  ) THEN
    RAISE EXCEPTION 'player_reports_are_reviewed_or_dismissed' USING ERRCODE = '22023';
  END IF;
  UPDATE public.hub_reports
     SET status = p_action
   WHERE id = p_report_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.delete_reported_content(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r_type TEXT;
  r_id   UUID;
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  SELECT reported_type, reported_id INTO r_type, r_id
    FROM public.hub_reports
   WHERE id = p_report_id;
  IF r_type IS NULL THEN
    RAISE EXCEPTION 'report_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF r_type = 'user' THEN
    RAISE EXCEPTION 'player_reports_have_no_content' USING ERRCODE = '22023';
  END IF;
  IF r_type = 'post' THEN
    DELETE FROM public.hub_posts WHERE id = r_id;
  ELSIF r_type = 'comment' THEN
    DELETE FROM public.hub_comments WHERE id = r_id;
  END IF;
  UPDATE public.hub_reports SET status = 'actioned' WHERE id = p_report_id;
END;
$fn$;

-- Probe, rolled back: attempts each thing as a real authenticated user.
DO $probe$
DECLARE
  v_me    uuid := gen_random_uuid();
  v_a     uuid := gen_random_uuid();
  v_res   jsonb;
  v_n     int;
  v_auth  text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_me, 'probe_m_' || v_me || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_a,  'probe_a_' || v_a  || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email) VALUES
    (v_me, 'probe_m_' || v_me || '@probe.invalid'),
    (v_a,  'probe_a_' || v_a  || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  -- Ordinary report is filed and names the right player.
  v_res := public.report_user(v_a, 'cheating', 'league', NULL, '  1,000 lb bench  ');
  IF v_res->>'status' <> 'filed' THEN RAISE EXCEPTION 'probe: report not filed (%)', v_res; END IF;
  SELECT reported_author_email INTO v_auth FROM public.hub_reports WHERE id = (v_res->>'id')::uuid;
  IF lower(v_auth) IS DISTINCT FROM lower('probe_a_' || v_a || '@probe.invalid') THEN
    RAISE EXCEPTION 'probe: wrong reported author %', v_auth;
  END IF;

  -- Same reason again is 'already', a different reason is filed.
  v_res := public.report_user(v_a, 'cheating', 'duel');
  IF v_res->>'status' <> 'already' THEN RAISE EXCEPTION 'probe: duplicate filed (%)', v_res; END IF;
  v_res := public.report_user(v_a, 'fake_activity', 'league');
  IF v_res->>'status' <> 'filed' THEN RAISE EXCEPTION 'probe: second reason refused'; END IF;

  -- Self, unknown target, bad reason, bad context are refused.
  BEGIN PERFORM public.report_user(v_me, 'cheating');
    RAISE EXCEPTION 'probe: self report accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.report_user(gen_random_uuid(), 'cheating');
    RAISE EXCEPTION 'probe: unknown target accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.report_user(v_a, 'hate_speech');
    RAISE EXCEPTION 'probe: content-only reason accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.report_user(v_a, 'other', 'nowhere');
    RAISE EXCEPTION 'probe: bad context accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- A direct insert of a player report is refused (cannot dodge the cap).
  BEGIN
    INSERT INTO public.hub_reports (reporter_user_id, reporter_email, reported_type, reported_id, reason)
    VALUES (v_me, '', 'user', v_a, 'spam');
    RAISE EXCEPTION 'probe: direct player insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- The cap: 2 filed so far; 8 more (written directly, as the table owner)
  -- reach 10, and the next one is refused.
  EXECUTE 'RESET role';
  PERFORM set_config('flexyn.report_user_rpc', 'on', true);
  INSERT INTO public.hub_reports (reporter_user_id, reporter_email, reported_type, reported_id, reason, status)
  SELECT v_me, '', 'user', v_a, 'other', 'dismissed' FROM generate_series(1, 8);
  PERFORM set_config('flexyn.report_user_rpc', '', true);
  EXECUTE 'SET LOCAL role authenticated';
  BEGIN PERFORM public.report_user(v_a, 'spam');
    RAISE EXCEPTION 'probe: rate limit not applied';
  EXCEPTION WHEN program_limit_exceeded THEN NULL; END;

  -- Post reports still go in directly, as before.
  INSERT INTO public.hub_reports (reporter_user_id, reporter_email, reported_type, reported_id, reason)
  VALUES (v_me, '', 'post', gen_random_uuid(), 'spam');

  -- The reporter can read their own reports; the reported player cannot.
  SELECT count(*) INTO v_n FROM public.hub_reports WHERE reported_id = v_a;
  IF v_n = 0 THEN RAISE EXCEPTION 'probe: reporter cannot see own reports'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.hub_reports WHERE reported_id = v_a;
  IF v_n <> 0 THEN RAISE EXCEPTION 'probe: reported player can read % reports', v_n; END IF;

  -- Non-admins cannot read the queue.
  BEGIN PERFORM * FROM public.list_reports_for_admin('pending', 5, 'user');
    RAISE EXCEPTION 'probe: non-admin read the queue';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  EXECUTE 'RESET role';
  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
