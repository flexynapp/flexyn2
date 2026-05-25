-- 144_bug_report_admin_pipeline.sql
--
-- Re-pipes the bug-report flow so admin-filed user bug reports actually
-- reach the moderator queue.
--
-- THE BUG: `bug_reports` rows (filed from Settings → Report a bug) had
-- no admin read-path. The AdminReports queue only calls
-- `list_reports_for_admin` (mig 103), which reads `hub_reports`
-- (content reports) exclusively. Bug reports were written and then
-- effectively orphaned — invisible to admins, un-actionable.
--
-- THE FIX:
--   1. Add a `status` column to bug_reports so they can be triaged like
--      content reports (pending → reviewed / dismissed).
--   2. `list_bug_reports_for_admin(status, limit)` — admin-gated reader
--      (SECURITY DEFINER, bypasses RLS like the content-report reader).
--   3. `resolve_bug_report(id, status)` — admin-gated status transition.
--
-- Idempotent throughout. Mirrors the mig-103 moderator-RPC pattern.

-- ── 1. Status column for triage ────────────────────────────────────
ALTER TABLE public.bug_reports
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- Guard the allowed values (idempotent add).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bug_reports_status_check'
  ) THEN
    ALTER TABLE public.bug_reports
      ADD CONSTRAINT bug_reports_status_check
      CHECK (status IN ('pending', 'reviewed', 'dismissed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bug_reports_status_idx
  ON public.bug_reports (status, created_at DESC);

-- ── 2. Admin reader ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_bug_reports_for_admin(
  p_status TEXT DEFAULT 'pending',
  p_limit  INT  DEFAULT 50
)
RETURNS TABLE (
  id               UUID,
  reporter_email   TEXT,
  reporter_user_id UUID,
  description      TEXT,
  page_context     TEXT,
  status           TEXT,
  created_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT b.id, b.reporter_email, b.reporter_user_id, b.description,
           b.page_context, b.status, b.created_at
      FROM public.bug_reports b
     WHERE b.status = p_status
     ORDER BY b.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.list_bug_reports_for_admin(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_bug_reports_for_admin(TEXT, INT) TO authenticated;

-- ── 3. Admin status transition ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_bug_report(
  p_report_id UUID,
  p_status    TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('pending', 'reviewed', 'dismissed') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.bug_reports SET status = p_status WHERE id = p_report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_bug_report(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_bug_report(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
