import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Clock, RotateCcw, Hash } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { muscleKey, translateExerciseName } from '@/lib/exerciseTranslations';

export default function RegimenDetailView({ regimen }) {
  const { t, language } = useLanguage();
  const exercises = regimen.exercises || [];

  if (exercises.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2 text-center">{t('regimens.noExercises')}</p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
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
            </div>
          </div>
        );
      })}
    </div>
  );
}