// src/components/hub/HubFeed.jsx
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, RefreshCw, ArrowUp, Hash, X, TrendingUp, Radio } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubPosts from '@/lib/data/hubPosts';
import * as hubFollows from '@/lib/data/hubFollows';
import { supabase } from '@/api/supabaseClient';
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
  const [following, setFollowing] = useState([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

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

  useEffect(() => {
    if (!user?.email) return;
    // Per-mount unique channel name. Supabase's channel registry is keyed
    // by name — re-using the same string across re-mounts (React 18
    // StrictMode double-mount, fast nav-away-then-back, tab refocus that
    // re-runs the effect) hands back the ALREADY-subscribed channel
    // from a prior mount. Calling .on() on a subscribed channel throws
    // "cannot add `postgres_changes` callbacks after subscribe()" and
    // takes the whole Hub page down. Unique per-mount channel name
    // sidesteps the cache so each mount gets a fresh, never-subscribed
    // channel.
    const channelName = `hub_feed_new_posts_${user.email}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const myEmailLc = user.email.toLowerCase();
    const ch = supabase.channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hub_posts' }, (payload) => {
        // Only count if payload is a different user's post (avoid counting own)
        if (payload.new?.author_email?.toLowerCase() !== myEmailLc) {
          setPendingNewCount(c => c + 1);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch).catch(() => {}); };
  }, [user?.email]);

  // Reset visible count when switching tabs — start fresh at 8.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [feedTab]);

  // Load following list once for Squad/Following filtering.
  // Without the .catch(), a network blip leaves `following` permanently
  // empty and the Squad tab silently shows nothing — the user has no
  // idea their follow list didn't load.
  useEffect(() => {
    if (!user?.email) return;
    hubFollows.listFollowing(user.email)
      .then(setFollowing)
      .catch((err) => {
        reportError(err, { feature: 'hub.feed.list-following', level: 'warning', userEmail: user.email });
      });
  }, [user?.email]);

  const { data: allPosts = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['hubFeed', feedTab, user?.email, following.length],
    queryFn: async () => {
      if (feedTab === 'pump') {
        return hubPosts.fetchGlobalWindow();
      } else {
        return hubPosts.fetchFollowingWindow(following);
      }
    },
    enabled: !!user?.email,
    // 30s feels live without hammering the DB on every component mount.
    // Scroll-to-top refresh below calls refetch() explicitly, so we don't
    // need staleTime:0 — it was causing a fresh fetch on every Hub re-mount
    // (every tab switch back from a profile/composer overlay).
    staleTime: 30_000,
  });

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

  // Filter out crew-private posts the current user doesn't belong to,
  // posts from muted/blocked users, scheduled posts not yet published,
  // and apply hashtag filter when active.
  const filteredPosts = useMemo(() => {
    if (!allPosts.length) return allPosts;
    const crewSet  = new Set(myCrewIds);
    const muteSet  = new Set(mutedEmails);
    const blockSet = new Set(blockedEmails);
    let result = allPosts.filter(p => {
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
    return result;
  }, [allPosts, myCrewIds, mutedEmails, blockedEmails, activeHashtag]);

  // Trending hashtags derived from current feed window
  const trendingTags = useMemo(() => computeTrending(allPosts), [allPosts]);

  // ── Scroll-to-top refresh ────────────────────────────────────────────────
  // When the user scrolls back to the very top of the page (after having
  // scrolled down at least 60px) we trigger a fresh fetch. This gives the
  // "pull to refresh" feel on mobile without requiring a native gesture.
  const [showRefreshBadge, setShowRefreshBadge] = useState(false);

  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);

  useEffect(() => {
    let prevY = window.scrollY;
    const handleScroll = () => {
      const y = window.scrollY;
      if (prevY > 60 && y === 0) {
        refetchRef.current();
        setPendingNewCount(0);
        setShowRefreshBadge(true);
        setTimeout(() => setShowRefreshBadge(false), 1800);
        try { navigator.vibrate(10); } catch {}
      }
      prevY = y;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []); // intentionally empty — refetch is always up-to-date via refetchRef

  // Listen for the "active-tab retap" event from Layout — when the
  // user taps the Hub tab while already on Hub + at the top, treat it
  // as a manual refresh request (same outcome as the scroll-to-top
  // gesture). Standard Twitter/IG behavior.
  useEffect(() => {
    const onRetap = (e) => {
      if (e.detail?.path !== '/hub') return;
      refetchRef.current();
      setShowRefreshBadge(true);
      setTimeout(() => setShowRefreshBadge(false), 1800);
      try { navigator.vibrate?.(10); } catch { /* ignore */ }
    };
    window.addEventListener('flexyn:active-tab-retap', onRetap);
    return () => window.removeEventListener('flexyn:active-tab-retap', onRetap);
  }, []);

  // Slice the fetched + crew-filtered window to the visible page.
  const visiblePosts = useMemo(
    () => filteredPosts.slice(0, visibleCount),
    [filteredPosts, visibleCount]
  );

  const hasMore = visibleCount < filteredPosts.length;

  // Auto-load more when sentinel scrolls into view.
  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount(c => Math.min(c + PAGE_SIZE, filteredPosts.length));
        }
      },
      { rootMargin: '200px' } // pre-load slightly before the user reaches it
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, filteredPosts.length]);

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
    return (
      <div className="space-y-4">
        <EmptyState
          illustration={feedTab === 'pump' ? <NoFeedIllustration /> : <NoFriendsIllustration />}
          title={
            feedTab === 'pump'
              ? (tFallback('hub.empty.pumpTitle', 'No posts yet'))
              : isSquadWithFollowing
              ? (tFallback('hub.empty.squadNoPosts', "Your squad hasn't posted yet"))
              : (tFallback('hub.empty.squadTitle', 'Build your squad'))
          }
          body={
            feedTab === 'pump'
              ? (tFallback('hub.empty.pumpDesc', 'Be the first to share — your workouts inspire the rest of the community.'))
              : isSquadWithFollowing
              ? (tFallback('hub.empty.squadNoPostsDesc', "Your followed athletes haven't shared yet. Share your own session in the meantime!"))
              : (tFallback('hub.empty.squadDesc', 'Follow other athletes to see their workouts and progress here.'))
          }
          action={feedTab === 'pump' || isSquadWithFollowing ? ctaShare : ctaDiscover}
          secondaryAction={feedTab === 'pump' ? undefined : (isSquadWithFollowing ? ctaDiscover : ctaShare)}
        />
        {/* PYMK suggestion rail — shown on Squad empty state to help new users build their network */}
        {feedTab === 'squad' && (
          <PeopleYouMayKnow onSelectUser={(u) => navigate(`/hub?profile=${encodeURIComponent(u.email)}`)} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Go Live button ─────────────────────────────────────────────── */}
      <button
        onClick={() => setBroadcasterOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/5 text-red-500 text-sm font-semibold hover:bg-red-500/10 transition-colors"
      >
        <span className="relative flex w-2.5 h-2.5 shrink-0">
          <span className="absolute inline-flex w-full h-full rounded-full bg-red-500 opacity-60 animate-ping" />
          <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-red-500" />
        </span>
        <Radio className="w-4 h-4" />
        Go Live — broadcast your workout
      </button>

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
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors"
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
                    : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <Hash className="w-2.5 h-2.5" />
                {item.tag.replace('#', '')}
                <span className="opacity-60 text-[10px]">{item.count}</span>
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
              className="p-0.5 rounded text-primary/60 hover:text-primary transition-colors"
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
            onHashtagClick={(tag) => {
              setActiveHashtag(h => h === tag ? null : tag);
              setShowTrending(true);
              setVisibleCount(PAGE_SIZE);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </motion.div>
      ))}

      {/* Sentinel for auto-load */}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-6">
          <button
            onClick={() => setVisibleCount(c => Math.min(c + PAGE_SIZE, filteredPosts.length))}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary/50 hover:bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors"
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