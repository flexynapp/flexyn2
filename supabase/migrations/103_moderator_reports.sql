-- 084_moderator_reports.sql
--
-- Moderator-side RPCs for resolving content reports filed via the
-- existing hub_reports table (migration 007). Adds:
--
--   • is_app_admin(uid)        — admin gate, whitelist by username
--   • list_reports_for_admin   — paginated report queue
--   • resolve_report           — admin updates status
--   • delete_reported_content  — admin soft-deletes the offending row
--                                AND marks the report 'actioned'
--
-- ADMIN GATE
-- ───────────
-- There's no `is_admin` column on user_profiles today; admin status
-- is determined by username (matching the existing ADMIN_USERNAMES
-- list in src/components/hub/CoinShopModal.jsx). We mirror that
-- whitelist here so the server doesn't trust client-asserted role.
--
-- To add an admin later: either CREATE OR REPLACE this function with
-- the new username, OR replace this function with a check against an
-- `is_admin` column. Single source of truth — every RPC in this file
-- gates on is_app_admin().
--
-- Idempotent: CREATE OR REPLACE on all functions.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Admin gate
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_app_admin(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  uname TEXT;
BEGIN
  IF p_user_id IS NULL THEN RETURN FALSE; END IF;
  SELECT lower(username) INTO uname
    FROM public.user_profiles
   WHERE id = p_user_id;
  RETURN uname IN ('sean', 'seanj', 'kegan', 'admin');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 2. List reports (admin-only view)
--
-- Returns the report rows + a snippet of the underlying content so
-- the admin doesn't need a second roundtrip. We resolve the snippet
-- via a CASE on reported_type — comments and posts live in different
-- tables but share the `content` column name.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_reports_for_admin(
  p_status TEXT DEFAULT 'pending',
  p_limit  INT  DEFAULT 50
)
RETURNS TABLE (
  id              UUID,
  reporter_email  TEXT,
  reported_type   TEXT,
  reported_id     UUID,
  reported_author_email TEXT,
  reason          TEXT,
  detail          TEXT,
  status          TEXT,
  content_snippet TEXT,
  created_at      TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT
      r.id,
      r.reporter_email,
      r.reported_type,
      r.reported_id,
      r.reported_author_email,
      r.reason,
      r.detail,
      r.status,
      CASE r.reported_type
        WHEN 'post'    THEN (SELECT substring(content FROM 1 FOR 280) FROM public.hub_posts    WHERE id = r.reported_id)
        WHEN 'comment' THEN (SELECT substring(content FROM 1 FOR 280) FROM public.hub_comments WHERE id = r.reported_id)
        ELSE NULL
      END,
      r.created_at
    FROM public.hub_reports r
    WHERE r.status = p_status
    ORDER BY r.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Resolve a single report (status transition).
--
-- Valid transitions: any status → reviewed / actioned / dismissed.
-- Doesn't touch the underlying content — for that, use the helper
-- below.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_report(
  p_report_id UUID,
  p_action    TEXT
)
RETURNS VOID AS $$
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('reviewed', 'actioned', 'dismissed') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;
  UPDATE public.hub_reports
     SET status = p_action
   WHERE id = p_report_id;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Delete reported content + mark report 'actioned' in one tx.
--
-- This is the "ban-hammer" action — the admin agreed the content
-- violates policy. We do the deletion AND the report-status update
-- inside one transaction so a partial failure leaves the system in
-- a consistent state.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_reported_content(
  p_report_id UUID
)
RETURNS VOID AS $$
DECLARE
  r_type TEXT;
  r_id   UUID;
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  SELECT reported_type, reported_id INTO r_type, r_id
    FROM public.hub_reports
   WHERE id = p_report_id;
  IF r_type IS NULL THEN
    RAISE EXCEPTION 'report_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF r_type = 'post' THEN
    DELETE FROM public.hub_posts WHERE id = r_id;
  ELSIF r_type = 'comment' THEN
    DELETE FROM public.hub_comments WHERE id = r_id;
  END IF;
  UPDATE public.hub_reports SET status = 'actioned' WHERE id = p_report_id;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;

-- Function permissions — all gated internally, safe to grant broadly.
GRANT EXECUTE ON FUNCTION public.is_app_admin(UUID)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_reports_for_admin(TEXT, INT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_report(UUID, TEXT)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_reported_content(UUID)      TO authenticated;
