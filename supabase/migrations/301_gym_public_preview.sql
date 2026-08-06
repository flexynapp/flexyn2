-- 301_gym_public_preview.sql
--
-- Two halves of one decision: close the roster, then publish an
-- anonymised preview in its place.
--
-- ── What was actually true ───────────────────────────────────────────
--
-- CLAUDE.md records that gym community data is members-only because it
-- "reports how many people train at a named physical address and when".
-- The RPCs enforce that. The TABLE did not: `gym_members` carried a
-- `read all` policy with `USING (true)`, so any signed-in user could
-- read the full roster of any gym and join it to public_profiles for
-- usernames, avatars, XP and streaks.
--
-- Verified as a real non-member before writing this (SET LOCAL role
-- authenticated + JWT claims, rolled back): a member of one gym read 4
-- roster rows and 2 usernames from a gym they do not belong to, while
-- the leaderboard RPC correctly answered 42501. The gate was on the
-- expensive door and the window was open.
--
-- ── Why that changes the preview design ──────────────────────────────
--
-- With a public roster, ANY per-person activity figure can be
-- re-attached to a name by elimination. "Somebody here trained 6 days"
-- at a two-member gym is a named person's attendance record. Closing
-- the roster is therefore not a separate tidy-up — it is what makes an
-- anonymised preview meaningful at all.

-- ── 1. The roster follows the same rule as everything else ───────────
--
-- Own rows, or rows of a gym you belong to. Every client reader was
-- checked against this before changing it, because a wrong RLS
-- tightening fails silently — mig 185 dropped a SELECT policy and
-- quietly broke every storage delete for months:
--
--   leaveGym             DELETE of own row, has its own policy      ok
--   listMyGyms           own rows (user_id = auth.uid())            ok
--   listGymMembers       roster; only rendered on a members-only tab ok
--   GymHub membership    own row for one gym                        ok
--
-- is_gym_member_or_owner is SECURITY DEFINER, so calling it from a
-- policy ON gym_members does not recurse back through this policy.
DROP POLICY IF EXISTS "gym_members: read all" ON public.gym_members;
DROP POLICY IF EXISTS "gym_members: read own or same gym" ON public.gym_members;
CREATE POLICY "gym_members: read own or same gym" ON public.gym_members
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_gym_member_or_owner(gym_id, (SELECT auth.uid()))
  );

-- ── 2. What a non-member may see instead ─────────────────────────────
--
-- Shape without identity: how busy the floor is, never who is on it.
--
-- The threshold is the load-bearing part, not the omission of names.
-- Below five members an individual's attendance is derivable from the
-- aggregate by anyone who can see the roster — and members still can.
-- Five is ordinary small-cell suppression.
--
-- Consequence worth knowing rather than discovering: the Sanford
-- Springvale YMCA has four members today, so it reports its count and
-- nothing else until a fifth person joins. That is the design working.
CREATE OR REPLACE FUNCTION public.get_gym_public_preview(p_gym_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_members CONSTANT INTEGER := 5;
  v_members  INTEGER;
  v_active   INTEGER;
  v_sessions INTEGER;
  v_days     INTEGER;
  v_shape    INTEGER[];
BEGIN
  IF p_gym_id IS NULL THEN
    RETURN jsonb_build_object('member_count', 0, 'meets_threshold', FALSE);
  END IF;

  SELECT count(*) INTO v_members
    FROM public.gym_members WHERE gym_id = p_gym_id;

  -- Counted live rather than read from gym_businesses.member_count: the
  -- stored column is a denormalised cache, and a threshold that protects
  -- people must not be decided by a number that can drift.
  IF v_members IS NULL OR v_members < v_min_members THEN
    RETURN jsonb_build_object(
      'member_count', COALESCE(v_members, 0),
      'meets_threshold', FALSE);
  END IF;

  WITH members AS (
    SELECT user_id AS m_user_id
      FROM public.gym_members
     WHERE gym_id = p_gym_id
  ),
  logs AS (
    SELECT user_id AS w_user_id,
           date    AS w_date
      FROM public.workout_logs
     WHERE date >= CURRENT_DATE - 6
       AND user_id IN (SELECT m_user_id FROM members)
  ),
  per_person AS (
    SELECT count(DISTINCT w_date) AS d
      FROM logs
     GROUP BY w_user_id
     ORDER BY count(DISTINCT w_date) DESC
     LIMIT 8
  )
  SELECT
    (SELECT count(DISTINCT w_user_id) FROM logs),
    (SELECT count(*) FROM logs),
    (SELECT count(DISTINCT (w_user_id, w_date)) FROM logs),
    -- Bare day counts, ordered, with no user_id attached and no way to
    -- line them up against the roster. Eight is plenty for a bar chart.
    (SELECT array_agg(d) FROM per_person)
  INTO v_active, v_sessions, v_days, v_shape;

  RETURN jsonb_build_object(
    'member_count',    v_members,
    'meets_threshold', TRUE,
    'active_members',  COALESCE(v_active, 0),
    'session_count',   COALESCE(v_sessions, 0),
    'active_days',     COALESCE(v_days, 0),
    'streak_shape',    COALESCE(to_jsonb(v_shape), '[]'::jsonb));
END;
$$;

-- Deliberately NOT granted to anon. A signed-out visitor reaching
-- PublicGymLanding is a different audience and a separate decision;
-- widening this later is one GRANT, and narrowing it after someone has
-- scraped it is not.
REVOKE ALL ON FUNCTION public.get_gym_public_preview(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_public_preview(UUID) TO authenticated;
