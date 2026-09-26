-- 156_corporate_hr_dedup_actors.sql
--
-- Code-review follow-up to mig 155. The HR analytics function
-- (get_org_analytics) was rewritten in 155 to union both join keys
-- (user_id + email) so it doesn't undercount activity from legacy
-- email-owned rows. But its `unique_actors` CTE deduped on a per-row
-- COALESCE, not on a canonical actor identity:
--
--   SELECT DISTINCT COALESCE(log_uid::text, log_email) AS actor
--     FROM recent_logs
--
-- A user with BOTH a modern row (user_id set) AND a legacy row
-- (only created_by=email) shows up as TWO distinct actors — undercount
-- becomes overcount, and active_7d can exceed v_members.
--
-- Fix: resolve each member's email-to-uid mapping up front, then
-- normalize every recent log row to a canonical user_id::text before
-- the DISTINCT. Now one human = one actor regardless of which owning
-- column each row used.
--
-- Same signature + return shape as mig 155. Paste-safe + idempotent.

CREATE OR REPLACE FUNCTION public.get_org_analytics(p_org_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_members        INT := 0;
  v_active_7d      INT := 0;
  v_workouts_7d    INT := 0;
  v_avg_streak     NUMERIC := 0;
  v_min_cohort     CONSTANT INT := 5;
  v_min_activity   CONSTANT INT := 2;
  v_round_to       CONSTANT INT := 5;
BEGIN
  IF NOT public.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_members FROM public.organization_members WHERE org_id = p_org_id;

  IF v_members < v_min_cohort THEN
    RETURN jsonb_build_object(
      'members', v_members,
      'cohort_too_small', true,
      'min_cohort', v_min_cohort
    );
  END IF;

  -- Resolve every member's (id, email) up front. The map is used to
  -- canonicalize log rows to user_id even when the only owning column
  -- is created_by=email.
  WITH member_map AS (
    SELECT id AS m_uid, email AS m_email
      FROM public.user_profiles
     WHERE id IN (
       SELECT user_id FROM public.organization_members
        WHERE org_id = p_org_id
     )
  ),
  recent_logs AS (
    SELECT user_id AS log_uid, created_by AS log_email
      FROM public.workout_logs
     WHERE created_at > now() - INTERVAL '7 days'
       AND (
         user_id      IN (SELECT m_uid   FROM member_map)
         OR created_by IN (SELECT m_email FROM member_map)
       )
  ),
  canon AS (
    -- Canonical actor: user_id if present, else resolve the log's
    -- created_by email back to its member uid. CTE-renamed keys only
    -- (m_uid / log_email) so the SQL stays paste-safe.
    SELECT COALESCE(
             log_uid::text,
             (SELECT m_uid::text FROM member_map WHERE m_email = log_email LIMIT 1)
           ) AS canonical_actor
      FROM recent_logs
  ),
  unique_actors AS (
    SELECT DISTINCT canonical_actor FROM canon
     WHERE canonical_actor IS NOT NULL
  )
  SELECT
    (SELECT COUNT(*) FROM unique_actors),
    (SELECT COUNT(*) FROM recent_logs)
   INTO v_active_7d, v_workouts_7d;

  SELECT COALESCE(AVG(COALESCE(workout_streak, 0)), 0)
    INTO v_avg_streak
    FROM public.user_profiles
   WHERE id IN (SELECT user_id FROM public.organization_members WHERE org_id = p_org_id);

  IF v_active_7d < v_min_activity THEN
    RETURN jsonb_build_object(
      'members',           v_members,
      'active_7d',         NULL,
      'workouts_7d',       NULL,
      'avg_workout_streak', ROUND(v_avg_streak, 1),
      'participation_pct', NULL,
      'cohort_too_small',  false,
      'low_activity',      true
    );
  END IF;

  RETURN jsonb_build_object(
    'members',           v_members,
    'active_7d',         v_round_to * ROUND(v_active_7d::numeric / v_round_to),
    'workouts_7d',       v_round_to * ROUND(v_workouts_7d::numeric / v_round_to),
    'avg_workout_streak', ROUND(v_avg_streak, 1),
    'participation_pct', v_round_to * ROUND(100.0 * v_active_7d / v_members / v_round_to),
    'cohort_too_small',  false,
    'low_activity',      false
  );
END;
$$;
REVOKE ALL    ON FUNCTION public.get_org_analytics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_analytics(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
