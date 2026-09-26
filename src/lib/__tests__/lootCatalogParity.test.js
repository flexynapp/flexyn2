// Parity between the SQL loot_catalog seeded by migration 267 and the four
// client catalog modules.
//
// Migration 267 moved item selection server-side: the database picks the drop
// from loot_catalog and returns its id, and the client rehydrates that id for
// the presentation fields SQL doesn't carry (descriptions, theme preview
// colours, frame CSS). Two things can break that:
//
//   1. The seed drifts from the JS modules, so the server grants an id no
//      client bundle recognises and the reveal falls back to bare fields.
//   2. hydrateItemById fails to resolve an id that IS in the modules.
//
// Both are silent in production — the reveal still renders, just uglier — so
// they get asserted here instead.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ITEMS } from '../lootCatalog';
import { LOOT_THEMES } from '../lootThemes';
import { LOOT_TITLES } from '../lootTitles';
import { LOOT_FRAMES } from '../lootFrames';
import { hydrateItemById } from '../lootRoll';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, '../../../supabase/migrations_archive/267_loot_catalog_server_authority.sql');

/**
 * The capsule DROP POOL, flattened to the shape SQL stores.
 *
 * Mirrors lootRoll.pickItemForRoll, which is what the old client candidate
 * menu was built from — NOT the whole client catalog:
 *
 *   • BRANDED_ITEMS (flx_*) are the purchasable Daily Flexyn Drop.
 *     getItemsByRarity is documented "stickers only for drops" and filters
 *     ITEMS alone, so they have never been capsule loot. CapsuleOpener does
 *     fold them into the spinning reel for visual variety, which is exactly
 *     what makes this easy to conflate — the reel is not the pool.
 *   • cap_* items are type 'capsule', excluded by that same sticker filter.
 *
 * Seeding either into loot_catalog would silently turn purchase-only
 * cosmetics into free capsule drops, so this asymmetry is the assertion.
 */
function dropPool() {
  const out = new Map();
  const add = (arr, fallbackType) => {
    for (const it of arr || []) {
      if (!it?.id) continue;
      out.set(it.id, {
        name: it.name ?? it.id,
        emoji: it.emoji ?? '',
        type: it.type ?? fallbackType,
        rarity: it.rarity ?? 'common',
      });
    }
  };
  add(ITEMS.filter((i) => i.type === 'sticker'), 'sticker');
  add(LOOT_THEMES, 'theme');
  add(LOOT_TITLES, 'title');
  add(LOOT_FRAMES, 'frame');
  return out;
}

/** Parse the VALUES tuples out of the migration's seed INSERT. */
function seededCatalog() {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('INSERT INTO public.loot_catalog');
  const end = sql.indexOf('ON CONFLICT (item_id)', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = sql.slice(start, end);
  const re = /\('((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)'\)/g;
  const unq = (s) => s.replace(/''/g, "'");
  const out = new Map();
  for (const m of body.matchAll(re)) {
    out.set(unq(m[1]), { name: unq(m[2]), emoji: unq(m[3]), type: unq(m[4]), rarity: unq(m[5]) });
  }
  return out;
}

const client = dropPool();
const seeded = seededCatalog();

describe('loot_catalog seed parity (migration 267)', () => {
  it('seeds every item in the drop pool', () => {
    const missing = [...client.keys()].filter((id) => !seeded.has(id));
    expect(missing).toEqual([]);
  });

  it('seeds nothing outside the drop pool', () => {
    // Catches the mistake this test was written after: seeding BRANDED_ITEMS
    // would have made 38 purchase-only cosmetics droppable from capsules.
    const extra = [...seeded.keys()].filter((id) => !client.has(id));
    expect(extra).toEqual([]);
  });

  it('agrees on name, emoji, type and rarity for every item', () => {
    const diffs = [];
    for (const [id, c] of client) {
      const s = seeded.get(id);
      if (!s) continue;
      if (s.name !== c.name || s.emoji !== c.emoji || s.type !== c.type || s.rarity !== c.rarity) {
        diffs.push({ id, sql: s, js: c });
      }
    }
    expect(diffs).toEqual([]);
  });
});

describe('hydrateItemById', () => {
  it('resolves every rollable item when given its category', () => {
    const failed = [];
    for (const [id, c] of client) {
      const hit = hydrateItemById(id, c.type);
      if (!hit || hit.id !== id) failed.push(id);
    }
    expect(failed).toEqual([]);
  });

  // The recovery path may have a null rolled_category on older rows, so the
  // no-hint branch has to work too.
  it('resolves every rollable item with no category hint', () => {
    const failed = [];
    for (const [id, c] of client) {
      const hit = hydrateItemById(id);
      if (!hit || hit.id !== id) failed.push(id);
    }
    expect(failed).toEqual([]);
  });

  it('returns null for an unknown id rather than throwing', () => {
    expect(hydrateItemById('does_not_exist_anywhere')).toBeNull();
    expect(hydrateItemById('does_not_exist_anywhere', 'sticker')).toBeNull();
    expect(hydrateItemById(null)).toBeNull();
    expect(hydrateItemById(undefined, 'theme')).toBeNull();
  });
});

describe('branded items stay out of the pool', () => {
  it('seeds no flx_* item', () => {
    const branded = [...seeded.keys()].filter((id) => id.startsWith('flx_'));
    expect(branded).toEqual([]);
  });

  it('seeds no capsule item', () => {
    const caps = [...seeded.entries()].filter(([, v]) => v.type === 'capsule').map(([k]) => k);
    expect(caps).toEqual([]);
  });
});

describe('roll coverage', () => {
  // The SQL picker falls back category → sticker → any-of-rarity. That last
  // fallback must always find something, or an open would raise.
  it('has at least one item for every rarity the roller can produce', () => {
    const rollable = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'animated'];
    for (const rarity of rollable) {
      const n = [...seeded.values()].filter((v) => v.rarity === rarity && v.type !== 'capsule').length;
      expect(n, `no non-capsule items of rarity ${rarity}`).toBeGreaterThan(0);
    }
  });
});
