// Tests for the marketplace filter/sort predicates.
//
// applyFilters is the single definition of "does this listing match", used
// by the grid, the result counter and the empty state. It's pure, so it's
// cheap to pin down — and two of the cases below (featured-first ordering,
// trade listings surviving the affordability filter) are behaviours that
// are easy to regress silently in the UI.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTERS, applyFilters, activeFilterCount,
} from '../MarketFilterBar';

const future = new Date(Date.now() + 86_400_000).toISOString();
const past   = new Date(Date.now() - 86_400_000).toISOString();

const listing = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  item_id: 'stk_fire',
  item_rarity: 'common',
  listing_type: 'sale',
  asking_price: 50,
  is_featured: false,
  featured_until: null,
  ...over,
});

const f = (over = {}) => ({ ...DEFAULT_FILTERS, ...over });

describe('activeFilterCount', () => {
  it('counts nothing for the defaults', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });

  it('ignores sort — sort reorders, it does not narrow', () => {
    expect(activeFilterCount(f({ sort: 'price-desc' }))).toBe(0);
  });

  it('counts type, rarity and affordability', () => {
    expect(activeFilterCount(f({ type: 'trade', rarities: ['epic'], affordable: true }))).toBe(3);
  });
});

describe('applyFilters — type', () => {
  it('passes everything through on the defaults', () => {
    const rows = [listing(), listing({ listing_type: 'trade' })];
    expect(applyFilters(rows, DEFAULT_FILTERS, 0)).toHaveLength(2);
  });

  it('narrows to sale listings', () => {
    const rows = [listing(), listing({ listing_type: 'trade' })];
    const out = applyFilters(rows, f({ type: 'sale' }), 0);
    expect(out).toHaveLength(1);
    expect(out[0].listing_type).toBe('sale');
  });
});

describe('applyFilters — rarity', () => {
  it('treats an empty rarity list as "any rarity"', () => {
    const rows = [listing({ item_rarity: 'epic' }), listing({ item_rarity: 'common' })];
    expect(applyFilters(rows, DEFAULT_FILTERS, 0)).toHaveLength(2);
  });

  it('ORs multiple selected rarities rather than ANDing them', () => {
    const rows = [
      listing({ item_rarity: 'epic' }),
      listing({ item_rarity: 'legendary' }),
      listing({ item_rarity: 'common' }),
    ];
    const out = applyFilters(rows, f({ rarities: ['epic', 'legendary'] }), 0);
    expect(out.map(l => l.item_rarity).sort()).toEqual(['epic', 'legendary']);
  });
});

describe('applyFilters — affordability', () => {
  it('drops sale listings priced above the balance', () => {
    const rows = [listing({ asking_price: 10 }), listing({ asking_price: 900 })];
    const out = applyFilters(rows, f({ affordable: true }), 100);
    expect(out).toHaveLength(1);
    expect(out[0].asking_price).toBe(10);
  });

  it('keeps the listing when the price exactly equals the balance', () => {
    const rows = [listing({ asking_price: 100 })];
    expect(applyFilters(rows, f({ affordable: true }), 100)).toHaveLength(1);
  });

  it('keeps TRADE listings — they cost no coins, so affordability cannot exclude them', () => {
    const rows = [
      listing({ listing_type: 'trade', asking_price: null }),
      listing({ asking_price: 900 }),
    ];
    const out = applyFilters(rows, f({ affordable: true }), 0);
    expect(out).toHaveLength(1);
    expect(out[0].listing_type).toBe('trade');
  });
});

describe('applyFilters — ordering', () => {
  it('floats live featured listings above the rest', () => {
    const rows = [
      listing({ id: 'plain', asking_price: 10 }),
      listing({ id: 'star', asking_price: 999, is_featured: true, featured_until: future }),
    ];
    expect(applyFilters(rows, f({ sort: 'price-asc' }), 0).map(l => l.id))
      .toEqual(['star', 'plain']);
  });

  it('does NOT float a featured listing whose window has expired', () => {
    const rows = [
      listing({ id: 'plain', asking_price: 10 }),
      listing({ id: 'stale', asking_price: 999, is_featured: true, featured_until: past }),
    ];
    expect(applyFilters(rows, f({ sort: 'price-asc' }), 0).map(l => l.id))
      .toEqual(['plain', 'stale']);
  });

  it('sorts by price ascending and descending', () => {
    const rows = [
      listing({ id: 'mid', asking_price: 50 }),
      listing({ id: 'low', asking_price: 5 }),
      listing({ id: 'high', asking_price: 500 }),
    ];
    expect(applyFilters(rows, f({ sort: 'price-asc' }), 0).map(l => l.id))
      .toEqual(['low', 'mid', 'high']);
    expect(applyFilters(rows, f({ sort: 'price-desc' }), 0).map(l => l.id))
      .toEqual(['high', 'mid', 'low']);
  });

  it('treats a null asking_price as 0 rather than dropping the row', () => {
    const rows = [
      listing({ id: 'trade', listing_type: 'trade', asking_price: null }),
      listing({ id: 'sale', asking_price: 5 }),
    ];
    expect(applyFilters(rows, f({ sort: 'price-asc' }), 0).map(l => l.id))
      .toEqual(['trade', 'sale']);
  });

  it('does not mutate the input array', () => {
    const rows = [listing({ id: 'a', asking_price: 9 }), listing({ id: 'b', asking_price: 1 })];
    const before = rows.map(l => l.id);
    applyFilters(rows, f({ sort: 'price-asc' }), 0);
    expect(rows.map(l => l.id)).toEqual(before);
  });
});
