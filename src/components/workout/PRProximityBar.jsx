// src/components/workout/PRProximityBar.jsx
//
// Thin progress bar that fills toward the user's all-time PR as they
// type the weight + reps for a set. "94% of PR" → bar grows orange
// → crosses 100% → bar pulses gold and the label changes to "🎯 PR
// territory" or "🔥 New PR pace."
//
// Makes every heavy set feel like a near-miss thriller. Some lifters
// will push harder just to make the bar pulse — the gamification of
// effort itself.
//
// USAGE
//
//   <PRProximityBar
//     exerciseName="Bench Press"
//     weight={225}
//     reps={5}
//     prIndex={prIndex}  // pre-computed map from buildPRIndex
//   />
//
// THRESHOLDS
//
//   < 70% → renders nothing (avoid clutter on warmup sets)
//   70-89% → thin grey bar
//   90-99% → thin orange bar + label
//   100-109% → gold bar + "🎯 PR territory" + pulse
//   110%+ → gold pulse + sparkle + "🔥 New PR pace"

import { motion } from 'framer-motion';
import { epleyOneRepMax } from '@/lib/oneRepMax';

export default function PRProximityBar({ exerciseName, weight, reps, prIndex = {} }) {
  // Lookup all-time PR for this exercise. Returns 0 for new exercises;
  // suppress the bar in that case (no useful comparator).
  const key = (exerciseName || '').trim().toLowerCase();
  const priorBest = prIndex[key] || 0;
  if (!priorBest) return null;

  const liveEstimate = epleyOneRepMax(weight, reps);
  if (!liveEstimate) return null;

  const pct = (liveEstimate / priorBest) * 100;

  // Below the warmup threshold → don't clutter. Above any threshold
  // we render with tier-appropriate styling.
  if (pct < 70) return null;

  let tier;
  let fill = Math.min(100, pct);
  let label;
  if (pct >= 110) {
    tier = 'newpr';
    label = '🔥 New PR pace';
  } else if (pct >= 100) {
    tier = 'pr';
    label = '🎯 PR territory';
  } else if (pct >= 90) {
    tier = 'close';
    label = `${Math.round(pct)}% of PR`;
  } else {
    tier = 'warmup';
    label = `${Math.round(pct)}% of PR`;
  }

  const styles = {
    warmup:  { bar: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
    close:   { bar: 'bg-orange-400',         text: 'text-orange-400' },
    pr:      { bar: 'bg-amber-400',          text: 'text-amber-400' },
    newpr:   { bar: 'bg-amber-400',          text: 'text-amber-400' },
  }[tier];

  return (
    <div className="flex items-center gap-2 pl-8 pr-2 pt-0.5">
      <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${styles.bar}`}
          initial={{ width: 0 }}
          animate={{ width: `${fill}%` }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        />
      </div>
      <motion.span
        className={`text-[10px] font-bold tabular-nums whitespace-nowrap ${styles.text}`}
        animate={tier === 'pr' || tier === 'newpr' ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={{ duration: 1.4, repeat: tier === 'pr' || tier === 'newpr' ? Infinity : 0 }}
      >
        {label}
      </motion.span>
    </div>
  );
}
