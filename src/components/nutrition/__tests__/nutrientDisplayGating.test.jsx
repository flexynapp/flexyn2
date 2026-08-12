// The Macros and Vitamins cards must not render a nutrient as zero.
//
// Both cards used to map over a fixed list and draw every tile
// unconditionally, so a nutrient with nothing behind it showed "0.0g · 0%"
// above a zero-width bar. CLAUDE.md: a section with no data must not render
// as zeros — a 0 reads as a failure the user did not commit.
//
// That was not a rare empty state. Ten of the sixteen nutrients have NO
// COLUMN on `nutrition_logs` (migration 006 declares them and has never been
// applied), so eight vitamin/mineral tiles plus sugar and cholesterol were
// structurally incapable of ever showing a non-zero number, for every user,
// every day, since launch. See mealWritePath.test.js and
// docs/nutrition-meal-logging-audit.md.
//
// The fixtures below are the real production shapes, including the one that
// matters most and that no invented fixture produces by accident: a day of
// nothing but water. 118 of the 126 rows in `nutrition_logs` are hydration
// (meal_type IS NULL, food_name 'Water' or 'Water|30'), so a water-only day
// is what most days actually look like.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, english) => english,
  }),
}));
vi.mock('@/lib/SettingsContext', () => ({
  useSettings: () => ({ nutrientRingView: false }),
}));
vi.mock('@/hooks/useNutritionTargets', () => ({
  useNutritionTargets: () => ({
    calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 65,
    sodium_mg: 2300, fiber_g: 30, sugar_g: 50, cholesterol_mg: 300,
    iron_mg: 18, magnesium_mg: 400, calcium_mg: 1000, potassium_mg: 3500,
    vitamin_a_iu: 3000, vitamin_c_mg: 90, vitamin_d_iu: 600, vitamin_b12_mcg: 2.4,
  }),
}));

import MacroNutrientBox from '../MacroNutrientBox';
import MineralsVitaminsBox from '../MineralsVitaminsBox';

// ── Fixtures, taken from production rows ─────────────────────────────────

/** The real shape of most days: hydration only, no meal. */
const WATER_ONLY = [
  { food_name: 'Water',    meal_type: null, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
  { food_name: 'Water|30', meal_type: null, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
];

/** 2026-08-11's two dinners — the only day with more than one real meal. */
const TWO_REAL_MEALS = [
  {
    food_name: 'Farro and roasted vegetable bowl', meal_type: 'dinner',
    calories: 470, protein: 15, carbs: 85, fat: 8, fiber: 10, sodium: 150,
    ai_meta: { source: 'photo_ai', sugar_g: 4 },
  },
  {
    food_name: 'Mac and Cheese with Peas rice with green peas', meal_type: 'dinner',
    calories: 330, protein: 9, carbs: 69, fat: 2, fiber: 4, sodium: 480,
    ai_meta: { source: 'photo_ai', sugar_g: 3 },
  },
];

/** The eighth meal: food_name 'ck', every nutrient zero. */
const ZERO_MEAL = [
  { food_name: 'ck', meal_type: 'breakfast', calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
];

const macroText = () => screen.getByText(/Nothing logged yet today/i);

describe('MacroNutrientBox — no data must not render as zeros', () => {
  it('renders no tiles at all with no entries', () => {
    render(<MacroNutrientBox entries={[]} />);
    expect(macroText()).toBeInTheDocument();
    expect(screen.queryByText(/^0\.0g$/)).not.toBeInTheDocument();
  });

  it('renders no tiles on a WATER-ONLY day — the real production shape', () => {
    render(<MacroNutrientBox entries={WATER_ONLY} />);
    expect(macroText()).toBeInTheDocument();
    // Nothing anywhere on the card claims a zero quantity.
    expect(screen.queryByText(/0\.0g|0mg|0cal/)).not.toBeInTheDocument();
  });

  it('renders no tiles for a meal whose every nutrient is zero', () => {
    render(<MacroNutrientBox entries={ZERO_MEAL} />);
    expect(macroText()).toBeInTheDocument();
  });

  it('drops only the empty tiles when real macros are present', () => {
    render(<MacroNutrientBox entries={TWO_REAL_MEALS} />);
    expect(screen.queryByText(/Nothing logged yet today/i)).not.toBeInTheDocument();
    // Present: calories 800, protein 24, carbs 154, fat 10, fiber 14, sodium 630.
    expect(screen.getByText('800cal')).toBeInTheDocument();
    expect(screen.getByText('24.0g')).toBeInTheDocument();
    expect(screen.getByText('154.0g')).toBeInTheDocument();
    // Absent: cholesterol has no column and no ai_meta fallback, so no tile.
    expect(screen.queryByText('nutrition.macros.cholesterol')).not.toBeInTheDocument();
    expect(screen.queryByText('0mg')).not.toBeInTheDocument();
  });

  it('recovers sugar from ai_meta, which the card used to throw away', () => {
    render(<MacroNutrientBox entries={TWO_REAL_MEALS} />);
    // 4 + 3 from ai_meta.sugar_g. There is no sugar_g COLUMN; before the
    // fix this tile read 0.0g on a meal whose sugar the AI had measured.
    expect(screen.getByText('nutrition.macros.sugar')).toBeInTheDocument();
    expect(screen.getByText('7.0g')).toBeInTheDocument();
  });

  it('hides the net-carbs line rather than printing a permanent 0.0 g', () => {
    render(<MacroNutrientBox entries={WATER_ONLY} />);
    expect(screen.queryByText(/Net carbs/i)).not.toBeInTheDocument();
    render(<MacroNutrientBox entries={TWO_REAL_MEALS} />);
    expect(screen.getByText(/Net carbs/i)).toBeInTheDocument();
  });
});

describe('MineralsVitaminsBox — eight tiles that could never be non-zero', () => {
  const noneTracked = /aren't being recorded yet/i;

  it('states plainly that nothing is recorded, on every production shape', () => {
    for (const fixture of [[], WATER_ONLY, ZERO_MEAL, TWO_REAL_MEALS]) {
      const { unmount } = render(<MineralsVitaminsBox entries={fixture} />);
      expect(screen.getByText(noneTracked)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders none of the eight zero tiles', () => {
    render(<MineralsVitaminsBox entries={TWO_REAL_MEALS} />);
    for (const label of [
      'nutrition.minerals.iron', 'nutrition.minerals.magnesium',
      'nutrition.minerals.calcium', 'nutrition.minerals.potassium',
      'nutrition.vitamins.a', 'nutrition.vitamins.c',
      'nutrition.vitamins.d', 'nutrition.vitamins.b12',
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/0mg|0IU|0mcg/)).not.toBeInTheDocument();
  });

  // The forward-compatibility half: this is what SHOULD happen the day
  // migration 006 is applied and the micronutrient inputs start persisting.
  // It passes today against a hand-built row, which is the point — the card
  // needs no further change when the schema catches up.
  it('brings a tile back as soon as its nutrient has a value', () => {
    render(<MineralsVitaminsBox entries={[{ food_name: 'Spinach', iron_mg: 6, calcium_mg: 250 }]} />);
    expect(screen.queryByText(noneTracked)).not.toBeInTheDocument();
    expect(screen.getByText('nutrition.minerals.iron')).toBeInTheDocument();
    expect(screen.getByText('6mg')).toBeInTheDocument();
    expect(screen.getByText('250mg')).toBeInTheDocument();
    // The six with no value stay hidden.
    expect(screen.queryByText('nutrition.vitamins.a')).not.toBeInTheDocument();
  });
});
