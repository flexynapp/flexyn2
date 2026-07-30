// Tests for src/lib/equipmentCatalog.js — the controlled vocabulary and
// exercise→implement mapping behind the equipment picker.
//
// The load-bearing test here is `implementTypeForExercise`: Phase 0 found
// classifyEquipment() is wrong on ~25 of the exercises that matter most
// (every Lat Pulldown variant, Machine/Cable Crunch, Assisted Pull-Up,
// Barbell Hack Squat). Those specific cases are asserted below so a
// future refactor can't quietly reintroduce them.

import { describe, it, expect } from 'vitest';
import {
  BRAND_META, BRAND_SLUGS, brandLabel,
  IMPLEMENT_TYPE_META, IMPLEMENT_TYPE_SLUGS, implementTypeLabel,
  SEED_MODELS, seedModelsForType,
  implementTypeForExercise, hasImplementPicker, implementLabel,
} from '../equipmentCatalog';
import { classifyEquipment } from '../exerciseEquipment';

// Every value classifyEquipment() is documented to return.
const VALID_KINDS = [
  'barbell', 'dumbbell', 'cable', 'machine', 'bodyweight',
  'kettlebell', 'band', 'cardio', 'other',
];

describe('vocabulary consistency', () => {
  it('every implement type maps to a kind classifyEquipment can return', () => {
    for (const [slug, meta] of Object.entries(IMPLEMENT_TYPE_META)) {
      expect(VALID_KINDS, `${slug} has kind "${meta.kind}"`).toContain(meta.kind);
    }
  });

  it('every seed model references a known brand', () => {
    for (const m of SEED_MODELS) {
      expect(BRAND_SLUGS, `model ${m.line || m.model} brand`).toContain(m.brand);
    }
  });

  it('every seed model references known implement types', () => {
    for (const m of SEED_MODELS) {
      expect(Array.isArray(m.types) && m.types.length > 0).toBe(true);
      for (const t of m.types) {
        expect(IMPLEMENT_TYPE_SLUGS, `${m.brand}/${m.line} type "${t}"`).toContain(t);
      }
    }
  });

  it('brand parents point at real brands', () => {
    for (const [slug, meta] of Object.entries(BRAND_META)) {
      if (meta.parent) {
        expect(BRAND_SLUGS, `${slug}.parent`).toContain(meta.parent);
      }
    }
  });

  it('keeps the "other" and "unknown" escape hatches', () => {
    expect(BRAND_META.other).toBeTruthy();
    expect(BRAND_META.unknown).toBeTruthy();
  });

  it('degrades unknown slugs instead of throwing', () => {
    expect(brandLabel('not_a_brand')).toBe('not a brand');
    expect(implementTypeLabel('not_a_type')).toBe('not a type');
    expect(brandLabel(undefined)).toBe('');
    expect(implementTypeLabel(null)).toBe('');
  });
});

describe('implementTypeForExercise — the classifyEquipment misses', () => {
  // These are the whole reason this module exists. Each case is one
  // classifyEquipment() got wrong; the second column is what the picker
  // must actually show.
  const corrections = [
    // Fell to 'other' — the dropdown would have been hidden entirely.
    ['Close-Grip Lat Pulldown',             'lat_pulldown'],
    ['Lat Pulldown With Neutral Grip',      'lat_pulldown'],
    ['Lat Pulldown With Pronated Grip',     'lat_pulldown'],
    ['Lat Pulldown With Supinated Grip',    'lat_pulldown'],
    ['Neutral Close-Grip Lat Pulldown',     'lat_pulldown'],
    ['One-Handed Lat Pulldown',             'lat_pulldown'],
    ['Straight Arm Lat Pulldown',           'lat_pulldown'],
    ['Rope Pulldown',                       'cable_station'],
    ['Tricep Pushdown With Bar',            'cable_station'],
    ['Tricep Pushdown With Rope',           'cable_station'],
    ['Face Pull',                           'cable_station'],
    ['Pallof Press',                        'cable_station'],
    ['T-Bar Row',                           't_bar_row'],
    ['Back Extension',                      'back_extension'],
    ['Reverse Hyperextension',              'reverse_hyper'],
    ['Glute Ham Raise',                     'ghd'],
    ['Hip Thrust',                          'hip_thrust'],
    ['Seated Calf Raise',                   'calf_seated'],
    ['Standing Calf Raise',                 'calf_standing'],
    ['Donkey Calf Raise',                   'calf_standing'],
    ['Stationary Bike',                     'bike'],
    // Fell to 'bodyweight' because that pattern is tested first.
    ['Machine Crunch',                      'ab_crunch'],
    ['Cable Crunch',                        'cable_station'],
    ['Assisted Dip',                        'assist_dip_pull'],
    ['Assisted Pull-Up',                    'assist_dip_pull'],
    ['Assisted Chin-Up',                    'assist_dip_pull'],
  ];

  it.each(corrections)('%s → %s', (name, expected) => {
    expect(implementTypeForExercise(name)).toBe(expected);
  });

  it('does not treat barbell hack squats as the hack squat machine', () => {
    expect(implementTypeForExercise('Barbell Hack Squat')).toBe('barbell');
    expect(implementTypeForExercise('Landmine Hack Squat')).toBe('barbell');
    // ...but the actual machine still resolves.
    expect(implementTypeForExercise('Hack Squat Machine')).toBe('hack_squat');
  });

  it('does not offer a picker for non-machine leg curls', () => {
    expect(implementTypeForExercise('Bodyweight Leg Curl')).toBeNull();
    expect(implementTypeForExercise('Leg Curl On Ball')).toBeNull();
    // The machine variants do.
    expect(implementTypeForExercise('Seated Leg Curl')).toBe('leg_curl_seated');
    expect(implementTypeForExercise('Lying Leg Curl')).toBe('leg_curl_lying');
  });

  it('proves these were genuinely wrong before (guards the premise)', () => {
    // If classifyEquipment is ever fixed upstream this test fails loudly,
    // which is the signal to revisit whether this module still needs the
    // override table.
    expect(classifyEquipment('Close-Grip Lat Pulldown')).toBe('other');
    expect(classifyEquipment('Machine Crunch')).toBe('bodyweight');
    expect(classifyEquipment('Assisted Pull-Up')).toBe('bodyweight');
    expect(classifyEquipment('Barbell Hack Squat')).toBe('machine');
  });
});

describe('implementTypeForExercise — ordinary cases', () => {
  const cases = [
    ['Leg Press',                 'leg_press'],
    ['Vertical Leg Press',        'leg_press'],
    ['Pec Deck',                  'pec_deck'],
    ['Machine Chest Press',       'chest_press'],
    ['Smith Machine Squat',       'smith_machine'],
    ['Hip Abduction Machine',     'abductor'],
    ['Hip Adduction Machine',     'adductor'],
    ['Seated Machine Row',        'seated_row'],
    ['Cable Chest Press',         'cable_station'],
    ['Dumbbell Curl',             'dumbbell'],
    ['Barbell Row',               'barbell'],
    ['Kettlebell Swing',          'kettlebell'],
    ['Band Pull-Apart',           'band'],
    ['Trap Bar Deadlift With High Handles', 'trap_bar'],
    ['EZ Bar Lying Triceps Extension',      'ez_bar'],
    ['One-Arm Landmine Press',    'landmine'],
  ];

  it.each(cases)('%s → %s', (name, expected) => {
    expect(implementTypeForExercise(name)).toBe(expected);
  });

  it('hides the picker for pure bodyweight work', () => {
    for (const name of ['Push-Up', 'Plank', 'Pull-Up', 'Air Squat', 'Sit-Up']) {
      expect(hasImplementPicker(name), name).toBe(false);
    }
  });

  it('shows the picker for anything with a nameable implement', () => {
    for (const name of ['Leg Press', 'Dumbbell Curl', 'Barbell Row', 'Cable Crunch']) {
      expect(hasImplementPicker(name), name).toBe(true);
    }
  });

  it('handles empty and malformed input', () => {
    expect(implementTypeForExercise('')).toBeNull();
    expect(implementTypeForExercise(null)).toBeNull();
    expect(implementTypeForExercise(undefined)).toBeNull();
    expect(hasImplementPicker('')).toBe(false);
  });

  it('is stable across repeated calls (cache correctness)', () => {
    const first  = implementTypeForExercise('Close-Grip Lat Pulldown');
    const second = implementTypeForExercise('Close-Grip Lat Pulldown');
    expect(first).toBe(second);
    expect(first).toBe('lat_pulldown');
  });
});

describe('seedModelsForType', () => {
  it('finds the plate-loaded leg presses', () => {
    const models = seedModelsForType('leg_press');
    expect(models.length).toBeGreaterThan(5);
    expect(models.some(m => m.model === 'Super Squat Press')).toBe(true);
  });

  it('finds adjustable dumbbells for home users', () => {
    const models = seedModelsForType('dumbbell_adj');
    expect(models.some(m => m.brand === 'bowflex' && m.model === '552')).toBe(true);
    expect(models.some(m => m.brand === 'powerblock')).toBe(true);
  });

  it('records non-linear increments where we verified them', () => {
    const bowflex552 = SEED_MODELS.find(m => m.brand === 'bowflex' && m.model === '552');
    // Phase 5 feeds this to progressiveOverload so it suggests a load
    // the user can actually select on the handle.
    expect(bowflex552.increments).toMatch(/2\.5/);
    expect(bowflex552.maxLb).toBe(52.5);
  });

  it('returns empty for unknown or missing types', () => {
    expect(seedModelsForType('not_a_type')).toEqual([]);
    expect(seedModelsForType(null)).toEqual([]);
  });

  it('marks adjustable implements so overload logic can find them', () => {
    expect(IMPLEMENT_TYPE_META.dumbbell_adj.adjustable).toBe(true);
    expect(IMPLEMENT_TYPE_META.dumbbell.adjustable).toBeUndefined();
  });
});

describe('implementLabel', () => {
  it('builds the full brand + line + model string', () => {
    expect(implementLabel({
      brand: 'hammer_strength', line: 'Plate Loaded', model: 'Super Squat Press',
    })).toBe('Hammer Strength Plate Loaded Super Squat Press');
  });

  it('omits missing parts', () => {
    expect(implementLabel({ brand: 'life_fitness', line: 'Insignia Series' }))
      .toBe('Life Fitness Insignia Series');
    expect(implementLabel({ brand: 'bowflex', line: 'SelectTech', model: '552' }))
      .toBe('Bowflex SelectTech 552');
  });

  it('falls back to the implement type when the brand is unknown', () => {
    expect(implementLabel({ brand: 'unknown', implementType: 'leg_press' }))
      .toBe('Leg press');
    expect(implementLabel({ brand: 'other', implementType: 'lat_pulldown' }))
      .toBe('Lat pulldown');
    expect(implementLabel({ implementType: 'pec_deck' }))
      .toBe('Pec deck / chest fly');
  });

  it('survives an empty object', () => {
    expect(implementLabel({})).toBe('');
    expect(implementLabel()).toBe('');
  });
});
