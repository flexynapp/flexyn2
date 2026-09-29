// src/components/hub/FollowerActivityBanner.jsx
//
// Live "X just posted / X just hit a PR" ticker at the top of Hub.
// Listens to hub_posts INSERTs in real-time, filters to authors in
// the viewer's `following` list, and stacks the most recent 3 as
// ephemeral banners that auto-dismiss after 10s.
//
// Spec #27 — quieter than a push notification, warmer than nothing.
// Drives the "feed is alive" feel without algorithmic noise.
//
// Each banner shows:
//   • Avatar + display name
//   • A short summary of what they did, keyed on the row's `post_type`
//   • Tap → scroll the feed to that post + dismiss
//
// The user can dismiss a banner manually (X button) or it auto-fades
// after 10s. Banners stack vertically; max 3 visible at once. New ones
// push older ones out.

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, Trophy, Dumbbell, MessageCircle } from 'lucide-react';
import { onHubPostInsert } from '@/lib/hubPostsRealtime';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import * as hubFollows from '@/lib/data/hubFollows';
import { useLanguage } from '@/lib/LanguageContext';

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 10_000;

// What happened, keyed on `post_type` — the column the row actually has.
//
// This read `snap?.kind || post?.kind` and neither exists. `hub_posts` has no
// `kind` column, and no writer has ever put a `kind` key in
// `linked_entity_snapshot` (0 of 28 rows in production). `kind` is the
// COMPOSER's in-memory vocabulary; what gets persisted is `post_type`, and
// the two do not even agree — the composer maps its `goal` to `goal_completed`
// on the way in. So `kind` was always undefined, which fell through to the
// `!kind` branch, and every banner ever shown read "just posted".
//
// `post_type` is set on every row by every writer. `linked_entity_type` is a
// second, narrower source (null on status, repost and poll), so it is only a
// fallback here rather than the key.
const SUMMARY_BY_TYPE = {
  workout:        { key: 'hub.activityBanner.workout',       en: 'logged a workout',        icon: Dumbbell },
  cardio:         { key: 'hub.activityBanner.cardio',        en: 'finished cardio',         icon: Dumbbell },
  regimen:        { key: 'hub.activityBanner.regimen',       en: 'shared a program',        icon: Dumbbell },
  meal:           { key: 'hub.activityBanner.meal',          en: 'logged a meal',           icon: Sparkles },
  goal_completed: { key: 'hub.activityBanner.goalCompleted', en: 'completed a goal',        icon: Trophy },
  achievement:    { key: 'hub.activityBanner.achievement',   en: 'unlocked an achievement', icon: Trophy },
  stats:          { key: 'hub.activityBanner.stats',         en: 'shared their stats',      icon: Sparkles },
  progress_photo: { key: 'hub.activityBanner.progressPhoto', en: 'posted a progress photo', icon: Sparkles },
  video:          { key: 'hub.activityBanner.video',         en: 'posted a video',          icon: MessageCircle },
  poll:           { key: 'hub.activityBanner.poll',          en: 'started a poll',          icon: MessageCircle },
  repost:         { key: 'hub.activityBanner.repost',        en: 'reposted a post',         icon: MessageCircle },
  status:         { key: 'hub.activityBanner.status',        en: 'posted',                  icon: MessageCircle },
};
const SUMMARY_FALLBACK = SUMMARY_BY_TYPE.status;

function summarize(post) {
  const type = post?.post_type || post?.linked_entity_type;
  return SUMMARY_BY_TYPE[type] || SUMMARY_FALLBACK;
}

// `author_name` — `author_username` is not a column on hub_posts, so this
// returned the fallback for every post that has ever existed. Kept as a
// fallback rather than removed: author_name is NOT NULL today, but a name
// is display data and an empty string should not render as a blank banner.
function displayName(post, anonymous) {
  return post?.author_name || anonymous;
}

// Exported for the test: the two helpers ARE the defect surface here, and
// driving them directly is what pins the column names. The component itself
// only renders once a realtime INSERT arrives from someone you follow.
export const __test__ = { summarize, displayName, SUMMARY_BY_TYPE };

export default function FollowerActivityBanner() {
  const { user } = useAuth();
  const [banners, setBanners] = useState([]); // [{ id, post }]

  // Need the viewer's follow list (user ids) to filter incoming events.
  // Shares the same query key the Hub feed uses so we hit the same cache.
  const { data: followingIds = [] } = useQuery({
    queryKey: ['hubFollowing', user?.id],
    queryFn: () => hubFollows.listFollowingIds(user.id),
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const dismiss = useCallback((id) => {
    setBanners((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // Hold the follow set in a ref the realtime handler reads at fire time.
  // Keeping it out of the subscribe effect's deps means a React Query
  // refetch (which returns a new array reference) updates the filter
  // WITHOUT tearing down and re-subscribing the channel every time.
  const followingSetRef = useRef(new Set());
  useEffect(() => {
    followingSetRef.current = new Set((followingIds || []).filter(Boolean));
  }, [followingIds]);

  useEffect(() => {
    if (!user?.id) return;
    const myId = user.id;

    // Shared hub_posts INSERT subscription (one Realtime channel per
    // client, multiplexed with HubFeed — see src/lib/hubPostsRealtime.js).
    return onHubPostInsert((post) => {
      const author = post.user_id;
      if (!author || author === myId) return; // skip own
      if (!followingSetRef.current.has(author)) return; // not followed (read live from ref)
      const id = post.id || `${author}-${Date.now()}`;
      setBanners((prev) => {
        // Dedupe by post id (Realtime can fire duplicates on resub).
        if (prev.some((b) => b.id === id)) return prev;
        // Keep newest first; cap at MAX_VISIBLE.
        return [{ id, post }, ...prev].slice(0, MAX_VISIBLE);
      });
    });
  }, [user?.id]);

  // Auto-dismiss each banner after AUTO_DISMISS_MS. Per-banner timer
  // is set up in the banner's own effect (so manually dismissing one
  // doesn't cancel the others' timers).
  if (banners.length === 0) return null;

  return (
    <div className="fixed start-0 end-0 z-30 flex flex-col items-center gap-2 pointer-events-none px-3"
         style={{ top: 'calc(56px + env(safe-area-inset-top) + 8px)' }}
    >
      <AnimatePresence initial={false}>
        {banners.map((b) => (
          <BannerCard key={b.id} post={b.post} onDismiss={() => dismiss(b.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function BannerCard({ post, onDismiss }) {
  const { tFallback } = useLanguage();
  const { key, en, icon: Icon } = summarize(post);
  const text = tFallback(key, en);
  const name = displayName(post, tFallback('hub.activityBanner.someone', 'Someone'));

  useEffect(() => {
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const handleTap = () => {
    // Best-effort scroll to the post in the feed via a custom event.
    // HubFeed renders posts by id so any consumer that wants to
    // implement scroll-to-post can listen to this. For now, dismiss
    // is the side-effect.
    try {
      window.dispatchEvent(new CustomEvent('flexyn:hub-scroll-to-post', {
        detail: { postId: post?.id },
      }));
    } catch { /* ignore */ }
    onDismiss();
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className="pointer-events-auto w-full max-w-md bg-card/95 backdrop-blur-md border border-primary/30 rounded-xl shadow-lg flex items-center gap-2.5 px-3 py-2.5"
      role="status"
      aria-live="polite"
    >
      <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-primary" />
      </div>
      <button
        type="button"
        onClick={handleTap}
        className="flex-1 min-w-0 text-start"
      >
        <p className="text-xs font-semibold truncate">
          <span className="text-foreground">{name}</span>
          <span className="text-muted-foreground"> {text}</span>
        </p>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors"
        aria-label={tFallback("discovery.dismiss", "Dismiss")}
      >
        <X className="w-3 h-3" />
      </button>
    </motion.div>
  );
}
