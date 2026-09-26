-- 109_block_user_full_column_fix.sql
--
-- CRITICAL BUG FIX for mig 106_general_user_blocks.
--
-- The block_user_full RPC's third side effect (unfollow both
-- directions) references a column called `followed_email` on
-- hub_follows. That column does NOT exist — the real column,
-- introduced in 001_initial_schema.sql line 344, is
-- `followee_email`. Every other migration that touches hub_follows
-- uses the correct name (mig 091, 093, 103 PYMK).
--
-- Impact: every call to block_user_full fails with 42703
-- (undefined column). The function is a single-transaction
-- SECURITY DEFINER, so the failure rolls back ALL three side
-- effects:
--   1. user_blocks INSERT     — rolled back
--   2. story_blocks INSERT    — rolled back
--   3. hub_follows DELETE     — never ran
-- Net effect: the Block button on the safety panel fails 100%
-- of the time, throws an opaque 42703 error to the client.
-- Users trying to block harassers can't.
--
-- Fix: re-issue block_user_full with the correct column name.
-- CREATE OR REPLACE FUNCTION overwrites the buggy version
-- atomically. No data migration needed — user_blocks rows that
-- DID get written before the error rolled them back never
-- existed in the first place.

CREATE OR REPLACE FUNCTION public.block_user_full(
  p_blocked_email TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $block_user_full$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_blocked_email IS NULL OR length(p_blocked_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF lower(v_email) = lower(p_blocked_email) THEN
    RAISE EXCEPTION 'cannot_block_self' USING ERRCODE = '22023';
  END IF;

  -- 1. The block itself.
  INSERT INTO public.user_blocks (blocker_id, blocker_email, blocked_email)
  VALUES (v_uid, v_email, p_blocked_email)
  ON CONFLICT (blocker_id, blocked_email) DO NOTHING;

  -- 2. Story scope is a strict subset of full block.
  INSERT INTO public.story_blocks (blocker_id, blocker_email, blocked_email)
  VALUES (v_uid, v_email, p_blocked_email)
  ON CONFLICT (blocker_id, blocked_email) DO NOTHING;

  -- 3. Unfollow both directions. The column is `followee_email`
  --    (mig 001 line 344), NOT `followed_email` — fix vs mig 106.
  DELETE FROM public.hub_follows
   WHERE (lower(follower_email) = lower(v_email)
          AND lower(followee_email) = lower(p_blocked_email))
      OR (lower(follower_email) = lower(p_blocked_email)
          AND lower(followee_email) = lower(v_email));
END;
$block_user_full$;

NOTIFY pgrst, 'reload schema';
