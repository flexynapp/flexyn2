-- 367_public_crew_badges.sql
--
-- Show a lifter's crew under their username on the Gym Rival screens
-- (kegan, 2026-08-16).
--
-- WHY A SERVER FUNCTION AT ALL
--
-- `crew_members` has exactly one SELECT policy — `USING (is_crew_member(crew_id))`
-- — so a client can only read membership rows for a crew it already belongs
-- to. A straight client read of "which crew is @rival in?" therefore returns
-- an empty set for every rival you do not already train with, and the badge
-- would silently render blank for almost everyone.
--
-- That is the same shape as the Gym Rival stats defect fixed in 363: a
-- cross-user read the browser is not allowed to make, which fails as an empty
-- result rather than an error, so it looks like "no crew" instead of "not
-- permitted". Check the policy before building a UI on a cross-user read.
--
-- EVERY CREW IS VISIBLE — kegan's call, 2026-08-16
--
-- Asked whether private crews should be excluded; the answer was that private
-- crews stay VISIBLE and privacy is enforced at the JOIN instead — you apply,
-- and a moderator or leader accepts. So a badge names the crew whether or not
-- it is public.
--
-- Measuring first would have reached the same place: **all 4 crews in
-- production are private.** A public-only gate would have rendered the badge
-- for precisely nobody, which is the failure this codebase keeps producing —
-- a feature that looks shipped and is structurally empty. Check what the data
-- actually contains before choosing a predicate to filter on.
--
-- What a badge still does NOT carry: rank, roster, war record, or anything
-- about the crew's activity. It is the crew's public identity — name, tag,
-- avatar — which `get_public_crews` and every crew page already show.
--
-- ONE CREW PER USER IS AN INVARIANT, NOT AN ASSUMPTION
--
-- The `crew_members_one_crew()` trigger raises 23505 `already_in_crew` on any
-- insert that would put someone in a second crew, so "which crew" has exactly
-- one answer. The `ORDER BY joined_at DESC LIMIT 1` below is belt and braces
-- against historical rows rather than a tie-break rule, and it matches
-- `getMyCrews` so both agree if the invariant is ever relaxed.
--
-- Batched because the Gym Rival menu needs two lifters at once and a
-- per-avatar round trip is how a list becomes N+1.

CREATE OR REPLACE FUNCTION public.public_crew_badges(p_user_ids UUID[])
-- The OUT params are deliberately NOT named user_id / crew_id: those are
-- columns of crew_members, and inside plpgsql an OUT param of the same name
-- shadows the column, so `WHERE user_id = v_uid` raises 42702 "column
-- reference is ambiguous". Renaming is clearer than #variable_conflict here.
RETURNS TABLE (
  member_id       UUID,
  badge_crew_id   UUID,
  crew_name       TEXT,
  crew_tag        TEXT,
  crew_avatar_url TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    UUID;
  v_crew   UUID;
  v_name   TEXT;
  v_tag    TEXT;
  v_avatar TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_uid IN ARRAY p_user_ids LOOP
    -- Most recently joined, matching getMyCrews' joined_at DESC.
    SELECT crew_id INTO v_crew
      FROM public.crew_members
     WHERE user_id = v_uid
     ORDER BY joined_at DESC
     LIMIT 1;

    IF v_crew IS NOT NULL THEN
      SELECT name, tag, avatar_url
        INTO v_name, v_tag, v_avatar
        FROM public.crews
       WHERE id = v_crew;

      member_id       := v_uid;
      badge_crew_id   := v_crew;
      crew_name       := v_name;
      crew_tag        := v_tag;
      crew_avatar_url := v_avatar;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.public_crew_badges(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_crew_badges(UUID[]) TO authenticated;
