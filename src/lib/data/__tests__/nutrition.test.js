// Every screen that reads or writes nutrition_logs now goes through
// src/lib/data/nutrition.js. These tests pin the exact statements the entity
// backed functions send, through the real db.js underneath, so the next step
// (replacing db.entities inside this module) has to reproduce them exactly.
// What create() does to the form's payload is pinned in mealWritePath.test.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let calls = [];
let results = [];

function chain(table) {
  const q = {};
  const rec = (name) => (...args) => { calls.push([table, name, ...args]); return q; };
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update', 'delete', 'single', 'maybeSingle']) {
    q[m] = rec(m);
  }
  q.then = (resolve, reject) => Promise.resolve(results.shift() ?? { data: null, error: null }).then(resolve, reject);
  return q;
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => { calls.push([table, 'from']); return chain(table); },
    rpc: vi.fn(),
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1', email: 'a@b.co' } } } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.co' } } }),
    },
  },
}));
vi.mock('@/lib/pushCleanup', () => ({ unsubscribePushOnLogout: vi.fn() }));
vi.mock('@/lib/data/users', () => ({ selectProfiles: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), EVENTS: { MEAL_LOGGED: 'meal_logged', WATER_LOGGED: 'water_logged' } }));

const nutrition = await import('../nutrition');
const { track } = await import('@/lib/analytics');

beforeEach(() => { calls = []; results = []; track.mockClear(); });

const T = 'nutrition_logs';

describe('nutrition reads', () => {
  it('list reads the user\'s own rows by user id, newest date first', async () => {
    results = [{ data: [{ id: 'n1' }], error: null }];
    expect(await nutrition.list('u1')).toEqual([{ id: 'n1' }]);
    expect(calls).toEqual([
      [T, 'from'], [T, 'select', '*'], [T, 'eq', 'user_id', 'u1'],
      [T, 'order', 'date', { ascending: false }], [T, 'limit', 50],
    ]);
  });

  it('listRecent orders by when the row was logged', async () => {
    await nutrition.listRecent('u1', 500);
    expect(calls).toEqual([
      [T, 'from'], [T, 'select', '*'], [T, 'eq', 'user_id', 'u1'],
      [T, 'order', 'created_at', { ascending: false }], [T, 'limit', 500],
    ]);
    calls = [];
    await nutrition.listRecent('u1');
    expect(calls.at(-1)).toEqual([T, 'limit', 300]);
  });

  it('listForDate for the Nutrition page sends no order and the default cap', async () => {
    await nutrition.listForDate('u1', '2026-09-27');
    expect(calls).toEqual([
      [T, 'from'], [T, 'select', '*'], [T, 'eq', 'user_id', 'u1'],
      [T, 'eq', 'date', '2026-09-27'], [T, 'limit', 1000],
    ]);
  });

  it('listForDate for the hydration ring is newest first, capped at 100', async () => {
    await nutrition.listForDate('u1', '2026-09-27', { newestFirst: true });
    expect(calls).toEqual([
      [T, 'from'], [T, 'select', '*'], [T, 'eq', 'user_id', 'u1'],
      [T, 'eq', 'date', '2026-09-27'],
      [T, 'order', 'created_date', { ascending: false }], [T, 'limit', 100],
    ]);
  });

  it.each([undefined, null, ''])('a read with no user id (%p) returns nothing and sends nothing', async (id) => {
    expect(await nutrition.listRecent(id)).toEqual([]);
    expect(await nutrition.listForDate(id, '2026-09-27')).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('a read error throws', async () => {
    results = [{ data: null, error: { code: '42501' } }];
    await expect(nutrition.listRecent('u1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('nutrition writes', () => {
  it('create inserts once with the caller\'s identity and sends no analytics', async () => {
    results = [{ data: { id: 'n1', food_name: 'Rice' }, error: null }, { data: { id: 'n2', food_name: 'Water|16' }, error: null }];
    await nutrition.create({ date: '2026-09-27', food_name: 'Rice', calories: 200, user_id: 'x', created_by: 'x@y.z' });
    await nutrition.create({ date: '2026-09-27', food_name: 'Water|16', calories: 0 });
    const inserts = calls.filter((c) => c[1] === 'insert');
    expect(inserts).toHaveLength(2);
    expect(inserts[0][2]).toMatchObject({ food_name: 'Rice', user_id: 'u1', created_by: 'a@b.co' });
    // The Nutrition page sends meal_logged and rewardWaterLog sends
    // water_logged; a second copy from here counted each one twice.
    expect(track).not.toHaveBeenCalled();
  });

  it('create and update refuse a profane food name before sending anything', () => {
    expect(() => nutrition.create({ food_name: 'fuck' })).toThrow(expect.objectContaining({ code: 'PROFANITY' }));
    expect(() => nutrition.update('n1', { notes: 'fuck' })).toThrow(expect.objectContaining({ code: 'PROFANITY' }));
    expect(calls).toEqual([]);
  });

  it('update patches by id and returns the row', async () => {
    results = [{ data: { id: 'n1', calories: 250 }, error: null }];
    expect(await nutrition.update('n1', { calories: 250 })).toEqual({ id: 'n1', calories: 250 });
    expect(calls).toEqual([
      [T, 'from'], [T, 'update', { calories: 250 }], [T, 'eq', 'id', 'n1'], [T, 'select'], [T, 'single'],
    ]);
  });

  it('remove deletes by id and throws on error', async () => {
    await nutrition.remove('n1');
    expect(calls).toEqual([[T, 'from'], [T, 'delete'], [T, 'eq', 'id', 'n1']]);
    results = [{ error: { code: '42501' } }];
    await expect(nutrition.remove('n1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('one door to nutrition_logs', () => {
  // Only this module may use the old entity for meal and water logs. A new
  // call site elsewhere would skip whatever this module does next.
  it('no other source file touches db.entities.NutritionLog', () => {
    const root = join(process.cwd(), 'src');
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'i18n-langs') walk(p); continue; }
        if (!/\.(jsx?|tsx?)$/.test(name)) continue;
        const rel = relative(root, p);
        if (rel === join('lib', 'data', 'nutrition.js')) continue;
        const code = readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '');
        if (/entities\s*\.\s*NutritionLog\b/.test(code)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('nutrition get', () => {
  it('reads one row by id', async () => {
    calls = []; results = [{ data: { id: 'x1' }, error: null }];
    expect(await nutrition.get('x1')).toEqual({ id: 'x1' });
    expect(calls).toEqual([['nutrition_logs', 'from'], ['nutrition_logs', 'select', '*'], ['nutrition_logs', 'eq', 'id', 'x1'], ['nutrition_logs', 'maybeSingle']]);
  });
});
