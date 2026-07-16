// src/components/gymRival/GymRivalCard.jsx
// Workout-page Gym Rival entry card. States: no match → "Find My Gym
// Rival"; pending → "confirm / waiting" chip; active → matchup chip;
// void (this week) → "roll resets in …" chip. All open GymRivalMenu.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { AnimatePresence } from 'framer-motion';
import { Target, Loader2, ChevronRight, Clock, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getMyGymRival, getRivalProfile, rollGymRival, isThisWeek, msUntilNextWeekStart } from '@/lib/data/gymRival';
import { reportError } from '@/lib/reportError';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import CreateDuelModal from '@/components/duels/CreateDuelModal';
import GymRivalMenu from '@/components/gymRival/GymRivalMenu';

export default function GymRivalCard({ currentUserId }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDuel, setShowDuel] = useState(false);

  const { data: assignment, isLoading } = useQuery({
    queryKey:  ['myGymRival', currentUserId],
    queryFn:   getMyGymRival,
    enabled:   !!currentUserId,
    staleTime: 60_000,
  });

  const iAmInitiator = assignment ? assignment.user_id === currentUserId : true;
  const otherId = assignment ? (iAmInitiator ? assignment.rival_id : assignment.user_id) : null;
  const status = assignment?.status;
  const voidThisWeek = status === 'void' && isThisWeek(assignment?.assigned_at);
  // A void from a past week is stale — the user is free to roll again.
  const hasActiveMatch = assignment && (status === 'pending' || status === 'active' || voidThisWeek);
  const iConfirmed = assignment ? (iAmInitiator ? assignment.initiator_confirmed : assignment.rival_confirmed) : false;

  const { data: profile } = useQuery({
    queryKey:  ['gymRivalProfile', otherId],
    queryFn:   () => getRivalProfile(otherId),
    enabled:   !!otherId && status !== 'void',
    staleTime: 5 * 60_000,
  });

  const rollMut = useMutation({
    mutationFn: rollGymRival,
    onSuccess: async (row) => {
      if (!row) {
        toast.info('No available rivals right now — check back soon.');
        return;
      }
      await qc.invalidateQueries({ queryKey: ['myGymRival'] });
      qc.invalidateQueries({ queryKey: ['gymRivalProfile'] });
      qc.invalidateQueries({ queryKey: ['gymRivalStats'] });
      setMenuOpen(true); // reveal + confirm
    },
    onError: (err) => {
      reportError(err, { feature: 'gymRival.roll', level: 'warning', userEmail: user?.email });
      toast.error('Could not find a Gym Rival. Try again.');
    },
  });

  const name  = profile?.username;
  const level = profile?.current_level;

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/3 p-4 mb-4 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-secondary shrink-0" />
          <div className="flex-1 space-y-2"><div className="h-3 w-32 rounded bg-secondary" /><div className="h-2.5 w-20 rounded bg-secondary" /></div>
        </div>
      </div>
    );
  }

  const menu = (
    <>
      <GymRivalMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        assignment={assignment}
        currentUserId={currentUserId}
        onReroll={() => rollMut.mutate()}
        rerolling={rollMut.isPending}
        onChallenge={() => { setMenuOpen(false); setShowDuel(true); }}
      />
      <AnimatePresence>
        {showDuel && otherId && (
          <CreateDuelModal opponentId={otherId} opponentUsername={name} onClose={() => setShowDuel(false)} onCreated={() => setShowDuel(false)} />
        )}
      </AnimatePresence>
    </>
  );

  // ── No active match → prompt to find one ────────────────────────────────
  if (!hasActiveMatch) {
    return (
      <>
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-dashed border-rose-500/20 bg-rose-500/3 p-5 mb-4 text-center">
          <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-3">
            <Target className="w-5 h-5 text-rose-500" />
          </div>
          <p className="text-sm font-bold mb-1">{tFallback('gymRival.findTitle', 'Find Your Gym Rival')}</p>
          <p className="text-xs text-muted-foreground mb-4">
            {tFallback('gymRival.findDesc', "We'll match you with someone around your level for a week-long challenge. Out-train them to win.")}
          </p>
          <button onClick={() => rollMut.mutate()} disabled={rollMut.isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-bold hover:bg-rose-600 disabled:opacity-50 transition-colors">
            {rollMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
            {rollMut.isPending ? tFallback('gymRival.searching', 'Searching…') : tFallback('gymRival.findButton', 'Find My Gym Rival')}
          </button>
        </motion.div>
        {menu}
      </>
    );
  }

  // ── Void this week → reset chip ─────────────────────────────────────────
  if (voidThisWeek) {
    return (
      <>
        <motion.button type="button" onClick={() => setMenuOpen(true)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="w-full rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 mb-4 flex items-center gap-3 text-start hover:bg-amber-500/10 transition-colors">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">Challenge voided</span>
            <p className="text-sm font-bold mt-0.5">Someone went AFK — no rewards</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Next roll in {(() => { const ms = msUntilNextWeekStart(); const d = Math.floor(ms / 86400000); const h = Math.floor((ms % 86400000) / 3600000); return d > 0 ? `${d}d ${h}h` : `${h}h`; })()}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        </motion.button>
        {menu}
      </>
    );
  }

  // ── Pending / active → matchup chip ─────────────────────────────────────
  const needsMyConfirm = status === 'pending' && !iConfirmed;
  const waiting = status === 'pending' && iConfirmed;
  const label = needsMyConfirm ? 'Confirm your Gym Rival'
    : waiting ? 'Waiting for them to accept'
    : "This week's Gym Rival";

  return (
    <>
      <motion.button type="button" onClick={() => setMenuOpen(true)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.99 }}
        className={`w-full rounded-2xl border p-4 mb-4 flex items-center gap-3 text-start transition-colors ${needsMyConfirm ? 'border-rose-500/50 bg-rose-500/8 hover:bg-rose-500/12' : 'border-rose-500/20 bg-rose-500/3 hover:bg-rose-500/5'}`}>
        {profile?.avatar_url ? (
          <img loading="lazy" src={profile.avatar_url} className="w-12 h-12 rounded-full object-cover shrink-0 ring-2 ring-rose-500/30" alt={name} />
        ) : (
          <div className="w-12 h-12 rounded-full bg-rose-500/20 ring-2 ring-rose-500/30 flex items-center justify-center shrink-0">
            <span className="text-lg font-black text-rose-500">{name?.[0]?.toUpperCase() || '?'}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Target className="w-3 h-3 text-rose-500" />
            <span className="text-[10px] font-black uppercase tracking-wider text-rose-500">{label}</span>
          </div>
          <p className="text-base font-black truncate mt-0.5">@{name || '—'}</p>
          <p className="text-xs text-muted-foreground">
            {needsMyConfirm ? 'Tap to accept the challenge' : waiting ? 'They haven\'t accepted yet' : `Level ${level ?? '—'} · Tap to see the matchup`}
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </motion.button>
      {menu}
    </>
  );
}
