// BarcodeResultModal — what a scan shows before you log it.
//
// The defect this file pins: the macro grid rendered `{Math.round(pct)}% DV`
// OUTSIDE the null check, so a nutrient the record does not carry showed
// **"0% DV"** next to an em dash. Twelve lines below, the vitamin grid handled
// the identical case correctly — which is why nobody spotted it.
//
// Measured in a browser against the real catalogue row `White Claw Surge
// (Pineapple)` on 2026-08-12: seven tiles, five reading 0.0, one reading
// "0% DV / —mg". CLAUDE.md: a section with no data must not render as zeros.
// The sibling cards on the same page were fixed for this on 2026-08-11
// (`nutrientDisplayGating.test.jsx`); this sheet was missed.
//
// The distinction that matters and that the fixtures below exercise both
// sides of: **a genuine 0 keeps its tile, a null does not.** A diet soda
// really does contain 0 g of protein and that is the label's claim; a null is
// nobody having read that line. Telling them apart only became possible when
// `foodLookup.js` stopped substituting the flat column's `DEFAULT 0` over an
// explicit jsonb null — see foodLookup.test.js.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, english, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), english) : english,
  }),
}));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));

import BarcodeResultModal from '../BarcodeResultModal';

/**
 * Exactly what `lookupBarcode('634985801507')` returns for the production row,
 * after the foodLookup fix: the four fields its submitter left blank are null.
 */
const WHITE_CLAW = {
  barcode: '634985801507',
  name: 'White Claw Surge (Pineapple)',
  servingLabel: '1 serving',
  source: 'community',
  nutrition: {
    calories: 160, protein: null, carbs: null, fat: null,
    fiber: null, sugar: 2, sodium: 30, cholesterol: null,
  },
  vitamins: {
    iron_mg: null, calcium_mg: null, magnesium_mg: null, potassium_mg: null,
    vitamin_a_iu: null, vitamin_c_mg: null, vitamin_d_iu: null, vitamin_b12_mcg: null,
  },
};

/** The other production row — a full label, nothing missing but cholesterol. */
const WAFER = {
  barcode: '842826002642',
  name: 'Wafer Cookie (Lemon)',
  servingLabel: '1 serving',
  source: 'community',
  nutrition: {
    calories: 160, protein: 2, carbs: 20, fat: 8,
    fiber: 0.3, sugar: 12, sodium: 50, cholesterol: null,
  },
  vitamins: {},
};

/** A real zero: an Open Food Facts diet soda. 0 is data, not an absence. */
const DIET_SODA = {
  barcode: '049000028911',
  name: 'Diet Cola',
  servingLabel: '1 can (355ml)',
  source: 'openfoodfacts',
  nutrition: {
    calories: 0, protein: 0, carbs: 0, fat: 0,
    fiber: 0, sugar: 0, sodium: 40, cholesterol: 0,
  },
  vitamins: {},
};

const show = (product) =>
  render(<BarcodeResultModal product={product} onCancel={() => {}} onLog={() => {}} isLogging={false} />);

describe('BarcodeResultModal — a nutrient the label does not carry', () => {
  it('renders no tile for it, and no "0% DV" beside an em dash', () => {
    show(WHITE_CLAW);
    // The two the record actually has.
    expect(screen.getByText('nutrition.macros.sugar')).toBeTruthy();
    expect(screen.getByText('nutrition.macros.sodium')).toBeTruthy();
    // The five it does not.
    for (const key of ['protein', 'carbs', 'fat', 'fiber', 'cholesterol']) {
      expect(screen.queryByText(`nutrition.macros.${key}`)).toBeNull();
    }
    // Nothing on screen claims a share of a daily value we do not have, and
    // no em dash stands in for one.
    expect(screen.queryByText('0% DV')).toBeNull();
    expect(document.body.textContent).not.toContain('—');
  });

  it('keeps the calories hero, which the grid never carried anyway', () => {
    show(WHITE_CLAW);
    expect(screen.getByText('160')).toBeTruthy();
    expect(screen.getByText('8%')).toBeTruthy();   // 160 / 2000
  });

  it('hides the vitamins tab when every vitamin is null', () => {
    show(WHITE_CLAW);
    expect(screen.queryByText('Nutrients')).toBeNull();
    expect(screen.queryByText('Vitamins & minerals')).toBeNull();
  });
});

describe('BarcodeResultModal — a genuine zero is data', () => {
  it('keeps a 0 g tile for a food that really contains none', () => {
    show(DIET_SODA);
    // Every macro is 0 and every one keeps its tile: this is what the label
    // says, and dropping them would be inventing an absence.
    for (const key of ['protein', 'carbs', 'fat', 'fiber', 'sugar', 'cholesterol']) {
      expect(screen.getByText(`nutrition.macros.${key}`)).toBeTruthy();
    }
    // The figure and its unit are separate elements, so match on the tile.
    const proteinTile = screen.getByText('nutrition.macros.protein').closest('div.rounded-xl');
    expect(proteinTile.textContent).toContain('0.0');
    expect(proteinTile.textContent).toContain('0% DV');   // a real 0% of DV
  });

  it('says so plainly when a record carries nothing but calories', () => {
    show({ ...WHITE_CLAW, nutrition: { calories: 160, protein: null, carbs: null, fat: null, fiber: null, sugar: null, sodium: null, cholesterol: null } });
    expect(screen.getByText(/only carries calories/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain('0% DV');
  });
});

describe('BarcodeResultModal — the rest of the sheet', () => {
  it('renders a full label unchanged', () => {
    show(WAFER);
    for (const key of ['protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium']) {
      expect(screen.getByText(`nutrition.macros.${key}`)).toBeTruthy();
    }
    expect(screen.queryByText('nutrition.macros.cholesterol')).toBeNull();  // null
  });

  it('names a community record without the emoji literal it used to carry', () => {
    show(WAFER);
    expect(screen.getByText(/Community submitted/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('👥');
  });

  it('names Open Food Facts as itself — a proper noun, not translated', () => {
    show(DIET_SODA);
    expect(screen.getByText(/Open Food Facts/)).toBeTruthy();
  });

  it('renders the vitamin tiles that have values and no others', () => {
    show({ ...WAFER, vitamins: { iron_mg: 1.1, calcium_mg: null, vitamin_c_mg: 12, vitamin_d_iu: null } });
    expect(screen.getByText('Vitamins & minerals')).toBeTruthy();   // tab appears
    expect(screen.queryByText('nutrition.minerals.calcium')).toBeNull();
  });
});
