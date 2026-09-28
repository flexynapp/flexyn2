// ensureStarterRegimen runs at the end of onboarding and must never give a
// user a second starter plan. When the "do you already have regimens?" read
// failed it used to assume "no" and create one anyway, so a returning user
// whose read hiccuped got a duplicate beside the plans they already had.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const list = vi.fn();
const create = vi.fn();
vi.mock('@/lib/data/regimens', () => ({ list: (...a) => list(...a), create: (...a) => create(...a) }));

const { ensureStarterRegimen } = await import('@/lib/data/starterRegimen');

const user = { id: 'u1', email: 'a@b.co' };
const profile = { goals: ['strength'], daysCount: 3 };

beforeEach(() => {
  list.mockReset();
  create.mockReset();
  create.mockImplementation(async (p) => ({ id: 'r1', ...p }));
});

describe('ensureStarterRegimen', () => {
  it('creates a plan for someone with no regimens', async () => {
    list.mockResolvedValue([]);
    const made = await ensureStarterRegimen({ user, profile });
    expect(list).toHaveBeenCalledWith('u1', 1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(made.exercises.length).toBeGreaterThan(0);
  });

  it('creates nothing for someone who already has one', async () => {
    list.mockResolvedValue([{ id: 'old' }]);
    expect(await ensureStarterRegimen({ user, profile })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('throws and creates nothing when it cannot tell', async () => {
    list.mockRejectedValue(new Error('network'));
    await expect(ensureStarterRegimen({ user, profile })).rejects.toThrow('network');
    expect(create).not.toHaveBeenCalled();
  });

  it('does nothing without a user id', async () => {
    expect(await ensureStarterRegimen({ user: { email: 'a@b.co' }, profile })).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
