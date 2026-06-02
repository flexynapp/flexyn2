// src/components/stories/QuickAddSection.jsx
//
// Shown below the stories strip when the user follows ≤1 friend.
// Fetches friend-of-friend (or recent) recommendations and displays
// up to 6 cards with a one-tap Add button.

import React, { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import * as hubFollows from '@/lib/data/hubFollows';

function AvatarImage({ avatarUrl, username }) {
  const initials = (username || '?').slice(0, 2).toUpperCase();
  if (avatarUrl) {
    return (
      <img loading="lazy" src={avatarUrl}
        alt={username}
        className="w-full h-full object-cover rounded-full"
        draggable={false}
      />
    );
  }
  return (
    <div className="w-full h-full rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-muted-foreground select-none">
      {initials}
    </div>
  );
}

function RecommendCard({ profile, userEmail, onAdded }) {
  const [state, setState] = useState('idle'); // idle | adding | added

  const handleAdd = useCallback(async () => {
    if (state !== 'idle') return;
    setState('adding');
    try {
      await hubFollows.follow(userEmail, profile.email);
      setState('added');
      onAdded(profile.email);
    } catch {
      toast.error('Could not add — try again.');
      setState('idle');
    }
  }, [state, userEmail, profile.email, onAdded]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-3 py-2.5 px-1"
    >
      <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 ring-1 ring-border">
        <AvatarImage avatarUrl={profile.avatar_url} username={profile.username} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate leading-tight">
          @{profile.username}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">
          {profile.email}
        </p>
      </div>

      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={handleAdd}
        disabled={state !== 'idle'}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-colors ${
          state === 'added'
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary text-primary-foreground'
        }`}
      >
        {state === 'adding' && <Loader2 className="w-3 h-3 animate-spin" />}
        {state === 'added'  && <Check className="w-3 h-3" />}
        {state === 'idle'   && <UserPlus className="w-3 h-3" />}
        {state === 'added' ? 'Following' : state === 'adding' ? '' : 'Add'}
      </motion.button>
    </motion.div>
  );
}

export default function QuickAddSection({ userEmail, followingEmails }) {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);

  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ['quickAdd', userEmail, followingEmails.join(',')],
    queryFn:  () => hubFollows.getRecommendations(userEmail, followingEmails, 6),
    enabled:  !!userEmail && !dismissed,
    staleTime: 5 * 60_000,
  });

  const handleAdded = useCallback((email) => {
    // Canonical follow-state cache key — see StoriesRow.jsx for context.
    queryClient.invalidateQueries({ queryKey: ['hubFollowing'] });
    queryClient.invalidateQueries({ queryKey: ['storiesFeed'] });
    queryClient.invalidateQueries({ queryKey: ['quickAdd'] });
  }, [queryClient]);

  if (dismissed) return null;
  if (!isLoading && recommendations.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border border-border bg-card px-4 pt-3.5 pb-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          People you may know
        </p>
        <button
          onClick={() => setDismissed(true)}
          className="text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        >
          Dismiss
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        </div>
      ) : (
        <AnimatePresence initial={false}>
          <div className="divide-y divide-border/50">
            {recommendations.map(profile => (
              <RecommendCard
                key={profile.email}
                profile={profile}
                userEmail={userEmail}
                onAdded={handleAdded}
              />
            ))}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
