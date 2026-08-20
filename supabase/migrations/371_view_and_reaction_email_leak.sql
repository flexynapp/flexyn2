-- Migration 371: hub_post_views and story_reactions leaked every user's email
--
-- Two tables shipped with `FOR SELECT USING (TRUE)` and a table-level SELECT
-- grant to `authenticated`. Both carry a denormalised email column, so both
-- were a complete directory of the user base to anyone holding any signed-in
-- token — and `SignInToContinue` offers one-tap anonymous sign-in, so getting
-- that token costs nothing.
--
--   GET /rest/v1/hub_post_views?select=viewer_email     -> every user's email
--   GET /rest/v1/story_reactions?select=user_email      -> every user's email
--
-- hub_post_views is the worse of the two. HubPostCard records a row for every
-- post scrolled past (IntersectionObserver, 2s dwell), so beyond the email
-- directory it is a full who-read-whose-post graph: who is reading whom, how
-- often, and at what hour. That is a social graph the product never exposes
-- anywhere in its UI.
--
-- This is the same class migrations 195, 207, 220 and 283 closed elsewhere
-- (email off public surfaces), and the same shape migration 292 fixed on
-- hub_reactions. It is fixed the same way here.
--
-- ── Why the replacement policies are sufficient, not a trade-off ───────────
--
-- Checked every consumer before narrowing anything.
--
-- hub_post_views — src/lib/data/hubPostViews.js is the only client module:
--   • recordView()  INSERTs. Unaffected: the INSERT policy and grant stay.
--   • getViewCount() and getAnalytics() both issue
--       .select('id', { count: 'exact', head: true }).eq('post_id', …)
--     They count rows. They never read viewer_email, and they never read a
--     row's contents at all — `head: true` returns no body.
--   • The only surface is CreatorAnalyticsPanel, mounted at HubPostCard.jsx
--     behind `analyticsOpen && isMine` — an author looking at their OWN post.
--   So "author of the post, or your own row" keeps every real read working
--   and the counts cannot regress.
--
-- story_reactions — src/lib/data/storyReactions.js is the only client module:
--   • reactToStory() writes; getMyReactionForStory() reads with
--     .eq('user_id', <self>) — the caller's own row.
--   • listReactionsForStory() is the one function that selects user_email,
--     and it is DEAD: zero call sites in src/. StoryReactionPicker imports
--     only ALLOWED_EMOJIS, reactToStory and getMyReactionForStory.
--   • No surface displays who reacted to a story.
--   So own-row read is sufficient, exactly as it was for hub_reactions in 292.
--
-- ── Column privileges, because RLS is row-level ────────────────────────────
--
-- Narrowing the rows still leaves a post's author able to read the email of
-- every account that viewed their post. On an app that spent four migrations
-- taking email off public surfaces, that residual is not worth keeping for a
-- column no client code reads. RLS cannot express "these rows but not this
-- column" — that needs a GRANT — so the table-level SELECT is revoked and
-- re-granted per column. Order is load-bearing: a column GRANT does not
-- override a table-level GRANT, so the REVOKE must come first.
--
-- Guests: identity goes through public.current_user_email() (migration 241),
-- never auth.email(), which is NULL for anonymous tokens. Guests carry a
-- guest_<uuid>@flexyn.guest placeholder in user_profiles and must keep
-- working — they are the accounts most likely to be scrolling the feed.
--
-- Paste-safety: no alias.column or record.field tokens anywhere below, per
-- the repo rule — correlation is done with `IN (SELECT …)` over a fully
-- qualified table rather than an aliased EXISTS.
--
-- Idempotent: DROP POLICY IF EXISTS before every CREATE.

-- TYPE CAST, learned by running it: the first attempt raised
--   42883 operator does not exist: text = uuid
-- `hub_post_views.post_id` is TEXT (migration 111 defines the whole table with
-- TEXT ids, `gen_random_uuid()::text`), while `hub_posts` predates the
-- migrations entirely — it is a base44-era table with no CREATE TABLE in this
-- repo — and its `id` is UUID. Comparing the two without a cast is a planning
-- error, so the policy never installed and the leak stayed open.
--
-- Both sides are cast to text rather than casting post_id to uuid: uuid->text
-- always succeeds, while text->uuid raises 22P02 on any row whose post_id is
-- not a valid uuid, which would turn a policy into a runtime error on read.
-- `user_id` is cast for the same reason — the same repo offers no definition
-- for its type either, and the cast is free if it was already uuid.
--
-- ── hub_post_views ────────────────────────────────────────────────────────

REVOKE SELECT ON public.hub_post_views FROM anon;

DROP POLICY IF EXISTS "hub_post_views_select" ON public.hub_post_views;
DROP POLICY IF EXISTS "hub_post_views: author or self read" ON public.hub_post_views;

CREATE POLICY "hub_post_views: author or self read" ON public.hub_post_views
  FOR SELECT TO authenticated
  USING (
    viewer_email = (SELECT NULLIF(public.current_user_email(), ''))
    OR post_id IN (
      SELECT id::text FROM public.hub_posts
      WHERE author_email = (SELECT NULLIF(public.current_user_email(), ''))
         OR user_id::text = (SELECT auth.uid())::text
    )
  );

-- Revoke first, then re-grant the readable columns. viewer_email is
-- deliberately absent: nothing in the client selects it.
REVOKE SELECT ON public.hub_post_views FROM authenticated;
GRANT  SELECT (id, post_id, viewed_at) ON public.hub_post_views TO authenticated;

-- ── story_reactions ───────────────────────────────────────────────────────

REVOKE SELECT ON public.story_reactions FROM anon;

DROP POLICY IF EXISTS "story_reactions: read all" ON public.story_reactions;
DROP POLICY IF EXISTS "story_reactions: own read" ON public.story_reactions;

-- The existing "story_reactions: own write" policy is cmd ALL and already
-- covers SELECT. An explicit read policy is added anyway for the reason
-- migration 292 gives: a policy NAMED "write" is one narrowing away from
-- silently killing every reaction lookup.
CREATE POLICY "story_reactions: own read" ON public.story_reactions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';

-- ── Verification — these two SELECTs are the proof the bundle ran ─────────
-- The Supabase SQL editor hides RAISE NOTICE, so the bundle ends in output.

-- 1. No SELECT policy on either table may still be `true`.
--    Expected: the two rows below, both scoped, and nothing with qual = true.
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('hub_post_views', 'story_reactions')
  AND cmd = 'SELECT'
ORDER BY tablename, policyname;

-- 2. Neither email column may be readable by `authenticated`.
--    Expected: both `readable` values false.
-- Only hub_post_views has its email column revoked, so only it is checked that
-- way. story_reactions keeps the column grant on purpose: its row policy limits
-- you to your OWN reaction, so the only user_email you can reach is your own.
-- Asserting has_column_privilege there would read `true` forever and prove
-- nothing — a check that cannot fail is worse than no check, because it reads
-- like coverage.
SELECT 'hub_post_views.viewer_email readable by authenticated' AS check_name,
       has_column_privilege('authenticated', 'public.hub_post_views', 'viewer_email', 'SELECT') AS value,
       'must be false' AS expected
UNION ALL
SELECT 'story_reactions rows visible beyond your own',
       EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'story_reactions'
                  AND cmd = 'SELECT' AND qual = 'true'),
       'must be false';
