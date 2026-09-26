-- 233_story_hard_delete_24h.sql
--
-- Hard-delete stories once they expire (Instagram behaviour: 24h, then gone).
--
-- Until now expires_at only HID a story — the feed query filters on it — so
-- rows and their uploaded media lived forever. This adds a purge function and
-- runs it every 15 minutes via pg_cron.
--
-- What it removes:
--   • the story row (story_likes / story_views / story_dms cascade off the FK)
--   • the matching storage.objects row for the uploaded media
--
-- Storage caveat: deleting the storage.objects row detaches the file from the
-- bucket listing. Supabase does not reclaim the S3 blob from a direct SQL
-- delete, so a follow-up sweep via the Storage API is the belt-and-braces
-- option if bucket size ever matters. The user-visible outcome — the story is
-- gone and its URL 404s through the API — is achieved here.
--
-- Highlighted stories: migration 099 lets a user pin a story to a highlight
-- album. Those are intentionally EXEMPT from the purge, otherwise pinning
-- something would silently lose it a day later.

CREATE OR REPLACE FUNCTION public.purge_expired_stories()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'storage'
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  -- Collect the expired, non-pinned stories first so we can clean their media.
  CREATE TEMP TABLE IF NOT EXISTS _expiring_stories (id uuid, image_url text) ON COMMIT DROP;
  DELETE FROM _expiring_stories;

  INSERT INTO _expiring_stories (id, image_url)
  SELECT id, image_url
  FROM public.stories
  WHERE expires_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM public.story_highlight_items
      WHERE story_id = public.stories.id
    );

  -- Media: match the storage object by the tail of its public URL.
  DELETE FROM storage.objects
  WHERE bucket_id = 'uploads'
    AND EXISTS (
      SELECT 1 FROM _expiring_stories
      WHERE image_url LIKE '%' || storage.objects.name
    );

  DELETE FROM public.stories
  WHERE id IN (SELECT id FROM _expiring_stories);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Internal maintenance routine — not an RPC surface (mirrors migration 185).
REVOKE ALL ON FUNCTION public.purge_expired_stories() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'purge_expired_stories';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule(
    'purge_expired_stories',
    '*/15 * * * *',
    $cron$ SELECT public.purge_expired_stories(); $cron$
  );
END $$;

NOTIFY pgrst, 'reload schema';
