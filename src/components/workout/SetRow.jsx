import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { getMaxRealisticWeight, getMaxRealisticReps } from '@/lib/realisticLimits';
import { useWeightUnit } from '../../lib/WeightUnitContext';
import { fromLbs, toLbs, formatWeightNumber } from '../../lib/weightUnit';
import { useLanguage } from '@/lib/LanguageContext';

export default function SetRow({ set, index, onChange, onRemove, exerciseName = '', userProfile = {} }) {
  const { weightUnit } = useWeightUnit();
  const { t } = useLanguage();
  const maxWeight = getMaxRealisticWeight(exerciseName, userProfile);
  const maxReps = getMaxRealisticReps(exerciseName, set.weight || 0, userProfile);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-6 text-center font-medium">{index + 1}</span>
      <div className="flex-1">
        <Input
          type="number"
          inputMode="decimal"
          value={set.weight != null ? formatWeightNumber(set.weight, weightUnit) : ''}
          onChange={e => {
            const raw = e.target.value;
            if (raw === '') {
              onChange({ ...set, weight: null });
            } else {
              const val = parseFloat(raw);
              const lbs = isNaN(val) ? null : toLbs(Math.max(0, val), weightUnit);
              onChange({ ...set, weight: lbs == null ? null : Math.min(maxWeight, lbs) });
            }
          }}
          onKeyDown={e => {
            if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
          }}
          placeholder={weightUnit}
          className="h-9 text-center"
        />
      </div>
      <span className="text-muted-foreground text-xs">×</span>
      <div className="flex-1">
        <Input
          type="number"
          inputMode="numeric"
          value={set.reps ?? ''}
          onChange={e => {
            const raw = e.target.value;
            if (raw === '') {
              onChange({ ...set, reps: null });
            } else {
              const val = parseInt(raw);
              onChange({ ...set, reps: isNaN(val) ? null : Math.min(maxReps, Math.max(0, val)) });
            }
          }}
          onKeyDown={e => {
            if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
          }}
          placeholder={t('common.reps')}
          className="h-9 text-center"
        />
      </div>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onRemove}>
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      </Button>
    </div>
  );
}