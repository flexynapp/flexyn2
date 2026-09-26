-- Migration 018: Raise the storage bucket's per-file size limit to 50 MB.
--
-- Modern phone cameras (iPhone 15 Live Photos, 4K screenshots) routinely
-- exceed the original 5 MB cap. DMs are private 1:1 conversations so a
-- generous limit is safe — it's the user uploading their own content.
--
-- Idempotent: UPDATE ON CONFLICT, safe to re-run.

UPDATE storage.buckets
SET file_size_limit = 52428800  -- 50 MB
WHERE id = 'uploads';
