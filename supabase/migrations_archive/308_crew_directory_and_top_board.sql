-- 308_crew_directory_and_top_board.sql
--
-- The Crews Hub: a browsable directory of public crews, and a global board
-- that ranks crews against each other.
--
-- WHY THIS NEEDS THE SERVER AT ALL
--
-- Two of the five numbers a directory row wants are unreachable from the
-- browser:
--
--   member_count -- crew_members SELECT is is_crew_member(crew_id) (mig 048),
--     so a client can read the roster of a crew it belongs to and no other.
--     CrewDiscovery has been branching on a `_memberCount` that nothing ever
--     set, so every row in production reads "up to 16" and the "Full" state
--     is unreachable.
--
--   total_volume_lbs -- the sum of every member's lifetime volume. Nothing
--     aggregates this anywhere today. The ingredient is
--     user_profiles.total_volume_lbs, which is safe to rank on precisely
--     because migration 173 made it RPC-only: a direct client UPDATE raises
--     42501. A board ranked on a forgeable column is not a board.
--
-- COUNT, DON'T INCREMENT
--
-- Nakama keeps a denormalised edge_count on the group row and bumps it on
-- join/leave. Habitica does the same and has issue #12286 open since 2020
-- because it drifts -- guild members have to ask a human to repair the
-- number. Their accepted fix is to recount. At Flexyn's scale (6 memberships
-- across 4 crews at time of writing) a counter buys nothing and inherits the
-- bug, so both functions below recount from crew_members. Revisit if public
-- crews ever pass ~1,000.
--
-- THE BUG THIS FILE ALSO FIXES
--
-- get_suggested_crews has returned zero rows for every caller since migration
-- 159. 090 built it correctly over a COUNT; 159 redefined it against a
-- `crews.member_count` COLUMN THAT HAS NEVER EXISTED:
--
--     SELECT id, name, description, member_count, max_capacity, is_public
--       FROM public.crews
--      WHERE ... AND member_count < max_capacity
--
-- It compiles because member_count is also a RETURNS TABLE OUT parameter, and
-- #variable_conflict use_column only redirects names that are AMBIGUOUS. With
-- no column of that name there is no ambiguity, so it binds to the variable,
-- which is NULL -- and `NULL < max_capacity` filters every row. Its only
-- consumer, CrewSuggestionRail, has therefore never rendered. Restored below
-- over a real COUNT, keeping the is_public filter 159 correctly added and 090
-- lacked.
--
-- Which is why NOTHING here uses RETURNS TABLE. get_crew_division_standings,
-- get_crew_treasury and get_crew_weekly_stats all return jsonb; matching them
-- removes the OUT-parameter shadowing class of bug from the two new functions
-- entirely rather than relying on a directive to dodge it.
--
-- ORDERING
--
-- Every sort terminates in member count then id, so two crews on equal volume
-- cannot swap places between refetches. Same rule migration 257 applied to the
-- player boards, and the same one Nakama's group listing uses (it terminates
-- every ORDER BY in the id).
--
-- PASTE-SAFE per CLAUDE.md: schema-qualified table names, no alias.column
-- tokens, no record-field access. Joins go through CTEs whose keys are renamed
-- so every reference is a bare column name and every join is USING().

-- ── 1. The directory ─────────────────────────────────────────────────────────
-- One page of public crews, with everything a row needs to be chosen from.
-- Does NOT exclude the caller's own crew: seeing your crew listed among the
-- others is the point. It comes back flagged with is_member so the client can
-- style it and swap the action.
CREATE OR REPLACE FUNCTION public.get_public_crews(
  p_query  text DEFAULT NULL,
  p_sort   text DEFAULT 'volume',
  p_limit  int  DEFAULT 20,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $get_public_crews$
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

  -- Whitelist, never interpolation. p_sort reaches the query only as an
  -- equality test inside a CASE.
  IF NOT (v_sort IN ('volume', 'members', 'level', 'new')) THEN
    v_sort := 'volume';
  END IF;

  -- Same sanitising as searchPublicCrews: PostgREST parses commas as filter
  -- separators and parens as grouping, and a literal % would turn our own
  -- wildcards into a match-everything. One rule for both paths.
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
           created_at                  AS c_created
      FROM public.crews
     WHERE is_public = TRUE
  ),
  merged AS (
    SELECT k_crew, c_name, c_tag, c_desc, c_avatar, c_cap,
           c_level, c_trophies, c_won, c_lost, c_created,
           COALESCE(n_members, 0)                AS c_members,
           COALESCE(n_volume, 0)::numeric        AS c_volume,
           (k_crew IN (SELECT k_crew FROM mine)) AS c_mine
      FROM listed
      LEFT JOIN rollup USING (k_crew)
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
  -- ROW_NUMBER() OVER () takes the input order of a subquery that has already
  -- been ORDER BY + LIMIT'd, which is what lets jsonb_agg below be ordered.
  -- Aggregating straight off `ordered` would not guarantee the sort survives.
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
           'is_member',        c_mine
         ) ORDER BY c_seq), '[]'::jsonb)
    INTO v_out
    FROM numbered;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$get_public_crews$;

REVOKE ALL ON FUNCTION public.get_public_crews(text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_crews(text, text, int, int) TO authenticated;

-- ── 2. The Top board ─────────────────────────────────────────────────────────
-- Global crew ranking. Returns the top N PLUS a window around the caller's own
-- crew when it ranks below N, each row carrying its true rank. A top-N-only
-- board can only ever tell a crew in 40th place "not ranked", which is the one
-- message that stops people opening a leaderboard.
--
-- Ranks are computed here and returned. The client must never derive rank from
-- array index -- a filtered list would renumber itself.
--
-- Crews on a zero metric are NOT filtered out. At time of writing every metric
-- is zero for every crew (one user in the whole app has logged any volume), so
-- filtering would render an empty board rather than an honest one. The
-- deterministic tiebreak means a table of zeros is still stably ordered by
-- member count, and the client says plainly that nothing has been logged yet.
CREATE OR REPLACE FUNCTION public.get_top_crews(
  p_metric text DEFAULT 'volume',
  p_limit  int  DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $get_top_crews$
DECLARE
  v_uid    uuid := auth.uid();
  v_metric text := lower(COALESCE(p_metric, 'volume'));
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 25), 3), 100);
  v_season uuid;
  v_out    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_metric IN ('volume', 'trophies', 'points')) THEN
    v_metric := 'volume';
  END IF;

  -- Read the open season directly rather than calling current_crew_season(),
  -- which opens one if none exists and is therefore VOLATILE. This function
  -- is STABLE and a board should never have the side effect of starting a
  -- season. NULL here just means every crew scores 0 points, which is true.
  SELECT id INTO v_season
    FROM public.crew_seasons
   WHERE status = 'active'
   ORDER BY season_number DESC
   LIMIT 1;

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
  season_points AS (
    SELECT crew_id AS k_crew,
           COALESCE(points, 0)::numeric AS n_points
      FROM public.crew_season_stats
     WHERE season_id = v_season
  ),
  mine AS (
    SELECT crew_id AS k_crew
      FROM public.crew_members
     WHERE user_id = v_uid
  ),
  listed AS (
    SELECT id                         AS k_crew,
           name                       AS c_name,
           tag                        AS c_tag,
           avatar_url                 AS c_avatar,
           COALESCE(max_capacity, 16) AS c_cap,
           COALESCE(crew_level, 1)    AS c_level,
           COALESCE(trophies, 0)      AS c_trophies
      FROM public.crews
     WHERE is_public = TRUE
  ),
  base AS (
    SELECT k_crew, c_name, c_tag, c_avatar, c_cap, c_level, c_trophies,
           COALESCE(n_members, 0) AS c_members,
           CASE
             WHEN v_metric = 'trophies' THEN c_trophies::numeric
             WHEN v_metric = 'points'   THEN COALESCE(n_points, 0)
             ELSE COALESCE(n_volume, 0)
           END                    AS c_value,
           (k_crew IN (SELECT k_crew FROM mine)) AS c_mine
      FROM listed
      LEFT JOIN rollup        USING (k_crew)
      LEFT JOIN season_points USING (k_crew)
  ),
  ranked AS (
    SELECT *,
           CAST(ROW_NUMBER() OVER (ORDER BY c_value DESC, c_members DESC, k_crew) AS int) AS c_rank
      FROM base
  ),
  me AS (
    SELECT c_rank AS my_rank FROM ranked WHERE c_mine LIMIT 1
  ),
  picked AS (
    SELECT * FROM ranked
     WHERE c_rank = LEAST(c_rank, v_limit)
        OR c_rank BETWEEN (SELECT GREATEST(my_rank - 2, 1) FROM me)
                      AND (SELECT my_rank + 2 FROM me)
  )
  SELECT jsonb_build_object(
           'metric',  v_metric,
           'my_rank', (SELECT my_rank FROM me),
           'total',   (SELECT COUNT(*)::int FROM ranked),
           'rows',    COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'rank',         c_rank,
                      'id',           k_crew,
                      'name',         c_name,
                      'tag',          c_tag,
                      'avatar_url',   c_avatar,
                      'member_count', c_members,
                      'max_capacity', c_cap,
                      'crew_level',   c_level,
                      'trophies',     c_trophies,
                      'value',        c_value,
                      'is_member',    c_mine
                    ) ORDER BY c_rank)
               FROM picked
           ), '[]'::jsonb)
         )
    INTO v_out;

  RETURN v_out;
END;
$get_top_crews$;

REVOKE ALL ON FUNCTION public.get_top_crews(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top_crews(text, int) TO authenticated;

-- ── 3. Repair get_suggested_crews ────────────────────────────────────────────
-- Signature is unchanged so CrewSuggestionRail keeps working untouched; only
-- the body is replaced, over a real COUNT this time. See the file head for why
-- the 159 version could never return a row.
--
-- The membership JOIN (not LEFT JOIN) drops zero-member crews, matching 090's
-- HAVING COUNT(*) > 0 -- those are orphan or mid-creation rows, not something
-- to suggest. `n_members = LEAST(n_members, c_cap - 1)` is `n_members < c_cap`
-- written without a bare comparison operator, per the convention migration 248
-- established for paste safety.
CREATE OR REPLACE FUNCTION public.get_suggested_crews(p_limit integer DEFAULT 12)
RETURNS TABLE (
  id           uuid,
  name         text,
  description  text,
  member_count integer,
  max_capacity integer,
  is_public    boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $get_suggested_crews$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int  := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH counts AS (
      SELECT crew_id AS k_crew, COUNT(*)::int AS n_members
        FROM public.crew_members
       GROUP BY crew_id
    ),
    mine AS (
      SELECT crew_id AS k_crew
        FROM public.crew_members
       WHERE user_id = v_uid
    ),
    listed AS (
      SELECT id                         AS k_crew,
             name                       AS c_name,
             description                AS c_desc,
             COALESCE(max_capacity, 16) AS c_cap,
             is_public                  AS c_public
        FROM public.crews
       WHERE is_public = TRUE
    )
    SELECT k_crew, c_name, c_desc, n_members, c_cap, c_public
      FROM listed
      JOIN counts USING (k_crew)
     WHERE NOT (k_crew IN (SELECT k_crew FROM mine))
       AND n_members = LEAST(n_members, c_cap - 1)
     ORDER BY n_members DESC, k_crew
     LIMIT v_limit;
END;
$get_suggested_crews$;

REVOKE ALL ON FUNCTION public.get_suggested_crews(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_suggested_crews(integer) TO authenticated;

-- ── 4. Indexes ───────────────────────────────────────────────────────────────
-- crew_members already has UNIQUE (crew_id, user_id), whose leading column
-- serves the GROUP BY crew_id rollup, and crews already has the partial
-- crews_is_public_idx. user_profiles (total_volume_lbs DESC) came with
-- migration 257. Nothing new is needed -- recorded here so the next person
-- doesn't add a redundant one.
