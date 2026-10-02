import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, X, AlertTriangle } from 'lucide-react';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import { getMaxRealisticWeight, getMaxRealisticReps, getMaxRealisticDuration } from '@/lib/realisticLimits';
import { detectImplausibleWorkout, getMaxSetsPerExercise, getMuscleGroupCap } from '@/lib/workoutFatigue';
import { useProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { toLbs, formatWeightNumber } from '@/lib/weightUnit';
import { getExerciseDisplay } from '@/lib/exerciseTranslations';
import { TagSelector } from '@/components/workout/WorkoutTags';
import { workoutDurationMin, DURATION_COLUMN } from '@/lib/workoutDuration';
import { workoutTitle, TITLE_COLUMN } from '@/lib/workoutTitle';

// Weight cell with focused-draft state. While focused it holds the raw
// keystrokes verbatim; on blur it parses → converts to canonical lbs →
// clamps. Re-formatting on every keystroke broke kg/stone typing (e.g.
// "82" in kg snapped to "8.0"). (Audit task 7.)
function WeightCell({ valueLbs, onCommit, maxWeight, weightUnit }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <Input
      type="number" min="0" step="0.5"
      inputMode="decimal"
      value={focused ? draft : (valueLbs != null ? formatWeightNumber(valueLbs, weightUnit) : '')}
      onFocus={() => {
        setDraft(valueLbs != null ? formatWeightNumber(valueLbs, weightUnit) : '');
        setFocused(true);
      }}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const raw = draft;
        if (raw === '') {
          onCommit(null);
        } else {
          const displayVal = parseFloat(raw);
          if (Number.isNaN(displayVal)) {
            onCommit(null);
          } else {
            const lbsVal = toLbs(Math.max(0, displayVal), weightUnit);
            onCommit(Math.min(maxWeight, lbsVal));
          }
        }
        setFocused(false);
      }}
      onKeyDown={e => { if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault(); }}
      placeholder={weightUnit}
      className="h-8 text-center text-sm"
    />
  );
}

const newSetKey = () => `s-${Math.random().toString(36).slice(2, 10)}`;
// Saved sets carry no _key (Workout.jsx strips it on save), so a freshly
// opened log keyed its rows by index. The first edit then ran ensureKeys,
// every row got a NEW random key and remounted, and the input being typed
// in lost focus after one digit ("12" reps saved as 1). Key once on load;
// handleSave rebuilds each set from named fields, so _key is never written.
const withSetKeys = (exercises) => (exercises || []).map(ex => ({
  ...ex,
  sets: (ex.sets || []).map(s => (s._key ? s : { ...s, _key: newSetKey() })),
}));

function SetEditor({ sets, onChange, exerciseName = '', userProfile = {} }) {
  const { t } = useLanguage();
  const { weightUnit } = useWeightUnit();
  // Ensure every set has a stable _key so removing one in the middle
  // doesn't re-key sets below it — the same key={i} bug pattern fixed
  // in ExerciseLogger (audit 09 #C-5). Without this, mid-typing a
  // weight while another set is removed could jump focus / snap the
  // input's rendered value to the next row's value.
  const ensureKeys = (arr) => arr.map(s => s._key ? s : { ...s, _key: newSetKey() });
  const updateSet = (i, field, val) => {
    const updated = ensureKeys(sets);
    updated[i] = { ...updated[i], [field]: val };
    onChange(updated);
  };
  const maxSetsPerExercise = getMaxSetsPerExercise(userProfile);
  const atSetLimit = sets.length >= maxSetsPerExercise;
  const addSet = () => {
    if (atSetLimit) return;
    const last = sets[sets.length - 1] || { weight: null, reps: null };
    onChange([...ensureKeys(sets), { weight: last.weight, reps: last.reps, _key: newSetKey() }]);
  };
  const removeSet = (i) => onChange(ensureKeys(sets).filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {sets.map((s, i) => (
        <div key={s._key || `s-${i}`} className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-5 text-center">{i + 1}</span>
          <WeightCell
            valueLbs={s.weight}
            maxWeight={getMaxRealisticWeight(exerciseName, userProfile)}
            weightUnit={weightUnit}
            onCommit={(lbs) => updateSet(i, 'weight', lbs)}
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
          <button type="button" onClick={() => removeSet(i)} className="p-1 text-muted-foreground hover:text-destructive active:text-destructive">
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
        title={atSetLimit ? t('workout.maxSetsTitle', { count: maxSetsPerExercise }) : undefined}
      >
        <Plus className="w-3 h-3 me-1" />
        {atSetLimit
          ? t('workout.maxSetsReachedLabel', { count: maxSetsPerExercise })
          : t('workout.addSet')}
      </Button>
    </div>
  );
}

// Cardio entries are not edited here: this form edits sets, and a run is
// its own cardio log (workoutCardio.js), edited from Cardio. They ride
// through untouched. Before, the set filter in handleSave dropped them on
// every edit, cutting the run out of the workout it was logged in.
const liftsOf = (list) => (Array.isArray(list) ? list : []).filter((ex) => ex?.kind !== 'cardio');
const cardioOf = (list) => (Array.isArray(list) ? list : []).filter((ex) => ex?.kind === 'cardio');

export default function EditWorkoutModal({ log, userProfile = {}, logs = [], cardioLogs = [], open, onClose, onSave, onDelete }) {
  const { t, language, tFallback } = useLanguage();
  const [exercises, setExercises] = useState(() => withSetKeys(liftsOf(log?.exercises)));
  const [date, setDate] = useState(log?.date || '');
  const [duration, setDuration] = useState(workoutDurationMin(log) || '');
  const [notes, setNotes] = useState(log?.notes || '');
  const [name, setName] = useState(workoutTitle(log) || '');
  const [tags, setTags] = useState(log?.tags || []);
  const notesGuard = useProfanityGuard(setNotes);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cheatWarningData, setCheatWarningData] = useState(null);
  const [implausibleWarning, setImplausibleWarning] = useState(null);

  // Resync state when the parent passes a different log without
  // unmounting the modal (e.g. the user opens a log, closes WITHOUT
  // unmount, then opens a different log from the same list). The
  // useState(log?.exercises || []) initializer only runs on FIRST
  // mount; without this effect the modal kept showing the previous
  // log's data and saving would overwrite the new log with the old
  // one's exercise list. (Audit 09 #C-3.)
  useEffect(() => {
    if (!log) return;
    setExercises(withSetKeys(liftsOf(log.exercises)));
    setDate(log.date || '');
    setDuration(workoutDurationMin(log) || '');
    setNotes(log.notes || '');
    setName(workoutTitle(log) || '');
    setTags(log.tags || []);
    setConfirmDelete(false);
    setCheatWarningData(null);
    setImplausibleWarning(null);
  }, [log?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateExerciseSets = (i, sets) => {
    const updated = [...exercises];
    updated[i] = { ...updated[i], sets };
    setExercises(updated);
  };

  const handleSave = async (forceSkipChecks = false) => {
    if (hasAnyProfanity(notes)) {
      toast.error(tFallback('common.profanity.notes', 'Please remove inappropriate language from notes before saving.'));
      return;
    }

    // Normalize each set: parse numbers, treat blank/NaN as 0. Then
    // strip entirely-empty sets (no weight AND no reps) so a blanked
    // row doesn't get saved as a 0×0 contribution to volume.
    // Previously blanks → 0×0 sets persisted, inflating the set count
    // for an exercise without adding any volume. (Audit 09 #H-5.)
    const normalizedExercises = exercises
      .map(ex => {
        const sets = (ex.sets || [])
          .map(s => ({
            weight: Number(s.weight) || 0,
            reps:   Number(s.reps)   || 0,
            // Preserve set metadata that the edit modal already supports
            // (warmup, failed, RPE, RIR, feel_emoji, feel_note) instead
            // of dropping it silently — same concern as repeat-from-log.
            ...(s.is_warmup    !== undefined ? { is_warmup: s.is_warmup } : {}),
            ...(s.is_failed    !== undefined ? { is_failed: s.is_failed } : {}),
            ...(s.rpe          !== undefined ? { rpe: s.rpe } : {}),
            ...(s.rir          !== undefined ? { rir: s.rir } : {}),
            ...(s.feel_emoji   !== undefined ? { feel_emoji: s.feel_emoji } : {}),
            ...(s.feel_note    !== undefined ? { feel_note: s.feel_note } : {}),
          }))
          .filter(s => s.weight > 0 || s.reps > 0);
        return {
          ...ex,
          sets,
          duration_minutes: ex.duration_minutes != null ? (Number(ex.duration_minutes) || null) : null,
        };
      })
      // If editing strips every set from an exercise (user blanked them
      // all), drop the exercise too — same pattern as the main save flow.
      .filter(ex => (ex.sets && ex.sets.length > 0) || ex.duration_minutes != null);

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
            t('workout.warn.perExSetLimit', {
              exercise: ex.name,
              setCount: ex.sets.length,
              maxSets: maxSetsPerEx,
            })
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
        // Preserve the set metadata that normalizedExercises already
        // whitelisted above (warmup/failed/rpe/rir/feel_*) instead of
        // reducing back to {weight,reps} and dropping it. (Audit task 6.)
        const { weight: _w, reps: _r, ...meta } = s;
        return { ...meta, weight: s.weight, reps: clampedReps };
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

    // A failed save used to leave the modal stuck on "Saving…" with every
    // button disabled and no message: onSave throws and nothing caught it.
    setSaving(true);
    try {
      await onSave(log.id, { exercises: [...finalExercises, ...cardioOf(log.exercises)], date, [DURATION_COLUMN]: duration ? parseInt(duration) : null, notes, [TITLE_COLUMN]: name.trim() || workoutTitle(log) || null, tags });
    } catch (err) {
      reportError(err, { feature: 'workout.edit-save', level: 'error' });
      toast.error(tFallback('workout.editSaveFailed', 'Could not save your changes. Try again.'));
      setSaving(false);
      return;
    }
    setSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await onDelete(log.id);
    } catch (err) {
      reportError(err, { feature: 'workout.edit-delete', level: 'error' });
      toast.error(tFallback('workout.editDeleteFailed', 'Could not delete this workout. Try again.'));
      setSaving(false);
      return;
    }
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{name || workoutTitle(log) || t('workout.freestyle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{tFallback('workout.nameLabel', 'Workout name')}</label>
            <Input value={name} onChange={e => setName(e.target.value.slice(0, 60))} maxLength={60} placeholder={t('workout.freestyle')} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{tFallback('workout.tagsLabel', 'Tags')}</label>
            <TagSelector value={tags} onChange={setTags} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('workout.date')}</label>
              <Input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                max={format(new Date(), 'yyyy-MM-dd')}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('workout.duration')}</label>
              <Input type="number" inputMode="decimal" min="0" value={duration} onChange={e => setDuration(e.target.value)} placeholder={t('common.optional')} />
            </div>
          </div>

          {cardioOf(log?.exercises).length > 0 && (
            <p className="text-xs text-muted-foreground">
              {tFallback('workout.editRunsFromCardio', 'Runs in this workout are edited from Cardio.')}
            </p>
          )}

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
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive active:text-destructive sm:mr-auto" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="w-4 h-4 me-1" /> {t('workout.deleteWorkout')}
              </Button>
              <Button variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
              {/* Not onClick={handleSave}: that passed the click event as
                  forceSkipChecks, which is truthy, so the realistic-weight,
                  set-cap and plausibility checks never ran on an edit. */}
              <Button size="sm" onClick={() => handleSave()} disabled={saving}>
                {saving ? t('workout.saving') : tFallback('workout.saveChanges', 'Save changes')}
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
                {tFallback("editWorkoutModal.cheatingIsOnlyCheatingYourself", "Cheating is only cheating yourself")}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {tFallback(
                'editWorkoutModal.unrealisticWeightBody',
                'One or more sets have weights that are not realistic. Tap {button} to clear them, then enter real values before saving.',
                { button: tFallback('workout.goBackAndFix', 'Go back and fix') },
              )}
            </p>
            {cheatWarningData.flaggedSets?.length > 0 && (
              <ul className="text-xs text-muted-foreground space-y-1 mt-1">
                {cheatWarningData.flaggedSets.map((f, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive/60 shrink-0" />
                    {tFallback('editWorkoutModal.flaggedSet', '{exercise}: set {n}', { exercise: f.exName, n: f.setIndex + 1 })}
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
              {tFallback("workout.goBackAndFix", "Go back and fix")}
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
                {tFallback("editWorkoutModal.workoutLooksUnrealistic", "Workout looks unrealistic")}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{implausibleWarning}</p>
            <Button className="w-full mt-2" onClick={() => setImplausibleWarning(null)}>
              {tFallback("discovery.dismiss", "Dismiss")}
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}