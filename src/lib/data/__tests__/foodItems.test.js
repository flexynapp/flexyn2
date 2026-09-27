// Every read of food_items now goes through src/lib/data/foodItems.js. These
// tests pin the statements it sends through the real db.js, so replacing
// db.entities inside the module has to reproduce them exactly.
//
// The barcode reads carry NO user filter on purpose: a scan must find a
// record anyone contributed. See the head note in foodItems.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let calls = [];
let results = [];

function chain(table) {
  const q = {};
  const rec = (name) => (...args) => { calls.push([table, name, ...args]); return q; };
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update', 'delete', 'single', 'maybeSingle', 'gte']) {
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
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), EVENTS: {} }));

const foodItems = await import('../foodItems');

beforeEach(() => { calls = []; results = []; });

const T = 'food_items';

describe('barcode reads', () => {
  it('listByBarcode reads every record for the barcode, newest first, unscoped by user', async () => {
    results = [{ data: [{ id: 'f1' }], error: null }];
    expect(await foodItems.listByBarcode('0123')).toEqual([{ id: 'f1' }]);
    expect(calls).toEqual([
      [T, 'from'], [T, 'select', '*'], [T, 'eq', 'barcode', '0123'],
      [T, 'order', 'created_date', { ascending: false }], [T, 'limit', 10],
    ]);
  });

  it('listByBarcode throws a failed read so the caller can fall back', async () => {
    results = [{ data: null, error: { code: '42703' } }];
    await expect(foodItems.listByBarcode('0123')).rejects.toMatchObject({ code: '42703' });
  });

  it('findByBarcode reads one record and answers null on a failed read', async () => {
    results = [{ data: [{ id: 'f1' }], error: null }, { data: null, error: { code: '42501' } }];
    expect(await foodItems.findByBarcode('0123')).toEqual({ id: 'f1' });
    expect(await foodItems.findByBarcode('0123')).toBeNull();
    expect(calls.slice(0, 5)).toEqual([
      [T, 'from'], [T, 'select', '*'], [T, 'eq', 'barcode', '0123'],
      [T, 'order', 'created_date', { ascending: false }], [T, 'limit', 1],
    ]);
  });

  it('findByBarcode with no barcode sends nothing', async () => {
    expect(await foodItems.findByBarcode('')).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('one door to food_items', () => {
  it('no other source file touches db.entities.FoodItem', () => {
    const root = join(process.cwd(), 'src');
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'i18n-langs') walk(p); continue; }
        if (!/\.(jsx?|tsx?)$/.test(name)) continue;
        const rel = relative(root, p);
        if (rel === join('lib', 'data', 'foodItems.js')) continue;
        const code = readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '');
        if (/entities\s*\.\s*FoodItem\b/.test(code)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
