-- 193_orphaned_columns_and_guest_email_backfill.sql
--
-- Companion to 192, from the same pre-launch audit (2026-07-12). Three
-- groups of fixes, all verified against prod schema before writing:
--
-- A. ORPHANED COLUMNS the client has always written but no migration
--    ever created (the repo's #1 historical defect class — the
--    strip-and-retry layer silently drops these writes, so the features
--    no-op with a success toast):
--      • user_profiles.birthday — Settings + Progress "Edit birthday"
--        writes it, both screens read it back for the age display. The
--        write was stripped, so date-of-birth edits were thrown away and
--        the age display always showed the em-dash. (The client now also
--        syncs the derived `age` column on birthday edits, so BMR /
--        water / VO2max / nutrition calcs unfreeze from the signup value.)
--      • user_profiles.dark_mode — ThemeContext persists the light/dark
--        choice server-side for cross-device sync; write was stripped so
--        the preference never followed the user to a new device.
--      • user_profiles.distance_unit — same for km/mi (weight_unit, its
--        sibling, was always migration-backed; this one was missed).
--      • regimens.copied_from_post_id + regimens.original_author_email —
--        written when copying a shared regimen from a Hub post; the read
--        (`alreadyCopied`) checks copied_from_post_id, so with the column
--        missing the "Copied" state never appeared and users could stack
--        duplicate copies of the same regimen.
--
-- B. increment_live_viewers — the client (src/lib/data/hubLiveSessions.js)
--    has always called this RPC on joining a live session, but no
--    migration ever created it; the call is fire-and-forget so viewer
--    counts silently stayed at 0. hub_live_sessions.id is TEXT.
--
-- C. GUEST EMAIL BACKFILL — anonymous accounts have auth.email() = '',
--    so server RPCs that stamped an email column from auth.email() wrote
--    '' instead of the canonical guest_<uid>@flexyn.guest that client
--    writes use (mig 172 + the db.js synthesis). All reads of these
--    tables now key on user_id (client fixed in the same commit), but
--    normalizing the stored rows keeps any remaining/legacy email read
--    working and the data self-consistent. Idempotent: only touches
--    rows where the email is '' and user_id is present.
--
-- Paste-safe per repo convention: single-table statements, bare columns,
-- no alias.column or record-dotted tokens.

-- ── A. Orphaned columns ───────────────────────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS birthday      DATE,
  ADD COLUMN IF NOT EXISTS dark_mode     BOOLEAN,
  ADD COLUMN IF NOT EXISTS distance_unit TEXT;

ALTER TABLE public.regimens
  ADD COLUMN IF NOT EXISTS copied_from_post_id   UUID,
  ADD COLUMN IF NOT EXISTS original_author_email TEXT;

-- ── B. Live-session viewer counter ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.increment_live_viewers(p_session_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.hub_live_sessions
     SET viewer_count = COALESCE(viewer_count, 0) + 1
   WHERE id = p_session_id
     AND is_active = TRUE;
END;
$$;

REVOKE ALL    ON FUNCTION public.increment_live_viewers(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_live_viewers(TEXT) TO authenticated;

-- ── C. Guest '' → canonical email backfill ────────────────────────────

UPDATE public.achievements
   SET created_by = 'guest_' || user_id || '@flexyn.guest'
 WHERE created_by = ''
   AND user_id IS NOT NULL;

UPDATE public.user_trophies
   SET user_email = 'guest_' || user_id || '@flexyn.guest'
 WHERE user_email = ''
   AND user_id IS NOT NULL;

UPDATE public.user_capsules
   SET user_email = 'guest_' || user_id || '@flexyn.guest'
 WHERE user_email = ''
   AND user_id IS NOT NULL;

UPDATE public.user_inventory
   SET user_email = 'guest_' || user_id || '@flexyn.guest'
 WHERE user_email = ''
   AND user_id IS NOT NULL;

UPDATE public.marketplace_listings
   SET seller_email = 'guest_' || seller_user_id || '@flexyn.guest'
 WHERE seller_email = ''
   AND seller_user_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
