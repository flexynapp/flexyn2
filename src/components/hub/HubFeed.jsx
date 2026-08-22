// src/components/hub/HubFeed.jsx
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, RefreshCw, ArrowUp, Hash, X, TrendingUp, Radio, Flame, Clock } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubPosts from '@/lib/data/hubPosts';
import * as hubFollows from '@/lib/data/hubFollows';
import { onHubPostInsert } from '@/lib/hubPostsRealtime';
import HubPostCard from './HubPostCard';
import EmptyState from '@/components/EmptyState';
import { NoFeedIllustration, NoFriendsIllustration } from '@/components/emptyStateIllustrations';
import { reportError } from '@/lib/reportError';
import { useScrollRestoration } from '@/hooks/useScrollRestoration';
import * as userMutes from '@/lib/data/userMutes';
import * as userBlocks from '@/lib/data/userBlocks';
import PeopleYouMayKnow from './PeopleYouMayKnow';
import * as hubLiveSessions from '@/lib/data/hubLiveSessions';

// ── Lazy-load new components added in batch 2 ─────────────────────────────────
// These were imported statically before and caused a Rollup TDZ crash
// (ReferenceError: Cannot access 'oe' before initialization) in the Hub chunk.
// Converting to lazy() moves them out of the Hub chunk's synchronous evaluation
// sequence, eliminating the initialization-order conflict.
const LiveSessionCard       = lazy(() => import('./LiveSessionCard'));
const LiveSessionBroadcaster = lazy(() => import('./LiveSessionBroadcaster'));
const ActivityFeed          = lazy(() => import('./ActivityFeed'));

// ── Trending hashtags helper ──────────────────────────────────────────────────
// Extracts #tags from all loaded posts and returns top N sorted by frequency.
function computeTrending(posts, limit = 8) {
  const counts = {};
  for (const p of posts) {
    const body = p.body || p.content || '';
    const tags = body.match(/#\w+/g) || [];
    for (const tag of tags) {
      const lc = tag.toLowerCase();
      counts[lc] = (counts[lc] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

// ── Post skeleton (shimmer placeholder while loading) ────────────────────────
function PostSkeleton() {
  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card animate-pulse">
      {/* Header */}
      <div className="flex items-center gap-3 p-3">
        <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 bg-muted rounded w-28" />
          <div className="h-2.5 bg-muted rounded w-16" />
        </div>
      </div>
      {/* Body lines */}
      <div className="px-3 pb-3 space-y-2">
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-4/5" />
        <div className="h-3 bg-muted rounded w-2/3" />
      </div>
      {/* Stats row */}
      <div className="flex items-center gap-3 px-3 pb-3">
        <div className="h-6 bg-muted rounded w-16" />
        <div className="h-6 bg-muted rounded w-16" />
        <div className="h-6 bg-muted rounded w-16" />
      </div>
    </div>
  );
}

const PAGE_SIZE = 8;

export default function HubFeed({ feedTab, onAuthorClick }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // `following` is read via the canonical useQuery cache key
  // ['hubFollowing', user?.email] — declared below alongside the feed
  // query so they share the same invalidation cycle. The previous
  // implementation hydrated a useState once on mount which never
  // refreshed after follow/unfollow taps elsewhere, so the Squad feed
  // silently missed posts from newly-followed users until full reload.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

  // ── Sort + time filter ────────────────────────────────────────────────────
  const [sort, setSort] = useState('newest'); // 'newest' | 'popular'
  const [timeFilter, setTimeFilter] = useState('week'); // 'today' | 'week' | 'all'

  // ── Hashtag filter state ──────────────────────────────────────────────────
  const [activeHashtag, setActiveHashtag] = useState(null); // e.g. '#legday'
  const [showTrending, setShowTrending] = useState(false);

  // ── Live sessions ─────────────────────────────────────────────────────────
  const [broadcasterOpen, setBroadcasterOpen] = useState(false);
  const { data: liveSessions = [] } = useQuery({
    queryKey: ['hubLiveSessions'],
    queryFn: () => hubLiveSessions.listActiveSessions(),
    enabled: !!user?.email,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // ── "X new posts" Realtime pill ────────────────────────────────────────────
  const [pendingNewCount, setPendingNewCount] = useState(0);
  // Filter snapshot for the realtime callback. Updated on every render
  // so the callback can drop posts the viewer wouldn't see anyway
  // (audit C-6: previously the pill counted every INSERT regardless of
  // mute/block/follow/privacy).
  const realtimeFilterRef = useRef({
    feedTab: 'pump',
    followingLc: new Set(),
    mutedLc: new Set(),
    blockedLc: new Set(),
    crewIds: new Set(),
  });

  useEffect(() => {
    if (!user?.email) return;
    const myEmailLc = user.email.toLowerCase();
    // Shared hub_posts INSERT subscription (one Realtime channel per
    // client, multiplexed with FollowerActivityBanner — see
    // src/lib/hubPostsRealtime.js).
    return onHubPostInsert((row) => {
      const authorLc = row.author_email?.toLowerCase();
      if (!authorLc || authorLc === myEmailLc) return;
      const f = realtimeFilterRef.current;
      if (f.blockedLc.has(authorLc)) return;
      if (f.mutedLc.has(authorLc))   return;
      // A crew post counts when it is addressed to one of MY crews. Before
      // mig 379 there was no crew_id to test, so every crew row was dropped
      // here and the "N new posts" pill never counted one.
      const isMyCrewPost = row.privacy === 'crew' && !!row.crew_id && f.crewIds.has(row.crew_id);
      if (row.privacy && row.privacy !== 'public' && row.privacy !== 'followers' && !isMyCrewPost) return;
      if (row.publish_at && new Date(row.publish_at).getTime() > Date.now()) return;
      // Squad is a follow feed, EXCEPT for your crews — a crew mate you do not
      // follow is exactly who this is for.
      if (f.feedTab === 'squad' && !f.followingLc.has(authorLc) && !isMyCrewPost) return;
      setPendingNewCount(c => c + 1);
    });
  }, [user?.email]);

  // Reset visible count when switching tabs — start fresh at 8.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [feedTab]);

  // Canonical follow-state cache key, shared with HubProfile / StoriesRow /
  // useHubUnreadDot. When the user follows/unfollows anyone, those code
  // paths invalidate this same key, so the Squad feed automatically
  // refetches with the new follow set.
  const { data: following = [], error: followingError } = useQuery({
    queryKey: ['hubFollowing', user?.email],
    queryFn:  () => hubFollows.listFollowing(user.email),
    enabled:  !!user?.email,
    staleTime: 60_000,
  });

  // Report from the error the hook returns. This was an `onError` option on the
  // query, which react-query removed in v5 — so the reporting it was added for
  // had silently stopped happening.
  useEffect(() => {
    if (!followingError) return;
    reportError(followingError, {
      feature: 'hub.feed.list-following', level: 'warning', userEmail: user?.email,
    });
  }, [followingError, user?.email]);

  // The follow SET, not its size. Keying on `following.length` means unfollow
  // one person and follow another — a very ordinary pair of taps — produces an
  // identical cache key, so react-query serves the stale rows and the queryFn,
  // which closes over the NEW array, never runs. Neither follow mutation
  // invalidates ['hubFeed'], so it corrects only once staleTime lapses and
  // something remounts. useHubUnreadDot hit this exact bug and fixed it this
  // exact way, with a comment saying so; this file was never updated.
  const followingKey = useMemo(() => [...following].sort().join('|'), [following]);

  const { data: windowPosts = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['hubFeed', feedTab, user?.email, followingKey],
    queryFn: async () => {
      if (feedTab === 'pump') {
        return hubPosts.fetchGlobalWindow();
      } else {
        return hubPosts.fetchFollowingWindow(following, user?.email);
      }
    },
    enabled: !!user?.email,
    // 30s feels live without hammering the DB on every component mount.
    // Scroll-to-top refresh below calls refetch() explicitly, so we don't
    // need staleTime:0 — it was causing a fresh fetch on every Hub re-mount
    // (every tab switch back from a profile/composer overlay).
    staleTime: 30_000,
    // THIS is "the page refreshed by itself" (Sean, 12 Aug). The app-wide
    // default leaves refetchOnWindowFocus TRUE, so leaving the tab and coming
    // back after staleTime silently refetched the feed and the list moved
    // under him with nothing having been touched.
    //
    // Turned off HERE and not globally. That default is deliberate and
    // documented in src/lib/query-client.js — a Dashboard left open over a
    // dinner break otherwise shows hour-old workout counts. A feed is the one
    // surface where it is wrong: this is a reading position, and content
    // shifting while you are looking at it loses your place. His instruction
    // was explicit — "it has to be a manual refresh, posts are not gonna
    // automatically come in."
    //
    // Nothing is lost by it. Realtime still counts arrivals behind the
    // "N new posts" pill, so you find out immediately and choose when.
    refetchOnWindowFocus: false,
  });

  // ── Preload the sibling feed tab ─────────────────────────────────────
  // Switching Global ↔ Following used to show a spinner every time, because
  // each tab is its own query key and the other one was always cold.
  //
  // This runs HERE rather than in Hub.jsx on purpose. The key carries
  // `following.length`, which only exists inside this component — prefetching
  // from the page would have to guess it, and a key that is off by one is not
  // an error, it is a prefetch that silently warms a cache nobody reads. The
  // failure would look exactly like no prefetch at all.
  //
  // Fires once the visible tab has resolved, so the tab the user is actually
  // looking at never queues behind a fetch for one they aren't.
  useEffect(() => {
    if (!user?.email || isLoading) return;
    const sibling = feedTab === 'pump' ? 'squad' : 'pump';
    const id = setTimeout(() => {
      queryClient.prefetchQuery({
        queryKey: ['hubFeed', sibling, user.email, followingKey],
        queryFn: () => (sibling === 'pump'
          ? hubPosts.fetchGlobalWindow()
          : hubPosts.fetchFollowingWindow(following, user.email)),
        staleTime: 30_000,
      }).catch(() => { /* a warm cache is an optimisation, never an error */ });
    }, 400);
    return () => clearTimeout(id);
  }, [feedTab, user?.email, following, isLoading, queryClient]);

  // ── Older-than-cursor pagination (audit B-9) ─────────────────────────
  // FETCH_WINDOW caps the live query at 100 rows. When the user scrolls
  // past it we extend the array by fetching older posts than the
  // current oldest cursor.
  const [olderPosts, setOlderPosts] = useState([]);
  const [olderExhausted, setOlderExhausted] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Reset the older-cache whenever the query key effectively changes
  // (feed tab swap, refetch, follow-graph mutation).
  useEffect(() => {
    setOlderPosts([]);
    setOlderExhausted(false);
  }, [feedTab, user?.email, followingKey]);

  const allPosts = useMemo(
    () => (olderPosts.length ? [...windowPosts, ...olderPosts] : windowPosts),
    [windowPosts, olderPosts],
  );

  // Synchronous in-flight guard. `loadingOlder` state lags React renders,
  // so two rapid IntersectionObserver sentinel intersections (or one
  // intersection firing while the previous async fetch is mid-flight
  // before setLoadingOlder(true) lands) both pass `loadingOlder===false`
  // and call fetchOlderGlobal with the SAME cursor — appending the
  // same 50 posts twice, producing React duplicate-key warnings and
  // double-rendered cards. Wave 54 (Hub audit) caught this.
  const loadOlderInFlightRef = useRef(false);
  const loadOlder = useCallback(async () => {
    if (loadingOlder || olderExhausted) return;
    if (loadOlderInFlightRef.current) return;
    const combined = olderPosts.length ? olderPosts : windowPosts;
    const last = combined[combined.length - 1];
    const cursor = last?.created_date || last?.created_at;
    if (!cursor) { setOlderExhausted(true); return; }
    loadOlderInFlightRef.current = true;
    setLoadingOlder(true);
    try {
      const more = feedTab === 'pump'
        ? await hubPosts.fetchOlderGlobal(cursor, 50)
        : await hubPosts.fetchOlderFollowing(following, cursor, 50, user?.email);
      if (more.length === 0) setOlderExhausted(true);
      else setOlderPosts(prev => [...prev, ...more]);
    } finally {
      setLoadingOlder(false);
      loadOlderInFlightRef.current = false;
    }
  }, [feedTab, following, loadingOlder, olderExhausted, olderPosts, windowPosts]);

  // Stable callback identity so memo(HubPostCard) actually holds — previously
  // a fresh arrow was created per card per render, re-rendering every card on
  // any HubFeed state change (e.g. the realtime new-posts pill). Setters +
  // PAGE_SIZE are stable, so empty deps are correct.
  const handleHashtagClick = useCallback((tag) => {
    setActiveHashtag(h => h === tag ? null : tag);
    setShowTrending(true);
    setVisibleCount(PAGE_SIZE);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Remember scroll position per feed-tab so navigating into a post
  // detail / profile and back lands the user where they were.
  useScrollRestoration(`hub-feed-${feedTab}`, { window: true, ready: !isLoading });

  // Crew membership — used to filter out crew-private posts the viewer can't see
  const { data: myCrewIds = [] } = useQuery({
    queryKey: ['myCrewIds', user?.id],
    queryFn: async () => {
      const { getMyCrews } = await import('@/lib/data/crews');
      const crews = await getMyCrews(user.id);
      return (crews || []).map(c => c.id);
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  // Crew posts addressed to MY crews, whoever wrote them.
  //
  // The Squad window is keyed on author_email, so before this a crew post only
  // reached crew mates who also followed the author — and most of a crew does
  // not follow most of the crew. The composer promises "Only crew members will
  // see this post", which is a restriction, but it is read as delivery too.
  // Squad only: these are not global-feed content, and Pump asks the DB for
  // privacy = 'public' anyway.
  const { data: crewPosts = [] } = useQuery({
    queryKey: ['hubCrewFeed', myCrewIds.slice().sort().join(',')],
    queryFn: () => hubPosts.fetchCrewWindow(myCrewIds),
    enabled: feedTab === 'squad' && myCrewIds.length > 0,
    staleTime: 30_000,
    // Same reasoning as the main feed window: a feed is a reading position.
    refetchOnWindowFocus: false,
  });

  // Mute/block lists — applied viewer-side in filteredPosts below.
  // Both queries are cheap (RLS limits rows to the caller's own).
  const { data: mutedEmails = [] } = useQuery({
    queryKey: ['userMutes', user?.id],
    queryFn: async () => (await userMutes.listMutes(user.id)).map(r => r.muted_email?.toLowerCase()),
    enabled: !!user?.id,
    staleTime: 60_000,
  });
  const { data: blockedEmails = [] } = useQuery({
    queryKey: ['userBlocks', user?.id],
    queryFn: async () => (await userBlocks.listBlocks(user.id)).map(r => r.blocked_email?.toLowerCase()),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  // Keep the realtime filter ref in sync with current state.
  useEffect(() => {
    realtimeFilterRef.current = {
      feedTab,
      followingLc: new Set((following || []).map(e => e?.toLowerCase()).filter(Boolean)),
      mutedLc:     new Set(mutedEmails),
      blockedLc:   new Set(blockedEmails),
      crewIds:     new Set(myCrewIds),
    };
  }, [feedTab, following, mutedEmails, blockedEmails, myCrewIds]);

  // Filter out crew-private posts the current user doesn't belong to,
  // posts from muted/blocked users, scheduled posts not yet published,
  // and apply hashtag filter when active.
  // Merged before filtering, newest first, deduped by id — a crew post whose
  // author you DO follow arrives down both paths.
  const withCrewPosts = useMemo(() => {
    if (!crewPosts.length) return allPosts;
    const seen = new Set(allPosts.map(p => p.id));
    const extra = crewPosts.filter(p => !seen.has(p.id));
    if (!extra.length) return allPosts;
    return [...allPosts, ...extra].sort(
      (a, b) => new Date(b.created_date || b.created_at) - new Date(a.created_date || a.created_at),
    );
  }, [allPosts, crewPosts]);

  const filteredPosts = useMemo(() => {
    if (!withCrewPosts.length) return withCrewPosts;
    const crewSet  = new Set(myCrewIds);
    const muteSet  = new Set(mutedEmails);
    const blockSet = new Set(blockedEmails);
    let result = withCrewPosts.filter(p => {
      const authorLc = p.author_email?.toLowerCase();
      if (authorLc && blockSet.has(authorLc)) return false;
      if (authorLc && muteSet.has(authorLc))  return false;
      if (p.privacy !== 'crew') return true;
      return p.crew_id && crewSet.has(p.crew_id);
    });
    // Filter out scheduled posts that aren't published yet
    result = result.filter(p => !p.publish_at || new Date(p.publish_at) <= new Date());
    if (activeHashtag) {
      result = result.filter(p => {
        const body = (p.body || p.content || '').toLowerCase();
        return body.includes(activeHashtag);
      });
    }
    // ── Sort ─────────────────────────────────────────────────────────────────
    if (sort === 'popular') {
      // Apply time window before sorting by likes
      if (timeFilter !== 'all') {
        // Use local midnight for 'today' so posts from earlier today
        // aren't excluded by a rolling-24h window (UTC offset bug).
        const now = new Date();
        const cutoff = timeFilter === 'today'
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
          : now.getTime() - 7 * 24 * 60 * 60 * 1000;
        result = result.filter(p => {
          const t = new Date(p.created_date || p.created_at).getTime();
          return t >= cutoff;
        });
      }
      result = [...result].sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
    }
    return result;
  }, [withCrewPosts, myCrewIds, mutedEmails, blockedEmails, activeHashtag, sort, timeFilter]);

  // Trending hashtags derived from current feed window
  const trendingTags = useMemo(() => computeTrending(allPosts), [allPosts]);

  // ── Scroll-to-top refresh ────────────────────────────────────────────────
  // When the user scrolls back to the very top of the page (after having
  // scrolled down at least 60px) we trigger a fresh fetch. This gives the
  // "pull to refresh" feel on mobile without requiring a native gesture.
  const [showRefreshBadge, setShowRefreshBadge] = useState(false);

  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);

  // Gesture-driven refreshes are throttled to one network round-trip a
  // minute. Both gestures below are easy to fire by accident and easy to
  // repeat — scrolling to the top happens constantly while reading, and the
  // tab is right under your thumb — so without a floor the global feed can be
  // made to refetch as fast as a finger moves.
  //
  // This governs only the two GESTURES. The new-posts pill is deliberately
  // exempt: it appears only when realtime has actually seen a post arrive, so
  // it is not a spam vector, and refusing to load posts the app has already
  // told the user exist would read as the app being broken.
  //
  // Nothing here makes the feed auto-update — it never did. A realtime INSERT
  // only increments a counter behind that pill; rows are never spliced into
  // the list under the reader.
  const REFRESH_FLOOR_MS = 60_000;
  const lastRefreshRef = useRef(0);
  const requestRefresh = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshRef.current < REFRESH_FLOOR_MS) return false;
    lastRefreshRef.current = now;
    refetchRef.current();
    setShowRefreshBadge(true);
    setTimeout(() => setShowRefreshBadge(false), 1800);
    try { navigator.vibrate?.(10); } catch { /* ignore */ }
    return true;
  }, []);

  useEffect(() => {
    let prevY = window.scrollY;
    const handleScroll = () => {
      const y = window.scrollY;
      if (prevY > 60 && y === 0) {
        // Clear the pill either way: the user has physically returned to the
        // top of the feed, so a badge telling them to scroll up is spent.
        if (requestRefresh()) setPendingNewCount(0);
      }
      prevY = y;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [requestRefresh]);

  // Listen for the "active-tab retap" event from Layout — when the
  // user taps the Hub tab while already on Hub + at the top, treat it
  // as a manual refresh request (same outcome as the scroll-to-top
  // gesture). Standard Twitter/IG behavior.
  useEffect(() => {
    const onRetap = (e) => {
      if (e.detail?.path !== '/hub') return;
      requestRefresh();
    };
    window.addEventListener('flexyn:active-tab-retap', onRetap);
    return () => window.removeEventListener('flexyn:active-tab-retap', onRetap);
  }, [requestRefresh]);

  // Slice the fetched + crew-filtered window to the visible page.
  const visiblePosts = useMemo(
    () => filteredPosts.slice(0, visibleCount),
    [filteredPosts, visibleCount]
  );

  const hasMoreLocal  = visibleCount < filteredPosts.length;
  const hasMoreServer = !olderExhausted && !hasMoreLocal && filteredPosts.length > 0;
  const hasMore = hasMoreLocal || hasMoreServer;

  // Auto-load more when sentinel scrolls into view. When the local
  // window is exhausted, request an older-than-cursor page from the
  // server so posts past FETCH_WINDOW remain reachable (audit B-9).
  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (hasMoreLocal) {
          setVisibleCount(c => Math.min(c + PAGE_SIZE, filteredPosts.length));
        } else if (hasMoreServer) {
          loadOlder();
        }
      },
      { rootMargin: '200px' } // pre-load slightly before the user reaches it
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, hasMoreLocal, hasMoreServer, filteredPosts.length, loadOlder]);

  // ── Activity tab — render ActivityFeed instead of posts ──────────────────
  if (feedTab === 'activity') {
    return (
      <Suspense fallback={<div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>}>
        <ActivityFeed />
      </Suspense>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <PostSkeleton key={i} />)}
      </div>
    );
  }

  // ── Sort / filter toolbar ─────────────────────────────────────────────────
  //
  // Declared here, ABOVE the empty-state early return, and rendered in BOTH
  // branches. It used to live only in the populated return, which made "Hot"
  // a dead end: pick Hot, have it filter everything out, and the toolbar you
  // would use to get back to New unmounted along with the feed. The only way
  // out was a full page refresh.
  //
  // A control that removes itself is worse than one that returns no results —
  // the user cannot tell whether the app broke or the feed is genuinely empty,
  // and either way they are stuck.
  const sortToolbar = (
    <div className="flex items-center gap-2 flex-wrap">
      {/* New | Hot toggle */}
      <div className="flex items-center rounded-lg border border-border overflow-hidden text-micro font-bold shrink-0">
        <button type="button"
          onClick={() => { setSort('newest'); setVisibleCount(PAGE_SIZE); }}
          className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${sort === 'newest' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground active:text-foreground'}`}>
          <Clock className="w-3 h-3" />{tFallback("coach.onboarding.levelLabel.newbie", "New")}
        </button>
        <button type="button"
          onClick={() => { setSort('popular'); setVisibleCount(PAGE_SIZE); }}
          className={`flex items-center gap-1 px-2.5 py-1.5 border-s border-border transition-colors ${sort === 'popular' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground active:text-foreground'}`}>
          <Flame className="w-3 h-3" />{tFallback("hubFeed.hot", "Hot")}
        </button>
      </div>
      {/* Time sub-filter (Hot only) */}
      {sort === 'popular' && (
        <div className="flex items-center rounded-lg border border-border overflow-hidden text-micro font-bold shrink-0">
          {[['today','Today'],['week','Week'],['all','All']].map(([val, label]) => (
            <button key={val} type="button"
              onClick={() => { setTimeFilter(val); setVisibleCount(PAGE_SIZE); }}
              className={`px-2.5 py-1.5 border-s first:border-s-0 border-border transition-colors ${timeFilter === val ? 'bg-secondary text-foreground' : 'bg-background text-muted-foreground hover:text-foreground active:text-foreground'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {/* Go Live — tucked inline, compact */}
      <button onClick={() => setBroadcasterOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-micro font-bold hover:bg-destructive/10 active:bg-destructive/10 transition-colors shrink-0 ml-auto">
        <span className="relative flex w-2 h-2 shrink-0">
          <span className="absolute inline-flex w-full h-full rounded-full bg-destructive opacity-60 animate-ping" />
          <span className="relative inline-flex w-2 h-2 rounded-full bg-destructive" />
        </span>
        <Radio className="w-3 h-3" />
        {tFallback("hubFeed.goLive", "Go Live")}
      </button>
    </div>
  );

  if (filteredPosts.length === 0 && !isLoading) {
    const isSquadWithFollowing = feedTab === 'squad' && following.length > 0;
    // Friendly empty state with an actionable CTA — previously was just text.
    // The right next step depends on the surface:
    //   - Pump empty: encourage the user to make the first post (everyone
    //     starts here once, including the very first user on the platform).
    //   - Squad empty (no follows): point to discover/search for people.
    //   - Squad empty (has follows but no posts yet): same CTA as Pump —
    //     posting yourself fills your own Squad feed too.
    const ctaShare = {
      label: tFallback('hub.empty.cta.share', 'Share a workout'),
      onClick: () => navigate('/workout'),
    };
    const ctaDiscover = {
      label: tFallback('hub.empty.cta.discover', 'Find athletes'),
      // Squad empty discovery → the search overlay handles it; we route to
      // /hub which is already on /hub, but resetting the section state via
      // a query param tells Hub.jsx to open the search overlay.
      onClick: () => navigate('/hub?search=open'),
    };
    // Hot + a time window can empty a feed that has plenty in it. Say so,
    // and offer the way out, rather than implying nobody has posted.
    const emptiedByFilter = sort === 'popular';
    return (
      <div className="space-y-4">
        {sortToolbar}
        {emptiedByFilter ? (
          <EmptyState
            illustration={<NoFeedIllustration />}
            title={tFallback('hub.empty.filteredTitle', 'Nothing hot in this window')}
            body={tFallback('hub.empty.filteredDesc', 'No posts match Hot for the time range you picked. Try a wider range, or switch back to New.')}
            action={{
              label: tFallback('hub.empty.cta.backToNew', 'Back to New'),
              onClick: () => { setSort('newest'); setVisibleCount(PAGE_SIZE); },
            }}
            secondaryAction={timeFilter !== 'all' ? {
              label: tFallback('hub.empty.cta.allTime', 'Widen to All time'),
              onClick: () => { setTimeFilter('all'); setVisibleCount(PAGE_SIZE); },
            } : undefined}
          />
        ) : (
        <EmptyState
          illustration={feedTab === 'pump' ? <NoFeedIllustration /> : <NoFriendsIllustration />}
          title={
            feedTab === 'pump'
              ? (tFallback('hub.empty.pumpTitle', 'The feed is quiet'))
              : isSquadWithFollowing
              ? (tFallback('hub.empty.squadNoPosts', "No posts yet"))
              : (tFallback('hub.empty.squadTitle', 'You\'re not following anyone yet'))
          }
          body={
            feedTab === 'pump'
              ? (tFallback('hub.empty.pumpDesc', 'Be the first to post and start the energy.'))
              : isSquadWithFollowing
              ? (tFallback('hub.empty.squadNoPostsDesc', "The people you follow haven't posted yet. Share your own session in the meantime!"))
              : (tFallback('hub.empty.squadDesc', 'Follow other athletes to see their activity here.'))
          }
          action={feedTab === 'pump' || isSquadWithFollowing ? ctaShare : ctaDiscover}
          secondaryAction={feedTab === 'pump' ? undefined : (isSquadWithFollowing ? ctaDiscover : ctaShare)}
        />
        )}
        {/* PYMK suggestion rail — shown on Squad empty state to help new users build their network */}
        {feedTab === 'squad' && (
          <PeopleYouMayKnow onSelectUser={(u) => navigate(`/hub?profile=${encodeURIComponent(u.id || u.email)}`)} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sortToolbar}

      {/* ── Live session cards ─────────────────────────────────────────── */}
      <Suspense fallback={null}>
        {liveSessions.filter(s => s.host_email !== user?.email).map(session => (
          <LiveSessionCard
            key={session.id}
            session={session}
            onViewProfile={onAuthorClick}
          />
        ))}
      </Suspense>

      {/* ── Broadcaster overlay ─────────────────────────────────────────── */}
      <AnimatePresence>
        {broadcasterOpen && (
          <Suspense fallback={null}>
            <LiveSessionBroadcaster onClose={() => setBroadcasterOpen(false)} />
          </Suspense>
        )}
      </AnimatePresence>

      {/* ── Trending hashtags rail ──────────────────────────────────────── */}
      {trendingTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowTrending(v => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary active:text-primary transition-colors"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            {tFallback('hub.trending', 'Trending')}
          </button>
          <AnimatePresence>
            {showTrending && trendingTags.map((item, i) => (
              <motion.button
                key={item.tag}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => {
                  setActiveHashtag(h => h === item.tag ? null : item.tag);
                  setVisibleCount(PAGE_SIZE);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeHashtag === item.tag
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/60 text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground'
                }`}
              >
                <Hash className="w-2.5 h-2.5" />
                {item.tag.replace('#', '')}
                <span className="opacity-60 text-micro">{item.count}</span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Active hashtag filter banner */}
      <AnimatePresence>
        {activeHashtag && (
          <motion.div
            key="hashtag-filter"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20"
          >
            <Hash className="w-3.5 h-3.5 text-primary" />
            <span className="text-sm font-semibold text-primary flex-1">{activeHashtag}</span>
            <button
              onClick={() => { setActiveHashtag(null); setVisibleCount(PAGE_SIZE); }}
              className="p-0.5 rounded text-primary/60 hover:text-primary active:text-primary transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New posts pill — tap to load them in */}
      <AnimatePresence>
        {pendingNewCount > 0 && (
          <motion.button
            key="new-posts-pill"
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['hubFeed'] });
              setPendingNewCount(0);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="sticky top-2 z-10 flex items-center justify-center gap-2 mx-auto px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-lg w-fit"
          >
            <ArrowUp className="w-3.5 h-3.5" />
            {pendingNewCount} new {pendingNewCount === 1 ? 'post' : 'posts'}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Scroll-to-top refresh indicator */}
      <AnimatePresence>
        {(isFetching && !isLoading) || showRefreshBadge ? (
          <motion.div
            key="refresh-badge"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-full bg-primary/10 text-primary text-xs font-medium mx-auto w-fit"
          >
            <RefreshCw className="w-3 h-3 animate-spin" />
            {t('hub.feed.refreshing')}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {visiblePosts.map((post, idx) => (
        <motion.div
          key={post.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(idx % PAGE_SIZE, 6) * 0.04 }}
        >
          <HubPostCard
            post={post}
            onAuthorClick={onAuthorClick}
            onHashtagClick={handleHashtagClick}
          />
        </motion.div>
      ))}

      {/* Sentinel for auto-load */}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-6">
          <button
            onClick={() => setVisibleCount(c => Math.min(c + PAGE_SIZE, filteredPosts.length))}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary/50 hover:bg-secondary active:bg-secondary text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
          >
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            {t('hub.feed.loadingMore')}
          </button>
        </div>
      )}

      {/* End of window marker */}
      {!hasMore && filteredPosts.length >= PAGE_SIZE && (
        <p className="text-center text-xs text-muted-foreground py-6">
          {t('hub.feed.allCaughtUp')}
        </p>
      )}
    </div>
  );
}