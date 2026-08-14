// src/components/workout/WorkoutElapsedChip.jsx
//
// Live "0:42" / "1:23:45" chip rendered in the active-workout header.
// Counts up from the session's startedAt, ticking every second. The
// useEffect interval clears when the parent unmounts so a background
// tab doesn't leak timers.
//
// Renders nothing when startedAt is absent (no active session).

import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { elapsedSeconds, formatElapsed } from '@/lib/elapsedClock';
import { useLanguage } from '@/lib/LanguageContext';

export default function WorkoutElapsedChip({ startedAt }) {
  const { tFallback } = useLanguage();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return undefined;
    const id = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return null;
  const sec = elapsedSeconds(startedAt);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold tabular-nums"
      role="timer"
      aria-label={tFallback("workoutElapsedChip.workoutElapsedTime", "Workout elapsed time")}
    >
      <Clock className="w-3 h-3" />
      {formatElapsed(sec)}
    </span>
  );
}
