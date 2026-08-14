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
import { formatWeight } from '@/lib/weightUnit';
import { totalVolume as computeTotalVolume } from '@/lib/workoutVolume';
import { useLanguage } from '@/lib/LanguageContext';

export default function LiveVolumePill({ exercises = [], includeBarWeight = false }) {
  const { tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  // Volume math lives in src/lib/workoutVolume.js so the live pill,
  // save mutation, and downstream displays all share the same
  // formula (audit C-3). includeBarWeight comes from the user's
  // preference on user_profiles.include_bar_in_volume (mig 142).
  const totalLbs = computeTotalVolume(exercises, { includeBarWeight });

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
      ? 'text-primary'
      : isMid
        ? 'text-primary'
        : 'text-primary';

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-card border border-border text-xs font-bold tabular-nums"
      aria-live="polite"
      aria-label={tFallback("liveVolumePill.totalVolumeThisSession", "Total volume this session")}
    >
      <motion.span
        className={colorClass}
        animate={isHeavy ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={{ duration: 1.6, repeat: isHeavy ? Infinity : 0, ease: 'easeInOut' }}
      >
        <MotionValueCounter motionValue={motionValue} unit={weightUnit} />
      </motion.span>
      <span className="text-micro text-muted-foreground uppercase tracking-wider">
        {weightUnit === 'kg' ? 'kg' : 'lb'} vol
      </span>
    </motion.div>
  );
}

// Subscribe-to-motion-value child — re-renders only when the value
// snaps to a new integer so a smooth tween doesn't trigger 60Hz
// React reconciliation.
//
// This was called `AnimatedNumber`, which made it look like a third fork
// of @/components/AnimatedNumber alongside HeroSlideshow's (now deleted).
// It isn't, and it should NOT be merged into it: the shared component
// owns its own rAF loop and drives the value through React state, so
// swapping it in here would re-render on every frame of a tween that
// re-fires on every keystroke in every weight and rep input on the
// active-workout screen. This one reads a Framer-Motion motion value and
// only re-renders when the rounded integer actually changes — which for
// a 45-lb set is a handful of renders instead of ~27. Renamed rather
// than unified so the next person doesn't "clean up" a duplicate that
// exists for a reason.
function MotionValueCounter({ motionValue, unit }) {
  const [display, setDisplay] = useState(motionValue.get());
  useEffect(() => {
    const unsub = motionValue.on('change', (latest) => {
      const rounded = Math.round(latest);
      setDisplay((prev) => (prev === rounded ? prev : rounded));
    });
    return () => unsub();
  }, [motionValue]);
  // formatWeight already converts lbs → display unit internally. The
  // prior `formatWeight(fromLbs(display, unit), unit)` converted twice
  // — kg users saw half their real volume tweening up in the pill.
  // Same fix already applied to AdvancedAnalytics (audit 11 #11/#12).
  return <span>{formatWeight(display, unit)}</span>;
}
