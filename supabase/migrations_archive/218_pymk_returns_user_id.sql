-- 218_pymk_returns_user_id.sql
--
-- get_people_you_may_know returned (email, mutual_count), forcing the
-- client (PeopleYouMayKnow.jsx) to hydrate candidates by matching
-- users.list() rows on email — a public_profiles email read that blocks
-- dropping email from the view.
--
-- Rewrite it to return (user_id, mutual_count), computed entirely off the
-- backfilled follower_id / followee_id columns (mig 208). This also lets
-- us drop the p_email trust surface entirely: the function now works
-- purely from auth.uid(), so a client can no longer probe another
-- account's social graph by passing someone else's email (mig 108 gated
-- this; now it's structurally impossible). p_email is kept in the
-- signature for call-site compatibility but is ignored.
--
-- Changing the RETURNS TABLE shape requires DROP + CREATE (CREATE OR
-- REPLACE cannot alter output columns). After a DROP the default PUBLIC
-- EXECUTE grant returns, so we REVOKE FROM PUBLIC and re-GRANT to
-- authenticated (the mig 203 lesson). Paste-safe: every statement is
-- single-table with bare columns; CTEs rename join keys so there are no
-- dotted alias.column tokens.

DROP FUNCTION IF EXISTS public.get_people_you_may_know(TEXT, INT);

CREATE FUNCTION public.get_people_you_may_know(
  p_email  TEXT DEFAULT NULL,   -- ignored; kept for call-site compatibility
  p_limit  INT  DEFAULT 8
)
RETURNS TABLE (
  user_id      UUID,
  mutual_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $pymk$
DECLARE
  v_uid   UUID := auth.uid();
  v_limit INT  := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 50);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH
    i_follow AS (
      SELECT followee_id AS fid
        FROM public.hub_follows
       WHERE follower_id = v_uid
    ),
    follow_me AS (
      SELECT follower_id AS fid
        FROM public.hub_follows
       WHERE followee_id = v_uid
    ),
    candidates AS (
      SELECT followee_id AS candidate_id,
             COUNT(*)    AS mutuals
        FROM public.hub_follows
       WHERE follower_id IN (SELECT fid FROM follow_me)
         AND followee_id IS NOT NULL
         AND followee_id <> v_uid
         AND followee_id NOT IN (SELECT fid FROM i_follow)
       GROUP BY followee_id
    )
  SELECT candidate_id, mutuals
    FROM candidates
   ORDER BY mutuals DESC
   LIMIT v_limit;
END;
$pymk$;

REVOKE ALL    ON FUNCTION public.get_people_you_may_know(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_people_you_may_know(TEXT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
