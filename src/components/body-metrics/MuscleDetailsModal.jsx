import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { Dumbbell } from 'lucide-react';
import { motion } from 'framer-motion';
import { MUSCLE_CATEGORIES } from './MuscleDiagram';
import { useLanguage } from '@/lib/LanguageContext';
import { getDateLocale } from '@/lib/dateLocales';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight } from '@/lib/weightUnit';

// Fallback English labels for specific muscle IDs not in i18n
const MUSCLE_LABELS_FALLBACK = {
  front_delts: "Front Delts", side_delts: "Side Delts", rear_delts: "Rear Delts",
  adductors: "Adductors", calves_front: "Calves", lower_back: "Lower Back", calves_back: "Calves",
};

export default function MuscleDetailsModal({ open, onClose, muscleId, category, workoutHistory = [] }) {
  const { t, language } = useLanguage();
  const dateLocale = getDateLocale(language);
  const { weightUnit } = useWeightUnit();
  const label = muscleId ? (t(`muscleGroups.${muscleId}`) !== `muscleGroups.${muscleId}` ? t(`muscleGroups.${muscleId}`) : (MUSCLE_LABELS_FALLBACK[muscleId] || muscleId)) : '';
  const categoryLabel = category ? t(`muscleGroups.${category}`) : '';

  // Get all specific muscle IDs for this category (or just the muscleId itself)
  const relatedMuscles = useMemo(() => {
    if (category && MUSCLE_CATEGORIES[category]) {
      return MUSCLE_CATEGORIES[category];
    }
    return muscleId ? [muscleId] : [];
  }, [category, muscleId]);

  const matchingExercises = useMemo(() => {
    if (!workoutHistory.length || !relatedMuscles.length) return [];

    const results = [];

    workoutHistory.forEach(workout => {
      (workout.exercises || []).forEach(ex => {
        let matched = false;

        if (ex.muscles?.primary || ex.muscles?.secondary) {
          const allMuscles = [...(ex.muscles.primary || []), ...(ex.muscles.secondary || [])];
          for (const m of allMuscles) {
            // Direct muscle match or category match
            if (relatedMuscles.includes(m) || m === category) {
              matched = true;
              break;
            }
            // If the muscle is a category, check if any of its muscles match
            if (MUSCLE_CATEGORIES[m]) {
              const catMuscles = MUSCLE_CATEGORIES[m];
              if (catMuscles.some(cm => relatedMuscles.includes(cm))) {
                matched = true;
                break;
              }
            }
          }
        } else if (ex.muscle_group) {
          // Legacy fallback: map muscle_group string to category
          const legacyCat = ex.muscle_group.toLowerCase().replace(/\s+/g, '');
          if (legacyCat === category || ex.muscle_group.toLowerCase() === (category || '').toLowerCase()) {
            matched = true;
          }
        }

        if (matched) {
          const sets = Array.isArray(ex.sets) ? ex.sets.length : (ex.sets || 0);
          const reps = Array.isArray(ex.sets) && ex.sets.length > 0 ? (ex.sets[0].reps || 0) : (ex.reps || 0);
          const weight = Array.isArray(ex.sets) && ex.sets.length > 0 ? (ex.sets[0].weight || null) : (ex.weight || null);
          results.push({
            name: ex.name,
            date: workout.date,
            sets,
            reps,
            weight
          });
        }
      });
    });

    // Sort by date descending
    return results.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [workoutHistory, relatedMuscles, category, categoryLabel]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-primary" />
            {label}
            {categoryLabel && categoryLabel !== label && (
              <span className="text-xs font-normal text-muted-foreground ms-1">({categoryLabel})</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {matchingExercises.length === 0 ? (
          <motion.div
            className="text-center py-10 text-muted-foreground text-sm"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          >
            <Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No exercises found for this muscle group yet.
          </motion.div>
        ) : (
          <motion.div
            className="divide-y divide-border"
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
          >
            {matchingExercises.map((ex, i) => (
              <motion.div
                key={i}
                className="py-3 flex items-start justify-between gap-3"
                variants={{
                  hidden: { opacity: 0, x: -16, scale: 0.97 },
                  visible: { opacity: 1, x: 0, scale: 1 },
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                whileHover={{ x: 4 }}
              >
                <div>
                  <p className="font-medium text-sm">{ex.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(ex.date), 'MMM d, yyyy', { locale: dateLocale })}
                  </p>
                </div>
                <div className="text-end text-xs text-muted-foreground shrink-0">
                  <p>{ex.sets} sets × {ex.reps} reps</p>
                  {ex.weight ? <p className="font-medium text-foreground">{formatWeight(ex.weight, weightUnit)}</p> : null}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </DialogContent>
    </Dialog>
  );
}