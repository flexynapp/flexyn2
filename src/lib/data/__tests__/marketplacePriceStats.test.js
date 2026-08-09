// Tests for priceStatsForItem in src/lib/data/marketplace.js.
//
// This powers the "what does this go for?" block on the item detail sheet and
// the suggested price when listing, so a wrong number here is not a visible
// failure — it is a seller confidently pricing against a figure nobody paid.
// The mock asserts on the QUERY SHAPE for that reason: the bundle exclusion is
// a filter, and a missing filter returns rows rather than an error.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (...args) => fromSpy(...args) },
}));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const { priceStatsForItem } = await import('../marketplace');

/**
 * Chainable stub that records every filter applied, so a test can assert on
 * the whole predicate rather than on whichever link it happened to stop at.
 */
function mockQuery(rows) {
  const calls = { eq: [], is: [], not: [], order: [], limit: [] };
  const chain = {
    select: () => chain,
    eq:    (...a) => { calls.eq.push(a);    return chain; },
    is:    (...a) => { calls.is.push(a);    return chain; },
    not:   (...a) => { calls.not.push(a);   return chain; },
    order: (...a) => { calls.order.push(a); return chain; },
    limit: (...a) => { calls.limit.push(a); return Promise.resolve({ data: rows, error: null }); },
  };
  fromSpy.mockReturnValue(chain);
  return calls;
}

beforeEach(() => fromSpy.mockReset());

describe('priceStatsForItem — what it asks the server for', () => {
  it('excludes bundled sales', async () => {
    // A bundle charges a discounted basket price while each listing still
    // records its full asking_price, so including them inflates the median by
    // the discount — most for whatever gets bundled most often.
    const calls = mockQuery([{ asking_price: 100, created_at: 'x' }]);
    await priceStatsForItem('sticker_a');
    expect(calls.is).toContainEqual(['bundle_id', null]);
  });

  it('counts only completed standalone sales', async () => {
    const calls = mockQuery([{ asking_price: 100, created_at: 'x' }]);
    await priceStatsForItem('sticker_a');
    expect(fromSpy).toHaveBeenCalledWith('marketplace_listings');
    expect(calls.eq).toContainEqual(['item_id', 'sticker_a']);
    expect(calls.eq).toContainEqual(['status', 'completed']);
    expect(calls.eq).toContainEqual(['listing_type', 'sale']);
    expect(calls.not).toContainEqual(['asking_price', 'is', null]);
  });

  it('does not query at all without an item id', async () => {
    expect(await priceStatsForItem(null)).toBeNull();
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe('priceStatsForItem — the numbers it returns', () => {
  const stats = async (prices) => {
    mockQuery(prices.map(p => ({ asking_price: p, created_at: 'x' })));
    return priceStatsForItem('sticker_a');
  };

  it('returns null rather than an empty chart when nothing has sold', async () => {
    expect(await stats([])).toBeNull();
  });

  it('takes the middle value on an odd count', async () => {
    expect(await stats([10, 90, 50])).toMatchObject({ count: 3, median: 50, low: 10, high: 90 });
  });

  it('averages the middle pair on an even count', async () => {
    expect(await stats([10, 20, 30, 41])).toMatchObject({ median: 25, low: 10, high: 41 });
  });

  it('drops junk prices rather than letting them skew the median', async () => {
    // 0 and null are "no price", not "sold for nothing".
    expect(await stats([100, 0, 200, null])).toMatchObject({ count: 2, median: 150 });
  });

  it('keeps `recent` in the order the server returned, newest first', async () => {
    expect((await stats([30, 20, 10])).recent).toEqual([30, 20, 10]);
  });
});
