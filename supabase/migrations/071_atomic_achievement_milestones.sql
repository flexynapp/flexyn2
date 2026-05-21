-- 071_atomic_achievement_milestones.sql
--
-- Closes the last capsule-audit race: grantForAchievementMilestone in
-- src/lib/data/capsules.js inserted capsules one-at-a-time, then bumped
-- user_profiles.milestone_capsules_awarded by the number inserted in a
-- SECOND statement. If the bump failed (network blip, transient DB
-- error) between the successful inserts and the counter update, the
-- next call would see the OLD counter, re-derive the same "owed"
-- list, and re-insert the same milestones — duplicate capsules.
--
-- New atomic grant_achievement_milestones(p_unlocked_count INT) RPC:
--   1. Reads the user's current milestone_capsules_awarded under a row
--      lock (FOR UPDATE).
--   2. Computes the gap (which milestones haven't been granted).
--   3. Inserts capsules + bumps the counter in ONE transaction. Either
--      both happen or neither does.
--
-- The milestone schedule is inlined here as a VALUES table — must stay
-- in sync with ACHIEVEMENT_MILESTONES in src/lib/data/capsules.js
-- (5/standard, 10/standard, 25/premium, 50/premium, 100/elite).

CREATE OR REPLACE FUNCTION public.grant_achievement_milestones(p_unlocked_count INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_email            TEXT;
  v_already_awarded  INT;
  v_milestone        RECORD;
  v_granted_count    INT := 0;
  v_granted_payload  JSONB := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_unlocked_count IS NULL OR p_unlocked_count < 0 THEN
    RAISE EXCEPTION 'invalid unlocked_count' USING ERRCODE = '22023';
  END IF;

  -- Lock the user's profile row + read the current awarded counter.
  -- FOR UPDATE serializes concurrent grantForAchievementMilestone
  -- calls on the same user — only one can proceed at a time, so the
  -- read+insert+update sequence below is race-safe.
  SELECT email, COALESCE(milestone_capsules_awarded, 0)
    INTO v_email, v_already_awarded
    FROM public.user_profiles
   WHERE id = v_uid
   FOR UPDATE;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'user_profile not found' USING ERRCODE = '22023';
  END IF;

  -- Iterate the milestone schedule in order; grant any whose threshold
  -- is now met but whose index is >= the already-awarded count.
  -- Using a CTE with an explicit row_number so we can compare index
  -- against v_already_awarded without depending on row ordering luck.
  FOR v_milestone IN
    SELECT * FROM (
      VALUES
        (1, 5,   'standard'),
        (2, 10,  'standard'),
        (3, 25,  'premium'),
        (4, 50,  'premium'),
        (5, 100, 'elite')
    ) AS m(idx, threshold, capsule_type)
   WHERE m.threshold <= p_unlocked_count
     AND m.idx > v_already_awarded
   ORDER BY m.idx
  LOOP
    INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
    VALUES (v_uid, v_email, v_milestone.capsule_type);
    v_granted_count := v_granted_count + 1;
    v_granted_payload := v_granted_payload || jsonb_build_object(
      'threshold', v_milestone.threshold,
      'type',      v_milestone.capsule_type
    );
  END LOOP;

  IF v_granted_count = 0 THEN
    RETURN jsonb_build_object(
      'granted_count', 0,
      'granted',       '[]'::jsonb,
      'awarded_total', v_already_awarded
    );
  END IF;

  -- Bump the counter in the same transaction. If anything above failed
  -- the inserts already rolled back; if this fails the entire grant
  -- rolls back. No half-state.
  UPDATE public.user_profiles
     SET milestone_capsules_awarded = v_already_awarded + v_granted_count
   WHERE id = v_uid;

  RETURN jsonb_build_object(
    'granted_count', v_granted_count,
    'granted',       v_granted_payload,
    'awarded_total', v_already_awarded + v_granted_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_achievement_milestones(INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
