// src/hooks/useHubUnreadDot.js
//
// Tells the Hub tab whether to show a small "new content from
// follows" dot. No counts, no aggression — just a quiet "something
// new is here" signal. Twitter-style casual social, not TikTok-y
// notification farming.
//
// Implementation:
//   1. Track `lastVisitedHub` timestamp in localStorage. Updated every
//      time the user lands on the Hub route (page-mount useEffect).
//   2. Cheap "most recent post from followed users" query, polled at
//      a generous staleTime (60s). If the most-recent post timestamp
//      is newer than lastVisitedHub, the dot shows.
//   3. Self-posts excluded (the user knows about their own posts).
//   4. The query is enabled regardless of which page the user is on,
//      so the dot can appear on, say, Dashboard while user is doing
//      something else.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as hubPosts from '@/lib/data/hubPosts';
import * as hubFollows from '@/lib/data/hubFollows';

const LAST_VISITED_KEY = (email) => `flexyn.lastVisitedHub.${email || 'anon'}`;

export function getLastVisitedHub(userEmail) {
  try {
    const raw = localStorage.getItem(LAST_VISITED_KEY(userEmail));
    return raw ? new Date(raw).getTime() : 0;
  } catch {
    return 0;
  }
}

export function markHubVisited(userEmail) {
  try {
    localStorage.setItem(LAST_VISITED_KEY(userEmail), new Date().toISOString());
  } catch { /* Safari private mode etc — best-effort */ }
}

export function useHubUnreadDot(userEmail) {
  const [lastVisited, setLastVisited] = useState(() => getLastVisitedHub(userEmail));

  // Refresh the "last visited" snapshot whenever the user identity
  // changes or the hub-visited custom event fires (so other consumers
  // — including the page itself — can broadcast a visit).
  useEffect(() => {
    setLastVisited(getLastVisitedHub(userEmail));
    const onVisited = () => setLastVisited(getLastVisitedHub(userEmail));
    window.addEventListener('flexyn:hub-visited', onVisited);
    return () => window.removeEventListener('flexyn:hub-visited', onVisited);
  }, [userEmail]);

  // Get the user's following list once, then check the most recent
  // post from any of them. We don't want to fetch a full feed window —
  // just the timestamp of the newest post. The fetchFollowingWindow
  // query is already cached if the user is currently on Hub, so this
  // hook re-uses cache via the same queryKey shape.
  const { data: followingEmails = [] } = useQuery({
    queryKey: ['hubFollowing', userEmail],
    queryFn: () => hubFollows.listFollowing(userEmail),
    enabled: !!userEmail,
    staleTime: 5 * 60_000,
  });

  const { data: latestFollowingPosts = [] } = useQuery({
    queryKey: ['hubFollowingLatest', userEmail, followingEmails.length],
    queryFn: () => hubPosts.fetchFollowingWindow(followingEmails),
    enabled: !!userEmail && followingEmails.length > 0,
    staleTime: 60_000,
    // Don't refetch on every focus — the 60s stale-time is plenty
    // for an unread-dot signal.
    refetchOnWindowFocus: false,
  });

  // Filter out self-posts (defensive — the server-side follow filter
  // already excludes self by definition).
  const newestPost = latestFollowingPosts.find(p => p.author_email !== userEmail);
  if (!newestPost) return false;

  const newestTs = new Date(newestPost.created_date).getTime();
  return newestTs > lastVisited;
}
