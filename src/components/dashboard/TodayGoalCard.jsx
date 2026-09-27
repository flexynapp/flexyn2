// src/components/dashboard/TodayGoalCard.jsx
//
// Goals on Today (Kegan, 27 Sep: "encourage goal completion and creation").
// Until this card, the only way to reach goals from Today was a section that
// is hidden by default, so a person with no goal was never asked to set one
// and a person with one never saw it move.
//
// Three states, one slot:
//   · no active goal      → "Set a goal", which opens the form directly
//   · a goal at 75%+      → nothing here; GoalsAlmostComplete renders above
//                           this with its Complete button, the louder nudge
//   · otherwise           → the closest goal and how far along it is
//
// A 0% goal still shows, unlike GoalsProgressStrip: on Today it is the
// person's own goal named back to them, which is the point of the card.

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Target, ChevronRight, Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { summarizeGoalTarget } from '@/lib/goalSummary';
import {
  computeStrengthGoalProgress, computeCardioGoalProgress, isCardioGoal,
} from '@/lib/goalProgress';

// Matches GoalsAlmostComplete's own cut-off. Above it that card owns the goal.
export const ALMOST_COMPLETE_PCT = 75;

export function goalProgressOf(goal, logs, cardioLogs) {
  return isCardioGoal(goal)
    ? computeCardioGoalProgress(goal, cardioLogs).progress
    : computeStrengthGoalProgress(goal, logs).progress;
}

export default function TodayGoalCard({ goals = [], logs = [], cardioLogs = [], onOpen, onCreate }) {
  const { tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();

  const view = useMemo(() => {
    const active = goals.filter(g => g.status === 'active');
    if (active.length === 0) return { kind: 'empty' };
    const ranked = active
      .map(goal => ({ goal, progress: Math.max(0, Math.min(100, goalProgressOf(goal, logs, cardioLogs) || 0)) }))
      .sort((a, b) => b.progress - a.progress);
    if (ranked[0].progress >= ALMOST_COMPLETE_PCT) return null;
    return { kind: 'closest', top: ranked[0], count: active.length };
  }, [goals, logs, cardioLogs]);

  if (!view) return null;

  if (view.kind === 'empty') {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26 }}>
        <Card>
          <button
            type="button"
            onClick={onCreate}
            className="w-full flex items-center gap-3 px-4 py-4 text-start rounded-lg hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
          >
            <span className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0" aria-hidden="true">
              <Target className="w-5 h-5 text-primary" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                {tFallback('today.goal.setTitle', 'Set a goal')}
              </span>
              <span className="block text-xs text-muted-foreground">
                {tFallback('today.goal.setSub', 'Pick a lift or a distance. What you log counts toward it.')}
              </span>
            </span>
            <Plus className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
          </button>
        </Card>
      </motion.div>
    );
  }

  const { goal, progress } = view.top;
  const pct = Math.round(progress);
  const status = pct > 0
    ? tFallback('today.goal.pct', '{n}%', { n: pct })
    : tFallback('today.goal.notStarted', 'Not started');
  const others = view.count - 1;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26 }}>
      <Card>
        <button
          type="button"
          onClick={onOpen}
          aria-label={tFallback('goals.strip.openLabel', 'Open goals')}
          className="w-full flex items-center gap-3 px-4 py-3 text-start rounded-lg hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
        >
          <span className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0" aria-hidden="true">
            <Target className="w-5 h-5 text-primary" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-foreground truncate">
                {summarizeGoalTarget(goal, weightUnit)}
              </span>
              <span className={`text-xs font-bold tabular-nums shrink-0 ${pct > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                {status}
              </span>
            </span>
            <span className="mt-1.5 block h-1.5 rounded-full bg-secondary overflow-hidden">
              <motion.span
                className="block h-full rounded-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              />
            </span>
            {others > 0 && (
              <span className="mt-1 block text-micro text-muted-foreground">
                {others === 1
                  ? tFallback('today.goal.oneMore', '1 more goal')
                  : tFallback('today.goal.nMore', '{n} more goals', { n: others })}
              </span>
            )}
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 rtl:scale-x-[-1]" aria-hidden="true" />
        </button>
      </Card>
    </motion.div>
  );
}
