-- 370_crew_discovery_lists_every_crew.sql
--
-- Crew discovery renders empty for every user, and has since crews shipped.
--
-- MEASURED 2026-08-16: `get_public_crews` filters `WHERE is_public = TRUE`,
-- **all 4 crews in production are private**, `crews.is_public` defaults to
-- false, and NOTHING in the product can set it — `create_crew_atomic` inserts
-- only (name, created_by), and the single client UPDATE path
-- (`updateCrewProfile`, called once from `CrewChat`) passes `avatar_url`.
-- So the directory returned 0 rows for all 56 users, `get_suggested_crews`
-- likewise, and the only way into a crew was a DM invite link.
--
-- The fix is not a visibility toggle. kegan, 2026-08-16: "private crews should
-- still be visible, but users have to apply in order to join, mods and leaders
-- can accept." Privacy lives at the JOIN, not at the listing — which is
-- already how the rest of the stack behaves:
--
--   * `join_crew_atomic` refuses a private crew outright and files a
--     `crew_join_requests` row instead, returning status = 'requested'.
--   * `crew_members` is readable only to members (`is_crew_member`), so a
--     listed private crew still exposes no roster.
--   * `crew_messages`, the war board and the treasury are all member-gated
--     independently.
--
-- So dropping the `is_public` filter reveals a crew's public IDENTITY — name,
-- tag, avatar, member count, level, trophies, war record — and nothing about
-- who is in it or what they do. That is the same surface `public_crew_badges`
-- already exposes under a username (migration 367).
--
-- WHAT THE ROW GAINS
--
--   `is_public`      — so the client can render Join vs Apply rather than
--                      guessing from a failed call. A private crew's button
--                      must not say "Join" when the RPC will file a request.
--   `request_status` — the CALLER's own pending/rejected request on that crew,
--                      or null. Without it, "Awaiting review" survives only as
--                      React state and vanishes on reload, so the row invites
--                      you to apply to something you already applied to.
--
-- `is_public` is deliberately NOT exposed as a filter or a sort. A directory
-- that lets you list only the private crews is a different feature and a
-- worse one.
--
-- Paste-safe by construction, like the function it replaces: every CTE renames
-- its columns (k_crew, c_name, r_status) and joins USING those names, so there
-- is no short `alias.column` token for the clipboard pipeline to mangle.

CREATE OR REPLACE FUNCTION public.get_public_crews(
  p_query  TEXT    DEFAULT NULL,
  p_sort   TEXT    DEFAULT 'volume',
  p_limit  INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_q      text;
  v_sort   text := lower(COALESCE(p_sort, 'volume'));
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_offset int  := GREATEST(COALESCE(p_offset, 0), 0);
  v_out    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_sort IN ('volume', 'members', 'level', 'new')) THEN
    v_sort := 'volume';
  END IF;

  v_q := btrim(regexp_replace(lower(COALESCE(p_query, '')), '[,()%*]', '', 'g'));
  v_q := NULLIF(left(v_q, 60), '');
  IF v_q IS NOT NULL THEN
    v_q := '%' || v_q || '%';
  END IF;

  WITH memberships AS (
    SELECT crew_id AS k_crew, user_id AS k_user
      FROM public.crew_members
  ),
  volumes AS (
    SELECT id AS k_user,
           COALESCE(total_volume_lbs, 0)::numeric AS v_member
      FROM public.user_profiles
  ),
  rollup AS (
    SELECT k_crew,
           COUNT(*)::int AS n_members,
           COALESCE(SUM(v_member), 0)::numeric AS n_volume
      FROM memberships
      LEFT JOIN volumes USING (k_user)
     GROUP BY k_crew
  ),
  mine AS (
    SELECT crew_id AS k_crew
      FROM public.crew_members
     WHERE user_id = v_uid
  ),
  -- The caller's OWN request on each crew. Scoped to v_uid, so this exposes
  -- nothing about anybody else's applications.
  requests AS (
    SELECT crew_id AS k_crew, status AS r_status
      FROM public.crew_join_requests
     WHERE user_id = v_uid
  ),
  listed AS (
    SELECT id                          AS k_crew,
           name                        AS c_name,
           tag                         AS c_tag,
           description                 AS c_desc,
           avatar_url                  AS c_avatar,
           COALESCE(max_capacity, 16)  AS c_cap,
           COALESCE(crew_level, 1)     AS c_level,
           COALESCE(trophies, 0)       AS c_trophies,
           COALESCE(wars_won, 0)       AS c_won,
           COALESCE(wars_lost, 0)      AS c_lost,
           COALESCE(is_public, FALSE)  AS c_public,
           created_at                  AS c_created
      FROM public.crews
    -- No is_public filter. A private crew is visible and application-gated;
    -- see the header.
  ),
  merged AS (
    SELECT k_crew, c_name, c_tag, c_desc, c_avatar, c_cap,
           c_level, c_trophies, c_won, c_lost, c_created, c_public,
           COALESCE(n_members, 0)                AS c_members,
           COALESCE(n_volume, 0)::numeric        AS c_volume,
           (k_crew IN (SELECT k_crew FROM mine)) AS c_mine,
           r_status                              AS c_request
      FROM listed
      LEFT JOIN rollup   USING (k_crew)
      LEFT JOIN requests USING (k_crew)
  ),
  filtered AS (
    SELECT * FROM merged
     WHERE v_q IS NULL
        OR c_name ILIKE v_q
        OR COALESCE(c_tag, '')  ILIKE v_q
        OR COALESCE(c_desc, '') ILIKE v_q
  ),
  ordered AS (
    SELECT * FROM filtered
     ORDER BY
       CASE WHEN v_sort = 'volume'  THEN c_volume  END DESC NULLS LAST,
       CASE WHEN v_sort = 'members' THEN c_members END DESC NULLS LAST,
       CASE WHEN v_sort = 'level'   THEN c_level   END DESC NULLS LAST,
       CASE WHEN v_sort = 'new'     THEN c_created END DESC NULLS LAST,
       c_members DESC,
       k_crew
     LIMIT v_limit OFFSET v_offset
  ),
  numbered AS (
    SELECT *, ROW_NUMBER() OVER () AS c_seq FROM ordered
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',               k_crew,
           'name',             c_name,
           'tag',              c_tag,
           'description',      c_desc,
           'avatar_url',       c_avatar,
           'member_count',     c_members,
           'max_capacity',     c_cap,
           'total_volume_lbs', c_volume,
           'crew_level',       c_level,
           'trophies',         c_trophies,
           'wars_won',         c_won,
           'wars_lost',        c_lost,
           'is_member',        c_mine,
           'is_public',        c_public,
           'request_status',   c_request
         ) ORDER BY c_seq), '[]'::jsonb)
    INTO v_out
    FROM numbered;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_crews(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_crews(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
