// src/hooks/useGoalAutoComplete.js
//
// A goal completes the moment it is hit. There used to be a button for it
// ("Push to complete", then "Mark done"), which meant a goal the user had
// already beaten sat at 100% until they found the button, and the XP was a
// number the client computed and sent.
//
// Now: when any active goal reads 100% from the logs on screen, this asks
// the server to complete it. complete_goal re-checks the goal against the
// user's own logs, decides the XP and pays it once, so this hook only
// decides WHEN to ask. The server can say no (a flagged session, or a log
// this device has and the server does not); that goal is not asked about
// again until the page remounts.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import * as goalsData from '@/lib/data/goals';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { goalProgress } from '@/lib/goalProgress';
import { summarizeGoalTarget } from '@/lib/goalSummary';
import { fireGoalCelebration } from '@/lib/goalCelebration';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { reportError } from '@/lib/reportError';

export default function useGoalAutoComplete({ user, goals, logs, cardioLogs, enabled = true }) {
  const queryClient = useQueryClient();
  const { weightUnit } = useWeightUnit();
  // Every goal id this mount has already asked about, whatever the answer.
  const askedRef = useRef(new Set());

  useEffect(() => {
    if (!enabled || !user?.email || !Array.isArray(goals)) return;
    const due = goals.filter(g =>
      g?.id
      && g.status === 'active'
      && !askedRef.current.has(g.id)
      && goalProgress(g, logs, cardioLogs) >= 100);
    if (due.length === 0) return;

    for (const goal of due) {
      askedRef.current.add(goal.id);
      goalsData.complete(goal.id)
        .then(async (res) => {
          if (!res?.completed) return;
          queryClient.invalidateQueries({ queryKey: ['goals', user.email] });
          fireGoalCelebration({
            goalName: goal.exercise_name || summarizeGoalTarget(goal, weightUnit),
            xpReward: Number(res.xp) || 0,
            userEmail: user.email,
          });
          // XP milestones are granted by their own RPC; xp_gained 0 runs
          // only that check.
          if (Number(res.xp) > 0) {
            db.functions.invoke('updateUserXpAndAchievements', { xp_gained: 0 })
              .then(() => {
                queryClient.invalidateQueries({ queryKey: ['userProfile', user.email] });
                queryClient.invalidateQueries({ queryKey: ['achievements', user.email] });
              })
              .catch(err => reportError(err, { feature: 'goals.xp-milestones', level: 'warning', userEmail: user.email }));
          }
          quests.recordAction(user, ACTION_TYPES.GOAL_COMPLETED, 1)
            .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
            .catch(err => reportError(err, { feature: 'goals.quest-credit', level: 'warning', userEmail: user.email, goalId: goal.id }));
        })
        .catch(err => reportError(err, { feature: 'goals.auto-complete', level: 'warning', userEmail: user.email, goalId: goal.id }));
    }
  }, [enabled, user, goals, logs, cardioLogs, queryClient, weightUnit]);
}
