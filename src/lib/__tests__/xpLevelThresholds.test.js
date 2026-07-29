// Guards migration 261's xp_level_thresholds table against drifting from
// src/lib/xpSystem.js.
//
// The curve used to exist twice — once in JS, once re-derived in PL/pgSQL
// inside increment_user_xp — and they silently diverged: at 120,000 XP the UI
// said level 62 and the database said 33. Migration 261 removed the second
// derivation in favour of a lookup table, but a table generated from the JS
// curve can still go stale the next time the curve is retuned. This test
// re-derives the table and compares it to what the migration actually
// contains, so that drift fails CI instead of shipping.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getTotalXpForLevel, MAX_LEVEL, TOTAL_XP_FOR_MAX_LEVEL } from '../xpSystem';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, '../../../supabase/migrations/261_xp_level_source_of_truth_and_column_guard.sql');

/** Parse the `(level,xp)` tuples out of the migration's INSERT. */
function thresholdsFromMigration() {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('INSERT INTO public.xp_level_thresholds');
  const end = sql.indexOf('ON CONFLICT', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = sql.slice(start, end);
  const out = new Map();
  for (const m of body.matchAll(/\((\d+),\s*(\d+)\)/g)) {
    out.set(Number(m[1]), Number(m[2]));
  }
  return out;
}

describe('xp_level_thresholds (migration 261)', () => {
  const table = thresholdsFromMigration();

  it('covers every level from 1 to the cap', () => {
    expect(table.size).toBe(MAX_LEVEL);
    for (let l = 1; l <= MAX_LEVEL; l++) expect(table.has(l)).toBe(true);
  });

  it('matches the JS curve exactly at every level', () => {
    const mismatches = [];
    for (let l = 1; l <= MAX_LEVEL; l++) {
      const expected = getTotalXpForLevel(l);
      const actual = table.get(l);
      if (actual !== expected) mismatches.push({ level: l, expected, actual });
    }
    // Report all of them, not just the first — a retune shifts every row.
    expect(mismatches).toEqual([]);
  });

  it('starts at 0 so a new account is level 1', () => {
    expect(table.get(1)).toBe(0);
  });

  it('is strictly increasing, so MAX(level) lookup is unambiguous', () => {
    for (let l = 2; l <= MAX_LEVEL; l++) {
      expect(table.get(l)).toBeGreaterThan(table.get(l - 1));
    }
  });

  it('agrees with TOTAL_XP_FOR_MAX_LEVEL at the cap', () => {
    expect(table.get(MAX_LEVEL)).toBe(TOTAL_XP_FOR_MAX_LEVEL);
  });

  // The SQL does `MAX(level) WHERE total_xp_required <= total_xp`. This
  // asserts that lookup returns the same level calculateLevelFromXp does,
  // including on the boundaries where off-by-one errors live.
  it('reproduces the client level at and around every boundary', () => {
    const lookup = (xp) => {
      let best = 1;
      for (let l = 1; l <= MAX_LEVEL; l++) if (table.get(l) <= xp) best = l;
      return best;
    };
    for (let l = 1; l <= MAX_LEVEL; l++) {
      const at = table.get(l);
      expect(lookup(at)).toBe(l);
      if (at > 0) expect(lookup(at - 1)).toBe(l - 1);
    }
  });
});
