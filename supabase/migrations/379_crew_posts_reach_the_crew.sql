-- 379_crew_posts_reach_the_crew.sql
--
-- A crew-only post was readable by nobody, including the crew.
--
-- The composer has offered a "Crew" privacy since crews shipped, and sends
-- `crew_id: selectedCrewId` on all three of its create() paths. `hub_posts`
-- has never had a `crew_id` column. `makeEntity().create` in src/api/db.js
-- catches PostgREST's PGRST204 for an unknown column, strips the key and
-- retries — by design, so the client can run ahead of an unapplied migration
-- — so the insert SUCCEEDED and the scoping was discarded with no error
-- anywhere. The row landed with `privacy = 'crew'` and no crew.
--
-- The read policy then admits a row when you are its author, or when it is
-- published and unblocked and the privacy is 'public', or 'followers' and you
-- follow. 'crew' matched no branch, so the only person who could read a crew
-- post was the person who wrote it. Not a leak — a black hole. One such row
-- is in production (2026-05-25, body "hi").
--
-- WHOSE MEMBERSHIP DECIDES
-- ───────────────────────
-- The new branch asks whether the VIEWER is in `crew_id`. It never asks
-- anything about the author. That is a deliberate product decision (kegan,
-- 2026-08-22): a crew post stays visible to the crew after its author leaves
-- the crew. The post belongs to the audience it was addressed to, not to the
-- author's current membership.
--
-- WHY A TRIGGER FOR THE WRITE SIDE
-- ────────────────────────────────
-- `hub_posts: owner write` is a FOR ALL policy whose WITH CHECK pins
-- created_by and user_id to the caller and says nothing about which crew a
-- post claims. Adding the crew condition there means restating that whole
-- expression, and CLAUDE.md's rule is to avoid restating a policy expression
-- when a trigger will do — the same call migration 264 made. So the crew check
-- is a BEFORE INSERT OR UPDATE OF crew_id guard, additive and leaving the
-- existing policy untouched.
--
-- The guard is STRICT about a missing session: with no JWT, auth.uid() is NULL,
-- is_crew_member returns false and the insert is refused. That is deliberate,
-- and it is worth knowing before writing a cron job that posts to a crew — it
-- would have to set a session or go through a SECURITY DEFINER function called
-- BY a member. No server-side writer sets crew_id today. (Found while
-- verifying: seeding a crew post as `postgres` raised 42501 until the seed was
-- moved above the CREATE TRIGGER.)
--
-- `is_crew_member(uuid)` already exists, is SECURITY DEFINER, derives the
-- viewer from auth.uid(), and is granted to authenticated — so it is legal in
-- both an RLS policy and a SECURITY INVOKER trigger. It is a plain
-- `SELECT EXISTS`, so it returns false for a NULL uid rather than raising; a
-- permissive policy that RAISES takes the whole statement with it, which is
-- the trap migration 357 documents.

BEGIN;

-- ── 1. The column the client has been sending all along ──────────────────
--
-- ON DELETE SET NULL, not CASCADE: deleting a crew must never delete a
-- member's posts. A post whose crew is gone falls back to author-only, which
-- is the honest reading once the audience no longer exists. In practice the
-- only crew DELETE in the app is the rollback path for a crew whose first
-- member insert failed, which by definition has no posts.
ALTER TABLE public.hub_posts
  ADD COLUMN IF NOT EXISTS crew_id UUID REFERENCES public.crews(id) ON DELETE SET NULL;

-- Partial: crew posts are a small minority of the table and the feed reads
-- them newest-first for a set of crew ids.
CREATE INDEX IF NOT EXISTS hub_posts_crew_id_created_idx
  ON public.hub_posts (crew_id, created_date DESC)
  WHERE crew_id IS NOT NULL;

-- ── 2. The read branch ───────────────────────────────────────────────────
--
-- This is the INSTALLED expression read back with pg_get_expr, plus one
-- disjunct. The crew branch sits INSIDE the third group, so a crew post is
-- still subject to the scheduled-post embargo and to blocking, exactly as a
-- public or followers-only post is. The `( SELECT ... )` wrappers are kept
-- because they make Postgres evaluate those calls once per query rather than
-- once per row.
DROP POLICY IF EXISTS "hub_posts: privacy and blocking read" ON public.hub_posts;

CREATE POLICY "hub_posts: privacy and blocking read"
  ON public.hub_posts
  FOR SELECT
  TO authenticated
  USING (
    author_email = (SELECT NULLIF(public.current_user_email(), ''::text))
    OR user_id = (SELECT auth.uid())
    OR (
      (publish_at IS NULL OR publish_at <= now())
      AND NOT public.viewer_is_blocked_by(author_email)
      AND (
        privacy = 'public'::text
        OR (
          privacy = 'followers'::text
          AND (SELECT NULLIF(public.current_user_email(), ''::text)) IS NOT NULL
          AND public.viewer_follows(author_email)
        )
        OR (
          privacy = 'crew'::text
          AND crew_id IS NOT NULL
          AND public.is_crew_member(crew_id)
        )
      )
    )
  );

-- ── 3. You cannot address a post to a crew you are not in ────────────────
CREATE OR REPLACE FUNCTION public.hub_posts_guard_crew()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $fn$
BEGIN
  -- Only a claimed crew is checked. A NULL crew_id is every other post in the
  -- table and must stay free, including server-side writes with no session.
  IF NEW.crew_id IS NOT NULL AND NOT public.is_crew_member(NEW.crew_id) THEN
    RAISE EXCEPTION 'not_a_member_of_that_crew' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS hub_posts_guard_crew ON public.hub_posts;

-- `UPDATE OF crew_id` is the gate on the UPDATE half: the function is not
-- consulted when a post's body or counters change, only when the claimed crew
-- does. The column list is ignored for INSERT, which fires on every row.
CREATE TRIGGER hub_posts_guard_crew
  BEFORE INSERT OR UPDATE OF crew_id ON public.hub_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.hub_posts_guard_crew();

-- The client discovers the new column through PostgREST's schema cache, and
-- until this reload it keeps stripping `crew_id` and retrying exactly as it
-- has been doing.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Proof it ran ─────────────────────────────────────────────────────────
-- The SQL editor hides RAISE NOTICE, so this bundle ends in a SELECT.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'hub_posts'
       AND column_name = 'crew_id')                                    AS crew_id_column,
  (SELECT count(*) FROM pg_policy
     WHERE polrelid = 'public.hub_posts'::regclass
       AND polname = 'hub_posts: privacy and blocking read'
       AND pg_get_expr(polqual, polrelid) LIKE '%is_crew_member%')     AS read_branch,
  (SELECT count(*) FROM pg_trigger
     WHERE tgrelid = 'public.hub_posts'::regclass
       AND tgname = 'hub_posts_guard_crew')                            AS write_guard,
  (SELECT count(*) FROM pg_index
     WHERE indrelid = 'public.hub_posts'::regclass
       AND indexrelid = 'public.hub_posts_crew_id_created_idx'::regclass) AS crew_index;
-- Every column should read 1.
