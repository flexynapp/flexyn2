-- 049_profile_extensions.sql
-- Adds city, country flag emoji, trophy case slots, and trophy visibility to user profiles.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS city           TEXT,
  ADD COLUMN IF NOT EXISTS country_flag   TEXT    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS trophy_case    JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS trophy_case_visible BOOLEAN NOT NULL DEFAULT TRUE;
