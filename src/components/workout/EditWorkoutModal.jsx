import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { getMaxRealisticWeight, getMaxRealisticReps, getMaxRealisticDuration } from '@/lib/realisticLimits';
import { detectImplausibleWorkout, getMaxSetsPerExercise, getMuscleGroupCap } from '@/lib/workoutFatigue';
import { useProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { toLbs, formatWeightNumber } from '@/lib/weightUnit';
import { getExerciseDisplay } from '@/lib/exerciseTranslations';

function SetEditor({ sets, onChange, exerciseName = '', userProfile = {} }) {
  const { t } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const updateSet = (i, field, val) => {
    const updated = [...sets];
    updated[i] = { ...updated[i], [field]: val };
    onChange(updated);
  };
  const maxSetsPerExercise = getMaxSetsPerExercise(userProfile);
  const atSetLimit = sets.length >= maxSetsPerExercise;
  const addSet = () => {
    if (atSetLimit) return;
    const last = sets[sets.length - 1] || { weight: null, reps: null };
    onChange([...sets, { weight: last.weight, reps: last.reps }]);
  };
  const removeSet = (i) => onChange(sets.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {sets.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-5 text-center">{i + 1}</span>
          <Input
            type="number" min="0" step="0.5"
            inputMode="decimal"
            value={s.weight != null ? formatWeightNumber(s.weight, weightUnit) : ''}
            onChange={e => {
              const raw = e.target.value;
              if (raw === '') {
                updateSet(i, 'weight', null);
              } else {
                const displayVal = parseFloat(raw);
                if (isNaN(displayVal)) { updateSet(i, 'weight', null); return; }
                const lbsVal = toLbs(displayVal, weightUnit);
                updateSet(i, 'weight', Math.min(getMaxRealisticWeight(exerciseName, userProfile), Math.max(0, lbsVal)));
              }
            }}
            onKeyDown={e => { if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault(); }}
            placeholder={weightUnit}
            className="h-8 text-center text-sm"
          />
          <span className="text-muted-foreground text-xs">×</span>
          <Input
            type="number" min="0"
            inputMode="numeric"
            value={s.reps ?? ''}
            onChange={e => {
              const raw = e.target.value;
              if (raw === '') {
                updateSet(i, 'reps', null);
              } else {
                const val = parseInt(raw);
                updateSet(i, 'reps', isNaN(val) ? null : Math.min(getMaxRealisticReps(exerciseName, s.weight || 0, userProfile), Math.max(0, val)));
              }
            }}
            placeholder={t('common.reps')}
            className="h-8 text-center text-sm"
          />
          <button type="button" onClick={() => removeSet(i)} className="p-1 text-muted-foreground hover:text-destructive">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full mt-1"
        onClick={addSet}
        disabled={atSetLimit}
        title={atSetLimit ? t('workout.maxSetsTitle').replace('{count}', maxSetsPerExercise) : undefined}
      >
        <Plus className="w-3 h-3 mr-1" />
        {atSetLimit
          ? t('workout.maxSetsReachedLabel').replace('{count}', maxSetsPerExercise)
          : t('workout.addSet')}
      </Button>
    </div>
  );
}

export default function EditWorkoutModal({ log, userProfile = {}, logs = [], cardioLogs = [], open, onClose, onSave, onDelete }) {
  const { t, language } = useLanguage();
  const [exercises, setExercises] = useState(log?.exercises || []);
  const [date, setDate] = useState(log?.date || '');
  const [duration, setDuration] = useState(log?.duration_minutes || '');
  const [notes, setNotes] = useState(log?.notes || '');
  const notesGuard = useProfanityGuard(setNotes);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cheatWarningData, setCheatWarningData] = useState(null);
  const [implausibleWarning, setImplausibleWarning] = useState(null);

  const updateExerciseSets = (i, sets) => {
    const updated = [...exercises];
    updated[i] = { ...updated[i], sets };
    setExercises(updated);
  };

  const handleSave = async (forceSkipChecks = false) => {
    if (hasAnyProfanity(notes)) {
      toast.error('Please remove inappropriate language from notes before saving.');
      return;
    }

    const normalizedExercises = exercises.map(ex => ({
      ...ex,
      sets: (ex.sets || []).map(s => ({
        weight: Number(s.weight) || 0,
        reps: Number(s.reps) || 0,
      })),
      duration_minutes: ex.duration_minutes != null ? (Number(ex.duration_minutes) || null) : null,
    }));

    if (!forceSkipChecks) {
      // Layer 1: hard-stop on unrealistic weights (same as saveWorkout)
      const flaggedSets = [];
      normalizedExercises.forEach((ex, exIndex) => {
        const maxWeight = getMaxRealisticWeight(ex.name, userProfile);
        ex.sets.forEach((s, setIndex) => {
          if (s.weight > maxWeight) flaggedSets.push({ exIndex, setIndex, exName: ex.name });
        });
      });
      if (flaggedSets.length > 0) {
        setCheatWarningData({ flaggedSets });
        return;
      }

      // Layer 2: per-exercise set-count cap
      const maxSetsPerEx = getMaxSetsPerExercise(userProfile);
      for (const ex of normalizedExercises) {
        if ((ex.sets?.length || 0) > maxSetsPerEx) {
          setImplausibleWarning(
            t('workout.warn.perExSetLimit')
              .replace('{exercise}', ex.name)
              .replace('{setCount}', ex.sets.length)
              .replace('{maxSets}', maxSetsPerEx)
          );
          return;
        }
      }

      // Layer 3: fatigue / implausibility check
      const otherLogs = (logs || []).filter(l => l.id !== log?.id);
      const fatigueCheck = detectImplausibleWorkout(
        { date, exercises: normalizedExercises },
        userProfile,
        otherLogs,
        (cardioLogs || []).filter(l => l.id !== log?.id),
        language,
      );
      if (fatigueCheck.implausible) {
        let msg = t(fatigueCheck.i18nKey);
        if (fatigueCheck.i18nParams) {
          Object.entries(fatigueCheck.i18nParams).forEach(([key, val]) => {
            msg = msg.replace(`{${key}}`, val);
          });
        }
        setImplausibleWarning(msg);
        return;
      }
    }

    // Clamp reps/duration (weight is already blocked above, not silently clamped)
    const validatedExercises = normalizedExercises.map(ex => ({
      ...ex,
      sets: ex.sets.map(s => {
        const clampedReps = Math.min(s.reps, getMaxRealisticReps(ex.name, s.weight, userProfile));
        return { weight: s.weight, reps: clampedReps };
      }),
      duration_minutes: ex.duration_minutes != null
        ? Math.min(ex.duration_minutes, getMaxRealisticDuration())
        : null,
    }));

    const cap = getMaxSetsPerExercise(userProfile);
    const trimmedExercises = validatedExercises.map(ex => ({
      ...ex,
      sets: (ex.sets || []).slice(0, cap),
    }));

    // Per-muscle-group clamp: XP cannot reward beyond realistic per-group cap
    // even if the warning was dismissed.
    let finalExercises;
    {
      const groupRunningTotals = {};
      finalExercises = trimmedExercises.map(ex => {
        const groups = ex.muscle_groups?.length
          ? ex.muscle_groups
          : (ex.muscle_group ? [ex.muscle_group] : []);
        if (groups.length === 0) return ex;
        let allowed = ex.sets?.length || 0;
        for (const g of groups) {
          const groupCap = getMuscleGroupCap(g, userProfile);
          const used = groupRunningTotals[g] || 0;
          const headroom = Math.max(0, groupCap - used);
          allowed = Math.min(allowed, headroom);
        }
        for (const g of groups) {
          groupRunningTotals[g] = (groupRunningTotals[g] || 0) + allowed;
        }
        return { ...ex, sets: (ex.sets || []).slice(0, allowed) };
      });
    }

    setSaving(true);
    await onSave(log.id, { exercises: finalExercises, date, duration_minutes: duration ? parseInt(duration) : null, notes });
    setSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    setSaving(true);
    await onDelete(log.id);
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{log?.regimen_name || t('workout.freestyle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('workout.date')}</label>
              <Input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('workout.duration')}</label>
              <Input type="number" inputMode="decimal" min="0" value={duration} onChange={e => setDuration(e.target.value)} placeholder={t('common.optional')} />
            </div>
          </div>

          {exercises.map((ex, i) => (
            <Card key={i} className="p-3 border-none shadow-sm">
              <p className="text-sm font-medium mb-2">{getExerciseDisplay(ex, language)}</p>
              <SetEditor sets={ex.sets || []} onChange={sets => updateExerciseSets(i, sets)} exerciseName={ex.name} userProfile={userProfile} />
            </Card>
          ))}

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('workout.notes')}</label>
            <Input value={notes} onChange={e => notesGuard.handleChange(e.target.value)} placeholder={t('common.optional')} />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          {confirmDelete ? (
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={saving} className="flex-1">
                {t('common.confirmDelete')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)} className="flex-1">{t('common.cancel')}</Button>
            </div>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive sm:mr-auto" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="w-4 h-4 mr-1" /> {t('workout.deleteWorkout')}
              </Button>
              <Button variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? t('workout.saving') : (t('workout.saveChanges') || 'Save changes')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
      <ProfanityWarningDialog open={notesGuard.open} onContinue={notesGuard.onContinue} />

      {/* Anti-cheat: unrealistic weight hard-stop */}
      {cheatWarningData && (
        <Dialog open={!!cheatWarningData} onOpenChange={(open) => { if (!open) setCheatWarningData(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-heading">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                Cheating is only cheating yourself
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              One or more sets have unrealistic weight values. Those weights have been cleared — please enter valid values before saving.
            </p>
            {cheatWarningData.flaggedSets?.length > 0 && (
              <ul className="text-xs text-muted-foreground space-y-1 mt-1">
                {cheatWarningData.flaggedSets.map((f, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive/60 shrink-0" />
                    {f.exName} — Set {f.setIndex + 1}
                  </li>
                ))}
              </ul>
            )}
            <Button className="w-full" onClick={() => {
              const { flaggedSets } = cheatWarningData;
              setExercises(exercises.map((ex, exIndex) => ({
                ...ex,
                sets: (ex.sets || []).map((s, setIndex) =>
                  flaggedSets.some(f => f.exIndex === exIndex && f.setIndex === setIndex)
                    ? { ...s, weight: null }
                    : s
                ),
              })));
              setCheatWarningData(null);
            }}>
              Go Back &amp; Fix
            </Button>
          </DialogContent>
        </Dialog>
      )}

      {/* Implausible workout / set-count warning */}
      {implausibleWarning && (
        <Dialog open={!!implausibleWarning} onOpenChange={(open) => { if (!open) setImplausibleWarning(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-heading">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                Workout looks unrealistic
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{implausibleWarning}</p>
            <Button className="w-full mt-2" onClick={() => setImplausibleWarning(null)}>
              Dismiss
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}