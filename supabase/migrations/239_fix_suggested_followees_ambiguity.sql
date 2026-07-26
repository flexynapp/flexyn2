-- 239_fix_suggested_followees_ambiguity.sql
--
-- Fixes a LIVE 400 on every Hub load:
--
--   POST /rest/v1/rpc/get_suggested_followees
--   42702: column reference "email" is ambiguous
--          It could refer to either a PL/pgSQL variable or a table column.
--
-- The function is declared `RETURNS TABLE (... email TEXT ...)`. In
-- PL/pgSQL every RETURNS TABLE column is also an OUT *variable* in the
-- function's scope, so the bare `email` in
--
--   SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
--
-- matches both the OUT param `email` and `public.user_profiles.email`,
-- and Postgres refuses to guess. The follow-suggestions rail
-- (src/components/hub/FollowSuggestionRail.jsx) has therefore been
-- returning an error instead of suggestions ever since migration 091
-- introduced the function; migration 101 rewrote the ORDER BY but kept
-- the same ambiguous line.
--
-- Fix is the one CLAUDE.md prescribes for RETURNS TABLE OUT-param
-- shadowing: `#variable_conflict use_column`, which tells PL/pgSQL that
-- a name matching both a variable and a column resolves to the COLUMN.
-- Nothing else in this body is affected — every other identifier is
-- either alias-qualified (p./hf.) or `v_`/`p_`-prefixed, and no column
-- on user_profiles or hub_follows is named v_uid / v_email / v_limit /
-- v_since / p_limit.
--
-- The body below is otherwise byte-identical to the deployed definition
-- (verified against pg_get_functiondef), so this is a behaviour-neutral
-- change apart from the bug it removes.

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
    SELECT
      p.id              AS user_id,
      p.username,
      p.email,
      p.avatar_url,
      p.current_level,
      (SELECT COUNT(*)::INT FROM public.hub_follows hf
        WHERE hf.followee_email = p.email)         AS follower_count,
      p.active_until
    FROM public.user_profiles p
    WHERE p.id <> v_uid
      AND p.email IS NOT NULL
      AND p.username IS NOT NULL
      AND p.username NOT LIKE 'deleted_%'
      AND p.last_login_date >= v_since
      AND NOT EXISTS (
        SELECT 1 FROM public.hub_follows hf
         WHERE hf.follower_email = v_email
           AND hf.followee_email = p.email
      )
    ORDER BY
      (SELECT COUNT(*) FROM public.hub_follows hf WHERE hf.followee_email = p.email) DESC,
      p.created_at ASC
    LIMIT v_limit;
END;
$get_suggested_followees$;

REVOKE ALL ON FUNCTION public.get_suggested_followees(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_suggested_followees(INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
