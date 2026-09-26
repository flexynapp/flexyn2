-- Migration 046: Story DMs + rich overlay style
--
-- story_dms_disabled: user can opt out of receiving DM replies on their stories
-- overlay_style:      full JSONB style object { text, xFrac, yFrac, scale,
--                     rotation, color, font } — supersedes plain overlay_text

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS story_dms_disabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS overlay_style JSONB;
