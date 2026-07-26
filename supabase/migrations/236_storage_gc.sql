-- 236_storage_gc.sql
--
-- Actually reclaim orphaned storage blobs.
--
-- THE PROBLEM
--
-- Migration 233 (expired stories) and migration 234 (purged message
-- requests) both need to delete an uploaded file. Until now the only
-- tool available in SQL was `DELETE FROM storage.objects`, which mig 233
-- documents honestly: the file leaves the bucket listing and its URL
-- stops resolving, but Supabase never reclaims the underlying S3 object.
--
-- Worse, that delete is a one-way door. The Storage API's DELETE finds
-- the object through its metadata row; once the row is gone the API
-- 404s, and the S3 blob can never be removed through a supported path
-- again. Deleting the row is precisely what makes proper cleanup
-- impossible.
--
-- THE FIX
--
-- SQL stops touching storage.objects entirely and ENQUEUES instead
-- (mig 234's public.storage_cleanup_queue). The `storage-gc` Edge
-- Function drains the queue through the real Storage API
-- (`supabase.storage.from(bucket).remove([...])`), which deletes the S3
-- object AND the metadata row together.
--
-- This migration adds the drain side:
--   • claim_storage_cleanup(p_limit)      — hand the function a batch,
--     filtered so nothing still referenced by a live row is returned
--   • complete_storage_cleanup(p_ids)     — mark a batch done
--   • fail_storage_cleanup(p_ids, p_err)  — record an attempt + error
--   • kick_storage_gc()                   — pg_net POST to the function
--   • a 5-minute cron that calls kick_storage_gc()
--   • purge_expired_stories() re-created to enqueue instead of deleting
--
-- SECRETS — VAULT, NOT `ALTER DATABASE`
--
-- kick_storage_gc() resolves its URL + shared secret exactly the way
-- migration 038 re-pointed the push trigger: Supabase Vault first
-- (`vault.decrypted_secrets`), then `current_setting()` as a fallback
-- for self-hosted / dev installs. `ALTER DATABASE postgres SET …` is
-- NOT usable on managed Supabase — it fails with `42501: permission
-- denied to set parameter`, because the database is owned by
-- supabase_admin and the SQL editor's postgres role cannot mutate
-- database-scoped GUCs. That is the whole reason 038 exists, and this
-- function deliberately reuses its mechanism rather than inventing a
-- second one.
--
-- Operator setup after running this migration:
--
--   SELECT vault.create_secret(
--     'https://<project-ref>.functions.supabase.co/storage-gc',
--     'storage_gc_url'
--   );
--   SELECT vault.create_secret(
--     '<same value you set as STORAGE_GC_SECRET on the Edge Function>',
--     'storage_gc_secret'
--   );
--
-- SAFE DEGRADATION
--
-- kick_storage_gc() short-circuits when either secret is missing from
-- BOTH Vault and the GUCs. If the Edge Function is never deployed,
-- queue rows simply accumulate and nothing else breaks; deploy it later
-- and the backlog drains on the next tick. Every pg_net call is wrapped
-- so a dispatch failure can never fail the caller.
--
-- IDEMPOTENT + RE-RUNNABLE
--
-- claim only returns unprocessed rows, complete is a plain UPDATE, and
-- the Storage API treats removing an already-gone object as success. A
-- re-run of the whole pipeline is a no-op.
--
-- Paste-safe: public.<table>, auth.<fn>(), bare columns, SETOF instead
-- of RETURNS TABLE (no OUT-param shadowing), and no bare angle-bracket
-- comparison operators in any statement body.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ─────────────────────────────────────────────────────────────────────
-- claim_storage_cleanup — the batch the GC is allowed to delete
-- ─────────────────────────────────────────────────────────────────────
-- The live-reference guard. A queued name is withheld if ANY live row
-- still points at it. The columns checked are every place this app
-- stores an `uploads` URL that a purge could plausibly race with:
--
--   hub_messages.attachment_url  (mig 012)  — DM images / GIFs / voice
--   stories.image_url            (mig 043)  — story media
--   hub_posts.image_url          (mig 001)  — feed images
--   hub_posts.video_url          (mig 111)  — feed video
--   user_profiles.avatar_url     (mig 001)  — avatars
--
-- Upload paths are `{user_id}/{epoch_ms}.{ext}` (src/api/db.js
-- `_uploadFile`), so one blob is referenced by at most one row and the
-- guard is belt-and-braces rather than load-bearing. It exists so that a
-- future feature which re-uses an existing URL can never be
-- garbage-collected out from under itself.
--
-- Returns SETOF the queue table so callers read named columns without a
-- RETURNS TABLE OUT-param shadowing the underlying column names.
CREATE OR REPLACE FUNCTION public.claim_storage_cleanup(
  p_limit INTEGER DEFAULT 100
) RETURNS SETOF public.storage_cleanup_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
    FROM public.storage_cleanup_queue
   WHERE processed_at IS NULL
     AND attempts = least(attempts, 5)
     AND NOT EXISTS (
       SELECT 1 FROM public.hub_messages
        WHERE attachment_url LIKE '%/' || object_name
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.stories
        WHERE image_url LIKE '%/' || object_name
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.hub_posts
        WHERE image_url LIKE '%/' || object_name
           OR video_url LIKE '%/' || object_name
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.user_profiles
        WHERE avatar_url LIKE '%/' || object_name
     )
   ORDER BY requested_at
   LIMIT coalesce(p_limit, 100);
$$;

REVOKE ALL ON FUNCTION public.claim_storage_cleanup(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_storage_cleanup(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_storage_cleanup(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_storage_cleanup(INTEGER) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- complete / fail — the Edge Function reporting back
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_storage_cleanup(
  p_ids UUID[]
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done INTEGER := 0;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.storage_cleanup_queue
     SET processed_at = now(),
         last_error   = NULL
   WHERE id = ANY (p_ids)
     AND processed_at IS NULL;
  GET DIAGNOSTICS v_done = ROW_COUNT;
  RETURN v_done;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_storage_cleanup(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_storage_cleanup(UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.complete_storage_cleanup(UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_storage_cleanup(UUID[]) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_storage_cleanup(
  p_ids UUID[],
  p_error TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done INTEGER := 0;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  -- claim_storage_cleanup withholds anything past 5 recorded failures,
  -- so a permanently failing object stops being retried instead of
  -- spinning forever. Its row stays for inspection via last_error.
  UPDATE public.storage_cleanup_queue
     SET attempts   = attempts + 1,
         last_error = left(coalesce(p_error, 'unknown'), 500)
   WHERE id = ANY (p_ids)
     AND processed_at IS NULL;
  GET DIAGNOSTICS v_done = ROW_COUNT;
  RETURN v_done;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_storage_cleanup(UUID[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_storage_cleanup(UUID[], TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fail_storage_cleanup(UUID[], TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fail_storage_cleanup(UUID[], TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- kick_storage_gc — pg_net POST to the Edge Function
-- ─────────────────────────────────────────────────────────────────────
-- Secret resolution copies migration 038 EXACTLY, deliberately. 034
-- originally used `ALTER DATABASE postgres SET app.send_push_url = …`,
-- which fails on managed Supabase with `42501: permission denied to set
-- parameter` — the database is owned by supabase_admin and the postgres
-- role the SQL editor runs as cannot mutate database-scoped GUCs. 038
-- moved that to Supabase Vault. This function has the same problem, so
-- it gets the same solution rather than a second, different one:
--
--   • Vault first — SELECT decrypted_secret FROM vault.decrypted_secrets
--   • current_setting() second — so self-hosted / dev installs that
--     CAN set GUCs keep working
--   • both wrapped in EXCEPTION blocks, and a missing value is a silent
--     RETURN, never an error
--
-- Vault secret names mirror the GUC suffixes, as 038 does:
-- `storage_gc_url` and `storage_gc_secret`.
--
-- Rotation takes effect on the next tick with no redeploy, same as push.
CREATE OR REPLACE FUNCTION public.kick_storage_gc()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url     TEXT;
  v_secret  TEXT;
  v_pending INTEGER := 0;
BEGIN
  -- Try Vault first. Wrapped so a missing extension / secret /
  -- permissions issue silently degrades to no-op.
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets
     WHERE name = 'storage_gc_url'
     LIMIT 1;
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
     WHERE name = 'storage_gc_secret'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL; v_secret := NULL;
  END;

  -- Legacy / self-hosted fallback: honour the GUCs when they are set.
  IF v_url IS NULL OR v_url = '' THEN
    BEGIN
      v_url := current_setting('app.storage_gc_url', true);
    EXCEPTION WHEN OTHERS THEN
      v_url := NULL;
    END;
  END IF;
  IF v_secret IS NULL OR v_secret = '' THEN
    BEGIN
      v_secret := current_setting('app.storage_gc_secret', true);
    EXCEPTION WHEN OTHERS THEN
      v_secret := NULL;
    END;
  END IF;

  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    -- Not configured yet → no-op. The queue simply accumulates.
    RETURN;
  END IF;

  SELECT count(*) INTO v_pending
    FROM public.storage_cleanup_queue
   WHERE processed_at IS NULL;

  IF v_pending = 0 THEN
    RETURN;
  END IF;

  BEGIN
    PERFORM extensions.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',      'application/json',
        'X-Storage-GC-Secret', v_secret
      ),
      body    := jsonb_build_object('limit', 200)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[kick_storage_gc] dispatch failed: %', SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.kick_storage_gc() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kick_storage_gc() FROM anon;
REVOKE ALL ON FUNCTION public.kick_storage_gc() FROM authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'storage_gc_kick';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule(
    'storage_gc_kick',
    '*/5 * * * *',
    $cron$ SELECT public.kick_storage_gc(); $cron$
  );
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- purge_expired_stories — re-created to enqueue instead of deleting
-- ─────────────────────────────────────────────────────────────────────
-- Identical to mig 233 except the storage step. 233 deleted the
-- storage.objects row, which left the S3 blob stranded forever; this
-- version hands the object name to the queue so the GC can remove it
-- through the Storage API for real. Everything else — the highlight
-- exemption, the temp table, the return value — is unchanged.
CREATE OR REPLACE FUNCTION public.purge_expired_stories()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_deleted integer := 0;
  v_paths   text[];
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _expiring_stories (id uuid, image_url text) ON COMMIT DROP;
  DELETE FROM _expiring_stories;

  INSERT INTO _expiring_stories (id, image_url)
  SELECT id, image_url
    FROM public.stories
   WHERE expires_at = least(expires_at, now())
     AND NOT (id IN (
       SELECT story_id
         FROM public.story_highlight_items
        WHERE story_id IS NOT NULL
     ));

  DELETE FROM public.stories
   WHERE id IN (SELECT id FROM _expiring_stories);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Enqueue AFTER the story rows are gone so the GC's live-reference
  -- guard can never see a row that is about to be deleted.
  SELECT array_agg(split_part(image_url, '/uploads/', 2))
    INTO v_paths
    FROM _expiring_stories
   WHERE image_url IS NOT NULL
     AND image_url LIKE '%/uploads/%';

  IF v_paths IS NOT NULL THEN
    PERFORM public.enqueue_storage_cleanup('uploads', v_paths, 'story_expiry');
  END IF;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_stories() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_stories() FROM anon;
REVOKE ALL ON FUNCTION public.purge_expired_stories() FROM authenticated;

NOTIFY pgrst, 'reload schema';
