import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Target, Zap, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import GoalProgressBar from './GoalProgressBar';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight } from '@/lib/weightUnit';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { fireGoalCelebration } from '@/lib/goalCelebration';
import { reportError } from '@/lib/reportError';

export default function GoalsAlmostComplete({ goals, logs, onOpen, limit = 3, compact = false, onClick }) {
  const { t } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const [completingId, setCompletingId] = useState(null);
  const [dismissedIds, setDismissedIds] = useState([]);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const almostCompleteGoals = useMemo(() => {
    const dateToString = (d) => new Date(d).toISOString().split('T')[0];

    return goals
      .filter(goal => goal.status !== 'completed')
      .map(goal => {
        let maxWeight = 0;
        let totalReps = 0;
        logs?.forEach(log => {
          // Only count logs created after this goal was created
          if (new Date(log.created_date) < new Date(goal.created_date)) return;
          log.exercises?.forEach(ex => {
            if (ex.name.toLowerCase() === goal.exercise_name.toLowerCase()) {
              ex.sets?.forEach(set => {
                if (set.weight && set.weight > maxWeight) maxWeight = set.weight;
                if (set.reps) totalReps += set.reps;
              });
            }
          });
        });

        const hasWeightTarget = goal.target_weight != null && goal.target_weight > 0;
        const hasRepsTarget = goal.target_reps != null && goal.target_reps > 0;

        if (!hasWeightTarget && !hasRepsTarget) return null;

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

        return { ...goal, maxWeight, maxRepsInSet: totalReps, progress: Math.min(Math.max(progress, 0), 100) };
      })
      .filter(goal => goal !== null && goal.progress >= 75 && !dismissedIds.includes(goal.id))
      .sort((a, b) => b.progress - a.progress)
      .slice(0, limit);
  }, [goals, logs, limit]);

  const completeMutation = useMutation({
    mutationFn: async (goalId) => {
      // Find the enriched goal (with computed progress) from almostCompleteGoals
      const enrichedGoal = almostCompleteGoals.find(g => g.id === goalId);
      const isFullyComplete = (enrichedGoal?.progress ?? 0) >= 100;

      if (!isFullyComplete) {
        throw new Error('not_complete');
      }

      const goal = goals.find(g => g.id === goalId);
      let xpReward = 0;
      if (goal?.target_weight && goal?.target_reps) {
        xpReward = Math.floor(goal.target_weight * 0.5 + goal.target_reps * 3);
      } else if (goal?.target_weight) {
        xpReward = Math.floor(goal.target_weight * 0.75);
      } else if (goal?.target_reps) {
        xpReward = Math.floor(goal.target_reps * 4);
      }
      xpReward = Math.min(xpReward, 500);

      // Atomic state transition via complete_goal RPC (migration 030).
      // Only the FIRST caller flips the status — prevents the
      // GoalsAlmostComplete + GoalsModal racing on the same row.
      let alreadyCompleted = false;
      try {
        const { supabase } = await import('@/api/supabaseClient');
        const { data, error } = await supabase.rpc('complete_goal', { p_goal_id: goalId });
        if (!error) {
          if (data?.already) alreadyCompleted = true;
        } else if (error.code === '42883' || error.code === '42P01') {
          await db.entities.Goal.update(goalId, { status: 'completed' });
        } else {
          throw error;
        }
      } catch (rpcErr) {
        if (rpcErr?.code === '42883' || rpcErr?.code === '42P01') {
          await db.entities.Goal.update(goalId, { status: 'completed' });
        } else {
          throw rpcErr;
        }
      }

      if (alreadyCompleted) return { alreadyCompleted: true };

      if (xpReward > 0) {
        // XP failure must NOT block goal completion (see GoalsModal for rationale).
        try {
          await db.functions.invoke('updateUserXpAndAchievements', {
            xp_gained: xpReward,
            action_type: 'goal_completed',
            action_data: { goal_id: goalId, xp_earned: xpReward }
          });
        } catch (xpErr) {
          reportError(xpErr, { feature: 'goals.xp-update', level: 'warning', userEmail: user?.email, goalId, xpReward });
        }
      }

      // Pass the goal name + earned XP back to onSuccess so the
      // celebration can render the correct copy.
      return { alreadyCompleted: false, goalName: goal?.exercise_name, xpReward };
    },
    onSuccess: (result, id) => {
      setDismissedIds(prev => [...prev, id]);
      queryClient.invalidateQueries({ queryKey: ['goals', user?.email] });
      if (result?.alreadyCompleted) return; // skip quest credit on duplicate

      // Celebrate the completion — confetti + haptic + XP toast +
      // analytics breadcrumb. Previously this was silent: the card
      // animated out and the user got nothing back.
      fireGoalCelebration({
        goalName: result.goalName,
        xpReward: result.xpReward,
        userEmail: user?.email,
      });

      // Quest progress — only on first completion.
      quests.recordAction(user, ACTION_TYPES.GOAL_COMPLETED, 1)
        .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
        .catch(err => reportError(err, { feature: 'goals.quest-credit', level: 'warning', userEmail: user?.email, goalId: id }));
    },
    onError: (err, id) => {
      // Reset the optimistic "completing" state regardless of the cause.
      setCompletingId(null);
      setDismissedIds(prev => prev.filter(d => d !== id));

      if (err?.message === 'not_complete') {
        // Expected business error — the goal isn't actually at 100%.
        toast.error(t('goals.keepGoing'));
        return;
      }
      // Anything else (network, RPC failure, RLS, etc.) was silently
      // swallowed before. Surface a toast so the user knows to retry,
      // and ship the underlying error to Sentry with feature context.
      toast.error(
        t('goals.completeFailed') === 'goals.completeFailed'
          ? 'Could not complete goal — try again.'
          : t('goals.completeFailed')
      );
      reportError(err, { feature: 'goals.complete', userEmail: user?.email, goalId: id });
    },
  });

  const handleComplete = (goalId) => {
    setCompletingId(goalId);
    completeMutation.mutate(goalId);
  };

  if (almostCompleteGoals.length === 0) {
    return null;
  }

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${compact ? 'mb-4' : 'mb-6'}`}>
      <AnimatePresence>
        {almostCompleteGoals.map((goal) => {
          const isComplete = goal.progress >= 100;
          const isCelebrating = completingId === goal.id;

          // Build display label - cap at target value
          let progressLabel = `${Math.round(goal.progress)}% complete`;
          if (goal.target_reps > 0 && !(goal.target_weight > 0)) {
            const displayed = Math.min(goal.maxRepsInSet, goal.target_reps);
            progressLabel = `${displayed} / ${goal.target_reps} reps`;
          } else if (goal.target_weight > 0 && !(goal.target_reps > 0)) {
            const displayed = Math.min(goal.maxWeight, goal.target_weight);
            progressLabel = `${formatWeight(displayed, weightUnit)} / ${formatWeight(goal.target_weight, weightUnit)}`;
          }

          return (
            <motion.div
              key={goal.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={
                isCelebrating
                  ? { opacity: 0, scale: 0.9, y: -20, height: 0, marginBottom: 0 }
                  : { opacity: 1, scale: 1, y: 0, height: 'auto', marginBottom: 16 }
              }
              exit={{ opacity: 0, scale: 0.9, y: -20, height: 0, marginBottom: 0 }}
              transition={isCelebrating ? { duration: 0.4, ease: 'easeInOut' } : { duration: 0.3 }}
              style={{ overflow: 'hidden', pointerEvents: isCelebrating ? 'none' : 'auto' }}
            >
              <Card onClick={onOpen} style={onOpen ? { cursor: 'pointer' } : {}} className={`${compact ? 'p-3' : 'p-5'} shadow-lg transition-shadow h-full border ${
                isComplete
                  ? 'bg-gradient-to-br from-green-500/15 to-green-500/5 border-green-500/40'
                  : 'bg-gradient-to-br from-accent/15 to-accent/5 border-accent/30'
              }`}>
                <div className="flex flex-col h-full">
                  <div className={`flex items-start gap-3 ${compact ? 'mb-2' : 'mb-3'}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isComplete ? 'bg-green-500/20' : 'bg-accent/20'}`}>
                      {isComplete
                        ? <Trophy className="w-5 h-5 text-green-600" />
                        : <Zap className="w-5 h-5 text-accent" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-bold flex items-center gap-2 text-sm">
                        <Target className="w-4 h-4 shrink-0" />
                        <span className="truncate">{goal.exercise_name}</span>
                      </p>
                      <p className={`text-xs mt-0.5 ${isComplete ? 'text-green-600 font-semibold' : 'text-muted-foreground'}`}>
                        {progressLabel}
                      </p>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col justify-between">
                    <GoalProgressBar progress={goal.progress} animated={false} complete={isComplete} />
                    {isComplete && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                      >
                        <Button
                          onClick={(e) => { e.stopPropagation(); handleComplete(goal.id); }}
                          size="sm"
                          className="w-full mt-3 bg-green-600 hover:bg-green-700 text-white"
                          disabled={isCelebrating}
                        >
                          <Trophy className="w-3 h-3 mr-1" /> {t('goals.pushToComplete')}
                        </Button>
                      </motion.div>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}