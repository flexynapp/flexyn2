import React, { useState, useEffect } from 'react';
import ExerciseAutocomplete from '@/components/regimens/ExerciseAutocomplete';
import { useLanguage } from '@/lib/LanguageContext';

const QUICK_PICKS = ['Squat', 'Deadlift', 'Bench Press', 'Pull-up', 'Push-up', 'Overhead Press'];

export default function ExercisePicker({ value, onChange, onDisplayChange }) {
  const { t } = useLanguage();
  const [displayValue, setDisplayValue] = useState(value);
  useEffect(() => { setDisplayValue(value); }, [value]);
  return (
    <div className="mb-5">
      <p className="text-sm font-medium text-foreground mb-2">{t('formcoach.selectExercise')}</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {QUICK_PICKS.map(ex => (
          <button
            key={ex}
            type="button"
            onClick={() => onChange(value === ex ? '' : ex)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all select-none-ui
              ${value === ex
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border text-foreground hover:border-primary/50 hover:bg-secondary active:bg-secondary'
              }`}
          >
            {ex}
          </button>
        ))}
      </div>
      <ExerciseAutocomplete
        value={value}
        onChange={onChange}
        onSelect={(ex) => {
          onChange(ex.name);
          const display = ex.displayName || ex.name;
          setDisplayValue(display);
          onDisplayChange?.(display);
        }}
        placeholder={t('formcoach.searchExercise')}
      />
      {value && (
        <p className="text-xs text-muted-foreground mt-2">
          {t('formcoach.analyzing2')} <span className="text-primary font-semibold">{displayValue}</span>
        </p>
      )}
    </div>
  );
}