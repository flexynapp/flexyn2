// src/components/cardio/CardioGoals.jsx
//
// Cardio goal tracking, on the `goals` table, speaking the SAME
// vocabulary as the rest of the app:
//
//   goal_type    'cardio_distance' | 'cardio_duration' | 'cardio_sessions'
//   period       'week' | 'month' | 'lifetime'  (+ period_start_date)
//   target       target_distance_meters / target_duration_seconds /
//                target_sessions — one per goal, matching the type
//
// It used to write `goal_type = 'cardio'`, a fourth value nothing else
// understands, and read only that. Two consequences, both live in
// production on 2026-08-11:
//
//   • This screen queried `goal_type = 'cardio'` and found 0 rows, so it
//     said "No cardio goals yet" to an account holding two cardio goals
//     ("Run a 5K" ×2, both goal_type = 'cardio_distance').
//   • A goal created HERE fell through every branch of GoalsList, so it
//     rendered on the Workout goals list as the literal key path
//     "goals.type.cardio (Running)" at 0% — `goals.type.cardio` is not a
//     translation key either.
//
// The migration was free: zero rows carried the bad value, so there was
// nothing to convert. `goals.goal_type` has no CHECK constraint, which is
// exactly why the wrong value inserted happily for months.
//
// Progress comes from `computeCardioGoalProgress` in @/lib/goalProgress —
// the same function GoalsList and GoalsAlmostComplete call, so the three
// surfaces cannot disagree about how far along a goal is. This file used
// to run its own calculation off calendar-period bounds instead of the
// goal's `period_start_date`, which is a different answer for any goal
// created mid-week.

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Target, Plus, Trash2, CheckCircle2, Footprints, PersonStanding,
  Bike, Waves, Activity,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance, formatDuration, toMeters } from '@/lib/distanceUnit';
import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';
import * as goalsData from '@/lib/data/goals';
import {
  CARDIO_GOAL_TYPES, computeCardioGoalProgress, periodStartDate,
} from '@/lib/goalProgress';
import { cardioLogsKey } from '@/lib/data/cardioKeys';

const ACTIVITY_OPTIONS = [
  { value: 'running',  label: 'Running',  Icon: Footprints,      color: 'text-orange-500' },
  { value: 'walking',  label: 'Walking',  Icon: PersonStanding,  color: 'text-green-500' },
  { value: 'biking',   label: 'Cycling',  Icon: Bike,            color: 'text-blue-500' },
  { value: 'swimming', label: 'Swimming', Icon: Waves,           color: 'text-cyan-500' },
  { value: 'any',      label: 'Any Cardio', Icon: Activity,      color: 'text-primary' },
];

// One metric per goal, because that is what the goals table and every
// other goal surface model. The old form offered sessions AND distance on
// one goal, which has no representation in this vocabulary — and picking
// one to persist would have silently dropped the other.
const METRIC_OPTIONS = [
  { value: 'cardio_sessions', label: 'Sessions' },
  { value: 'cardio_distance', label: 'Distance' },
  { value: 'cardio_duration', label: 'Duration' },
];

const PERIOD_OPTIONS = ['week', 'month', 'lifetime'];

function activityInfo(val) {
  return ACTIVITY_OPTIONS.find(a => a.value === val) || ACTIVITY_OPTIONS[ACTIVITY_OPTIONS.length - 1];
}

// What a goal's progress line should read, per metric.
function formatCardioValue(goalType, value, distanceUnit) {
  if (goalType === 'cardio_distance') return formatDistance(value, distanceUnit, 1);
  if (goalType === 'cardio_duration') return formatDuration(value);
  return String(value);
}

function metricLabel(goalType) {
  return (METRIC_OPTIONS.find(m => m.value === goalType) || {}).label || 'Target';
}

// GoalForm-created goals carry no `title` — GoalsList labels them from the
// type and activity instead. Without a fallback they render here as a
// blank line, which is how the two "Run a 5K" rows would have looked the
// moment this screen started reading them.
function goalTitle(goal) {
  if (goal.title) return goal.title;
  return `${activityInfo(goal.cardio_activity).label} — ${metricLabel(goal.goal_type).toLowerCase()}`;
}

function GoalCreateForm({ onSave, onCancel, distanceUnit }) {
  const [title, setTitle] = useState('');
  const [activity, setActivity] = useState('running');
  const [metric, setMetric] = useState('cardio_sessions');
  const [period, setPeriod] = useState('week');
  const [target, setTarget] = useState('');
  const [durationH, setDurationH] = useState('');
  const [durationM, setDurationM] = useState('');
  const [saving, setSaving] = useState(false);

  // Defensive parse throughout — a non-numeric paste or an autofill used
  // to land NaN in the target column, and NaN survives all the way to a
  // progress bar that silently renders zero-width.
  const buildTarget = () => {
    if (metric === 'cardio_sessions') {
      const n = parseInt(target, 10);
      return (Number.isFinite(n) && n > 0) ? { target_sessions: Math.min(n, 500) } : null;
    }
    if (metric === 'cardio_distance') {
      const n = Number(target);
      return (Number.isFinite(n) && n > 0) ? { target_distance_meters: toMeters(distanceUnit, n) } : null;
    }
    const h = parseInt(durationH, 10) || 0;
    const m = parseInt(durationM, 10) || 0;
    const secs = h * 3600 + m * 60;
    return secs > 0 ? { target_duration_seconds: secs } : null;
  };

  const handleSave = async () => {
    if (!title.trim()) { toast.error('Give this goal a title'); return; }
    const targetCols = buildTarget();
    if (!targetCols) { toast.error('Enter a target above zero'); return; }
    setSaving(true);
    // Shaped to match GoalForm's cardio payload exactly — same goal_type
    // values, same period vocabulary, same period_start_date. The two
    // create paths have to produce rows the other one can read.
    await onSave({
      title: title.trim(),
      status: 'active',
      goal_type: metric,
      cardio_activity: activity,
      period,
      period_start_date: periodStartDate(period),
      ...targetCols,
    });
    setSaving(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
    >
      <Card className="p-4 space-y-4 border-primary/30 bg-primary/5">
        <p className="text-sm font-semibold">New Cardio Goal</p>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Title</label>
          <Input
            placeholder="e.g. Run 3× this week, Swim 10 km this month…"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={80}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Activity</label>
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_OPTIONS.map(a => (
              <button
                key={a.value}
                type="button"
                onClick={() => setActivity(a.value)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  activity === a.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Metric — one per goal. See METRIC_OPTIONS. */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Track</label>
          <div className="flex gap-2">
            {METRIC_OPTIONS.map(m => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMetric(m.value)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  metric === m.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Period — 'lifetime' replaces the old 'custom' + deadline pair.
            No other goal surface understood 'custom', and `deadline` was
            never read by any of them, so a custom goal behaved as an
            open-ended one while looking like it had an end date. */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Period</label>
          <div className="flex gap-2">
            {PERIOD_OPTIONS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors capitalize ${
                  period === p
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {metric === 'cardio_duration' ? (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Time target</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="number" min={0} max={999} inputMode="numeric"
                  value={durationH}
                  onChange={e => setDurationH(e.target.value)}
                  placeholder="0"
                  className="text-center"
                />
                <span className="text-xs text-muted-foreground mt-1 block text-center">hours</span>
              </div>
              <div className="flex-1">
                <Input
                  type="number" min={0} max={59} inputMode="numeric"
                  value={durationM}
                  onChange={e => setDurationM(e.target.value)}
                  placeholder="0"
                  className="text-center"
                />
                <span className="text-xs text-muted-foreground mt-1 block text-center">minutes</span>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {metric === 'cardio_sessions' ? 'Sessions target' : `Distance target (${distanceUnit})`}
            </label>
            <Input
              type="number"
              min={metric === 'cardio_sessions' ? 1 : 0}
              step={metric === 'cardio_sessions' ? 1 : 0.1}
              inputMode={metric === 'cardio_sessions' ? 'numeric' : 'decimal'}
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder={metric === 'cardio_sessions' ? 'e.g. 3' : 'e.g. 10'}
            />
          </div>
        )}

        <div className="flex gap-2">
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Create Goal'}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        </div>
      </Card>
    </motion.div>
  );
}

export default function CardioGoals() {
  const { user } = useAuth();
  const { distanceUnit } = useDistanceUnit();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const { data: goals = [], isLoading: goalsLoading } = useQuery({
    queryKey: ['cardioGoals', user?.email],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('goals')
        .select('*')
        .eq('created_by', user.email)
        // `.in`, not `.eq('cardio')` — this is the fix. Goals made from
        // the Workout page's goal form land under these three types and
        // were invisible here.
        .in('goal_type', CARDIO_GOAL_TYPES)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  // Fetch cardio logs once — every goal's progress reads this list.
  //
  // No `.gte(date, startOfMonth)` floor any more. That floor predated
  // lifetime goals and silently made them impossible: the two "Run a 5K"
  // goals in production are period 'lifetime', and a month floor would
  // have reported them against this month's runs only. It was also wrong
  // for a weekly goal in the first days of a month, whose week starts in
  // the previous one. `created_date` is selected because the shared
  // calculator uses it to ignore logs from before the goal existed.
  const { data: allLogs = [] } = useQuery({
    queryKey: cardioLogsKey(user?.email, 'goalProgress'),
    queryFn: async () => {
      const { data } = await supabase
        .from('cardio_logs')
        .select('date, created_date, type, distance_meters, duration_seconds')
        .eq('created_by', user.email)
        .order('date', { ascending: false })
        .limit(500);
      return data || [];
    },
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  // Progress comes from the shared calculator, so this screen, the
  // Workout goals list and the dashboard "almost there" card all give the
  // same answer for the same goal.
  const goalsWithProgress = useMemo(
    () => goals.map(goal => ({ ...goal, ...computeCardioGoalProgress(goal, allLogs) })),
    [goals, allLogs]
  );

  const handleAdd = async (payload) => {
    try {
      await goalsData.create({ ...payload, created_by: user.email });
      queryClient.invalidateQueries({ queryKey: ['cardioGoals', user?.email] });
      toast.success('Goal created!');
      setAdding(false);
    } catch (err) {
      reportError(err, { feature: 'cardio.goal.add' });
      toast.error('Failed to create goal');
    }
  };

  const handleDelete = async (goal) => {
    setDeleting(goal.id);
    try {
      await goalsData.update(goal.id, { status: 'deleted' });
      queryClient.invalidateQueries({ queryKey: ['cardioGoals', user?.email] });
      toast.success('Goal removed');
    } catch (err) {
      reportError(err, { feature: 'cardio.goal.delete' });
      toast.error('Failed to remove goal');
    } finally {
      setDeleting(null);
    }
  };

  // Persist `status='completed'` to the DB the first time a goal's
  // computed progress crosses the line. Without this, the UI happily
  // shows "✓ Done!" forever (because completion is recomputed every
  // render from cardio_logs) but the goal row stays status='active'
  // — no celebration ever fires from the global goal-completion
  // hooks, and the user can theoretically "re-complete" the goal
  // every page visit. Wave 57 (Cardio audit) caught this.
  // De-duped per goal-id by a ref so we don't fire the RPC twice in
  // the same session if the user re-renders while still over the bar.
  const completedRef = useRef(new Set());
  useEffect(() => {
    if (!user?.email) return;
    goalsWithProgress.forEach(goal => {
      if (goal.status === 'completed' || goal.status === 'deleted') return;
      if (completedRef.current.has(goal.id)) return;
      // One metric per goal now, so completion is just the shared
      // progress hitting 100 — no more "sessions unless there is no
      // sessions target, then distance" precedence to get wrong.
      // `target > 0` guards a malformed goal, which reports progress 0
      // and must never auto-complete.
      if (!(goal.target > 0 && goal.progress >= 100)) return;
      completedRef.current.add(goal.id);
      goalsData.update(goal.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ['cardioGoals', user?.email] }))
        .catch(err => {
          completedRef.current.delete(goal.id);
          reportError(err, { feature: 'cardio.goal.complete', level: 'warning' });
        });
    });
  }, [goalsWithProgress, user?.email, queryClient]);

  if (goalsLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!adding && (
        <Button className="w-full" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4 me-2" />
          New Cardio Goal
        </Button>
      )}

      <AnimatePresence>
        {adding && (
          <GoalCreateForm
            onSave={handleAdd}
            onCancel={() => setAdding(false)}
            distanceUnit={distanceUnit}
          />
        )}
      </AnimatePresence>

      {goalsWithProgress.map(goal => {
        const info = activityInfo(goal.cardio_activity);
        const isDone = goal.status === 'completed' || (goal.target > 0 && goal.progress >= 100);

        return (
          <motion.div
            key={goal.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <Card className={`p-4 ${isDone ? 'border-green-500/40 bg-green-500/5' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                    {isDone
                      ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                      : <info.Icon className={`w-4 h-4 ${info.color}`} />
                    }
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{goalTitle(goal)}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {info.label} · {goal.period}
                      {isDone && ' · ✓ Done!'}
                    </p>
                  </div>
                </div>
                <button
                  className="text-muted-foreground hover:text-destructive active:text-destructive transition-colors shrink-0"
                  onClick={() => handleDelete(goal)}
                  disabled={deleting === goal.id}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* One bar, because a goal now targets one metric. Two bars
                  used to imply a goal could need both, which the table has
                  never been able to express. */}
              {goal.target > 0 && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{metricLabel(goal.goal_type)}</span>
                    <span className="font-semibold">
                      {formatCardioValue(goal.goal_type, goal.currentValue, distanceUnit)}
                      {' / '}
                      {formatCardioValue(goal.goal_type, goal.target, distanceUnit)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${goal.progress}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        );
      })}

      {goals.length === 0 && !adding && (
        <Card className="p-8 border-dashed flex flex-col items-center gap-3 text-center">
          <Target className="w-8 h-8 text-muted-foreground/40" />
          <p className="text-sm font-semibold text-muted-foreground">No cardio goals yet</p>
          <p className="text-xs text-muted-foreground/70 max-w-[200px]">
            Set a weekly, monthly or lifetime target — sessions, distance or time.
          </p>
        </Card>
      )}
    </div>
  );
}
