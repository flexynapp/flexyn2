import { describe, it, expect } from 'vitest';
import { entrySignature, makeDuplicateFilter, DEFAULT_DEDUPE_MS } from '@/lib/submitDedupe';
import { isWaterEntry } from '@/lib/waterEntries';

// The production duplicate, as it actually landed: two byte-identical rows
// 530 ms apart. That gap is past `guardSubmit`'s 400 ms re-arm, which is why a
// timing guard could never have caught it.
const MEAL = {
  date: '2026-07-16', meal_type: 'snack',
  food_name: 'Sautéed diced onion and red bell pepper',
  calories: 94, protein_g: 2, carbs_g: 12, fat_g: 5,
};
const GAP = 530;

describe('entrySignature', () => {
  it('matches two payloads that would persist to the same row', () => {
    expect(entrySignature(MEAL)).toBe(entrySignature({ ...MEAL }));
  });

  it('reads the _g alias and the bare column as the same value', () => {
    // nutritionData.create() dual-writes protein_g → protein, so a payload in
    // either shape becomes one row and must carry one signature.
    const bare = { ...MEAL, protein: 2, carbs: 12, fat: 5 };
    delete bare.protein_g; delete bare.carbs_g; delete bare.fat_g;
    expect(entrySignature(bare)).toBe(entrySignature(MEAL));
  });

  it('ignores case and surrounding whitespace in the name', () => {
    expect(entrySignature({ ...MEAL, food_name: '  SAUTÉED DICED ONION AND RED BELL PEPPER ' }))
      .toBe(entrySignature(MEAL));
  });

  it('separates meals that differ in any field that reaches the table', () => {
    for (const diff of [
      { date: '2026-07-17' }, { meal_type: 'dinner' }, { food_name: 'Something else' },
      { calories: 95 }, { protein_g: 3 }, { carbs_g: 13 }, { fat_g: 6 },
    ]) {
      expect(entrySignature({ ...MEAL, ...diff })).not.toBe(entrySignature(MEAL));
    }
  });

  it('does not throw on an empty or partial payload', () => {
    expect(() => entrySignature()).not.toThrow();
    expect(entrySignature({})).toBe(entrySignature({ food_name: '' }));
  });
});

describe('makeDuplicateFilter', () => {
  it('suppresses the exact production double-submit', () => {
    const accept = makeDuplicateFilter();
    expect(accept(MEAL, 1000)).toBe(true);
    expect(accept(MEAL, 1000 + GAP)).toBe(false);
  });

  it('lets a deliberate repeat through once the window has passed', () => {
    // Rescanning a second identical yoghurt is a real thing people do.
    const accept = makeDuplicateFilter();
    expect(accept(MEAL, 1000)).toBe(true);
    expect(accept(MEAL, 1000 + DEFAULT_DEDUPE_MS + 1)).toBe(true);
  });

  it('never blocks a different meal logged in the same breath', () => {
    const accept = makeDuplicateFilter();
    expect(accept(MEAL, 1000)).toBe(true);
    expect(accept({ ...MEAL, food_name: 'Grilled chicken' }, 1050)).toBe(true);
  });

  it('exempts water, where tapping the same glass twice is the feature', () => {
    const accept = makeDuplicateFilter({ isExempt: isWaterEntry });
    const glass = { date: '2026-08-12', food_name: 'Water', calories: 0 };
    for (let i = 0; i < 6; i++) expect(accept(glass, 1000 + i * 40)).toBe(true);
    expect(accept({ date: '2026-08-12', food_name: 'Water|24', calories: 0 }, 1300)).toBe(true);
  });

  it('still dedupes meals while water is streaming past it', () => {
    const accept = makeDuplicateFilter({ isExempt: isWaterEntry });
    const glass = { date: '2026-08-12', food_name: 'Water', calories: 0 };
    expect(accept(MEAL, 1000)).toBe(true);
    expect(accept(glass, 1100)).toBe(true);
    expect(accept(MEAL, 1200)).toBe(false);
  });

  it('does not grow without bound — expired keys are dropped', () => {
    const accept = makeDuplicateFilter();
    for (let i = 0; i < 500; i++) accept({ ...MEAL, food_name: `meal ${i}` }, i);
    // Long after the window, the very first signature is accepted again, which
    // is only true if its entry was swept rather than retained.
    expect(accept({ ...MEAL, food_name: 'meal 0' }, 10_000)).toBe(true);
  });

  it('honours a custom window', () => {
    const accept = makeDuplicateFilter({ windowMs: 100 });
    expect(accept(MEAL, 0)).toBe(true);
    expect(accept(MEAL, 50)).toBe(false);
    expect(accept(MEAL, 200)).toBe(true);
  });
});
