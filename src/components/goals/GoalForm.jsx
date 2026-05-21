import React, { useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import ExerciseAutocomplete from '@/components/regimens/ExerciseAutocomplete';
import MobileSelect from '@/components/MobileSelect';
import { getMaxRealisticWeight, getMaxRealisticReps } from '@/lib/realisticLimits';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { toLbs, fromLbs, formatWeight, formatWeightNumber } from '@/lib/weightUnit';
import { format, startOfMonth } from 'date-fns';
import { useMultiProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';

// Helper to calculate period start date
function getPeriodStartDate(period) {
  const today = new Date();
  if (period === 'week') {
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    return format(new Date(today.setDate(diff)), 'yyyy-MM-dd');
  } else if (period === 'month') {
    return format(startOfMonth(today), 'yyyy-MM-dd');
  }
  return null;
}

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
  const { t } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const { distanceUnit } = useDistanceUnit();

  const [goalType, setGoalType] = useState(initial?.goal_type || 'strength');
  
  // Strength fields
  const [exercise, setExercise] = useState(initial?.exercise_name || '');
  const [exerciseCanonical, setExerciseCanonical] = useState(initial?.exercise_canonical || initial?.exercise_name || '');
  const [targetWeightLbs, setTargetWeightLbs] = useState(initial?.target_weight || '');
  const [targetReps, setTargetReps] = useState(initial?.target_reps || '');
  
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

  const guard = useMultiProfanityGuard();

  const maxTargetWeightLbs = getMaxRealisticWeight(exercise, userProfile);
  const maxTargetReps = getMaxRealisticReps(exercise, 0, userProfile);
  const maxTargetWeightDisplay = fromLbs(maxTargetWeightLbs, weightUnit);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (hasAnyProfanity(exercise, exerciseCanonical, notes)) {
      toast.error('Please remove inappropriate language before saving.');
      return;
    }

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
        status: 'active',
        goal_type: 'strength',
        exercise_name: exercise.trim(),
        exercise_canonical: exerciseCanonical.trim() || exercise.trim(),
        target_weight: targetWeightLbs ? Math.min(parseFloat(targetWeightLbs), maxTargetWeightLbs) : null,
        target_reps: targetReps ? Math.min(parseInt(targetReps), maxTargetReps) : null,
        period: 'lifetime',
        period_start_date: null,
        notes,
      });
    } else if (goalType === 'cardio_distance') {
      if (!cardioDistanceInput || Number(cardioDistanceInput) <= 0) {
        toast.error(t('goals.targetRequired'));
        return;
      }
      onSubmit({
        status: 'active',
        goal_type: 'cardio_distance',
        cardio_activity: cardioActivity,
        target_distance_meters: toMeters(distanceUnit, cardioDistanceInput),
        period: cardioPeriod,
        period_start_date: getPeriodStartDate(cardioPeriod),
        notes,
      });
    } else if (goalType === 'cardio_duration') {
      const totalSec = toDurationSeconds(cardioDurationHours, cardioDurationMinutes, cardioDurationSeconds);
      if (totalSec <= 0) {
        toast.error(t('goals.targetRequired'));
        return;
      }
      onSubmit({
        status: 'active',
        goal_type: 'cardio_duration',
        cardio_activity: cardioActivity,
        target_duration_seconds: totalSec,
        period: cardioPeriod,
        period_start_date: getPeriodStartDate(cardioPeriod),
        notes,
      });
    } else if (goalType === 'cardio_sessions') {
      if (!cardioSessions || Number(cardioSessions) <= 0) {
        toast.error(t('goals.targetRequired'));
        return;
      }
      onSubmit({
        status: 'active',
        goal_type: 'cardio_sessions',
        cardio_activity: cardioActivity,
        target_sessions: Number(cardioSessions),
        period: cardioPeriod,
        period_start_date: getPeriodStartDate(cardioPeriod),
        notes,
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
              <label className="text-sm font-medium mb-1.5 block">{t('goals.targetWeight')}</label>
              <Input
                type="number"
                min={fromLbs(10, weightUnit)}
                max={maxTargetWeightDisplay}
                value={targetWeightLbs ? formatWeightNumber(parseFloat(targetWeightLbs), weightUnit) : ''}
                onChange={(e) => {
                  const displayVal = parseFloat(e.target.value) || 0;
                  const lbsVal = toLbs(Math.min(displayVal, maxTargetWeightDisplay), weightUnit);
                  setTargetWeightLbs(lbsVal > 0 ? lbsVal.toString() : '');
                }}
                placeholder={t('common.optional')}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">{t('goals.targetReps')}</label>
              <Input
                type="number"
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
                  min={0}
                  step={0.1}
                  value={cardioDistanceInput}
                  onChange={e => setCardioDistanceInput(e.target.value)}
                  placeholder="0.0"
                  inputMode="decimal"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
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
                      min={0}
                      max={max}
                      value={value}
                      onChange={e => set(e.target.value === '' ? '' : Math.min(max, Math.max(0, parseInt(e.target.value) || 0)))}
                      placeholder="0"
                      className="text-center"
                      inputMode="numeric"
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
                min={0}
                value={cardioSessions}
                onChange={e => setCardioSessions(e.target.value)}
                placeholder="0"
                inputMode="numeric"
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