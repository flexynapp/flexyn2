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
//   • A short summary of what they did (goal completion / workout /
//     plain post) read from the post's linked_entity_snapshot
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

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 10_000;

// Map the post snapshot to a "what happened" summary + icon. Falls
// back to a generic "just posted" when we can't classify the kind.
function summarize(post) {
  const snap = post?.linked_entity_snapshot;
  // Per-kind summaries. Conservative — if we can't extract clear
  // detail, default to a generic phrase rather than risk wrong copy.
  const kind = snap?.kind || post?.kind;
  if (kind === 'goal') {
    const label = snap?.summary || snap?.goal_name || 'a goal';
    return { text: `crushed ${label}`, icon: Trophy };
  }
  if (kind === 'workout') {
    return { text: 'just logged a workout', icon: Dumbbell };
  }
  if (kind === 'cardio') {
    return { text: 'just finished cardio', icon: Dumbbell };
  }
  if (kind === 'status' || !kind) {
    return { text: 'just posted', icon: MessageCircle };
  }
  if (kind === 'meal') {
    return { text: 'logged a meal', icon: Sparkles };
  }
  return { text: 'just shared', icon: Sparkles };
}

function displayName(post) {
  return post?.author_username || 'Someone';
}

export default function FollowerActivityBanner() {
  const { user } = useAuth();
  const [banners, setBanners] = useState([]); // [{ id, post }]

  // Need the viewer's follow list to filter incoming events. Shares
  // the same query key the Hub feed uses so we hit the same cache.
  const { data: followingEmails = [] } = useQuery({
    queryKey: ['hubFollowing', user?.email],
    queryFn: () => hubFollows.listFollowing(user.email),
    enabled: !!user?.email,
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
    followingSetRef.current = new Set((followingEmails || []).map((e) => e.toLowerCase()));
  }, [followingEmails]);

  useEffect(() => {
    if (!user?.email) return;
    const myEmailLc = user.email.toLowerCase();

    // Shared hub_posts INSERT subscription (one Realtime channel per
    // client, multiplexed with HubFeed — see src/lib/hubPostsRealtime.js).
    return onHubPostInsert((post) => {
      const author = (post.author_email || '').toLowerCase();
      if (author === myEmailLc) return; // skip own
      if (!followingSetRef.current.has(author)) return; // not followed (read live from ref)
      const id = post.id || `${author}-${Date.now()}`;
      setBanners((prev) => {
        // Dedupe by post id (Realtime can fire duplicates on resub).
        if (prev.some((b) => b.id === id)) return prev;
        // Keep newest first; cap at MAX_VISIBLE.
        return [{ id, post }, ...prev].slice(0, MAX_VISIBLE);
      });
    });
  }, [user?.email]);

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
  const { text, icon: Icon } = summarize(post);
  const name = displayName(post);

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
        aria-label="Dismiss"
      >
        <X className="w-3 h-3" />
      </button>
    </motion.div>
  );
}
