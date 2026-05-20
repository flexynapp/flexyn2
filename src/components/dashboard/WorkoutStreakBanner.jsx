// src/components/dashboard/WorkoutStreakBanner.jsx
//
// Workout streak (separate from login streak). Counts consecutive days the
// user has actually completed a workout. Reads workout_streak from the
// user_profiles table. Auto-hides on day 0.

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Dumbbell, Trophy } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { differenceInCalendarDays } from 'date-fns';

export default function WorkoutStreakBanner() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();

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

  // Compute everything we need from `profile` BEFORE any early returns
  // so the hook count stays stable across render passes. Rules of Hooks
  // forbids calling a hook (useMemo below) after a conditional return.
  const streak    = profile?.workout_streak ?? 0;
  const lastDate  = profile?.last_workout_date;
  const daysSince = lastDate ? differenceInCalendarDays(new Date(), new Date(lastDate)) : 0;
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
      color: atRisk ? '#f59e0b' : '#10b981',
    })),
  [atRisk]);

  // Hidden states — banner only renders for an active, non-broken streak.
  if (!user?.id || !profile) return null;
  if (streak === 0) return null;
  if (broken) return null; // hide rather than show stale info

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={[
        'relative overflow-hidden flex items-center justify-between gap-3 px-3 py-2 rounded-lg border',
        atRisk ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/20',
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
        <Dumbbell className={`w-4 h-4 shrink-0 ${atRisk ? 'text-amber-500' : 'text-emerald-500'}`} />
        <span className="text-sm">
          <span className="font-heading font-bold tabular-nums">{streak}</span>
          <span className="text-muted-foreground">
            {' '}
            {streak === 1
              ? tFallback('dashboard.workoutDayStreak', 'day workout streak')
              : tFallback('dashboard.workoutDaysStreak', 'day workout streak')}
          </span>
          {isPersonalBest && (
            <span className={`ml-2 text-[10px] font-bold uppercase tracking-wider ${atRisk ? 'text-amber-500' : 'text-emerald-500'}`}>
              {tFallback('dashboard.best', 'Best')}
            </span>
          )}
        </span>
      </div>
      {atRisk && (
        <span className="text-[11px] font-medium text-amber-500">
          {tFallback('dashboard.atRiskToday', 'Train today to keep it')}
        </span>
      )}
      {!atRisk && (
        <Trophy className="w-3.5 h-3.5 text-emerald-500" title={`Longest: ${longest}`} />
      )}
    </motion.div>
  );
}
