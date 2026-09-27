import React, { useMemo, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, Target, Dumbbell, Activity, Footprints, PersonStanding, Bike, MoreVertical, Pencil, Archive, ArchiveRestore, Check } from 'lucide-react';
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
import { formatWeight, formatWeightNumber } from '@/lib/weightUnit';
import { formatDistance, formatDuration } from '@/lib/distanceUnit';

// ── Goal rows, restyled 2026-09-27 (Goals redesign, option B) ─────────────
// Each goal used to be its own card with five stacked strips: name, an orange
// bar, "NN% complete", a badge, then the date, notes and a green button. The
// number that mattered was the smallest text on it. Rows now match Today's
// "To do" block: hairline rows, the value leads, the bar is neutral and turns
// green when the target is hit, and one quiet line says what is left.

const ACTIVITY_ICON = { running: Footprints, biking: Bike, walking: PersonStanding };

export default function GoalsList({ goals, logs, cardioLogs = [], onEdit, onDelete, onComplete, onArchive, isViewingCompleted = false, isViewingArchived = false }) {
  // Track which goal IDs have an in-flight delete/complete action so the
  // user can't double-tap. Parent owns the mutation; we just guard the
  // trigger here without requiring isPending to be plumbed through props.
  const [pendingIds, setPendingIds] = useState(() => ({ delete: new Set(), complete: new Set(), archive: new Set() }));
  const guardedAction = useCallback(async (kind, id, handler) => {
    setPendingIds(prev => {
      if (prev[kind].has(id)) return prev;
      return { ...prev, [kind]: new Set([...prev[kind], id]) };
    });
    // Complete is the high-intent moment (the celebration fires its own
    // pattern after success). Archive is reversible, so it buzzes quietly;
    // a 'warning' there would tell the hand it was destructive.
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
  const { weightUnit } = useWeightUnit();
  const { distanceUnit } = useDistanceUnit();

  /** Count-aware lookup — picks the `.one` / `.other` variant. */
  const tCount = useCallback((base, n, oneEn, otherEn) => (
    tFallback(`${base}.${n === 1 ? 'one' : 'other'}`, n === 1 ? oneEn : otherEn, { n })
  ), [tFallback]);

  const rows = useMemo(() => goals.map((goal) => {
    const cardio = isCardioGoal(goal);
    let progress = 0;
    let value = null;      // the big number: where you are
    let target = '';       // "225 lb × 5", the goal itself
    let toGo = null;       // "10 lb to go"
    let Icon = Target;
    let title;

    if (cardio) {
      const r = computeCardioGoalProgress(goal, cardioLogs);
      progress = r.progress;
      const left = Math.max(0, r.target - r.currentValue);
      if (goal.goal_type === 'cardio_distance') {
        value = formatDistance(r.currentValue, distanceUnit, 1);
        target = formatDistance(r.target, distanceUnit, 1);
        toGo = tFallback('goals.row.toGo', '{amount} to go', { amount: formatDistance(left, distanceUnit, 1) });
      } else if (goal.goal_type === 'cardio_duration') {
        value = formatDuration(r.currentValue);
        target = formatDuration(r.target);
        toGo = tFallback('goals.row.toGo', '{amount} to go', { amount: formatDuration(left) });
      } else {
        value = String(r.currentValue);
        target = tCount('goals.row.sessions', r.target, '{n} session', '{n} sessions');
        toGo = tCount('goals.row.sessionsToGo', left, '{n} session to go', '{n} sessions to go');
      }
      Icon = ACTIVITY_ICON[goal.cardio_activity] || Activity;
      const activity = goal.cardio_activity ? t(`goals.activity.${goal.cardio_activity}`) : t(`goals.type.${goal.goal_type}`);
      title = goal.period === 'week' || goal.period === 'month'
        ? `${activity}, ${t(`goals.period.${goal.period}`).toLowerCase()}`
        : activity;
    } else {
      const r = computeStrengthGoalProgress(goal, logs);
      progress = r.progress;
      const tw = Number(goal.target_weight) > 0 ? Number(goal.target_weight) : 0;
      const tr = Number(goal.target_reps) > 0 ? Number(goal.target_reps) : 0;
      Icon = Dumbbell;
      title = goal.exercise_name || tFallback('goals.unknownLift', 'Unknown lift');
      if (tw && tr) {
        // One set: show the set closest to the target, "215 × 5".
        value = r.bestSet
          ? `${formatWeightNumber(r.bestSet.weight, weightUnit)} × ${r.bestSet.reps}`
          : null;
        target = `${formatWeight(tw, weightUnit)} × ${tr}`;
        if (r.bestSet && r.bestSet.weight >= tw) {
          toGo = tCount('goals.row.repsToGo', Math.max(0, tr - r.bestSet.reps), '{n} rep to go', '{n} reps to go');
        } else if (r.bestSet) {
          toGo = tFallback('goals.row.toGo', '{amount} to go', { amount: formatWeight(tw - r.bestSet.weight, weightUnit) });
        }
      } else if (tw) {
        value = r.maxWeight > 0 ? formatWeightNumber(r.maxWeight, weightUnit) : null;
        target = formatWeight(tw, weightUnit);
        if (r.maxWeight > 0) toGo = tFallback('goals.row.toGo', '{amount} to go', { amount: formatWeight(Math.max(0, tw - r.maxWeight), weightUnit) });
      } else if (tr) {
        value = r.maxReps > 0 ? String(r.maxReps) : null;
        target = tCount('goals.row.repsInSet', tr, '{n} rep in one set', '{n} reps in one set');
        if (r.maxReps > 0) toGo = tCount('goals.row.repsToGo', Math.max(0, tr - r.maxReps), '{n} rep to go', '{n} reps to go');
      }
    }

    const done = goal.status === 'completed';
    if (done) progress = 100;
    const hit = progress >= 100;

    // Target date. `parseLocalDate` rather than `new Date(str)` — the latter
    // reads 'YYYY-MM-DD' as UTC midnight, so west of Greenwich a deadline
    // reads a day early and a goal due today announces itself overdue.
    const deadlineDate = goal.deadline ? parseLocalDate(goal.deadline) : null;
    const daysLeft = deadlineDate ? differenceInDays(deadlineDate, startOfToday()) : null;
    const completedDate = done && goal.completed_at ? new Date(goal.completed_at) : null;

    return {
      goal, title, Icon, value, target, toGo, hit, done,
      progress: Math.min(Math.max(progress, 0), 100),
      deadlineDate, daysLeft, completedDate,
      overdue: daysLeft != null && daysLeft < 0,
    };
  }), [goals, logs, cardioLogs, t, tFallback, tCount, distanceUnit, weightUnit]);

  if (goals.length === 0) return null;

  return (
    <ul className="flex flex-col">
      {rows.map((row) => {
        const { goal, title, Icon } = row;
        const showMenu = !isViewingCompleted || allowDeleteCompletedGoals;
        const canComplete = !row.done && row.hit && goal.status === 'active' && onComplete;

        // The line under the bar: what is left, then the date. A goal with no
        // date grows no date text ("a section with no data must not render").
        // The goal itself leads the line, so the title keeps the width it
        // needs on a small phone instead of sharing it with the target.
        let status = null;
        let statusTone = 'text-muted-foreground';
        let overdueText = null; // only the overdue clause takes the warning hue
        if (row.done) {
          status = [
            row.completedDate
              ? tFallback('goals.row.doneOn', 'Done {date}', { date: fmtDate(row.completedDate, { dateStyle: 'medium' }) })
              : tFallback('goals.row.done', 'Done'),
            row.target,
          ].filter(Boolean).join(' · ');
          statusTone = 'text-success';
        } else if (row.hit) {
          status = [tFallback('goals.row.hit', 'Target hit'), row.target].filter(Boolean).join(' · ');
          statusTone = 'text-success';
        } else {
          const bits = [tFallback('goals.row.target', 'Target {target}', { target: row.target })];
          if (row.toGo) bits.push(row.toGo);
          else if (row.value == null) bits.push(tFallback('goals.row.notStarted', 'Log a set to start it'));
          if (goal.deadline && goal.status === 'active') {
            if (row.overdue) {
              overdueText = tCount('goals.deadline.overdue', Math.abs(row.daysLeft), '{n} day past target', '{n} days past target');
            } else if (row.daysLeft === 0) {
              bits.push(tFallback('goals.deadline.today', 'Target date is today'));
            } else {
              bits.push(tCount('goals.deadline.left', row.daysLeft, '{n} day left', '{n} days left'));
            }
          }
          status = bits.join(' · ') || null;
        }

        return (
          <li key={goal.id} className="flex items-start gap-3 py-3 border-t border-border first:border-t-0">
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${row.done || row.hit ? 'text-foreground' : 'text-muted-foreground'}`} aria-hidden="true" />
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="font-semibold text-sm truncate">{title}</h4>
                <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
                  {row.done ? null : row.value}
                </span>
              </div>
              {!row.done && (
                <GoalProgressBar progress={row.progress} animated complete={row.hit} label={title} />
              )}
              {(status || overdueText) && (
                <p className={`text-xs ${statusTone}`}>
                  {status}
                  {overdueText && <span className="text-primary">{status ? ' · ' : ''}{overdueText}</span>}
                </p>
              )}
              {canComplete && (
                <Button
                  size="sm"
                  disabled={pendingIds.complete.has(goal.id)}
                  className="self-start mt-0.5 h-8 bg-success text-white gap-1.5 hover:brightness-105 active:brightness-105"
                  onClick={() => guardedAction('complete', goal.id, onComplete)}
                >
                  <Check className="w-4 h-4" aria-hidden="true" /> {tFallback('goals.row.markDone', 'Mark done')}
                </Button>
              )}
            </div>
            {showMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  {/* Named per goal so a screen reader tells the rows apart;
                      this is the only control that reaches edit / archive /
                      delete. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-me-2 -mt-1.5 h-8 w-8 text-muted-foreground"
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
                  {/* Archive sits above the delete separator: it is the
                      non-destructive answer to the same want. A completed goal
                      is not archivable, because that would hide the record of
                      a reward already paid. */}
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
                  {/* No confirm: the optimistic-delete toast with Undo is the
                      safety net. */}
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
          </li>
        );
      })}
    </ul>
  );
}
