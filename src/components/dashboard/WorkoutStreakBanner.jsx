// src/components/dashboard/WorkoutStreakBanner.jsx
//
// Workout streak (separate from login streak). Counts consecutive days the
// user has actually completed a workout. Reads workout_streak from the
// user_profiles table. Auto-hides on day 0.

import React from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Dumbbell, Trophy } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';
import { differenceInCalendarDays } from 'date-fns';

export default function WorkoutStreakBanner() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();

  const { data: profile } = useQuery({
    queryKey: ['workoutStreakProfile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('user_profiles')
        .select('workout_streak, last_workout_date, longest_workout_streak')
        .eq('id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  if (!user?.id || !profile) return null;
  const streak = profile.workout_streak ?? 0;
  if (streak === 0) return null;

  // If the last workout was >1 day ago, the streak is at risk → show as warning
  const lastDate = profile.last_workout_date;
  const daysSince = lastDate ? differenceInCalendarDays(new Date(), new Date(lastDate)) : 0;
  const atRisk = daysSince === 1; // worked out yesterday but not today
  const broken = daysSince > 1; // streak technically broken — DB still shows old value until next save resets it

  if (broken) return null; // hide rather than show stale info

  const longest = profile.longest_workout_streak ?? streak;
  const isPersonalBest = streak === longest && streak > 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={[
        'flex items-center justify-between gap-3 px-3 py-2 rounded-lg border',
        atRisk ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/20',
      ].join(' ')}
    >
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
