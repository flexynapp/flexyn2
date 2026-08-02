// src/components/coach/CoachPlanCard.jsx
//
// Interactive plan attached to an AI Coach reply. Renders the sectioned
// Cardio/Strength view and lets the user act on it without leaving the chat:
//   • Save as regimen  — persists it to their Regimens (both shapes)
//   • Start workout    — (single session only) hands off to the Workout page
//
// Feedback is INLINE (a subtle "Saved ✓" state), not a toast — toasts are
// suppressed app-wide except errors.
//
// ── Why the session is editable here ────────────────────────────────────────
//
// A generated workout is usually 90% right and 10% wrong in a way the user can
// see instantly — a movement their shoulder won't take today, one lift too
// many, a plank they have no interest in. The only options used to be accept
// it wholesale or re-type the goal and hope the reroll went better, which
// makes the coach something you submit to rather than something you work with.
// Swap / drop / set-count cover the great majority of "nearly" without a round
// trip through the model.
//
// The card owns no domain knowledge: swap candidates are precomputed by
// generateWorkout (which has the catalog, the equipment and injury filters,
// the user's history and their demographics) and re-deriving the plan's three
// representations is planBuilder's `withEditedWorkout`. This file only decides
// which option is showing.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Play, Save, Check, Loader2, Flame, ChevronRight,
  Pencil, RefreshCw, X, Minus, Plus, CalendarClock, Info, ChevronDown,
} from 'lucide-react';
import StarterPlanView from '@/components/workout/StarterPlanView';
import { withEditedWorkout, evidenceForExercises } from '@/lib/aiCoach/planBuilder';
import {
  scheduleWorkout, daySlots, HOUR_SLOTS, formatHour, slotIsPast,
} from '@/lib/data/scheduledWorkouts';
import { reportError } from '@/lib/reportError';
import { toast } from '@/lib/toast';

// Matches generateWorkout's own clamp, so an edited session can't be handed to
// the logger in a shape the generator would never have produced.
const MIN_SETS = 1;
const MAX_SETS = 5;

export default function CoachPlanCard({ plan, onSaveRegimen, onStartWorkout, onPlanChange }) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [scheduledFor, setScheduledFor] = useState(null);
  const [schedulerError, setSchedulerError] = useState(null);
  // Only used when no `onPlanChange` is supplied — then the card keeps its own
  // copy so edits still work, they just don't outlive the component.
  const [fallbackPlan, setFallbackPlan] = useState(null);

  const activePlan = fallbackPlan ?? plan;

  if (!activePlan) return null;
  const isSession = activePlan.kind === 'session';
  // Cardio sessions have no strength-logger handoff (plan.workout is null) —
  // they're logged via the Cardio tracker, so only "Save as regimen" applies.
  const startable = isSession && !!activePlan.workout && !!onStartWorkout;
  const editable = isSession && !!activePlan.workout?.exercises?.length;

  const applyEdit = (exercises) => {
    const next = withEditedWorkout(activePlan, { ...activePlan.workout, exercises });
    // An edit invalidates a previous save — the regimen on file is the old
    // session, so offering "Saved to Regimens" would be a lie about this one.
    setSaved(false);
    if (onPlanChange) onPlanChange(next);
    else setFallbackPlan(next);
  };

  const exercises = activePlan.workout?.exercises || [];

  // Rotate to the next candidate, pushing the outgoing exercise onto the back
  // of the list. Cycling all the way round therefore returns the original —
  // there is no separate undo to discover, and no way to strand yourself on a
  // movement you didn't want.
  const handleSwap = (i) => {
    const current = exercises[i];
    const [next, ...rest] = current.alternatives || [];
    if (!next) return;
    const copy = exercises.slice();
    copy[i] = { ...next, alternatives: [...rest, { ...current, alternatives: [] }] };
    applyEdit(copy);
  };

  // The last exercise can't be dropped: an empty session is not a thing to
  // start or save, and the button that produced it would have to disable
  // itself, which reads as a bug.
  const handleRemove = (i) => {
    if (exercises.length <= 1) return;
    applyEdit(exercises.filter((_, idx) => idx !== i));
  };

  const handleSets = (i, delta) => {
    const current = exercises[i];
    const count = Math.max(MIN_SETS, Math.min(MAX_SETS, (current.sets?.length || 3) + delta));
    if (count === current.sets?.length) return;
    // Every working set of a generated exercise carries the same prescription,
    // so a new one is a copy of the first rather than an invented weight.
    const proto = current.sets?.[0] || { weight: 0, reps: 10 };
    const copy = exercises.slice();
    copy[i] = { ...current, sets: Array.from({ length: count }, () => ({ ...proto })) };
    applyEdit(copy);
  };

  // A session is schedulable; a weekly plan is not. A plan already IS a
  // schedule — pinning "your 4-day week" to Thursday at 7am would be asking
  // the user to commit to something the plan doesn't describe.
  const schedulable = isSession && !!activePlan.workout?.exercises?.length;

  const handleSchedule = async (date, hour) => {
    setScheduling(true);
    setSchedulerError(null);
    try {
      await scheduleWorkout({
        date,
        hour,
        title: activePlan.title,
        workout: activePlan.workout,
      });
      setScheduledFor(`${scheduleDayLabel(date)}, ${formatHour(hour)}`);
      setSchedulerOpen(false);
    } catch (err) {
      // Inline rather than a toast: the user is looking at this card, and the
      // recovery — pick a different slot — is right here.
      setSchedulerError(err?.message || "Couldn't schedule that — try again.");
      reportError(err, { feature: 'coach.schedule' });
    } finally {
      setScheduling(false);
    }
  };

  const handleSave = async () => {
    if (saved || saving || !onSaveRegimen) return;
    setSaving(true);
    try {
      await onSaveRegimen(activePlan.regimenPayload);
      setSaved(true);
    } catch (err) {
      toast.error(`Couldn't save — ${err?.message || 'try again'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-3 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/5 via-fuchsia-500/5 to-violet-500/10 p-3"
    >
      <div className="mb-2.5 px-0.5 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-heading font-bold text-[15px] leading-tight">{activePlan.title}</p>
          {activePlan.subtitle && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{activePlan.subtitle}</p>
          )}
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            aria-pressed={editing}
            aria-label={editing ? 'Finish editing workout' : 'Edit workout'}
            className={[
              'shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
              editing
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/70 text-muted-foreground hover:text-foreground hover:bg-secondary',
            ].join(' ')}
          >
            {editing ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      {editing ? (
        <ExerciseEditor
          exercises={exercises}
          onSwap={handleSwap}
          onRemove={handleRemove}
          onSets={handleSets}
        />
      ) : (
        <StarterPlanView
          regimen={{ exercises: activePlan.exercises }}
          cardioDefaultOpen
          strengthDefaultOpen={isSession}
        />
      )}

      {/* Why this session was adjusted. An automatic change to someone's
          training — a set removed for a deficit, a lighter bar for a reported
          rough day — has to be legible, or the app just looks broken. */}
      {Array.isArray(activePlan.coachNotes) && activePlan.coachNotes.length > 0 && (
        <ul className="mt-2.5 space-y-1.5 rounded-xl border border-border bg-secondary/40 px-3 py-2.5">
          {activePlan.coachNotes.map((note, i) => (
            <li key={i} className="flex gap-2 text-[11px] text-muted-foreground leading-snug">
              <span aria-hidden="true" className="text-primary shrink-0">•</span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Training-load → nutrition: what this plan costs to fuel. Deep-links to
          the Nutrition Plans section to tune the diet plan around it. */}
      {activePlan.fuel && activePlan.fuel.runDays > 0 && (
        <button
          type="button"
          onClick={() => navigate('/nutrition?plans=1')}
          className="mt-2.5 w-full flex items-center gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-start transition-colors hover:bg-amber-500/10"
        >
          <span className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Flame className="w-4 h-4" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold leading-tight">Fuel your training</span>
            <span className="block text-[11px] text-muted-foreground mt-0.5">
              ~+{activePlan.fuel.perRunDayKcal} kcal · +{activePlan.fuel.addCarbsG}g carbs on run days
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      )}

      {activePlan.evidence && (
        <EvidencePanel evidence={activePlan.evidence} exercises={exercises} />
      )}

      {schedulerOpen && (
        <SchedulePicker
          scheduling={scheduling}
          onCancel={() => setSchedulerOpen(false)}
          onConfirm={handleSchedule}
        />
      )}

      <div className="mt-3 flex gap-2">
        {startable && (
          <button
            type="button"
            onClick={() => onStartWorkout(activePlan.workout)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm py-2.5 transition-opacity active:opacity-80"
          >
            <Play className="w-4 h-4" />
            Start workout
          </button>
        )}
        {/* Schedule outranks Save on a session, and that ordering is the whole
            point of the feature: saving produces an artefact you have to
            remember to come back to, scheduling produces a time. */}
        {schedulable && (
          <button
            type="button"
            onClick={() => { setSchedulerOpen((o) => !o); setSchedulerError(null); }}
            aria-expanded={schedulerOpen}
            disabled={scheduling}
            className={[
              'flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold text-sm py-2.5 transition-colors',
              scheduledFor
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-secondary text-foreground hover:bg-secondary/80 disabled:opacity-60',
            ].join(' ')}
          >
            {scheduling ? <Loader2 className="w-4 h-4 animate-spin" />
              : scheduledFor ? <Check className="w-4 h-4" />
              : <CalendarClock className="w-4 h-4" />}
            {scheduledFor || 'Schedule it'}
          </button>
        )}
      </div>

      {schedulerError && (
        <p className="mt-2 text-[11px] text-destructive px-0.5">{schedulerError}</p>
      )}

      {/* Save stays reachable but stops competing for the primary slot: a
          regimen is a template you repeat, which is a different intent from
          "I am doing this on Thursday". */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || saved}
        className={[
          'mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-xl text-[12px] font-semibold py-2 transition-colors',
          saved
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-muted-foreground hover:text-foreground disabled:opacity-60',
        ].join(' ')}
      >
        {saving ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : saved ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Save className="w-3.5 h-3.5" />
        )}
        {saved ? 'Saved to Regimens' : 'Save as regimen'}
      </button>
    </motion.div>
  );
}

// ── "What this is based on" ─────────────────────────────────────────────────
//
// The coach's own tagline is "Personalized advice from your data", and until
// now it never showed which data. Dietvorst et al. (2015) documented algorithm
// aversion: people abandon an algorithm permanently after seeing it err once,
// far faster than they'd abandon a human making the same mistake. The
// mitigation is transparency plus correctability — a suggested weight the user
// can trace to a stale log reads as bad input they can fix; the same number
// unexplained reads as a coach that doesn't know what it's doing.
//
// Collapsed by default. Someone who trusts the session should never have to
// read this, and expanding it is the action of someone already suspicious —
// which is precisely when the answer needs to be available.
function EvidencePanel({ evidence, exercises }) {
  const [open, setOpen] = useState(false);
  const { seededFromHistory, estimatedCount, bodyweightCount } = evidenceForExercises(exercises);

  // One line that is true at a glance, so the collapsed state still says
  // something rather than just advertising a disclosure.
  const summary = evidence.logsRead > 0
    ? `${evidence.logsRead} logged session${evidence.logsRead === 1 ? '' : 's'}`
      + (seededFromHistory.length ? ` · ${seededFromHistory.length} lift${seededFromHistory.length === 1 ? '' : 's'} from your history` : '')
    : 'No logged sessions yet — weights are estimates';

  return (
    <div className="mt-2.5 rounded-xl border border-border bg-secondary/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 text-start"
      >
        <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] font-semibold leading-tight">What this is based on</span>
          <span className="block text-[10px] text-muted-foreground mt-0.5 truncate">{summary}</span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-3 pb-2.5 space-y-2 text-[11px] leading-snug">
          <Fact label="Your training log">
            {evidence.logsRead > 0
              ? `${evidence.logsRead} session${evidence.logsRead === 1 ? '' : 's'} in the last ${evidence.historyWindowDays} days`
                + (evidence.latestLogDate ? `, most recent ${evidence.latestLogDate}` : '')
              : `Nothing logged in the last ${evidence.historyWindowDays} days`}
          </Fact>

          {/* The checkable part. Naming the lift and the actual set means the
              user can verify the claim against their own log instead of
              taking "personalized" on faith. */}
          {seededFromHistory.length > 0 && (
            <Fact label="Weights from your own sets">
              {seededFromHistory.map((s) => `${s.name} ${s.weight} lb × ${s.reps}`).join(' · ')}
            </Fact>
          )}

          {estimatedCount > 0 && (
            <Fact label="Estimated">
              {estimatedCount} lift{estimatedCount === 1 ? '' : 's'} you haven't logged — sized from your
              bodyweight ({evidence.bodyweightLbs} lb), experience ({evidence.skillLevel})
              {evidence.demographics?.age ? ` and age (${evidence.demographics.age})` : ''}.
              Adjust on your first set and the next session uses your real number.
            </Fact>
          )}

          {bodyweightCount > 0 && (
            <Fact label="Bodyweight">{bodyweightCount} movement{bodyweightCount === 1 ? '' : 's'} with no external load</Fact>
          )}

          <Fact label="Settings used">
            {[evidence.equipment, `${evidence.skillLevel} level`].filter(Boolean).join(' · ')}
          </Fact>

          {evidence.excludedGroups?.length > 0 && (
            <Fact label="Excluded for injury">{evidence.excludedGroups.join(', ')}</Fact>
          )}
        </div>
      )}
    </div>
  );
}

function Fact({ label, children }) {
  return (
    <p className="text-muted-foreground">
      <span className="font-semibold text-foreground">{label}:</span> {children}
    </p>
  );
}

/** The chosen day, read back the way it was offered ("Today", "Thu"). */
function scheduleDayLabel(dateKey) {
  return daySlots().find((d) => d.date === dateKey)?.label || dateKey;
}

// Day and hour as two rows of chips rather than a datetime input.
//
// The research this implements is about naming a slot, not a minute:
// specifying WHEN and WHERE a behaviour will happen is what roughly doubles
// follow-through, and "Thursday morning" satisfies that as well as "Thursday
// 07:14" does. A native datetime picker on mobile also costs several taps and
// a modal, which is a lot of friction to charge for a commitment the user is
// only weakly committed to at this point.
function SchedulePicker({ scheduling, onCancel, onConfirm }) {
  const days = daySlots();
  const [day, setDay] = useState(days[1].date);   // Tomorrow — the safest default
  const [hour, setHour] = useState(HOUR_SLOTS[0].hour);

  // A slot that has already passed today would fire its reminder immediately
  // or get swept up as 'missed'. Offer it disabled rather than hiding it, so
  // the row doesn't reflow as the day goes on.
  const past = (h) => slotIsPast(day, h);
  const chosenIsPast = past(hour);

  return (
    <div className="mt-2.5 rounded-xl border border-primary/25 bg-card p-3">
      <p className="text-[11px] font-semibold text-muted-foreground mb-2">When are you doing this?</p>

      <div className="flex gap-1.5 mb-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((d) => (
          <Chip key={d.id} active={day === d.date} onClick={() => setDay(d.date)} label={d.label} />
        ))}
      </div>

      <div className="flex gap-1.5 mb-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {HOUR_SLOTS.map((s) => (
          <Chip
            key={s.id}
            active={hour === s.hour}
            disabled={past(s.hour)}
            onClick={() => setHour(s.hour)}
            label={`${s.label} · ${formatHour(s.hour)}`}
          />
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-2 text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(day, hour)}
          disabled={scheduling || chosenIsPast}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold py-2 transition-opacity active:opacity-80 disabled:opacity-50"
        >
          {scheduling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
          {chosenIsPast ? 'That time has passed' : `Remind me ${scheduleDayLabel(day).toLowerCase()} at ${formatHour(hour)}`}
        </button>
      </div>
    </div>
  );
}

function Chip({ active, disabled, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={[
        'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-semibold border transition-colors disabled:opacity-35',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-secondary/60 text-foreground border-border/50 hover:bg-secondary',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

// The edit surface. Deliberately a flat list rather than the collapsible
// StarterPlanView sections used for reading: while editing, everything you
// might want to change has to be visible and one tap away, and a section that
// can be collapsed can hide the exercise you came here to remove.
function ExerciseEditor({ exercises, onSwap, onRemove, onSets }) {
  return (
    <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
      {exercises.map((ex, i) => {
        const sets = ex.sets?.length || 0;
        const reps = ex.sets?.[0]?.reps;
        const weight = ex.sets?.[0]?.weight;
        const canSwap = (ex.alternatives?.length || 0) > 0;
        return (
          <div key={`${ex.name}-${i}`} className="flex items-center gap-2 px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold leading-tight truncate">{ex.name}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                {sets} × {reps ?? '—'}
                {weight > 0 ? ` @ ${weight} lb` : ' · bodyweight'}
                {ex.group ? ` · ${ex.group}` : ''}
              </p>
            </div>

            {/* Set count. Stepper rather than a field: the useful range is
                1–5 and a numeric keypad on a phone costs more taps than the
                whole edit is worth. */}
            <div className="flex items-center shrink-0 rounded-lg bg-secondary/60">
              <button
                type="button"
                onClick={() => onSets(i, -1)}
                disabled={sets <= MIN_SETS}
                aria-label={`One less set of ${ex.name}`}
                className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-bold tabular-nums w-3 text-center" aria-hidden="true">
                {sets}
              </span>
              <button
                type="button"
                onClick={() => onSets(i, 1)}
                disabled={sets >= MAX_SETS}
                aria-label={`One more set of ${ex.name}`}
                className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => onSwap(i)}
              disabled={!canSwap}
              // Named rather than "Swap" alone: with several rows on screen a
              // screen-reader user otherwise gets a column of identical buttons.
              aria-label={`Swap ${ex.name} for another ${ex.group || 'exercise'}`}
              title={canSwap ? `Swap for another ${ex.group || 'exercise'}` : 'No alternative available'}
              className="shrink-0 p-1.5 rounded-lg bg-secondary/60 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => onRemove(i)}
              disabled={exercises.length <= 1}
              aria-label={`Remove ${ex.name}`}
              className="shrink-0 p-1.5 rounded-lg bg-secondary/60 text-muted-foreground hover:text-destructive disabled:opacity-30 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
