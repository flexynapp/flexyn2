// src/components/hub/LiveActivityRail.jsx
//
// Horizontal rail of followees who are working out RIGHT NOW. Backed
// by migration 088's get_active_followees() RPC. Pulses a green dot
// next to each active user's avatar; tap navigates to their profile.
//
// Surfaces "live activity" presence at the top of the Hub feed — the
// place users land when they want to socially graze. Drives FOMO and
// copy-cat workouts: seeing two friends actively training right now
// is a stronger motivator than reading about a post-hoc workout log.
//
// Auto-hides when nobody is active. Polls every 60 s while mounted;
// faster intervals would burn battery without meaningful UX gain
// (the 90-min TTL means presence changes infrequently anyway).

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { getActiveFollowees } from '@/lib/data/activity';

function ActiveAvatar({ user, onClick }) {
  const initial = (user.username || '?').slice(0, 1).toUpperCase();
  return (
    <button
      onClick={onClick}
      className="shrink-0 group flex flex-col items-center gap-1 max-w-[64px]"
      aria-label={`${user.username} is working out right now`}
    >
      <div className="relative">
        {/* Pulsing emerald ring outside the avatar — the "live" tell. */}
        <span
          aria-hidden="true"
          className="absolute -inset-0.5 rounded-full bg-success/40 animate-ping"
        />
        <span
          aria-hidden="true"
          className="absolute -inset-0.5 rounded-full ring-2 ring-success"
        />
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            className="relative w-12 h-12 rounded-full object-cover bg-secondary"
            loading="lazy"
          />
        ) : (
          <div className="relative w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-foreground">
            {initial}
          </div>
        )}
        {/* Tiny green dot on the bottom-right corner for an additional
            unambiguous "online" signal at small sizes. */}
        <span
          aria-hidden="true"
          className="absolute bottom-0 end-0 w-3 h-3 rounded-full bg-success ring-2 ring-background"
        />
      </div>
      <span className="text-micro font-medium text-foreground truncate w-full text-center group-hover:text-primary transition-colors">
        {user.username}
      </span>
    </button>
  );
}

export default function LiveActivityRail() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const navigate = useNavigate();

  const { data: actives = [] } = useQuery({
    queryKey: ['activeFollowees', user?.id],
    queryFn: getActiveFollowees,
    enabled: !!user?.id,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!user?.id || actives.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mb-3"
        role="region"
        aria-label={tFallback('liveActivity.aria', 'Friends working out right now')}
      >
        <div className="flex items-center gap-1.5 mb-2 px-1">
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex w-full h-full rounded-full bg-success opacity-75 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-success" />
          </span>
          <span className="text-micro font-bold uppercase tracking-[0.18em] text-success">
            {tFallback('liveActivity.title', 'Live now')}
          </span>
          <span className="text-micro text-muted-foreground">
            {actives.length === 1
              ? tFallback('liveActivity.oneActive', '1 friend training')
              : tFallback('liveActivity.nActive', '{count} friends training', { count: actives.length })}
          </span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 px-1 -mx-1 scrollbar-hide">
          {actives.map((u) => (
            <ActiveAvatar
              key={u.user_id}
              user={u}
              onClick={() => {
                // Canonical profile route is /hub?profile=<email>. The
                // original code routed to /hub/profile/<user_id> which
                // doesn't exist anywhere in App.jsx — every tap landed
                // on a blank page. (Audit 10 #2.)
                //
                // Migration 149 added `email` to get_active_followees
                // return. If the user has applied 149: u.email is set
                // and we navigate cleanly. If they haven't: fall back
                // to username — the search/profile resolver tolerates
                // either as a fuzzy match (better than 404).
                const target = u.user_id || u.email || u.username;
                if (!target) return;
                navigate(`/hub?profile=${encodeURIComponent(target)}`);
              }}
            />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
