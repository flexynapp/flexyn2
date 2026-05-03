import React, { useState } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ExerciseAutocomplete from './ExerciseAutocomplete';
import MuscleGroupSelector from './MuscleGroupSelector';
import { getMaxSetsPerExercise } from '@/lib/workoutFatigue';
import { getMaxRealisticReps } from '@/lib/realisticLimits';
import { useMultiProfanityGuard, hasAnyProfanity } from '@/lib/useProfanityGuard';
import ProfanityWarningDialog from '@/components/ProfanityWarningDialog';
import { toast } from 'sonner';

const ALL_MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core', 'Full Body', 'Cardio'];

export default function RegimenForm({ initial, onSubmit, onCancel, userProfile = {} }) {
  const { t } = useLanguage();
  const maxSetsPerExercise = getMaxSetsPerExercise(userProfile);

  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [isPublic, setIsPublic] = useState(initial?.is_public || false);
  const guard = useMultiProfanityGuard();
  const [exercises, setExercises] = useState(
    (initial?.exercises || []).map(ex => ({
      ...ex,
      muscle_groups: ex.muscle_groups || (ex.muscle_group ? [ex.muscle_group] : []),
    }))
  );

  const addExercise = () => {
    setExercises([{ name: '', target_sets: null, target_reps: null, muscle_groups: [], notes: '' }, ...exercises]);
  };

  const updateExercise = (index, field, value) => {
    const updated = [...exercises];
    updated[index] = { ...updated[index], [field]: value };
    setExercises(updated);
  };

  const handleExerciseSelect = (index, exercise) => {
    const updated = [...exercises];
    updated[index] = {
      ...updated[index],
      name: exercise.name,
      displayName: exercise.displayName || exercise.name,
      muscle_groups: exercise.muscles,
    };
    setExercises(updated);
  };

  const removeMuscleGroup = (exerciseIndex, muscle) => {
    const updated = [...exercises];
    updated[exerciseIndex] = {
      ...updated[exerciseIndex],
      muscle_groups: updated[exerciseIndex].muscle_groups.filter(m => m !== muscle),
    };
    setExercises(updated);
  };

  const addMuscleGroup = (exerciseIndex, muscle) => {
    const updated = [...exercises];
    const current = updated[exerciseIndex].muscle_groups || [];
    if (!current.includes(muscle)) {
      updated[exerciseIndex] = { ...updated[exerciseIndex], muscle_groups: [...current, muscle] };
      setExercises(updated);
    }
  };

  const removeExercise = (index) => {
    setExercises(exercises.filter((_, i) => i !== index));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const exerciseStrings = (exercises || []).flatMap(ex => [ex.name, ex.displayName, ex.notes]);
    if (hasAnyProfanity(name, description, exerciseStrings)) {
      toast.error('Please remove inappropriate language before saving.');
      return;
    }

    if (!name?.trim()) {
      toast.error('Please give the regimen a name before saving.');
      return;
    }

    if (!exercises || exercises.length === 0) {
      toast.error('Add at least one exercise before saving.');
      return;
    }

    const issues = [];
    exercises.forEach((ex, i) => {
      const exLabel = (ex.displayName || ex.name || '').trim() || `Exercise ${i + 1}`;
      if (!(ex.displayName || ex.name || '').trim()) {
        issues.push(`${exLabel}: missing exercise name`);
      }
      if (ex.target_sets == null || ex.target_sets === '' || Number(ex.target_sets) < 1) {
        issues.push(`${exLabel}: missing or invalid sets`);
      }
      if (ex.target_reps == null || ex.target_reps === '' || Number(ex.target_reps) < 1) {
        issues.push(`${exLabel}: missing or invalid reps`);
      }
    });

    if (issues.length > 0) {
      const preview = issues.slice(0, 3).join(' • ');
      const more = issues.length > 3 ? ` (+${issues.length - 3} more)` : '';
      toast.error('Please complete every exercise', { description: `${preview}${more}` });
      return;
    }

    const normalised = exercises.map(ex => ({
      ...ex,
      muscle_groups: ex.muscle_groups || [],
      muscle_group: (ex.muscle_groups || [])[0] || '',
      target_sets: Math.min(maxSetsPerExercise, Math.max(1, Number(ex.target_sets))),
      target_reps: Math.min(getMaxRealisticReps(ex.name, 0, userProfile), Math.max(1, Number(ex.target_reps))),
    }));
    onSubmit({ name, description, exercises: normalised, is_public: isPublic });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">{t('regimens.name')}</label>
          <Input
            value={name}
            onChange={e => guard.handleChange(e.target.value, setName)}
            placeholder={t('regimens.namePlaceholder')}
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">{t('regimens.description')}</label>
          <Textarea
            value={description}
            onChange={e => guard.handleChange(e.target.value, setDescription)}
            placeholder={t('regimens.descriptionPlaceholder')}
            className="h-20"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-foreground">{t('workout.exercises')}</label>
          <Button type="button" variant="outline" size="sm" onClick={addExercise}>
            <Plus className="w-4 h-4 mr-1" /> {t('regimens.addExercise')}
          </Button>
        </div>

        {exercises.length === 0 && (
          <Card className="p-6 text-center border-dashed">
            <p className="text-sm text-muted-foreground">No exercises added yet.</p>
          </Card>
        )}

        <AnimatePresence initial={false}>
          <div className="space-y-3">
            {exercises.map((ex, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: -12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              >
                <Card className="p-4 border-none shadow-sm">
              <div className="flex items-start gap-3">
                <GripVertical className="w-4 h-4 text-muted-foreground mt-3 shrink-0" />
                <div className="flex-1 space-y-3">
                  {/* Exercise name autocomplete */}
                  <ExerciseAutocomplete
                    value={ex.displayName || ex.name}
                    onChange={(val) => guard.handleChange(val, (v) => updateExercise(i, 'displayName', v))}
                    onSelect={(exercise) => handleExerciseSelect(i, exercise)}
                    placeholder="Search exercise (e.g. Deadlift)..."
                  />

                  {/* Muscle group selector */}
                  <MuscleGroupSelector
                    selected={ex.muscle_groups || []}
                    availableGroups={ALL_MUSCLE_GROUPS}
                    onAdd={(muscle) => addMuscleGroup(i, muscle)}
                    onRemove={(muscle) => removeMuscleGroup(i, muscle)}
                  />

                  {/* Sets / Reps */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">{t('common.sets')}</label>
                      <Input
                        type="number" min="1" max={maxSetsPerExercise}
                        value={ex.target_sets ?? ''}
                        onChange={e => {
                          const raw = e.target.value;
                          if (raw === '') {
                            updateExercise(i, 'target_sets', null);
                          } else {
                            const val = parseInt(raw);
                            updateExercise(i, 'target_sets', isNaN(val) ? null : Math.min(maxSetsPerExercise, Math.max(1, val)));
                          }
                        }}
                        onKeyDown={e => {
                          if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
                        }}
                        placeholder="—"
                      />
                     </div>
                    <div>
                     <label className="text-xs text-muted-foreground mb-1 block">{t('common.reps')}</label>
                     <Input
                       type="number" min="1" max={getMaxRealisticReps(ex.name, 0, userProfile)}
                       value={ex.target_reps ?? ''}
                       onChange={e => {
                         const raw = e.target.value;
                         if (raw === '') {
                           updateExercise(i, 'target_reps', null);
                         } else {
                           const val = parseInt(raw);
                           const maxRepsForEx = getMaxRealisticReps(ex.name, 0, userProfile);
                           updateExercise(i, 'target_reps', isNaN(val) ? null : Math.min(maxRepsForEx, Math.max(1, val)));
                         }
                       }}
                       onKeyDown={e => {
                         if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
                       }}
                       placeholder="—"
                     />
                    </div>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => removeExercise(i)} className="shrink-0 mt-1">
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </AnimatePresence>
      </div>

      {/* Public template toggle */}
      <button
        type="button"
        onClick={() => setIsPublic(p => !p)}
        className={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors ${
          isPublic ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/30'
        }`}
      >
        <div className="text-left">
          <p className="font-semibold text-sm">{t('regimens.isPublic')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t('regimens.isPublicDesc')}</p>
        </div>
        <div className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${isPublic ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${isPublic ? 'left-5' : 'left-1'}`} />
        </div>
      </button>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit">{initial ? t('common.save') : t('regimens.create')}</Button>
      </div>

      <ProfanityWarningDialog open={guard.open} onContinue={guard.onContinue} />
    </form>
  );
}
