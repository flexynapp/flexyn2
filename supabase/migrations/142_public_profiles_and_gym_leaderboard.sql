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
BEGIN
  RETURN QUERY
  WITH workout_window AS (
    SELECT
      gm.gym_id,
      COUNT(w.id)               AS workout_count,
      COUNT(DISTINCT w.user_id) AS active_members
    FROM  gym_members  gm
    JOIN  workout_logs w  ON w.user_id = gm.user_id
    WHERE w.date >= CURRENT_DATE - 7
    GROUP BY gm.gym_id
  ),
  scored AS (
    SELECT
      gb.id                                                       AS gym_id,
      gb.name                                                     AS gym_name,
      gb.logo_url,
      gb.city,
      gb.state_code,
      gb.member_count::BIGINT                                     AS member_count,
      COALESCE(ww.active_members, 0)::BIGINT                     AS active_members,
      COALESCE(ww.workout_count,  0)::BIGINT                     AS workout_count,
      ROUND(
        COALESCE(ww.workout_count, 0) *
        LOG(COALESCE(ww.active_members, 0) + 1)::NUMERIC,
        2
      )                                                           AS score
    FROM  gym_businesses gb
    LEFT JOIN workout_window ww ON ww.gym_id = gb.id
    WHERE gb.is_active = TRUE
      AND COALESCE(ww.workout_count, 0) > 0
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY s.score DESC, s.workout_count DESC),
    s.gym_id,
    s.gym_name,
    s.logo_url,
    s.city,
    s.state_code,
    s.member_count,
    s.active_members,
    s.workout_count,
    s.score
  FROM scored s
  ORDER BY s.score DESC, s.workout_count DESC
  LIMIT p_limit;
END;
$func$;

-- Callable by everyone — anon for public leaderboard widget, authenticated
-- for the full in-app GymMap leaderboard tab.
GRANT EXECUTE ON FUNCTION public.get_gym_vs_gym_leaderboard(INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
