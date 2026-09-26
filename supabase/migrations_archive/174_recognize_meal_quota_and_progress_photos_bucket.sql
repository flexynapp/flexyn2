-- Migration 174: recognize-meal per-user rate limit + private progress-photos bucket
--
-- Two independent ship-readiness fixes (2026-06 audit):
--   • C22 — the recognize-meal Edge Function had no per-user cap, so any
--     authenticated account could loop expensive Claude Vision calls and
--     drain the Anthropic budget. consume_recognize_meal_quota() atomically
--     counts per-user/day calls and returns false once the cap is hit.
--   • C17 — progress photos were base64 in localStorage (silent data loss
--     on iOS quota, cross-user leak, no backup). They move to a PRIVATE
--     Storage bucket served via short-lived signed URLs; only the owning
--     user can read/write their own <uid>/<file> objects.

-- ── recognize-meal daily quota ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recognize_meal_quota (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day        date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  call_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.recognize_meal_quota ENABLE ROW LEVEL SECURITY;

-- Owner may read their own usage (handy for a "X/30 left today" hint).
-- Writes happen only through the SECURITY DEFINER RPC below, never direct.
DROP POLICY IF EXISTS "recognize_meal_quota: owner read" ON public.recognize_meal_quota;
CREATE POLICY "recognize_meal_quota: owner read"
  ON public.recognize_meal_quota FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Atomic check-and-increment. Returns TRUE if the call is allowed (and
-- records it), FALSE once the daily cap is reached. The cap is generous
-- enough for real use, low enough to stop a runaway loop.
CREATE OR REPLACE FUNCTION public.consume_recognize_meal_quota()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cap   constant integer := 30;   -- calls per user per UTC day
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.recognize_meal_quota (user_id, day, call_count)
  VALUES (auth.uid(), (now() AT TIME ZONE 'utc')::date, 1)
  ON CONFLICT (user_id, day)
  DO UPDATE SET call_count = public.recognize_meal_quota.call_count + 1
  RETURNING call_count INTO v_count;

  RETURN v_count <= v_cap;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_recognize_meal_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_recognize_meal_quota() TO authenticated;

-- ── private progress-photos bucket ───────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'progress-photos',
  'progress-photos',
  false,
  10485760,   -- 10 MB max per file
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = 10485760,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

-- Owner-only insert under their own <uid>/ folder.
DROP POLICY IF EXISTS "progress-photos: owner insert" ON storage.objects;
CREATE POLICY "progress-photos: owner insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'progress-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner-only read (no public policy — access is via signed URLs only).
DROP POLICY IF EXISTS "progress-photos: owner read" ON storage.objects;
CREATE POLICY "progress-photos: owner read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'progress-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner-only update.
DROP POLICY IF EXISTS "progress-photos: owner update" ON storage.objects;
CREATE POLICY "progress-photos: owner update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'progress-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner-only delete.
DROP POLICY IF EXISTS "progress-photos: owner delete" ON storage.objects;
CREATE POLICY "progress-photos: owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'progress-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

NOTIFY pgrst, 'reload schema';
