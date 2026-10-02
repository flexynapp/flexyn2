// src/components/hub/FollowSuggestionRail.jsx
//
// Horizontal rail of popular active users to follow. Shown at the top
// of the Hub feed when the viewer has few or zero followees — the
// empty-feed trap is the #1 reason new users churn after activation.
// One tap per card to follow.
//
// SHOW POLICY
// ───────────
// Aggressively visible:
//   • Always render when the user has FEWER than 3 followees (the
//     "empty feed" condition). Even with the rail dismissed, we re-
//     show because the trap is still there.
//   • For users with 3+ followees, show only when they haven't
//     dismissed in the past 30 days.
//
// Backed by migration 091's get_suggested_followees() RPC. Each card
// shows username + avatar + follower count (social proof) + a live
// dot if the user is active right now (joins with the migration 088
// active_until column).

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, X, Loader2, Check } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';
import * as hubFollows from '@/lib/data/hubFollows';
import { invalidateFollowGraph } from '@/lib/followGraphCache';

const DISMISS_KEY = (userId) => `flexyn.followSuggestDismiss.${userId || 'anon'}`;
const DISMISS_TTL_DAYS = 30;

function readDismissedAt(userId) {
  try {
    const raw = localStorage.getItem(DISMISS_KEY(userId));
    if (!raw) return null;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return null;
    return ts;
  } catch { return null; }
}

function writeDismissedAt(userId) {
  try { localStorage.setItem(DISMISS_KEY(userId), String(Date.now())); }
  catch { /* best-effort */ }
}

function isDismissedFresh(userId) {
  const ts = readDismissedAt(userId);
  if (ts == null) return false;
  return (Date.now() - ts) < DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;
}

function SuggestedFolloweeCard({ user, onFollow, following, followed }) {
  const { tFallback } = useLanguage();
  const initial = (user.username || '?').slice(0, 1).toUpperCase();
  const isLive = user.active_until && new Date(user.active_until) > new Date();
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="shrink-0 snap-start w-32 rounded-2xl border border-border bg-card p-3 flex flex-col items-center gap-2"
    >
      <div className="relative">
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            className="w-12 h-12 rounded-full object-cover bg-secondary"
            loading="lazy"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-sm font-bold">
            {initial}
          </div>
        )}
        {isLive && (
          <span
            aria-hidden="true"
            className="absolute bottom-0 end-0 w-3 h-3 rounded-full bg-success ring-2 ring-card"
            title={tFallback("followSuggestionRail.workingOutRightNow", "Working out right now")}
          />
        )}
      </div>
      <div className="text-center min-w-0 w-full">
        <p className="text-xs font-semibold truncate">{user.username}</p>
        <p className="text-micro text-muted-foreground tabular-nums">
          {user.follower_count} {user.follower_count === 1 ? 'follower' : 'followers'}
        </p>
      </div>
      <button
        onClick={onFollow}
        disabled={following || followed}
        // Outline, not --primary: the rail shows three of these at once, and
        // three orange buttons beside the composer meant Hub had no single
        // primary action. The before: box grows the tap target to 44px tall
        // (it rendered 26px) without changing what is drawn.
        className={[
          "relative w-full flex items-center justify-center gap-1 py-1.5 rounded-md border text-micro font-bold transition-colors before:absolute before:content-[''] before:inset-x-0 before:-inset-y-[9px]",
          followed
            ? 'border-transparent bg-secondary text-muted-foreground'
            : 'border-border bg-background text-foreground hover:bg-secondary active:bg-secondary disabled:opacity-60',
        ].join(' ')}
      >
        {following ? (
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        ) : followed ? (
          <Check className="w-3 h-3" aria-hidden="true" />
        ) : (
          <UserPlus className="w-3 h-3" aria-hidden="true" />
        )}
        <span>{followed ? 'Following' : following ? '…' : 'Follow'}</span>
      </button>
    </motion.div>
  );
}

export default function FollowSuggestionRail() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [followingEmail, setFollowingEmail] = useState(null);
  const [justFollowed, setJustFollowed] = useState(() => new Set());

  // Self-managed follow count via a lightweight HEAD query — same
  // pattern as OnboardingNudgeCard. Stale-time long because follows
  // don't change fast and we already invalidate this key from
  // handleFollow below.
  const { data: followingCount = 0 } = useQuery({
    queryKey: ['onboardingFollowsCount', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { count } = await supabase
        .from('hub_follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_id', user.id);
      return count ?? 0;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  // Show conditions:
  //   • fewer than 3 followees → always show (empty-feed trap)
  //   • else                    → only when dismiss flag is stale / missing
  const isEmptyFeedTrap = followingCount < 3;
  const respectsDismissal = !isEmptyFeedTrap;
  const dismissed = respectsDismissal && isDismissedFresh(user?.id);

  const { data: rawSuggestions = [] } = useQuery({
    queryKey: ['suggestedFollowees', user?.id],
    queryFn: () => hubFollows.getSuggestedFollowees(8),
    enabled: !!user?.id && !dismissed,
    staleTime: 5 * 60_000,
  });

  // Pull the viewer's current following set so we can filter out rows
  // that the RPC didn't already exclude (it's unclear from the client
  // contract). Without this, an already-followed user could show up
  // in the rail with a "Follow" button that tap-toggles to no visible
  // change — the underlying `follow()` is idempotent but `justFollowed`
  // is session-only. (Audit 10 #61.)
  // Keyed on user_id, not on the address. The RPC still returns an `email`
  // column and this rail was the only reason it had to: the dedupe key, the
  // follow call and the button state all read it, so eight real addresses
  // crossed the wire on every Hub load for identification the id already
  // does. Migrations 218/220 closed exactly this for the sibling rail, whose
  // own comment states the rule — a suggestion card cannot leak an address.
  // Moving first means the column can then be dropped server-side without a
  // flag day; this code works either way.
  const { data: followingIds = [] } = useQuery({
    queryKey: ['hubFollowingIds', user?.id],
    queryFn: () => hubFollows.listFollowingIds(user.id),
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });
  const followingSet = React.useMemo(
    () => new Set((followingIds || []).map(String)),
    [followingIds]
  );
  const suggestions = React.useMemo(
    () => (rawSuggestions || []).filter(s => s.user_id && !followingSet.has(String(s.user_id))),
    [rawSuggestions, followingSet]
  );

  const handleDismiss = () => {
    writeDismissedAt(user?.id);
    // Force a re-render by invalidating — the dismissed gate now
    // suppresses the query, the rail disappears.
    qc.invalidateQueries({ queryKey: ['suggestedFollowees', user?.id] });
  };

  const handleFollow = async (followeeId) => {
    if (!user?.id || followingEmail) return;
    setFollowingEmail(followeeId);
    try {
      // follow() takes either shape — followMatch routes a uuid to
      // follower_id/followee_id and anything else to the email columns.
      await hubFollows.follow(user.id, followeeId);
      setJustFollowed(prev => {
        const next = new Set(prev);
        next.add(followeeId);
        return next;
      });
      // Update the feed-relevant queries so the new follow shows up
      // immediately in the timeline + the followee counter.
      qc.invalidateQueries({ queryKey: ['hubFeed'] });
      qc.invalidateQueries({ queryKey: ['onboardingFollowsCount', user.id] });
      qc.invalidateQueries({ queryKey: ['suggestedFollowees', user.id] });
      qc.invalidateQueries({ queryKey: ['hubFollowingIds', user.id] });
      invalidateFollowGraph(qc);
    } catch (err) {
      console.warn('[followSuggest] follow failed:', err?.message || err);
      toast.error(tFallback('followSuggest.failed', 'Could not follow. Try again.'));
    } finally {
      setFollowingEmail(null);
    }
  };

  if (!user?.id || dismissed || suggestions.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mb-3"
        role="region"
        aria-label={tFallback('followSuggest.aria', 'Suggested accounts to follow')}
      >
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
            <span className="kicker text-primary">
              {isEmptyFeedTrap
                ? tFallback('followSuggest.kickerEmpty', 'Build your feed')
                : tFallback('followSuggest.kicker', 'Suggested for you')}
            </span>
          </div>
          {!isEmptyFeedTrap && (
            <button
              onClick={handleDismiss}
              className="p-1 -me-1 rounded-md text-muted-foreground/70 hover:text-foreground active:text-foreground hover:bg-foreground/5 active:bg-foreground/5 transition-colors"
              aria-label={tFallback('followSuggest.dismiss', 'Hide suggestions for now')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {/* The rail scrolls, but nothing said so: the third card landed
            half-off the viewport with its username clipped mid-word
            ("seant") and its Follow button sliced down the middle, which
            reads as a broken layout rather than "there is more this way".
            Two cheap signals fix it — scroll-snap so a card always comes to
            rest whole, and a fade at the trailing edge so a partial card
            looks deliberate. The fade is inside a relative wrapper and
            pointer-events-none so it can never eat a tap on the card under
            it. Logical properties (start/end) keep both correct in RTL. */}
        <div className="relative">
          <div className="flex gap-2.5 overflow-x-auto pb-1 px-1 -mx-1 scrollbar-hide snap-x snap-mandatory">
            {suggestions.map((u) => (
              <SuggestedFolloweeCard
                key={u.user_id}
                user={u}
                following={followingEmail === u.user_id}
                followed={justFollowed.has(u.user_id)}
                onFollow={() => handleFollow(u.user_id)}
              />
            ))}
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 end-0 w-8 bg-gradient-to-l from-card to-transparent rtl:bg-gradient-to-r"
          />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
