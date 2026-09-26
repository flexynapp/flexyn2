-- Migration 292: hub_reactions was world-readable
--
-- `hub_posts` has a real read policy — is_blocked(), publish_at, and a
-- hub_follows join for followers-only posts. `hub_reactions` sat next to it
-- with `USING (true)` and no role restriction, so every reaction row was
-- readable by anyone including `anon`. That leaks the engagement graph for
-- posts the viewer cannot see: which accounts exist, that a private or
-- followers-only post exists at all, and who engaged with it — including
-- reactions belonging to people who have blocked the viewer.
--
-- Owner-only read is sufficient, which is what makes this safe rather than
-- a trade-off. Checked every consumer first:
--
--   • The ONLY client read is the batcher in src/lib/data/hubReactions.js,
--     and it already queries `.eq('created_by', email)` — the user's own
--     rows. Nothing reads anyone else's.
--   • Displayed like/dislike counts come from `hub_posts.like_count` /
--     `.dislike_count`, denormalized columns, not from counting this table.
--     HubPostCard reads `post.like_count`. So counts cannot regress.
--   • Every aggregate path is SECURITY DEFINER and therefore unaffected by
--     RLS: increment_hub_post_counter (which RECOMPUTES the counters from
--     count(*) over this table), set_post_reaction, set_post_emoji_reaction
--     and get_post_emoji_summary.
--   • No "liked by X, Y, Z" surface reads the table directly.
--
-- The existing "hub_reactions: owner write" policy is cmd ALL, which already
-- covers SELECT, so dropping the public policy alone would produce the right
-- behaviour. An explicit read policy is added anyway because that policy is
-- NAMED "write": leaving reads to depend on it invites someone to later
-- narrow it to the write commands and silently kill every reaction lookup.
--
-- Both branches of the predicate are kept (`created_by` email OR `user_id`).
-- auth.email() is NULL for anonymous/guest tokens, so the email branch alone
-- would lock guests out of their own reactions; all 45 existing rows carry
-- both columns populated, so the uid branch covers them.
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE, per the repo convention.

DROP POLICY IF EXISTS "hub_reactions: public read" ON public.hub_reactions;

-- Same belt-and-braces as migration 291 on gym_members. Dropping the policy
-- already reduces anon to zero rows, because the replacement below is scoped
-- TO authenticated and anon then matches nothing. But the table grant is what
-- makes anon a candidate at all, so revoking it moves the denial from
-- "filtered to zero" to "permission denied" — and stops the next permissive
-- policy anyone writes here from being anon-readable by default.
REVOKE SELECT ON public.hub_reactions FROM anon;

DROP POLICY IF EXISTS "hub_reactions: owner read" ON public.hub_reactions;
CREATE POLICY "hub_reactions: owner read" ON public.hub_reactions
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.email()) = created_by
    OR (SELECT auth.uid()) = user_id
  );
