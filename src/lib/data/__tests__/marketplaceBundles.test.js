// Seller-side bundle creation.
//
// Two things here are worth pinning rather than trusting to review:
//
//   1. `quoteBundle` is the number a seller decides on. It has to agree with
//      purchase_bundle exactly — sale rows only, GREATEST(1, ROUND(…)) — or
//      the dialog promises proceeds the RPC won't pay.
//   2. `createBundle`'s failure path. Creating a bundle is an insert followed
//      by N separate attach calls, and a partial result is worse than none:
//      purchase_bundle prices whatever it finds, so a bundle that attached 2
//      of 3 listings quietly sells the smaller set at the discount chosen for
//      the bigger one. The cleanup delete is what prevents that, and it is
//      invisible in the happy path — exactly the shape that rots unnoticed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const {
  quoteBundle, createBundle, cancelBundle, setListingBundle,
  BUNDLE_DISCOUNT_MAX,
} = await import('../marketplaceBundles');

const sale  = (asking_price) => ({ id: `s${asking_price}`, listing_type: 'sale', asking_price });
const trade = () => ({ id: 't1', listing_type: 'trade', asking_price: null });

// Chainable insert/delete mock. `deletes` records every .delete() chain's
// final filter set so a test can assert the cleanup actually targeted the
// bundle it created.
function mockTable({ insertResult, deleteError = null, deletes }) {
  return () => ({
    insert: () => ({ select: () => ({ single: async () => insertResult }) }),
    delete: () => {
      const filters = {};
      const chain = {
        eq: (col, val) => { filters[col] = val; return chain; },
        then: (resolve) => { deletes?.push(filters); return resolve({ error: deleteError }); },
      };
      return chain;
    },
  });
}

beforeEach(() => { rpc.mockReset(); from.mockReset(); });

describe('quoteBundle', () => {
  it('discounts the sale total and reports what the seller gives up', () => {
    expect(quoteBundle([sale(100), sale(100)], 25))
      .toEqual({ total: 200, price: 150, sellerReceives: 150, givenUp: 50 });
  });

  it('sellerReceives EQUALS the buyer price — the seller funds the discount', () => {
    // This is the whole economics change in mig 320. Before it, the seller
    // received `total` and the difference was minted.
    const q = quoteBundle([sale(400), sale(600)], 50);
    expect(q.price).toBe(500);
    expect(q.sellerReceives).toBe(q.price);
    expect(q.givenUp).toBe(500);
  });

  it('ignores trade listings, which the RPC never charges for', () => {
    expect(quoteBundle([sale(200), trade()], 10).total).toBe(200);
  });

  it('floors at 1 coin like GREATEST(1, …)', () => {
    expect(quoteBundle([sale(1)], BUNDLE_DISCOUNT_MAX).price).toBe(1);
  });

  it('handles an empty selection without producing NaN', () => {
    expect(quoteBundle([], 25)).toEqual({ total: 0, price: 1, sellerReceives: 1, givenUp: 0 });
  });
});

describe('createBundle — validation', () => {
  const base = { title: 'Pack', discountPct: 25, sellerUserId: 'u1', listingIds: ['a', 'b'] };

  it('refuses a bundle of one', async () => {
    await expect(createBundle({ ...base, listingIds: ['a'] })).rejects.toThrow('bundle_needs_two');
  });

  it('refuses duplicate ids that would collapse below the minimum', async () => {
    await expect(createBundle({ ...base, listingIds: ['a', 'a'] })).rejects.toThrow('bundle_needs_two');
  });

  it('refuses a discount outside the schema CHECK', async () => {
    await expect(createBundle({ ...base, discountPct: 0 }))
      .rejects.toThrow('bundle_discount_out_of_range');
    await expect(createBundle({ ...base, discountPct: 76 }))
      .rejects.toThrow('bundle_discount_out_of_range');
  });

  it('refuses an empty title', async () => {
    await expect(createBundle({ ...base, title: '   ' })).rejects.toThrow('title required');
  });

  it('never touches the network when validation fails', async () => {
    await expect(createBundle({ ...base, listingIds: ['a'] })).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('createBundle — attach sequence', () => {
  it('attaches every listing through set_listing_bundle, not a raw update', async () => {
    from.mockImplementation(mockTable({ insertResult: { data: { id: 'b1' }, error: null } }));
    rpc.mockResolvedValue({ error: null });

    await createBundle({ title: 'Pack', discountPct: 25, sellerUserId: 'u1', listingIds: ['a', 'b'] });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, 'set_listing_bundle', { p_listing_id: 'a', p_bundle_id: 'b1' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'set_listing_bundle', { p_listing_id: 'b', p_bundle_id: 'b1' });
  });

  it('deletes the bundle when an attach fails, so no half-formed bundle sells', async () => {
    const deletes = [];
    from.mockImplementation(mockTable({ insertResult: { data: { id: 'b1' }, error: null }, deletes }));
    rpc
      .mockResolvedValueOnce({ error: null })                              // 'a' attaches
      .mockResolvedValueOnce({ error: { message: 'not_your_listing' } });  // 'b' does not

    await expect(createBundle({
      title: 'Pack', discountPct: 25, sellerUserId: 'u1', listingIds: ['a', 'b'],
    })).rejects.toMatchObject({ message: 'not_your_listing' });

    // One delete, aimed at the bundle just created. bundle_id is
    // ON DELETE SET NULL, so this also unlinks 'a' — which is why there is
    // no second call to detach it by hand.
    expect(deletes).toEqual([{ id: 'b1' }]);
  });

  it('surfaces the insert error and attaches nothing', async () => {
    from.mockImplementation(mockTable({ insertResult: { data: null, error: { message: 'boom' } } }));
    await expect(createBundle({
      title: 'Pack', discountPct: 25, sellerUserId: 'u1', listingIds: ['a', 'b'],
    })).rejects.toMatchObject({ message: 'boom' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('cancelBundle', () => {
  it('deletes only an ACTIVE bundle — a completed one is a sale record', async () => {
    const deletes = [];
    from.mockImplementation(mockTable({ insertResult: null, deletes }));
    await cancelBundle('b1');
    expect(deletes).toEqual([{ id: 'b1', status: 'active' }]);
  });

  it('is a no-op without an id', async () => {
    await cancelBundle(null);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('setListingBundle', () => {
  it('passes null through to detach', async () => {
    rpc.mockResolvedValue({ error: null });
    await setListingBundle('l1', null);
    expect(rpc).toHaveBeenCalledWith('set_listing_bundle', { p_listing_id: 'l1', p_bundle_id: null });
  });
});
