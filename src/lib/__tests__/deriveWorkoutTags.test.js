import { describe, it, expect } from 'vitest';
import { deriveWorkoutTags } from '../deriveWorkoutTags';

describe('deriveWorkoutTags', () => {
  it('names a push day', () => {
    expect(deriveWorkoutTags([
      { name: 'Bench', muscle_groups: ['Chest', 'Triceps'] },
      { name: 'OHP', muscle_groups: ['Shoulders'] },
    ])).toEqual(['push', 'chest', 'shoulders', 'triceps']);
  });

  it('names a pull day from sub muscles', () => {
    expect(deriveWorkoutTags([
      { name: 'Pulldown', muscle_groups: ['Lats'] },
      { name: 'Curl', muscle_group: 'Biceps' },
    ])).toEqual(['pull', 'back', 'biceps']);
  });

  it('calls legs plus several upper groups a full body day', () => {
    expect(deriveWorkoutTags([
      { name: 'Squat', muscle_groups: ['Quads', 'Glutes'] },
      { name: 'Bench', muscle_groups: ['Chest'] },
      { name: 'Row', muscle_groups: ['Back'] },
    ])[0]).toBe('full_body');
  });

  it('adds cardio and ignores exercises with no muscles', () => {
    expect(deriveWorkoutTags([{ name: 'Mystery' }, { kind: 'cardio', activity: 'running' }])).toEqual(['cardio']);
  });
});
