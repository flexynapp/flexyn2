-- 042_security_hardening.sql
--
-- Security audit fixes. Three real exploits closed:
--
-- 1. CRITICAL — increment_user_xp(p_user_id, p_xp)
--    SECURITY DEFINER + accepts arbitrary recipient + no auth.uid()
--    check. Any authenticated user could call
--      supabase.rpc('increment_user_xp', { p_user_id: VICTIM_OR_SELF, p_xp: 999999 })
--    to (a) self-farm unlimited XP, jumping the leaderboard, or
--    (b) sabotage another user's profile by inflating their XP and
--    desynchronizing their level math.
--    FIX: ignore the supplied p_user_id and credit auth.uid()
--    unconditionally. The parameter stays in the signature so existing
--    callers (src/api/db.js _invokeXp) don't 42883, but its value is
--    now ignored — defense in depth.
--
-- 2. MEDIUM — increment_copy_count(p_table, p_id)
--    SECURITY DEFINER, no auth check. Any user (and the GRANT EXECUTE
--    to anon from 006 line 122 made it WORSE) could bump any public
--    regimen / template's copy_count to fake popularity.
--    FIX: require auth.uid() IS NOT NULL. Plus revoke the anon grant
--    that 006 accidentally handed out across-the-board.
--
-- 3. HIGH — content length limits
--    No VARCHAR caps on user-supplied text. Malicious payload of e.g.
--    10 MB in hub_posts.content / hub_messages.body / hub_comments.content
--    causes DB bloat + client OOM when fetching timelines.
--    FIX: add CHECK constraints with reasonable caps. We use CHECK
--    instead of ALTER COLUMN TYPE because the latter rewrites the
--    whole table on a column with existing data; CHECK is online.
--
-- All idempotent; safe to re-run.

-- ── 1. increment_user_xp — force credit to the caller ───────────────────

CREATE OR REPLACE FUNCTION public.increment_user_xp(p_user_id uuid, p_xp integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID    := auth.uid();
  v_total_xp  INTEGER;
  v_level     INTEGER := 1;
  v_cumulative INTEGER := 0;
  v_xp_needed INTEGER;
  v_mult      NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  -- Defensive: ignore the supplied p_user_id (it's now legacy noise).
  -- Some existing callers pass user.id from auth context which is fine;
  -- previously a malicious caller could pass ANY uuid. We always credit
  -- the caller and only the caller.
  -- p_user_id is intentionally unused.

  -- Sanity-cap the XP per call. A single action shouldn't grant more
  -- than 100k XP (the max in xpSystem.js is currently 100 from a
  -- workout milestone). 100k is generous headroom while still blocking
  -- the "increment by 9999999" exploit.
  IF p_xp IS NULL OR p_xp <= 0 THEN
    RETURN;
  END IF;
  IF p_xp > 100000 THEN
    RAISE EXCEPTION 'xp out of range' USING ERRCODE = '22023';
  END IF;

  -- Atomic XP increment — ALWAYS the caller.
  UPDATE public.user_profiles
    SET total_xp   = COALESCE(total_xp, 0) + p_xp,
        updated_at = now()
    WHERE id = v_uid
    RETURNING total_xp INTO v_total_xp;

  IF NOT FOUND THEN RETURN; END IF;

  -- Recompute current_level (matches xpSystem.js client logic).
  FOR i IN 1..99 LOOP
    IF i <= 10 THEN v_mult := 1.10;
    ELSIF i <= 30 THEN v_mult := 1.13;
    ELSIF i <= 60 THEN v_mult := 1.16;
    ELSE                v_mult := 1.20;
    END IF;
    v_xp_needed := FLOOR(250 * POWER(v_mult, i - 1));
    IF v_cumulative + v_xp_needed > v_total_xp THEN
      v_level := i;
      EXIT;
    END IF;
    v_cumulative := v_cumulative + v_xp_needed;
    v_level := i + 1;
  END LOOP;

  UPDATE public.user_profiles
    SET current_level = v_level
    WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_user_xp(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_user_xp(UUID, INTEGER) TO authenticated;

-- ── 2. increment_copy_count — require auth ──────────────────────────────

CREATE OR REPLACE FUNCTION public.increment_copy_count(
  p_table TEXT,
  p_id    UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_table = 'regimens' THEN
    UPDATE public.regimens
       SET copy_count = COALESCE(copy_count, 0) + 1
     WHERE id = p_id;
  ELSIF p_table = 'workout_templates' THEN
    UPDATE public.workout_templates
       SET copy_count = COALESCE(copy_count, 0) + 1
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'unknown table' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_copy_count(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_copy_count(TEXT, UUID) TO authenticated;

-- ── 3. Content length CHECK constraints ─────────────────────────────────
--
-- Sizes chosen to be generous for legitimate usage but small enough that
-- a malicious payload can't blow the DB or client. Conservative caps:
--   • post / regimen description     5000 chars (~4-5 paragraphs)
--   • message body                   4000 chars (longer than SMS but bounded)
--   • comment / quest description    2000 chars
--   • short text (username/handle)    64 chars
--   • bio                             500 chars
--   • title-like                      120 chars

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_posts_content_len') THEN
    ALTER TABLE public.hub_posts
      ADD CONSTRAINT hub_posts_content_len
      CHECK (char_length(COALESCE(content, '')) <= 5000) NOT VALID;
    ALTER TABLE public.hub_posts VALIDATE CONSTRAINT hub_posts_content_len;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_comments_content_len') THEN
    ALTER TABLE public.hub_comments
      ADD CONSTRAINT hub_comments_content_len
      CHECK (char_length(COALESCE(content, '')) <= 2000) NOT VALID;
    ALTER TABLE public.hub_comments VALIDATE CONSTRAINT hub_comments_content_len;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_messages_body_len') THEN
    ALTER TABLE public.hub_messages
      ADD CONSTRAINT hub_messages_body_len
      CHECK (char_length(COALESCE(body, '')) <= 4000) NOT VALID;
    ALTER TABLE public.hub_messages VALIDATE CONSTRAINT hub_messages_body_len;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_username_len') THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_username_len
      CHECK (username IS NULL OR char_length(username) <= 64) NOT VALID;
    ALTER TABLE public.user_profiles VALIDATE CONSTRAINT user_profiles_username_len;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_bio_len') THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_bio_len
      CHECK (bio IS NULL OR char_length(bio) <= 500) NOT VALID;
    ALTER TABLE public.user_profiles VALIDATE CONSTRAINT user_profiles_bio_len;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_full_name_len') THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_full_name_len
      CHECK (full_name IS NULL OR char_length(full_name) <= 120) NOT VALID;
    ALTER TABLE public.user_profiles VALIDATE CONSTRAINT user_profiles_full_name_len;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Bug reports table (created in migration 007 — guard against missing).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'bug_reports') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bug_reports_body_len') THEN
      ALTER TABLE public.bug_reports
        ADD CONSTRAINT bug_reports_body_len
        CHECK (char_length(COALESCE(description, '')) <= 5000) NOT VALID;
      ALTER TABLE public.bug_reports VALIDATE CONSTRAINT bug_reports_body_len;
    END IF;
  END IF;
EXCEPTION WHEN undefined_column THEN
  -- bug_reports may use a different body column name on older deploys;
  -- skip silently if the schema doesn't match what we expect.
  NULL;
END $$;

-- ── 4. Logout-time push subscription cleanup ────────────────────────────
--
-- RLS already lets a user DELETE their own rows (migration 033 has
-- "push: delete own"). The client just wasn't calling it on logout.
-- The client-side fix lives in src/lib/AuthContext.jsx + ProfileMenu.jsx
-- (committed alongside this migration). Here we just ensure the index
-- exists for fast user_id lookups during the delete.

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id_only
  ON public.push_subscriptions(user_id);

NOTIFY pgrst, 'reload schema';
