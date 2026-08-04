// src/components/cardio/CardioGoals.jsx
//
// Cardio-specific goal tracking. Uses the existing `goals` table
// (goal_type = 'cardio') which already has columns:
//   cardio_activity, target_distance_meters, target_duration_seconds,
//   target_sessions, period ('week' | 'month' | 'custom'), deadline.
//
// Auto-computes progress from cardio_logs within the current period.
// Users can create "Run 5k 3× per week" or "Bike 50 km this month"-style goals.

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
import { format, startOfWeek, startOfMonth, endOfWeek, endOfMonth } from 'date-fns';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance } from '@/lib/distanceUnit';
import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';
import * as goalsData from '@/lib/data/goals';

const ACTIVITY_OPTIONS = [
  { value: 'running',  label: 'Running',  Icon: Footprints,      color: 'text-orange-500' },
  { value: 'walking',  label: 'Walking',  Icon: PersonStanding,  color: 'text-green-500' },
  { value: 'biking',   label: 'Cycling',  Icon: Bike,            color: 'text-blue-500' },
  { value: 'swimming', label: 'Swimming', Icon: Waves,           color: 'text-cyan-500' },
  { value: 'any',      label: 'Any Cardio', Icon: Activity,      color: 'text-primary' },
];

function activityInfo(val) {
  return ACTIVITY_OPTIONS.find(a => a.value === val) || ACTIVITY_OPTIONS[ACTIVITY_OPTIONS.length - 1];
}

function periodBounds(period, deadline) {
  const now = new Date();
  if (period === 'week') {
    return { start: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
             end:   format(endOfWeek(now,   { weekStartsOn: 1 }), 'yyyy-MM-dd') };
  }
  if (period === 'month') {
    return { start: format(startOfMonth(now), 'yyyy-MM-dd'),
             end:   format(endOfMonth(now),   'yyyy-MM-dd') };
  }
  // custom: from goal creation date to deadline
  return { start: '2000-01-01', end: deadline || format(now, 'yyyy-MM-dd') };
}

function GoalCreateForm({ onSave, onCancel, distanceUnit }) {
  const [title, setTitle] = useState('');
  const [activity, setActivity] = useState('running');
  const [period, setPeriod] = useState('week');
  const [deadline, setDeadline] = useState('');
  const [targetSessions, setTargetSessions] = useState('');
  const [targetDistKm, setTargetDistKm] = useState('');
  const [saving, setSaving] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');

  const handleSave = async () => {
    if (!title.trim()) { toast.error('Give this goal a title'); return; }
    if (!targetSessions && !targetDistKm) {
      toast.error('Set at least one target: sessions OR distance');
      return;
    }
    // Defensive parse — non-numeric paste / autofill used to land
    // NaN in target_distance_meters and target_sessions, breaking
    // every downstream progress calculation.
    let distMeters = null;
    if (targetDistKm) {
      const d = Number(targetDistKm);
      if (Number.isFinite(d) && d > 0) {
        distMeters = d * (distanceUnit === 'mi' ? 1609.344 : 1000);
      }
    }
    let sessionsNum = null;
    if (targetSessions) {
      const s = parseInt(targetSessions, 10);
      if (Number.isFinite(s) && s > 0) sessionsNum = s;
    }
    if (distMeters == null && sessionsNum == null) {
      toast.error('Enter a valid target value');
      return;
    }
    setSaving(true);
    await onSave({
      title: title.trim(),
      goal_type: 'cardio',
      cardio_activity: activity,
      period,
      deadline: (period === 'custom' && deadline) ? deadline : null,
      target_sessions: sessionsNum,
      target_distance_meters: distMeters,
      status: 'active',
      current_value: 0,
      target_value: sessionsNum || 0,
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

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Period</label>
          <div className="flex gap-2">
            {['week', 'month', 'custom'].map(p => (
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

        {period === 'custom' && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Deadline</label>
            <Input
              type="date"
              value={deadline}
              min={today}
              onChange={e => setDeadline(e.target.value)}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Sessions target</label>
            <Input
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              value={targetSessions}
              onChange={e => setTargetSessions(e.target.value)}
              placeholder="e.g. 3"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Distance ({distanceUnit})
            </label>
            <Input
              type="number"
              step="0.1"
              min={0}
              inputMode="decimal"
              value={targetDistKm}
              onChange={e => setTargetDistKm(e.target.value)}
              placeholder="e.g. 10"
            />
          </div>
        </div>

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
        .eq('goal_type', 'cardio')
        .neq('status', 'deleted')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  // Fetch all recent cardio logs once — used by all goals for progress
  const { data: allLogs = [] } = useQuery({
    queryKey: ['cardioLogs', user?.email],
    queryFn: async () => {
      const { data } = await supabase
        .from('cardio_logs')
        .select('date, type, distance_meters, duration_seconds')
        .eq('created_by', user.email)
        .gte('date', format(startOfMonth(new Date()), 'yyyy-MM-dd'));
      return data || [];
    },
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  // Compute progress for each goal
  const goalsWithProgress = useMemo(() => {
    return goals.map(goal => {
      const bounds = periodBounds(goal.period, goal.deadline);
      const relevant = allLogs.filter(l => {
        if (!l.date || l.date < bounds.start || l.date > bounds.end) return false;
        if (goal.cardio_activity === 'any') return true;
        return l.type?.startsWith(goal.cardio_activity);
      });
      const sessions = relevant.length;
      const distMeters = relevant.reduce((s, l) => s + (l.distance_meters || 0), 0);
      return { ...goal, _sessions: sessions, _distMeters: distMeters };
    });
  }, [goals, allLogs]);

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
      const sessPct = goal.target_sessions
        ? (goal._sessions / goal.target_sessions) * 100 : null;
      const distPct = goal.target_distance_meters
        ? (goal._distMeters / goal.target_distance_meters) * 100 : null;
      const done = (sessPct != null && sessPct >= 100)
                || (!goal.target_sessions && distPct != null && distPct >= 100);
      if (!done) return;
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
        const sessionPct = goal.target_sessions
          ? Math.min((goal._sessions / goal.target_sessions) * 100, 100)
          : null;
        const distPct = goal.target_distance_meters
          ? Math.min((goal._distMeters / goal.target_distance_meters) * 100, 100)
          : null;
        const isDone = (sessionPct === 100 || (!goal.target_sessions && distPct === 100));

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
                    <p className="font-semibold text-sm truncate">{goal.title}</p>
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

              {/* Session progress */}
              {goal.target_sessions && (
                <div className="mb-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Sessions</span>
                    <span className="font-semibold">{goal._sessions} / {goal.target_sessions}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${sessionPct}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              )}

              {/* Distance progress */}
              {goal.target_distance_meters && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Distance</span>
                    <span className="font-semibold">
                      {formatDistance(goal._distMeters, distanceUnit, 1)} / {formatDistance(goal.target_distance_meters, distanceUnit, 1)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-orange-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${distPct}%` }}
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
            Set weekly or monthly targets — sessions, distance, or both.
          </p>
        </Card>
      )}
    </div>
  );
}
