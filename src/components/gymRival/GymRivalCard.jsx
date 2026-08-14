// src/components/gymRival/GymRivalCard.jsx
// Workout-page Gym Rival entry card. States: no match → "Find My Gym
// Rival"; pending → "confirm / waiting" chip; active → matchup chip;
// void (this week) → "roll resets in …" chip. All open GymRivalMenu.

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AnimatePresence } from 'framer-motion';
import { Target, Loader2, ChevronRight, Clock, AlertTriangle, Trophy, Swords, Dumbbell, Footprints } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { getMyGymRival, getRivalProfile, rollGymRival, declineGymRival, isThisWeek, msUntilNextWeekStart } from '@/lib/data/gymRival';
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

  // /workout?rival=1 lands here from the Hub profile's contest rail —
  // Workout.jsx consumes the param and fires this once the page is up.
  // An event rather than a prop because this card is rendered deep inside
  // the start screen's tile switch, and the same hand-off shape is already
  // used for the Form Coach and the crews section.
  useEffect(() => {
    const handler = () => setMenuOpen(true);
    window.addEventListener('flexyn:open-rival', handler);
    return () => window.removeEventListener('flexyn:open-rival', handler);
  }, []);

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
  const settledRecent = status === 'completed' && assignment?.settled_at
    && (Date.now() - new Date(assignment.settled_at).getTime() < 2 * 86400_000);
  const myResult = assignment?.winner_id ? (assignment.winner_id === currentUserId ? 'win' : 'loss') : 'draw';
  // A void/completed from a past week is stale — the user is free to roll again.
  const hasActiveMatch = assignment && (status === 'pending' || status === 'active' || voidThisWeek || settledRecent);
  const iConfirmed = assignment ? (iAmInitiator ? assignment.initiator_confirmed : assignment.rival_confirmed) : false;

  const { data: profile } = useQuery({
    queryKey:  ['gymRivalProfile', otherId],
    queryFn:   () => getRivalProfile(otherId),
    enabled:   !!otherId && status !== 'void',
    staleTime: 5 * 60_000,
  });

  const rollMut = useMutation({
    mutationFn: (type) => rollGymRival(type),
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

  const declineMut = useMutation({
    mutationFn: () => declineGymRival(assignment.id),
    onSuccess: () => {
      setMenuOpen(false);
      qc.invalidateQueries({ queryKey: ['myGymRival'] });
      toast.success('Challenge declined.');
    },
    onError: () => toast.error('Could not decline. Try again.'),
  });

  const name  = profile?.username;
  const level = profile?.current_level;

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 mb-4 animate-pulse">
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
        onReroll={() => rollMut.mutate(assignment?.rival_type || 'gym')}
        rerolling={rollMut.isPending}
        onDecline={() => declineMut.mutate()}
        declining={declineMut.isPending}
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
          className="rounded-2xl border border-dashed border-primary/20 bg-primary/5 p-5 mb-4 text-center">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Target className="w-5 h-5 text-primary" />
          </div>
          <p className="text-sm font-bold mb-1">{tFallback('gymRival.findTitle', 'Find Your Rival')}</p>
          <p className="text-xs text-muted-foreground mb-4">
            {tFallback('gymRival.findDesc', 'Pick a challenge type and we\'ll match you with someone around your level for the week. Out-train them to win.')}
          </p>
          <div className="flex gap-2">
            <button onClick={() => rollMut.mutate('gym')} disabled={rollMut.isPending}
              className="flex-1 inline-flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 active:bg-primary/90 disabled:opacity-50 transition-colors">
              <Dumbbell className="w-4 h-4" />
              {tFallback("gymRivalCard.gymRival", "Gym Rival")}
              <span className="text-micro font-medium opacity-80">{tFallback("bodyMap.mode.volume", "Volume")}</span>
            </button>
            <button onClick={() => rollMut.mutate('cardio')} disabled={rollMut.isPending}
              className="flex-1 inline-flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 active:bg-primary/90 disabled:opacity-50 transition-colors">
              <Footprints className="w-4 h-4" />
              {tFallback("gymRivalCard.cardioRival", "Cardio Rival")}
              <span className="text-micro font-medium opacity-80">{tFallback("cardio.field.distance", "Distance")}</span>
            </button>
          </div>
          {rollMut.isPending && (
            <p className="mt-3 text-xs text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…</p>
          )}
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
          className="w-full rounded-2xl border border-primary/20 bg-primary/5 p-4 mb-4 flex items-center gap-3 text-start hover:bg-primary/10 active:bg-primary/10 transition-colors">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-micro font-black uppercase tracking-wider text-primary dark:text-primary">{tFallback("gymRivalCard.challengeVoided", "Challenge voided")}</span>
            <p className="text-sm font-bold mt-0.5">Someone went AFK — no rewards</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Next roll in {(() => { const ms = msUntilNextWeekStart(); const d = Math.floor(ms / 86400000); const h = Math.floor((ms % 86400000) / 3600000); return d > 0 ? `${d}d ${h}h` : `${h}h`; })()}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        </motion.button>
        {menu}
      </>
    );
  }

  // ── Completed this week → result chip ───────────────────────────────────
  if (settledRecent) {
    const win = myResult === 'win';
    const draw = myResult === 'draw';
    return (
      <>
        <motion.button type="button" onClick={() => setMenuOpen(true)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className={`w-full rounded-2xl border p-4 mb-4 flex items-center gap-3 text-start transition-colors ${win ? 'border-success/25 bg-success/5 hover:bg-success/10' : 'border-border bg-secondary/30 hover:bg-secondary/50 active:bg-secondary/50'}`}>
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${win ? 'bg-success/10' : draw ? 'bg-secondary' : 'bg-primary/10'}`}>
            {win ? <Trophy className="w-6 h-6 text-success" /> : draw ? <Target className="w-6 h-6 text-muted-foreground" /> : <Swords className="w-6 h-6 text-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            <span className={`text-micro font-black uppercase tracking-wider ${win ? 'text-success' : 'text-muted-foreground'}`}>{tFallback("gymRivalCard.lastWeekSResult", "Last week's result")}</span>
            <p className="text-sm font-bold mt-0.5">{win ? 'You won! 🏆' : draw ? 'It was a draw' : `@${name || 'Your rival'} won`}</p>
            <p className="text-xs text-muted-foreground">Tap to see the result & roll again</p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        </motion.button>
        {menu}
      </>
    );
  }

  // ── Pending / active → matchup chip ─────────────────────────────────────
  const typeLabel = assignment?.rival_type === 'cardio' ? 'Cardio Rival' : 'Gym Rival';
  const needsMyConfirm = status === 'pending' && !iConfirmed;
  const waiting = status === 'pending' && iConfirmed;
  const label = needsMyConfirm ? `Confirm your ${typeLabel}`
    : waiting ? 'Waiting for them to accept'
    : `This week's ${typeLabel}`;

  return (
    <>
      <motion.button type="button" onClick={() => setMenuOpen(true)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.99 }}
        className={`w-full rounded-2xl border p-4 mb-4 flex items-center gap-3 text-start transition-colors ${needsMyConfirm ? 'border-primary/50 bg-primary/10 hover:bg-primary/10' : 'border-primary/20 bg-primary/5 hover:bg-primary/5 active:bg-primary/5'}`}>
        {profile?.avatar_url ? (
          <img loading="lazy" src={profile.avatar_url} className="w-12 h-12 rounded-full object-cover shrink-0 ring-2 ring-primary/30" alt={name} />
        ) : (
          <div className="w-12 h-12 rounded-full bg-primary/20 ring-2 ring-primary/30 flex items-center justify-center shrink-0">
            <span className="text-lg font-black text-primary">{name?.[0]?.toUpperCase() || '?'}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Target className="w-3 h-3 text-primary" />
            <span className="text-micro font-black uppercase tracking-wider text-primary">{label}</span>
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
