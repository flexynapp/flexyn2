// src/components/hub/PeopleYouMayKnow.jsx
// "People You May Know" discovery surface — rendered inside the Squad feed
// empty state and as a soft inline widget when the feed has fewer than 3 posts.
//
// Data: Supabase RPC `get_people_you_may_know` (migration 103) returns users
// with at least one mutual follower. Falls back to a recency-sorted sample
// from User.list() when the RPC is unavailable (new account, no mutuals).

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { UserPlus, Loader2, Users } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';
import { db } from '@/api/db';
import * as hubFollows from '@/lib/data/hubFollows';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { getTier } from '@/lib/xpTier';

export default function PeopleYouMayKnow({ onSelectUser }) {
  const { user } = useAuth();
  const { tFallback, t } = useLanguage();
  const [localFollowed, setLocalFollowed] = useState(new Set());

  // Fetch PYMK candidates from RPC, fall back to User.list()
  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['pymk', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      // Try RPC first — it now returns user_id (mig 218), so candidates
      // hydrate by id and we never match users.list() rows on email.
      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_people_you_may_know', {
        p_limit: 8,
      });
      if (!rpcErr && rpcData?.length) {
        const allUsers = await db.entities.User.list().catch(() => []);
        const idSet = new Set(rpcData.map(r => r.user_id));
        const mutualMap = Object.fromEntries(rpcData.map(r => [r.user_id, r.mutual_count]));
        return allUsers
          .filter(u => idSet.has(u.id) && u.id !== user.id && !u.username?.startsWith('deleted_'))
          .map(u => ({ ...u, mutualCount: mutualMap[u.id] ?? 0 }))
          .slice(0, 8);
      }
      // Fallback: recent users not yet followed (id-keyed)
      const [allUsers, followingIds] = await Promise.all([
        db.entities.User.list().catch(() => []),
        hubFollows.listFollowingIds(user.id).catch(() => []),
      ]);
      const followSet = new Set(followingIds);
      return allUsers
        .filter(u => u.id !== user.id && !followSet.has(u.id) && !u.username?.startsWith('deleted_'))
        .slice(0, 8)
        .map(u => ({ ...u, mutualCount: 0 }));
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-bold">{tFallback('hub.pymk.title', 'People you may know')}</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[0,1,2].map(i => (
            <div key={i} className="flex flex-col items-center gap-1.5 shrink-0 w-20 animate-pulse">
              <div className="w-12 h-12 rounded-full bg-muted" />
              <div className="h-2.5 bg-muted rounded w-14" />
              <div className="h-5 bg-muted rounded w-12" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!candidates.length) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-primary" />
        <span className="text-sm font-bold">{tFallback('hub.pymk.title', 'People you may know')}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory">
        {candidates.map((candidate, i) => (
          <PYMKCard
            key={candidate.id}
            candidate={candidate}
            isFollowed={localFollowed.has(candidate.id)}
            delay={i * 0.05}
            onFollow={async () => {
              setLocalFollowed(prev => new Set([...prev, candidate.id]));
              await hubFollows.follow(user.id, candidate.id, { t }).catch(() => {
                setLocalFollowed(prev => {
                  const next = new Set(prev);
                  next.delete(candidate.id);
                  return next;
                });
              });
            }}
            onSelect={() => onSelectUser?.({ id: candidate.id, username: candidate.username })}
          />
        ))}
      </div>
    </div>
  );
}

function PYMKCard({ candidate, isFollowed, delay, onFollow, onSelect }) {
  const { t } = useLanguage();
  const [adding, setAdding] = useState(false);
  const userXp = Number(candidate.total_xp) || 0;
  const levelData = calculateLevelFromXp(userXp);
  const tier = getTier(levelData.level, t);
  const username = candidate.username || 'athlete';
  const initials = username.slice(0, 2).toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      className="flex flex-col items-center gap-1.5 shrink-0 w-20 snap-start"
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden ring-2 hover:ring-primary/50 transition-all"
        style={{ ringColor: tier.text.replace('text-', '') }}
      >
        {candidate.avatar_url ? (
          <img loading="lazy" src={candidate.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="font-heading font-bold text-sm text-primary">{initials}</span>
        )}
      </button>
      <p className="text-[11px] font-semibold text-foreground text-center truncate w-full">@{username}</p>
      {candidate.mutualCount > 0 && (
        <p className="text-[9px] text-muted-foreground text-center leading-tight">
          {candidate.mutualCount} mutual
        </p>
      )}
      {!isFollowed ? (
        <button
          onClick={async () => {
            if (adding) return;
            setAdding(true);
            await onFollow();
            setAdding(false);
          }}
          disabled={adding}
          className="flex items-center gap-0.5 px-2.5 py-1 rounded-lg text-[10px] font-bold text-primary-foreground bg-primary hover:opacity-90 transition-opacity disabled:opacity-60 w-full justify-center"
        >
          {adding ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <UserPlus className="w-2.5 h-2.5" />}
          Follow
        </button>
      ) : (
        <span className="text-[10px] text-primary font-semibold">✓ Following</span>
      )}
    </motion.div>
  );
}
