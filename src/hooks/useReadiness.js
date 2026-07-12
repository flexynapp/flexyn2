// src/hooks/useReadiness.js
//
// Single source of truth for the Readiness score. Pulls today's sleep +
// mood logs, finds the most recent workout from the dashboard's `logs`
// cache, and runs computeRecoveryScore — returning both the score/label
// AND the per-signal breakdown (actual logged values + sub-scores +
// contributions) so the card can show the number and the explainer can
// show WHY it's that number, from the exact same computation.
//
// Extracted from ReadinessCard so the card and the Dashboard explainer
// never drift apart.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { computeRecoveryScore } from '@/lib/recoveryScore';
import { getTodaySleepLog } from '@/lib/data/sleepLogs';
import { getTodayMoodLog } from '@/lib/data/moodLogs';
import { parseLocalDate } from '@/lib/dateUtils';

export function useReadiness(logs = []) {
  const { user } = useAuth();

  // 2-key prefix so a MoodLogCard / SleepLogCard invalidate reaches us.
  const { data: sleep } = useQuery({
    queryKey: ['sleepLogToday', user?.id],
    queryFn: getTodaySleepLog,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });
  const { data: mood } = useQuery({
    queryKey: ['moodLogToday', user?.id],
    queryFn: getTodayMoodLog,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const lastWorkoutAt = useMemo(() => {
    if (!Array.isArray(logs)) return null;
    let best = null;
    for (const log of logs) {
      const raw = log?.date || log?.created_at || log?.created_date;
      const d = parseLocalDate(raw);
      if (!d) continue;
      if (!best || d > best) best = d;
    }
    return best;
  }, [logs]);

  // Mood → inverted soreness (mood 5 fresh → soreness 1; mood 1 drained
  // → soreness 5). Sleep soreness slider wins when present.
  const sorenessProxy = sleep?.soreness != null
    ? Math.max(1, Math.min(5, sleep.soreness))
    : (mood?.mood != null ? Math.max(1, Math.min(5, 6 - mood.mood)) : undefined);

  const { score: rawScore, label, breakdown } = computeRecoveryScore({
    sleepHours:   sleep?.hours,
    sleepQuality: sleep?.quality,
    soreness:     sorenessProxy,
    lastWorkoutAt,
  });
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;

  return { score, label, breakdown, sleep, mood, sorenessProxy, lastWorkoutAt };
}
