// src/lib/data/hubPostViews.js
// Creator analytics: impression tracking for hub posts.
// One row per (post, viewer) — unique constraint prevents double-counting.
// Views are recorded client-side via IntersectionObserver with a 2-second
// dwell threshold (see HubPostCard.jsx). Authors see their aggregate counts
// in CreatorAnalyticsPanel.

import { supabase } from '@/api/supabaseClient';

/**
 * Record a view. Idempotent — unique constraint means repeat calls are no-ops.
 * Also session-guarded on the client (see HubPostCard) to avoid battering
 * the DB on scroll-heavy sessions.
 */
export const recordView = async (postId, viewerEmail) => {
  if (!postId || !viewerEmail) return;
  await supabase
    .from('hub_post_views')
    .insert({ post_id: postId, viewer_email: viewerEmail })
    .then(() => {}); // ignore unique-violation silently
};

/** Total unique view count for a post. */
export const getViewCount = async (postId) => {
  if (!postId) return 0;
  const { count } = await supabase
    .from('hub_post_views')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId);
  return count || 0;
};

/**
 * Full analytics bundle for a post.
 * Returns: { viewCount, likeCount, commentCount, engagementRate }
 */
export const getAnalytics = async (postId) => {
  if (!postId) return { viewCount: 0, likeCount: 0, commentCount: 0, engagementRate: 0 };
  const [viewRes, postRes] = await Promise.all([
    supabase
      .from('hub_post_views')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', postId),
    supabase
      .from('hub_posts')
      .select('like_count, comment_count')
      .eq('id', postId)
      .maybeSingle(),
  ]);
  const viewCount   = viewRes.count || 0;
  const likeCount   = postRes.data?.like_count    || 0;
  const commentCount = postRes.data?.comment_count || 0;
  const engagements = likeCount + commentCount;
  const engagementRate = viewCount > 0 ? Math.round((engagements / viewCount) * 100) : 0;
  return { viewCount, likeCount, commentCount, engagementRate };
};
