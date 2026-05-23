// Tests for src/lib/data/itemSoldCounts.js — bulk lookup + display
// formatter for the marketplace "Sold X times" counter (mig 119).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (...args) => fromSpy(...args) },
}));

const { countsFor, formatSoldCount } = await import('../itemSoldCounts');

beforeEach(() => fromSpy.mockReset());

describe('countsFor', () => {
  it('returns empty Map for empty / non-array input', async () => {
    expect((await countsFor(null)).size).toBe(0);
    expect((await countsFor([])).size).toBe(0);
    expect((await countsFor([undefined, null])).size).toBe(0);
  });

  it('de-dupes ids before the IN query', async () => {
    const inFn = vi.fn().mockResolvedValue({ data: [], error: null });
    fromSpy.mockReturnValue({ select: () => ({ in: inFn }) });
    await countsFor(['a', 'a', 'b']);
    expect(inFn).toHaveBeenCalledWith('item_id', ['a', 'b']);
  });

  it('returns a Map keyed by item_id', async () => {
    fromSpy.mockReturnValue({
      select: () => ({
        in: () => Promise.resolve({
          data: [
            { item_id: 'stk_fire',   sold_count: 27 },
            { item_id: 'stk_diamond', sold_count: 1 },
          ],
          error: null,
        }),
      }),
    });
    const m = await countsFor(['stk_fire', 'stk_diamond']);
    expect(m.get('stk_fire')).toBe(27);
    expect(m.get('stk_diamond')).toBe(1);
    expect(m.get('missing')).toBeUndefined();
  });

  it('returns empty Map on supabase error', async () => {
    fromSpy.mockReturnValue({
      select: () => ({ in: () => Promise.resolve({ data: null, error: { code: 'X' } }) }),
    });
    expect((await countsFor(['a'])).size).toBe(0);
  });
});

describe('formatSoldCount', () => {
  it('returns null for zero / negative / non-finite input', () => {
    expect(formatSoldCount(0)).toBeNull();
    expect(formatSoldCount(-3)).toBeNull();
    expect(formatSoldCount(NaN)).toBeNull();
    expect(formatSoldCount(undefined)).toBeNull();
  });

  it('renders sub-thousand counts verbatim', () => {
    expect(formatSoldCount(1)).toBe('1 sold');
    expect(formatSoldCount(27)).toBe('27 sold');
    expect(formatSoldCount(999)).toBe('999 sold');
  });

  it('renders 1k–10k counts to one decimal', () => {
    expect(formatSoldCount(1_000)).toBe('1k sold');
    expect(formatSoldCount(1_250)).toBe('1.3k sold');
    expect(formatSoldCount(9_999)).toBe('10k sold');
  });

  it('renders large counts as rounded k', () => {
    expect(formatSoldCount(12_345)).toBe('12k sold');
    expect(formatSoldCount(123_456)).toBe('123k sold');
  });
});
