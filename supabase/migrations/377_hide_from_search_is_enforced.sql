-- Migration 377: "Hide from search" did nothing, on either surface that names it
--
-- Settings → Privacy → "Hide from search" writes `user_profiles.hide_from_search`
-- and has since migration 117. Its own comment says the flag "removes the
-- account from user-search + PYMK". Nothing read it.
--
-- `filterSearchable()` in src/lib/privacy.js exists precisely for this, is
-- documented as "Used by: User search / PYMK", and has ZERO call sites — it is
-- referenced only from comments. The two server functions that build the
-- discovery surfaces never mentioned the column either. So a user who turned
-- the toggle on stayed in search results, in People You May Know, and in the
-- follow-suggestion rail, with no indication that the setting was inert.
--
-- This is the server half. The client half lands in the same commit: search
-- filters the list it already holds, and the recommendation reads exclude the
-- flag in the query.
--
-- ── Semantics ─────────────────────────────────────────────────────────────
--
-- Hiding affects DISCOVERY, not existence. A hidden profile is still reachable
-- by anyone who has its link, still appears to its own followers, and still
-- owns its posts. That matches what the toggle says — "hide from search" — and
-- it is why this is a filter on two discovery functions rather than an RLS
-- change. Making the row unreadable would break the feed for people already
-- following them, which the setting does not claim to do.
--
-- `IS NOT TRUE` rather than `= FALSE`: the column is NOT NULL DEFAULT FALSE
-- today, so the two agree, but a future ALTER dropping NOT NULL would silently
-- turn `= FALSE` into "exclude everyone whose flag is unset".
--
-- ── Why both functions are rewritten rather than patched ──────────────────
--
-- Both bodies are restated CTE-first with no `alias.column` tokens anywhere, so
-- this bundle survives the paste pipeline (CLAUDE.md rule 7). The previous
-- get_suggested_followees was written with a `p.` alias throughout; adding one
-- WHERE line to it would have produced a bundle that mangles on paste. Every
-- CTE renames its join key and the joins match on the renamed name, the same
-- construction migration 370 used for get_public_crews.
--
-- Behaviour is otherwise unchanged: same signatures, same column order, same
-- ordering rules, same limits and clamps, same auth guard. The only difference
-- is that hidden profiles are gone.

-- ── get_suggested_followees ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_suggested_followees(p_limit INT DEFAULT 8)
RETURNS TABLE (
  user_id          UUID,
  username         TEXT,
  email            TEXT,
  avatar_url       TEXT,
  current_level    INT,
  follower_count   INT,
  active_until     TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $get_suggested_followees$
#variable_conflict use_column
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT;
  v_limit  INT  := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);
  v_since  DATE := (now() AT TIME ZONE 'UTC')::date - INTERVAL '30 days';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  RETURN QUERY
  WITH
    already_followed AS (
      SELECT followee_email AS followed_email
        FROM public.hub_follows
       WHERE follower_email = v_email
    ),
    follower_counts AS (
      SELECT followee_email AS counted_email,
             COUNT(*)::INT  AS followers
        FROM public.hub_follows
       GROUP BY followee_email
    ),
    eligible AS (
      SELECT id            AS cand_id,
             username      AS cand_username,
             email         AS cand_email,
             avatar_url    AS cand_avatar,
             current_level AS cand_level,
             active_until  AS cand_active_until,
             created_at    AS cand_created_at
        FROM public.user_profiles
       WHERE id <> v_uid
         AND email IS NOT NULL
         AND username IS NOT NULL
         AND username NOT LIKE 'deleted_%'
         AND last_login_date >= v_since
         -- The point of this migration.
         AND hide_from_search IS NOT TRUE
         AND email NOT IN (SELECT followed_email FROM already_followed)
    )
  SELECT cand_id,
         cand_username,
         cand_email,
         cand_avatar,
         cand_level,
         COALESCE(followers, 0),
         cand_active_until
    FROM eligible
    LEFT JOIN follower_counts ON counted_email = cand_email
   ORDER BY COALESCE(followers, 0) DESC, cand_created_at ASC
   LIMIT v_limit;
END;
$get_suggested_followees$;

REVOKE ALL    ON FUNCTION public.get_suggested_followees(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_suggested_followees(INT) TO authenticated;

-- ── get_people_you_may_know ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_people_you_may_know(
  p_email  TEXT DEFAULT NULL,   -- ignored; kept for call-site compatibility
  p_limit  INT  DEFAULT 8
)
RETURNS TABLE (
  user_id      UUID,
  mutual_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $pymk$
DECLARE
  v_uid   UUID := auth.uid();
  v_limit INT  := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 50);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH
    i_follow AS (
      SELECT followee_id AS fid
        FROM public.hub_follows
       WHERE follower_id = v_uid
    ),
    follow_me AS (
      SELECT follower_id AS fid
        FROM public.hub_follows
       WHERE followee_id = v_uid
    ),
    hidden AS (
      SELECT id AS hidden_id
        FROM public.user_profiles
       WHERE hide_from_search IS TRUE
    ),
    candidates AS (
      SELECT followee_id AS candidate_id,
             COUNT(*)    AS mutuals
        FROM public.hub_follows
       WHERE follower_id IN (SELECT fid FROM follow_me)
         AND followee_id IS NOT NULL
         AND followee_id <> v_uid
         AND followee_id NOT IN (SELECT fid FROM i_follow)
         -- The point of this migration.
         AND followee_id NOT IN (SELECT hidden_id FROM hidden)
       GROUP BY followee_id
    )
  SELECT candidate_id, mutuals
    FROM candidates
   ORDER BY mutuals DESC
   LIMIT v_limit;
END;
$pymk$;

REVOKE ALL    ON FUNCTION public.get_people_you_may_know(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_people_you_may_know(TEXT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Self-verification ─────────────────────────────────────────────────────
-- The Supabase editor hides RAISE NOTICE, so this ends in a SELECT that proves
-- the behaviour rather than merely proving the functions compile — a rewritten
-- body that raises 42702 "ambiguous column" only fails when it is CALLED, and
-- migration 239 exists because that has already happened to this very function.
--
-- Every boolean must be TRUE. Both directions are checked: hidden users are
-- gone AND ordinary users still come back, because a function that returned
-- nothing at all would satisfy the exclusion check on its own.
DO $$
DECLARE
  v_uid     UUID;
  v_victim  UUID;
  v_before  INT;
  v_after   INT;
  v_ok_call BOOLEAN := FALSE;
  v_err     TEXT := 'none';
BEGIN
  SELECT id INTO v_uid FROM public.user_profiles
   WHERE username IS NOT NULL AND username NOT LIKE 'deleted_%' LIMIT 1;

  IF v_uid IS NULL THEN
    CREATE TEMP TABLE hide_from_search_check ON COMMIT DROP AS
      SELECT NULL::boolean AS callable, NULL::boolean AS hides_the_hidden,
             NULL::boolean AS keeps_the_visible,
             'NO PROFILES EXIST — nothing was verified' AS note;
    RETURN;
  END IF;

  BEGIN
    -- Impersonate a real signed-in user; both functions derive identity from
    -- auth.uid() and raise 42501 without one.
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_uid::text)::text, TRUE);

    SELECT COUNT(*) INTO v_before FROM public.get_suggested_followees(20);
    v_ok_call := TRUE;

    -- Hide whoever the rail would have offered first, then ask again.
    SELECT user_id INTO v_victim FROM public.get_suggested_followees(20) LIMIT 1;
    IF v_victim IS NOT NULL THEN
      UPDATE public.user_profiles SET hide_from_search = TRUE WHERE id = v_victim;
      SELECT COUNT(*) INTO v_after FROM public.get_suggested_followees(20);
    ELSE
      v_after := v_before;
    END IF;

    RAISE EXCEPTION 'rollback_probe';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'rollback_probe' THEN v_err := SQLSTATE || ' ' || SQLERRM; END IF;
  END;

  CREATE TEMP TABLE hide_from_search_check ON COMMIT DROP AS
    SELECT v_ok_call                                   AS callable,
           (v_victim IS NULL OR v_after = v_before - 1) AS hides_the_hidden,
           (v_before > 0)                               AS keeps_the_visible,
           'suggested before=' || COALESCE(v_before, -1)
             || ' after hiding one=' || COALESCE(v_after, -1)
             || ', error: ' || v_err                    AS note;
END;
$$;

SELECT * FROM hide_from_search_check;
