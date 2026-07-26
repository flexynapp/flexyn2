import { describe, it, expect } from 'vitest';
import { activityEmoji } from '../CardioLogger';

describe('activityEmoji — gender-aware cardio figures', () => {
  it('returns female figures when the athlete picked female', () => {
    expect(activityEmoji('walking', 'female')).toBe('🚶‍♀️');
    expect(activityEmoji('running', 'female')).toBe('🏃‍♀️');
    expect(activityEmoji('cycling', 'female')).toBe('🚴‍♀️');
    expect(activityEmoji('swimming', 'female')).toBe('🏊‍♀️');
  });

  it('returns male figures for male', () => {
    expect(activityEmoji('running', 'male')).toBe('🏃‍♂️');
    expect(activityEmoji('swimming', 'male')).toBe('🏊‍♂️');
  });

  it('falls back to neutral for unset / other', () => {
    expect(activityEmoji('running', undefined)).toBe('🏃');
    expect(activityEmoji('cycling', 'other')).toBe('🚴');
    expect(activityEmoji('walking', null)).toBe('🚶');
  });
});
