// src/components/crews/CrewsSection.jsx
//
// Main Crews entry point rendered inside Hub when feedTab === 'crews'.
// States: empty (no crews) → crew list → crew chat view → creation flow

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Plus, Users, ChevronRight, Loader2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import * as crewsData from '@/lib/data/crews';
import CrewChat from './CrewChat';
import CrewCreationFlow from './CrewCreationFlow';

function CrewCard({ crew, onClick }) {
  const { data: members = [] } = useQuery({
    queryKey: ['crewMembers', crew.id],
    queryFn:  () => crewsData.getCrewMembers(crew.id),
    staleTime: 30_000,
  });

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="w-full flex items-center gap-3 p-4 rounded-2xl bg-card border border-border text-left"
    >
      {/* Icon */}
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'hsl(var(--primary) / 0.12)' }}
      >
        <Shield className="w-5 h-5" style={{ color: 'hsl(var(--primary))' }} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-sm text-foreground truncate">{crew.name}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
          <Users className="w-3 h-3" />
          {members.length} / {crew.max_capacity ?? 16} members
          {crew.is_admin && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide"
              style={{ background: 'hsl(var(--primary) / 0.15)', color: 'hsl(var(--primary))' }}>
              Admin
            </span>
          )}
        </p>
      </div>

      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </motion.button>
  );
}

export default function CrewsSection({ initialCrewId }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeCrew, setActiveCrew] = useState(null);
  const [creating, setCreating]     = useState(false);

  // Auto-open crew from deep-link (flexyn:open-crew custom event handled in Hub.jsx)
  const { data: myCrews = [], isLoading } = useQuery({
    queryKey: ['myCrews', user?.id],
    queryFn:  () => crewsData.getMyCrews(user.id),
    enabled:  !!user?.id,
    staleTime: 15_000,
    onSuccess: (crews) => {
      if (initialCrewId && !activeCrew) {
        const target = crews.find(c => c.id === initialCrewId);
        if (target) setActiveCrew(target);
      }
    },
  });

  const handleCreated = (crew) => {
    setCreating(false);
    qc.invalidateQueries({ queryKey: ['myCrews', user?.id] });
    setActiveCrew({ ...crew, is_admin: true });
  };

  // Relay open-crew deep-link
  React.useEffect(() => {
    const handler = (e) => {
      const { crewId } = e.detail || {};
      if (!crewId) return;
      const found = myCrews.find(c => c.id === crewId);
      if (found) setActiveCrew(found);
    };
    window.addEventListener('flexyn:open-crew', handler);
    return () => window.removeEventListener('flexyn:open-crew', handler);
  }, [myCrews]);

  // ── Crew chat view ────────────────────────────────────────────────────────────
  if (activeCrew) {
    return (
      <div className="relative" style={{ height: 'calc(100dvh - 200px)', minHeight: 360 }}>
        <CrewChat
          crew={activeCrew}
          onBack={() => setActiveCrew(null)}
        />
      </div>
    );
  }

  // ── Creation flow ─────────────────────────────────────────────────────────────
  if (creating) {
    return (
      <div className="relative" style={{ height: 'calc(100dvh - 200px)', minHeight: 360 }}>
        <CrewCreationFlow
          onCreated={handleCreated}
          onClose={() => setCreating(false)}
        />
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (myCrews.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex flex-col items-center justify-center py-20 px-8 text-center"
      >
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
          style={{ background: 'hsl(var(--primary) / 0.1)' }}
        >
          <Shield className="w-10 h-10" style={{ color: 'hsl(var(--primary))' }} />
        </div>
        <h3 className="font-heading font-bold text-xl mb-2">Your Crews</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-8">
          Create a private group with up to 16 friends. Share workouts, post roll calls, and fuel each other with XP.
        </p>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setCreating(true)}
          className="px-6 py-3 rounded-2xl font-bold text-white text-sm flex items-center gap-2"
          style={{ background: 'hsl(var(--primary))' }}
        >
          <Plus className="w-4 h-4" />
          Create a Crew
        </motion.button>
      </motion.div>
    );
  }

  // ── Crew list ─────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="pt-2 pb-6"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading font-bold text-base">My Crews</h3>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white"
          style={{ background: 'hsl(var(--primary))' }}
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </motion.button>
      </div>

      <div className="space-y-2.5">
        {myCrews.map(crew => (
          <CrewCard
            key={crew.id}
            crew={crew}
            onClick={() => setActiveCrew(crew)}
          />
        ))}
      </div>
    </motion.div>
  );
}
