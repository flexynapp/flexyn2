-- 032_volume_distance_allow_negative.sql
--
-- Update `increment_user_volume` and `increment_user_distance` (originally
-- introduced in migration 023) to accept NEGATIVE deltas with a floor at 0.
-- Without this, the saved-workout edit/delete flow can't decrement the
-- denormalized totals when a user edits a heavy log down to a lighter one,
-- or deletes a log entirely — `total_volume_lbs` would monotonically grow
-- and never decrease, giving users persistent leaderboard credit for
-- workouts they've removed.
--
-- The function continues to no-op for NULL or zero deltas. Both positive
-- and negative deltas are now applied. GREATEST(0, ...) clamps the final
-- value so a faulty caller can't push the user's balance into the
-- negative.

CREATE OR REPLACE FUNCTION public.increment_user_volume(p_delta NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    RETURN;
  END IF;
  UPDATE public.user_profiles
     SET total_volume_lbs = GREATEST(0, COALESCE(total_volume_lbs, 0) + p_delta)
   WHERE id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_user_distance(p_delta NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    RETURN;
  END IF;
  UPDATE public.user_profiles
     SET total_distance_meters = GREATEST(0, COALESCE(total_distance_meters, 0) + p_delta)
   WHERE id = auth.uid();
END;
$$;

NOTIFY pgrst, 'reload schema';
