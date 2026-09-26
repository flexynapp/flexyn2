-- 260_dashboard_layout.sql
--
-- Makes the "Customize home" layout follow the user instead of the device.
--
-- Flexyn had two dashboard customization systems and only one of them
-- synced:
--
--   • DashboardWidgets (the widget library) wrote through to
--     user_profiles.dashboard_widgets — cross-device, fine.
--   • Dashboard.jsx's own edit mode — hidden sections, widget order and
--     per-section layout — wrote ONLY to localStorage:
--         flexyn.dashHiddenSections.<uid>
--         flexyn.dashWidgetOrder.<uid>
--         flexyn.dashSectionLayouts.<uid>
--
-- Nothing persisted the second set anywhere else; there was no column for
-- it. Dashboard.jsx:1437 already carries a comment about a button removed
-- for being "per-device", so this had been noticed once before.
--
-- For a mobile-only PWA shipping to both app stores that means a user who
-- reinstalls, switches phone, or has iOS evict site storage loses their
-- whole home layout with no warning and no way to recover it.
--
-- One jsonb blob rather than three columns: the three keys are always read
-- and written together as a unit, they're small, and keeping them in one
-- value means a future fourth facet doesn't need another migration.
--
-- Shape:
--   {
--     "hiddenSections": ["friends", "chest"],
--     "widgetOrder":    ["league", "quests", ...],
--     "sectionLayouts": { "<sectionId>": "half" | "full", ... },
--     "v": 1
--   }
--
-- No default. NULL means "this user has never customized", which the
-- client distinguishes from an explicit empty layout — a user who hides
-- every section must not have that read as "no preference" and reset to
-- defaults on their next device.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS dashboard_layout JSONB;

COMMENT ON COLUMN public.user_profiles.dashboard_layout IS
  'Customize-home state: hiddenSections, widgetOrder, sectionLayouts. NULL = never customized. Written by Dashboard.jsx via db.auth.updateMe.';

-- RLS: user_profiles already restricts rows to their owner for update, so
-- this column inherits the existing policies and needs none of its own.
-- Verified before shipping that the self-update policy is column-agnostic
-- (no column list), so no policy edit is required.

NOTIFY pgrst, 'reload schema';
