// Every read and write of regimens now goes through src/lib/data/regimens.js.
// These tests pin the exact statements it sends. They were written against
// the old db.js client and pass unchanged on ownedRows, which is the proof
// the swap matched.
//
// The list shape matters beyond style: Dashboard, Workout, Nutrition,
// RegimensSection and the Hub share card all read the ['regimens', email]
// cache. Nutrition used to cap it at 50 rows, and the Hub card filled it with
// every regimen the policies allow, which includes other people's public
// ones. Whichever page loaded first decided what the others showed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let calls = [];
let results = [];

function chain(table) {
  const q = {};
  const rec = (name) => (...args) => { calls.push([table, name, ...args]); return q; };
  for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit', 'insert', 'update', 'delete', 'single', 'maybeSingle']) {
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

vi.mock('@/lib/profanityFilter', () => ({ containsProfanity: (s) => /badword/i.test(s) }));

const regimens = await import('../regimens');

beforeEach(() => { calls = []; results = []; });

const T = 'regimens';

describe('regimens reads', () => {
  it("list reads the user's own regimens, newest first", async () => {
    results = [{ data: [{ id: 'r1' }], error: null }];
    expect(await regimens.list('u1')).toEqual([{ id: 'r1' }]);
    expect(calls).toEqual([
      [T, 'from'], [T, 'select', '*'], [T, 'eq', 'user_id', 'u1'],
      [T, 'order', 'created_date', { ascending: false }], [T, 'limit', 1000],
    ]);
  });

  it('list takes a limit', async () => {
    await regimens.list('u1', 1);
    expect(calls.at(-1)).toEqual([T, 'limit', 1]);
  });

  it.each([undefined, null, ''])('list with no user id (%p) returns nothing and sends nothing', async (id) => {
    expect(await regimens.list(id)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('regimens writes', () => {
  it("create inserts once with the caller's identity injected", async () => {
    results = [{ data: { id: 'r1' }, error: null }];
    await regimens.create({ name: 'Push day', exercises: [] });
    expect(calls.filter((c) => c[1] === 'insert')).toEqual([
      [T, 'insert', { name: 'Push day', exercises: [], user_id: 'u1', created_by: 'a@b.co' }],
    ]);
  });

  it('create refuses flagged language and sends nothing', async () => {
    await expect(regimens.create({ name: 'badword day' })).rejects.toMatchObject({ code: 'PROFANITY', field: 'name' });
    await expect(regimens.create({ name: 'ok', description: 'badword' })).rejects.toMatchObject({ code: 'PROFANITY', field: 'description' });
    expect(calls).toEqual([]);
  });

  it('create throws a database error', async () => {
    results = [{ data: null, error: { code: 'PGRST204' } }];
    await expect(regimens.create({ name: 'Push day' })).rejects.toMatchObject({ code: 'PGRST204' });
  });

  it('update and remove act by id', async () => {
    results = [{ data: { id: 'r1' }, error: null }];
    await regimens.update('r1', { is_active: true });
    await regimens.remove('r1');
    expect(calls).toEqual([
      [T, 'from'], [T, 'update', { is_active: true }], [T, 'eq', 'id', 'r1'], [T, 'select'], [T, 'single'],
      [T, 'from'], [T, 'delete'], [T, 'eq', 'id', 'r1'],
    ]);
  });

  it('update refuses flagged language in a renamed regimen', async () => {
    await expect(regimens.update('r1', { name: 'badword' })).rejects.toMatchObject({ code: 'PROFANITY' });
    expect(calls).toEqual([]);
  });
});

describe('one door to regimens', () => {
  it('no source file touches db.entities.Regimen', () => {
    const root = join(process.cwd(), 'src');
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'i18n-langs') walk(p); continue; }
        if (!/\.(jsx?|tsx?)$/.test(name)) continue;
        const rel = relative(root, p);
        const code = readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '');
        if (/entities\s*\.\s*Regimen\b/.test(code)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('regimens get', () => {
  it('reads one row by id', async () => {
    calls = []; results = [{ data: { id: 'x1' }, error: null }];
    expect(await regimens.get('x1')).toEqual({ id: 'x1' });
    expect(calls).toEqual([['regimens', 'from'], ['regimens', 'select', '*'], ['regimens', 'eq', 'id', 'x1'], ['regimens', 'maybeSingle']]);
  });
});

describe('public templates', () => {
  it('listPublic falls back to is_public alone when is_public_free is missing', async () => {
    results = [
      { data: null, error: { code: '42703' } },
      { data: [{ id: 'p1' }], error: null },
    ];
    expect(await regimens.listPublic(20)).toEqual([{ id: 'p1' }]);
    expect(calls.slice(-5)).toEqual([
      [T, 'from'], [T, 'select', '*'], [T, 'eq', 'is_public', true],
      [T, 'order', 'copy_count', { ascending: false }], [T, 'limit', 20],
    ]);
  });

  it('listPublic reads nothing rather than throwing when the fallback fails', async () => {
    results = [{ data: null, error: { code: '42703' } }, { data: null, error: { code: '42501' } }];
    expect(await regimens.listPublic(20)).toEqual([]);
  });

  it('copyTemplate inserts a private copy owned by the caller', async () => {
    results = [{ data: { id: 'c1' }, error: null }];
    const { supabase } = await import('@/api/supabaseClient');
    supabase.rpc.mockReturnValue(Promise.resolve({ error: null }));
    await regimens.copyTemplate(
      { id: 'o1', name: 'PPL', description: 'd', exercises: [{ name: 'Row' }], author_username: 'sam' },
      { email: 'a@b.co' },
    );
    expect(calls.filter((c) => c[1] === 'insert')).toEqual([[T, 'insert', {
      created_by: 'a@b.co', user_id: 'u1', name: 'PPL', description: 'd', exercises: [{ name: 'Row' }],
      is_public: false, copy_count: 0, original_template_id: 'o1', original_author_username: 'sam',
    }]]);
    expect(supabase.rpc).toHaveBeenCalledWith('increment_copy_count', { p_table: 'regimens', p_id: 'o1' });
  });
});
