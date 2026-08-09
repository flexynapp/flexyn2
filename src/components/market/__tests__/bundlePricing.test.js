// What a bundle card claims it costs.
//
// The card's number and the RPC's charge are computed in two different
// places, so the rule they have to agree on is worth pinning: purchase_bundle
// (mig 134) sums `status='active' AND listing_type='sale'`. The card used to
// sum whatever listings it was handed, trade rows included — which inflated
// the advertised price above the charge and drew trade items into the "what
// you get" row, where they read as part of the purchase.
//
// bundlePrice is exported precisely so the card and the feed's "Can afford"
// filter cannot drift; these tests are the definition both of them share.

import { describe, it, expect } from 'vitest';
import { bundlePrice } from '../BundleCard';

const bundle = (discount_pct = 10) => ({ id: 'b1', discount_pct });
const sale  = (asking_price) => ({ id: Math.random().toString(36).slice(2), listing_type: 'sale', asking_price });
const trade = () => ({ id: Math.random().toString(36).slice(2), listing_type: 'trade', asking_price: null });

describe('bundlePrice', () => {
  it('sums the sale listings and applies the discount', () => {
    expect(bundlePrice(bundle(10), [sale(100), sale(100)]))
      .toEqual({ total: 200, price: 180 });
  });

  it('IGNORES trade listings — the RPC never charges for them', () => {
    // With the trade row counted this returned a total of 200 and a price the
    // server would not honour.
    expect(bundlePrice(bundle(10), [sale(200), trade()]))
      .toEqual({ total: 200, price: 180 });
  });

  it('treats a null asking_price as 0 rather than producing NaN', () => {
    expect(bundlePrice(bundle(10), [sale(100), sale(null)]))
      .toEqual({ total: 100, price: 90 });
  });

  it('floors at 1 coin, matching the RPC\'s GREATEST(1, …)', () => {
    // A 75% discount (the schema's ceiling) on a 1-coin bundle rounds to 0;
    // the server clamps to 1, so the card must not advertise a free bundle.
    expect(bundlePrice(bundle(75), [sale(1)]).price).toBe(1);
  });

  it('rounds the same way the RPC does', () => {
    // ROUND(105 * 0.9) = 94.5 → 95 in Postgres and in JS Math.round.
    expect(bundlePrice(bundle(10), [sale(105)]).price).toBe(95);
  });

  it('survives an empty or missing listing set', () => {
    expect(bundlePrice(bundle(10), [])).toEqual({ total: 0, price: 1 });
    expect(bundlePrice(bundle(10), undefined)).toEqual({ total: 0, price: 1 });
  });
});
