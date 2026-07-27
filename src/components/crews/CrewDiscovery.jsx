// src/components/crews/CrewDiscovery.jsx
//
// Discover and join public crews.
// Shown as the "Discover" tab in CrewsSection when the user has no crew
// or explicitly switches to discovery.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Globe2, Users, Plus, Loader2, ArrowLeft, Shield } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import * as crewsData from '@/lib/data/crews';
import { toast } from '@/lib/toast';

function CrewResult({ crew, onJoin, joining, alreadyJoining }) {
  const memberCount = crew._memberCount ?? '…';
  const max = crew.max_capacity ?? 16;
  const full = typeof crew._memberCount === 'number' && crew._memberCount >= max;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 p-3.5 rounded-2xl bg-card border border-border"
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'hsl(var(--primary) / 0.12)' }}
      >
        <Shield className="w-5 h-5" style={{ color: 'hsl(var(--primary))' }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="font-semibold text-sm text-foreground truncate">{crew.name}</p>
          {crew.tag && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium shrink-0">
              #{crew.tag}
            </span>
          )}
        </div>
        {crew.description && (
          <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">{crew.description}</p>
        )}
        <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
          <Users className="w-3 h-3" />
          {memberCount} / {max} members
          {full && <span className="text-rose-500 font-medium ms-1">Full</span>}
        </p>
      </div>

      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={() => !full && onJoin(crew.id)}
        disabled={full || alreadyJoining}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white disabled:opacity-40 transition-opacity"
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
              joining={joinMut.isPending}
              alreadyJoining={joiningId === crew.id && joinMut.isPending}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
