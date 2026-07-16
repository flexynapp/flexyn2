// src/components/gymRival/GymRivalCard.jsx
// Workout-page Gym Rival entry card. When no rival is assigned it prompts
// "Find My Gym Rival"; once assigned it shows a compact matchup chip that
// opens the full GymRivalMenu (reveal animation + net-rating comparison).

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, Loader2, ChevronRight } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getMyGymRival, getRivalProfile, assignGymRival } from '@/lib/data/gymRival';
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
    staleTime: 5 * 60_000,
  });

  const { data: profile } = useQuery({
    queryKey:  ['gymRivalProfile', assignment?.rival_id],
    queryFn:   () => getRivalProfile(assignment?.rival_id),
    enabled:   !!assignment?.rival_id,
    staleTime: 5 * 60_000,
  });

  const assignMut = useMutation({
    mutationFn: assignGymRival,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['myGymRival'] });
      qc.invalidateQueries({ queryKey: ['gymRivalProfile'] });
      qc.invalidateQueries({ queryKey: ['gymRivalStats'] });
      setMenuOpen(true); // reveal the new rival
    },
    onError: (err) => {
      reportError(err, { feature: 'gymRival.assign', level: 'warning', userEmail: user?.email });
      toast.error('Could not find a Gym Rival. Try again.');
    },
  });

  const name   = profile?.username;
  const avatar = profile?.avatar_url;
  const level  = profile?.current_level;

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/3 p-4 mb-4 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-secondary shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 rounded bg-secondary" />
            <div className="h-2.5 w-20 rounded bg-secondary" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── No rival — prompt to find one ─────────────────────────────── */}
      {!assignment ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-dashed border-rose-500/20 bg-rose-500/3 p-5 mb-4 text-center"
        >
          <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-3">
            <Target className="w-5 h-5 text-rose-500" />
          </div>
          <p className="text-sm font-bold mb-1">{tFallback('gymRival.findTitle', 'Find Your Gym Rival')}</p>
          <p className="text-xs text-muted-foreground mb-4">
            {tFallback('gymRival.findDesc', "We'll match you with someone around your level for a week-long challenge. Out-train them to win.")}
          </p>
          <button
            onClick={() => assignMut.mutate()}
            disabled={assignMut.isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-bold hover:bg-rose-600 disabled:opacity-50 transition-colors"
          >
            {assignMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
            {assignMut.isPending ? tFallback('gymRival.searching', 'Searching…') : tFallback('gymRival.findButton', 'Find My Gym Rival')}
          </button>
        </motion.div>
      ) : !name ? (
        // Rival row exists but profile unavailable (deleted account) — reroll.
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 mb-4">
          <p className="text-sm text-muted-foreground mb-3">Your Gym Rival is no longer available. Reroll to get a new one.</p>
          <button
            type="button"
            onClick={() => assignMut.mutate()}
            disabled={assignMut.isPending}
            className="px-3 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs font-semibold text-rose-500 hover:bg-rose-500/20 disabled:opacity-50"
          >
            {assignMut.isPending ? 'Finding someone…' : 'Reroll'}
          </button>
        </div>
      ) : (
        // ── Assigned — compact chip that opens the full menu ──────────
        <motion.button
          type="button"
          onClick={() => setMenuOpen(true)}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.99 }}
          className="w-full rounded-2xl border border-rose-500/20 bg-rose-500/3 p-4 mb-4 flex items-center gap-3 text-start hover:bg-rose-500/5 transition-colors"
        >
          {avatar ? (
            <img loading="lazy" src={avatar} className="w-12 h-12 rounded-full object-cover shrink-0 ring-2 ring-rose-500/30" alt={name} />
          ) : (
            <div className="w-12 h-12 rounded-full bg-rose-500/20 ring-2 ring-rose-500/30 flex items-center justify-center shrink-0">
              <span className="text-lg font-black text-rose-500">{name[0]?.toUpperCase()}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Target className="w-3 h-3 text-rose-500" />
              <span className="text-[10px] font-black uppercase tracking-wider text-rose-500">This week's Gym Rival</span>
            </div>
            <p className="text-base font-black truncate mt-0.5">@{name}</p>
            <p className="text-xs text-muted-foreground">Level {level ?? '—'} · Tap to see the matchup</p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        </motion.button>
      )}

      {/* Full-screen menu (reveal + net-rating comparison) */}
      <GymRivalMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        assignment={assignment}
        currentUserId={currentUserId}
        onReroll={() => assignMut.mutate()}
        rerolling={assignMut.isPending}
        onChallenge={() => { setMenuOpen(false); setShowDuel(true); }}
      />

      {/* Duel modal — opened from the menu's Challenge action */}
      <AnimatePresence>
        {showDuel && assignment?.rival_id && (
          <CreateDuelModal
            opponentId={assignment.rival_id}
            opponentUsername={name}
            onClose={() => setShowDuel(false)}
            onCreated={() => setShowDuel(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
