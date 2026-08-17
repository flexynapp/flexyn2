// src/components/cardio/CardioPlanned.jsx
//
// Planned cardio sessions — "I plan to run 5k on Thursday at 7am."
//
// Backed by `scheduled_workouts` (migration 276), the SAME table and RPC
// behind "Schedule it" on the AI Coach plan card. It used to have its own
// `planned_cardio` table, and the two schedulers were not equivalent:
//
//   planned_cardio        a date, and nothing else. No cron, no push, no
//                         deep link. `completed_cardio_id` was read to
//                         show "Completed" vs "Not logged" and written by
//                         nothing, so a past plan could only ever say
//                         "Not logged" — including one you did. 0 rows in
//                         production, ever.
//   scheduled_workouts    resolves the user's LOCAL hour against their
//                         timezone offset, fires an hourly cron, inserts
//                         a notification that pushes, and deep-links
//                         /workout?scheduled=<id> straight into the
//                         session. Real status lifecycle.
//
// So this screen now writes the one that works. That is why the form
// gained an HOUR: a plan with no time cannot be reminded about, which is
// most of what a plan is for.
//
// The row's `workout` JSONB carries { kind: 'cardio', mode, env, … } —
// see buildCardioPayload. `kind` is absent on lifting rows, so nothing
// written before this change reads differently.

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/lib/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Footprints, PersonStanding, Bike, Waves, Activity,
  Plus, Trash2, CheckCircle2, CalendarDays, Clock
} from 'lucide-react';
import { parseISO, isPast, isToday } from 'date-fns';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance, toMeters } from '@/lib/distanceUnit';
import { reportError } from '@/lib/reportError';
import { cardioTypeLabel } from '@/lib/cardioTypeLabel';
import { useDateFormatter } from '@/lib/intl';
import {
  scheduleWorkout, listCardioSchedules, cancelScheduledWorkout,
  buildCardioPayload, HOUR_SLOTS, formatHour, slotIsPast, localDateKey,
} from '@/lib/data/scheduledWorkouts';

const TYPE_OPTIONS = [
  { value: 'running_outside',   Icon: Footprints,     color: 'text-orange-500' },
  { value: 'running_treadmill', Icon: Footprints,     color: 'text-orange-500' },
  { value: 'walking_outside',   Icon: PersonStanding, color: 'text-green-500' },
  { value: 'biking_outside',    Icon: Bike,           color: 'text-blue-500' },
  { value: 'biking_stationary', Icon: Bike,           color: 'text-blue-500' },
  { value: 'swimming_pool',     Icon: Waves,          color: 'text-cyan-500' },
];

// A schedule's `<mode>_<env>` string, reassembled from the payload. Kept as
// a function rather than stored a second time on the row: mode and env are
// what the deep link routes on, and a denormalised `type` beside them is one
// more thing that can disagree with itself.
function planType(plan) {
  const w = plan?.workout || {};
  return w.mode && w.env ? `${w.mode}_${w.env}` : '';
}

// A past plan's outcome, in the user's words. `missed` is what the cron
// writes 12 hours after a slot goes by unstarted — the honest version of the
// old "Not logged", which was the ONLY thing a past plan could ever say
// because nothing wrote the column it read.
const STATUS_LABEL = {
  completed: 'Completed',
  cancelled: 'Cancelled',
  missed:    'Missed',
  notified:  'Reminded',
  pending:   'Scheduled',
};
// Resolved at the render site through `cardioPlanned.status.<slug>`.

function typeInfo(type) {
  return TYPE_OPTIONS.find(o => o.value === type) || { Icon: Activity, color: 'text-primary' };
}

function PlanForm({ onSave, onCancel, distanceUnit }) {
  const { tFallback } = useLanguage();
  const [title, setTitle] = useState('');
  const [type, setType] = useState('running_outside');
  const [date, setDate] = useState(localDateKey());
  const [hour, setHour] = useState(HOUR_SLOTS[0].hour);
  const [distance, setDistance] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // localDateKey(), not format(new Date()) via toISOString anywhere: the
  // schedule is a LOCAL date and a UTC one is yesterday for anyone west of
  // Greenwich after their evening.
  const today = localDateKey();

  const handleSave = async () => {
    if (!title.trim()) { toast.error(tFallback("cardioPlanned.giveThisPlanATitle", "Give this plan a title")); return; }
    // Reject past dates explicitly. The HTML `min={today}` attribute is
    // advisory only — a paste / direct-value set bypasses it and a
    // past-dated plan silently lands in the upcoming list as already-
    // expired, confusing the user. Wave 57 (Cardio audit) caught this.
    if (date && date < today) {
      toast.error(tFallback('cardioPlanned.dateInPast', 'That date is in the past. Pick today or later.'));
      return;
    }
    // A slot that has already gone by today is not a plan — the cron would
    // either fire it immediately or sweep it straight to 'missed'. This
    // check did not exist while a plan carried no time at all.
    if (slotIsPast(date, hour)) {
      toast.error(tFallback('cardioPlanned.timeInPast', 'That time has already passed today. Pick a later one.'));
      return;
    }
    // Defensive parse — a non-numeric string (e.g. paste from clipboard,
    // autocomplete) used to produce NaN * 1609.344 = NaN, which got
    // persisted and broke downstream display + filtering.
    let distanceMeters = null;
    if (distance !== '' && distance != null) {
      const n = Number(distance);
      if (Number.isFinite(n) && n > 0) distanceMeters = toMeters(distanceUnit, n);
    }
    const [mode, env] = String(type).split('_');
    setSaving(true);
    await onSave({
      title: title.trim(),
      date,
      hour,
      workout: buildCardioPayload({ mode, env, distanceMeters, notes }),
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
        <p className="text-sm font-semibold">{tFallback("cardioPlanned.newPlannedSession", "New Planned Session")}</p>

        {/* Title */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{tFallback("cardioPlanned.title", "Title")}</label>
          <Input
            placeholder={tFallback('cardioPlanned.titlePlaceholder', 'e.g. Morning 5k, Long ride…')}
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={80}
          />
        </div>

        {/* Type */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{tFallback("calendar.title", "Activity")}</label>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={type}
            onChange={e => setType(e.target.value)}
          >
            {TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{cardioTypeLabel(o.value, tFallback)}</option>
            ))}
          </select>
        </div>

        {/* Date */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{tFallback("cardio.field.date", "Date")}</label>
          <Input
            type="date"
            value={date}
            min={today}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        {/* Time — the four slots the Coach card offers, not a clock. The
            point is to commit to a slot, not to a minute, and a plan with
            no time is a plan nothing can remind you about. */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{tFallback("cardio.detail.time", "Time")}</label>
          <div className="flex gap-2">
            {HOUR_SLOTS.map(slot => {
              const past = slotIsPast(date, slot.hour);
              return (
                <button
                  key={slot.id}
                  type="button"
                  disabled={past}
                  onClick={() => setHour(slot.hour)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    hour === slot.hour
                      ? 'bg-primary text-primary-foreground border-primary'
                      : past
                        ? 'border-border/40 text-muted-foreground/40'
                        : 'border-border text-muted-foreground'
                  }`}
                >
                  {tFallback(slot.labelKey, slot.label)}
                </button>
              );
            })}
          </div>
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
          placeholder={tFallback('cardio.planned.notesPlaceholder', 'Notes… (optional)')}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          maxLength={200}
        />

        <div className="flex gap-2">
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Add Plan'}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={saving}>{tFallback("coach.plan.cancel", "Cancel")}</Button>
        </div>
      </Card>
    </motion.div>
  );
}

export default function CardioPlanned() {
  const { language, tFallback } = useLanguage();
  // date-fns binds no locale, so `format(d, 'MMM d')` renders English month
  // names under a fully translated screen. Intl is already language-bound.
  const fmtDate = useDateFormatter();
  const { user } = useAuth();
  const { distanceUnit } = useDistanceUnit();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);

  // No `.eq('created_by', …)` filter: scheduled_workouts is gated by RLS on
  // `user_id = auth.uid()`, so the query cannot see anyone else's rows and a
  // client-side owner filter would be decoration over the real boundary.
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['cardioSchedules', user?.email],
    queryFn: () => listCardioSchedules(),
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  const handleAdd = async (payload) => {
    try {
      await scheduleWorkout(payload);
      queryClient.invalidateQueries({ queryKey: ['cardioSchedules', user?.email] });
      toast.success(tFallback('cardioPlanned.scheduled', 'Scheduled, we’ll remind you.'));
      setAdding(false);
    } catch (err) {
      reportError(err, { feature: 'cardio.planned.add' });
      toast.error(tFallback("cardioPlanned.failedToSchedule", "Failed to schedule"));
    }
  };

  // Cancel, not delete. Migration 276 keeps cancelled rows deliberately so a
  // user who cancels and re-schedules cannot silently blow past the RPC's
  // 100-pending ceiling, and there is no DELETE on the client path here.
  const handleDelete = async (plan) => {
    setDeleting(plan.id);
    try {
      const ok = await cancelScheduledWorkout(plan.id);
      if (!ok) throw new Error('cancel failed');
      queryClient.invalidateQueries({ queryKey: ['cardioSchedules', user?.email] });
      toast.success(tFallback("cardioPlanned.planCancelled", "Plan cancelled"));
    } catch (err) {
      reportError(err, { feature: 'cardio.planned.cancel' });
      toast.error(tFallback("cardioPlanned.failedToCancelPlan", "Failed to cancel plan"));
    } finally {
      setDeleting(null);
    }
  };

  // Upcoming is what is still live — a cancelled plan is not upcoming even if
  // its date is tomorrow, and a fired-but-unstarted one still is.
  const isLive = (p) => p.status === 'pending' || p.status === 'notified';
  const dayOf = (p) => parseISO(p.scheduled_date);
  const upcoming = plans.filter(p => isLive(p) && (!isPast(dayOf(p)) || isToday(dayOf(p))));
  const past = plans.filter(p => !upcoming.includes(p));

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
          {tFallback("cardioPlanned.scheduleASession", "Schedule a Session")}
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
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">{tFallback("cardioPlanned.upcoming", "Upcoming")}</p>
          {upcoming.map(plan => {
            const info = typeInfo(planType(plan));
            const planDate = parseISO(plan.scheduled_date);
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
                        <span className="text-micro font-bold uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded-full shrink-0">
                          {tFallback("coach.schedule.today", "Today")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <CalendarDays className="w-3 h-3" />
                      <span>{fmtDate(planDate, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                      <span>·</span>
                      {/* The time is the whole reason this can remind you,
                          so it sits beside the date rather than hidden. */}
                      <span>{formatHour(plan.scheduled_hour, language)}</span>
                      {plan.workout?.distance_meters && (
                        <>
                          <span>·</span>
                          <span>{formatDistance(plan.workout.distance_meters, distanceUnit, 2)}</span>
                        </>
                      )}
                    </div>
                    {plan.workout?.notes && (
                      <p className="text-xs text-muted-foreground/70 truncate mt-0.5 italic">{plan.workout.notes}</p>
                    )}
                  </div>
                  <button
                    className="p-2 text-muted-foreground hover:text-destructive active:text-destructive transition-colors shrink-0"
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
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 px-1">{tFallback("cardioPlanned.pastPlans", "Past Plans")}</p>
          {past.map(plan => {
            const info = typeInfo(planType(plan));
            const isDone = plan.status === 'completed';
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
                      {fmtDate(parseISO(plan.scheduled_date), { month: 'short', day: 'numeric' })}
                      {' · '}
                      {plan.status
                        ? tFallback(`cardioPlanned.status.${plan.status}`, STATUS_LABEL[plan.status] || plan.status)
                        : plan.status}
                    </p>
                  </div>
                  <button
                    className="p-2 text-muted-foreground hover:text-destructive active:text-destructive transition-colors shrink-0"
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
          <p className="text-sm font-semibold text-muted-foreground">{tFallback("cardioPlanned.noPlannedSessions", "No planned sessions")}</p>
          <p className="text-xs text-muted-foreground/70 max-w-[200px]">
            {tFallback('cardioPlanned.emptyBody', 'Schedule your upcoming workouts to stay on track with your goals.')}
          </p>
        </Card>
      )}
    </div>
  );
}
