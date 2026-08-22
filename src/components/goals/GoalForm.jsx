import React, { useState } from 'react';
import { format } from 'date-fns';
import { toast } from '@/lib/toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import ExerciseAutocomplete from '@/components/regimens/ExerciseAutocomplete';
import MobileSelect from '@/components/MobileSelect';
import { getMaxRealisticWeight, getMaxRealisticReps } from '@/lib/realisticLimits';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import UnitPill from '@/components/UnitPill';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { toLbs, fromLbs, formatWeight, formatWeightNumber } from '@/lib/weightUnit';
import { useMultiProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
// Was shared with CardioGoals, which created rows this form had to be
// able to read back. Its private copy of this mutated the Date it was
// measuring (`today.setDate(...)` after reading `today.getDate()`), which
// happened to be harmless only because nothing used `today` afterwards.
// That screen was removed on 2026-08-11 (0e7a2d6d) and its file deleted in
// the goals audit, so this form is now the only writer of goal rows.
import { periodStartDate as getPeriodStartDate } from '@/lib/goalProgress';

// Helper to convert distance to meters
function toMeters(unit, value) {
  const num = Number(value) || 0;
  return unit === 'mi' ? Math.round(num * 1609.344) : Math.round(num * 1000);
}

// Helper to convert duration to seconds
function toDurationSeconds(hours, minutes, seconds) {
  const h = Number(hours) || 0;
  const m = Number(minutes) || 0;
  const s = Number(seconds) || 0;
  return h * 3600 + m * 60 + s;
}

export default function GoalForm({ initial, onSubmit, onCancel, userProfile = {}, isSubmitting = false }) {
  const { t, tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const { distanceUnit } = useDistanceUnit();

  const [goalType, setGoalType] = useState(initial?.goal_type || 'strength');
  
  // Strength fields
  const [exercise, setExercise] = useState(initial?.exercise_name || '');
  const [exerciseCanonical, setExerciseCanonical] = useState(initial?.exercise_canonical || initial?.exercise_name || '');
  const [targetWeightLbs, setTargetWeightLbs] = useState(initial?.target_weight || '');
  const [targetReps, setTargetReps] = useState(initial?.target_reps || '');
  // Focused-draft state for the target-weight input. While focused we
  // hold the user's raw keystrokes; on blur we parse → convert to
  // canonical lbs → clamp. Reformatting every keystroke broke kg/stone
  // typing (e.g. "82" in kg round-tripped to "8.0"). (Audit task 7.)
  const [targetWeightFocused, setTargetWeightFocused] = useState(false);
  const [targetWeightDraft, setTargetWeightDraft] = useState('');
  
  // Cardio common fields
  const [cardioActivity, setCardioActivity] = useState(initial?.cardio_activity || 'running');
  const [cardioPeriod, setCardioPeriod] = useState(initial?.period || 'month');
  
  // Cardio distance
  const [cardioDistanceInput, setCardioDistanceInput] = useState('');
  
  // Cardio duration
  const [cardioDurationHours, setCardioDurationHours] = useState('');
  const [cardioDurationMinutes, setCardioDurationMinutes] = useState('');
  const [cardioDurationSeconds, setCardioDurationSeconds] = useState('');
  
  // Cardio sessions
  const [cardioSessions, setCardioSessions] = useState('');
  
  // Notes
  const [notes, setNotes] = useState(initial?.notes || '');

  // Target date. The `deadline` column has existed on `goals` since the table
  // was created and measured 0 of 5 rows populated — no form ever offered an
  // input for it, and `Goal.json` did not declare it, so `makeEntity().create`
  // would have stripped it even if something had tried. It is a plain
  // 'yyyy-MM-dd' local date, matching `period_start_date` beside it: a target
  // date is a day on the user's calendar, not an instant.
  const [deadline, setDeadline] = useState(initial?.deadline || '');

  // A new goal cannot be aimed at a date that has already passed. An EXISTING
  // one can already be overdue, and clamping `min` to today there would make
  // the browser reject the value the row is currently holding — so editing the
  // notes on a late goal would refuse to submit until you also changed the
  // date. The floor drops to whatever the goal already carries.
  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const minDeadline = initial?.deadline && initial.deadline < todayIso ? initial.deadline : todayIso;

  const guard = useMultiProfanityGuard();

  const maxTargetWeightLbs = getMaxRealisticWeight(exercise, userProfile);
  const maxTargetReps = getMaxRealisticReps(exercise, 0, userProfile);
  const maxTargetWeightDisplay = fromLbs(maxTargetWeightLbs, weightUnit);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (hasAnyProfanity(exercise, exerciseCanonical, notes)) {
      toast.error(tFallback('common.profanity.beforeSaving', 'Please remove inappropriate language before saving.'));
      return;
    }

    // Every branch below used to send a literal `status: 'active'`, which made
    // Edit a reopen button: editing a COMPLETED goal to fix a typo in its notes
    // silently flipped it back to active, moved it out of the Completed tab, and
    // left the XP already granted for it. With an Archived status added that
    // would have been a second way to un-archive by accident. An edit is not a
    // state transition — completing and archiving have their own controls.
    const nextStatus = initial?.status || 'active';

    if (goalType === 'strength') {
      if (!exercise.trim()) {
        toast.error(t('goals.exerciseRequired'));
        return;
      }
      if (!targetWeightLbs && !targetReps) {
        toast.error(t('goals.targetRequired'));
        return;
      }
      if (targetWeightLbs && parseFloat(targetWeightLbs) < 10) {
        toast.error(`${t('goals.targetWeight')} ${t('goals.minWeight', { val: formatWeight(10, weightUnit) })}`);
        return;
      }
      if (targetReps && parseInt(targetReps) < 5) {
        toast.error(t('goals.minReps'));
        return;
      }
      onSubmit({
        status: nextStatus,
        goal_type: 'strength',
        exercise_name: exercise.trim(),
        exercise_canonical: exerciseCanonical.trim() || exercise.trim(),
        target_weight: targetWeightLbs ? Math.min(parseFloat(targetWeightLbs), maxTargetWeightLbs) : null,
        target_reps: targetReps ? Math.min(parseInt(targetReps), maxTargetReps) : null,
        period: 'lifetime',
        period_start_date: null,
        notes,
        deadline: deadline || null,
      });
    } else if (goalType === 'cardio_distance') {
      const dist = Number(cardioDistanceInput);
      if (!cardioDistanceInput || !Number.isFinite(dist) || dist <= 0) {
        toast.error(t('goals.targetRequired'));
        return;
      }
      onSubmit({
        status: nextStatus,
        goal_type: 'cardio_distance',
        cardio_activity: cardioActivity,
        target_distance_meters: toMeters(distanceUnit, cardioDistanceInput),
        period: cardioPeriod,
        period_start_date: getPeriodStartDate(cardioPeriod),
        notes,
        deadline: deadline || null,
      });
    } else if (goalType === 'cardio_duration') {
      const totalSec = toDurationSeconds(cardioDurationHours, cardioDurationMinutes, cardioDurationSeconds);
      if (totalSec <= 0) {
        toast.error(t('goals.targetRequired'));
        return;
      }
      onSubmit({
        status: nextStatus,
        goal_type: 'cardio_duration',
        cardio_activity: cardioActivity,
        target_duration_seconds: totalSec,
        period: cardioPeriod,
        period_start_date: getPeriodStartDate(cardioPeriod),
        notes,
        deadline: deadline || null,
      });
    } else if (goalType === 'cardio_sessions') {
      const sess = Number(cardioSessions);
      if (!cardioSessions || !Number.isFinite(sess) || sess <= 0) {
        toast.error(t('goals.targetRequired'));
        return;
      }
      onSubmit({
        status: nextStatus,
        goal_type: 'cardio_sessions',
        cardio_activity: cardioActivity,
        target_sessions: Number(cardioSessions),
        period: cardioPeriod,
        period_start_date: getPeriodStartDate(cardioPeriod),
        notes,
        deadline: deadline || null,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Goal type selector */}
      <div>
        <label className="text-sm font-medium mb-1.5 block">{t('goals.goalType')}</label>
        <MobileSelect
          value={goalType}
          onValueChange={setGoalType}
          items={[
            { value: 'strength', label: t('goals.type.strength') },
            { value: 'cardio_distance', label: t('goals.type.cardio_distance') },
            { value: 'cardio_duration', label: t('goals.type.cardio_duration') },
            { value: 'cardio_sessions', label: t('goals.type.cardio_sessions') },
          ]}
        />
      </div>

      {/* Strength goals */}
      {goalType === 'strength' && (
        <>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('goals.exerciseName')}</label>
            <ExerciseAutocomplete
              value={exercise}
              onChange={(val) => guard.handleChange(val, setExercise)}
              onSelect={(ex) => { setExercise(ex.displayName || ex.name); setExerciseCanonical(ex.name); }}
              placeholder={t('goals.exerciseNamePlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium">{t('goals.targetWeight')}</label>
                {/* Inline unit swap — same component used in LogWeightModal.
                    One-tap lb ↔ kg without leaving the form. */}
                <UnitPill />
              </div>
              <Input
                type="number" inputMode="decimal"
                min={fromLbs(10, weightUnit)}
                max={maxTargetWeightDisplay}
                value={targetWeightFocused
                  ? targetWeightDraft
                  : (targetWeightLbs ? formatWeightNumber(parseFloat(targetWeightLbs), weightUnit) : '')}
                onFocus={() => {
                  setTargetWeightDraft(targetWeightLbs ? formatWeightNumber(parseFloat(targetWeightLbs), weightUnit) : '');
                  setTargetWeightFocused(true);
                }}
                onChange={(e) => setTargetWeightDraft(e.target.value)}
                onBlur={() => {
                  const displayVal = parseFloat(targetWeightDraft) || 0;
                  const lbsVal = toLbs(Math.min(displayVal, maxTargetWeightDisplay), weightUnit);
                  setTargetWeightLbs(lbsVal > 0 ? lbsVal.toString() : '');
                  setTargetWeightFocused(false);
                }}
                placeholder={t('common.optional')}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">{t('goals.targetReps')}</label>
              <Input
                type="number" inputMode="decimal"
                min="5"
                max={maxTargetReps}
                value={targetReps}
                onChange={(e) => setTargetReps(Math.min(parseInt(e.target.value) || 0, maxTargetReps).toString())}
                placeholder={t('common.optional')}
              />
            </div>
          </div>
        </>
      )}

      {/* Cardio goals — common fields */}
      {goalType.startsWith('cardio_') && (
        <>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('goals.activity')}</label>
            <MobileSelect
              value={cardioActivity}
              onValueChange={setCardioActivity}
              items={[
                { value: 'running', label: t('goals.activity.running') },
                { value: 'walking', label: t('goals.activity.walking') },
                { value: 'biking', label: t('goals.activity.biking') },
                { value: 'any', label: t('goals.activity.any') },
              ]}
            />
          </div>

          {goalType === 'cardio_distance' && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">{t('goals.cardio.targetDistance')}</label>
              <div className="relative">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.1}
                  value={cardioDistanceInput}
                  onChange={e => setCardioDistanceInput(e.target.value)}
                  placeholder="0.0"
                />
                <span className="absolute end-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {distanceUnit}
                </span>
              </div>
            </div>
          )}

          {goalType === 'cardio_duration' && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">{t('goals.cardio.targetDuration')}</label>
              <div className="flex gap-2">
                {[
                  { value: cardioDurationHours, set: setCardioDurationHours, label: t('workout.hours'), max: 23 },
                  { value: cardioDurationMinutes, set: setCardioDurationMinutes, label: t('workout.minutes'), max: 59 },
                  { value: cardioDurationSeconds, set: setCardioDurationSeconds, label: t('workout.seconds'), max: 59 },
                ].map(({ value, set, label, max }) => (
                  <div key={label} className="flex-1 text-center">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={max}
                      value={value}
                      onChange={e => set(e.target.value === '' ? '' : Math.min(max, Math.max(0, parseInt(e.target.value) || 0)))}
                      placeholder="0"
                      className="text-center"
                    />
                    <span className="text-xs text-muted-foreground mt-1 block">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {goalType === 'cardio_sessions' && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">{t('goals.cardio.targetSessions')}</label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={cardioSessions}
                onChange={e => setCardioSessions(e.target.value)}
                placeholder="0"
              />
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('goals.period')}</label>
            <MobileSelect
              value={cardioPeriod}
              onValueChange={setCardioPeriod}
              items={[
                { value: 'week', label: t('goals.period.week') },
                { value: 'month', label: t('goals.period.month') },
                { value: 'lifetime', label: t('goals.period.lifetime') },
              ]}
            />
          </div>
        </>
      )}

      <div>
        <label className="text-sm font-medium mb-1.5 block">
          {tFallback('goals.deadline.label', 'Target date')}
          <span className="text-muted-foreground font-normal ms-1">{t('common.optional')}</span>
        </label>
        <Input
          type="date"
          value={deadline}
          min={minDeadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
        <p className="text-xs text-muted-foreground mt-1.5">
          {tFallback('goals.deadline.hint', 'A date to aim for. Nothing expires. An overdue goal is flagged, never deleted.')}
        </p>
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">{t('goals.notes')}</label>
        <Textarea value={notes} onChange={(e) => guard.handleChange(e.target.value, setNotes)} placeholder={t('goals.notesPlaceholder')} className="h-20" />
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={isSubmitting}>{t('common.cancel')}</Button>
        <Button type="submit" className="flex-1" disabled={isSubmitting}>{initial ? t('goals.save') : t('goals.create')}</Button>
      </div>

      <ProfanityWarningDialog open={guard.open} onContinue={guard.onContinue} />
    </form>
  );
}