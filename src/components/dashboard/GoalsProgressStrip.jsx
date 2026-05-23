// src/components/dashboard/GoalsProgressStrip.jsx
//
// A single one-line summary of the user's most-progressed active goal,
// shown on Dashboard ONLY when GoalsAlmostComplete won't already
// surface it (i.e. all active goals are below the 75% "almost-complete"
// threshold). Bridges the previously-empty middle of the goal journey
// where a user with 30%-progress goals saw nothing about them on the
// home screen.
//
// Filtered out when:
//   - User has no active goals
//   - Any active goal is ≥75% (GoalsAlmostComplete handles those)
//
// Tap → opens the GoalsModal (same as the existing Dashboard nudge).

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Target, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

// Mirrors the strength-progress math in GoalsAlmostComplete so the
// numbers stay consistent between the strip and the upgraded card.
// Cardio progress is left at 0% in the strip — the card shows the
// detailed breakdown when the user opens the modal.
function computeStrengthProgress(goal, logs) {
  const hasWeightTarget = goal.target_weight != null && goal.target_weight > 0;
  const hasRepsTarget = goal.target_reps != null && goal.target_reps > 0;
  if (!hasWeightTarget && !hasRepsTarget) return 0;

  let maxWeight = 0;
  let totalReps = 0;
  for (const log of logs || []) {
    if (new Date(log.created_date) < new Date(goal.created_date)) continue;
    for (const ex of log.exercises || []) {
      if (ex.name.toLowerCase() !== goal.exercise_name.toLowerCase()) continue;
      for (const set of ex.sets || []) {
        if (set.weight && set.weight > maxWeight) maxWeight = set.weight;
        if (set.reps) totalReps += set.reps;
      }
    }
  }

  let progress = 0;
  if (hasWeightTarget && hasRepsTarget) {
    const weightProgress = maxWeight >= goal.target_weight ? 100 : (maxWeight / goal.target_weight) * 100;
    const repsProgress = totalReps >= goal.target_reps ? 100 : (totalReps / goal.target_reps) * 100;
    progress = Math.max(weightProgress, repsProgress);
  } else if (hasWeightTarget) {
    progress = (maxWeight / goal.target_weight) * 100;
  } else if (hasRepsTarget) {
    progress = (totalReps / goal.target_reps) * 100;
  }
  return Math.min(Math.max(progress, 0), 100);
}

export default function GoalsProgressStrip({ goals = [], logs = [], onOpen }) {
  const { t, tFallback } = useLanguage();

  const view = useMemo(() => {
    const active = goals.filter(g => g.status !== 'completed');
    if (active.length === 0) return null;

    // Compute progress for each active goal (strength only — cardio
    // progress is too varied to express in a one-line strip; the modal
    // shows the full picture).
    const enriched = active.map(g => ({ goal: g, progress: computeStrengthProgress(g, logs) }));

    // If ANY goal is ≥75%, GoalsAlmostComplete will show it. Don't
    // duplicate the surfacing here — the strip is for the gap below.
    const anyAlmostComplete = enriched.some(e => e.progress >= 75);
    if (anyAlmostComplete) return null;

    // Show the closest goal — most motivating to nudge toward completion.
    enriched.sort((a, b) => b.progress - a.progress);
    return {
      activeCount: active.length,
      top: enriched[0],
    };
  }, [goals, logs]);

  if (!view) return null;

  const pct = Math.round(view.top.progress);
  const goal = view.top.goal;
  const countLabel = view.activeCount === 1
    ? (tFallback('goals.strip.oneActive', '1 active goal'))
    : (t('goals.strip.nActive') || `${view.activeCount} active goals`).replace('{n}', view.activeCount);
  const detailLabel = goal.exercise_name
    ? `${goal.exercise_name} · ${pct}%`
    : `${pct}%`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card
        // Keyboard accessibility: the bare onClick was not reachable
        // via Tab+Enter — Card is a styled div, not a button. Add the
        // standard role+tabIndex+keyDown trio so screen readers
        // announce it as interactive and keyboard users can activate.
        // aria-label describes the action since the visible text only
        // says "N active goals" and "Exercise · NN%" — neither makes
        // the "tap me to open the modal" affordance obvious.
        onClick={onOpen}
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={onOpen ? tFallback('goals.strip.openLabel', 'Open goals') : undefined}
        onKeyDown={onOpen ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
        } : undefined}
        style={onOpen ? { cursor: 'pointer' } : {}}
        className="p-3 md:p-4 border-border/60 bg-gradient-to-br from-primary/5 to-card hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Target className="w-4.5 h-4.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-sm font-semibold text-foreground truncate">
                {countLabel}
              </span>
              <span className="font-mono text-[11px] font-bold text-primary shrink-0">
                {detailLabel}
              </span>
            </div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="h-full bg-primary rounded-full"
              />
            </div>
          </div>
          {onOpen && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 rtl:scale-x-[-1]" />}
        </div>
      </Card>
    </motion.div>
  );
}
