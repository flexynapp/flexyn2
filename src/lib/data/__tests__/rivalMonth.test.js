// Rival month (migration 20260927190000): the client only reads the server's
// count. The assertions that matter: the month is the user's LOCAL month (a
// "2026-09-01" string parsed as UTC would read as August 31 west of Greenwich),
// and a failed call hides the strip rather than showing "0 of 3".

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

const { getMyRivalMonth, RIVAL_MONTH_GOAL } = await import('@/lib/data/rivalMonth');

beforeEach(() => rpc.mockReset());

describe('getMyRivalMonth', () => {
  it('reads the month as a local date', async () => {
    rpc.mockResolvedValue({ data: { month: '2026-09-01', wins: 2, goal: 3 }, error: null });
    const m = await getMyRivalMonth();
    expect(rpc).toHaveBeenCalledWith('get_my_rival_month');
    expect([m.month.getFullYear(), m.month.getMonth(), m.month.getDate()]).toEqual([2026, 8, 1]);
    expect(m.wins).toBe(2);
    expect(m.goal).toBe(3);
  });

  it('is null on an error or an empty answer, so nothing renders', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await getMyRivalMonth()).toBeNull();
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getMyRivalMonth()).toBeNull();
  });

  it('clamps nonsense to safe values', async () => {
    rpc.mockResolvedValue({ data: { month: '2026-09-01', wins: -4, goal: 0 }, error: null });
    const m = await getMyRivalMonth();
    expect(m.wins).toBe(0);
    expect(m.goal).toBe(RIVAL_MONTH_GOAL);
  });
});
