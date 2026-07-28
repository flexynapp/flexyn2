// Tests for the collection model — catalog ∪ inventory → completion.
//
// The arithmetic here is what the user reads as "you have 14 of 62". Two
// of these cases guard against ways that number can silently lie: an item
// whose rarity isn't on the ladder vanishing from the denominator, and the
// "Owned only" filter collapsing the denominator so every tier reports
// complete.

import { describe, it, expect } from 'vitest';
import {
  COLLECTION_TABS, RARITY_ORDER,
  catalogFor, ownershipFrom, buildCollection, overallCompletion,
} from '../collection';
import { ITEMS, BRANDED_ITEMS } from '../lootCatalog';

const noOwnership = ownershipFrom([]);

describe('catalogFor', () => {
  it('covers every declared tab', () => {
    for (const tab of COLLECTION_TABS) {
      expect(catalogFor(tab.id).length).toBeGreaterThan(0);
    }
  });

  it('returns nothing for an unknown tab rather than throwing', () => {
    expect(catalogFor('nope')).toEqual([]);
  });

  it('EXCLUDES capsules — they are consumables, so a permanently-unowned slot would put 100% out of reach', () => {
    const ids = catalogFor('stickers').map(i => i.id);
    const capsuleIds = ITEMS.filter(i => i.type === 'capsule').map(i => i.id);
    expect(capsuleIds.length).toBeGreaterThan(0);
    for (const id of capsuleIds) expect(ids).not.toContain(id);
  });

  it('INCLUDES branded items — the old Item Index listed ITEMS only, so the whole Daily Drop catalog was missing', () => {
    const ids = catalogFor('stickers').map(i => i.id);
    const brandedStickers = BRANDED_ITEMS.filter(i => i.type === 'sticker');
    expect(brandedStickers.length).toBeGreaterThan(0);
    for (const b of brandedStickers) expect(ids).toContain(b.id);
  });

  it('routes branded titles and frames to their own tabs', () => {
    const brandedTitle = BRANDED_ITEMS.find(i => i.type === 'title');
    const brandedFrame = BRANDED_ITEMS.find(i => i.type === 'frame');
    if (brandedTitle) expect(catalogFor('titles').map(i => i.id)).toContain(brandedTitle.id);
    if (brandedFrame) expect(catalogFor('frames').map(i => i.id)).toContain(brandedFrame.id);
  });

  it('dedupes by id', () => {
    for (const tab of COLLECTION_TABS) {
      const ids = catalogFor(tab.id).map(i => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('ownershipFrom', () => {
  it('handles null/empty input', () => {
    expect(ownershipFrom(null).owned.size).toBe(0);
    expect(ownershipFrom([]).variants.size).toBe(0);
  });

  it('collapses duplicate rows of the same item into one owned entry', () => {
    const { owned } = ownershipFrom([
      { item_id: 'stk_fire' }, { item_id: 'stk_fire' }, { item_id: 'stk_star' },
    ]);
    expect(owned.size).toBe(2);
  });

  it('collects the distinct variants owned per item', () => {
    const { variants } = ownershipFrom([
      { item_id: 'stk_fire', variant: 'foil' },
      { item_id: 'stk_fire', variant: 'gold' },
      { item_id: 'stk_fire', variant: 'foil' },
      { item_id: 'stk_star', variant: null },
    ]);
    expect(Array.from(variants.get('stk_fire')).sort()).toEqual(['foil', 'gold']);
    expect(variants.has('stk_star')).toBe(false);
  });

  it('skips rows with no item_id instead of creating an undefined entry', () => {
    const { owned } = ownershipFrom([{ item_id: null }, { variant: 'foil' }, { item_id: 'stk_fire' }]);
    expect(Array.from(owned)).toEqual(['stk_fire']);
  });
});

describe('buildCollection', () => {
  it('reports 0% owned for an empty inventory, with a non-zero total', () => {
    const c = buildCollection('stickers', noOwnership);
    expect(c.total).toBeGreaterThan(0);
    expect(c.owned).toBe(0);
    expect(c.pct).toBe(0);
  });

  it('marks owned items and counts them', () => {
    const first = catalogFor('stickers')[0];
    const c = buildCollection('stickers', ownershipFrom([{ item_id: first.id }]));
    expect(c.owned).toBe(1);
    const found = c.groups.flatMap(g => g.items).find(i => i.id === first.id);
    expect(found.owned).toBe(true);
  });

  it('surfaces owned variants on the slot', () => {
    const first = catalogFor('stickers')[0];
    const c = buildCollection('stickers',
      ownershipFrom([{ item_id: first.id, variant: 'gold' }]));
    const found = c.groups.flatMap(g => g.items).find(i => i.id === first.id);
    expect(found.ownedVariants).toEqual(['gold']);
  });

  it('orders rarity groups common-first along the ladder', () => {
    const c = buildCollection('stickers', noOwnership);
    const seen = c.groups.map(g => g.rarity);
    const expected = RARITY_ORDER.filter(r => seen.includes(r));
    expect(seen).toEqual(expected);
  });

  it('keeps the FULL tier in the denominator under "owned only" — otherwise every tier reads as complete', () => {
    const first = catalogFor('stickers')[0];
    const ownership = ownershipFrom([{ item_id: first.id }]);
    const all  = buildCollection('stickers', ownership);
    const only = buildCollection('stickers', ownership, { ownedOnly: true });

    expect(only.total).toBe(all.total);
    expect(only.owned).toBe(all.owned);
    // …but the rendered items ARE narrowed.
    expect(only.groups.flatMap(g => g.items).every(i => i.owned)).toBe(true);
    expect(only.groups.flatMap(g => g.items).length).toBe(1);

    const tier = only.groups[0];
    expect(tier.total).toBeGreaterThanOrEqual(tier.items.length);
  });

  it('every group total sums to the catalog total — nothing falls out of the denominator', () => {
    for (const tab of COLLECTION_TABS) {
      const c = buildCollection(tab.id, noOwnership);
      const summed = c.groups.reduce((n, g) => n + g.total, 0);
      expect(summed).toBe(c.total);
    }
  });

  it('rounds pct and reaches 100 when everything is owned', () => {
    const ids = catalogFor('themes').map(i => i.id);
    const c = buildCollection('themes', ownershipFrom(ids.map(id => ({ item_id: id }))));
    expect(c.pct).toBe(100);
    expect(c.owned).toBe(c.total);
  });

  it('returns an empty, non-throwing result for an unknown tab', () => {
    const c = buildCollection('nope', noOwnership);
    expect(c).toEqual({ groups: [], owned: 0, total: 0, pct: 0 });
  });
});

describe('overallCompletion', () => {
  it('sums every tab', () => {
    const overall = overallCompletion(noOwnership);
    const summed = COLLECTION_TABS
      .reduce((n, t) => n + buildCollection(t.id, noOwnership).total, 0);
    expect(overall.total).toBe(summed);
    expect(overall.owned).toBe(0);
    expect(overall.pct).toBe(0);
  });

  it('counts ownership across tabs, not just the first one', () => {
    const sticker = catalogFor('stickers')[0];
    const theme   = catalogFor('themes')[0];
    const overall = overallCompletion(
      ownershipFrom([{ item_id: sticker.id }, { item_id: theme.id }]));
    expect(overall.owned).toBe(2);
  });
});
