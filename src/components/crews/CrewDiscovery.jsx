// src/components/crews/CrewDiscovery.jsx
//
// Discover and join public crews.
// Shown as the "Discover" tab in CrewsSection when the user has no crew
// or explicitly switches to discovery.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Globe2, Plus, Loader2, ArrowLeft, Shield } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import * as crewsData from '@/lib/data/crews';
import { toast } from '@/lib/toast';
import { useNumberFormatter } from '@/lib/intl';

// Matches the crew list card and the Crew page header: crest, name, then
// one text line for identity and one for scale. No icon beside the count —
// see docs/profile-ui-premium-research.md.
function CrewResult({ crew, onJoin, alreadyJoining, blocked }) {
  const fmt = useNumberFormatter();
  const known = typeof crew._memberCount === 'number';
  const max   = crew.max_capacity ?? 16;
  const full  = known && crew._memberCount >= max;
  const disabled = full || alreadyJoining || blocked;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 p-4 rounded-2xl bg-card"
    >
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden"
        style={{ background: 'hsl(var(--primary) / 0.15)' }}
      >
        {crew.avatar_url
          ? <img loading="lazy" src={crew.avatar_url} alt="" className="w-full h-full object-cover" draggable={false} />
          : <Shield className="w-6 h-6" style={{ color: 'hsl(var(--primary))' }} />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-base text-foreground truncate leading-tight">
          {crew.name}
        </p>

        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {crew.tag ? <>#{crew.tag} · </> : null}
          {known ? `${fmt(crew._memberCount)} of ${fmt(max)}` : `up to ${fmt(max)}`}
          {full ? ' · full' : ''}
        </p>

        {crew.description && (
          <p className="text-xs text-muted-foreground/80 truncate mt-1">{crew.description}</p>
        )}
      </div>

      <motion.button
        whileTap={disabled ? undefined : { scale: 0.94 }}
        onClick={() => !disabled && onJoin(crew.id)}
        disabled={disabled}
        className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40 transition-opacity"
        style={{ background: 'hsl(var(--primary))' }}
      >
        {alreadyJoining
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Plus className="w-3.5 h-3.5" />
        }
        {full ? 'Full' : 'Join'}
      </motion.button>
    </motion.div>
  );
}

export default function CrewDiscovery({ onBack, onJoined }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [query, setQuery]   = useState('');
  const [joiningId, setJoiningId] = useState(null);

  // One crew per user (migration 252). The server refuses either way, but a
  // Join button that always errors is worse than one that says why.
  const { data: myCrews = [] } = useQuery({
    queryKey: ['myCrews', user?.id],
    queryFn:  () => crewsData.getMyCrews(user.id),
    enabled:  !!user?.id,
    staleTime: 15_000,
  });
  const inACrew = myCrews.length > 0;

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['crewDiscovery', query],
    queryFn:  () => crewsData.searchPublicCrews(query, user?.id),
    staleTime: 15_000,
    enabled: true,
  });

  const joinMut = useMutation({
    mutationFn: (crewId) => crewsData.joinCrew(crewId, user.id),
    onMutate:   (crewId) => setJoiningId(crewId),
    onSuccess:  (res) => {
      setJoiningId(null);
      qc.invalidateQueries({ queryKey: ['crewDiscovery'] });

      // Migration 250: a private crew queues you for approval instead of
      // seating you. Claiming "you joined" and then showing no crew would
      // read as a bug, so the three outcomes get three different messages.
      if (res?.status === 'requested') {
        toast.success('Request sent', {
          description: 'A crew leader will approve or decline it.',
        });
        return;
      }
      if (res?.status === 'pending') {
        toast.info('Your request is still waiting on a leader.');
        return;
      }

      toast.success('You joined the Crew! 🎉');
      qc.invalidateQueries({ queryKey: ['myCrews', user?.id] });
      onJoined?.();
    },
    onError: (err) => {
      toast.error('Could not join crew', { description: err.message });
      setJoiningId(null);
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border shrink-0">
        <button onClick={onBack} className="text-muted-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1.5">
          <Globe2 className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-heading font-bold text-base">Discover Crews</h2>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-3 shrink-0">
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or #tag…"
            className="w-full ps-9 pe-4 py-2.5 rounded-xl border border-border bg-secondary/50 text-sm focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground"
          />
          {isFetching && (
            <Loader2 className="absolute end-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {inACrew && (
        <p className="px-4 pb-3 text-xs text-muted-foreground leading-relaxed shrink-0">
          You're already in {myCrews[0]?.name ?? 'a Crew'}. Leave it from the Crew
          page to join another — one crew at a time keeps a war score honest.
        </p>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-2.5">
        {!isFetching && results.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-14"
          >
            <Globe2 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-semibold text-muted-foreground">No public crews found</p>
            {query && (
              <p className="text-xs text-muted-foreground mt-1">Try a different name or tag</p>
            )}
          </motion.div>
        )}
        <AnimatePresence initial={false}>
          {results.map(crew => (
            <CrewResult
              key={crew.id}
              crew={crew}
              onJoin={(id) => joinMut.mutate(id)}
              alreadyJoining={joiningId === crew.id && joinMut.isPending}
              blocked={inACrew}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
