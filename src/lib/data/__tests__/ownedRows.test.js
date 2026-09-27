// ownedRows is what each data module moves onto when it leaves the old
// db.entities client. The per-module tests pin each table's statements;
// these pin the guards every table relies on.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const getSession = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => { calls.push([table, 'from']); return chain(table); },
    auth: { getSession: (...a) => getSession(...a) },
  },
}));

const { ownedRows } = await import('../ownedRows');
const t = ownedRows('things');

beforeEach(() => {
  calls = [];
  results = [];
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { user: { id: 'u1', email: 'a@b.co' } } } });
});

describe('ownedRows reads', () => {
  it.each([undefined, null, ''])('an owner key of %j reads nothing rather than everyone', async (v) => {
    expect(await t.filter({ user_id: v })).toEqual([]);
    expect(await t.filter({ created_by: v })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('filter sends equality, IN for arrays, skips other nullish values, sorts and limits', async () => {
    results = [{ data: [{ id: 1 }], error: null }];
    const rows = await t.filter({ user_id: 'u1', kind: ['a', 'b'], date: null }, '-date', 5);
    expect(rows).toEqual([{ id: 1 }]);
    expect(calls).toEqual([
      ['things', 'from'],
      ['things', 'select', '*'],
      ['things', 'eq', 'user_id', 'u1'],
      ['things', 'in', 'kind', ['a', 'b']],
      ['things', 'order', 'date', { ascending: false }],
      ['things', 'limit', 5],
    ]);
  });

  it('filter defaults to 1000 rows, unsorted, and returns [] for no data', async () => {
    expect(await t.filter({ user_id: 'u1' })).toEqual([]);
    expect(calls.at(-1)).toEqual(['things', 'limit', 1000]);
    expect(calls.some((c) => c[1] === 'order')).toBe(false);
  });

  it('get reads one row by id', async () => {
    results = [{ data: { id: 'x' }, error: null }];
    expect(await t.get('x')).toEqual({ id: 'x' });
    expect(calls).toEqual([
      ['things', 'from'], ['things', 'select', '*'], ['things', 'eq', 'id', 'x'], ['things', 'maybeSingle'],
    ]);
  });

  it('reads throw the database error', async () => {
    results = [{ data: null, error: { code: '42501' } }, { data: null, error: { code: '42501' } }];
    await expect(t.filter({ user_id: 'u1' })).rejects.toMatchObject({ code: '42501' });
    await expect(t.get('x')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('ownedRows writes', () => {
  it('create forces the signed-in owner over whatever the caller sent', async () => {
    results = [{ data: { id: 'n' }, error: null }];
    expect(await t.create({ a: 1, user_id: 'someone', created_by: 'x@y.z' })).toEqual({ id: 'n' });
    expect(calls).toEqual([
      ['things', 'from'],
      ['things', 'insert', { a: 1, user_id: 'u1', created_by: 'a@b.co' }],
      ['things', 'select'],
      ['things', 'single'],
    ]);
  });

  it('create gives a guest the placeholder email the sign up trigger writes', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'g1', email: null } } } });
    await t.create({ a: 1 });
    expect(calls[1][2]).toEqual({ a: 1, user_id: 'g1', created_by: 'guest_g1@flexyn.guest' });
  });

  it('create with no session sends the row as given and lets the database refuse it', async () => {
    getSession.mockRejectedValue(new Error('offline'));
    results = [{ data: null, error: { code: '42501' } }];
    await expect(t.create({ a: 1 })).rejects.toMatchObject({ code: '42501' });
    expect(calls[1][2]).toEqual({ a: 1 });
  });

  it('update patches by id and returns the row', async () => {
    results = [{ data: { id: 'x', a: 2 }, error: null }];
    expect(await t.update('x', { a: 2 })).toEqual({ id: 'x', a: 2 });
    expect(calls).toEqual([
      ['things', 'from'], ['things', 'update', { a: 2 }], ['things', 'eq', 'id', 'x'], ['things', 'select'], ['things', 'single'],
    ]);
  });

  it('remove deletes by id', async () => {
    expect(await t.remove('x')).toBe(true);
    expect(calls).toEqual([['things', 'from'], ['things', 'delete'], ['things', 'eq', 'id', 'x']]);
  });

  it('writes throw the database error', async () => {
    results = [{ error: { code: 'PGRST204' } }, { error: { code: '42501' } }, { error: { code: '42501' } }];
    await expect(t.create({ a: 1 })).rejects.toMatchObject({ code: 'PGRST204' });
    await expect(t.update('x', {})).rejects.toMatchObject({ code: '42501' });
    await expect(t.remove('x')).rejects.toMatchObject({ code: '42501' });
  });
});
