-- Migration 008: Supabase Storage bucket for user uploads (avatars, meal photos, etc.)
-- Run this in the Supabase SQL Editor.

-- Create the public uploads bucket (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads',
  'uploads',
  true,
  5242880,   -- 5 MB max per file
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic'];

-- Allow authenticated users to upload their own files
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'uploads: authenticated users can upload'
  ) THEN
    CREATE POLICY "uploads: authenticated users can upload"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'uploads'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;

-- Allow users to update/delete their own files
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'uploads: users can update own files'
  ) THEN
    CREATE POLICY "uploads: users can update own files"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'uploads'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'uploads: users can delete own files'
  ) THEN
    CREATE POLICY "uploads: users can delete own files"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'uploads'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;

-- Public read access (bucket is already public but explicit policy is cleaner)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'uploads: public read'
  ) THEN
    CREATE POLICY "uploads: public read"
      ON storage.objects FOR SELECT
      TO public
      USING (bucket_id = 'uploads');
  END IF;
END $$;
