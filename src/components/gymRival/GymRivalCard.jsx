// src/components/gymRival/GymRivalCard.jsx
// Workout-page Gym Rival card — shows the assigned rival, Challenge CTA,
// and a Reroll button. (Formerly NemesisCard.)

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, RefreshCw, Loader2, Swords } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getMyGymRival, getRivalProfile, assignGymRival } from '@/lib/data/gymRival';
import { reportError } from '@/lib/reportError';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import CreateDuelModal from '@/components/duels/CreateDuelModal';

export default function GymRivalCard({ currentUserId }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const fmt = useNumberFormatter();
  const navigate = useNavigate();
  const [showDuel, setShowDuel] = useState(false);

  const { data: assignment, isLoading } = useQuery({
    queryKey:  ['myGymRival', currentUserId],
    queryFn:   getMyGymRival,
    enabled:   !!currentUserId,
    staleTime: 5 * 60_000,
  });

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey:  ['gymRivalProfile', assignment?.rival_id],
    queryFn:   () => getRivalProfile(assignment?.rival_id),
    enabled:   !!assignment?.rival_id,
    staleTime: 5 * 60_000,
  });

  const assignMut = useMutation({
    mutationFn: assignGymRival,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['myGymRival'] });
      qc.invalidateQueries({ queryKey: ['gymRivalProfile'] });
    },
    onError: (err) => {
      reportError(err, { feature: 'gymRival.assign', level: 'warning', userEmail: user?.email });
      toast.error('Could not assign your Gym Rival. Try again.');
    },
  });

  // Initial load — render a skeleton (was: return null which left the
  // area blank during the few hundred ms of fetch).
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/3 p-4 mb-4 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-secondary shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 rounded bg-secondary" />
            <div className="h-2.5 w-20 rounded bg-secondary" />
          </div>
        </div>
      </div>
    );
  }

  // ── No rival — prompt to find one ────────────────────────────────────────────
  if (!assignment) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-dashed border-rose-500/20 bg-rose-500/3 p-5 mb-4 text-center"
      >
        <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-3">
          <Target className="w-5 h-5 text-rose-500" />
        </div>
        <p className="text-sm font-bold mb-1">
          {tFallback('gymRival.findTitle', 'Find Your Gym Rival')}
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          {tFallback(
            'gymRival.findDesc',
            "We'll match you with someone around your level for a week-long challenge. Out-train them to win."
          )}
        </p>
        <button
          onClick={() => assignMut.mutate()}
          disabled={assignMut.isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-bold hover:bg-rose-600 disabled:opacity-50 transition-colors"
        >
          {assignMut.isPending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Target className="w-4 h-4" />
          }
          {assignMut.isPending
            ? tFallback('gymRival.searching', 'Searching…')
            : tFallback('gymRival.findButton', 'Find My Gym Rival')}
        </button>
      </motion.div>
    );
  }

  const name   = profile?.username;
  const avatar = profile?.avatar_url;
  const level  = profile?.current_level;

  // Show skeleton ONLY while the profile fetch is in-flight. If the
  // fetch resolved to a row but `username` is null, surface a "no longer
  // available" state with a reroll affordance instead of an infinite
  // skeleton.
  if (profileLoading) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/3 p-4 mb-4 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-secondary shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 rounded bg-secondary" />
            <div className="h-2.5 w-16 rounded bg-secondary" />
          </div>
        </div>
      </div>
    );
  }
  if (!name) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 mb-4">
        <p className="text-sm text-muted-foreground mb-3">
          Your Gym Rival is no longer available. Reroll to get a new one.
        </p>
        <button
          type="button"
          onClick={() => assignMut.mutate()}
          disabled={assignMut.isPending}
          className="px-3 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs font-semibold text-rose-500 hover:bg-rose-500/20 disabled:opacity-50"
        >
          {assignMut.isPending ? 'Finding someone…' : 'Reroll'}
        </button>
      </div>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-rose-500/20 bg-rose-500/3 overflow-hidden"
      >
        {/* Label */}
        <div className="flex items-center gap-1.5 px-4 pt-3 pb-1">
          <Target className="w-3.5 h-3.5 text-rose-500" />
          <span className="text-[10px] font-black uppercase tracking-wider text-rose-500">Your Gym Rival</span>
        </div>

        {/* Profile — tappable, navigates to the rival's Hub profile. */}
        {profile?.id ? (
          <button
            type="button"
            onClick={() => navigate(`/hub?profile=${encodeURIComponent(profile.id)}`)}
            aria-label={`View @${name}'s profile`}
            className="w-full flex items-center gap-4 px-4 pb-3 pt-2 text-start hover:bg-rose-500/5 active:bg-rose-500/10 transition-colors"
          >
            {avatar ? (
              <img loading="lazy" src={avatar} className="w-14 h-14 rounded-full object-cover shrink-0 ring-2 ring-rose-500/30" alt={name} />
            ) : (
              <div className="w-14 h-14 rounded-full bg-rose-500/20 ring-2 ring-rose-500/30 flex items-center justify-center shrink-0">
                <span className="text-xl font-black text-rose-500">{name[0]?.toUpperCase()}</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-base font-black truncate">@{name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Level {level ?? '—'}
                {profile?.total_xp > 0 && (
                  <span className="ms-1.5 text-rose-500/70">· {fmt(profile.total_xp)} XP</span>
                )}
              </p>
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-4 px-4 pb-3 pt-2">
            {avatar ? (
              <img loading="lazy" src={avatar} className="w-14 h-14 rounded-full object-cover shrink-0 ring-2 ring-rose-500/30" alt={name} />
            ) : (
              <div className="w-14 h-14 rounded-full bg-rose-500/20 ring-2 ring-rose-500/30 flex items-center justify-center shrink-0">
                <span className="text-xl font-black text-rose-500">{name[0]?.toUpperCase()}</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-base font-black truncate">@{name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Level {level ?? '—'}
                {profile?.total_xp > 0 && (
                  <span className="ms-1.5 text-rose-500/70">· {fmt(profile.total_xp)} XP</span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-4 pb-4 space-y-2">
          {/* Big challenge button */}
          <button
            onClick={() => setShowDuel(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-rose-500 text-white font-black text-sm hover:bg-rose-600 active:scale-[0.98] transition-all"
          >
            <Swords className="w-4 h-4" />
            Challenge @{name}
          </button>

          {/* Small reroll */}
          <button
            onClick={() => assignMut.mutate()}
            disabled={assignMut.isPending}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50 transition-colors"
          >
            {assignMut.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />
            }
            {assignMut.isPending ? 'Finding someone…' : 'Reroll'}
          </button>
        </div>
      </motion.div>

      {/* Duel modal pre-filled with the rival */}
      <AnimatePresence>
        {showDuel && (
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
