// Every read and write of body_metrics now goes through
// src/lib/data/bodyMetrics.js. These tests pin the exact statements it sends.
// They were written against the old db.js client and pass unchanged on
// ownedRows, which is the proof the swap matched.

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
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), EVENTS: {} }));

const bodyMetrics = await import('../bodyMetrics');
const { track } = await import('@/lib/analytics');

beforeEach(() => { calls = []; results = []; track.mockClear(); });

const T = 'body_metrics';

describe('bodyMetrics reads', () => {
  it('list reads the user\'s own weigh-ins, newest first', async () => {
    results = [{ data: [{ id: 'b1' }], error: null }];
    expect(await bodyMetrics.list('u1', 500)).toEqual([{ id: 'b1' }]);
    expect(calls).toEqual([
      [T, 'from'], [T, 'select', '*'], [T, 'eq', 'user_id', 'u1'],
      [T, 'order', 'date', { ascending: false }], [T, 'limit', 500],
    ]);
  });

  it.each([undefined, null, ''])('list with no user id (%p) returns nothing and sends nothing', async (id) => {
    expect(await bodyMetrics.list(id)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('bodyMetrics writes', () => {
  it('create inserts once with the caller\'s identity injected', async () => {
    results = [{ data: { id: 'b1' }, error: null }];
    await bodyMetrics.create({ date: '2026-09-27', weight_lbs: 180 });
    expect(calls.filter((c) => c[1] === 'insert')).toEqual([
      [T, 'insert', { date: '2026-09-27', weight_lbs: 180, user_id: 'u1', created_by: 'a@b.co' }],
    ]);
  });

  it('create throws a database error rather than dropping a column', async () => {
    results = [{ data: null, error: { code: 'PGRST204' } }];
    await expect(bodyMetrics.create({ date: '2026-09-27', weight_lbs: 180 })).rejects.toMatchObject({ code: 'PGRST204' });
  });

  it('update and remove act by id', async () => {
    results = [{ data: { id: 'b1' }, error: null }];
    await bodyMetrics.update('b1', { weight_lbs: 181 });
    await bodyMetrics.remove('b1');
    expect(calls).toEqual([
      [T, 'from'], [T, 'update', { weight_lbs: 181 }], [T, 'eq', 'id', 'b1'], [T, 'select'], [T, 'single'],
      [T, 'from'], [T, 'delete'], [T, 'eq', 'id', 'b1'],
    ]);
  });
});

describe('one door to body_metrics', () => {
  it('no source file touches db.entities.BodyMetric', () => {
    const root = join(process.cwd(), 'src');
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'i18n-langs') walk(p); continue; }
        if (!/\.(jsx?|tsx?)$/.test(name)) continue;
        const rel = relative(root, p);
        const code = readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '');
        if (/entities\s*\.\s*BodyMetric\b/.test(code)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
