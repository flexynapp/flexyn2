-- 140_gym_about_fields.sql
--
-- "About" surface for a gym: weekly hours, amenity list, and a small
-- photo gallery beyond the single cover image.
--
-- All three are stored as JSON / arrays on gym_businesses so we don't
-- need separate tables — each gym has at most ~20 amenities and ~10
-- gallery photos in practice. Owner-only writes via the existing
-- "gym_businesses: owner update" RLS policy from mig 135; no new
-- policies needed.
--
-- Shapes:
--   hours      JSONB  — { mon: { open, close }, tue: { ... }, ... }
--                       Day keys: mon, tue, wed, thu, fri, sat, sun
--                       Times: "06:00" / "22:00" 24h strings (or null
--                       for "closed"). `{}` = "hours not set yet."
--   amenities  TEXT[] — slugs from a controlled vocabulary in the UI:
--                       parking, showers, sauna, lockers, cardio_zone,
--                       free_weights, classes, personal_training, etc.
--   photo_urls TEXT[] — public URLs in the avatars bucket. Cap 10 in
--                       the client; nothing to enforce server-side
--                       until that becomes a problem.

ALTER TABLE public.gym_businesses
  ADD COLUMN IF NOT EXISTS hours      JSONB    NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS amenities  TEXT[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[]   NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
