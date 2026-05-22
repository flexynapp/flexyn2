-- 084_fix_sticker_reactions_column_types.sql
--
-- Production-only schema drift fix for public.post_sticker_reactions.
--
-- WHAT'S BROKEN
-- ─────────────
-- Adding a sticker reaction on a hub post raises:
--
--   ERROR: operator does not exist: uuid = text
--
-- The chain that fails:
--   1. Client upserts into post_sticker_reactions.
--   2. BEFORE-INSERT trigger trg_validate_sticker_reaction (migration 029)
--      executes `IF NEW.user_id IS DISTINCT FROM auth.uid()` — but
--      NEW.user_id is TEXT in production while auth.uid() returns UUID,
--      so the planner can't compose the comparison.
--   3. Same problem in the AFTER-INSERT trg_notify_post_reaction trigger
--      (migration 063) which compares NEW.user_id against hub_posts.user_id
--      (UUID).
--
-- ROOT CAUSE
-- ──────────
-- Migrations 011 and 015 both document that post_sticker_reactions was
-- created in production by an early seed script BEFORE migration 010
-- ran, so the `CREATE TABLE IF NOT EXISTS` in 010 was a silent no-op.
-- The seed left `user_id` and `post_id` as TEXT instead of UUID. Every
-- subsequent migration touched columns (item_rarity, item_name,
-- user_avatar_url, user_name) but never the FK columns themselves,
-- because no code path noticed the type mismatch until the validate
-- trigger in 029 started doing direct comparisons.
--
-- Fresh environments that applied migrations top-to-bottom have the
-- correct UUID columns. Only the early-seed production database is
-- affected — but that's the database that matters.
--
-- THE FIX
-- ───────
-- ALTER COLUMN ... TYPE uuid USING <col>::uuid. The cast succeeds
-- because the values in those columns are already valid UUID strings
-- (auth.users.id values that the seed script wrote in). We:
--   1. Detect the current column type via information_schema to keep
--      the migration idempotent — running this on an already-fixed
--      database is a no-op.
--   2. Run the cast for user_id and post_id independently so a fix-
--      one-then-fail scenario doesn't leave us half-converted.
--   3. Recreate the FK to auth.users(id) on user_id (the seed script
--      didn't add it; only the UUID re-cast lets us attach it now).
--   4. Recreate the index that supports the (post_id, user_id) UNIQUE
--      constraint — the type change drops dependent indexes
--      transparently but the planner does best with an explicit
--      composite index.
--
-- The triggers (029, 063) DON'T need rewriting — once the columns are
-- UUID, the existing comparisons type-check correctly.

DO $mig$
DECLARE
  v_user_id_type TEXT;
  v_post_id_type TEXT;
BEGIN
  -- ── Check current column types ─────────────────────────────────────────
  SELECT data_type INTO v_user_id_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'post_sticker_reactions'
     AND column_name  = 'user_id';

  SELECT data_type INTO v_post_id_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'post_sticker_reactions'
     AND column_name  = 'post_id';

  -- ── Convert user_id → uuid if needed ───────────────────────────────────
  IF v_user_id_type = 'text' THEN
    -- Drop dependent objects that block the type change. The UNIQUE
    -- constraint references both columns; recreate it at the end.
    ALTER TABLE public.post_sticker_reactions
      DROP CONSTRAINT IF EXISTS post_sticker_reactions_post_id_user_id_key;

    ALTER TABLE public.post_sticker_reactions
      ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

    -- Attach the FK to auth.users(id) that the original CREATE TABLE
    -- declared but the seed script never installed.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'post_sticker_reactions_user_id_fkey'
    ) THEN
      ALTER TABLE public.post_sticker_reactions
        ADD CONSTRAINT post_sticker_reactions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    RAISE NOTICE '[084] converted post_sticker_reactions.user_id text → uuid';
  END IF;

  -- ── Convert post_id → uuid if needed ───────────────────────────────────
  IF v_post_id_type = 'text' THEN
    ALTER TABLE public.post_sticker_reactions
      DROP CONSTRAINT IF EXISTS post_sticker_reactions_post_id_user_id_key;

    ALTER TABLE public.post_sticker_reactions
      ALTER COLUMN post_id TYPE uuid USING post_id::uuid;

    -- post_id should FK to hub_posts(id). The original migration 010
    -- didn't declare it (only user_id had a REFERENCES) but we add it
    -- now to prevent orphan reactions on deleted posts.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'post_sticker_reactions_post_id_fkey'
    ) THEN
      ALTER TABLE public.post_sticker_reactions
        ADD CONSTRAINT post_sticker_reactions_post_id_fkey
        FOREIGN KEY (post_id) REFERENCES public.hub_posts(id) ON DELETE CASCADE;
    END IF;

    RAISE NOTICE '[084] converted post_sticker_reactions.post_id text → uuid';
  END IF;

  -- ── Restore the (post_id, user_id) UNIQUE constraint ───────────────────
  -- We dropped it above to allow the type change. Recreate it now so
  -- the upsert's onConflict clause still has something to match.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'post_sticker_reactions_post_id_user_id_key'
  ) THEN
    ALTER TABLE public.post_sticker_reactions
      ADD CONSTRAINT post_sticker_reactions_post_id_user_id_key
      UNIQUE (post_id, user_id);
  END IF;
END $mig$;

-- Force PostgREST to refresh its schema cache so the corrected column
-- types are immediately visible to the JS client without a manual reload.
NOTIFY pgrst, 'reload schema';
