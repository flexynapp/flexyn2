// src/components/cardio/CardioPlanned.jsx
//
// Planned cardio sessions — future-dated workouts the user has scheduled.
// "I plan to run 5k on Thursday." Shows upcoming + past planned sessions.
// Users can add plans, mark them complete (links to an actual cardio log),
// or delete them.

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Footprints, PersonStanding, Bike, Waves, Activity,
  Plus, Trash2, CheckCircle2, CalendarDays, Clock
} from 'lucide-react';
import { format, parseISO, isPast, isToday } from 'date-fns';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance } from '@/lib/distanceUnit';
import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';

const TYPE_OPTIONS = [
  { value: 'running_outside',  label: 'Run (outdoor)', Icon: Footprints,      color: 'text-orange-500' },
  { value: 'running_treadmill',label: 'Run (treadmill)', Icon: Footprints,    color: 'text-orange-500' },
  { value: 'walking_outside',  label: 'Walk',            Icon: PersonStanding, color: 'text-green-500' },
  { value: 'biking_outside',   label: 'Bike (outdoor)',  Icon: Bike,           color: 'text-blue-500' },
  { value: 'biking_stationary',label: 'Bike (stationary)',Icon: Bike,          color: 'text-blue-500' },
  { value: 'swimming_pool',    label: 'Swim',            Icon: Waves,          color: 'text-cyan-500' },
];

function typeInfo(type) {
  return TYPE_OPTIONS.find(o => o.value === type) || {
    label: type?.replace(/_/g, ' ') || 'Workout',
    Icon: Activity,
    color: 'text-primary',
  };
}

function PlanForm({ onSave, onCancel, distanceUnit }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('running_outside');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [distance, setDistance] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');

  const handleSave = async () => {
    if (!title.trim()) { toast.error('Give this plan a title'); return; }
    // Reject past dates explicitly. The HTML `min={today}` attribute is
    // advisory only — a paste / direct-value set bypasses it and a
    // past-dated plan silently lands in the upcoming list as already-
    // expired, confusing the user. Wave 57 (Cardio audit) caught this.
    if (date && date < today) {
      toast.error("That date is in the past. Pick today or later.");
      return;
    }
    // Defensive parse — a non-numeric string (e.g. paste from
    // clipboard, autocomplete) used to produce NaN * 1609.344 = NaN
    // which got persisted to distance_meters and broke downstream
    // display + filtering. Coerce, validate, then convert.
    let distanceMeters = null;
    if (distance !== '' && distance != null) {
      const n = Number(distance);
      if (Number.isFinite(n) && n > 0) {
        distanceMeters = n * (distanceUnit === 'mi' ? 1609.344 : 1000);
      }
    }
    setSaving(true);
    await onSave({
      title: title.trim(),
      type,
      planned_date: date,
      distance_meters: distanceMeters,
      notes: notes || null,
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
        <p className="text-sm font-semibold">New Planned Session</p>

        {/* Title */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Title</label>
          <Input
            placeholder="e.g. Morning 5k, Long ride…"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={80}
          />
        </div>

        {/* Type */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Activity</label>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={type}
            onChange={e => setType(e.target.value)}
          >
            {TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Date */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Date</label>
          <Input
            type="date"
            value={date}
            min={today}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        {/* Distance (optional) */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Distance (optional)
          </label>
          <div className="relative">
            <Input
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              value={distance}
              onChange={e => setDistance(e.target.value)}
              className="pe-10"
              placeholder="0.00"
            />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{distanceUnit}</span>
          </div>
        </div>

        {/* Notes */}
        <Input
          placeholder="Notes… (optional)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          maxLength={200}
        />

        <div className="flex gap-2">
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Add Plan'}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        </div>
      </Card>
    </motion.div>
  );
}

export default function CardioPlanned() {
  const { user } = useAuth();
  const { distanceUnit } = useDistanceUnit();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['plannedCardio', user?.email],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('planned_cardio')
        .select('*')
        .eq('created_by', user.email)
        .order('planned_date', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  const handleAdd = async (payload) => {
    try {
      const { error } = await supabase
        .from('planned_cardio')
        .insert({ ...payload, created_by: user.email });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['plannedCardio', user?.email] });
      toast.success('Plan added!');
      setAdding(false);
    } catch (err) {
      reportError(err, { feature: 'cardio.planned.add' });
      toast.error('Failed to add plan');
    }
  };

  const handleDelete = async (plan) => {
    setDeleting(plan.id);
    try {
      const { error } = await supabase
        .from('planned_cardio')
        .delete()
        .eq('id', plan.id)
        .eq('created_by', user.email);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['plannedCardio', user?.email] });
      toast.success('Plan removed');
    } catch (err) {
      reportError(err, { feature: 'cardio.planned.delete' });
      toast.error('Failed to remove plan');
    } finally {
      setDeleting(null);
    }
  };

  const upcoming = plans.filter(p => !isPast(parseISO(p.planned_date)) || isToday(parseISO(p.planned_date)));
  const past = plans.filter(p => isPast(parseISO(p.planned_date)) && !isToday(parseISO(p.planned_date)));

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add Plan Button */}
      {!adding && (
        <Button
          className="w-full"
          variant="outline"
          onClick={() => setAdding(true)}
        >
          <Plus className="w-4 h-4 me-2" />
          Schedule a Session
        </Button>
      )}

      <AnimatePresence>
        {adding && (
          <PlanForm
            onSave={handleAdd}
            onCancel={() => setAdding(false)}
            distanceUnit={distanceUnit}
          />
        )}
      </AnimatePresence>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">Upcoming</p>
          {upcoming.map(plan => {
            const info = typeInfo(plan.type);
            const planDate = parseISO(plan.planned_date);
            const isDue = isToday(planDate);
            return (
              <Card key={plan.id} className={`overflow-hidden ${isDue ? 'border-primary/40 bg-primary/5' : ''}`}>
                <div className="flex items-center gap-3 p-3">
                  <div className={`w-9 h-9 rounded-xl bg-secondary flex items-center justify-center shrink-0`}>
                    <info.Icon className={`w-4.5 h-4.5 ${info.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{plan.title}</p>
                      {isDue && (
                        <span className="text-[10px] font-bold uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded-full shrink-0">
                          Today
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <CalendarDays className="w-3 h-3" />
                      <span>{format(planDate, 'EEE, MMM d')}</span>
                      {plan.distance_meters && (
                        <>
                          <span>·</span>
                          <span>{formatDistance(plan.distance_meters, distanceUnit, 2)}</span>
                        </>
                      )}
                    </div>
                    {plan.notes && (
                      <p className="text-xs text-muted-foreground/70 truncate mt-0.5 italic">{plan.notes}</p>
                    )}
                  </div>
                  <button
                    className="p-2 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    onClick={() => handleDelete(plan)}
                    disabled={deleting === plan.id}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Past (uncompleted) */}
      {past.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 px-1">Past Plans</p>
          {past.map(plan => {
            const info = typeInfo(plan.type);
            const isDone = !!plan.completed_cardio_id;
            return (
              <Card key={plan.id} className={`overflow-hidden opacity-70 ${isDone ? 'border-green-500/30' : ''}`}>
                <div className="flex items-center gap-3 p-3">
                  <div className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                    {isDone
                      ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                      : <info.Icon className={`w-4 h-4 ${info.color}`} />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{plan.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(parseISO(plan.planned_date), 'MMM d')}
                      {isDone ? ' · Completed' : ' · Not logged'}
                    </p>
                  </div>
                  <button
                    className="p-2 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    onClick={() => handleDelete(plan)}
                    disabled={deleting === plan.id}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {plans.length === 0 && !adding && (
        <Card className="p-8 border-dashed flex flex-col items-center gap-3 text-center">
          <Clock className="w-8 h-8 text-muted-foreground/40" />
          <p className="text-sm font-semibold text-muted-foreground">No planned sessions</p>
          <p className="text-xs text-muted-foreground/70 max-w-[200px]">
            Schedule your upcoming workouts to stay on track with your goals.
          </p>
        </Card>
      )}
    </div>
  );
}
