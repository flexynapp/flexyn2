// src/components/nutrition/CalorieTopBar.jsx
//
// "1,450 / 2,200 cal" status bar pinned at the top of the Nutrition
// page. Live tally based on the user's logged entries for the
// active date, with the user's calorie goal computed from
// nutritionDefaults.js (same formula the Dashboard widget uses).
//
// Compact two-line bar — top row is the numeric balance, bottom row
// is a filled progress strip with three thresholds:
//   • < 80%  → muted (still got room)
//   • 80-100 → primary (nearing goal)
//   • > 100% → amber (over budget — not red because going over
//              isn't catastrophic, just worth noting)

import React from 'react';
import { motion } from 'framer-motion';
import { calculateDailyValues } from '@/lib/nutritionDefaults';

export default function CalorieTopBar({ entries = [], userProfile = {} }) {
  const consumed = entries.reduce(
    (s, e) => s + (Number(e.calories) || 0),
    0
  );
  const dv = calculateDailyValues(userProfile);
  const goal = Number(dv?.calories) || 2000;
  const remaining = Math.round(goal - consumed);
  const pct = goal > 0 ? Math.min((consumed / goal) * 100, 150) : 0;

  const tier = pct < 80 ? 'muted' : pct <= 100 ? 'primary' : 'over';
  const fillColor =
    tier === 'over' ? 'bg-amber-500' :
    tier === 'primary' ? 'bg-primary' :
                         'bg-muted-foreground/60';
  const numColor =
    tier === 'over' ? 'text-amber-500' :
    tier === 'primary' ? 'text-primary' :
                         'text-foreground';

  return (
    <div className="mb-4 rounded-2xl bg-card border border-border p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className={`font-heading text-2xl font-bold leading-none tabular-nums ${numColor}`}>
            {Math.round(consumed).toLocaleString()}
          </span>
          <span className="text-muted-foreground text-sm tabular-nums">
            / {goal.toLocaleString()} cal
          </span>
        </div>
        <span className={`text-xs font-bold tabular-nums ${
          remaining < 0 ? 'text-amber-500' : 'text-muted-foreground'
        }`}>
          {remaining >= 0
            ? `${remaining.toLocaleString()} left`
            : `${Math.abs(remaining).toLocaleString()} over`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${fillColor}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(pct, 100)}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
