-- ── 327 · the gym-vs-gym board respects mig 301's five-member floor ─
--
-- 301 established the rule: gym activity may be shown without identity
-- only for gyms with at least five members, because below that an
-- individual's attendance is derivable by subtraction — the roster is
-- visible to members, so "3 of 4 trained this week" names people.
-- get_gym_public_preview honours it. This board predates it (mig 142)
-- and published `active_members` and `workout_count` for a gym of ANY
-- size, to every signed-in user, for every gym at once. A one-member
-- gym on this board is one person's weekly attendance, published.
--
-- Mig 326 shut the anon door. This closes the same hole for signed-in
-- non-members, which is where it actually leaked: the board is only
-- rendered inside /gym-map, behind auth.
--
-- Two details that matter more than the WHERE clause:
--
--   • THE FLOOR IS ENFORCED AGAINST A REAL COUNT, not against
--     gym_businesses.member_count. That column is denormalised, and it
--     was wrong in production as recently as mig 324 — a privacy
--     threshold checked against a cache is a privacy threshold that
--     fails whenever the cache does. member_totals counts gym_members
--     directly, in the same query.
--
--   • THE RETURNED member_count NOW COMES FROM THAT SAME COUNT. Gating
--     on one number and displaying another would let the board show
--     "3 members" on a row that only qualified because the counter said
--     seven, which is the confusing half of the bug rather than the
--     dangerous half, but there is no reason to keep it.
--
-- Consequence, and it is not subtle: this empties the board in
-- production today. Both live gyms have one member. That is the correct
-- reading of the rule — a leaderboard of one-member gyms is a list of
-- individuals wearing gym names — and the empty state now says so
-- instead of implying nobody is training.
--
-- Structure, scoring and ordering are otherwise untouched: score is
-- still workout_count x LOG(active_members + 1), which rewards a gym
-- where many DIFFERENT members train over one where one person logs
-- forty sessions.

CREATE OR REPLACE FUNCTION public.get_gym_vs_gym_leaderboard(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  rank            BIGINT,
  gym_id          UUID,
  gym_name        TEXT,
  logo_url        TEXT,
  city            TEXT,
  state_code      TEXT,
  member_count    BIGINT,
  active_members  BIGINT,
  workout_count   BIGINT,
  score           NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  -- Same value, same reason, as get_gym_public_preview (mig 301).
  v_min_members CONSTANT INTEGER := 5;
BEGIN
  RETURN QUERY
  WITH member_map AS (
    SELECT gym_id AS m_gym_id, user_id AS m_user_id
      FROM public.gym_members
  ),
  member_totals AS (
    SELECT m_gym_id AS t_gym_id, COUNT(*) AS t_members
      FROM member_map
     GROUP BY m_gym_id
  ),
  recent_workouts AS (
    SELECT user_id AS w_user_id
      FROM public.workout_logs
     WHERE date >= CURRENT_DATE - 7
  ),
  member_workouts AS (
    SELECT m_gym_id, m_user_id
      FROM member_map
      JOIN recent_workouts ON w_user_id = m_user_id
  ),
  workout_window AS (
    SELECT
      m_gym_id                  AS ww_gym_id,
      COUNT(*)                  AS ww_workout_count,
      COUNT(DISTINCT m_user_id) AS ww_active_members
    FROM member_workouts
    GROUP BY m_gym_id
  ),
  scored AS (
    SELECT
      id                                       AS s_gym_id,
      name                                     AS s_gym_name,
      logo_url                                 AS s_logo_url,
      city                                     AS s_city,
      state_code                               AS s_state_code,
      COALESCE(t_members, 0)::BIGINT           AS s_member_count,
      COALESCE(ww_active_members, 0)::BIGINT   AS s_active_members,
      COALESCE(ww_workout_count,  0)::BIGINT   AS s_workout_count,
      ROUND(
        COALESCE(ww_workout_count, 0) *
        LOG(COALESCE(ww_active_members, 0) + 1)::NUMERIC,
        2
      )                                        AS s_score
    FROM public.gym_businesses
    LEFT JOIN workout_window ON ww_gym_id = id
    LEFT JOIN member_totals  ON t_gym_id  = id
    WHERE is_active = TRUE
      AND COALESCE(ww_workout_count, 0) > 0
      AND COALESCE(t_members, 0) >= v_min_members
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY s_score DESC, s_workout_count DESC),
    s_gym_id,
    s_gym_name,
    s_logo_url,
    s_city,
    s_state_code,
    s_member_count,
    s_active_members,
    s_workout_count,
    s_score
  FROM scored
  ORDER BY s_score DESC, s_workout_count DESC
  LIMIT p_limit;
END;
$$;

-- Re-assert 326's grants. CREATE OR REPLACE keeps the existing ACL, so
-- these are no-ops when 326 has already run and the whole fix when it
-- has not — anon holds EXECUTE through the default PUBLIC grant, so
-- revoking it from anon alone does nothing.
REVOKE EXECUTE ON FUNCTION public.get_gym_vs_gym_leaderboard(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_gym_vs_gym_leaderboard(INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_gym_vs_gym_leaderboard(INTEGER) TO authenticated;
