// src/components/hub/PeopleYouMayKnow.jsx
// "People You May Know" discovery surface — rendered inside the Squad feed
// empty state and as a soft inline widget when the feed has fewer than 3 posts.
//
// Data: Supabase RPC `get_people_you_may_know` returns users with at least
// one mutual follower, hydrated from the `public_profiles` view. There is
// deliberately NO fallback — see the note on the query below.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { UserPlus, Loader2, Users } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';
import * as hubFollows from '@/lib/data/hubFollows';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { getTier } from '@/lib/xpTier';

export default function PeopleYouMayKnow({ onSelectUser }) {
  const { user } = useAuth();
  const { tFallback, t } = useLanguage();
  const [localFollowed, setLocalFollowed] = useState(new Set());

  // ── Suggestions come from the algorithm, or not at all ────────────────────
  //
  // This used to enumerate the entire user table. Twice, on two paths:
  //
  //   • The RPC branch fetched `db.entities.User.list()` — EVERY user — just
  //     to hydrate the 8 ids the RPC returned.
  //   • When the RPC returned no rows, a fallback listed every user, filtered
  //     out the ones you already follow, and showed the first 8.
  //
  // `get_people_you_may_know` (mig 218) is a mutuals-only algorithm: people
  // followed by people who follow you. On a sparse network that legitimately
  // returns EMPTY — which meant the fallback was the live path essentially
  // all the time, and "People you may know" was really "everyone who has an
  // account". Kegan flagged it as a privacy breach on 2026-08-05 and he is
  // right: a directory of every user is not a suggestion.
  //
  // The RPC itself is fine and does not need changing — it derives the viewer
  // from auth.uid() and ignores its own p_email parameter, which is the
  // correct shape (see the mig 108 note in CLAUDE.md).
  //
  // So: no fallback. If the algorithm has nothing, the component renders
  // nothing (`if (!candidates.length) return null` below). An empty rail is
  // the honest state for a new account, and it disappears on its own as soon
  // as the user follows a couple of people.
  //
  // Hydration reads `public_profiles`, not `user_profiles` — the view carries
  // no email, so a suggestion card cannot leak an address. Scoped with
  // .in('id', ids) so we fetch exactly the candidates and nothing else.
  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['pymk', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_people_you_may_know', {
        p_limit: 8,
      });
      if (rpcErr || !rpcData?.length) return [];

      const ids = rpcData.map(r => r.user_id).filter(Boolean);
      if (!ids.length) return [];
      const mutualMap = Object.fromEntries(rpcData.map(r => [r.user_id, r.mutual_count]));

      // "Hide from search" is enforced inside get_people_you_may_know as of
      // migration 377, so a hidden id should never reach this fetch. Filtered
      // here too: this is the half that ships with the frontend, and until the
      // migration is applied it is the only half that exists.
      const { data: profiles, error: profErr } = await supabase
        .from('public_profiles')
        .select('id, username, full_name, avatar_url, total_xp, current_level')
        .not('hide_from_search', 'is', true)
        .in('id', ids);
      if (profErr || !profiles?.length) return [];

      return profiles
        .filter(u => u.id !== user.id && !u.username?.startsWith('deleted_'))
        .map(u => ({ ...u, mutualCount: mutualMap[u.id] ?? 0 }))
        // Preserve the RPC's mutual-count ordering; .in() does not guarantee it.
        .sort((a, b) => (b.mutualCount || 0) - (a.mutualCount || 0))
        .slice(0, 8);
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
      <p className="text-micro font-semibold text-foreground text-center truncate w-full">@{username}</p>
      {candidate.mutualCount > 0 && (
        <p className="text-micro text-muted-foreground text-center leading-tight">
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
          className="flex items-center gap-0.5 px-2.5 py-1 rounded-lg text-micro font-bold text-primary-foreground bg-primary hover:opacity-90 transition-opacity disabled:opacity-60 w-full justify-center"
        >
          {adding ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <UserPlus className="w-2.5 h-2.5" />}
          Follow
        </button>
      ) : (
        <span className="text-micro text-primary font-semibold">✓ Following</span>
      )}
    </motion.div>
  );
}
