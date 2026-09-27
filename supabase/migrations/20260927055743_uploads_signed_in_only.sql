-- Signed-out callers can no longer write to the public `uploads` bucket.
--
-- The INSERT policy was `TO anon, authenticated` with
-- `auth.uid() IS NULL OR foldername(name)[1] = auth.uid()`. The first branch
-- let anyone holding the public anon key (it ships in every copy of the app)
-- upload any allowed file, up to 50 MB, to any path in a PUBLIC bucket: free
-- hosting on our storage bill, served from our domain. The baseline copied it
-- as production had it and flagged it for this fix.
--
-- Nothing legitimate used that branch. Every writer in the app is signed in
-- (a guest is `signInAnonymously()`, which is the `authenticated` role with a
-- real uid) and names its path `<auth.uid()>/...`: `_uploadFile` in
-- src/api/db.js throws without a user, and the direct writers in journal.js,
-- stories.js, gymBusinesses.js and GymEdit.jsx all prefix `user.id`.
-- Measured in production before this change: 19 objects in the bucket,
-- 0 without an owner, 0 whose first folder differs from the owner.
--
-- ALTER POLICY keeps the policy's name and changes only its roles and check.

ALTER POLICY "uploads: authenticated users can upload" ON storage.objects
  TO authenticated
  WITH CHECK (bucket_id = 'uploads'
              AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- Attempt the writes, in both directions, and roll every one back.
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_ok  boolean;
BEGIN
  -- Signed out: refused.
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    INSERT INTO storage.objects (bucket_id, name) VALUES ('uploads', 'probe/anon.png');
    v_ok := true;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    v_ok := false;
  END;
  IF v_ok THEN RAISE EXCEPTION 'uploads: a signed-out insert was accepted'; END IF;

  -- Signed in, someone else's folder: refused.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    INSERT INTO storage.objects (bucket_id, name)
      VALUES ('uploads', gen_random_uuid()::text || '/other.png');
    v_ok := true;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    v_ok := false;
  END;
  IF v_ok THEN RAISE EXCEPTION 'uploads: an insert into another user''s folder was accepted'; END IF;

  -- Signed in, own folder: still accepted. Raise to roll the row back.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    INSERT INTO storage.objects (bucket_id, name)
      VALUES ('uploads', v_uid::text || '/own.png');
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'probe_rollback';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE EXCEPTION 'uploads: a signed-in insert into the caller''s own folder was refused';
    WHEN raise_exception THEN
      NULL;
  END;

  PERFORM set_config('request.jwt.claims', '', true);
END $$;
