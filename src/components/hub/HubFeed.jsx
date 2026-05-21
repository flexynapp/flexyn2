// src/components/hub/HubFeed.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Users, RefreshCw, Sparkles, ArrowUp } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubPosts from '@/lib/data/hubPosts';
import * as hubFollows from '@/lib/data/hubFollows';
import { supabase } from '@/api/supabaseClient';
import HubPostCard from './HubPostCard';
import EmptyState from '@/components/EmptyState';
import { reportError } from '@/lib/reportError';

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
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [following, setFollowing] = useState([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

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

  // Slice the fetched window to the visible page.
  const visiblePosts = useMemo(
    () => allPosts.slice(0, visibleCount),
    [allPosts, visibleCount]
  );

  const hasMore = visibleCount < allPosts.length;

  // Auto-load more when sentinel scrolls into view.
  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount(c => Math.min(c + PAGE_SIZE, allPosts.length));
        }
      },
      { rootMargin: '200px' } // pre-load slightly before the user reaches it
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, allPosts.length]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <PostSkeleton key={i} />)}
      </div>
    );
  }

  if (allPosts.length === 0) {
    const isSquadWithFollowing = feedTab === 'squad' && following.length > 0;
    // Friendly empty state with an actionable CTA — previously was just text.
    // The right next step depends on the surface:
    //   - Pump empty: encourage the user to make the first post (everyone
    //     starts here once, including the very first user on the platform).
    //   - Squad empty (no follows): point to discover/search for people.
    //   - Squad empty (has follows but no posts yet): same CTA as Pump —
    //     posting yourself fills your own Squad feed too.
    const ctaShare = {
      label: t('hub.empty.cta.share') === 'hub.empty.cta.share' ? 'Share a workout' : t('hub.empty.cta.share'),
      onClick: () => navigate('/workout'),
    };
    const ctaDiscover = {
      label: t('hub.empty.cta.discover') === 'hub.empty.cta.discover' ? 'Find athletes' : t('hub.empty.cta.discover'),
      // Squad empty discovery → the search overlay handles it; we route to
      // /hub which is already on /hub, but resetting the section state via
      // a query param tells Hub.jsx to open the search overlay.
      onClick: () => navigate('/hub?search=open'),
    };
    return (
      <EmptyState
        icon={feedTab === 'pump' ? Sparkles : Users}
        title={
          feedTab === 'pump'
            ? (t('hub.empty.pumpTitle') === 'hub.empty.pumpTitle' ? 'No posts yet' : t('hub.empty.pumpTitle'))
            : isSquadWithFollowing
            ? (t('hub.empty.squadNoPosts') === 'hub.empty.squadNoPosts' ? "Your squad hasn't posted yet" : t('hub.empty.squadNoPosts'))
            : (t('hub.empty.squadTitle') === 'hub.empty.squadTitle' ? 'Build your squad' : t('hub.empty.squadTitle'))
        }
        body={
          feedTab === 'pump'
            ? (t('hub.empty.pumpDesc') === 'hub.empty.pumpDesc' ? 'Be the first to share — your workouts inspire the rest of the community.' : t('hub.empty.pumpDesc'))
            : isSquadWithFollowing
            ? (t('hub.empty.squadNoPostsDesc') === 'hub.empty.squadNoPostsDesc' ? 'Your followed athletes haven\'t shared yet. Share your own session in the meantime!' : t('hub.empty.squadNoPostsDesc'))
            : (t('hub.empty.squadDesc') === 'hub.empty.squadDesc' ? 'Follow other athletes to see their workouts and progress here.' : t('hub.empty.squadDesc'))
        }
        action={feedTab === 'pump' || isSquadWithFollowing ? ctaShare : ctaDiscover}
        secondaryAction={feedTab === 'pump' ? undefined : (isSquadWithFollowing ? ctaDiscover : ctaShare)}
      />
    );
  }

  return (
    <div className="space-y-3">
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
          <HubPostCard post={post} onAuthorClick={onAuthorClick} />
        </motion.div>
      ))}

      {/* Sentinel for auto-load */}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-6">
          <button
            onClick={() => setVisibleCount(c => Math.min(c + PAGE_SIZE, allPosts.length))}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary/50 hover:bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            {t('hub.feed.loadingMore')}
          </button>
        </div>
      )}

      {/* End of window marker */}
      {!hasMore && allPosts.length >= PAGE_SIZE && (
        <p className="text-center text-xs text-muted-foreground py-6">
          {t('hub.feed.allCaughtUp')}
        </p>
      )}
    </div>
  );
}