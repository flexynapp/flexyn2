// src/components/dashboard/WeeklyRecap.jsx
//
// "This week" summary card on the Dashboard. Aggregates the last 7 days
// into a single glance — workouts vs last week, volume delta %, days
// active, best lift, and any PRs the user hit. The whole point is to
// give returning users a reason to *come back to admire themselves*,
// which is the engagement equivalent of a streak save.
//
// The card renders nothing when there are no workouts this week (the
// data layer returns null) — the streak-break and welcome-back push
// nudges already own the "haven't worked out" surface, and a stat
// card with all zeroes is worse than no card.

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Trophy, TrendingUp, TrendingDown, Activity, Flame, Calendar } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { useNumberFormatter } from '@/lib/intl';
import { computeWeeklyRecap } from '@/lib/data/weeklyRecap';

export default function WeeklyRecap({ logs = [], cardioLogs = [] }) {
  const { tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const fmtNum = useNumberFormatter();

  // Compact display: "8.5k" / "12k" for large values, locale-formatted
  // otherwise. Built inline because it needs the fmtNum closure.
  const formatVolume = (n) => {
    if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
    if (n >= 1000)  return `${(n / 1000).toFixed(1)}k`;
    return fmtNum(n);
  };

  const recap = useMemo(
    () => computeWeeklyRecap({ logs, cardioLogs }),
    [logs, cardioLogs]
  );

  if (!recap) return null;

  const volumeDisplay = formatVolume(Math.round(fromLbs(recap.volumeLbs, weightUnit)));
  const bestLiftDisplay = recap.bestLift
    ? `${Math.round(fromLbs(recap.bestLift.weight, weightUnit))} ${weightUnit} × ${recap.bestLift.reps}`
    : null;

  const workoutsDelta = recap.workoutsDelta;
  const volumePct     = recap.volumePct;

  // Tone the delta indicators down when the change is tiny — flat
  // weeks shouldn't shout up or down arrows.
  const showWorkoutsDelta = workoutsDelta !== 0;
  const showVolumeDelta   = volumePct !== null && Math.abs(volumePct) >= 5;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className="overflow-hidden border-border/60 theme-card-accent">
        {/* Top band — kicker + accent */}
        <div className="relative bg-gradient-to-r from-primary/12 via-primary/6 to-transparent px-4 pt-3.5 pb-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
              {tFallback('recap.thisWeek', 'This week')}
            </span>
          </div>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-3 divide-x divide-border/40">
          <RecapStat
            icon={Activity}
            value={recap.workouts}
            label={
              recap.workouts === 1
                ? tFallback('recap.workout', 'workout')
                : tFallback('recap.workouts', 'workouts')
            }
            delta={showWorkoutsDelta ? workoutsDelta : null}
            deltaSuffix={
              tFallback('recap.vsLastWeek', 'vs last week')
            }
          />
          <RecapStat
            icon={Flame}
            value={volumeDisplay}
            valueSuffix={weightUnit}
            label={tFallback('recap.volume', 'volume')}
            deltaPct={showVolumeDelta ? volumePct : null}
            deltaSuffix={tFallback('recap.vsLastWeek', 'vs last week')}
          />
          <RecapStat
            icon={Calendar}
            value={recap.daysActive}
            label={
              recap.daysActive === 1
                ? tFallback('recap.dayActive', 'day active')
                : tFallback('recap.daysActive', 'days active')
            }
            // Showing out-of-7 makes "5 days active" feel earned.
            deltaSuffix={tFallback('recap.outOf7', 'of 7')}
          />
        </div>

        {/* Best lift + PRs — only render the section when there's something
            to say. A workout-with-no-weights week still gets the stats row. */}
        {(bestLiftDisplay || recap.prs.length > 0) && (
          <div className="px-4 py-3 space-y-2 border-t border-border/40 bg-background/40">
            {bestLiftDisplay && (
              <div className="flex items-center gap-2">
                <Flame className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {tFallback('recap.heaviestLift', 'Heaviest lift')}
                </span>
                <span className="text-xs truncate">
                  <span className="font-semibold">{bestLiftDisplay}</span>
                  <span className="text-muted-foreground"> · {recap.bestLift.name}</span>
                </span>
              </div>
            )}
            {recap.prs.length > 0 && (
              <div className="flex items-start gap-2">
                <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {recap.prs.length === 1
                      ? tFallback('recap.newPR', 'New PR')
                      : tFallback('recap.newPRs', 'New PRs')}
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {recap.prs.map(pr => (
                      <span
                        key={pr.name}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 text-xs"
                      >
                        <span className="font-semibold truncate max-w-[140px]">{pr.name}</span>
                        <span className="tabular-nums">
                          {Math.round(fromLbs(pr.weight, weightUnit))}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function RecapStat({ icon: Icon, value, valueSuffix, label, delta, deltaPct, deltaSuffix }) {
  const deltaValue = delta !== null && delta !== undefined ? delta : deltaPct;
  const isUp   = deltaValue !== null && deltaValue !== undefined && deltaValue > 0;
  const isDown = deltaValue !== null && deltaValue !== undefined && deltaValue < 0;

  return (
    <div className="px-3 py-3 flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground truncate">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-heading text-xl md:text-2xl font-bold tabular-nums leading-none">
          {value}
        </span>
        {valueSuffix && (
          <span className="text-[10px] text-muted-foreground">{valueSuffix}</span>
        )}
      </div>
      <div className="flex items-center gap-1 min-h-[14px]">
        {isUp && (
          <>
            <TrendingUp className="w-3 h-3 text-emerald-500" />
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
              {delta !== null && delta !== undefined ? `+${delta}` : `+${deltaPct}%`}
            </span>
          </>
        )}
        {isDown && (
          <>
            <TrendingDown className="w-3 h-3 text-rose-500" />
            <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400 tabular-nums">
              {delta !== null && delta !== undefined ? `${delta}` : `${deltaPct}%`}
            </span>
          </>
        )}
        {deltaSuffix && (isUp || isDown || (delta === null && deltaPct === null)) && (
          <span className="text-[10px] text-muted-foreground/70 truncate">
            {deltaSuffix}
          </span>
        )}
      </div>
    </div>
  );
}
