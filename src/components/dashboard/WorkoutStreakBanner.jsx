// src/components/dashboard/WorkoutStreakBanner.jsx
//
// Workout streak (separate from login streak). Counts consecutive days the
// user has actually completed a workout. Reads workout_streak from the
// user_profiles table. Auto-hides on day 0.

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dumbbell, Trophy, ShieldCheck } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { differenceInCalendarDays } from 'date-fns';
import StreakFlame from '@/components/StreakFlame';
import AnimatedNumber from '@/components/AnimatedNumber';
import TapToCopy from '@/components/TapToCopy';
import { getStreakRescueStatus, spendStreakRescue } from '@/lib/data/streakRescue';
import { parseLocalDate } from '@/lib/dateUtils';

export default function WorkoutStreakBanner() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [rescuing, setRescuing] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ['workoutStreakProfile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await safeSelect({
        columns: ['workout_streak', 'last_workout_date', 'longest_workout_streak'],
        build: (cols) => supabase
          .from('user_profiles')
          .select(cols)
          .eq('id', user.id)
          .maybeSingle(),
      });
      return data;
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  // Streak rescue eligibility (migration 087). Only fires the RPC when
  // the streak is potentially broken-but-recoverable (daysSince === 2)
  // so we don't waste an RPC on every Dashboard mount. If the RPC is
  // missing (pre-087 host) or returns available=false, the rescue UI
  // simply doesn't render and the banner falls back to its previous
  // behavior (hide on broken streak).
  // Use parseLocalDate so a 'YYYY-MM-DD' date string from Postgres is
  // interpreted in the user's local TZ. `new Date('2025-11-22')` would
  // be UTC midnight, which is the PREVIOUS local day for users west of
  // UTC — daysSinceForGate would flip ±1 at the TZ boundary and
  // mis-classify the streak-rescue gate.
  const lastDateForGate = profile?.last_workout_date;
  const parsedLastDateForGate = parseLocalDate(lastDateForGate);
  const daysSinceForGate = parsedLastDateForGate
    ? differenceInCalendarDays(new Date(), parsedLastDateForGate)
    : 0;
  const { data: rescueStatus } = useQuery({
    queryKey: ['streakRescueStatus', user?.id],
    queryFn: getStreakRescueStatus,
    enabled: !!user?.id && daysSinceForGate === 2 && (profile?.workout_streak ?? 0) >= 3,
    staleTime: 60_000,
  });

  const rescueAvailable = !!rescueStatus?.available;

  const handleRescue = async () => {
    if (rescuing) return;
    setRescuing(true);
    try {
      const res = await spendStreakRescue();
      if (res == null) {
        // Pre-087 host. Shouldn't normally hit because the button only
        // renders when getStreakRescueStatus returned available=true,
        // but a stale schema cache could trip it.
        toast.error(tFallback('streakRescue.unavailable', 'Streak rescue not available yet.'));
        return;
      }
      if (res.ok) {
        toast.success(
          tFallback(
            'streakRescue.saved',
            'Streak saved! Work out today to keep it going.',
          ),
        );
        // Force re-read so the banner flips back to its normal active
        // state on next render.
        qc.invalidateQueries({ queryKey: ['workoutStreakProfile', user?.id] });
        qc.invalidateQueries({ queryKey: ['streakRescueStatus',   user?.id] });
      } else if (res.reason === 'already_used_this_month') {
        toast.error(
          tFallback(
            'streakRescue.alreadyUsed',
            'Rescue already used this month — try again next month.',
          ),
        );
      } else {
        toast.error(
          tFallback('streakRescue.failed', 'Could not save streak — try again.'),
        );
      }
    } finally {
      setRescuing(false);
    }
  };

  // Compute everything we need from `profile` BEFORE any early returns
  // so the hook count stays stable across render passes. Rules of Hooks
  // forbids calling a hook (useMemo below) after a conditional return.
  const streak    = profile?.workout_streak ?? 0;
  const lastDate  = profile?.last_workout_date;
  const parsedLastDate = parseLocalDate(lastDate);
  const daysSince = parsedLastDate ? differenceInCalendarDays(new Date(), parsedLastDate) : 0;
  const atRisk    = daysSince === 1; // worked out yesterday but not today
  const broken    = daysSince > 1;   // streak technically broken — DB still shows old value until next save resets it
  const longest   = profile?.longest_workout_streak ?? streak;
  const isPersonalBest = streak === longest && streak > 1;

  // Pixel particle micro-animation — tiny drifting dots around the streak widget
  const pixels = useMemo(() =>
    Array.from({ length: 14 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2.5 + 1,
      dur: Math.random() * 3.5 + 2.5,
      delay: Math.random() * 3,
      dx: (Math.random() - 0.5) * 18,
      dy: (Math.random() - 0.5) * 14,
      color: atRisk ? '#f97316' : '#22c55e',
    })),
  [atRisk]);

  // Hidden states — banner only renders for an active, non-broken streak.
  if (!user?.id || !profile) return null;
  if (streak === 0) return null;

  // Streak just broke (missed yesterday). Two paths:
  //   • Rescue available → render the rescue offer card.
  //   • No rescue (cap spent / streak too short) → hide as before.
  if (broken) {
    if (!rescueAvailable) return null;
    return (
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 flex items-center justify-between gap-3"
        role="alert"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-heading font-bold leading-tight">
              {tFallback('streakRescue.title', 'Save your {streak}-day streak', { streak })}
            </p>
            <p className="text-micro text-muted-foreground leading-tight">
              {tFallback(
                'streakRescue.subtitle',
                'You missed yesterday. Use your monthly rescue to keep it alive.',
              )}
            </p>
          </div>
        </div>
        <button
          onClick={handleRescue}
          disabled={rescuing}
          className="shrink-0 px-3 py-1.5 rounded-md text-xs font-bold bg-primary text-white hover:bg-primary disabled:opacity-60 transition-colors"
        >
          {rescuing
            ? tFallback('streakRescue.saving', 'Saving…')
            : tFallback('streakRescue.cta', 'Save streak')}
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={[
        'relative overflow-hidden flex items-center justify-between gap-3 px-3 py-2 rounded-lg border',
        atRisk ? 'bg-primary/10 border-primary/30' : 'bg-success/10 border-success/20',
      ].join(' ')}
    >
      {/* Floating pixel particles */}
      {pixels.map(p => (
        <motion.div
          key={p.id}
          className="absolute pointer-events-none"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size, background: p.color, borderRadius: 1, opacity: 0 }}
          animate={{ opacity: [0, 0.5, 0], x: [0, p.dx, 0], y: [0, p.dy, 0] }}
          transition={{ duration: p.dur, repeat: Infinity, delay: p.delay, ease: 'easeInOut' }}
        />
      ))}
      <div className="flex items-center gap-2 min-w-0">
        <Dumbbell className={`w-4 h-4 shrink-0 ${atRisk ? 'text-primary' : 'text-success'}`} />
        <TapToCopy
          // tFallback handles the {n} substitution in BOTH the
          // translated value and the English fallback. The old
          // pattern (`tFallback(key, fallback).replace('{n}', n)`)
          // failed two ways: (1) the fallback string interpolated
          // `${streak}` directly so the {n} placeholder was already
          // gone — .replace was a silent no-op — and (2) when a
          // translator used a different placeholder name like {streak},
          // the {n} replace missed it. Routing the var through
          // tFallback's vars argument fixes both.
          value={tFallback('dashboard.workoutStreakCopy', '{n}-day workout streak', { n: streak })}
          label="streak"
          className="text-sm inline"
        >
        <span className="text-sm">
          <span className="font-heading font-bold tabular-nums">
            <AnimatedNumber value={streak} />
          </span>
          {/* Flame badge scales visually with the streak (Duolingo pattern).
              Tiered: subtle glow at 7d, gold ring at 30d, pulsing sparkles at
              100d, rainbow ring at 365d. The flame ITSELF is the status. */}
          <StreakFlame days={streak} size={14} className="ms-1" />
          <span className="text-muted-foreground">
            {' '}
            {streak === 1
              ? tFallback('dashboard.workoutDayStreak', 'day workout streak')
              : tFallback('dashboard.workoutDaysStreak', 'day workout streak')}
          </span>
          {isPersonalBest && (
            <span className={`ms-2 text-micro font-bold uppercase tracking-wider ${atRisk ? 'text-primary' : 'text-success'}`}>
              {tFallback('dashboard.best', 'Best')}
            </span>
          )}
        </span>
        </TapToCopy>
      </div>
      {atRisk && (
        <span className="text-micro font-medium text-primary">
          {tFallback('dashboard.atRiskToday', 'Train today to keep it')}
        </span>
      )}
      {!atRisk && (
        <Trophy
          className="w-3.5 h-3.5 text-success"
          title={tFallback('dashboard.longestStreak', `Longest: ${longest}`).replace('{n}', String(longest))}
        />
      )}
    </motion.div>
  );
}
