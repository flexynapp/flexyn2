-- 073_audit_schema_fixes.sql
--
-- Consolidated schema-level fixes from the 4-surface audit pass:
-- Onboarding (1 CRITICAL, 2 HIGH), Stories (1 CRITICAL, 2 HIGH),
-- plus a couple of MEDIUMs. Each fix is a focused DDL block — all
-- idempotent, all safe to re-run.
--
-- 1. user_profiles.username UNIQUE constraint (partial, excludes
--    deleted_* placeholders). Closes the TOCTOU race where two
--    near-simultaneous signups can pass the client-side "is this
--    taken?" probe + both insert + both succeed.
--
-- 2. CHECK constraints on age / height_inches / weight_lbs. The
--    SettingsPanel validates these on edit (we shipped that earlier),
--    but Onboarding's initial upsert bypassed all validation. A
--    direct POST could write age 999 or weight -50.
--
-- 3. bio profanity trigger changes from `BEFORE UPDATE OF bio` to
--    `BEFORE INSERT OR UPDATE OF bio`. Onboarding's upsert hits the
--    INSERT path on first save, which the trigger skipped — letting
--    new users land with profane bios server-side.
--
-- 4. story_likes RLS: was `USING (true)` for all authenticated
--    users — anyone could enumerate who liked anyone's story. Same
--    leak class as story_views (closed in mig 066). Scoped to
--    owner-or-liker.
--
-- 5. pg_cron jobs to actually delete expired rows from stories and
--    status_notes. Both tables had `expires_at` columns and indexes
--    but no scheduled cleanup — rows accumulated forever.
--
-- 6. status_notes profanity trigger (mirror of the username + bio
--    triggers). Status notes are free-form user prose; previously
--    unguarded server-side.


-- ── 1. Username UNIQUE (partial) ────────────────────────────────────────
-- Why partial: account-reset code sets username to "deleted_<uuid>"
-- so the human-readable name is freed up. Multiple reset rows can
-- coexist with non-conflicting deleted_* values. The UNIQUE bar
-- only applies to LIVE usernames.
--
-- CREATE UNIQUE INDEX IF NOT EXISTS is idempotent. If a duplicate
-- exists already (from before this fix), the index creation will
-- fail loudly — that's the right outcome; an admin needs to
-- de-duplicate by hand before the constraint goes live.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_profiles_username_live
  ON public.user_profiles (lower(username))
  WHERE username IS NOT NULL
    AND username NOT LIKE 'deleted_%';

-- ── 2. Field-range CHECK constraints ────────────────────────────────────
-- Bounds chosen to match the client validation shipped in SettingsPanel
-- and to allow real-world extremes without absurd values.
--   • age: 13 (Flexyn's minimum) to 120 (oldest living humans ever)
--   • height_inches: 36 (very short kids — 3 ft) to 96 (8 ft)
--   • weight_lbs: 50 to 800 (covers everyone)
-- All constraints allow NULL so a partial profile can land without
-- failing every column. NOT VALID + VALIDATE is a 2-phase apply that
-- skips the table rewrite — needed because existing rows might have
-- legacy out-of-range values; the VALIDATE step would surface them
-- as errors so we can clean up before enforcing. For now, just
-- enforce going forward.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_age_range') THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_age_range
      CHECK (age IS NULL OR (age >= 13 AND age <= 120)) NOT VALID;
  END IF;
EXCEPTION WHEN undefined_column THEN
  -- age column doesn't exist yet on this host; the constraint can be
  -- added in a follow-up migration when the column lands.
  NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_height_inches_range') THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_height_inches_range
      CHECK (height_inches IS NULL OR (height_inches >= 36 AND height_inches <= 96)) NOT VALID;
  END IF;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_weight_lbs_range') THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_weight_lbs_range
      CHECK (weight_lbs IS NULL OR (weight_lbs >= 50 AND weight_lbs <= 800)) NOT VALID;
  END IF;
EXCEPTION WHEN undefined_column THEN NULL; END $$;


-- ── 3. Bio profanity trigger now also fires on INSERT ───────────────────
-- Migration 054 only had `BEFORE UPDATE OF bio`. Onboarding's
-- supabase upsert hits the INSERT path on first save (for users
-- who fill in a bio during onboarding), so the trigger was bypassed.
-- Drop + recreate with both events. The function body itself is
-- unchanged.

DROP TRIGGER IF EXISTS trg_bio_profanity ON public.user_profiles;
CREATE TRIGGER trg_bio_profanity
  BEFORE INSERT OR UPDATE OF bio ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_bio_profanity();


-- ── 4. story_likes RLS — owner-or-liker only ────────────────────────────
-- Mirror of the story_views fix shipped in migration 066. The
-- previous `USING (true)` exposed every story_like row to every
-- authenticated user, leaking who supports whom. Now:
--   • Liker sees their own likes (needed for "you liked this" state).
--   • Story owner sees the full like list of their own stories
--     (needed for the "N likes" + "liked by..." display).
--   • Nobody else can read rows.

DROP POLICY IF EXISTS "story_likes: authenticated can read" ON public.story_likes;
CREATE POLICY "story_likes: owner or liker can read"
  ON public.story_likes FOR SELECT
  TO authenticated
  USING (
    liker_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.stories s
       WHERE s.id = story_likes.story_id
         AND s.user_id = auth.uid()
    )
  );


-- ── 5. pg_cron expiry cleanup for stories + status_notes ────────────────
-- Both tables shipped with an `expires_at` column and an index, plus
-- client-side filters that skip expired rows in SELECTs. But nothing
-- ever DELETEd them, so they accumulated forever — bloat + slower
-- expires_at index over time.
--
-- Runs every 6 hours. The DELETE is cheap because of the existing
-- partial indexes on expires_at. Cascade rules already on story_views
-- / story_likes / status_note_likes mean child rows clean up
-- automatically.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
DECLARE
  v_id BIGINT;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'stories_expire_6h';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule(
    'stories_expire_6h',
    '0 */6 * * *',
    $cron$
      DELETE FROM public.stories WHERE expires_at < now() - INTERVAL '1 hour';
    $cron$
  );

  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'status_notes_expire_6h';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule(
    'status_notes_expire_6h',
    '0 */6 * * *',
    $cron$
      DELETE FROM public.status_notes WHERE expires_at < now() - INTERVAL '1 hour';
    $cron$
  );
END $$;


-- ── 6. status_notes profanity check ─────────────────────────────────────
-- Status notes are short user prose (~60 chars) shown on profile
-- cards. Migration 047 created the table without any moderation.
-- Reuse the existing is_bio_clean function — same word-boundary
-- regex + leet pass, conservative pattern list. A separate
-- enforce_status_note_profanity wrapper raises a status_note_profanity
-- error code so the client can branch on it specifically.

CREATE OR REPLACE FUNCTION public.enforce_status_note_profanity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.content IS NULL OR NEW.content = '' THEN
    RETURN NEW;
  END IF;
  -- Reuse is_bio_clean — both are free-form prose with the same
  -- moderation bar.
  IF NOT public.is_bio_clean(NEW.content) THEN
    RAISE EXCEPTION 'status_note_profanity'
      USING ERRCODE = '23514',
            HINT    = 'Status note contains prohibited content. Edit it and try again.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_status_note_profanity ON public.status_notes;
CREATE TRIGGER trg_status_note_profanity
  BEFORE INSERT OR UPDATE OF content ON public.status_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_status_note_profanity();

NOTIFY pgrst, 'reload schema';
