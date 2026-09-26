-- Migration 179: move app-admin authority off a mutable username (C24)
--
-- is_app_admin(p_user_id) returned `lower(username) IN ('sean','seanj',
-- 'kegan','admin')` (mig 103). It gates every moderator RPC
-- (delete_reported_content, resolve_report), gym approval (158), and
-- featured-listing control (122). Because usernames are user-settable and
-- the reserved-name trigger (050) does NOT reserve the operator handles
-- sean/seanj/kegan, anyone who could register or rename to a free one of
-- those handles gained full moderation + content-deletion powers.
--
-- This binds admin authority to an immutable auth.uid() allowlist:
--   1. admin_users table (user_id PK → auth.users).
--   2. Seed it with whoever CURRENTLY holds the operator handles, so the
--      real operators keep access without us hardcoding UUIDs.
--   3. Rewrite is_app_admin to check membership only — no username path.
--   4. Reserve the operator handles by EXACT match (so a freed handle
--      can't be squatted) without the substring blocking that would
--      catch legitimate names like "seanna".
--
-- Paste-safe: public.<table>, bare columns in single-table statements,
-- NEW. in the trigger, no short alias.column tokens.

-- ── 1. allowlist table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- No client policy: the table is readable/writable only by the service
-- role and by SECURITY DEFINER functions (is_app_admin). Authenticated
-- users get NOTHING here — membership must not be self-serviceable.
DROP POLICY IF EXISTS "admin_users: no client access" ON public.admin_users;
CREATE POLICY "admin_users: no client access"
  ON public.admin_users FOR SELECT
  TO authenticated
  USING (false);

-- ── 2. seed from current operator handles ────────────────────────────────────
-- Captures the UUIDs of whoever holds these handles RIGHT NOW (the real
-- operators) and freezes admin to those ids. Idempotent.
INSERT INTO public.admin_users (user_id, note)
SELECT id, 'seeded from operator handle: ' || username
  FROM public.user_profiles
 WHERE lower(username) IN ('sean', 'seanj', 'kegan', 'keganbergeron', 'admin')
ON CONFLICT (user_id) DO NOTHING;

-- ── 3. is_app_admin → table lookup only ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_app_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = p_user_id
  );
$$;

-- ── 4. reserve the operator handles (exact match, no substring blocking) ──────
CREATE OR REPLACE FUNCTION public.enforce_reserved_operator_handles()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.username IS NOT NULL
     AND lower(NEW.username) IN ('sean', 'seanj', 'kegan', 'keganbergeron')
     AND NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = NEW.id)
  THEN
    RAISE EXCEPTION 'username is reserved' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reserved_operator_handles ON public.user_profiles;
CREATE TRIGGER trg_reserved_operator_handles
  BEFORE INSERT OR UPDATE OF username ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_reserved_operator_handles();

NOTIFY pgrst, 'reload schema';
