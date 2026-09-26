-- 350_display_name_and_username_change.sql
--
-- Two halves of the same walkthrough item: a profile now carries a chosen
-- DISPLAY NAME alongside its @handle, and the handle itself can finally be
-- changed.
--
-- ── Why display_name is a NEW column and not `full_name` ────────────────────
--
-- `full_name` already exists and is populated on 21 of 57 rows, so reusing it
-- looks free. It is not. 19 of those 21 are two-part real names collected at
-- signup — people typed them into an account form, not into a "what should
-- everyone call you" field — and `HubProfile.jsx` documents the matching
-- decision on the client: "Hub profiles show the user's @username and nothing
-- else identity-wise. No full_name. No email."
--
-- Publishing full_name as the display name would therefore expose 19 real
-- names that nobody opted into showing, in one deploy, silently. display_name
-- is NULL for everyone until they set it, and the UI falls back to the handle
-- alone — which is exactly today's behaviour. Nothing changes for anyone who
-- does not opt in.
--
-- ── Why the handle needed more than an RPC ──────────────────────────────────
--
-- `username` is NOT in `user_profiles_block_privileged_updates`, so any signed
-- in client could already PATCH it straight through PostgREST. A 30-day
-- cooldown enforced only inside a function would have been decoration: the
-- bypass is one HTTP call. And there was no unique index on the column at all,
-- so two people could hold the same handle — nobody does today (verified: 0
-- duplicates across 31 handles), which is luck rather than a guarantee.
--
-- So this migration adds BOTH: the index that makes "taken" mean something,
-- and a trigger that makes the RPC the only path for a CHANGE.
--
-- The trigger deliberately still allows NULL -> value. That transition is
-- onboarding claiming a handle for the first time, and blocking it would break
-- signup for every new account. Only value -> different-value is gated, which
-- is the thing the cooldown is about.
--
-- `set_username` is SECURITY DEFINER and therefore runs as its owner, so it
-- passes the trigger's existing `current_user = 'postgres'` early return with
-- no session flag to set and no GUC to read — managed Supabase blocks
-- `ALTER DATABASE ... SET` anyway (see migration 038).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Columns
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_profiles.display_name IS
  'Chosen public name shown above the @handle. NULL means show the handle alone. NOT full_name, which is the signup name and stays private.';

COMMENT ON COLUMN public.user_profiles.username_changed_at IS
  'When the handle was last CHANGED. NULL means never changed since the first claim, so the next change is free.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Handles are unique, case-insensitively
-- ───────────────────────────────────────────────────────────────────────────
--
-- Case-insensitive because @Sean and @sean are the same person to every human
-- reading a mention, and letting both exist is an impersonation vector rather
-- than a naming choice. Partial, so the 26 rows with no handle yet do not all
-- collide on NULL — though NULLs are distinct in Postgres anyway, the
-- predicate also excludes the empty string, which is NOT distinct.

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_username_lower_uniq
  ON public.user_profiles (lower(username))
  WHERE username IS NOT NULL AND username <> '';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. A handle CHANGE is RPC-only
-- ───────────────────────────────────────────────────────────────────────────
--
-- A separate small trigger rather than an edit to
-- `user_profiles_block_privileged_updates`. That function is 120 lines of
-- guards written across a dozen migrations, and CLAUDE.md's own lesson is that
-- redefining a function from a stale template silently reverts whatever landed
-- in between — push notifications were dead for months on exactly that. Adding
-- a second trigger cannot drop a guard it never contained.

CREATE OR REPLACE FUNCTION public.enforce_username_change_is_rpc_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- First claim (onboarding) stays open: there is no previous handle to
  -- protect and no cooldown to spend.
  IF OLD.username IS NULL OR OLD.username = '' THEN
    RETURN NEW;
  END IF;

  -- A no-op write is not a change. Profile saves send the whole row, so
  -- without this every unrelated edit would raise.
  IF NEW.username IS NOT DISTINCT FROM OLD.username THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'username changes go through set_username()'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_username_change_rpc_only ON public.user_profiles;
CREATE TRIGGER trg_username_change_rpc_only
  BEFORE UPDATE OF username ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_username_change_is_rpc_only();

-- ───────────────────────────────────────────────────────────────────────────
-- 4. set_username()
-- ───────────────────────────────────────────────────────────────────────────
--
-- Returns a jsonb verdict rather than raising, because every outcome here is
-- something the UI has to SAY — "that one is taken", "you changed it 11 days
-- ago" — and an exception would arrive as a generic failure with the reason
-- buried in a message string.
--
-- The user comes from auth.uid(), never from a parameter. Reserved-handle and
-- profanity checks already run as their own BEFORE triggers on this column;
-- they raise, so they are caught below and mapped to a reason the client can
-- render instead of surfacing as a 500.

CREATE OR REPLACE FUNCTION public.set_username(p_username TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       UUID;
  v_clean     TEXT;
  v_current   TEXT;
  v_last      TIMESTAMPTZ;
  v_taken     BOOLEAN;
  v_next      TIMESTAMPTZ;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  END IF;

  v_clean := lower(btrim(coalesce(p_username, '')));
  v_clean := ltrim(v_clean, '@');

  -- 3-20 of letters, digits and underscore. Deliberately no dots or dashes:
  -- a handle is rendered inside sentences ("@sean liked this") and a trailing
  -- dot is unreadable there.
  IF v_clean !~ '^[a-z0-9_]{3,20}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  SELECT username, username_changed_at
    INTO v_current, v_last
    FROM public.user_profiles
   WHERE id = v_uid;

  IF v_current IS NOT NULL AND lower(v_current) = v_clean THEN
    -- Asking for the handle you already hold is not a change, and must not
    -- burn the 30-day allowance.
    RETURN jsonb_build_object('ok', true, 'reason', 'unchanged', 'username', v_current);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE lower(username) = v_clean AND id <> v_uid
  ) INTO v_taken;

  IF v_taken THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'taken');
  END IF;

  -- The cooldown applies to CHANGES, so a first claim is always free even
  -- though it writes the timestamp.
  IF v_current IS NOT NULL AND v_current <> '' AND v_last IS NOT NULL THEN
    v_next := v_last + INTERVAL '30 days';
    IF now() < v_next THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'cooldown',
        'next_change_at', v_next
      );
    END IF;
  END IF;

  BEGIN
    UPDATE public.user_profiles
       SET username = v_clean,
           username_changed_at = CASE
             WHEN v_current IS NULL OR v_current = '' THEN username_changed_at
             ELSE now()
           END
     WHERE id = v_uid;
  EXCEPTION
    WHEN unique_violation THEN
      -- Two people submitting the same free handle in the same second. The
      -- index is what actually decides it; this turns the loser's 23505 into
      -- the same answer the pre-check would have given.
      RETURN jsonb_build_object('ok', false, 'reason', 'taken');
    WHEN check_violation THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'reserved');
    WHEN OTHERS THEN
      -- The profanity trigger raises with its own code; anything else that
      -- reaches here is still a refusal, not a success.
      RETURN jsonb_build_object('ok', false, 'reason', 'rejected');
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'changed',
    'username', v_clean,
    'next_change_at',
      CASE WHEN v_current IS NULL OR v_current = ''
        THEN NULL
        ELSE now() + INTERVAL '30 days'
      END
  );
END;
$$;

-- Every public-schema function is a PostgREST endpoint the moment it exists,
-- and EXECUTE is granted to PUBLIC by default. Revoke first, then grant only
-- the role that should be calling it — anon must not be able to claim handles.
REVOKE ALL ON FUNCTION public.set_username(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_username(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_username(TEXT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Publish display_name
-- ───────────────────────────────────────────────────────────────────────────
--
-- APPENDED to the end of the select list, never inserted mid-list: CREATE OR
-- REPLACE VIEW can add trailing columns but cannot reorder or retype existing
-- ones, and a DROP would cascade through everything selecting from this view.
--
-- Ungated by `full_view` on purpose. A display name is a name someone CHOSE to
-- be called in public — the same category as username and avatar, both of
-- which stay visible on a private profile so people can still be recognised
-- and followed. It is the stats and the bio that privacy is about.
--
-- The inner subquery keeps selecting `email` (viewer_follows and
-- viewer_is_blocked_by key on it) while the outer select does not, so the view
-- still exposes no email column. `SELECT *` there rather than 110 dotted
-- column references: Postgres expands it at creation time, so the stored
-- definition is identical, and every token in this file stays paste-safe.

CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  id,
  username,
  full_name,
  avatar_url,
  CASE WHEN full_view THEN bio ELSE NULL::text END AS bio,
  CASE WHEN full_view THEN city ELSE NULL::text END AS city,
  country_flag,
  CASE WHEN full_view THEN website_url ELSE NULL::text END AS website_url,
  is_private,
  created_at,
  CASE WHEN full_view THEN last_active_at ELSE NULL::timestamptz END AS last_active_at,
  CASE WHEN full_view THEN total_xp ELSE NULL::integer END AS total_xp,
  CASE WHEN full_view THEN current_level ELSE NULL::integer END AS current_level,
  CASE WHEN full_view THEN prestige_level ELSE NULL::integer END AS prestige_level,
  CASE WHEN full_view THEN lifetime_xp ELSE NULL::integer END AS lifetime_xp,
  CASE WHEN full_view THEN total_volume_lbs ELSE NULL::numeric END AS total_volume_lbs,
  CASE WHEN full_view THEN total_distance_meters ELSE NULL::numeric END AS total_distance_meters,
  CASE WHEN full_view THEN achievements_unlocked_count ELSE NULL::integer END AS achievements_unlocked_count,
  CASE WHEN full_view THEN workout_streak ELSE NULL::integer END AS workout_streak,
  CASE WHEN full_view THEN longest_workout_streak ELSE NULL::integer END AS longest_workout_streak,
  CASE WHEN full_view THEN league_tier ELSE NULL::text END AS league_tier,
  equipped_title_id,
  equipped_frame_id,
  signature_trophy,
  loot_theme_id,
  preferred_theme,
  CASE WHEN full_view THEN trophy_case ELSE NULL::jsonb END AS trophy_case,
  trophy_case_visible,
  nemesis_opt_out,
  story_dms_disabled,
  default_story_privacy,
  hide_from_search,
  display_name
FROM (
  SELECT
    *,
    (NOT is_private OR id = auth.uid() OR viewer_follows(email)) AS full_view
  FROM public.user_profiles
  WHERE NOT viewer_is_blocked_by(email)
) visible_profiles;

-- Unchanged from before, restated because a replaced view does not inherit
-- grants it never had: anon has no read here and must not gain one.
REVOKE ALL ON public.public_profiles FROM anon;
GRANT SELECT ON public.public_profiles TO authenticated;
