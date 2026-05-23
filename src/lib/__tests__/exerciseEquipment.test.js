// Tests for src/lib/exerciseEquipment.js — the name-regex classifier
// powering the exercise-picker equipment filter.

import { describe, it, expect } from 'vitest';
import { classifyEquipment, matchesEquipment, EQUIPMENT_FILTERS } from '../exerciseEquipment';

describe('classifyEquipment', () => {
  const cases = [
    ['Bench Press',                    'barbell'],
    ['Back Squat',                     'barbell'],
    ['Deadlift',                       'barbell'],
    ['Dumbbell Bench Press',           'dumbbell'],
    ['DB Row',                         'dumbbell'],
    ['Cable Lat Pulldown',             'cable'],
    ['Pulley Crossover',               'cable'],
    ['Leg Press',                      'machine'],
    ['Smith Machine Squat',            'machine'],
    ['Hack Squat',                     'machine'],
    ['Pull-Up',                        'bodyweight'],
    ['Pushup',                         'bodyweight'],
    ['Plank',                          'bodyweight'],
    ['Kettlebell Swing',               'kettlebell'],
    ['Band Pull-Apart',                'band'],
    ['Running',                        'cardio'],
    ['Treadmill Sprint',               'cardio'],
    ['Something Made Up',              'other'],
  ];
  for (const [name, expected] of cases) {
    it(`classifies "${name}" as ${expected}`, () => {
      expect(classifyEquipment(name)).toBe(expected);
    });
  }

  it('returns "other" for null / empty input', () => {
    expect(classifyEquipment(null)).toBe('other');
    expect(classifyEquipment('')).toBe('other');
    expect(classifyEquipment(undefined)).toBe('other');
  });
});

describe('matchesEquipment', () => {
  it('returns true for the "all" filter regardless of exercise', () => {
    expect(matchesEquipment('Bench Press',         'all')).toBe(true);
    expect(matchesEquipment('Anything goes here', 'all')).toBe(true);
  });

  it('returns true for missing/falsy filter', () => {
    expect(matchesEquipment('Bench Press', null)).toBe(true);
    expect(matchesEquipment('Bench Press', '')).toBe(true);
  });

  it('matches exact category', () => {
    expect(matchesEquipment('Bench Press',           'barbell')).toBe(true);
    expect(matchesEquipment('Dumbbell Bench Press',  'dumbbell')).toBe(true);
    expect(matchesEquipment('Pull-Up',               'bodyweight')).toBe(true);
  });

  it('rejects non-matching categories', () => {
    expect(matchesEquipment('Bench Press',          'dumbbell')).toBe(false);
    expect(matchesEquipment('Cable Lat Pulldown',   'barbell')).toBe(false);
  });
});

describe('EQUIPMENT_FILTERS', () => {
  it('exports a non-empty list with "all" first', () => {
    expect(Array.isArray(EQUIPMENT_FILTERS)).toBe(true);
    expect(EQUIPMENT_FILTERS[0].id).toBe('all');
    expect(EQUIPMENT_FILTERS.length).toBeGreaterThan(3);
  });
});
