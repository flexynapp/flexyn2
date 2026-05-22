-- 105_post_content_warnings.sql
--
-- Add content-warning ("CW") support to hub_posts. Pattern borrowed
-- from Twitter/Reddit/Mastodon: poster opts to flag their content;
-- viewer sees a blurred placeholder with "Tap to reveal — graphic
-- injury content" until they explicitly opt in.
--
-- Fitness apps need this more than most — torn-pec photos, surgery
-- recoveries, weight-loss before/after, etc. don't need to ambush
-- every scroll.
--
-- Schema:
--   content_warning       TEXT  — one of: 'graphic_injury' | 'sensitive'
--                                  | 'spoiler' | 'other' | NULL
--   content_warning_label TEXT  — used only when type='other'; freeform
--                                  text the poster supplied (≤ 60 chars)
--
-- Idempotent — ADD COLUMN IF NOT EXISTS + CHECK guarded with the
-- DO-block pattern used elsewhere in this repo for adding constraints
-- without a "constraint already exists" failure on retry.

ALTER TABLE public.hub_posts
  ADD COLUMN IF NOT EXISTS content_warning       TEXT,
  ADD COLUMN IF NOT EXISTS content_warning_label TEXT;

-- Enforce the allowed values for content_warning. Wrapped in a DO
-- block so a second apply doesn't fail with "constraint already exists".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'hub_posts_content_warning_check'
  ) THEN
    ALTER TABLE public.hub_posts
      ADD CONSTRAINT hub_posts_content_warning_check
      CHECK (content_warning IS NULL
             OR content_warning IN ('graphic_injury', 'sensitive', 'spoiler', 'other'));
  END IF;
END $$;

-- Cap the custom label length. Long labels would blow out the card
-- design and there's no scenario where a freeform CW > 60 chars
-- belongs as a one-line dismissable banner.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'hub_posts_content_warning_label_check'
  ) THEN
    ALTER TABLE public.hub_posts
      ADD CONSTRAINT hub_posts_content_warning_label_check
      CHECK (content_warning_label IS NULL OR length(content_warning_label) <= 60);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
