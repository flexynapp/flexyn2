-- 196_dashboard_widgets_column.sql
--
-- Cross-device persistence for the dashboard Widget Library layout.
-- Previously the active/ordered widget list lived only in localStorage
-- (flexyn.dashboardWidgets.<userId>), so a user's customized dashboard
-- did not follow them to another device. This adds the server-side
-- source of truth; the client keeps localStorage as an offline/first-
-- paint cache and writes through to this column via auth.updateMe.
--
-- Shape: a JSON array of widget-id strings in display order, e.g.
--   ["stats-slideshow", "workout-streak", "top-exercises"]
-- NULL = "never customized" (client falls back to its local cache, then
-- migrates that up on first load).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS dashboard_widgets JSONB;
