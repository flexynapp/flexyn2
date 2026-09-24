// The two glances the Today screen added. Both reduce data to a line of
// text, and both have a case that is easy to get backwards.
import { describe, it, expect } from 'vitest';
import { summariseFuel } from '@/components/dashboard/TodayFuelCard';
import { warLine } from '@/components/dashboard/CrewWarGlance';

const tFallback = (_key, en, vars = {}) => en.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
const fmt = (n) => String(n);

describe('summariseFuel', () => {
  it('counts water rows as water, not as zero-calorie meals', () => {
    const rows = [
      { food_name: 'Oats', calories: 310.4, meal_type: 'breakfast' },
      { food_name: 'Water', calories: 0, meal_type: null },
      { food_name: 'Water|16', calories: 0, meal_type: null },
      { food_name: 'Chicken', calories: 420, meal_type: 'lunch' },
    ];
    expect(summariseFuel(rows)).toEqual({ calories: 730, waterOz: 24 });
  });

  it('is zero on an empty day', () => {
    expect(summariseFuel([])).toEqual({ calories: 0, waterOz: 0 });
  });
});

describe('warLine', () => {
  it('reads from the viewer\'s side', () => {
    expect(warLine({ mine: 1420, theirs: 1180 }, tFallback, fmt)).toBe('You lead 1420 to 1180');
    expect(warLine({ mine: 900, theirs: 1180 }, tFallback, fmt)).toBe('You trail 900 to 1180');
    expect(warLine({ mine: 50, theirs: 50 }, tFallback, fmt)).toBe('Tied at 50');
  });
});
