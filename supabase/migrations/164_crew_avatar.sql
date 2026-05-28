-- 164_crew_avatar.sql
-- Adds a crew-level avatar so crews can have a profile photo instead of
-- always showing the Shield fallback icon.  Only crew leaders can update
-- it (enforced by the existing crews_update RLS policy).

ALTER TABLE public.crews
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;
