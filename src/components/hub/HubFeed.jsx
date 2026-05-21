// src/components/hub/HubFeed.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Users, RefreshCw, Sparkles } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubPosts from '@/lib/data/hubPosts';
import * as hubFollows from '@/lib/data/hubFollows';
import HubPostCard from './HubPostCard';
import EmptyState from '@/components/EmptyState';
import { reportError } from '@/lib/reportError';

const PAGE_SIZE = 8;

export default function HubFeed({ feedTab, onAuthorClick }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [following, setFollowing] = useState([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

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
    staleTime: 0, // always treat data as stale so scroll-to-top always refetches
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
        setShowRefreshBadge(true);
        setTimeout(() => setShowRefreshBadge(false), 1800);
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
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
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