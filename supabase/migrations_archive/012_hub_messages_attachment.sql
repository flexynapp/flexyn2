-- 012_hub_messages_attachment.sql
-- Run in Supabase SQL Editor.
--
-- Adds an optional attachment_url column to hub_messages so users can share
-- images in direct messages. The upload itself is handled by the existing
-- `uploads` Supabase Storage bucket (public, 5 MB, images only).

ALTER TABLE public.hub_messages
  ADD COLUMN IF NOT EXISTS attachment_url TEXT;
