// Exercise records tag muscle groups capitalised ('Legs'), and the cap table
// is keyed in camelCase. Every lookup used to miss and fall to the default 12.
import { describe, it, expect } from 'vitest';
import { getMuscleGroupCap } from '@/lib/workoutFatigue';

const lifter = { age: 26, gender: 'male' };

describe('getMuscleGroupCap reads the tags exercises actually carry', () => {
  it('matches capitalised groups to the table', () => {
    expect(getMuscleGroupCap('Legs', lifter)).toBe(16);
    expect(getMuscleGroupCap('Back', lifter)).toBe(14);
    expect(getMuscleGroupCap('Forearms', lifter)).toBe(8);
    expect(getMuscleGroupCap('FullBody', lifter)).toBe(20);
    expect(getMuscleGroupCap('legs', lifter)).toBe(16);
  });

  it('leaves cardio tagged lifts on the default rather than the floor', () => {
    expect(getMuscleGroupCap('Cardio', lifter)).toBe(12);
  });

  it('keeps the default for a group the table does not know', () => {
    expect(getMuscleGroupCap('Neck', lifter)).toBe(12);
  });
});
