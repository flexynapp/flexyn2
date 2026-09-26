-- 380_suggested_followees_drops_email.sql
--
-- `get_suggested_followees` put up to eight real user email addresses on the
-- wire on every Hub feed render.
--
-- FollowSuggestionRail calls it on each render and used the address for three
-- things: a dedupe key, the `following`/`followed` button state, and the
-- argument to `hubFollows.follow()`. The RPC already returns `user_id`, and
-- `follow()` accepts either shape — `followMatch` routes a uuid to
-- follower_id/followee_id. So the address was carried for identification the
-- id already did, and anyone with devtools open (or reading the response
-- cache) saw eight other people's addresses per load, rotating as the
-- suggestions did.
--
-- This is the surface migrations 218 and 220 closed for the sibling rail.
-- PeopleYouMayKnow was rewritten to return `user_id` only, and its own comment
-- states the rule: "Hydration reads public_profiles, not user_profiles — the
-- view carries no email, so a suggestion card cannot leak an address." This
-- one was simply never brought along.
--
-- THE CLIENT MOVED FIRST, ON PURPOSE. The rail is already keyed on `user_id`
-- as of the commit that carries this file, and that works against the CURRENT
-- function as well as this one — an extra column in the result is ignored. So
-- there is no flag day and no window where the rail is broken, whichever order
-- deploy and paste happen in.
--
-- Changing RETURNS TABLE requires DROP + CREATE rather than CREATE OR REPLACE,
-- which drops the grants with it. Restoring them is the migration 203/218
-- lesson and is why the REVOKE/GRANT below is not optional bookkeeping:
-- EXECUTE currently belongs to `authenticated` and `service_role`, and NOT to
-- `anon`, verified against the installed function before writing this.
--
-- The body is the INSTALLED definition read back with pg_get_functiondef,
-- minus the column. Nothing else changes: `hide_from_search IS NOT TRUE` is
-- already there (migration 377), the CTE-first shape with no `alias.column`
-- tokens is deliberate and is what makes this bundle survive the paste
-- pipeline, and the ordering, clamps and auth guard are untouched.

BEGIN;

DROP FUNCTION IF EXISTS public.get_suggested_followees(integer);

CREATE FUNCTION public.get_suggested_followees(p_limit integer DEFAULT 8)
RETURNS TABLE(
  user_id        uuid,
  username       text,
  avatar_url     text,
  current_level  integer,
  follower_count integer,
  active_until   timestamp with time zone
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT;
  v_limit  INT  := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);
  v_since  DATE := (now() AT TIME ZONE 'UTC')::date - INTERVAL '30 days';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  RETURN QUERY
  WITH
    already_followed AS (
      SELECT followee_email AS followed_email
        FROM public.hub_follows
       WHERE follower_email = v_email
    ),
    follower_counts AS (
      SELECT followee_email AS counted_email,
             COUNT(*)::INT  AS followers
        FROM public.hub_follows
       GROUP BY followee_email
    ),
    eligible AS (
      -- `cand_email` stays INSIDE the query: the already-followed filter and
      -- the follower-count join are both keyed on the address, because
      -- hub_follows is. It is simply no longer selected out to the caller.
      SELECT id            AS cand_id,
             username      AS cand_username,
             email         AS cand_email,
             avatar_url    AS cand_avatar,
             current_level AS cand_level,
             active_until  AS cand_active_until,
             created_at    AS cand_created_at
        FROM public.user_profiles
       WHERE id <> v_uid
         AND email IS NOT NULL
         AND username IS NOT NULL
         AND username NOT LIKE 'deleted_%'
         AND last_login_date >= v_since
         AND hide_from_search IS NOT TRUE
         AND email NOT IN (SELECT followed_email FROM already_followed)
    )
  SELECT cand_id,
         cand_username,
         cand_avatar,
         cand_level,
         COALESCE(followers, 0),
         cand_active_until
    FROM eligible
    LEFT JOIN follower_counts ON counted_email = cand_email
   ORDER BY COALESCE(followers, 0) DESC, cand_created_at ASC
   LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_suggested_followees(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_suggested_followees(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_suggested_followees(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_suggested_followees(integer) TO service_role;

COMMIT;

-- ── Proof it ran ─────────────────────────────────────────────────────────
-- The SQL editor hides RAISE NOTICE, so this bundle ends in a SELECT. It
-- verifies by CALLING as well as by inspecting: a rewritten body that raises
-- 42702 "ambiguous column" only fails when invoked, which is the whole reason
-- migration 239 exists for this same function.
SELECT
  (SELECT count(*)::int FROM information_schema.parameters
     WHERE specific_schema = 'public'
       AND specific_name LIKE 'get_suggested_followees%'
       AND parameter_mode = 'OUT'
       AND parameter_name = 'email')                                  AS email_still_returned,
  (SELECT count(*)::int FROM information_schema.parameters
     WHERE specific_schema = 'public'
       AND specific_name LIKE 'get_suggested_followees%'
       AND parameter_mode = 'OUT'
       AND parameter_name = 'user_id')                                AS user_id_returned,
  (SELECT has_function_privilege('authenticated',
     'public.get_suggested_followees(integer)', 'EXECUTE'))           AS authenticated_may_call,
  (SELECT has_function_privilege('anon',
     'public.get_suggested_followees(integer)', 'EXECUTE'))           AS anon_may_call;
-- Expected: 0, 1, true, false.
--
-- `parameter_mode = 'OUT'`, not 'TABLE'. Postgres reports RETURNS TABLE
-- columns as OUT parameters, and the first draft of this block filtered on
-- 'TABLE' — which matches nothing, so the email check read 0 and PASSED while
-- the column was still there. The `user_id_returned` line beside it is what
-- exposed that: a positive control that must read 1, so a query matching
-- nothing fails loudly instead of congratulating itself.
