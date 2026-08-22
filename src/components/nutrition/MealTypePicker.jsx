// src/components/nutrition/MealTypePicker.jsx
import React from 'react';
import { Coffee, Sun, Moon, Cookie } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

// `label` stays English: MealHistoryModal builds a lookup keyed by it, and
// `nutrition.form.<id>` is what every render site resolves. Four meals, one
// key family — LogRecipeSheet declared its own copy of this list and the
// weekly planner a third, all four words, three times.
export const MEAL_TYPES = [
  { id: 'breakfast', label: 'Breakfast', icon: Coffee },
  { id: 'lunch',     label: 'Lunch',     icon: Sun    },
  { id: 'dinner',    label: 'Dinner',    icon: Moon   },
  { id: 'snack',     label: 'Snack',     icon: Cookie },
];

export function autoPickMealType(now = new Date()) {
  const h = now.getHours();
  if (h >= 4  && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
}

export default function MealTypePicker({ value, onChange, size = 'sm', className = '' }) {
  const { tFallback } = useLanguage();
  const pad = size === 'sm' ? 'px-2.5 py-1 text-micro' : 'px-3 py-1.5 text-xs';
  return (
    <div role="radiogroup" aria-label={tFallback("mealTypePicker.mealType", "Meal type")} className={`flex gap-1 ${className}`}>
      {MEAL_TYPES.map(({ id, label, icon: Icon }) => {
        const isActive = value === id;
        return (
          <button key={id} type="button" role="radio" aria-checked={isActive}
            onClick={() => onChange(id)}
            className={`${pad} flex items-center gap-1 rounded-full font-semibold transition-colors ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/50 text-muted-foreground hover:bg-secondary active:bg-secondary'
            }`}
          >
            <Icon className="w-3 h-3" />
            {tFallback(`nutrition.form.${id}`, label)}
          </button>
        );
      })}
    </div>
  );
}
