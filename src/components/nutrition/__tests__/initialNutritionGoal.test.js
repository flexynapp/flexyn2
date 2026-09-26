import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/db', () => ({ db: {} }));
vi.mock('@/api/supabaseClient', () => ({ supabase: {} }));

const { initialNutritionGoal } = await import('../NutritionOnboardingModal');

describe('initialNutritionGoal', () => {
  it('keeps a nutrition goal the user already chose', () => {
    expect(initialNutritionGoal({ nutrition_goal: 'maintain', fitness_goals_arr: ['lose'] })).toBe('maintain');
  });
  it('turns an onboarding fat loss goal into a cut', () => {
    expect(initialNutritionGoal({ fitness_goals_arr: ['strength', 'lose'] })).toBe('lose');
  });
  it('turns a muscle goal into a bulk', () => {
    expect(initialNutritionGoal({ fitness_goals: 'muscle' })).toBe('gain');
  });
  it('leaves anything else unpicked', () => {
    expect(initialNutritionGoal({ fitness_goals_arr: ['strength'] })).toBeNull();
    expect(initialNutritionGoal(undefined)).toBeNull();
  });
});
