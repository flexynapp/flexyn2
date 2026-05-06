import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import SetRow from './SetRow';
import { motion, AnimatePresence } from 'framer-motion';
import { getMaxSetsPerExercise } from '@/lib/workoutFatigue';
import { useLanguage } from '@/lib/LanguageContext';
import { useRestTimer } from '@/lib/RestTimerContext';
import { muscleKey, translateExerciseName } from '@/lib/exerciseTranslations';
import { useWeightUnit } from '../../lib/WeightUnitContext';
import { fromLbs, formatWeight } from '../../lib/weightUnit';

export default function ExerciseLogger({ exercise, onChange, onViewForm, userProfile = {} }) {
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const { start: startRestTimer } = useRestTimer();
  const sets = exercise.sets || [];
  const muscles = exercise.muscle_groups?.length ? exercise.muscle_groups : (exercise.muscle_group ? [exercise.muscle_group] : []);
  const totalVolume = sets.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
  const maxSetsPerExercise = getMaxSetsPerExercise(userProfile);
  const atSetLimit = sets.length >= maxSetsPerExercise;

  const addSet = () => {
    if (atSetLimit) {
      toast.info(t('workout.maxSetsToast').replace('{count}', maxSetsPerExercise));
      return;
    }
    const lastSet = sets[sets.length - 1] || { weight: null, reps: null };
    // Only start the rest timer if the previous set has actually been logged
    // (has weight or reps) — otherwise the user is just preparing the first
    // set and doesn't need to rest yet.
    const previousSetLogged = !!(lastSet.weight || lastSet.reps);
    onChange({ ...exercise, sets: [...sets, { weight: lastSet.weight, reps: lastSet.reps }] });
    if (previousSetLogged) {
      startRestTimer();
    }
  };

  const updateSet = (index, updated) => {
    const newSets = [...sets];
    newSets[index] = updated;
    onChange({ ...exercise, sets: newSets });
  };

  const removeSet = (index) => {
    onChange({ ...exercise, sets: sets.filter((_, i) => i !== index) });
  };

  return (
    <Card className="p-4 border-none shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-medium text-sm">{exercise.displayName || translateExerciseName(exercise.name, language)}</h4>
          {muscles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {muscles.map(m => (
                <Badge key={m} variant="secondary" className="text-xs">{t(`muscleGroups.${muscleKey(m)}`)}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {totalVolume > 0 && (
        <div className="flex justify-end mb-2">
          <span className="text-xs text-muted-foreground font-medium">
            {formatWeight(fromLbs(totalVolume, weightUnit), weightUnit)} vol
          </span>
        </div>
      )}

      <div className="space-y-2 mb-3">
        {sets.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <span className="w-6 text-center">{t('workout.set')}</span>
            <span className="flex-1 text-center">{t('workout.weightWithUnit').replace('lbs', weightUnit)}</span>
            <span className="w-4"></span>
            <span className="flex-1 text-center">{t('workout.repsLabel')}</span>
            <span className="w-8"></span>
          </div>
        )}
        <AnimatePresence initial={false}>
          {sets.map((set, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, height: 0, y: -6 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: -6 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
            >
              <SetRow set={set} index={i} onChange={(s) => updateSet(i, s)} onRemove={() => removeSet(i)} exerciseName={exercise.name} userProfile={userProfile} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <motion.div whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.02 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={addSet}
          disabled={atSetLimit}
          title={atSetLimit ? t('workout.maxSetsTitle').replace('{count}', maxSetsPerExercise) : undefined}
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> {atSetLimit ? t('workout.maxSetsReachedLabel').replace('{count}', maxSetsPerExercise) : t('workout.addSet')}
        </Button>
      </motion.div>
    </Card>
  );
}