-- 090_crew_discovery.sql
--
-- Surfaces "suggested crews" — non-full crews the caller is not yet a
-- member of, sorted by member count descending. Drives the Crew
-- Suggestion Rail on the Hub Crews tab, which converts visitors into
-- crew members and activates the crew_war notification surface that
-- migration 069 wired up but is currently dead because most users
-- aren't in any crew.
--
-- DESIGN
-- ──────
-- Single SECURITY DEFINER RPC. Excludes:
--   • Crews the caller is already in (one-row-per-crew via NOT EXISTS).
--   • Crews at or above their max_capacity (default 16).
--   • Crews with zero members (orphan / mid-creation state).
--
-- Returns 5 rows max — the rail is horizontal and bigger lists hurt
-- decision-making. Sort by member count DESC to show popular crews
-- first (social proof), tiebreak by created_at ASC to favor older /
-- established crews over freshly-spawned ones.

CREATE OR REPLACE FUNCTION public.get_suggested_crews(p_limit INT DEFAULT 5)
RETURNS TABLE (
  id           UUID,
  name         TEXT,
  member_count INT,
  max_capacity INT,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_limit INT  := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      c.id,
      c.name,
      COUNT(cm.id)::INT AS member_count,
      COALESCE(c.max_capacity, 16) AS max_capacity,
      c.created_at
    FROM public.crews c
    JOIN public.crew_members cm ON cm.crew_id = c.id
    WHERE NOT EXISTS (
      -- Exclude crews the caller is already in.
      SELECT 1 FROM public.crew_members me
       WHERE me.crew_id = c.id AND me.user_id = v_uid
    )
    GROUP BY c.id, c.name, c.max_capacity, c.created_at
    HAVING COUNT(cm.id) > 0
       AND COUNT(cm.id) < COALESCE(c.max_capacity, 16)
    ORDER BY COUNT(cm.id) DESC, c.created_at ASC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_suggested_crews(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_suggested_crews(INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
