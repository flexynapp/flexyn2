import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the data layer BEFORE importing the module under test.
const filterMock = vi.fn();
const findByBarcodeMock = vi.fn();

vi.mock('@/api/db', () => ({
  db: {
    entities: { FoodItem: { filter: (...args) => filterMock(...args) } },
    functions: { invoke: vi.fn() },
  },
}));
vi.mock('@/lib/data/foodItems', () => ({
  findByBarcode: (...args) => findByBarcodeMock(...args),
}));

import { lookupBarcode } from '@/lib/foodLookup';

const BARCODE = '0123456789012';

beforeEach(() => {
  filterMock.mockReset();
  findByBarcodeMock.mockReset();
});

describe('lookupBarcode — community source normalisation', () => {
  it('prefers the nutrition jsonb when present', async () => {
    filterMock.mockResolvedValue([{
      id: 'r1',
      barcode: BARCODE,
      name: 'Almond Butter',
      serving_label: '2 tbsp',
      created_date: '2026-06-01T00:00:00Z',
      // flat columns carry stale defaults — jsonb must win
      calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0,
      nutrition: {
        calories: 210, protein: 7, carbs: 6, fat: 18,
        fiber: 3, sugar: 2, sodium: 70, cholesterol: null,
      },
      vitamins: { iron_mg: 1.1 },
    }]);

    const product = await lookupBarcode(BARCODE);
    expect(product.source).toBe('community');
    expect(product.communityId).toBe('r1');
    expect(product.nutrition.calories).toBe(210);
    expect(product.nutrition.sugar).toBe(2);
    expect(product.vitamins.iron_mg).toBe(1.1);
    expect(product.servingLabel).toBe('2 tbsp');
  });

  it('falls back to flat legacy columns when the jsonb is absent', async () => {
    filterMock.mockResolvedValue([{
      id: 'r2',
      barcode: BARCODE,
      name: 'Granola Bar',
      created_date: '2026-06-01T00:00:00Z',
      calories: 150, protein: 10, carbs: 20, fat: 5, fiber: 2, sodium: 95,
      // pre-migration row: no nutrition / vitamins columns at all
    }]);

    const product = await lookupBarcode(BARCODE);
    expect(product.nutrition).toEqual({
      calories: 150, protein: 10, carbs: 20, fat: 5,
      fiber: 2, sodium: 95, sugar: null, cholesterol: null,
    });
    expect(product.vitamins).toEqual({});
  });

  // ── INVERTED 2026-08-12. Do not restore the old expectation. ─────────────
  //
  // This block used to be titled "fills null jsonb fields from flat columns
  // per-field" and asserted `nutrition.protein === 12` for a row whose jsonb
  // said `protein: null` and whose flat column said 12. That is the defect the
  // food-database audit found, and it was live on the catalogue.
  //
  // An explicit null in the jsonb is the submission form saying "the label was
  // not read for this field" — `parseFloat('')` on a blank input. The six flat
  // columns carry `DEFAULT 0`, so `json[key] ?? flat` turned that into a hard
  // 0, and 0 g of protein is a manufacturer-grade claim rather than an
  // absence. Measured on production: `White Claw Surge (Pineapple)` has
  // protein/carbs/fat/fiber null in `nutrition` and 0 in the flat columns, so
  // every scanner who looked it up was told it contained zero of all four.
  //
  // The old fixture's shape — a non-null flat column over a null jsonb key —
  // is also one no writer has ever produced: every writer fills the flat
  // columns FROM the jsonb (`approve_food_item_request` casts
  // `v_nutrition->>'protein'`), so a null jsonb key leaves the flat column at
  // its default or NULL, never at a real number. The fallback was firing only
  // on the reachable case, which was the wrong one.
  it('keeps a null jsonb field NULL rather than reading the flat column’s DEFAULT 0', async () => {
    filterMock.mockResolvedValue([{
      id: 'r3',
      barcode: BARCODE,
      name: 'White Claw Surge (Pineapple)',
      serving_label: '1 serving',
      created_date: '2026-07-17T03:06:06Z',
      // Verbatim production shape, both halves.
      calories: 160, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 30,
      nutrition: {
        calories: 160, protein: null, carbs: null, fat: null,
        fiber: null, sugar: 2, sodium: 30, cholesterol: null,
      },
      vitamins: {},
    }]);

    const product = await lookupBarcode(BARCODE);
    expect(product.nutrition.calories).toBe(160);
    expect(product.nutrition.sodium).toBe(30);
    expect(product.nutrition.sugar).toBe(2);
    // The four the submitter left blank stay unknown. Each of these was `0`.
    expect(product.nutrition.protein).toBeNull();
    expect(product.nutrition.carbs).toBeNull();
    expect(product.nutrition.fat).toBeNull();
    expect(product.nutrition.fiber).toBeNull();
  });

  it('still reads the flat column when the jsonb does not carry the key at all', async () => {
    // The legacy row this fallback was written for: partial jsonb, no
    // `protein` key. `key in json` is false, so the flat column answers —
    // which is the behaviour the inverted test above must not take away.
    filterMock.mockResolvedValue([{
      id: 'r4',
      barcode: BARCODE,
      name: 'Yogurt',
      created_date: '2026-06-01T00:00:00Z',
      calories: 0, protein: 12, carbs: 0, fat: 0, fiber: 0, sodium: 0,
      nutrition: { calories: 90, carbs: 8, fat: 2 },
    }]);

    const product = await lookupBarcode(BARCODE);
    expect(product.nutrition.calories).toBe(90);  // jsonb
    expect(product.nutrition.protein).toBe(12);   // flat fallback, key absent
  });

  it('picks the newest row when multiple share a barcode (NULL created_date loses)', async () => {
    filterMock.mockResolvedValue([
      { id: 'null-date', barcode: BARCODE, name: 'Old Null', created_date: null, created_at: null },
      { id: 'old', barcode: BARCODE, name: 'Old', created_date: '2026-01-01T00:00:00Z' },
      { id: 'new', barcode: BARCODE, name: 'New', created_date: '2026-06-09T00:00:00Z', nutrition: { calories: 50 } },
    ]);

    const product = await lookupBarcode(BARCODE);
    expect(product.communityId).toBe('new');
    expect(product.nutrition.calories).toBe(50);
  });

  it('falls back to findByBarcode when the multi-row filter throws', async () => {
    filterMock.mockRejectedValue(new Error('42703'));
    findByBarcodeMock.mockResolvedValue({
      id: 'fb', barcode: BARCODE, name: 'Fallback Item',
      calories: 80, protein: 3, carbs: 14, fat: 1, fiber: 1, sodium: 30,
    });

    const product = await lookupBarcode(BARCODE);
    expect(product.communityId).toBe('fb');
    expect(product.nutrition.calories).toBe(80);
  });
});
