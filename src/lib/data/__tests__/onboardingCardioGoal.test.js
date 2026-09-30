import { describe, it, expect, vi, beforeEach } from 'vitest';

const list = vi.fn();
const create = vi.fn();
vi.mock('@/lib/data/goals', () => ({ list: (...a) => list(...a), create: (...a) => create(...a) }));

const { ensureOnboardingCardioGoal } = await import('@/lib/data/onboardingCardioGoal');

const user = { id: 'u1' };

describe('ensureOnboardingCardioGoal', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue([]);
    create.mockReset().mockImplementation(async (p) => p);
  });

  it('makes a race a single-run distance goal', async () => {
    const p = await ensureOnboardingCardioGoal({ user, goals: ['endurance'], sharpen: { cardioEvent: 'marathon' } });
    expect(list).toHaveBeenCalledWith('u1');
    expect(p).toMatchObject({
      goal_type: 'cardio_distance', target_distance_meters: 42195, period: 'lifetime', single_session: true,
    });
  });

  it('keeps general running as a weekly sessions goal', async () => {
    const p = await ensureOnboardingCardioGoal({ user, goals: ['speed'], sharpen: { cardioEvent: 'general' } });
    expect(p).toMatchObject({ goal_type: 'cardio_sessions', target_sessions: 3, period: 'week' });
    expect(p.single_session).toBeUndefined();
  });

  it('does not stack a second running goal', async () => {
    list.mockResolvedValue([{ goal_type: 'cardio_distance', cardio_activity: 'running', status: 'active' }]);
    const p = await ensureOnboardingCardioGoal({ user, goals: ['endurance'], sharpen: { cardioEvent: '5k' } });
    expect(p).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
