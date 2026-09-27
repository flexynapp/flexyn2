// src/hooks/useNutritionTargets.js
//
// The daily calorie + macro + micro targets, for every surface that shows
// them: the Nutrition page's top bar, macro box, mineral box, trends chart
// and plans modal, plus the dashboard's calorie and macro-ring widgets.
//
// This exists so those seven surfaces can agree on a number that depends on
// something `calculateDailyValues` cannot see. That function takes a
// user_profiles row and nothing else — it is imported widely and stays
// dependency-free — but a maintenance figure needs the user's observed
// training frequency, which lives in the workout and cardio logs. The hook
// fetches those and hands the derived sessions/week down.
//
// Both queries read dates only, over the 30-day TDEE window, under scoped
// keys inside ['workoutLogs', email] / ['cardioLogs', email], so every save
// that invalidates those prefixes refreshes this too. They used to fetch up
// to 1,000 full rows each (exercises JSONB included) on every Today and
// Nutrition load, to compute one number that reads nothing but `date`.

import { workoutLogsKey } from '@/lib/data/workoutKeys';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { calculateDailyValues } from '@/lib/nutritionDefaults';
import { observedSessionsPerWeek, TDEE_WINDOW_DAYS } from '@/lib/tdee';
import { format, subDays } from 'date-fns';
import { cardioLogsKey } from '@/lib/data/cardioKeys';
import * as workouts from '@/lib/data/workouts';
import * as cardioData from '@/lib/data/cardio';

/**
 * Observed sessions per week over the trailing TDEE window, or undefined
 * while the logs are still loading.
 *
 * Undefined rather than 0 on purpose: 0 is a real answer meaning "trains
 * nothing", and it pins the user to the 1.2 sedentary band — the lowest
 * target the ladder can produce. Handing that to calculateDailyValues
 * before the logs land would show someone a deficit-looking number and
 * then raise it.
 *
 * Undefined instead makes it fall through to the flat 2000 default until
 * the logs arrive, so a cold Nutrition load does still settle from 2000 to
 * the derived figure. That is a visible change, and it is the one worth
 * having: the intermediate value is the generic default this feature is
 * replacing rather than a personalised number that was wrong.
 */
export function useObservedActivity() {
  const { user } = useAuth();
  // One day of slack past the window: observedSessionsPerWeek applies the
  // exact cutoff itself, this only has to not cut short of it.
  const since = format(subDays(new Date(), TDEE_WINDOW_DAYS + 1), 'yyyy-MM-dd');

  const { data: logs, isPending: logsPending } = useQuery({
    queryKey: workoutLogsKey(user?.email, 'observedDates'),
    queryFn: () => workouts.listDatesSince(user.id, since),
    enabled: !!user?.email,
    staleTime: 10 * 60_000,
  });
  const { data: cardioLogs, isPending: cardioPending } = useQuery({
    queryKey: cardioLogsKey(user?.email, 'observedDates'),
    queryFn: () => cardioData.listDatesSince(user.id, since),
    enabled: !!user?.email,
    staleTime: 10 * 60_000,
  });

  return useMemo(() => {
    if (!user?.email || logsPending || cardioPending) return undefined;
    return observedSessionsPerWeek({ logs, cardioLogs }).sessionsPerWeek;
  }, [user?.email, logs, cardioLogs, logsPending, cardioPending]);
}

/** Daily targets for `userProfile`, personalised by observed training. */
export function useNutritionTargets(userProfile) {
  const sessionsPerWeek = useObservedActivity();
  return useMemo(
    () => calculateDailyValues(userProfile, { sessionsPerWeek }),
    [userProfile, sessionsPerWeek],
  );
}
