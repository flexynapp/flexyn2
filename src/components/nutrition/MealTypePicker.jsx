// src/components/nutrition/MealTypePicker.jsx
//
// Pill row for choosing the meal context (Breakfast / Lunch / Dinner /
// Snack) on a nutrition log. MyFitnessPal's most-used UX element —
// users intuitively bucket food into meal-time slots.
//
// Stateless / controlled: the parent owns the value and an onChange
// callback. Renders nothing on null value? No — defaults visually to
// "Snack" since that's the existing app default.
//
// Auto-pick is also exported for the manual-entry form: returns the
// most-likely meal type based on the current local clock so the user
// doesn't have to think when logging mid-day.

import React from 'react';
import { Coffee, Sun, Moon, Cookie } from 'lucide-react';

export const MEAL_TYPES = [
  { id: 'breakfast', label: 'Breakfast', icon: Coffee },
  { id: 'lunch',     label: 'Lunch',     icon: Sun    },
  { id: 'dinner',    label: 'Dinner',    icon: Moon   },
  { id: 'snack',     label: 'Snack',     icon: Cookie },
];

/**
 * Pick a sensible meal type from the local clock. Used to pre-fill
 * a new log entry without forcing the user to choose if they don't
 * care.
 */
export function autoPickMealType(now = new Date()) {
  const h = now.getHours();
  if (h >= 4  && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
}

export default function MealTypePicker({ value, onChange, size = 'sm', className = '' }) {
  const isLg = size === 'lg';
  const pad = size === 'sm'
    ? 'px-2.5 py-1 text-[11px]'
    : isLg
    ? 'flex-1 py-3 text-sm flex-col gap-1'
    : 'px-3 py-1.5 text-xs';
  return (
    <div
      role="radiogroup"
      aria-label="Meal type"
      className={`flex ${isLg ? 'gap-2' : 'gap-1'} ${className}`}
    >
      {MEAL_TYPES.map(({ id, label, icon: Icon }) => {
        const isActive = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(id)}
            className={`${pad} flex items-center justify-center rounded-xl font-semibold transition-colors active:scale-95 ${
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-secondary/60 text-muted-foreground hover:bg-secondary border border-border/50'
            }`}
          >
            <Icon className={isLg ? 'w-5 h-5' : size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
            {isLg && <span className="text-xs font-bold mt-0.5">{label}</span>}
            {!isLg && <span className="ml-1">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
