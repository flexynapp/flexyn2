-- ============================================================
-- Migration 007 — Content reports & bug reports
-- Creates:
--   hub_reports   — user reports on posts and comments
--   bug_reports   — in-app bug/feedback submissions
-- ============================================================

-- ── hub_reports ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_reports (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_email       text        NOT NULL,
  reporter_user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_type        text        NOT NULL CHECK (reported_type IN ('post', 'comment')),
  reported_id          uuid        NOT NULL,
  reported_author_email text,
  reason               text        NOT NULL CHECK (reason IN (
                         'harassment', 'hate_speech', 'spam',
                         'inappropriate', 'impersonation', 'other')),
  detail               text,
  status               text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Index for admin review queue (pending by date)
CREATE INDEX IF NOT EXISTS hub_reports_status_created
  ON public.hub_reports (status, created_at DESC);

-- Index to quickly check if a user already reported a specific piece of content
CREATE INDEX IF NOT EXISTS hub_reports_reporter_content
  ON public.hub_reports (reporter_email, reported_type, reported_id);

-- ── bug_reports ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bug_reports (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_email   text,
  reporter_user_id uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  description      text        NOT NULL,
  page_context     text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Row-Level Security ─────────────────────────────────────────────────────────
ALTER TABLE public.hub_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

-- Authenticated users may INSERT their own reports (reporter_user_id = their uid).
-- They may SELECT only their own reports (to check if they've already reported).
-- No UPDATE or DELETE — reports are immutable once filed.
CREATE POLICY "hub_reports_insert" ON public.hub_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_user_id = auth.uid());

CREATE POLICY "hub_reports_select_own" ON public.hub_reports
  FOR SELECT TO authenticated
  USING (reporter_user_id = auth.uid());

CREATE POLICY "bug_reports_insert" ON public.bug_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_user_id = auth.uid());

-- ── Permissions ───────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON public.hub_reports TO authenticated;
GRANT SELECT, INSERT ON public.bug_reports TO authenticated;

NOTIFY pgrst, 'reload schema';
