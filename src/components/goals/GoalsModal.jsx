import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import * as goalsData from '@/lib/data/goals';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { calculateGoalXp } from '@/lib/xpSystem';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus, Target } from 'lucide-react';
import { toast } from '@/lib/toast';
import { motion, AnimatePresence } from 'framer-motion';
import GoalForm from './GoalForm';
import GoalsList from './GoalsList';
import { fireGoalCelebration } from '@/lib/goalCelebration';
import { fireFirstGoalCelebration } from '@/lib/firstGoalCelebration';
import { reportError } from '@/lib/reportError';
import { useOptimisticDelete } from '@/hooks/useOptimisticDelete';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { summarizeGoalTarget } from '@/lib/goalSummary';

export default function GoalsModal({ open, onClose, goals = [], logs = [], userProfile = {}, startWithForm = false }) {
  const [showForm, setShowForm] = useState(false);
  // Today's "Set a goal" card opens straight onto the form: the person has
  // already said what they want, so the empty list in between is a wasted tap.
  useEffect(() => {
    if (open && startWithForm) setShowForm(true);
  }, [open, startWithForm]);
  const [editing, setEditing] = useState(null);
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'completed'
  const [tabDirection, setTabDirection] = useState(1);
  const { t, tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();

  // Slide direction from the tab's position in the bar, not from its name.
  // The old `tab === 'completed' ? 1 : -1` only ever described two tabs, so
  // with Archived added, Completed → Archived would have animated backwards.
  const TAB_ORDER = ['active', 'completed', 'archived'];
  const switchTab = (tab) => {
    setTabDirection(TAB_ORDER.indexOf(tab) >= TAB_ORDER.indexOf(activeTab) ? 1 : -1);
    setActiveTab(tab);
  };
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Declared ABOVE the mutations that close over them. `archiveMutation`
  // reads `archivedGoals` in its onSuccess, and while that callback only runs
  // after render — so the binding is initialized by then — CLAUDE.md's TDZ
  // rule is "declare before first use, full stop", because the one time the
  // exception does not hold it is a production crash in minified code.
  //
  // Three statuses now, and each list is an EXPLICIT equality test. The old
  // `status !== 'completed'` shorthand would have swept archived rows straight
  // back into the active list.
  const activeGoals    = goals.filter(g => g.status === 'active');
  const completedGoals = goals.filter(g => g.status === 'completed');
  const archivedGoals  = goals.filter(g => g.status === 'archived');

  const createMutation = useMutation({
    mutationFn: (data) => goalsData.create(data),
    onSuccess: (created, submittedData) => {
      queryClient.invalidateQueries({ queryKey: ['goals', user?.email] });
      setShowForm(false);

      // First-goal milestone — `goals` prop reflects the list BEFORE
      // this insert (parent's re-render lands on the next tick).
      // Active-only filter ensures a user with all-completed goals
      // still triggers when they set a fresh one.
      // `=== 'active'`, not `!== 'completed'`. Under the old test a user whose
      // only goals were archived counted as already having one, so setting a
      // fresh goal after clearing house skipped the first-goal celebration.
      const activePrev = (goals || []).filter(g => g.status === 'active');
      const isFirstGoal = activePrev.length === 0;
      if (isFirstGoal) {
        fireFirstGoalCelebration({
          t: tFallback,
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
    label: tFallback('goals.toast.deleted', 'Goal deleted'),
    feature: 'goals.delete',
    t: tFallback,
  });

  // Archive / unarchive. A plain status write — no XP, no quest credit, no
  // celebration, deliberately: archiving is housekeeping, and paying it like an
  // achievement would make "archive everything" the cheapest XP in the app.
  const archiveMutation = useMutation({
    mutationFn: async (goalId) => {
      const goal = goals.find(g => g.id === goalId);
      const next = goal?.status === 'archived' ? 'active' : 'archived';
      await goalsData.update(goalId, { status: next });
      return next;
    },
    onSuccess: (next) => {
      queryClient.invalidateQueries({ queryKey: ['goals', user?.email] });
      toast.success(next === 'archived'
        ? tFallback('goals.archive.toastArchived', 'Goal archived')
        : tFallback('goals.archive.toastRestored', 'Goal restored'));
      // Leaving the tab empty strands the user on a blank panel with no
      // obvious way back, so restoring the last archived goal returns them
      // to the list it went back to.
      if (next === 'active' && archivedGoals.length <= 1) switchTab('active');
    },
    onError: (err) => {
      reportError(err, { feature: 'goals.archive', userEmail: user?.email });
      toast.error(t('goals.toast.saveError'));
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (goalId) => {
      const goal = goals.find(g => g.id === goalId);
      // One formula, in xpSystem.js. This was duplicated here and in
      // GoalsAlmostComplete.jsx, both capped at 500 — a single goal could
      // pay the whole day's goal_completed allowance.
      const xpReward = calculateGoalXp(goal);

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
                    : 'border-transparent text-muted-foreground hover:text-foreground active:text-foreground'
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
                      : 'border-transparent text-muted-foreground hover:text-foreground active:text-foreground'
                  }`}
                >
                  {t('goals.completed')}
                </button>
              )}
              {/* Only once something is in it. An always-present Archived tab
                  on a brand-new account is a promise of content that does not
                  exist, and it is the same rule the Completed tab beside it
                  already follows. */}
              {archivedGoals.length > 0 && (
                <button
                  onClick={() => switchTab('archived')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'archived'
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground active:text-foreground'
                  }`}
                >
                  {tFallback('goals.archive.tab', 'Archived')}
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
                        onArchive={(id) => archiveMutation.mutateAsync(id)}
                      />
                    )}
                  </motion.div>
                ) : activeTab === 'archived' ? (
                  <motion.div
                    key="archived"
                    custom={tabDirection}
                    initial={{ opacity: 0, x: tabDirection * -40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: tabDirection * 40 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  >
                    {archivedGoals.length === 0 ? (
                      <div className="text-center py-12">
                        <Target className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                        <p className="font-heading font-semibold">
                          {tFallback('goals.archive.empty', 'Nothing archived')}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {tFallback('goals.archive.emptyDesc', 'Archive a goal to park it here without losing it.')}
                        </p>
                      </div>
                    ) : (
                      <GoalsList
                        goals={archivedGoals}
                        logs={logs}
                        isViewingArchived={true}
                        onEdit={(goal) => { setEditing(goal); setShowForm(true); }}
                        onDelete={(id) => {
                          const goal = (goals || []).find(g => g.id === id);
                          if (goal) optDelete.deleteWithUndo(goal);
                        }}
                        onArchive={(id) => archiveMutation.mutateAsync(id)}
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