// The active session's top bar. It stays pinned while the lifter scrolls
// through the list so the three things they check between sets (time,
// volume, how far through they are) and the way out (Finish) never
// scroll away. It replaces a title block, a stats row and a date line
// that sat above the list and scrolled off after the first exercise.

import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import WorkoutElapsedChip from './WorkoutElapsedChip';
import LiveVolumePill from './LiveVolumePill';
import { useLanguage } from '@/lib/LanguageContext';

// Sets done against sets planned. A folded exercise counts every set as
// done, and a cardio entry counts as one item.
export function sessionProgress(exercises = []) {
  let done = 0;
  let total = 0;
  for (const ex of exercises) {
    if (ex.kind === 'cardio') {
      total += 1;
      if (ex.completed) done += 1;
      continue;
    }
    const sets = ex.sets || [];
    total += sets.length;
    done += ex.completed ? sets.length : sets.filter(s => s.completed).length;
  }
  return { done, total };
}

export default function SessionBar({
  title, startedAt, exercises, includeBarWeight, onCancel, onFinish, finishing, canFinish,
}) {
  const { t, tFallback } = useLanguage();
  const { done, total } = sessionProgress(exercises);
  const pct = total > 0 ? done / total : 0;

  return (
    <div className="sticky top-[calc(56px+env(safe-area-inset-top))] lg:top-0 z-20 -mx-4 md:-mx-8 px-4 md:px-8 pt-3 pb-2 mb-6 bg-background border-b border-border">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 min-w-0 font-heading text-xl md:text-2xl font-bold tracking-tight truncate">
          {title}
        </h1>
        <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" className="shrink-0 font-bold" onClick={onFinish} disabled={!canFinish || finishing}>
          {finishing ? t('workout.saving') : tFallback('workout.finish', 'Finish')}
        </Button>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <WorkoutElapsedChip startedAt={startedAt} />
        <LiveVolumePill exercises={exercises} includeBarWeight={includeBarWeight} />
        {total > 0 && (
          <span className="ms-auto text-xs font-semibold text-muted-foreground tabular-nums">
            {tFallback('workout.setsProgress', '{done} of {total} sets', { done, total })}
          </span>
        )}
      </div>
      <div
        className="mt-2 h-1 rounded-full bg-secondary overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={tFallback('workout.sessionProgress', 'Workout progress')}
      >
        <motion.div
          className={`h-full rounded-full origin-left rtl:origin-right ${pct >= 1 ? 'bg-success' : 'bg-foreground'}`}
          initial={false}
          animate={{ scaleX: pct }}
          transition={{ type: 'spring', stiffness: 180, damping: 26 }}
        />
      </div>
    </div>
  );
}
