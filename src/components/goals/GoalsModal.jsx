import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import * as goalsData from '@/lib/data/goals';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus, Target } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import GoalForm from './GoalForm';
import GoalsList from './GoalsList';
import { fireGoalCelebration } from '@/lib/goalCelebration';
import { fireFirstGoalCelebration } from '@/lib/firstGoalCelebration';
import { reportError } from '@/lib/reportError';
import { useOptimisticDelete } from '@/hooks/useOptimisticDelete';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight } from '@/lib/weightUnit';

// Small inline summary of a goal target for the first-goal celebration
// copy. target_weight is stored canonically in lbs, so convert it to the
// viewer's unit (formatWeight adds the kg/lb/st label) — otherwise a kg
// user's "100 kg" goal read out as the raw "220.462" with no unit.
function summarizeGoalTarget(g, weightUnit) {
  if (!g) return '';
  if (g.goal_type === 'cardio_distance' && g.target_distance_meters) {
    return `${g.cardio_activity || 'Cardio'} ${Math.round(g.target_distance_meters)}m`;
  }
  if (g.goal_type === 'cardio_duration' && g.target_duration_seconds) {
    return `${g.cardio_activity || 'Cardio'} ${Math.round(g.target_duration_seconds / 60)} min`;
  }
  if (g.goal_type === 'cardio_sessions' && g.target_sessions) {
    return `${g.cardio_activity || 'Cardio'} ${g.target_sessions}× / ${g.period || 'period'}`;
  }
  // Strength
  const name = g.exercise_name || 'lift';
  const w = g.target_weight != null ? formatWeight(g.target_weight, weightUnit) : null;
  if (w && g.target_reps) return `${name} ${w} × ${g.target_reps}`;
  if (w) return `${name} ${w}`;
  if (g.target_reps)   return `${name} ${g.target_reps} rep${g.target_reps === 1 ? '' : 's'}`;
  return name;
}

export default function GoalsModal({ open, onClose, goals = [], logs = [], userProfile = {} }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'completed'
  const [tabDirection, setTabDirection] = useState(1);
  const { t } = useLanguage();
  const { weightUnit } = useWeightUnit();

  const switchTab = (tab) => {
    setTabDirection(tab === 'completed' ? 1 : -1);
    setActiveTab(tab);
  };
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const createMutation = useMutation({
    mutationFn: (data) => goalsData.create(data),
    onSuccess: (created, submittedData) => {
      queryClient.invalidateQueries({ queryKey: ['goals', user?.email] });
      setShowForm(false);

      // First-goal milestone — `goals` prop reflects the list BEFORE
      // this insert (parent's re-render lands on the next tick).
      // Active-only filter ensures a user with all-completed goals
      // still triggers when they set a fresh one.
      const activePrev = (goals || []).filter(g => g.status !== 'completed');
      const isFirstGoal = activePrev.length === 0;
      if (isFirstGoal) {
        fireFirstGoalCelebration({
          targetSummary: summarizeGoalTarget(created || submittedData, weightUnit),
          userEmail: user?.email,
        });
      } else {
        toast.success(t('goals.toast.created'));
      }
    },
    onError: (err) => {
      reportError(err, { feature: 'goals.create', userEmail: user?.email });
      toast.error(t('goals.toast.saveError'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => goalsData.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals', user?.email] });
      setShowForm(false);
      setEditing(null);
      toast.success(t('goals.toast.updated'));
    },
    onError: (err) => {
      reportError(err, { feature: 'goals.update', userEmail: user?.email });
      toast.error(t('goals.toast.saveError'));
    },
  });

  // Optimistic delete with undo — replaces the old confirm-dialog
  // pattern with the Gmail-style flow: goal disappears instantly, a
  // toast with Undo shows for 6s, then the real server delete fires.
  // Faster (no confirm tap) AND safer (instant rollback).
  const optDelete = useOptimisticDelete({
    queryKey: ['goals', user?.email],
    identify: (g) => g.id,
    deleteFn: (id) => goalsData.remove(id),
    label: t('goals.toast.deleted') || 'Goal deleted',
    feature: 'goals.delete',
  });

  const completeMutation = useMutation({
    mutationFn: async (goalId) => {
      const goal = goals.find(g => g.id === goalId);
      const hasWeight = goal?.target_weight > 0;
      const hasReps = goal?.target_reps > 0;
      let xpReward = 0;
      if (hasWeight && hasReps) xpReward = Math.floor(goal.target_weight * 0.5 + goal.target_reps * 3);
      else if (hasWeight) xpReward = Math.floor(goal.target_weight * 0.75);
      else if (hasReps) xpReward = Math.floor(goal.target_reps * 4);
      xpReward = Math.min(xpReward, 500); // Hard cap.

      // Idempotency: atomic state transition via complete_goal RPC (migration
      // 030). Only the FIRST caller flips status active→completed; subsequent
      // callers get { already: true } and we SKIP the XP grant + quest progress
      // so a stale-state double-tap can't double-credit the user.
      // Falls back to the legacy direct UPDATE when the RPC isn't available
      // (pre-migration). The fallback path retains the double-credit risk but
      // matches old behavior so it doesn't break.
      let alreadyCompleted = false;
      try {
        const { supabase } = await import('@/api/supabaseClient');
        const { data, error } = await supabase.rpc('complete_goal', { p_goal_id: goalId });
        if (!error) {
          if (data?.already) alreadyCompleted = true;
        } else if (error.code === '42883' || error.code === '42P01') {
          // RPC missing — legacy direct write below.
          await goalsData.update(goalId, { status: 'completed' });
        } else {
          throw error;
        }
      } catch (rpcErr) {
        if (rpcErr?.code === '42883' || rpcErr?.code === '42P01') {
          await goalsData.update(goalId, { status: 'completed' });
        } else {
          throw rpcErr;
        }
      }

      if (alreadyCompleted) {
        // Skip all reward grants. Return 0 XP so the toast reflects no-op.
        return { xpReward: 0, alreadyCompleted: true, goalName: goal?.exercise_name };
      }

      // First-time completion path — grant XP, snapshot achieved values.
      if (xpReward > 0) {
        try {
          await db.functions.invoke('updateUserXpAndAchievements', {
            xp_gained: xpReward,
            action_type: 'goal_completed',
            action_data: { goal_id: goalId, goal_name: goal?.exercise_name, xp_earned: xpReward },
          });
        } catch (xpErr) {
          reportError(xpErr, { feature: 'goals.xp-update', level: 'warning', userEmail: user?.email, goalId, xpReward });
        }
      }
      // Snapshot the achieved values at completion time so Hub posts can
      // display "achieved / target" rather than just the target.
      const achievedUpdate = {};
      if (goal?.target_weight > 0) achievedUpdate.achieved_weight = goal.target_weight;
      if (goal?.target_reps > 0) achievedUpdate.achieved_reps = goal.target_reps;
      if (Object.keys(achievedUpdate).length > 0) {
        await goalsData.update(goalId, achievedUpdate);
      }

      return { xpReward, alreadyCompleted: false, goalName: goal?.exercise_name };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['goals', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['achievements', user?.email] });
      if (result?.alreadyCompleted) {
        // Idempotent double-tap path — no toast.
        return;
      }
      // Centralized celebration: confetti + haptic + XP toast + Sentry
      // breadcrumb. Replaces the previous plain-text toast — the user
      // now gets a real moment of feedback for hitting their target.
      fireGoalCelebration({
        goalName: result?.goalName,
        xpReward: result?.xpReward ?? 0,
        userEmail: user?.email,
      });
      // Quest progress — only on the genuine first completion.
      quests.recordAction(user, ACTION_TYPES.GOAL_COMPLETED, 1)
        .then(() => queryClient.invalidateQueries({ queryKey: ['dailyQuests'] }))
        .catch(err => reportError(err, { feature: 'goals.quest-credit', level: 'warning', userEmail: user?.email }));
    },
    onError: (err) => {
      reportError(err, { feature: 'goals.complete', userEmail: user?.email });
      toast.error(t('goals.toast.saveError'));
    },
  });

  const handleSubmit = (data) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const activeGoals = goals.filter(g => g.status === 'active');
  const completedGoals = goals.filter(g => g.status === 'completed');

  // When the form is open, the Dialog X-button should go back to the list
  // (not close the entire modal). This prevents "multiple exit paths" confusion —
  // X and Cancel both return to the list; only ESC / backdrop closes the modal.
  const handleOpenChange = (isOpen) => {
    if (!isOpen) {
      if (showForm) {
        closeForm(); // X pressed while editing → back to list
      } else {
        onClose();   // X pressed while browsing list → close modal
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">{t('goals.title')}</DialogTitle>
        </DialogHeader>

        {!showForm ? (
          <>
            {/* Tab buttons */}
            <div className="flex gap-2 border-b border-border">
              <button
                onClick={() => switchTab('active')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'active'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('goals.active')}
              </button>
              {completedGoals.length > 0 && (
                <button
                  onClick={() => switchTab('completed')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'completed'
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('goals.completed')}
                </button>
              )}
            </div>

            <div className="overflow-hidden mt-4">
              <AnimatePresence mode="wait" custom={tabDirection}>
                {activeTab === 'active' ? (
                  <motion.div
                    key="active"
                    custom={tabDirection}
                    initial={{ opacity: 0, x: tabDirection * -40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: tabDirection * 40 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  >
                    <Button onClick={() => setShowForm(true)} className="w-full mb-4">
                      <Plus className="w-4 h-4 me-2" /> {t('goals.addNew')}
                    </Button>
                    {activeGoals.length === 0 ? (
                      <div className="text-center py-12">
                        <Target className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                        <p className="font-heading font-semibold">{t('goals.noActive')}</p>
                        <p className="text-sm text-muted-foreground mt-1">{t('goals.noActiveDesc')}</p>
                      </div>
                    ) : (
                      <GoalsList
                        goals={activeGoals}
                        logs={logs}
                        isViewingCompleted={false}
                        onEdit={(goal) => { setEditing(goal); setShowForm(true); }}
                        onDelete={(id) => {
                          // Resolve the full goal object from cache so
                          // the optimistic-delete hook can restore by
                          // index if the user taps Undo.
                          const goal = (goals || []).find(g => g.id === id);
                          if (goal) optDelete.deleteWithUndo(goal);
                        }}
                        onComplete={(id) => completeMutation.mutate(id)}
                      />
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="completed"
                    custom={tabDirection}
                    initial={{ opacity: 0, x: tabDirection * -40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: tabDirection * 40 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  >
                    {completedGoals.length === 0 ? (
                      <div className="text-center py-12">
                        <Target className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                        <p className="font-heading font-semibold">{t('goals.noCompleted')}</p>
                        <p className="text-sm text-muted-foreground mt-1">{t('goals.noCompletedDesc')}</p>
                      </div>
                    ) : (
                      <GoalsList
                        goals={completedGoals}
                        logs={logs}
                        isViewingCompleted={true}
                        onEdit={(goal) => { setEditing(goal); setShowForm(true); }}
                        onDelete={(id) => {
                          // Resolve the full goal object from cache so
                          // the optimistic-delete hook can restore by
                          // index if the user taps Undo.
                          const goal = (goals || []).find(g => g.id === id);
                          if (goal) optDelete.deleteWithUndo(goal);
                        }}
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <GoalForm
            initial={editing}
            onSubmit={handleSubmit}
            onCancel={closeForm}
            userProfile={userProfile}
            isSubmitting={createMutation.isPending || updateMutation.isPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}