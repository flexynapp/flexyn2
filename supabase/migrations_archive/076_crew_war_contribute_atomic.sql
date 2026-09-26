-- 076_crew_war_contribute_atomic.sql
--
-- Closes a HIGH race surfaced by the cross-app audit. The client
-- function contributeWarXp in src/lib/data/crewWars.js was a
-- four-step read-modify-write dance:
--
--   1. SELECT existing crew_war_contributions row for (war_id, user_id)
--   2. UPDATE/INSERT with the user's local computation
--   3. SELECT crew_wars row to find which crew_*_score column to bump
--   4. UPDATE crew_wars SET crew_*_score = oldScore + xp
--
-- Two races, both real:
--
--   A. Same user contributing twice fast — both reads see the same
--      xp_contributed baseline, both add THEIR delta, last write wins.
--      One contribution is lost.
--
--   B. (Worse) Two DIFFERENT users in the same crew finishing workouts
--      simultaneously — both read the same aggregate crew_*_score,
--      both add their respective deltas, last write wins. One user's
--      contribution to the crew score is lost. Crew aggregate
--      diverges from sum of per-user contributions.
--
-- The atomic RPC takes a FOR UPDATE lock on the crew_wars row
-- (serializing aggregate updates), then does:
--   • INSERT … ON CONFLICT (war_id, user_id) DO UPDATE
--     SET xp_contributed = xp_contributed + EXCLUDED.xp_contributed
--   • UPDATE crew_wars SET crew_*_score = crew_*_score + p_xp
--
-- Server-side delta arithmetic everywhere — no read-then-add-then-write.
-- Also validates the caller is a member of the crew they're contributing
-- to, which the client-side path didn't.

CREATE OR REPLACE FUNCTION public.contribute_crew_war_xp(
  p_war_id  UUID,
  p_crew_id UUID,
  p_xp      INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_war          public.crew_wars%ROWTYPE;
  v_is_member    INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_war_id IS NULL OR p_crew_id IS NULL OR p_xp IS NULL OR p_xp <= 0 THEN
    RAISE EXCEPTION 'war_id, crew_id, and positive xp required' USING ERRCODE = '22023';
  END IF;

  -- Lock the war row. Aggregate-score updates below serialize on this.
  SELECT * INTO v_war
    FROM public.crew_wars
   WHERE id = p_war_id
   FOR UPDATE;

  IF v_war.id IS NULL THEN
    RAISE EXCEPTION 'war not found' USING ERRCODE = '22023';
  END IF;
  IF v_war.status <> 'active' THEN
    -- Don't accept contributions to wars that have ended or are still
    -- matchmaking; both states would yield meaningless score updates.
    RAISE EXCEPTION 'war not active' USING ERRCODE = '22023';
  END IF;
  IF p_crew_id <> v_war.crew_a_id AND p_crew_id <> v_war.crew_b_id THEN
    RAISE EXCEPTION 'crew not in this war' USING ERRCODE = '22023';
  END IF;

  -- Caller must actually be a member of the crew they claim to be
  -- contributing for. Without this, any authenticated user could
  -- contribute XP to any crew in any war (SECURITY DEFINER bypasses
  -- the per-table RLS).
  SELECT COUNT(*) INTO v_is_member
    FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = v_uid;
  IF v_is_member = 0 THEN
    RAISE EXCEPTION 'not a member of this crew' USING ERRCODE = '42501';
  END IF;

  -- Per-user contribution: upsert with delta on conflict. The UNIQUE
  -- (war_id, user_id) constraint guarantees one row per user per war,
  -- and ON CONFLICT does the addition server-side.
  INSERT INTO public.crew_war_contributions
    (war_id, user_id, crew_id, xp_contributed, updated_at)
  VALUES
    (p_war_id, v_uid, p_crew_id, p_xp, NOW())
  ON CONFLICT (war_id, user_id) DO UPDATE
     SET xp_contributed = public.crew_war_contributions.xp_contributed + EXCLUDED.xp_contributed,
         updated_at     = NOW();

  -- Aggregate crew score: delta UPDATE under the FOR UPDATE lock.
  IF p_crew_id = v_war.crew_a_id THEN
    UPDATE public.crew_wars
       SET crew_a_score = COALESCE(crew_a_score, 0) + p_xp
     WHERE id = p_war_id;
  ELSE
    UPDATE public.crew_wars
       SET crew_b_score = COALESCE(crew_b_score, 0) + p_xp
     WHERE id = p_war_id;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'war_id',  p_war_id,
    'crew_id', p_crew_id,
    'xp',      p_xp
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.contribute_crew_war_xp(UUID, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contribute_crew_war_xp(UUID, UUID, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
