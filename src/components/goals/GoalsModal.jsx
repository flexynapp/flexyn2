import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as goalsData from '@/lib/data/goals';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { toast } from '@/lib/toast';
import { motion, AnimatePresence } from 'framer-motion';
import GoalForm from './GoalForm';
import GoalsList from './GoalsList';
import { fireFirstGoalCelebration } from '@/lib/firstGoalCelebration';
import { reportError } from '@/lib/reportError';
import { useOptimisticDelete } from '@/hooks/useOptimisticDelete';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { summarizeGoalTarget } from '@/lib/goalSummary';

export default function GoalsModal({ open, onClose, goals = [], logs = [], cardioLogs = [], userProfile = {}, startWithForm = false }) {
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

  const onDeleteGoal = (id) => {
    // Resolve the full goal from cache so the optimistic-delete hook can
    // restore it at its index if the user taps Undo.
    const goal = (goals || []).find(g => g.id === id);
    if (goal) optDelete.deleteWithUndo(goal);
  };

  // All three tabs always show, with counts. Hiding Done and Archived until
  // they had rows left a new account with a one-tab bar that read as broken.
  const TABS = [
    { id: 'active',    label: tFallback('goals.tab.active', 'Active'),     count: activeGoals.length },
    { id: 'completed', label: tFallback('goals.tab.done', 'Done'),         count: completedGoals.length },
    { id: 'archived',  label: tFallback('goals.archive.tab', 'Archived'),  count: archivedGoals.length },
  ];

  const empty = {
    active:    [tFallback('goals.empty.active', 'No goals yet'), tFallback('goals.empty.activeDesc', 'Pick a lift or a distance. Every set and run you log counts toward it.')],
    completed: [tFallback('goals.empty.done', 'Nothing finished yet'), tFallback('goals.empty.doneDesc', 'Goals you hit land here with the date you hit them.')],
    archived:  [tFallback('goals.archive.empty', 'Nothing archived'), tFallback('goals.archive.emptyDesc', 'Archive a goal to park it here without losing it.')],
  };
  const tabGoals = activeTab === 'active' ? activeGoals : activeTab === 'completed' ? completedGoals : archivedGoals;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto p-0 gap-0 outline-none"
        // Radix focuses the first tab on open, which paints a focus ring on
        // "Active" for a sheet opened by a tap. Keyboard users still Tab in.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-4 pt-4 pb-3 text-start">
          <DialogTitle className="font-heading text-lg">
            {!showForm ? t('goals.title')
              : editing ? tFallback('goals.editGoal', 'Edit goal')
              : tFallback('goals.newGoal', 'New goal')}
          </DialogTitle>
        </DialogHeader>

        {!showForm ? (
          <>
            <div role="tablist" className="flex gap-4 px-4 border-b border-border">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => switchTab(tab.id)}
                  className={`pb-2.5 -mb-px text-sm font-semibold border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground active:text-foreground'
                  }`}
                >
                  {tab.label}
                  <span className="ms-1.5 font-medium text-muted-foreground tabular-nums">{tab.count}</span>
                </button>
              ))}
            </div>

            <div className="overflow-hidden">
              <AnimatePresence mode="wait" custom={tabDirection}>
                <motion.div
                  key={activeTab}
                  custom={tabDirection}
                  initial={{ opacity: 0, x: tabDirection * -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: tabDirection * 24 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  className="px-4"
                >
                  {tabGoals.length === 0 ? (
                    <div className="py-8">
                      <p className="font-semibold text-sm">{empty[activeTab][0]}</p>
                      <p className="text-sm text-muted-foreground mt-1">{empty[activeTab][1]}</p>
                    </div>
                  ) : (
                    <GoalsList
                      goals={tabGoals}
                      logs={logs}
                      cardioLogs={cardioLogs}
                      isViewingCompleted={activeTab === 'completed'}
                      isViewingArchived={activeTab === 'archived'}
                      onEdit={(goal) => { setEditing(goal); setShowForm(true); }}
                      onDelete={onDeleteGoal}
                      onArchive={activeTab === 'completed' ? undefined : (id) => archiveMutation.mutateAsync(id)}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* One way to add a goal, at the foot of the list. It used to be a
                full-width orange button stacked on top of an empty state that
                asked for the same thing. */}
            {activeTab === 'active' && (
              <div className="px-4 pt-2 pb-4">
                <Button
                  variant={activeGoals.length === 0 ? 'default' : 'outline'}
                  onClick={() => setShowForm(true)}
                  className="w-full"
                >
                  <Plus className="w-4 h-4 me-2" /> {tFallback('goals.newGoal', 'New goal')}
                </Button>
              </div>
            )}
            {activeTab !== 'active' && <div className="h-4" />}
          </>
        ) : (
          <div className="px-4 pb-4">
            <GoalForm
              initial={editing}
              onSubmit={handleSubmit}
              onCancel={closeForm}
              userProfile={userProfile}
              isSubmitting={createMutation.isPending || updateMutation.isPending}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
