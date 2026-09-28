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
// decides WHEN to ask.
//
// Two things keep it from asking too early or giving up too soon:
//   • Optimistic rows (Workout's save puts one in the cache before the insert
//     lands) are left out. Counting one sent complete_goal a log the server
//     did not have yet, and the "no" stuck until the page remounted.
//   • A goal the server said no to is asked again only once more real logs
//     has changed, so a flagged session does not mean a request per render.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import * as goalsData from '@/lib/data/goals';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { goalProgress, metThisPeriod } from '@/lib/goalProgress';
import { fireGoalCelebration } from '@/lib/goalCelebration';
import { useLanguage } from '@/lib/LanguageContext';
import { reportError } from '@/lib/reportError';

export default function useGoalAutoComplete({ user, goals, logs, cardioLogs, enabled = true }) {
  const queryClient = useQueryClient();
  const { t, tFallback } = useLanguage();
  // goal id → the logs it was last asked about ('done' once completed).
  const askedRef = useRef(new Map());

  useEffect(() => {
    if (!enabled || !user?.email || !Array.isArray(goals)) return;
    const real = (rows) => (Array.isArray(rows) ? rows : [])
      .filter(r => !String(r?.id ?? '').startsWith('__optimistic__'));
    const realLogs = real(logs);
    const realCardio = real(cardioLogs);
    // Newest id plus count: a capped list that drops its oldest row when a
    // new one arrives keeps its length, but not its first row.
    const seen = [realLogs.length, realLogs[0]?.id, realCardio.length, realCardio[0]?.id].join('|');
    const due = goals.filter(g =>
      g?.id
      && g.status === 'active'
      && askedRef.current.get(g.id) !== 'done'
      && askedRef.current.get(g.id) !== seen
      // A weekly or monthly goal stays active; once met this period it
      // waits for the next one.
      && !metThisPeriod(g)
      && goalProgress(g, realLogs, realCardio) >= 100);
    if (due.length === 0) return;

    for (const goal of due) {
      askedRef.current.set(goal.id, seen);
      goalsData.complete(goal.id)
        .then(async (res) => {
          if (!res?.completed) return;
          // Completed (or met for this period): don't ask again on this mount.
          askedRef.current.set(goal.id, 'done');
          queryClient.invalidateQueries({ queryKey: ['goals', user.email] });
          const xp = Number(res.xp) || 0;
          fireGoalCelebration({
            title: xp > 0
              ? tFallback('goals.toast.completed', 'Goal completed! +{xp} XP', { xp })
              : tFallback('goals.row.done', 'Done'),
            goalName: goal.exercise_name
              || (goal.cardio_activity ? t(`goals.activity.${goal.cardio_activity}`) : ''),
            xpReward: xp,
            userEmail: user.email,
          });
          // XP milestones are granted by their own RPC; xp_gained 0 runs
          // only that check.
          if (xp > 0) {
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
  }, [enabled, user, goals, logs, cardioLogs, queryClient, t, tFallback]);
}
