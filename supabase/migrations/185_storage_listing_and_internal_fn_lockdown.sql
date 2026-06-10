-- Migration 185: stop uploads-bucket enumeration + lock internal trigger helpers
--
-- Two advisor findings (live 2026-06-10), both safe to close:
--
--   • public_bucket_allows_listing on `uploads`: the "uploads: public read"
--     SELECT policy on storage.objects lets any client LIST every file in
--     the bucket (enumerate all users' avatars/meal/post images by path).
--     For a PUBLIC bucket, object URLs are served by the CDN regardless of
--     this policy — getPublicUrl keeps working — so dropping it removes
--     enumeration with no functional loss. Verified the client never calls
--     storage.from('uploads').list() (only getPublicUrl + remove).
--
--   • anon_security_definer_function_executable on the `_`-prefixed trigger
--     helpers: these are AFTER-trigger function bodies, never meant to be
--     called as RPCs, yet anon could invoke them via /rest/v1/rpc/. Triggers
--     fire as the table owner and do NOT consult the EXECUTE grant, so
--     revoking EXECUTE from PUBLIC stops the RPC surface without affecting
--     the triggers. (The remaining ~79 anon-executable SECURITY DEFINER
--     functions need individual review — most legitimately require an
--     authenticated caller and gate on auth.uid(); tracked as a follow-up.)

-- ── uploads bucket: drop the listing policy ──────────────────────────────────
DROP POLICY IF EXISTS "uploads: public read" ON storage.objects;

-- ── internal trigger helpers: remove the RPC surface ─────────────────────────
REVOKE ALL ON FUNCTION public._notify_post_like()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._notify_post_reaction()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._notify_crew_everyone()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._tg_validate_sticker_reaction() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
