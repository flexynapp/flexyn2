// src/components/workout/LiveVolumePill.jsx
//
// Live total-volume counter at the top of the active-workout screen.
// Updates in real-time as the user types weight + reps into any set.
// "0 lb vol" → "1,800 lb vol" → "3,600 lb vol" as sets accumulate.
//
// Why it's worth shipping: every great fitness/wellness app has a
// live number somewhere that the user watches. Without one, workout
// logging feels like data entry. With one, every set is a small
// dopamine hit.
//
// Animated number tween via Framer Motion's useMotionValue + animate
// — counts up smoothly rather than snapping. Colors shift at volume
// thresholds (orange tint past 5k, gold pulse past 15k).

import { useEffect, useState } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight, fromLbs } from '@/lib/weightUnit';

function totalVolumeLbs(exercises = []) {
  let total = 0;
  for (const ex of exercises) {
    const sets = ex?.sets || [];
    for (const s of sets) {
      const w = Number(s?.weight);
      const r = Number(s?.reps);
      if (Number.isFinite(w) && Number.isFinite(r) && w > 0 && r > 0) {
        total += w * r;
      }
    }
  }
  return total;
}

export default function LiveVolumePill({ exercises = [] }) {
  const { weightUnit } = useWeightUnit();
  // Recompute totalVolumeLbs every render — the parent's `exercises`
  // is a new reference on every keystroke so useMemo with [exercises]
  // never memoized anyway (audit A-9). Direct compute is cheaper than
  // the memo bookkeeping.
  const totalLbs = totalVolumeLbs(exercises);

  // Tween the rendered number toward `totalLbs` so the pill counts
  // UP / DOWN smoothly rather than snapping. Motion-value-driven so
  // we're not re-rendering React on every animation frame.
  const motionValue = useMotionValue(totalLbs);
  useEffect(() => {
    const controls = animate(motionValue, totalLbs, {
      duration: 0.45,
      ease: [0.32, 0.72, 0, 1],
    });
    return () => controls.stop();
  }, [totalLbs, motionValue]);

  // Color thresholds: muted at zero, primary above zero, accent past
  // the "serious volume" line. The pulse on the heavy threshold is
  // the small dopamine moment.
  const isZero  = totalLbs === 0;
  const isHeavy = totalLbs >= 15_000;
  const isMid   = totalLbs >= 5_000;

  const colorClass = isZero
    ? 'text-muted-foreground/60'
    : isHeavy
      ? 'text-amber-400'
      : isMid
        ? 'text-orange-400'
        : 'text-primary';

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-card border border-border text-xs font-bold tabular-nums"
      aria-live="polite"
      aria-label="Total volume this session"
    >
      <motion.span
        className={colorClass}
        animate={isHeavy ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={{ duration: 1.6, repeat: isHeavy ? Infinity : 0, ease: 'easeInOut' }}
      >
        <AnimatedNumber motionValue={motionValue} unit={weightUnit} />
      </motion.span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {weightUnit === 'kg' ? 'kg' : 'lb'} vol
      </span>
    </motion.div>
  );
}

// Subscribe-to-motion-value child — re-renders only when the value
// snaps to a new integer so a smooth tween doesn't trigger 60Hz
// React reconciliation.
function AnimatedNumber({ motionValue, unit }) {
  const [display, setDisplay] = useState(motionValue.get());
  useEffect(() => {
    const unsub = motionValue.on('change', (latest) => {
      const rounded = Math.round(latest);
      setDisplay((prev) => (prev === rounded ? prev : rounded));
    });
    return () => unsub();
  }, [motionValue]);
  return <span>{formatWeight(fromLbs(display, unit), unit)}</span>;
}
