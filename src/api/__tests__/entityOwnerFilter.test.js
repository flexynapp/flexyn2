// db.entities.X.filter() skips a condition whose value is null or undefined,
// which is right for an optional one like `date` and wrong for the owner key.
// A read for "my workouts" that runs before the user id has loaded used to go
// out with no filter at all and return every row the table's policies let the
// caller see. An empty owner key now means "no rows", with no request made.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const eq = vi.fn();
const from = vi.fn();

function chain() {
  const q = {
    select: () => q,
    eq: (...args) => { eq(...args); return q; },
    in: () => q,
    order: () => q,
    limit: () => Promise.resolve({ data: [{ id: 'row' }], error: null }),
  };
  return q;
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (...args) => { from(...args); return chain(); },
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  },
}));
vi.mock('@/lib/pushCleanup', () => ({ unsubscribePushOnLogout: vi.fn() }));
vi.mock('@/lib/data/users', () => ({ selectProfiles: vi.fn() }));

const { db } = await import('../db');

describe('entity filter owner keys', () => {
  beforeEach(() => { eq.mockReset(); from.mockReset(); });

  it.each([undefined, null, ''])('returns nothing for user_id %p without querying', async (v) => {
    const rows = await db.entities.WorkoutLog.filter({ user_id: v }, '-date', 50);
    expect(rows).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('treats an empty created_by the same way', async () => {
    const rows = await db.entities.Regimen.filter({ created_by: undefined });
    expect(rows).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('still skips an empty optional condition', async () => {
    const rows = await db.entities.CardioLog.filter({ user_id: 'u1', date: undefined });
    expect(rows).toEqual([{ id: 'row' }]);
    expect(eq.mock.calls).toEqual([['user_id', 'u1']]);
  });
});
