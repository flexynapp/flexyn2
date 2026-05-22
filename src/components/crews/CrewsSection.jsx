// src/components/crews/CrewsSection.jsx
//
// Main Crews entry point rendered inside Hub when feedTab === 'crews'.
// States: empty (no crews) → crew list → crew chat view → creation flow
// Tabs: "My Crews" | "Battles" (crew war scoreboard + history)

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Plus, Users, ChevronRight, Loader2, Swords, Trophy, Crown, History } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import * as crewsData from '@/lib/data/crews';
import { getActiveWarForCrew, getCrewWarHistory, getWarScore, getOpponentScore, joinWarMatchmaking } from '@/lib/data/crewWars';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import CrewChat from './CrewChat';
import CrewCreationFlow from './CrewCreationFlow';
import CrewWarPanel from './CrewWarPanel';
import CrewMemberDots from './CrewMemberDots';

// ── Crew list card ────────────────────────────────────────────────────────────

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
        {/* Overlapping avatar dots — humanizes the group. Reading "5
            members" doesn't convey community the way 5 little faces do. */}
        {members.length > 0 && (
          <div className="mt-2">
            <CrewMemberDots members={members} size={20} max={5} />
          </div>
        )}
      </div>

      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </motion.button>
  );
}

// ── Battles tab ───────────────────────────────────────────────────────────────

function BattleEntryRow({ crew, currentUserId }) {
  const qc = useQueryClient();

  const { data: war, isLoading: warLoading } = useQuery({
    queryKey:  ['activeWar', crew.id],
    queryFn:   () => getActiveWarForCrew(crew.id),
    enabled:   !!crew.id,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey:  ['warHistory', crew.id],
    queryFn:   () => getCrewWarHistory(crew.id, 3),
    enabled:   !!crew.id,
    staleTime: 5 * 60_000,
  });

  const enterMut = useMutation({
    mutationFn: () => joinWarMatchmaking(crew.id),
    onSuccess: () => {
      toast.success('Entered matchmaking! We\'ll find you a rival crew.');
      qc.invalidateQueries({ queryKey: ['activeWar', crew.id] });
    },
    onError: (err) => toast.error('Could not enter battle', { description: err.message }),
  });

  if (warLoading) {
    return (
      <div className="rounded-2xl border border-border p-4 animate-pulse mb-4">
        <div className="h-4 w-28 rounded bg-secondary mb-2" />
        <div className="h-2.5 w-full rounded bg-secondary" />
      </div>
    );
  }

  // Active or matchmaking war — show the full panel
  if (war) {
    return <CrewWarPanel crewId={crew.id} currentUserId={currentUserId} />;
  }

  // No active war — show enter battle CTA + history
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card overflow-hidden mb-4"
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2 border-b border-border bg-secondary/30">
        <Shield className="w-4 h-4 text-muted-foreground" />
        <span className="font-bold text-sm truncate">{crew.name}</span>
      </div>

      <div className="p-4 space-y-4">
        {/* No active battle */}
        <div className="text-center py-2">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center mx-auto mb-3">
            <Swords className="w-6 h-6 text-rose-500" />
          </div>
          <p className="text-sm font-bold mb-1">No Active Battle</p>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            Enter matchmaking to get paired with a rival crew. Wars run for 7 days — most XP earned wins.
          </p>
          <button
            onClick={() => enterMut.mutate()}
            disabled={enterMut.isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-bold hover:bg-rose-600 disabled:opacity-50 transition-colors"
          >
            {enterMut.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Swords className="w-4 h-4" />
            }
            {enterMut.isPending ? 'Finding rival…' : 'Enter Battle'}
          </button>
        </div>

        {/* Past battles */}
        {history.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-2">
              <History className="w-3 h-3" />
              Past Battles
            </p>
            <div className="space-y-2">
              {history.map(w => {
                const won = w.winner_crew_id === crew.id;
                const myScore = getWarScore(w, crew.id);
                const theirScore = getOpponentScore(w, crew.id);
                return (
                  <div key={w.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-secondary/40">
                    <div className="flex items-center gap-2">
                      {won
                        ? <Crown className="w-3.5 h-3.5 text-yellow-500" />
                        : <Trophy className="w-3.5 h-3.5 text-muted-foreground" />
                      }
                      <span className={`text-xs font-bold ${won ? 'text-primary' : 'text-muted-foreground'}`}>
                        {won ? 'Victory' : 'Defeat'}
                      </span>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {myScore.toLocaleString()} – {theirScore.toLocaleString()} XP
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(w.ends_at), { addSuffix: true })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function BattlesView({ myCrews, currentUserId }) {
  if (myCrews.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-20 px-8 text-center"
      >
        <div className="w-16 h-16 rounded-3xl bg-rose-500/10 flex items-center justify-center mb-4">
          <Swords className="w-8 h-8 text-rose-500" />
        </div>
        <p className="font-heading font-bold text-lg mb-2">No Crews Yet</p>
        <p className="text-sm text-muted-foreground">
          Join or create a crew first, then challenge rival crews to weekly XP battles.
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="pt-2 pb-6"
    >
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        Each crew can enter one battle at a time. The crew that earns the most XP in 7 days wins.
      </p>
      {myCrews.map(crew => (
        <BattleEntryRow key={crew.id} crew={crew} currentUserId={currentUserId} />
      ))}
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CrewsSection({ initialCrewId }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeCrew, setActiveCrew] = useState(null);
  const [creating, setCreating]     = useState(false);
  const [warTab, setWarTab]         = useState('crews'); // 'crews' | 'battles'

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

  // Relay open-crew deep-link (flexyn:open-crew custom event from Hub.jsx)
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

  // ── Empty state (no crews) ────────────────────────────────────────────────────
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

  // ── Crews list + Battles tabs ─────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="pt-2 pb-6"
    >
      {/* Tab strip */}
      <div className="flex gap-1 p-1 bg-secondary rounded-xl border border-border mb-4">
        <button
          onClick={() => setWarTab('crews')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold rounded-lg transition-colors ${
            warTab === 'crews'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          My Crews
        </button>
        <button
          onClick={() => setWarTab('battles')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold rounded-lg transition-colors ${
            warTab === 'battles'
              ? 'bg-rose-500 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Swords className="w-3.5 h-3.5" />
          Battles
        </button>
      </div>

      <AnimatePresence mode="wait">
        {warTab === 'crews' ? (
          <motion.div
            key="crews"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.15 }}
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
        ) : (
          <motion.div
            key="battles"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }}
          >
            <BattlesView myCrews={myCrews} currentUserId={user?.id} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
