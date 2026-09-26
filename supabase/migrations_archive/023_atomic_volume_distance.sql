-- 023_atomic_volume_distance.sql
--
-- Atomic counter accumulation RPCs. The client-side read-modify-write
-- pattern in pages/Workout.jsx and cardio code paths raced against itself
-- when a workout and cardio session finished within ~200ms — both reads
-- saw the same `prev`, and the second write overwrote the first, silently
-- losing one session's volume / distance from leaderboards.
--
-- The functions add the delta in a single SQL statement so concurrent
-- calls compose instead of overwriting. SECURITY DEFINER + an explicit
-- auth.uid() lookup means callers can only mutate their own row.
--
-- Functions are idempotent on creation (`OR REPLACE`) so this migration
-- can be re-run safely.

CREATE OR REPLACE FUNCTION public.increment_user_volume(p_delta NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_delta IS NULL OR p_delta <= 0 THEN
    RETURN;
  END IF;
  UPDATE public.user_profiles
     SET total_volume_lbs = COALESCE(total_volume_lbs, 0) + p_delta
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
  IF p_delta IS NULL OR p_delta <= 0 THEN
    RETURN;
  END IF;
  UPDATE public.user_profiles
     SET total_distance_meters = COALESCE(total_distance_meters, 0) + p_delta
   WHERE id = auth.uid();
END;
$$;

-- Allow authenticated users to call. SECURITY DEFINER means the function
-- runs as the function owner, so RLS on user_profiles doesn't apply —
-- but the WHERE id = auth.uid() restricts scope to the caller's own row.
GRANT EXECUTE ON FUNCTION public.increment_user_volume(NUMERIC)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_user_distance(NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
