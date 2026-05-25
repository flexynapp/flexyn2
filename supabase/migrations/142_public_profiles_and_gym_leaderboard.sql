-- 142_public_profiles_and_gym_leaderboard.sql
--
-- Three additions that power the viral public surfaces:
--
--   1. Anon SELECT on gym_businesses (active gyms) — lets unauthenticated
--      visitors see the Public Gym Landing (/p/gym/:id) and the map tiles
--      without signing in first.
--
--   2. Anon SELECT on gym_members — needed so the leaderboard RPC
--      can report member-count and the public gym landing can show "X members"
--      without auth.
--
--   3. get_gym_vs_gym_leaderboard() SECURITY DEFINER RPC — ranks every active
--      gym by 7-day workout activity.
--
--      Score = workout_count * LOG(active_members + 1)
--
--      This rewards breadth of participation, not just raw session count:
--      a gym where 30 different members trained in a week beats one where
--      a single obsessive logged 30 sessions. LOG damping keeps giants
--      from infinitely dominating over smaller, highly-active gyms.
--
--      Requires no new tables — it joins the existing gym_businesses,
--      gym_members, and workout_logs tables.
--
-- Idempotent: policies use CREATE POLICY (will error on re-run if already
-- present, but DROP/CREATE pattern is safe to add if needed).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Public read access to active gyms ─────────────────────────────────────
DROP POLICY IF EXISTS "Public can view active gyms" ON public.gym_businesses;
CREATE POLICY "Public can view active gyms"
  ON public.gym_businesses
  FOR SELECT
  TO anon
  USING (is_active = TRUE);

-- Supabase auto-grants SELECT to anon on public schema tables with RLS enabled,
-- but be explicit so this works on self-hosted Postgres too.
GRANT SELECT ON public.gym_businesses TO anon;

-- ── 2. Anon read on gym_members (no PII — only user_id + gym_id exposed) ─────
DROP POLICY IF EXISTS "Public can view gym membership list" ON public.gym_members;
CREATE POLICY "Public can view gym membership list"
  ON public.gym_members
  FOR SELECT
  TO anon
  USING (TRUE);

GRANT SELECT ON public.gym_members TO anon;

-- ── 3. Gym-vs-Gym community leaderboard RPC ──────────────────────────────────
-- SECURITY DEFINER so it can read workout_logs without exposing that table to
-- anon directly.  Only aggregate data is returned — no individual workout rows.
CREATE OR REPLACE FUNCTION public.get_gym_vs_gym_leaderboard(
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  rank           BIGINT,
  gym_id         UUID,
  gym_name       TEXT,
  logo_url       TEXT,
  city           TEXT,
  state_code     TEXT,
  member_count   BIGINT,
  active_members BIGINT,
  workout_count  BIGINT,
  score          NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
-- use_column: several RETURNS TABLE OUT params (gym_id, city, member_count…)
-- share names with base columns. Resolving bare names to the column lets the
-- whole query drop short `alias.column` tokens (which the deploy-paste
-- pipeline mangles). Every join key is renamed inside a CTE so the ON
-- clauses compare globally-unique bare names — no qualification needed.
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH member_map AS (
    SELECT gym_id AS m_gym_id, user_id AS m_user_id
      FROM public.gym_members
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
      member_count::BIGINT                     AS s_member_count,
      COALESCE(ww_active_members, 0)::BIGINT   AS s_active_members,
      COALESCE(ww_workout_count,  0)::BIGINT   AS s_workout_count,
      ROUND(
        COALESCE(ww_workout_count, 0) *
        LOG(COALESCE(ww_active_members, 0) + 1)::NUMERIC,
        2
      )                                        AS s_score
    FROM public.gym_businesses
    LEFT JOIN workout_window ON ww_gym_id = id
    WHERE is_active = TRUE
      AND COALESCE(ww_workout_count, 0) > 0
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
$func$;

-- Callable by everyone — anon for public leaderboard widget, authenticated
-- for the full in-app GymMap leaderboard tab.
GRANT EXECUTE ON FUNCTION public.get_gym_vs_gym_leaderboard(INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
