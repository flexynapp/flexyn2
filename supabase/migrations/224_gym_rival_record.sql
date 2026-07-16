-- 224_gym_rival_record.sql
--
-- Win / loss record for a user across all their settled Gym Rival matches.
-- SECURITY DEFINER so the pending-match view can show BOTH players' records
-- (RLS only lets a user read matches they're a participant in, so the
-- rival's other matches are otherwise invisible). Paste-safe.

CREATE OR REPLACE FUNCTION public.gym_rival_record(p_uid UUID)
RETURNS TABLE(wins INT, losses INT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $gym_rival_record$
  SELECT
    COALESCE(COUNT(*) FILTER (WHERE winner_id = p_uid), 0)::int AS wins,
    COALESCE(COUNT(*) FILTER (
      WHERE status = 'completed' AND winner_id IS NOT NULL AND winner_id <> p_uid
    ), 0)::int AS losses
  FROM public.gym_rival_assignments
  WHERE user_id = p_uid OR rival_id = p_uid;
$gym_rival_record$;

REVOKE ALL    ON FUNCTION public.gym_rival_record(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_rival_record(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
