import React, { useMemo, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2, Target, Trophy, Activity, Footprints, PersonStanding, Bike, MoreVertical } from 'lucide-react';
// AlertDialog removed — replaced by optimistic-delete-with-undo at
// the parent (GoalsModal). The undo toast IS the safety net now.
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import GoalProgressBar from './GoalProgressBar';
import { useSettings } from '@/lib/SettingsContext';
import { useLanguage } from '@/lib/LanguageContext';
import { triggerHaptic } from '@/lib/haptic';
import { computeStrengthGoalProgress } from '@/lib/goalProgress';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatWeight } from '@/lib/weightUnit';
import { formatDistance, formatDuration } from '@/lib/distanceUnit';

// Helper to match cardio activity
function matchesActivity(logType, activity) {
  if (activity === 'any') return true;
  return logType.startsWith(activity + '_');
}

export default function GoalsList({ goals, logs, cardioLogs = [], onEdit, onDelete, onComplete, isViewingCompleted = false }) {
  // Track which goal IDs have an in-flight delete/complete action so the
  // user can't double-tap. Parent owns the mutation; we just guard the
  // trigger here without requiring isPending to be plumbed through props.
  const [pendingIds, setPendingIds] = useState(() => ({ delete: new Set(), complete: new Set() }));
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
    triggerHaptic(kind === 'complete' ? 'primary' : 'warning');
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
  const { t } = useLanguage();
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
      } else if (goal.goal_type === 'cardio_distance') {
        // Distance goal
        let totalDistance = 0;
        cardioLogs?.forEach(log => {
          if (new Date(log.created_date) < new Date(goal.created_date)) return;
          if (goal.period !== 'lifetime' && log.date && goal.period_start_date) {
            if (new Date(log.date) < new Date(goal.period_start_date)) return;
          }
          if (matchesActivity(log.type, goal.cardio_activity)) {
            totalDistance += log.distance_meters || 0;
          }
        });
        currentValue = totalDistance;
        targetValue = goal.target_distance_meters;
        progress = Math.min(100, (totalDistance / targetValue) * 100);
        progressLabel = `${formatDistance(totalDistance, distanceUnit, 1)} / ${formatDistance(targetValue, distanceUnit, 1)}`;
        icon = goal.cardio_activity === 'running' ? Footprints : 
               goal.cardio_activity === 'biking' ? Bike :
               goal.cardio_activity === 'walking' ? PersonStanding : Activity;
      } else if (goal.goal_type === 'cardio_duration') {
        // Duration goal
        let totalSeconds = 0;
        cardioLogs?.forEach(log => {
          if (new Date(log.created_date) < new Date(goal.created_date)) return;
          if (goal.period !== 'lifetime' && log.date && goal.period_start_date) {
            if (new Date(log.date) < new Date(goal.period_start_date)) return;
          }
          if (matchesActivity(log.type, goal.cardio_activity)) {
            totalSeconds += log.duration_seconds || 0;
          }
        });
        currentValue = totalSeconds;
        targetValue = goal.target_duration_seconds;
        progress = Math.min(100, (totalSeconds / targetValue) * 100);
        progressLabel = `${formatDuration(totalSeconds)} / ${formatDuration(targetValue)}`;
        icon = goal.cardio_activity === 'running' ? Footprints : 
               goal.cardio_activity === 'biking' ? Bike :
               goal.cardio_activity === 'walking' ? PersonStanding : Activity;
      } else if (goal.goal_type === 'cardio_sessions') {
        // Sessions goal
        let sessionCount = 0;
        cardioLogs?.forEach(log => {
          if (new Date(log.created_date) < new Date(goal.created_date)) return;
          if (goal.period !== 'lifetime' && log.date && goal.period_start_date) {
            if (new Date(log.date) < new Date(goal.period_start_date)) return;
          }
          if (matchesActivity(log.type, goal.cardio_activity)) {
            sessionCount += 1;
          }
        });
        currentValue = sessionCount;
        targetValue = goal.target_sessions;
        progress = Math.min(100, (sessionCount / targetValue) * 100);
        progressLabel = `${sessionCount} / ${targetValue} ${t('goals.sessions')}`;
        icon = goal.cardio_activity === 'running' ? Footprints : 
               goal.cardio_activity === 'biking' ? Bike :
               goal.cardio_activity === 'walking' ? PersonStanding : Activity;
      }

      // For completed goals, always show 100% progress
      if (goal.status === 'completed') {
        progress = 100;
      }

      return {
        ...goal,
        progress: Math.min(Math.max(progress, 0), 100),
        progressLabel,
        currentValue,
        targetValue,
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
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!isViewingCompleted && onEdit && (
                      <DropdownMenuItem onClick={() => onEdit(goal)}>
                        <Pencil className="w-4 h-4 me-2" /> {t('common.edit')}
                      </DropdownMenuItem>
                    )}
                    {!isViewingCompleted && onEdit && <DropdownMenuSeparator />}
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

            <GoalProgressBar progress={goal.progress} animated={true} complete={goal.progress >= 100} />

            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-muted-foreground">{Math.round(goal.progress)}{t('goals.percentComplete')}</span>
              {goal.status === 'completed' ? (
                <Badge className="bg-green-500/10 text-green-600">Completed ✓</Badge>
              ) : goal.progress >= 100 ? (
                <span className="text-xs font-medium text-accent">Ready to complete!</span>
              ) : goal.progress >= 80 ? (
                <Badge className="bg-accent/10 text-accent">Almost there!</Badge>
              ) : null}
            </div>
            {goal.status !== 'completed' && goal.progress >= 100 && onComplete && (
              <Button
                size="sm"
                disabled={pendingIds.complete.has(goal.id)}
                className="mt-3 w-full bg-green-600 hover:bg-green-700 active:bg-green-700 text-white gap-2"
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