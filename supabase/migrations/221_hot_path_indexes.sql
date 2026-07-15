-- 221_hot_path_indexes.sql
--
-- Viral-load prep, pass 1: covering indexes for the hottest read paths.
-- A scalability audit (2026-07-15) found the highest-traffic queries in
-- the app running without a matching index. No behavior changes — every
-- statement here is additive DDL (plus one redundant-index drop).
--
-- What each index serves (client call sites in parentheses):
--
-- 1. Global "Pump" feed — hub_posts WHERE privacy='public' ORDER BY
--    created_date DESC (hubPosts.js fetchGlobalWindow / fetchOlderGlobal /
--    listPublicFeed). The only existing time index is on created_at, a
--    DIFFERENT column (001_initial_schema idx_hub_posts_created_at), so
--    every feed load today is a seq-scan + top-N sort, re-fetched every
--    30s per client. Partial index: smaller than a composite and exactly
--    matches the only predicate the feed uses.
--
-- 2. Following feed — hub_posts WHERE author_email IN (...) ORDER BY
--    created_date DESC (fetchFollowingWindow / fetchOlderFollowing).
--    Composite replaces the single-column idx_hub_posts_author_email
--    (066): the leading author_email column covers every query the old
--    index served, so the old one is dropped to save write overhead.
--
-- 3. Follow-graph reads — hub_follows is only indexed on user_id (187/218)
--    and the unique (follower_email, followee_email) pair. Lookups by
--    followee_email (listFollowers, the friend-leaderboard self-join in
--    093) and by follower_id / followee_id (listFollowingIds /
--    listFollowersIds) currently seq-scan. follower_email needs no new
--    index — the unique constraint's index leads with it.
--
-- 4. Workout history — workout_logs WHERE created_by=? ORDER BY date DESC
--    (workouts.js list — feeds history, streaks, volume). Only existing
--    indexes are idempotency + uncredited partials.
--
-- 5. DM thread reads — hub_messages WHERE conversation_id=? ORDER BY
--    created_date DESC (hubMessages.js listMessages / listOlderMessages).
--    The 001 index is (conversation_id, created_at) — right table, wrong
--    sort column (created_date was added later in 004 and is what the
--    client actually sorts on).
--
-- Note for future large-table reruns: plain CREATE INDEX takes a write
-- lock for the build. Fine now (tables are small); if re-creating any of
-- these on a big production table later, use CREATE INDEX CONCURRENTLY
-- via a direct connection (it can't run inside the SQL Editor's
-- transaction).

-- 1. Global public feed
CREATE INDEX IF NOT EXISTS idx_hub_posts_public_feed
  ON public.hub_posts (created_date DESC)
  WHERE privacy = 'public';

-- 2. Following feed (then drop the index this one supersedes)
CREATE INDEX IF NOT EXISTS idx_hub_posts_author_created
  ON public.hub_posts (author_email, created_date DESC);

DROP INDEX IF EXISTS idx_hub_posts_author_email;

-- 3. Follow-graph lookups
CREATE INDEX IF NOT EXISTS idx_hub_follows_followee_email
  ON public.hub_follows (followee_email);

CREATE INDEX IF NOT EXISTS idx_hub_follows_follower_id
  ON public.hub_follows (follower_id);

CREATE INDEX IF NOT EXISTS idx_hub_follows_followee_id
  ON public.hub_follows (followee_id);

-- 4. Workout history
CREATE INDEX IF NOT EXISTS idx_workout_logs_user_date
  ON public.workout_logs (created_by, date DESC);

-- 5. DM thread reads on the column the client actually sorts by
CREATE INDEX IF NOT EXISTS idx_hub_messages_conversation_created_date
  ON public.hub_messages (conversation_id, created_date DESC);
