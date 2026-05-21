-- 066_audit_fixes_rls_indexes.sql
--
-- Three quick-win fixes surfaced by a security + perf audit:
--
--   1. Tighten roll_call_responses SELECT — was readable by ANY
--      authenticated user, leaking who voted yes/no on every crew's
--      roll-calls to non-members.
--
--   2. Tighten story_views SELECT — was `USING (true)` for all
--      authenticated users, exposing the per-story viewer list to
--      everyone. Now scoped to the story owner + viewer themselves.
--
--   3. Add missing indexes on hub_posts.author_email and
--      hub_comments.author_email. Without these, every profile-page
--      load full-scans the table.
--
-- All idempotent — `DROP POLICY IF EXISTS` + `CREATE POLICY`,
-- `CREATE INDEX IF NOT EXISTS`. Safe to re-run.

-- ── Fix 1: roll_call_responses readable only by crew members ────────────
-- Previously: `USING (auth.uid() IS NOT NULL)` (any logged-in user)
-- Now: must be a member of the crew that owns the message.

DROP POLICY IF EXISTS "roll_call_select" ON public.roll_call_responses;

CREATE POLICY "roll_call_select"
  ON public.roll_call_responses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.crew_messages m
        JOIN public.crew_members  cm ON cm.crew_id = m.crew_id
       WHERE m.id      = roll_call_responses.message_id
         AND cm.user_id = auth.uid()
    )
  );

-- ── Fix 2: story_views readable only by owner or viewer ─────────────────
-- Previously: any authenticated user could read every story_views row,
-- learning who viewed any story. Now scoped so:
--   • The story owner (poster) sees the full viewer list of their own
--     stories — needed for the "seen by X people" badge.
--   • Any viewer sees their own view rows — needed for the seen/unseen
--     ring on stories they've encountered.
-- Nobody else can read story_views rows for stories they neither own
-- nor viewed.

DROP POLICY IF EXISTS "story_views: authenticated can read" ON public.story_views;

CREATE POLICY "story_views: owner or viewer can read"
  ON public.story_views FOR SELECT
  TO authenticated
  USING (
    viewer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.stories s
       WHERE s.id = story_views.story_id
         AND s.user_id = auth.uid()
    )
  );

-- ── Fix 3: missing indexes for hub_posts / hub_comments by author_email ─
-- Both columns are queried frequently:
--   • src/lib/data/hubPosts.js listForProfile / listSquadFeed
--   • src/lib/data/hubComments.js purgeForUser
-- Without these indexes, each profile view triggers a sequential scan.

CREATE INDEX IF NOT EXISTS idx_hub_posts_author_email
  ON public.hub_posts(author_email);

CREATE INDEX IF NOT EXISTS idx_hub_comments_author_email
  ON public.hub_comments(author_email);

NOTIFY pgrst, 'reload schema';
