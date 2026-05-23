-- 131_seasonal_shop_items.sql
--
-- Adds availability windows to marketplace_listings so admins can create
-- limited-time or seasonal items that appear / disappear automatically.
--
--   available_from  — NULL means available immediately
--   available_until — NULL means no expiry
--
-- The existing `active` flag stays as the manual on/off switch; these
-- two columns add a time-gated layer on top. The client filter:
--
--   WHERE active = TRUE
--     AND (available_from  IS NULL OR available_from  <= now())
--     AND (available_until IS NULL OR available_until >  now())
--
-- The `listActive` function in marketplace.js already applies this
-- after this migration lands. Existing listings are unaffected
-- (both columns default NULL = always available).

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS available_from  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ;

-- Partial index for the time-window query; speeds up the marketplace
-- browse query once the table grows large.
CREATE INDEX IF NOT EXISTS idx_mktplace_seasonal
  ON public.marketplace_listings (available_from, available_until)
  WHERE status = 'active';

NOTIFY pgrst, 'reload schema';
