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
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';
import * as hubFollows from '@/lib/data/hubFollows';

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
  const initial = (user.username || '?').slice(0, 1).toUpperCase();
  const isLive = user.active_until && new Date(user.active_until) > new Date();
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="shrink-0 w-32 rounded-2xl border border-border bg-card p-3 flex flex-col items-center gap-2"
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
            className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-card"
            title="Working out right now"
          />
        )}
      </div>
      <div className="text-center min-w-0 w-full">
        <p className="text-xs font-semibold truncate">{user.username}</p>
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {user.follower_count} {user.follower_count === 1 ? 'follower' : 'followers'}
        </p>
      </div>
      <button
        onClick={onFollow}
        disabled={following || followed}
        className={[
          'w-full flex items-center justify-center gap-1 py-1.5 rounded-md text-[11px] font-bold transition-colors',
          followed
            ? 'bg-secondary text-muted-foreground'
            : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60',
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
    queryKey: ['onboardingFollowsCount', user?.email],
    queryFn: async () => {
      if (!user?.email) return 0;
      const { count } = await supabase
        .from('hub_follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_email', user.email);
      return count ?? 0;
    },
    enabled: !!user?.email,
    staleTime: 5 * 60_000,
  });

  // Show conditions:
  //   • fewer than 3 followees → always show (empty-feed trap)
  //   • else                    → only when dismiss flag is stale / missing
  const isEmptyFeedTrap = followingCount < 3;
  const respectsDismissal = !isEmptyFeedTrap;
  const dismissed = respectsDismissal && isDismissedFresh(user?.id);

  const { data: suggestions = [] } = useQuery({
    queryKey: ['suggestedFollowees', user?.id],
    queryFn: () => hubFollows.getSuggestedFollowees(8),
    enabled: !!user?.id && !dismissed,
    staleTime: 5 * 60_000,
  });

  const handleDismiss = () => {
    writeDismissedAt(user?.id);
    // Force a re-render by invalidating — the dismissed gate now
    // suppresses the query, the rail disappears.
    qc.invalidateQueries({ queryKey: ['suggestedFollowees', user?.id] });
  };

  const handleFollow = async (followeeEmail) => {
    if (!user?.email || followingEmail) return;
    setFollowingEmail(followeeEmail);
    try {
      await hubFollows.follow(user.email, followeeEmail);
      setJustFollowed(prev => {
        const next = new Set(prev);
        next.add(followeeEmail);
        return next;
      });
      // Update the feed-relevant queries so the new follow shows up
      // immediately in the timeline + the followee counter.
      qc.invalidateQueries({ queryKey: ['hubFeed'] });
      qc.invalidateQueries({ queryKey: ['onboardingFollowsCount', user.email] });
      qc.invalidateQueries({ queryKey: ['suggestedFollowees', user.id] });
    } catch (err) {
      console.warn('[followSuggest] follow failed:', err?.message || err);
      toast.error(tFallback('followSuggest.failed', 'Could not follow — try again.'));
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
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
              {isEmptyFeedTrap
                ? tFallback('followSuggest.kickerEmpty', 'Build your feed')
                : tFallback('followSuggest.kicker', 'Suggested for you')}
            </span>
          </div>
          {!isEmptyFeedTrap && (
            <button
              onClick={handleDismiss}
              className="p-1 -mr-1 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-colors"
              aria-label={tFallback('followSuggest.dismiss', 'Hide suggestions for now')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex gap-2.5 overflow-x-auto pb-1 px-1 -mx-1 no-scrollbar">
          {suggestions.map((u) => (
            <SuggestedFolloweeCard
              key={u.user_id}
              user={u}
              following={followingEmail === u.email}
              followed={justFollowed.has(u.email)}
              onFollow={() => handleFollow(u.email)}
            />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
