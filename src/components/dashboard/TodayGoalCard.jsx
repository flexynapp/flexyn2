// Goals on Today (Kegan, 27 Sep: "encourage goal completion and creation").
// Since the "To do" block (same day), this is a ROW at the top of the quest
// list rather than a card of its own, so a goal and the day's quests read as
// one list to finish.
//
// Three states, one row:
//   · no active goal      → "Set a goal", whose pill opens the form directly
//   · a goal at 100%      → the bar turns green and the pill says Complete,
//                           which opens Goals, where completing it fires the
//                           goal celebration
//   · otherwise           → the closest goal, its bar and how far along it is
//
// A 0% goal still shows, unlike GoalsProgressStrip: on Today it is the
// person's own goal named back to them, which is the point of the row.

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Target, Plus } from 'lucide-react';
import useCountUp from '@/hooks/useCountUp';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { summarizeGoalTarget } from '@/lib/goalSummary';
import {
  computeStrengthGoalProgress, computeCardioGoalProgress, isCardioGoal,
} from '@/lib/goalProgress';

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
    return { kind: 'closest', top: ranked[0], count: active.length };
  }, [goals, logs, cardioLogs]);

  const pct = view.kind === 'closest' ? Math.round(view.top.progress) : 0;
  const countedPct = useCountUp(view.kind === 'closest' ? pct : null, { duration: 700 });

  if (view.kind === 'empty') {
    return (
      <div className="flex items-center gap-3 px-4 border-t border-border min-h-[52px]">
        <button
          type="button"
          onClick={onCreate}
          className="flex-1 min-w-0 flex items-center gap-3 py-2.5 text-start rounded-sm active:bg-secondary/40 transition-colors"
        >
          <Target className="w-[22px] h-[22px] text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-foreground">
              {tFallback('today.goal.setTitle', 'Set a goal')}
            </span>
            <span className="block text-xs text-muted-foreground">
              {tFallback('today.goal.setSub', 'Pick a lift or a distance. What you log counts toward it.')}
            </span>
          </span>
        </button>
        <motion.button
          type="button"
          onClick={onCreate}
          whileTap={{ scale: 0.92 }}
          aria-label={tFallback('today.goal.setTitle', 'Set a goal')}
          className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border ps-2 pe-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          {tFallback('today.goal.set', 'Set')}
        </motion.button>
      </div>
    );
  }

  const { goal } = view.top;
  const hit = pct >= 100;
  const shownPct = Math.round(countedPct ?? pct);
  const status = pct > 0
    ? tFallback('today.goal.pct', '{n}%', { n: shownPct })
    : tFallback('today.goal.notStarted', 'Not started');
  const others = view.count - 1;

  return (
    <div className="flex items-center gap-3 px-4 border-t border-border min-h-[52px]">
      <button
        type="button"
        onClick={onOpen}
        aria-label={tFallback('goals.strip.openLabel', 'Open goals')}
        className="flex-1 min-w-0 flex items-center gap-3 py-2.5 text-start rounded-sm active:bg-secondary/40 transition-colors"
      >
        <Target className={`w-[22px] h-[22px] shrink-0 transition-colors ${hit ? 'text-success' : 'text-foreground'}`} aria-hidden="true" />
        <span className="flex-1 min-w-0 flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-foreground truncate">
              {summarizeGoalTarget(goal, weightUnit)}
            </span>
            <span className={`text-xs font-semibold tabular-nums shrink-0 ${hit ? 'text-success' : pct > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
              {status}
            </span>
          </span>
          <span className="block h-1 rounded-full bg-border overflow-hidden" aria-hidden="true">
            <motion.span
              className={`block h-full rounded-full ${hit ? 'bg-success' : 'bg-foreground'}`}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            />
          </span>
          {others > 0 && (
            <span className="block text-micro text-muted-foreground">
              {others === 1
                ? tFallback('today.goal.oneMore', '1 more goal')
                : tFallback('today.goal.nMore', '{n} more goals', { n: others })}
            </span>
          )}
        </span>
      </button>
      {hit && (
        <motion.button
          type="button"
          onClick={onOpen}
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          whileTap={{ scale: 0.94 }}
          className="shrink-0 px-3 py-1 rounded-sm bg-success text-success-foreground text-xs font-bold hover:brightness-110"
        >
          {tFallback('today.goal.complete', 'Complete')}
        </motion.button>
      )}
    </div>
  );
}
