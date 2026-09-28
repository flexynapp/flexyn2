-- Duels audit, round three (2026-09-28).
--
-- 1. The opponent picker offered people a Session Duel would refuse.
--    create_session_duel refuses a private profile you do not follow
--    (opponent_unavailable) and anyone with no plausible workout to copy
--    (opponent_no_session). duel_opponent_candidates listed both without a
--    hint, and Session is the picker's default type, so the first thing
--    a person saw after choosing someone could be "You cannot challenge
--    this person". Each candidate now carries session_ok, computed with the
--    same two checks, and the picker disables Session where it is FALSE.
--    The return type changes, so the function is dropped and recreated with
--    the same grants (authenticated only).
--
-- 2. create_pending_duel_invite had no limit. Every other way to start a
--    duel stops at 10 a day (too_many_duels); an invite link row now counts
--    against the same 10, per challenger per 24 hours.
--
-- Nothing here changes or deletes rows.

DROP FUNCTION IF EXISTS public.duel_opponent_candidates(text);

CREATE FUNCTION public.duel_opponent_candidates(p_query text DEFAULT NULL::text)
RETURNS TABLE(id uuid, username text, display_name text, avatar_url text,
              current_level integer, session_ok boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_q     TEXT := lower(btrim(COALESCE(p_query, '')));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT p.email INTO v_email FROM public.user_profiles p WHERE p.id = v_uid;
  v_q := ltrim(v_q, '@');
  -- LIKE wildcards in the query are literal characters.
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  RETURN QUERY
  SELECT c.id, c.username, c.display_name, c.avatar_url,
         CASE WHEN c.visible THEN c.current_level END,
         -- The same two checks create_session_duel makes.
         c.visible AND public._duel_mirror_template(c.id) IS NOT NULL
    FROM (
      SELECT p.id, p.username, p.display_name, p.avatar_url, p.current_level,
             p.last_active_at,
             (NOT COALESCE(p.is_private, FALSE) OR public.viewer_follows(p.email)) AS visible
        FROM public.user_profiles p
        JOIN auth.users u ON u.id = p.id
       WHERE p.id <> v_uid
         AND p.username IS NOT NULL
         AND NOT COALESCE(u.is_anonymous, FALSE) AND u.email IS NOT NULL
         AND NOT COALESCE(p.hide_from_search, FALSE)
         AND NOT public.is_blocked(v_uid, p.email)
         AND CASE
               WHEN length(v_q) >= 2 THEN
                 lower(p.username) LIKE '%' || v_q || '%'
                 OR lower(COALESCE(p.display_name, '')) LIKE '%' || v_q || '%'
               ELSE EXISTS (SELECT 1 FROM public.hub_follows f
                             WHERE f.followee_id = p.id AND lower(f.follower_email) = lower(v_email))
             END
       ORDER BY (lower(p.username) LIKE v_q || '%') DESC,
                p.last_active_at DESC NULLS LAST,
                p.username
       LIMIT 20
    ) c
   ORDER BY (lower(c.username) LIKE v_q || '%') DESC,
            c.last_active_at DESC NULLS LAST,
            c.username;
END;
$function$;

REVOKE ALL ON FUNCTION public.duel_opponent_candidates(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duel_opponent_candidates(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_pending_duel_invite(p_duel_type text DEFAULT 'open'::text, p_session_template jsonb DEFAULT NULL::jsonb, p_target_exercise_id text DEFAULT NULL::text, p_window_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_username  TEXT;
  v_avatar    TEXT;
  v_token     TEXT;
  v_invite_id UUID;
  v_expires   TIMESTAMPTZ;
  v_template  JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF public._duel_is_guest(v_uid) THEN
    RAISE EXCEPTION 'guest_account' USING ERRCODE = '42501';
  END IF;
  IF p_duel_type NOT IN ('open', 'mirror') THEN
    RAISE EXCEPTION 'invalid duel_type' USING ERRCODE = '22023';
  END IF;
  IF p_window_hours IS NULL OR p_window_hours < 1 OR p_window_hours > 168 THEN
    RAISE EXCEPTION 'window_hours must be between 1 and 168' USING ERRCODE = '22023';
  END IF;
  -- The same daily limit as a direct challenge.
  IF (SELECT count(*) FROM public.pending_duel_invites
       WHERE challenger_id = v_uid AND created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'too_many_duels' USING ERRCODE = '22023';
  END IF;
  IF p_duel_type = 'mirror' THEN
    v_template := public._duel_mirror_template(v_uid);
    IF v_template IS NULL THEN RAISE EXCEPTION 'mirror_needs_workout' USING ERRCODE = '22023'; END IF;
  END IF;

  SELECT username, avatar_url
    INTO v_username, v_avatar
    FROM public.user_profiles
   WHERE id = v_uid;

  v_token   := encode(gen_random_bytes(16), 'hex');
  v_expires := NOW() + (p_window_hours || ' hours')::INTERVAL + INTERVAL '7 days';

  INSERT INTO public.pending_duel_invites
    (claim_token, challenger_id, challenger_username, challenger_avatar_url,
     duel_type, session_template, target_exercise_id, window_hours, expires_at)
  VALUES
    (v_token, v_uid, v_username, v_avatar,
     p_duel_type, v_template, NULL, p_window_hours, v_expires)
  RETURNING id INTO v_invite_id;

  RETURN jsonb_build_object(
    'id',           v_invite_id,
    'token',        v_token,
    'expires_at',   v_expires,
    'duel_type',    p_duel_type,
    'window_hours', p_window_hours
  );
END;
$function$;

-- Probe: the new column exists with the expected type, and the grants held.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.proname = 'duel_opponent_candidates'
       AND 'session_ok' = ANY (p.proargnames)) THEN
    RAISE EXCEPTION 'probe: duel_opponent_candidates has no session_ok column';
  END IF;
  IF has_function_privilege('anon', 'public.duel_opponent_candidates(text)', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.duel_opponent_candidates(text)', 'execute') THEN
    RAISE EXCEPTION 'probe: duel_opponent_candidates grants are wrong';
  END IF;
END;
$$;
