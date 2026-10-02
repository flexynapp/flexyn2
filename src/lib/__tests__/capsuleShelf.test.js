// The pure arithmetic behind the round 2 capsule screens. None of it decides
// what anybody gets (the server rolls, prices and credits); these pin that the
// screens describe what the server decided without inventing anything.

import { describe, it, expect } from 'vitest';
import {
  CAPSULE_TIERS, MAX_OPEN_AT_ONCE, tierShopItem, shelfByTier, defaultTier,
  nextOnShelf, oddsSegments, setTiers, stickerSet, setNumber, formatSetNo,
  copiesOf, catalogValue, askMultiple, shelfSlots, swapIntoCentre, shelfGeometry,
} from '@/lib/capsuleShelf';
import { SELL_PRICE, sellPriceFor } from '@/lib/sellPrice';
import { RARITY, CAPSULE_ODDS, findCatalogItem } from '@/lib/lootCatalog';
import { GLYPH_BY_ITEM, GLYPH_SYMBOLS, glyphFor } from '@/components/capsules/stickerGlyphs';
import { pityReading } from '@/components/capsules/PityMeter';
import { tierBlurb } from '@/components/capsules/words';

const row = (id, capsule_type, extra = {}) => ({ id, capsule_type, is_opened: false, ...extra });
const enT = (_k, english) => english;

describe('shelfByTier', () => {
  it('groups unopened rows by tier and skips opened ones', () => {
    const shelf = shelfByTier([
      row('a', 'elite'), row('b', 'standard'), row('c', 'premium'),
      row('d', 'elite', { is_opened: true }),
    ]);
    expect(shelf.elite.map(r => r.id)).toEqual(['a']);
    expect(shelf.premium.map(r => r.id)).toEqual(['c']);
    expect(shelf.standard.map(r => r.id)).toEqual(['b']);
  });

  it('parks an unknown tier under standard rather than dropping the row', () => {
    expect(shelfByTier([row('x', 'mystery')]).standard.map(r => r.id)).toEqual(['x']);
  });

  it('survives null input', () => {
    expect(shelfByTier(null)).toEqual({ standard: [], premium: [], elite: [] });
  });
});

describe('defaultTier', () => {
  it('shows the rarest tier the user can open', () => {
    expect(defaultTier(shelfByTier([row('a', 'standard'), row('b', 'premium')]))).toBe('premium');
  });
  it('falls back to standard, the cheapest to buy, on an empty shelf', () => {
    expect(defaultTier(shelfByTier([]))).toBe('standard');
  });
});

describe('nextOnShelf', () => {
  it('offers more of the same tier while any are left', () => {
    const shelf = shelfByTier([row('a', 'premium'), row('b', 'premium'), row('c', 'elite')]);
    expect(nextOnShelf(shelf, 'premium', 1)).toEqual({ tier: 'premium', rows: [shelf.premium[1]] });
  });

  it('moves to the rarest other tier when this one runs out', () => {
    const shelf = shelfByTier([row('a', 'standard'), row('b', 'premium'), row('c', 'elite')]);
    expect(nextOnShelf(shelf, 'elite', 1).tier).toBe('premium');
  });

  it('is null when the shelf will be empty', () => {
    const shelf = shelfByTier([row('a', 'standard')]);
    expect(nextOnShelf(shelf, 'standard', 1)).toBeNull();
  });

  it('never offers more than one open can run', () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(`s${i}`, 'standard'));
    const next = nextOnShelf(shelfByTier(rows), 'standard', MAX_OPEN_AT_ONCE);
    expect(next.rows).toHaveLength(MAX_OPEN_AT_ONCE);
    expect(next.rows[0].id).toBe('s10');
  });
});

describe('tierShopItem', () => {
  it('names a real shop SKU for every tier', () => {
    for (const tier of CAPSULE_TIERS) {
      const item = tierShopItem(tier);
      expect(item, tier).toBeTruthy();
      expect(item.price).toBeGreaterThan(0);
    }
  });
});

describe('oddsSegments', () => {
  it('reads the published table and drops tiers a capsule cannot drop', () => {
    const segs = oddsSegments('standard');
    expect(segs.map(s => s.rarity)).not.toContain('animated');
    expect(segs.find(s => s.rarity === 'epic').pct).toBe(1.8);
  });

  it('adds up to the whole bar', () => {
    for (const tier of CAPSULE_TIERS) {
      const total = oddsSegments(tier).reduce((n, s) => n + s.pct, 0);
      expect(total, tier).toBeCloseTo(100, 5);
    }
  });

  it('takes its colours from the rarity table, the one place purple is allowed', () => {
    for (const s of oddsSegments('elite')) expect(s.color).toBe(RARITY[s.rarity].color);
  });
});

describe('the tier blurbs say only what the odds support', () => {
  const rarePlus = (tier) => ['rare', 'epic', 'legendary', 'mythic', 'animated']
    .reduce((n, r) => n + (CAPSULE_ODDS[tier][r] ?? 0), 0);

  it('elite: "about two times in three"', () => {
    expect(tierBlurb(enT, 'elite')).toMatch(/two times in three/);
    expect(rarePlus('elite')).toBeGreaterThan(0.6);
    expect(rarePlus('elite')).toBeLessThan(0.7);
  });

  it('premium really is better than standard at rare and epic', () => {
    expect(rarePlus('premium')).toBeGreaterThan(rarePlus('standard'));
  });
});

describe('setTiers', () => {
  it('lists every rarity the set has, in sheet order, adding up to the set', () => {
    const tiers = setTiers(new Set());
    expect(tiers.map(t => t.rarity)).toEqual([...new Set(stickerSet().map(s => s.rarity))]);
    expect(tiers.reduce((n, t) => n + t.total, 0)).toBe(stickerSet().length);
    expect(tiers.every(t => t.owned === 0)).toBe(true);
  });
  it('counts owned stickers into their own rarity and ignores other items', () => {
    const set = stickerSet();
    const common = set.find(s => s.rarity === 'common');
    const rarest = set[set.length - 1];
    const tiers = setTiers(new Set([common.id, rarest.id, 'title_not_a_sticker']));
    expect(tiers.find(t => t.rarity === 'common').owned).toBe(1);
    expect(tiers.find(t => t.rarity === rarest.rarity).owned).toBe(1);
    expect(tiers.reduce((n, t) => n + t.owned, 0)).toBe(2);
  });
  it('treats a missing set as nothing owned', () => {
    expect(setTiers(undefined).every(t => t.owned === 0)).toBe(true);
  });
});

describe('the sticker set', () => {
  it('runs common to rarest and holds only stickers', () => {
    const set = stickerSet();
    expect(set.length).toBeGreaterThan(0);
    const order = Object.keys(RARITY);
    for (let i = 1; i < set.length; i++) {
      expect(order.indexOf(set[i].rarity)).toBeGreaterThanOrEqual(order.indexOf(set[i - 1].rarity));
    }
  });

  it('numbers an item by its place on the sheet', () => {
    const set = stickerSet();
    expect(setNumber(set[0].id)).toEqual({ no: 1, total: set.length });
    expect(setNumber('not_a_sticker')).toBeNull();
    expect(formatSetNo(3)).toBe('03');
    expect(formatSetNo(12)).toBe('12');
  });
});

describe('copiesOf / catalogValue / askMultiple', () => {
  it('counts copies of one item', () => {
    expect(copiesOf([{ item_id: 'a' }, { item_id: 'a' }, { item_id: 'b' }], 'a')).toBe(2);
    expect(copiesOf(null, 'a')).toBe(0);
  });

  it('returns null, not zero, for an item the catalog does not know', () => {
    expect(catalogValue('nope')).toBeNull();
  });

  it('only mentions the multiple when it is at least double', () => {
    expect(askMultiple(150, 100)).toBeNull();
    expect(askMultiple(250, 100)).toBe(2.5);
    expect(askMultiple(1234, 100)).toBe(12);
    expect(askMultiple(500, null)).toBeNull();
  });
});

describe('sellPriceFor', () => {
  it('pays half the rarity base value', () => {
    for (const [r, v] of Object.entries(RARITY)) {
      expect(SELL_PRICE[r]).toBe(Math.floor((v.baseCoins ?? 10) / 2));
      expect(sellPriceFor(r)).toBe(SELL_PRICE[r]);
    }
  });
  it('applies the variant multiplier and ignores an unknown variant', () => {
    expect(sellPriceFor('rare', 'nonsense')).toBe(SELL_PRICE.rare);
  });
});

describe('sticker glyphs', () => {
  it('maps only catalog items to glyphs that exist', () => {
    for (const [itemId, key] of Object.entries(GLYPH_BY_ITEM)) {
      expect(findCatalogItem(itemId), itemId).toBeTruthy();
      expect(GLYPH_SYMBOLS[key], key).toBeTruthy();
      expect(glyphFor(itemId)).toBe(key);
    }
  });
  it('returns null for an item the set did not draw, so the emoji shows', () => {
    expect(glyphFor('nope')).toBeNull();
    expect(glyphFor(null)).toBeNull();
  });
});

describe('pityReading', () => {
  it('reads the server counter against the server threshold', () => {
    expect(pityReading({ since_epic: 7, epic_at: 20 })).toEqual({ since: 7, at: 20, left: 13 });
  });
  it('never reads past the threshold or below zero', () => {
    expect(pityReading({ since_epic: 25, epic_at: 20 }).left).toBe(0);
    expect(pityReading({ since_epic: -3, epic_at: 20 }).since).toBe(0);
  });
  it('promises nothing without a server threshold', () => {
    expect(pityReading(null)).toBeNull();
    expect(pityReading({ since_epic: 3 })).toBeNull();
  });
});

describe('shelf arrangement', () => {
  it('puts the first pick in the middle, the rest in catalogue order', () => {
    expect(shelfSlots('elite')).toEqual(['standard', 'elite', 'premium']);
    expect(shelfSlots('standard')).toEqual(['premium', 'standard', 'elite']);
    expect(shelfSlots('nonsense')).toEqual(['premium', 'standard', 'elite']);
  });

  it('swaps a pick with the middle and leaves the third canister alone', () => {
    const start = ['standard', 'premium', 'elite'];
    expect(swapIntoCentre(start, 'elite')).toEqual(['standard', 'elite', 'premium']);
    expect(swapIntoCentre(start, 'standard')).toEqual(['premium', 'standard', 'elite']);
    expect(swapIntoCentre(start, 'premium')).toBe(start);
  });

  it('matches the old CSS clamps and keeps labels from overlapping', () => {
    for (const vh of [500, 667, 852, 932, 1400]) {
      const g = shelfGeometry(vh);
      expect(g.big).toBeGreaterThanOrEqual(160);
      expect(g.big).toBeLessThanOrEqual(226);
      const small = g.big * g.side;
      expect(small).toBeGreaterThanOrEqual(84 - 1e-9);
      expect(small).toBeLessThanOrEqual(111 + 1e-9);
      // A side canister clears the middle one by the 10px gap the shelf had.
      expect(g.offset - g.width / 2 - (g.width * g.side) / 2).toBeCloseTo(10);
      expect(g.labelOffset).toBeGreaterThanOrEqual(112);
    }
  });
});
