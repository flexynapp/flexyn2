-- 117_privacy_mode.sql
--
-- Two opt-in privacy controls on user_profiles:
--
--   • is_private        — when TRUE, only followers see the profile
--                          page content (level, regimens, workouts,
--                          progress photos). Posts already honor the
--                          existing `privacy` column on hub_posts;
--                          this flag is about the profile surface.
--   • hide_from_search  — when TRUE, the profile is excluded from
--                          user-search results AND PYMK suggestions.
--
-- Both default FALSE so existing accounts stay public.
--
-- The client gates the profile UI on these flags via canViewProfile()
-- + listSearchableUsers() (added in this batch). RLS on user_profiles
-- already restricts column-level writes via 042's owner check; reads
-- remain public so blocked-cache lookups (e.g. for DMs from people
-- you've followed) still work even when the profile page is private.
--
-- Idempotent.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_private       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hide_from_search BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_user_profiles_search_visible
  ON public.user_profiles(hide_from_search)
  WHERE hide_from_search = FALSE;

NOTIFY pgrst, 'reload schema';
