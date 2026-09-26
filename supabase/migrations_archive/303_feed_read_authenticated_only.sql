-- 303_feed_read_authenticated_only.sql
--
-- The hub feed's SELECT policies are TO PUBLIC, so they are written to be
-- evaluated by `anon`. They are not reachable by anon today, but only by
-- accident: the expressions call current_user_email() and is_blocked(),
-- and anon holds EXECUTE on neither. An anonymous read fails on a
-- permission error rather than returning no rows.
--
-- Depending on a missing GRANT is not a security boundary, it is a
-- coincidence with good timing. Grant anon EXECUTE on those helpers one
-- day — for a public profile page, a shared post link, an OG-image
-- renderer — and the feed opens with no code change and nothing to
-- notice.
--
-- Measured rather than argued. In a rolled-back transaction, with both
-- helpers granted to anon and these policies as they are:
--
--     anon SELECT hub_posts     23 rows
--     anon SELECT hub_comments   8 rows
--
-- More than the 9 an authenticated user sees, because that user's own
-- block list filters some out and an anonymous reader has no blocks.
--
-- With the change below, the same worst case returns 0 and 0.
--
-- ── Why ALTER POLICY and not DROP/CREATE ─────────────────────────────
--
-- ALTER POLICY ... TO changes the roles without restating the
-- expression. That matters twice: the logic of a feed read policy is the
-- last thing to retype from memory, and hub_posts' expression contains
-- `hub_follows.follower_email` and `hub_posts.author_email` — the
-- alias.column tokens the deploy clipboard mangles into 42601 (see the
-- paste-safety rule in CLAUDE.md's workflow section). Recreating these
-- policies by paste is exactly the operation that rule exists to warn
-- about, and it is entirely avoidable here.
--
-- ── What this does not change ────────────────────────────────────────
--
-- Nothing signed out reads the feed. The public routes are /p/gym/:id,
-- /privacy, /terms and the /@username profile link; every client reader
-- of hub_posts and hub_comments sits behind auth. Verified after the
-- change that an authenticated reader still sees the same rows.
--
-- The `owner write` policies on both tables stay TO PUBLIC. They are ALL
-- policies, so they do cover SELECT, but their USING requires ownership
-- and auth.uid() is NULL for anon — they already fail closed by
-- construction rather than by a missing grant, which is the distinction
-- this migration is about.

ALTER POLICY "hub_posts: privacy and blocking read"
  ON public.hub_posts TO authenticated;

ALTER POLICY "hub_comments: blocking read"
  ON public.hub_comments TO authenticated;
