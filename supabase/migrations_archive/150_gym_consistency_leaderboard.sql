-- 150_gym_consistency_leaderboard.sql
--
-- Effort/consistency gym leaderboard (#5). Ranking purely by volume
-- alienates beginners; this ranks gym members by ACTIVE DAYS in the last
-- 7 days (distinct workout dates, 0–7) so a novice who shows up 5x beats
-- a powerlifter who showed up twice. Democratizes the local board.
--
-- Mirrors get_gym_leaderboard's shape + the alias-free / use_column
-- pattern (RETURNS TABLE OUT params shadow base columns). Idempotent.

CREATE OR REPLACE FUNCTION public.get_gym_consistency_leaderboard(
  p_gym_id UUID,
  p_limit  INT DEFAULT 50
) RETURNS TABLE (
  user_id     UUID,
  username    TEXT,
  avatar_url  TEXT,
  value       NUMERIC,
  rank        INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
    WITH members AS (
      SELECT user_id AS m_user_id, joined_at AS m_joined_at
        FROM public.gym_members
       WHERE gym_id = p_gym_id
    ),
    active AS (
      SELECT user_id AS a_user_id, COUNT(DISTINCT date) AS a_days
        FROM public.workout_logs
       WHERE date >= CURRENT_DATE - 6
         AND user_id IN (SELECT m_user_id FROM members)
       GROUP BY user_id
    ),
    ranked AS (
      SELECT
        id          AS lb_user_id,
        username    AS lb_username,
        avatar_url  AS lb_avatar_url,
        m_joined_at AS lb_joined_at,
        COALESCE(a_days, 0)::NUMERIC AS lb_value
      FROM public.user_profiles
      JOIN members ON m_user_id = id
      LEFT JOIN active ON a_user_id = id
    )
    SELECT lb_user_id, lb_username, lb_avatar_url, lb_value,
           RANK() OVER (ORDER BY lb_value DESC)::INT
      FROM ranked
     ORDER BY lb_value DESC, lb_joined_at ASC, lb_user_id ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.get_gym_consistency_leaderboard(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_consistency_leaderboard(UUID, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
