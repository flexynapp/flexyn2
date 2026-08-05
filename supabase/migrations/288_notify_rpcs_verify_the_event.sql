-- Migration 288: notify_*_for — verify the event before notifying
--
-- Found by the interaction audit (Aug 2026), chasing the same
-- "client-trusted value" thread as migration 287.
--
-- Of the 14 notify_X_for RPCs, 11 take only ids and therefore have to read
-- the domain table to build their text — which incidentally proves the
-- event happened. Three take free-text parameters and never verify
-- anything. All three are EXECUTE-able by `authenticated`, and every one
-- of them INSERTs into public.notifications, which the push fan-out
-- trigger turns into a push notification on the recipient's lock screen.
--
-- What each one allowed, precisely:
--
--   notify_friend_follow_for(p_user_id, p_follower_name)
--     No check that a follow row exists. p_follower_name is rendered into
--     the title AND stored in metadata verbatim, so any signed-in user
--     could push "«any name» started following you" to any user id.
--     This is the impersonation case.
--
--   notify_friend_post_for(p_user_id, p_poster_name, p_post_preview)
--     Already ignored p_poster_name and derived the real username server
--     side (that defence was in place and is kept). But p_post_preview
--     went into the notification body unvalidated, and the recipient was
--     never checked to be a follower — so arbitrary 100-char text could be
--     pushed to any user id, correctly attributed to the sender.
--
--   notify_league_resolution_for(p_user_id, p_outcome, tiers, p_coins, ...)
--     Validated only that p_outcome is promote/demote/hold. No check that
--     sender and recipient share a league, or that it resolved — so any
--     user could push a fake "You were promoted — +N coins" to anyone.
--     No coins move; the damage is the false claim.
--
-- THE RULE APPLIED: a cross-user notification must prove the relationship
-- that justifies it, and text the recipient reads is derived server-side,
-- never accepted from the caller.
--
-- Idempotent. The friend_post signature CHANGES (three text params → one
-- post id), so the old overload is dropped explicitly; leaving it in place
-- would leave the hole open behind the new function. Callers that hit the
-- missing old signature get PostgREST's PGRST202, which the client treats
-- as a pre-migration host and handles via its legacy fallback, so the
-- frontend-deploys-first ordering degrades cleanly rather than erroring.

-- ── 1. friend follow — prove the follow exists, derive the name ──────────
CREATE OR REPLACE FUNCTION public.notify_friend_follow_for(p_user_id uuid, p_follower_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sender       UUID := auth.uid();
  v_sender_email TEXT;
  v_email        TEXT;
  v_lang         TEXT;
  v_name         TEXT;
  v_text         JSONB;
  v_id           UUID;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = v_sender THEN
    RETURN NULL;
  END IF;

  SELECT username, email INTO v_name, v_sender_email
    FROM public.user_profiles WHERE id = v_sender;
  IF v_sender_email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  -- The follow must actually exist, in the direction claimed. hub_follows
  -- is keyed on the email pair (that is where the UNIQUE constraint is);
  -- follower_id / followee_id are nullable and only backfilled from mig 208.
  IF NOT EXISTS (
    SELECT 1 FROM public.hub_follows
     WHERE follower_email = v_sender_email
       AND followee_email = v_email
  ) THEN
    RAISE EXCEPTION 'no such follow' USING ERRCODE = '42501';
  END IF;

  -- p_follower_name is ignored. It is kept in the signature so this stays
  -- a drop-in replacement for existing callers.
  IF v_name IS NULL OR v_name = '' THEN
    v_name := COALESCE(SPLIT_PART(v_sender_email, '@', 1), 'Someone');
  ELSE
    v_name := '@' || v_name;
  END IF;

  SELECT preferred_language INTO v_lang
    FROM public.user_profiles WHERE id = p_user_id;

  v_text := public.friend_follow_text(COALESCE(v_lang, 'en'), v_name);

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (p_user_id, v_email, 'friend_follow',
     v_text ->> 'title', v_text ->> 'body', '👋', '/hub',
     jsonb_build_object('followerName', v_name))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ── 2. friend post — take the post id, derive the preview ────────────────
DROP FUNCTION IF EXISTS public.notify_friend_post_for(uuid, text, text);

CREATE OR REPLACE FUNCTION public.notify_friend_post_for(p_user_id uuid, p_post_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sender       UUID := auth.uid();
  v_sender_email TEXT;
  v_name         TEXT;
  v_email        TEXT;
  v_lang         TEXT;
  v_author       TEXT;
  v_body         TEXT;
  v_text         JSONB;
  v_id           UUID;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'user_id and post_id required' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = v_sender THEN
    RETURN NULL;
  END IF;

  SELECT username, email INTO v_name, v_sender_email
    FROM public.user_profiles WHERE id = v_sender;
  IF v_sender_email IS NULL THEN
    RETURN NULL;
  END IF;

  -- The post must exist and belong to the caller. This is what stops the
  -- body being arbitrary caller-supplied text: it is read from the row.
  SELECT author_email, body INTO v_author, v_body
    FROM public.hub_posts WHERE id = p_post_id;
  IF v_author IS NULL THEN
    RAISE EXCEPTION 'post not found' USING ERRCODE = '22023';
  END IF;
  IF v_author <> v_sender_email THEN
    RAISE EXCEPTION 'not your post' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  -- Only followers get told about a post.
  IF NOT EXISTS (
    SELECT 1 FROM public.hub_follows
     WHERE follower_email = v_email
       AND followee_email = v_sender_email
  ) THEN
    RAISE EXCEPTION 'recipient does not follow you' USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR v_name = '' THEN
    v_name := COALESCE(SPLIT_PART(v_sender_email, '@', 1), 'Someone');
  ELSE
    v_name := '@' || v_name;
  END IF;

  SELECT preferred_language INTO v_lang
    FROM public.user_profiles WHERE id = p_user_id;

  v_text := public.friend_post_text(COALESCE(v_lang, 'en'), v_name);

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (p_user_id, v_email, 'friend_post',
     v_text ->> 'title',
     COALESCE(SUBSTRING(COALESCE(v_body, '') FROM 1 FOR 100), ''),
     '✨', '/hub',
     jsonb_build_object('posterName', v_name, 'postId', p_post_id))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ── 3. league resolution — prove a shared, resolved league ───────────────
CREATE OR REPLACE FUNCTION public.notify_league_resolution_for(
  p_user_id uuid, p_outcome text, p_from_tier text, p_to_tier text,
  p_coins integer, p_capsule text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sender UUID := auth.uid();
  v_email  TEXT;
  v_lang   TEXT;
  v_text   JSONB;
  v_id     UUID;
  v_league UUID;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
  END IF;
  IF p_outcome NOT IN ('promote', 'demote', 'hold') THEN
    RAISE EXCEPTION 'outcome must be promote/demote/hold' USING ERRCODE = '22023';
  END IF;

  -- Sender and recipient must share a league, and it must have resolved.
  -- The client dispatches these in a loop right after
  -- distribute_league_rewards, so the caller is always a co-member of a
  -- league that just resolved. Anyone else has nothing to send.
  SELECT league_id INTO v_league
    FROM public.league_members
   WHERE user_id = v_sender
     AND league_id IN (SELECT league_id FROM public.league_members WHERE user_id = p_user_id)
     AND league_id IN (SELECT id FROM public.leagues WHERE is_resolved = TRUE)
   LIMIT 1;

  IF v_league IS NULL THEN
    RAISE EXCEPTION 'no shared resolved league' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT preferred_language INTO v_lang
    FROM public.user_profiles WHERE id = p_user_id;

  v_text := public.league_resolution_text(
    COALESCE(v_lang, 'en'), p_outcome,
    COALESCE(p_from_tier, ''), COALESCE(p_to_tier, ''),
    COALESCE(p_coins, 0), p_capsule);

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (p_user_id, v_email,
     CASE p_outcome
       WHEN 'promote' THEN 'league_promoted'
       WHEN 'demote'  THEN 'league_demoted'
       ELSE 'league_held'
     END,
     v_text ->> 'title', v_text ->> 'body', '🏆', '/dashboard',
     jsonb_build_object('outcome', p_outcome, 'coins', COALESCE(p_coins, 0)))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.notify_friend_post_for(uuid, uuid) TO authenticated;
