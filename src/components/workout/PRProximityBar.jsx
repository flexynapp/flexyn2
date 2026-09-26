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

/**
 * Percentage of the all-time PR this set represents, or `null` when the bar
 * should not render at all (no prior best, no usable estimate, or below the
 * 70% warmup threshold).
 *
 * Exported because callers need to know whether the bar is on screen BEFORE
 * rendering it. `OneShotTooltip` explains what the bar means, and its effect
 * runs once on mount with deps `[id, anchorRef, delayMs]` — the ref object is
 * stable, so if the anchor isn't in the DOM at that moment the effect never
 * re-runs and the hint is lost. Mounting the tooltip conditionally is the
 * only thing that works; a null-check inside it is not enough.
 *
 * Keep this as the single source of the thresholds — the component below
 * calls it too, so the tooltip and the bar can never disagree about whether
 * there is something to point at.
 */
export function prProximityPct({ exerciseName, weight, reps, prIndex = {} }) {
  const key = (exerciseName || '').trim().toLowerCase();
  const priorBest = prIndex[key] || 0;
  if (!priorBest) return null;

  const liveEstimate = epleyOneRepMax(weight, reps);
  if (!liveEstimate) return null;

  const pct = (liveEstimate / priorBest) * 100;

  // Below the warmup threshold → don't clutter.
  if (pct < 70) return null;
  return pct;
}

export default function PRProximityBar({ exerciseName, weight, reps, prIndex = {} }) {
  const pct = prProximityPct({ exerciseName, weight, reps, prIndex });
  if (pct == null) return null;

  let tier;
  let fill = Math.min(100, pct);
  let label;
  if (pct >= 110) {
    tier = 'newpr';
    label = '🔥 New PR pace';
  } else if (pct >= 100) {
    tier = 'pr';
    label = 'PR territory';
  } else if (pct >= 90) {
    tier = 'close';
    label = `${Math.round(pct)}% of PR`;
  } else {
    tier = 'warmup';
    label = `${Math.round(pct)}% of PR`;
  }

  const styles = {
    warmup:  { bar: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
    close:   { bar: 'bg-foreground/70',  text: 'text-foreground' },
    pr:      { bar: 'bg-success',        text: 'text-success' },
    newpr:   { bar: 'bg-success',        text: 'text-success' },
  }[tier];

  return (
    <div className="flex items-center gap-2 ps-8 pe-2 pt-0.5">
      <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${styles.bar}`}
          initial={{ width: 0 }}
          animate={{ width: `${fill}%` }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        />
      </div>
      <span className={`text-micro font-bold tabular-nums whitespace-nowrap ${styles.text}`}>
        {label}
      </span>
    </div>
  );
}
