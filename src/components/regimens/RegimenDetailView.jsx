import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Clock, RotateCcw, Hash } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { muscleKey, translateExerciseName } from '@/lib/exerciseTranslations';
import ExerciseFormPanel from '@/components/exercise/ExerciseFormPanel';

export default function RegimenDetailView({ regimen }) {
  const { t, language } = useLanguage();
  const exercises = regimen.exercises || [];
  // `copy_count` (mig 005), maintained by the increment_copy_count RPC.
  // This read `clone_count` — a column no migration ever created, residue of
  // the 2026-05-25 drift that crews.js documents, and 0 on every row — so
  // this block has never rendered. Dropped by mig 382.
  const copyCount = regimen.copy_count ?? 0;

  if (exercises.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2 text-center">{t('regimens.noExercises')}</p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {copyCount > 0 && (
        <p className="text-xs font-semibold text-primary mb-1">
          Cloned {copyCount} {copyCount === 1 ? 'time' : 'times'}
        </p>
      )}
      {exercises.map((ex, i) => {
        const muscles = ex.muscle_groups?.length ? ex.muscle_groups : (ex.muscle_group ? [ex.muscle_group] : []);
        return (
          <div key={i} className="flex items-start gap-3 bg-muted/40 rounded-lg px-3 py-2.5">
            <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-primary">{i + 1}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{ex.displayName || translateExerciseName(ex.name, language)}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                {ex.target_sets && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <RotateCcw className="w-3 h-3" /> {ex.target_sets} {t('common.sets')}
                  </span>
                )}
                {ex.target_reps > 0 && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Hash className="w-3 h-3" /> {ex.target_reps} {t('common.reps')}
                  </span>
                )}
                {ex.target_duration_minutes && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" /> {ex.target_duration_minutes} min
                  </span>
                )}
              </div>
              {muscles.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {muscles.map(m => (
                    <Badge key={m} variant="secondary" className="text-xs py-0">{t(`muscleGroups.${muscleKey(m)}`)}</Badge>
                  ))}
                </div>
              )}
              {ex.notes && (
                <p className="text-xs text-muted-foreground italic mt-1">{ex.notes}</p>
              )}
              {/* Reading a saved regimen is the calm moment to find out a lift
                  is unfamiliar — before you are stood in front of a rack with
                  a timer running. This is also where onboarding's starter plan
                  lands ("Saved to Workout → Regimens"), so it is the surface
                  most likely to be someone's first look at a movement they
                  have never done. Collapsed, so a list of eight costs nothing
                  to anyone who already knows them. */}
              <ExerciseFormPanel
                exerciseName={ex.name || ex.displayName}
                className="mt-2"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}