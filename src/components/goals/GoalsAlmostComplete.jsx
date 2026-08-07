import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Target, Zap, Trophy } from 'lucide-react';
import { toast } from '@/lib/toast';
import { motion, AnimatePresence } from 'framer-motion';
import GoalProgressBar from './GoalProgressBar';
import { calculateGoalXp } from '@/lib/xpSystem';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight } from '@/lib/weightUnit';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { fireGoalCelebration } from '@/lib/goalCelebration';
import { reportError } from '@/lib/reportError';
import { computeStrengthGoalProgress } from '@/lib/goalProgress';

// Cardio activity matcher — mirrors GoalsList.matchesActivity. Cardio
// goals were previously filtered out entirely (#16 in audit 16) so a
// user whose weekly run goal hit 95% never saw "Almost there!".
function matchesActivity(logType, activity) {
  if (activity === 'any') return true;
  return String(logType || '').startsWith(activity + '_');
}

function computeCardioGoalProgress(goal, cardioLogs) {
  const list = Array.isArray(cardioLogs) ? cardioLogs : [];
  const goalCreated = goal?.created_date ? new Date(goal.created_date) : null;
  let total = 0;
  let target = 0;
  for (const log of list) {
    if (!log) continue;
    if (goalCreated && log.created_date && new Date(log.created_date) < goalCreated) continue;
    if (goal.period !== 'lifetime' && log.date && goal.period_start_date) {
      if (new Date(log.date) < new Date(goal.period_start_date)) continue;
    }
    if (!matchesActivity(log.type, goal.cardio_activity)) continue;
    if (goal.goal_type === 'cardio_distance') {
      total += log.distance_meters || 0;
    } else if (goal.goal_type === 'cardio_duration') {
      total += log.duration_seconds || 0;
    } else if (goal.goal_type === 'cardio_sessions') {
      total += 1;
    }
  }
  if (goal.goal_type === 'cardio_distance') target = goal.target_distance_meters;
  else if (goal.goal_type === 'cardio_duration') target = goal.target_duration_seconds;
  else if (goal.goal_type === 'cardio_sessions') target = goal.target_sessions;
  if (!target || target <= 0) return { currentValue: total, progress: 0 };
  return { currentValue: total, progress: Math.min(100, (total / target) * 100) };
}

export default function GoalsAlmostComplete({ goals, logs, cardioLogs = [], onOpen, limit = 3, compact = false, onClick }) {
  const { t, tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const [completingId, setCompletingId] = useState(null);
  const [dismissedIds, setDismissedIds] = useState([]);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const almostCompleteGoals = useMemo(() => {
    return goals
      .filter(goal => goal.status !== 'completed')
      .map(goal => {
        const isCardio = String(goal.goal_type || '').startsWith('cardio_');
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
      .filter(goal => goal !== null && goal.progress >= 75 && !dismissedIds.includes(goal.id))
      .sort((a, b) => b.progress - a.progress)
      .slice(0, limit);
  }, [goals, logs, cardioLogs, limit, dismissedIds]);

  const completeMutation = useMutation({
    mutationFn: async (goalId) => {
      // Find the enriched goal (with computed progress) from almostCompleteGoals
      const enrichedGoal = almostCompleteGoals.find(g => g.id === goalId);
      const isFullyComplete = (enrichedGoal?.progress ?? 0) >= 100;

      if (!isFullyComplete) {
        throw new Error('not_complete');
      }

      const goal = goals.find(g => g.id === goalId);
      // Shared with GoalsModal via xpSystem.js — the two copies of this
      // formula are how the same completion could pay two different
      // numbers depending on which surface you tapped it from.
      const xpReward = calculateGoalXp(goal);

      // Atomic state transition via complete_goal RPC (migration 030).
      // Only the FIRST caller flips the status — prevents the
      // GoalsAlmostComplete + GoalsModal racing on the same row.
      //
      // On pre-030 hosts the RPC is missing and we fall back to a
      // direct UPDATE. The fallback is NOT atomic across concurrent
      // tabs, so we read the goal's current status first and bail if
      // it's already completed — narrows the duplicate-XP race window
      // to the millisecond between SELECT and UPDATE, instead of the
      // wide-open seconds it took React Query to refetch otherwise.
      let alreadyCompleted = false;
      const runFallback = async () => {
        const fresh = await db.entities.Goal.get?.(goalId).catch(() => null);
        if (fresh?.status === 'completed') {
          alreadyCompleted = true;
          return;
        }
        await db.entities.Goal.update(goalId, { status: 'completed' });
      };
      try {
        const { supabase } = await import('@/api/supabaseClient');
        const { data, error } = await supabase.rpc('complete_goal', { p_goal_id: goalId });
        if (!error) {
          if (data?.already) alreadyCompleted = true;
        } else if (error.code === '42883' || error.code === '42P01') {
          await runFallback();
        } else {
          throw error;
        }
      } catch (rpcErr) {
        if (rpcErr?.code === '42883' || rpcErr?.code === '42P01') {
          await runFallback();
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
        tFallback('goals.completeFailed', 'Could not complete goal — try again.')
      );
      reportError(err, { feature: 'goals.complete', userEmail: user?.email, goalId: id });
    },
  });

  // In-flight guard against rapid double-tap. Between the click and
  // the next render (when `disabled={isCelebrating}` takes effect),
  // a fast second tap can slip through and fire two mutate() calls
  // for the same goalId. complete_goal IS server-side idempotent
  // (the second returns alreadyCompleted: true), but the wasted RPC
  // roundtrip + the alreadyCompleted skip path are both avoidable
  // with this ref-based guard. Same pattern as DailyQuestsCard
  // claimingRef. Set-of-ids so multiple goals can be in flight
  // simultaneously without contending.
  const completingRef = useRef(new Set());
  // Clear the ref entirely on unmount so a remount (account switch,
  // route change) starts with a clean slate — the prior instance's
  // 'in-flight' bookkeeping would otherwise leak to the new instance.
  useEffect(() => () => {
    completingRef.current.clear();
  }, []);
  const handleComplete = (goalId) => {
    if (completingRef.current.has(goalId)) return;
    completingRef.current.add(goalId);
    setCompletingId(goalId);
    completeMutation.mutate(goalId, {
      // onSettled fires after BOTH success and error — but if the
      // mutation throws synchronously before queuing, neither path
      // runs and the ref stays stuck. Wrap in try/catch around the
      // .mutate() to release the guard for that edge.
      onSettled: () => { completingRef.current.delete(goalId); },
    });
  };
  // Failsafe: if mutate throws synchronously (rare — should always
  // queue), the onSettled never fires. Listen for the mutation's
  // own isPending transition to false as a secondary release path.
  useEffect(() => {
    if (!completeMutation.isPending && completingRef.current.size > 0 && !completeMutation.isLoading) {
      // Mutation is no longer in flight — let any goals still
      // marked in-flight be retried on next tap.
      completingRef.current.clear();
    }
  }, [completeMutation.isPending, completeMutation.isLoading]);

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
          let progressLabel = tFallback('goals.almostComplete.percentLabel', `${Math.round(goal.progress)}% complete`)
            .replace('{n}', String(Math.round(goal.progress)));
          if (goal.target_reps > 0 && !(goal.target_weight > 0)) {
            const displayed = Math.min(goal.maxRepsInSet, goal.target_reps);
            progressLabel = tFallback('goals.almostComplete.repsLabel', `${displayed} / ${goal.target_reps} reps`)
              .replace('{current}', String(displayed))
              .replace('{target}', String(goal.target_reps));
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
              <Card
                // Match the keyboard-accessibility pattern used by
                // GoalsProgressStrip + HydrationRing — Card is a div,
                // so onClick alone isn't reachable via Tab+Enter.
                onClick={onOpen}
                role={onOpen ? 'button' : undefined}
                tabIndex={onOpen ? 0 : undefined}
                aria-label={onOpen ? tFallback('goals.almostComplete.openLabel', 'Open goals') : undefined}
                onKeyDown={onOpen ? (e) => {
                  // Gate on currentTarget — the inner "Push to complete"
                  // button (when isComplete) is focusable, and Enter/Space
                  // on it would otherwise ALSO fire onOpen via bubbling,
                  // racing the completion against opening the modal.
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
                } : undefined}
                style={onOpen ? { cursor: 'pointer' } : {}}
                className={`${compact ? 'p-3' : 'p-5'} shadow-lg transition-shadow h-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                isComplete
                  ? 'bg-gradient-to-br from-green-500/15 to-green-500/5 border-green-500/40'
                  : 'bg-gradient-to-br from-accent/15 to-accent/5 border-accent/30'
              }`}>
                <div className="flex flex-col h-full">
                  {/* cq-stack: [40px tile][title + progress] leaves the title
                      column ~55px in a half-width dashboard slot. */}
                  <div className={`flex items-start gap-3 cq-stack ${compact ? 'mb-2' : 'mb-3'}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isComplete ? 'bg-green-500/20' : 'bg-accent/20'}`}>
                      {isComplete
                        ? <Trophy className="w-5 h-5 text-green-600" />
                        : <Zap className="w-5 h-5 text-accent" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-bold flex items-center gap-2 text-sm">
                        <Target className="w-4 h-4 shrink-0" />
                        <span className="truncate">
                          {/* Cardio goals don't have exercise_name —
                              fall back to a descriptive label so the
                              row never renders blank. (Audit 16 F22.) */}
                          {goal.exercise_name
                            || (goal._isCardio
                              ? tFallback('goals.cardio.label', '{activity} goal', { activity: goal.cardio_activity || 'Cardio' })
                              : tFallback('goals.unknownLift', 'Unknown lift'))}
                        </span>
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
                          className="w-full mt-3 bg-green-600 hover:bg-green-700 active:bg-green-700 text-white"
                          disabled={isCelebrating}
                        >
                          <Trophy className="w-3 h-3 me-1" /> {t('goals.pushToComplete')}
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