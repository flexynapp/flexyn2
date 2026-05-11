-- 021_loot_theme_id.sql
--
-- Adds the equipped-loot-theme column to user_profiles so a user's currently
-- equipped capsule-drop theme persists server-side and is visible to other
-- users when they navigate to that user's Hub profile (Steam-style profile
-- theming). The viewer's own global theme is unaffected — loot_theme_id only
-- scopes the profile card via <ThemedScope> in src/components/hub/HubProfile.
--
-- Without this column, ThemeContext's `db.auth.updateMe({ loot_theme_id })`
-- call was silently stripped by the unknown-column guard in src/api/db.js,
-- so equipped loot themes only persisted in localStorage and never rendered
-- to other viewers' devices.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS loot_theme_id TEXT;

-- Reload PostgREST so the new column is queryable / writable immediately
-- without needing a Supabase Studio reload.
NOTIFY pgrst, 'reload schema';
