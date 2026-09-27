-- Four helpers stop answering questions about other people.
--
-- Each takes the person to ask about as a parameter, runs SECURITY DEFINER
-- and was executable by every signed-in user, guests included
-- (2026-09-27 codebase audit, items 6 and 7):
--
--   is_gym_member_or_owner(gym, user)  looping gym ids from the map reveals
--       which gym a named person trains at, the exact thing migration 301
--       hid when it closed the gym_members roster.
--   is_app_admin(user)                 lists who the admins are.
--   crew_count_for(user)               any user's crew count.
--   gym_rival_record(user)             any user's Gym Rival wins and losses.
--
-- What calls them, measured first:
--   * is_gym_member_or_owner: nine RLS policies and three RPCs, every one
--     passing auth.uid(). It cannot be revoked (a helper revoked from
--     authenticated makes the policies that call it throw; see CLAUDE.md),
--     so it now answers only for the caller.
--   * is_app_admin: twelve admin RPCs, every one passing auth.uid() or a
--     variable holding it. Same treatment.
--   * crew_count_for: nothing in the app or the database. Revoked.
--   * gym_rival_record: the Gym Rival menu, for you and for your rival. It
--     now answers for yourself and for anyone you have been paired with.
--
-- "Only for the caller" keeps a NULL auth.uid() working, which is the
-- postgres and service_role context of crons and other definer code; anon
-- has no EXECUTE on any of these.

CREATE OR REPLACE FUNCTION public.is_gym_member_or_owner(p_gym_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (auth.uid() IS NULL OR p_uid = auth.uid())
     AND (EXISTS (SELECT 1 FROM public.gym_members WHERE gym_id = p_gym_id AND user_id = p_uid)
          OR EXISTS (SELECT 1 FROM public.gym_businesses WHERE id = p_gym_id AND owner_id = p_uid));
$$;

CREATE OR REPLACE FUNCTION public.is_app_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (auth.uid() IS NULL OR p_user_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = p_user_id);
$$;

REVOKE ALL ON FUNCTION public.crew_count_for(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gym_rival_record(p_uid uuid)
RETURNS TABLE(wins integer, losses integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(COUNT(*) FILTER (WHERE winner_id = p_uid), 0)::int AS wins,
    COALESCE(COUNT(*) FILTER (
      WHERE status = 'completed' AND winner_id IS NOT NULL AND winner_id <> p_uid
    ), 0)::int AS losses
  FROM public.gym_rival_assignments
  WHERE (user_id = p_uid OR rival_id = p_uid)
    AND (auth.uid() IS NULL
         OR p_uid = auth.uid()
         OR EXISTS (SELECT 1 FROM public.gym_rival_assignments pair
                     WHERE (pair.user_id = auth.uid() AND pair.rival_id = p_uid)
                        OR (pair.rival_id = auth.uid() AND pair.user_id = p_uid)));
$$;

-- Prove it as a real signed-in user: asking about yourself still works,
-- asking about a stranger gets nothing, and crew_count_for is refused.
DO $$
DECLARE
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  v_gym uuid;
  v_ok boolean;
  v_wins int;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role)
    VALUES (a, 'probe_pa_' || a || '@probe.invalid', 'authenticated', 'authenticated'),
           (b, 'probe_pb_' || b || '@probe.invalid', 'authenticated', 'authenticated');
    INSERT INTO public.user_profiles (id, email)
    VALUES (a, 'probe_pa_' || a || '@probe.invalid'), (b, 'probe_pb_' || b || '@probe.invalid')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.gym_businesses (name, source, flexyn_code) VALUES ('probe gym ' || a, 'community', 'PRBZZZZ2')
    RETURNING id INTO v_gym;
    INSERT INTO public.gym_members (gym_id, user_id, user_email) VALUES (v_gym, a, 'a@probe.test'), (v_gym, b, 'b@probe.test');
    INSERT INTO public.admin_users (user_id) VALUES (b);

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', a, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    IF NOT public.is_gym_member_or_owner(v_gym, a) THEN
      RAISE EXCEPTION 'is_gym_member_or_owner stopped answering for the caller';
    END IF;
    IF public.is_gym_member_or_owner(v_gym, b) THEN
      RAISE EXCEPTION 'is_gym_member_or_owner still answers about someone else';
    END IF;
    IF public.is_app_admin(b) THEN
      RAISE EXCEPTION 'is_app_admin still reveals another user is an admin';
    END IF;
    SELECT wins INTO v_wins FROM public.gym_rival_record(b);
    RESET ROLE;

    -- gym_rival_record for a stranger returns zeros, not their record.
    IF v_wins <> 0 THEN RAISE EXCEPTION 'gym_rival_record answered for a stranger'; END IF;

    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM public.crew_count_for(b);
      RESET ROLE;
      RAISE EXCEPTION 'crew_count_for is still callable';
    EXCEPTION WHEN insufficient_privilege THEN RESET ROLE;
    END;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    IF SQLERRM <> 'probe_rollback' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
END
$$;
