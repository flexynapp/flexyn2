import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/lib/LanguageContext';
import { muscleKey } from '@/lib/exerciseTranslations';

const ALL_MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core', 'Full Body', 'Cardio'];

export default function MuscleGroupSelector({ selected = [], availableGroups = ALL_MUSCLE_GROUPS, onAdd, onRemove }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const unselected = availableGroups.filter(m => !selected.includes(m));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2"
        >
          {t('regimens.muscleGroups.label')}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </Button>
      </div>

      {/* Selected Tags */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(muscle => (
            <Badge key={muscle} variant="secondary" className="text-xs gap-1 pr-1">
              {t(`muscleGroups.${muscleKey(muscle)}`)}
              <button
                type="button"
                onClick={() => onRemove(muscle)}
                className="ml-0.5 hover:text-destructive transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {open && unselected.length > 0 && (
        <div className="border border-border rounded-lg p-2 bg-secondary/30 space-y-1">
          {unselected.map(muscle => (
            <button
              key={muscle}
              type="button"
              onClick={() => onAdd(muscle)}
              className="w-full text-left px-3 py-2 text-sm rounded text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              {t(`muscleGroups.${muscleKey(muscle)}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}