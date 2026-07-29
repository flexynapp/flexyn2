import { describe, it, expect } from 'vitest';
import { SHOP_CATALOG, getCapsuleOdds, BEST_VALUE_SKU } from '../coinShop';
import { CAPSULE_ODDS } from '@/lib/lootCatalog';

describe('getCapsuleOdds', () => {
  it('returns null for non-capsule SKUs', () => {
    expect(getCapsuleOdds('streak_freeze')).toBeNull();
    expect(getCapsuleOdds('nope')).toBeNull();
  });

  it('derives epic+ and legendary+ from the loot catalog, not a second copy', () => {
    const odds = getCapsuleOdds('capsule_elite');
    const t = CAPSULE_ODDS.elite;
    expect(odds.epicPlus).toBeCloseTo(t.epic + t.legendary + t.animated, 10);
    expect(odds.legendaryPlus).toBeCloseTo(t.legendary + t.animated, 10);
  });

  it('ranks the three capsules in the order their prices imply', () => {
    const std = getCapsuleOdds('capsule_standard').epicPlus;
    const prem = getCapsuleOdds('capsule_premium').epicPlus;
    const elite = getCapsuleOdds('capsule_elite').epicPlus;
    expect(prem).toBeGreaterThan(std);
    expect(elite).toBeGreaterThan(prem);
  });

  // The Elite description used to claim "Guaranteed epic+" in all 15
  // languages. It is 30% epic-or-better and 10% plain common. Overstating
  // loot odds on a paid-currency item breaks App Store 3.1.1 and Google
  // Play's loot-box policy, so this asserts the claim can't come back.
  it('confirms no capsule actually guarantees epic+', () => {
    for (const sku of ['capsule_standard', 'capsule_premium', 'capsule_elite']) {
      expect(getCapsuleOdds(sku).epicPlus).toBeLessThan(1);
    }
  });
});

describe('BEST_VALUE_SKU', () => {
  it('picks the capsule with the lowest coin cost per expected epic+', () => {
    const costPerEpic = (sku) =>
      SHOP_CATALOG[sku].price / getCapsuleOdds(sku).epicPlus;
    const capsules = Object.values(SHOP_CATALOG)
      .filter(i => i.grants.type === 'capsule')
      .map(i => i.sku);
    const cheapest = capsules.reduce((a, b) =>
      costPerEpic(a) <= costPerEpic(b) ? a : b
    );
    expect(BEST_VALUE_SKU).toBe(cheapest);
  });

  it('resolves to an actual catalog SKU', () => {
    expect(SHOP_CATALOG[BEST_VALUE_SKU]).toBeDefined();
  });
});

describe('SHOP_CATALOG', () => {
  it('gives every SKU a rarity so the shop can colour it', () => {
    for (const item of Object.values(SHOP_CATALOG)) {
      expect(item.rarity).toBeTruthy();
    }
  });

  it('keeps prices positive and integral', () => {
    for (const item of Object.values(SHOP_CATALOG)) {
      expect(item.price).toBeGreaterThan(0);
      expect(Number.isInteger(item.price)).toBe(true);
    }
  });
});
