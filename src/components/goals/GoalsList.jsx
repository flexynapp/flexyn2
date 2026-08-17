import React, { useMemo, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2, Target, Trophy, Activity, Footprints, PersonStanding, Bike, MoreVertical, CalendarClock, Archive, ArchiveRestore } from 'lucide-react';
import { differenceInDays, startOfToday } from 'date-fns';
import { parseLocalDate } from '@/lib/dateUtils';
import { useDateFormatter } from '@/lib/intl';
// AlertDialog removed — replaced by optimistic-delete-with-undo at
// the parent (GoalsModal). The undo toast IS the safety net now.
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import GoalProgressBar from './GoalProgressBar';
import { useSettings } from '@/lib/SettingsContext';
import { useLanguage } from '@/lib/LanguageContext';
import { triggerHaptic } from '@/lib/haptic';
import { computeStrengthGoalProgress, computeCardioGoalProgress, isCardioGoal } from '@/lib/goalProgress';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatWeight } from '@/lib/weightUnit';
import { formatDistance, formatDuration } from '@/lib/distanceUnit';

export default function GoalsList({ goals, logs, cardioLogs = [], onEdit, onDelete, onComplete, onArchive, isViewingCompleted = false, isViewingArchived = false }) {
  // Track which goal IDs have an in-flight delete/complete action so the
  // user can't double-tap. Parent owns the mutation; we just guard the
  // trigger here without requiring isPending to be plumbed through props.
  const [pendingIds, setPendingIds] = useState(() => ({ delete: new Set(), complete: new Set(), archive: new Set() }));
  const guardedAction = useCallback(async (kind, id, handler) => {
    setPendingIds(prev => {
      if (prev[kind].has(id)) return prev;
      const next = { ...prev, [kind]: new Set([...prev[kind], id]) };
      return next;
    });
    // Primary action — completing a goal is a high-intent moment; the
    // celebration helper fires its own distinct pattern after success.
    // Delete fires a warning haptic; the optimistic-delete toast at
    // the parent surfaces with Undo so this is forgiving rather than
    // destructive.
    // Archive is reversible and unremarkable — a 'warning' buzz would tell the
    // hand this was destructive when it is the control that exists so the user
    // does not have to be.
    triggerHaptic(kind === 'complete' ? 'primary' : kind === 'archive' ? 'subtle' : 'warning');
    try {
      await handler(id);
    } finally {
      setPendingIds(prev => {
        const nextSet = new Set(prev[kind]);
        nextSet.delete(id);
        return { ...prev, [kind]: nextSet };
      });
    }
  }, []);
  const { allowDeleteCompletedGoals } = useSettings();
  const { t, tFallback } = useLanguage();
  const fmtDate = useDateFormatter();

  /** Count-aware lookup — picks the `.one` / `.other` variant. */
  const tCount = useCallback((base, n, oneEn, otherEn) => (
    tFallback(`${base}.${n === 1 ? 'one' : 'other'}`, n === 1 ? oneEn : otherEn, { n })
  ), [tFallback]);
  const { weightUnit } = useWeightUnit();
  const { distanceUnit } = useDistanceUnit();
  
  const goalsWithProgress = useMemo(() => {
    return goals.map(goal => {
      let progress = 0;
      let progressLabel = '';
      let currentValue = 0;
      let targetValue = 0;
      let icon = null;

      if (!goal.goal_type || goal.goal_type === 'strength') {
        // Strength goal progress now comes from the shared helper at
        // src/lib/goalProgress.js — same logic as GoalsAlmostComplete
        // so the two views can't disagree on progress (the audit
        // found they did, by quite a lot). Also fixes:
        //   • bodyweight goals (push-ups, pull-ups, etc.) now count
        //     reps when weight is null/0
        //   • reps count at OR ABOVE target weight, not exactly equal
        const r = computeStrengthGoalProgress(goal, logs);
        progress     = r.progress;
        currentValue = r.currentValue;
      } else if (isCardioGoal(goal)) {
        // All three cardio types share one calculator now — the three
        // branches here were the same loop with a different accumulator,
        // and a fourth copy of it lived in GoalsAlmostComplete and a
        // fifth in CardioGoals. Only the LABEL differs per type.
        const r = computeCardioGoalProgress(goal, cardioLogs);
        progress     = r.progress;
        currentValue = r.currentValue;
        targetValue  = r.target;
        progressLabel =
          goal.goal_type === 'cardio_distance'
            ? `${formatDistance(currentValue, distanceUnit, 1)} / ${formatDistance(targetValue, distanceUnit, 1)}`
            : goal.goal_type === 'cardio_duration'
              ? `${formatDuration(currentValue)} / ${formatDuration(targetValue)}`
              : `${currentValue} / ${targetValue} ${t('goals.sessions')}`;
        icon = goal.cardio_activity === 'running' ? Footprints :
               goal.cardio_activity === 'biking'  ? Bike :
               goal.cardio_activity === 'walking' ? PersonStanding : Activity;
      }

      // For completed goals, always show 100% progress
      if (goal.status === 'completed') {
        progress = 100;
      }

      // Target date. `parseLocalDate` rather than `new Date(str)` — the
      // latter reads 'YYYY-MM-DD' as UTC midnight, so west of Greenwich a
      // deadline reads as one day earlier than the day the user picked, and
      // a goal due today announces itself overdue. Same trap the Insights
      // "training since" label was fixed for.
      const deadlineDate = goal.deadline ? parseLocalDate(goal.deadline) : null;
      const daysLeft = deadlineDate ? differenceInDays(deadlineDate, startOfToday()) : null;

      return {
        ...goal,
        progress: Math.min(Math.max(progress, 0), 100),
        progressLabel,
        currentValue,
        targetValue,
        deadlineDate,
        daysLeft,
        overdue: daysLeft != null && daysLeft < 0,
        icon: icon || Target,
      };
    });
  }, [goals, logs, cardioLogs, t, distanceUnit]);

  if (goals.length === 0) {
    return (
      <Card className="p-8 text-center border-dashed">
        <Target className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <p className="font-heading font-semibold">{t('goals.noActive')}</p>
        <p className="text-sm text-muted-foreground mt-1">{t('goals.noActiveDesc')}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {goalsWithProgress.map((goal) => {
        const Icon = goal.icon;
        const title = (!goal.goal_type || goal.goal_type === 'strength')
          ? (goal.exercise_name || 'Unknown Exercise')
          : goal.goal_type && goal.cardio_activity
          ? `${t(`goals.type.${goal.goal_type}`)} (${t(`goals.activity.${goal.cardio_activity}`)})`
          : 'Unknown Goal';
        
        return (
          <Card key={goal.id} className="p-4 border-none shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 flex items-start gap-3">
                <div className="mt-0.5 w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h4 className="font-heading font-bold">{title}</h4>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {goal.progressLabel
                      || (goal.target_weight != null && goal.target_weight > 0
                          ? `${formatWeight(Math.min(goal.currentValue || 0, goal.target_weight), weightUnit)} / ${formatWeight(goal.target_weight, weightUnit)}`
                          : goal.target_reps != null && goal.target_reps > 0
                            ? `${Math.min(goal.currentValue || 0, goal.target_reps)} / ${goal.target_reps} ${t('goals.reps')}`
                            : null)
                    }
                  </p>
                </div>
              </div>
              {/* Single ⋮ menu replaces separate Edit / Delete buttons */}
              {(!isViewingCompleted || (isViewingCompleted && allowDeleteCompletedGoals)) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    {/* An icon-only button with no accessible name announces
                        as "button" and nothing else, on the only control that
                        reaches edit / archive / delete. Named per goal so a
                        screen reader distinguishes the rows. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={tFallback('goals.rowMenu', 'Options for {name}', { name: title })}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!isViewingCompleted && onEdit && (
                      <DropdownMenuItem onClick={() => onEdit(goal)}>
                        <Pencil className="w-4 h-4 me-2" /> {t('common.edit')}
                      </DropdownMenuItem>
                    )}
                    {/* ── Archive / Unarchive ──────────────────────────
                        Sits ABOVE the delete separator because it is the
                        non-destructive answer to the same want. Delete was
                        the only way to clear a goal you had lost interest
                        in, which meant the honest options were "keep it
                        nagging you from the Dashboard strip" or "destroy
                        the record". Archiving keeps the row, its notes and
                        its date, and takes it out of every active surface. */}
                    {onArchive && goal.status !== 'completed' && (
                      <DropdownMenuItem
                        disabled={pendingIds.archive.has(goal.id)}
                        onClick={() => guardedAction('archive', goal.id, onArchive)}
                      >
                        {isViewingArchived
                          ? <><ArchiveRestore className="w-4 h-4 me-2" /> {tFallback('goals.archive.undo', 'Unarchive')}</>
                          : <><Archive className="w-4 h-4 me-2" /> {tFallback('goals.archive.action', 'Archive')}</>}
                      </DropdownMenuItem>
                    )}
                    {onArchive && goal.status !== 'completed' && <DropdownMenuSeparator />}
                    {/* No confirmation dialog — the optimistic-delete
                        toast with Undo (parent) IS the safety net.
                        Faster than a confirm, safer than a confirm. */}
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      disabled={pendingIds.delete.has(goal.id)}
                      onClick={() => guardedAction('delete', goal.id, onDelete)}
                    >
                      <Trash2 className="w-4 h-4 me-2" /> {t('common.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            <GoalProgressBar
              progress={goal.progress}
              animated={true}
              complete={goal.progress >= 100}
              label={title}
            />

            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-muted-foreground">{Math.round(goal.progress)}{t('goals.percentComplete')}</span>
              {/* These three were raw English literals inside a 15-language
                  app — "Completed ✓", "Ready to complete!", "Almost there!"
                  rendered untranslated everywhere. The green was raw Tailwind
                  too; `success` is the token the four-hue rule allows. */}
              {goal.status === 'completed' ? (
                <Badge className="bg-success/10 text-success">
                  {tFallback('goals.badge.completed', 'Completed ✓')}
                </Badge>
              ) : goal.progress >= 100 ? (
                <span className="text-xs font-medium text-accent">
                  {tFallback('goals.badge.readyToComplete', 'Ready to complete!')}
                </span>
              ) : goal.progress >= 80 ? (
                <Badge className="bg-accent/10 text-accent">
                  {tFallback('goals.badge.almostThere', 'Almost there!')}
                </Badge>
              ) : null}
            </div>

            {/* ── Target date ──────────────────────────────────────────────
                Rendered only when the goal carries one. A goal with no
                deadline must not grow an empty row saying so — per the
                "a section with no data must not render as zeros" rule. An
                overdue goal is FLAGGED, never failed: the date was always
                advisory, and turning a missed date into a red failure state
                punishes the user for aiming at something. */}
            {goal.deadline && goal.status === 'active' && (
              <div className="flex items-center gap-1.5 mt-2">
                <CalendarClock
                  className={`w-3.5 h-3.5 shrink-0 ${goal.overdue ? 'text-primary' : 'text-muted-foreground'}`}
                />
                <span className={`text-xs ${goal.overdue ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                  {goal.overdue
                    ? tCount('goals.deadline.overdue', Math.abs(goal.daysLeft),
                        '{n} day past target', '{n} days past target')
                    : goal.daysLeft === 0
                      ? tFallback('goals.deadline.today', 'Target date is today')
                      : tCount('goals.deadline.left', goal.daysLeft,
                          '{n} day left', '{n} days left')}
                  <span className="text-muted-foreground/70"> · {fmtDate(goal.deadlineDate, { dateStyle: 'medium' })}</span>
                </span>
              </div>
            )}

            {goal.status !== 'completed' && goal.progress >= 100 && onComplete && (
              <Button
                size="sm"
                disabled={pendingIds.complete.has(goal.id)}
                className="mt-3 w-full bg-success text-white gap-2 hover:brightness-105 active:brightness-105"
                onClick={() => guardedAction('complete', goal.id, onComplete)}
              >
                <Trophy className="w-4 h-4" /> {t('goals.complete')}
              </Button>
            )}

            {goal.notes && (
              <p className="text-xs text-muted-foreground mt-2 italic">{goal.notes}</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}