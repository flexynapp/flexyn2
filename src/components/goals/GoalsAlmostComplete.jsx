import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Target } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import GoalProgressBar from './GoalProgressBar';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight } from '@/lib/weightUnit';
// Cardio goals were previously filtered out of this card entirely (#16 in
// audit 16), so a user whose weekly run goal hit 95% never saw "Almost
// there!". The calculator that fixed it used to live here as a private
// function; it now lives in @/lib/goalProgress alongside the strength one,
// because GoalsList and CardioGoals each had their own copy and three
// answers to "how far along is this goal" is the bug that module exists
// to prevent.
import { computeStrengthGoalProgress, computeCardioGoalProgress, isCardioGoal } from '@/lib/goalProgress';

export default function GoalsAlmostComplete({ goals, logs, cardioLogs = [], onOpen, limit = 3, compact = false }) {
  const { tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();

  const almostCompleteGoals = useMemo(() => {
    return goals
      // `=== 'active'`, not `!== 'completed'` — an archived goal must not
      // reappear in the "almost there!" nudge on Dashboard and Workout. That
      // nudge is the loudest goal surface in the app, so leaking one here
      // would make archiving look broken even though the row was parked.
      .filter(goal => goal.status === 'active')
      .map(goal => {
        // isCardioGoal() checks membership of the three real types rather
        // than a `cardio_` prefix, so a stray goal_type like the old bare
        // 'cardio' is not mistaken for one this can compute.
        const isCardio = isCardioGoal(goal);
        if (isCardio) {
          // Cardio progress branch — extends the dashboard "almost
          // there!" surface to include running / biking / walking /
          // swimming goals. (Audit 16 F16.)
          const { currentValue, progress } = computeCardioGoalProgress(goal, cardioLogs);
          return { ...goal, currentValue, progress, _isCardio: true };
        }
        const hasWeightTarget = goal.target_weight != null && goal.target_weight > 0;
        const hasRepsTarget   = goal.target_reps   != null && goal.target_reps   > 0;
        if (!hasWeightTarget && !hasRepsTarget) return null;
        // Shared progress logic — single source of truth across this
        // component AND GoalsList. Previously each had its own
        // implementation that diverged (this one summed ALL reps
        // regardless of weight; the modal counted reps only at
        // EXACTLY target_weight). Both ignored bodyweight sets.
        const { maxWeight, currentValue, progress } = computeStrengthGoalProgress(goal, logs);
        return { ...goal, maxWeight, maxRepsInSet: currentValue, progress };
      })
      // A goal at 100% is being completed by useGoalAutoComplete on this
      // page, so it leaves this card rather than waiting on a button.
      .filter(goal => goal !== null && goal.progress >= 75 && goal.progress < 100)
      .sort((a, b) => b.progress - a.progress)
      .slice(0, limit);
  }, [goals, logs, cardioLogs, limit]);

  if (almostCompleteGoals.length === 0) {
    return null;
  }

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 ${compact ? 'mb-4' : 'mb-6'}`}>
      <AnimatePresence>
        {almostCompleteGoals.map((goal) => {
          let progressLabel = tFallback('goals.almostComplete.percentLabel', '{pct}% complete', { pct: Math.round(goal.progress) });
          if (goal.target_reps > 0 && !(goal.target_weight > 0)) {
            const displayed = Math.min(goal.maxRepsInSet, goal.target_reps);
            progressLabel = tFallback('goals.almostComplete.repsLabel', '{done} / {target} reps', { done: displayed, target: goal.target_reps });
          } else if (goal.target_weight > 0 && !(goal.target_reps > 0)) {
            const displayed = Math.min(goal.maxWeight, goal.target_weight);
            progressLabel = `${formatWeight(displayed, weightUnit)} / ${formatWeight(goal.target_weight, weightUnit)}`;
          }

          return (
            <motion.div
              key={goal.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.26 }}
              style={{ overflow: 'hidden' }}
            >
              <Card
                // Card is a div, so onClick alone isn't reachable via Tab+Enter.
                onClick={onOpen}
                role={onOpen ? 'button' : undefined}
                tabIndex={onOpen ? 0 : undefined}
                aria-label={onOpen ? tFallback('goals.almostComplete.openLabel', 'Open goals') : undefined}
                onKeyDown={onOpen ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
                } : undefined}
                style={onOpen ? { cursor: 'pointer' } : {}}
                className={`${compact ? 'p-3' : 'p-4'} h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
              >
                <div className="flex items-baseline gap-2 mb-2">
                  <Target className="w-4 h-4 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
                  <p className="flex-1 min-w-0 truncate text-sm font-semibold text-foreground">
                    {/* Cardio goals don't have exercise_name, so fall back
                        to a descriptive label and never render blank. */}
                    {goal.exercise_name
                      || (goal._isCardio
                        ? tFallback('goals.cardio.label', '{activity} goal', { activity: goal.cardio_activity || 'Cardio' })
                        : tFallback('goals.unknownLift', 'Unknown lift'))}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums shrink-0">{progressLabel}</p>
                </div>
                <GoalProgressBar progress={goal.progress} animated={false} />
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
