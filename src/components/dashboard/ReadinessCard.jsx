// src/components/dashboard/ReadinessCard.jsx
//
// Composite "Readiness Score" 0-100 combining last night's sleep
// (S6), today's mood (S7), days-since-last-workout, and the
// workoutFatigue signal. Pure-client composition over the data we
// already collect — no new tables.
//
// Drives a single daily decision: hit it hard / maintain / deload /
// rest. Replaces vibes-based "should I go to the gym" with a
// number the user can trust.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { computeRecoveryScore } from '@/lib/recoveryScore';
import { getTodaySleepLog } from '@/lib/data/sleepLogs';
import { getTodayMoodLog } from '@/lib/data/moodLogs';
import { parseLocalDate } from '@/lib/dateUtils';

const COLOR_BY_LABEL = {
  Primed:    { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-500', ring: '#10b981' },
  Ready:     { bg: 'bg-green-500/10',   border: 'border-green-500/30',   text: 'text-green-500',   ring: '#22c55e' },
  Moderate:  { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-500',   ring: '#f59e0b' },
  Tired:     { bg: 'bg-orange-500/10',  border: 'border-orange-500/30',  text: 'text-orange-500',  ring: '#fb923c' },
  Depleted:  { bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    text: 'text-rose-500',    ring: '#f43f5e' },
};

const ACTION_BY_LABEL = {
  Primed:   'Hit it hard. Take a PR shot.',
  Ready:    'Train as planned.',
  Moderate: 'Train, cap intensity. Leave 1-2 in reserve.',
  Tired:    'Light cardio or mobility today.',
  Depleted: 'Take a rest day. Sleep + protein.',
};

export default function ReadinessCard({ logs = [] }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();

  // Use the SAME query keys as MoodLogCard / SleepLog so that when the
  // user taps a mood (which invalidates ['moodLogToday', user?.id]),
  // the Readiness score recomputes immediately. Previously this card
  // had its own ['readinessMood', ...] / ['readinessSleep', ...] keys,
  // so the two cards drifted out of sync for up to 5 minutes (the
  // staleTime) after a tap. Visible because they render side-by-side.
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

  // Find the most recent workout from `logs` (already in dashboard cache).
  // Use parseLocalDate so 'YYYY-MM-DD' DATE columns are interpreted in
  // local TZ. Without this, the recovery `daysSinceWorkout` term could
  // flicker ±1 at midnight in negative-offset zones.
  const lastWorkoutAt = (() => {
    if (!Array.isArray(logs)) return null;
    let best = null;
    for (const log of logs) {
      const raw = log?.date || log?.created_at || log?.created_date;
      const d = parseLocalDate(raw);
      if (!d) continue;
      if (!best || d > best) best = d;
    }
    return best;
  })();

  // Mood maps to a soreness-shaped scale (inverted): mood 5 = fresh,
  // mood 1 = drained. We pass it through as soreness=6-mood so the
  // existing computeRecoveryScore math handles it without a new branch.
  // Soreness 1 = no soreness (best). Mood 5 → soreness 1.
  // Clamp the mood-derived soreness to 1-5 so a corrupt mood=0 row
  // doesn't produce soreness=6 which overshoots the recovery scale.
  // (Audit 08 #27.)
  const sorenessProxy = sleep?.soreness != null
    ? sleep.soreness
    : (mood?.mood != null ? Math.max(1, Math.min(5, 6 - mood.mood)) : undefined);

  const { score, label } = computeRecoveryScore({
    sleepHours:    sleep?.hours,
    sleepQuality:  sleep?.quality,
    soreness:      sorenessProxy,
    lastWorkoutAt,
  });

  const colors = COLOR_BY_LABEL[label] || COLOR_BY_LABEL.Ready;
  const action = ACTION_BY_LABEL[label] || ACTION_BY_LABEL.Ready;

  // Ring geometry
  const SIZE = 64;
  const STROKE = 6;
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * RADIUS;
  const dashOffset = CIRC * (1 - score / 100);

  if (!user?.id) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className={`px-4 py-3 border ${colors.border} ${colors.bg}`}>
        <div className="flex items-center gap-3">
          <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
            <svg width={SIZE} height={SIZE} className="-rotate-90">
              <circle
                cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
                fill="none"
                stroke="hsl(var(--secondary))"
                strokeWidth={STROKE}
              />
              <motion.circle
                cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
                fill="none"
                stroke={colors.ring}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={CIRC}
                initial={{ strokeDashoffset: CIRC }}
                animate={{ strokeDashoffset: dashOffset }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-heading font-black text-base tabular-nums">{score}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Activity className={`w-3.5 h-3.5 ${colors.text}`} aria-hidden="true" />
              <span className={`text-[10px] font-bold uppercase tracking-[0.18em] ${colors.text}`}>
                {tFallback('readiness.kicker', 'Readiness')}
              </span>
              <span className={`text-sm font-heading font-bold ${colors.text}`}>{label}</span>
            </div>
            <p className="text-xs text-foreground leading-snug mt-0.5">
              {tFallback(`readiness.action.${label}`, action)}
            </p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
