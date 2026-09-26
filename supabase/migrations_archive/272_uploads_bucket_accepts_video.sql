-- 272_uploads_bucket_accepts_video.sql
--
-- Let the `uploads` bucket accept the file types the app actually sends.
--
-- ── The mismatch ─────────────────────────────────────────────────────
--
-- _uploadFile (src/api/db.js) defaults every upload to the `uploads`
-- bucket and accepts video (mp4 / mov / webm / m4v) plus HEIF and AVIF
-- stills. The bucket's allowed_mime_types listed images only:
--
--     image/jpeg, image/png, image/webp, image/gif, image/heic
--
-- So Storage rejected every video before it was ever written. Evidence,
-- not inference: `storage.objects` for this bucket holds 48 rows, all
-- image/jpeg, image/png or image/webp — not one video has EVER landed —
-- and `hub_posts` has zero rows with post_type = 'video' or a non-null
-- video_url, going back to the project's creation.
--
-- Two shipped surfaces were affected: Hub video posts
-- (HubComposer.jsx) and story videos (StoriesRow.jsx → stories.js, which
-- also writes to `uploads`). Both are fully wired UI with their own
-- error toasts, so the failure surfaced to users as a generic "couldn't
-- post" rather than anything diagnosable.
--
-- ── About the size limit: deliberately NOT raised ────────────────────
--
-- The client used to reject videos over 100 MB and the UI advertised
-- "up to 100 MB". That number could never have worked. Supabase enforces
-- a GLOBAL file size limit above every bucket, and on the Free plan it
-- cannot exceed 50 MB (docs: guides/storage/uploads/file-limits). This
-- project is on Free, and the bucket already sits at exactly 50 MB.
--
-- So the fix went the other way: the client and all four pieces of copy
-- now say 50 MB, and file_size_limit is left alone. Raising it here
-- would be rejected by the global cap, or worse, accepted and then still
-- enforced at 50 MB — reintroducing the same silent failure one level
-- down. On a move to Pro, raise the global limit first, then the bucket,
-- then VIDEO_MAX_BYTES and the copy.
--
-- ── Note on the still-image types ────────────────────────────────────
--
-- image/heif and image/avif are added because SAFE_MIMES already accepts
-- them, so the client can pin either as a contentType. In practice they
-- are rare: compressImage re-encodes to JPEG, and only skips that for
-- files under 64 KB or when canvas decoding fails. Worth knowing that
-- HEIC/HEIF do not render in Chrome or on Android — an iPhone still that
-- slips through uncompressed will upload fine and then show broken for
-- some viewers. That predates this migration (image/heic was already
-- allowed) and is tracked separately; this only stops the two formats
-- the client can emit from being rejected inconsistently with heic.
--
-- Idempotent: sets an absolute value, so re-running changes nothing.

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
         'image/jpeg',
         'image/png',
         'image/webp',
         'image/gif',
         'image/heic',
         'image/heif',
         'image/avif',
         'video/mp4',
         'video/quicktime',
         'video/webm'
       ]
 WHERE id = 'uploads';

-- Confirms what the bucket ended up with. Expect one row, 10 mime types,
-- and file_size_limit still 52428800.
SELECT id, public, file_size_limit, allowed_mime_types
  FROM storage.buckets
 WHERE id = 'uploads';
