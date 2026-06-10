-- Migration 178: enforce post privacy + blocking in RLS (was client-side theater)
--
-- C20 (2026-06 audit): hub_posts read policy was `USING (true)` (mig 001),
-- and the crew-scope policy (mig 065) is permissive so it only ever ORs
-- access wider. Followers-only, crew-private, and not-yet-published
-- scheduled posts were therefore all readable by anyone (any authed user,
-- and anon via the bundled key) over REST — the client privacy filter and
-- block list were cosmetic. hub_comments had the same `USING (true)` read,
-- so a blocked user's comments stayed visible under your posts.
--
-- This replaces those open SELECT policies with restrictive ones that
-- enforce, server-side:
--   • blocking (bidirectional, via is_blocked from mig 106),
--   • privacy = public | followers | crew,
--   • crew membership for crew-scoped posts,
--   • scheduled-post embargo (publish_at in the future hidden from
--     everyone except the author).
-- The author always sees their own rows (including scheduled drafts).
-- Anonymous visitors keep read access to PUBLIC, published, non-crew,
-- non-blocked posts only — preserving the public-profile acquisition
-- surface without leaking private content.
--
-- Column facts (verified): hub_posts(author_email, user_id, privacy
-- default 'public', crew_id, publish_at); hub_follows(follower_email,
-- followee_email); hub_comments(author_email, user_id, post_id).
--
-- Paste-safe per repo convention: full table-name-qualified columns
-- (hub_posts.author_email — a real table name, not a short alias),
-- public.<table>, auth.uid()/auth.email(), no short alias.column or
-- record .id tokens.

-- ── hub_posts ────────────────────────────────────────────────────────────────
-- Drop the open reads (001's public read + 065's permissive crew read).
DROP POLICY IF EXISTS "hub_posts: public read"                    ON public.hub_posts;
DROP POLICY IF EXISTS "Crew posts visible to crew members only"   ON public.hub_posts;
DROP POLICY IF EXISTS "hub_posts: privacy and blocking read"      ON public.hub_posts;

CREATE POLICY "hub_posts: privacy and blocking read"
  ON public.hub_posts FOR SELECT
  TO public
  USING (
    -- Author sees everything they wrote, including future-scheduled drafts.
    hub_posts.author_email = auth.email()
    OR hub_posts.user_id = auth.uid()
    OR (
      -- Everyone else: only published rows, and never from someone in a
      -- block relationship with the viewer.
      (hub_posts.publish_at IS NULL OR hub_posts.publish_at <= now())
      AND NOT public.is_blocked(auth.uid(), hub_posts.author_email)
      AND (
        -- Crew-scoped posts: members only (regardless of privacy field).
        (hub_posts.crew_id IS NOT NULL AND public.is_crew_member(hub_posts.crew_id))
        -- Non-crew public posts: visible to all (incl. anon).
        OR (hub_posts.crew_id IS NULL AND hub_posts.privacy = 'public')
        -- Non-crew followers-only posts: visible to confirmed followers.
        OR (
          hub_posts.crew_id IS NULL
          AND hub_posts.privacy = 'followers'
          AND auth.email() IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.hub_follows
             WHERE lower(follower_email) = lower(auth.email())
               AND lower(followee_email) = lower(hub_posts.author_email)
          )
        )
      )
    )
  );

-- ── hub_comments ─────────────────────────────────────────────────────────────
-- Replace the open read with one that hides comments from blocked users.
-- (Comment visibility otherwise follows the post; a viewer who can't see
-- the post can't reach its comment thread in the client anyway.)
DROP POLICY IF EXISTS "hub_comments: public read"          ON public.hub_comments;
DROP POLICY IF EXISTS "hub_comments: blocking read"        ON public.hub_comments;

CREATE POLICY "hub_comments: blocking read"
  ON public.hub_comments FOR SELECT
  TO public
  USING (
    hub_comments.author_email = auth.email()
    OR hub_comments.user_id = auth.uid()
    OR NOT public.is_blocked(auth.uid(), hub_comments.author_email)
  );

NOTIFY pgrst, 'reload schema';
