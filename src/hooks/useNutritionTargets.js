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
// Both queries reuse the exact keys the pages already fetch under
// (['workoutLogs', email] / ['cardioLogs', email]). Dashboard fetches both
// already (Dashboard.jsx:1121 and :1127), so the two widgets there cost
// nothing — react-query serves them from cache, and a workout save
// invalidates it for us. Nutrition fetches neither, so there it is two
// reads, deduplicated across all five consumers on the page.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/api/db';
import { LOG_FETCH_LIMIT } from '@/lib/constants';
import { calculateDailyValues } from '@/lib/nutritionDefaults';
import { observedSessionsPerWeek } from '@/lib/tdee';

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
 * replacing rather than a personalised number that was wrong. On Dashboard
 * both queries are already warm, so there is nothing to settle.
 */
export function useObservedActivity() {
  const { user } = useAuth();

  const { data: logs, isPending: logsPending } = useQuery({
    queryKey: ['workoutLogs', user?.email],
    queryFn: () => db.entities.WorkoutLog.filter({ created_by: user.email }, '-date', LOG_FETCH_LIMIT),
    enabled: !!user?.email,
  });
  const { data: cardioLogs, isPending: cardioPending } = useQuery({
    queryKey: ['cardioLogs', user?.email],
    queryFn: () => db.entities.CardioLog.filter({ created_by: user.email }, '-date', LOG_FETCH_LIMIT),
    enabled: !!user?.email,
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
