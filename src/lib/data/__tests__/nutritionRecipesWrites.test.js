// src/lib/data/__tests__/nutritionRecipesWrites.test.js
//
// The WRITE path, pinned as a statement sequence — because the previous
// version of this module used `.upsert(payload, { onConflict: 'id' })` and
// that shipped a production outage nothing else could see.
//
// PostgREST renders an upsert as
//
//     INSERT … ON CONFLICT (id) DO UPDATE SET <every payload column> =
//     excluded.<column>
//
// and reading `excluded.user_email` requires SELECT privilege on that column.
// Migration 352 revoked exactly that (Discover was handing out author emails),
// so every save started failing 42501 — while reads, plain inserts, the grant
// catalog and the whole test suite carried on looking clean. A save is the one
// thing a recipes screen exists to do, and nothing was watching it.
//
// So these tests assert the two properties that keep it working:
//   • a NEW recipe INSERTs and carries user_email (the column is NOT NULL
//     with no default)
//   • an EDIT UPDATEs and does NOT carry user_email — a recipe never changes
//     owner, and sending it is what reintroduces the excluded-read
//
// Plus: every read and write names its columns explicitly. `select('*')` on
// this table is the leak itself, so a bare star anywhere here should fail.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls = [];
let queue = [];
const stage = (...responses) => { queue = responses.map(r => ({ data: r ?? null, error: null })); };

function makeChain(table) {
  const rec = { table, op: 'select', payload: null, cols: null, filters: [], opts: null };
  calls.push(rec);
  const settle = () => queue.shift() ?? { data: null, error: null };
  const chain = {
    select: (cols) => { rec.cols = cols ?? '*'; return chain; },
    insert: (row) => { rec.op = 'insert'; rec.payload = row; return chain; },
    update: (patch) => { rec.op = 'update'; rec.payload = patch; return chain; },
    upsert: (row, opts) => { rec.op = 'upsert'; rec.payload = row; rec.opts = opts; return chain; },
    delete: () => { rec.op = 'delete'; return chain; },
    eq: (c, v) => { rec.filters.push(['eq', c, v]); return chain; },
    neq: (c, v) => { rec.filters.push(['neq', c, v]); return chain; },
    order: (c, o) => { rec.filters.push(['order', c, o]); return chain; },
    limit: (n) => { rec.filters.push(['limit', n]); return chain; },
    maybeSingle: async () => settle(),
    single: async () => settle(),
    then: (res, rej) => Promise.resolve(settle()).then(res, rej),
  };
  return chain;
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (table) => makeChain(table) },
}));

const recipes = await import('../nutritionRecipes');

const USER = { id: 'user-1', email: 'me@example.test' };
const INGREDIENTS = [{ name: 'Oats', amount: 100, unit: 'g', calories: 380, protein_g: 13 }];

beforeEach(() => { calls.length = 0; queue = []; });

describe('upsert — insert vs update', () => {
  it('a NEW recipe inserts, and carries user_email', async () => {
    stage({ id: 'r1' });
    await recipes.upsert({ user: USER, name: 'Oats', servings: 2, ingredients: INGREDIENTS });

    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe('insert');
    expect(calls[0].payload.user_email).toBe('me@example.test');
    expect(calls[0].payload.user_id).toBe('user-1');
  });

  it('an EDIT updates, and does NOT carry user_email', async () => {
    stage({ id: 'r1' });
    await recipes.upsert({ id: 'r1', user: USER, name: 'Oats v2', servings: 3, ingredients: INGREDIENTS });

    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe('update');
    // The whole point. user_email in an UPDATE payload becomes
    // `excluded.user_email` the moment anyone turns this back into an upsert.
    expect(calls[0].payload).not.toHaveProperty('user_email');
    // `id` is the WHERE key, not something to rewrite.
    expect(calls[0].payload).not.toHaveProperty('id');
    expect(calls[0].filters).toContainEqual(['eq', 'id', 'r1']);
    expect(calls[0].payload.name).toBe('Oats v2');
  });

  it('never uses upsert — ON CONFLICT DO UPDATE reads excluded.user_email', async () => {
    stage({ id: 'r1' }, { id: 'r1' });
    await recipes.upsert({ user: USER, name: 'A', servings: 1, ingredients: INGREDIENTS });
    await recipes.upsert({ id: 'r1', user: USER, name: 'B', servings: 1, ingredients: INGREDIENTS });

    expect(calls.map(c => c.op)).toEqual(['insert', 'update']);
    expect(calls.some(c => c.op === 'upsert')).toBe(false);
  });

  it('rejects a write with no user or no name', async () => {
    await expect(recipes.upsert({ name: 'x' })).rejects.toThrow();
    await expect(recipes.upsert({ user: USER, name: '  ' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('every statement names its columns', () => {
  it('listMine and listPublic never select *', async () => {
    stage([], []);
    await recipes.listMine('user-1');
    await recipes.listPublic({ excludeUserId: 'user-1' });

    for (const c of calls) {
      expect(c.cols).toBeTruthy();
      expect(c.cols).not.toBe('*');
      expect(c.cols).not.toContain('user_email');
    }
  });

  it('listPublic sorts NULL published_at last, not first', async () => {
    stage([]);
    await recipes.listPublic({});
    const order = calls[0].filters.find(f => f[0] === 'order');
    expect(order[1]).toBe('published_at');
    expect(order[2]).toMatchObject({ ascending: false, nullsFirst: false });
  });

  it('setPublished and saveCopy return named columns only', async () => {
    stage({ id: 'r1' }, { id: 'r2' });
    await recipes.setPublished({ id: 'r1', isPublic: true, authorUsername: 'me' });
    await recipes.saveCopy({ user: USER, recipe: { name: 'X', servings: 1, ingredients: [] } });

    expect(calls[0].op).toBe('update');
    expect(calls[0].payload).not.toHaveProperty('user_email');
    expect(calls[1].op).toBe('insert');
    expect(calls[1].payload.user_email).toBe('me@example.test');   // NOT NULL on insert
    expect(calls[1].payload.is_public).toBe(false);                // a copy is private
    for (const c of calls) expect(c.cols).not.toBe('*');
  });
});
