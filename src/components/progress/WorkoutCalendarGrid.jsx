// src/components/progress/WorkoutCalendarGrid.jsx
//
// GitHub-style contribution grid for workouts. Renders the last 26
// weeks (≈6 months) as a 7-row × 26-column grid of squares. Each
// square's color intensity is proportional to that day's volume
// (heaviest = darkest), with a baseline gray for empty days.
//
// Hover/tap a square shows a tooltip with the date + workout summary.
// Self-hides when the user has no logs in the window — empty grid is
// worse than no grid.

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { format, subDays, startOfDay } from 'date-fns';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';

const WEEKS = 26;            // ~6 months
const DAYS_PER_WEEK = 7;
const TOTAL_DAYS = WEEKS * DAYS_PER_WEEK;

// Volume thresholds (in user's display unit) → intensity buckets 1-4.
// Day with 0 volume gets bucket 0 (gray).
const INTENSITY_THRESHOLDS = [
  { min: 1,     bucket: 1 },
  { min: 3000,  bucket: 2 },
  { min: 8000,  bucket: 3 },
  { min: 15000, bucket: 4 },
];

function volumeToBucket(volume) {
  let bucket = 0;
  for (const { min, bucket: b } of INTENSITY_THRESHOLDS) {
    if (volume >= min) bucket = b;
  }
  return bucket;
}

// Tailwind-safe class names per bucket. Kept inline so the production
// CSS bundle keeps them (dynamic class strings are tree-shaken).
const BUCKET_BG = {
  0: 'bg-secondary/40',
  1: 'bg-emerald-500/30',
  2: 'bg-emerald-500/55',
  3: 'bg-emerald-500/75',
  4: 'bg-emerald-500',
};

function dayKey(d) {
  return format(d, 'yyyy-MM-dd');
}

/**
 * Compute the daily-volume map from raw workout logs.
 * Returns { 'yyyy-MM-dd': totalVolumeLbs }.
 */
function buildVolumeMap(logs) {
  const map = {};
  if (!Array.isArray(logs)) return map;
  for (const log of logs) {
    const raw = log?.date || log?.created_at || log?.created_date;
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const key = dayKey(d);
    let vol = 0;
    for (const ex of log.exercises || []) {
      for (const s of ex.sets || []) {
        vol += (Number(s.weight) || 0) * (Number(s.reps) || 0);
      }
    }
    map[key] = (map[key] || 0) + vol;
  }
  return map;
}

export default function WorkoutCalendarGrid({ logs = [], onSelectDay }) {
  const { tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const [tooltip, setTooltip] = useState(null);

  // Build a date → first matching log map so we can hand the parent
  // the actual log object on tap. Multiple logs on one day return the
  // first; the calendar is a daily aggregate, deeper inspection lives
  // in the (future) "this day's workouts" modal.
  const logByDay = useMemo(() => {
    const map = {};
    for (const log of logs || []) {
      const raw = log?.date || log?.created_at || log?.created_date;
      if (!raw) continue;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) continue;
      const k = format(d, 'yyyy-MM-dd');
      if (!map[k]) map[k] = log;
    }
    return map;
  }, [logs]);

  // Build the 26×7 day grid backwards from today, aligned to Sunday.
  // Each cell = { date, volume, bucket }.
  const days = useMemo(() => {
    const volMap = buildVolumeMap(logs);
    const today = startOfDay(new Date());
    const todayDow = today.getDay(); // 0 = Sunday
    // End the grid on this week's Saturday so today's column is the last one.
    const endDay = subDays(today, -(6 - todayDow));
    const startDay = subDays(endDay, TOTAL_DAYS - 1);

    const out = [];
    for (let i = 0; i < TOTAL_DAYS; i++) {
      const d = subDays(startDay, -i);
      const key = dayKey(d);
      const lbs = volMap[key] || 0;
      const userUnitVol = Math.round(fromLbs(lbs, weightUnit));
      const isFuture = d > today;
      out.push({
        date: d,
        key,
        volume: userUnitVol,
        bucket: isFuture ? -1 : volumeToBucket(userUnitVol),
        isFuture,
      });
    }
    return out;
  }, [logs, weightUnit]);

  // Hide when the window has zero workouts — an empty grid wastes
  // screen real estate.
  const totalWorkouts = useMemo(
    () => days.filter(d => d.volume > 0).length,
    [days]
  );
  if (totalWorkouts === 0) return null;

  // Group days into columns of 7 (each column = one week).
  const columns = [];
  for (let w = 0; w < WEEKS; w++) {
    columns.push(days.slice(w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK));
  }

  const unitSuffix = weightUnit === 'kg' ? 'kg' : weightUnit === 'stone' ? 'st' : 'lb';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading font-bold text-sm">
            {tFallback('calendar.title', 'Activity')}
          </h3>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {tFallback('calendar.daysTrained', '{count} days in last 6 months', { count: totalWorkouts })}
          </p>
        </div>

        {/* Grid — horizontally scrolls on narrow screens */}
        <div className="overflow-x-auto -mx-1 px-1">
          <div className="inline-flex gap-[3px]" role="img" aria-label="Workout activity heatmap">
            {columns.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-[3px]">
                {col.map((day) => (
                  <button
                    key={day.key}
                    type="button"
                    onMouseEnter={() => setTooltip(day)}
                    onMouseLeave={() => setTooltip(null)}
                    onFocus={() => setTooltip(day)}
                    onBlur={() => setTooltip(null)}
                    onClick={() => {
                      // Two-step interaction:
                      //   • First tap: show tooltip (preview).
                      //   • Second tap on the SAME square AND the day
                      //     has a workout: fire onSelectDay so the
                      //     parent can open the workout detail view.
                      // This avoids accidentally opening a modal on
                      // hover-then-click on desktop while still letting
                      // mobile users drill in with two consecutive taps.
                      const log = logByDay[day.key];
                      const wasShowing = tooltip?.key === day.key;
                      if (wasShowing && log && onSelectDay) {
                        onSelectDay(log);
                        setTooltip(null);
                      } else {
                        setTooltip(wasShowing ? null : day);
                      }
                    }}
                    aria-label={
                      day.isFuture
                        ? `${format(day.date, 'MMM d, yyyy')}: ${tFallback('calendar.future', 'future')}`
                        : day.volume > 0
                          ? `${format(day.date, 'MMM d, yyyy')}: ${day.volume.toLocaleString()} ${unitSuffix}`
                          : `${format(day.date, 'MMM d, yyyy')}: ${tFallback('calendar.noWorkout', 'no workout')}`
                    }
                    className={[
                      'w-3 h-3 rounded-[3px] transition-transform',
                      day.isFuture ? 'opacity-30 cursor-default' : 'cursor-pointer hover:scale-125',
                      day.bucket < 0 ? 'bg-transparent' : BUCKET_BG[day.bucket],
                    ].join(' ')}
                    disabled={day.isFuture}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Tooltip + legend row */}
        <div className="flex items-center justify-between mt-3 text-[10px] text-muted-foreground">
          <div className="min-h-[14px]">
            {tooltip && !tooltip.isFuture && (
              <span className="tabular-nums">
                <span className="font-semibold text-foreground">
                  {format(tooltip.date, 'MMM d, yyyy')}
                </span>
                {' · '}
                {tooltip.volume > 0
                  ? `${tooltip.volume.toLocaleString()} ${unitSuffix}`
                  : tFallback('calendar.noWorkout', 'no workout')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span>{tFallback('calendar.less', 'Less')}</span>
            {[0, 1, 2, 3, 4].map(b => (
              <span
                key={b}
                className={`w-2.5 h-2.5 rounded-[2px] ${BUCKET_BG[b]}`}
                aria-hidden="true"
              />
            ))}
            <span>{tFallback('calendar.more', 'More')}</span>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
