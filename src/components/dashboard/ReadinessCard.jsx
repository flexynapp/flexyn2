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

import React, { useMemo } from 'react';
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

// Readiness uses a fixed traffic-light palette across themes — green
// = trained / ready, amber = moderate, red = depleted. Hex strokes
// kept in sync with the Tailwind utility classes that render the
// surrounding bg/border/text (each row's `ring` hex == the tailwind
// {emerald,green,amber,orange,rose}-500 default). If the project
// ever exposes --readiness-{primed,ready,moderate,tired,depleted}
// CSS vars, swap these to var() refs without changing the JSX.
const COLOR_BY_LABEL = {
  Primed:    { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-500', ring: '#10b981' /* emerald-500 */ },
  Ready:     { bg: 'bg-green-500/10',   border: 'border-green-500/30',   text: 'text-green-500',   ring: '#22c55e' /* green-500 */ },
  Moderate:  { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-500',   ring: '#f59e0b' /* amber-500 */ },
  Tired:     { bg: 'bg-orange-500/10',  border: 'border-orange-500/30',  text: 'text-orange-500',  ring: '#fb923c' /* orange-400 */ },
  Depleted:  { bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    text: 'text-rose-500',    ring: '#f43f5e' /* rose-500 */ },
};

// Each label maps to its English fallback + an i18n key that the
// render path looks up via tFallback. Stored at module scope (rather
// than hardcoded inline at the render site) so translators only need
// to mirror this one map — but the lookup happens inside the
// component so the user's language always wins.
const ACTION_BY_LABEL = {
  Primed:   { key: 'readiness.action.Primed',   fallback: 'Hit it hard. Take a PR shot.' },
  Ready:    { key: 'readiness.action.Ready',    fallback: 'Train as planned.' },
  Moderate: { key: 'readiness.action.Moderate', fallback: 'Train, cap intensity. Leave 1-2 in reserve.' },
  Tired:    { key: 'readiness.action.Tired',    fallback: 'Light cardio or mobility today.' },
  Depleted: { key: 'readiness.action.Depleted', fallback: 'Take a rest day. Sleep + protein.' },
};

export default function ReadinessCard({ logs = [], compact = false, onClick }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();

  // Use a query key prefix that matches MoodLogCard / SleepLog so an
  // invalidate from those components reaches us too. MoodLogCard's
  // full key is ['moodLogToday', user?.id, todayDateKey]; React Query
  // matches by prefix on invalidation so the 2-key form here picks
  // up the invalidation regardless of the third element. The trade-
  // off: this card doesn't auto-roll at midnight (no date in the key
  // means React Query holds onto yesterday's row until the staleTime
  // refetch fires). MoodLog's per-minute tick in the underlying
  // useQuery causes a refetch when the day flips, so this card
  // reconciles naturally on the next refetch.
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
  // flicker ±1 at midnight in negative-offset zones. Memoize so the
  // O(N) scan only runs when logs actually changes, not on every
  // sleep/mood query revalidation.
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

  // Mood maps to an inverted soreness scale that computeRecoveryScore
  // already knows how to consume — mood 5 (fresh) → soreness 1 (none),
  // mood 1 (drained) → soreness 5 (maximum). Clamp both pathways so a
  // corrupt mood=0 or sleep.soreness=12 row can't overshoot the scale.
  // (Audit 08 #27.)
  const sorenessProxy = sleep?.soreness != null
    ? Math.max(1, Math.min(5, sleep.soreness))
    : (mood?.mood != null ? Math.max(1, Math.min(5, 6 - mood.mood)) : undefined);

  const { score: rawScore, label } = computeRecoveryScore({
    sleepHours:    sleep?.hours,
    sleepQuality:  sleep?.quality,
    soreness:      sorenessProxy,
    lastWorkoutAt,
  });
  // Guard NaN/Infinity — computeRecoveryScore returns a number under
  // normal inputs, but a regression in the underlying math (or a brand
  // new user with no signal at all) could surface NaN, which then
  // propagates into dashOffset and breaks the SVG dasharray render.
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;

  // Defensive fallback — every COLOR_BY_LABEL key is a known label,
  // but defending against a future score-engine change that returns an
  // unmapped label keeps the card from rendering as a blank.
  const safeLabel = COLOR_BY_LABEL[label] ? label : 'Ready';
  const colors = COLOR_BY_LABEL[safeLabel];
  // Pull key + fallback from the map (i18n at render time) rather than
  // building the key inline. The map is the single source of truth
  // for both the i18n key the translator needs to write and the
  // English fallback the en-locale user sees.
  const action = tFallback(
    ACTION_BY_LABEL[safeLabel].key,
    ACTION_BY_LABEL[safeLabel].fallback,
  );

  // Ring geometry
  const SIZE = compact ? 28 : 64;
  const STROKE = compact ? 3 : 6;
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * RADIUS;
  const dashOffset = CIRC * (1 - score / 100);

  if (!user?.id) return null;

  // Wraps the card in a button when an onClick is provided so users
  // get keyboard focus + the proper affordance. Default is a static div.
  const Wrapper = onClick ? 'button' : 'div';
  const wrapperProps = onClick
    ? {
        type: 'button',
        onClick,
        'aria-label': tFallback('readiness.openLabel', 'Readiness — tap for details'),
      }
    : {};

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="h-full"
      >
        <Card
          className={`px-2 py-1 border ${colors.border} ${colors.bg} h-full flex flex-col items-center justify-center gap-0.5 ${onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
          // Compact mode hides the action copy — surface it as a
          // tooltip + aria-label so screen readers + hover users still
          // get the context behind the bare score number.
          title={`${tFallback('readiness.kicker', 'Readiness')} ${score} — ${action}`}
          {...(onClick ? { role: 'button', tabIndex: 0, onClick, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } } : {})}
        >
          <div className="relative" style={{ width: SIZE, height: SIZE }}>
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
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-heading font-black text-xs tabular-nums">{score}</span>
            </div>
          </div>
          <span className={`text-[8px] font-bold uppercase tracking-[0.12em] ${colors.text} leading-none`}>
            {tFallback('readiness.kicker', 'Readiness')}
          </span>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Wrapper
        {...wrapperProps}
        className={`block w-full text-start ${onClick ? 'cursor-pointer hover:opacity-95 transition-opacity' : ''}`}
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
              <span className={`text-sm font-heading font-bold ${colors.text}`}>{safeLabel}</span>
            </div>
            <p className="text-xs text-foreground leading-snug mt-0.5">
              {action}
            </p>
          </div>
        </div>
      </Card>
      </Wrapper>
    </motion.div>
  );
}
