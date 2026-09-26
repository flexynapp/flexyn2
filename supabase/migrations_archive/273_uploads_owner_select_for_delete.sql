-- 273_uploads_owner_select_for_delete.sql
--
-- Let users see their OWN objects in the `uploads` bucket, so deleting
-- them actually deletes them.
--
-- ── The silent leak ──────────────────────────────────────────────────
--
-- Storage's delete endpoint resolves the target rows with a SELECT
-- before removing them. Migration 185 dropped the bucket's only SELECT
-- policy ("uploads: public read") to stop cross-user enumeration, which
-- was the right call — but it also blinded that resolution step. With no
-- SELECT policy, the delete finds nothing to delete, removes nothing,
-- and returns 200 with an empty array. No error is raised anywhere.
--
-- Migration 185's header says it "Verified the client never calls
-- storage.from('uploads').list() (only getPublicUrl + remove)". The
-- getPublicUrl half was right — a public bucket serves through the CDN
-- regardless of RLS. The remove half is what broke, because remove needs
-- the read that list needs.
--
-- Measured against production before writing this, as the owning user:
--
--   POST /storage/v1/object/list/uploads   → 200, [] (own prefix, 2 real objects)
--   DELETE /storage/v1/object/uploads      → 200, [] (nothing removed)
--   HEAD /object/public/uploads/<path>     → 200 (still serving)
--
-- Every failed-after-upload cleanup path in the app has therefore been
-- orphaning its blob: HubChat.jsx (2 sites), HubComposer.jsx,
-- stories.js. They all call .remove([path]) and none of them can fail
-- loudly, because the API reports success.
--
-- ── Why this doesn't reopen the enumeration hole ─────────────────────
--
-- The dropped policy was unscoped: any client could list every object in
-- the bucket and walk other users' avatars and post images by path. This
-- one is prefix-scoped to the caller's own uid folder, exactly matching
-- the DELETE and UPDATE policies that mig 185 left in place. A user can
-- see their own uploads and nothing else, so `remove` works and
-- enumeration stays closed.
--
-- Uploads are written to `<auth.uid()>/<timestamp>.<ext>` by
-- _uploadFile in src/api/db.js, which is what makes the prefix check
-- meaningful.
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE, per CLAUDE.md.

DROP POLICY IF EXISTS "uploads: read own objects" ON storage.objects;
CREATE POLICY "uploads: read own objects"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- Expect the three uploads policies plus this one: read own / upload /
-- update own / delete own, all prefix-scoped to the caller.
SELECT polname,
       CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                   WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS cmd
  FROM pg_policy
 WHERE polrelid = 'storage.objects'::regclass
   AND polname LIKE 'uploads:%'
 ORDER BY 2;
