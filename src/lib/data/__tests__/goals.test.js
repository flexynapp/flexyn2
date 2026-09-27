// Every read and write of goals now goes through src/lib/data/goals.js.
// These tests pin the exact statements it sends, through the real db.js
// underneath, so the next step (replacing db.entities inside this module) has
// to reproduce them exactly.
//
// Dashboard, Workout and GoalsModal share the ['goals', email] cache.
// Workout's query had no sort while Dashboard's was newest first, so the
// order Today and the goal strips showed depended on which page loaded first.

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
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), EVENTS: { GOAL_CREATED: 'goal_created' } }));

vi.mock('@/lib/profanityFilter', () => ({ containsProfanity: (s) => /badword/i.test(s) }));

const goals = await import('../goals');
const { track } = await import('@/lib/analytics');

beforeEach(() => { calls = []; results = []; track.mockClear(); });

const T = 'goals';

describe('goals reads', () => {
  it("list reads the user's own goals, newest first", async () => {
    results = [{ data: [{ id: 'g1' }], error: null }];
    expect(await goals.list('u1')).toEqual([{ id: 'g1' }]);
    expect(calls).toEqual([
      [T, 'from'], [T, 'select', '*'], [T, 'eq', 'user_id', 'u1'],
      [T, 'order', 'created_date', { ascending: false }], [T, 'limit', 1000],
    ]);
  });

  it('list takes a limit', async () => {
    await goals.list('u1', 50);
    expect(calls.at(-1)).toEqual([T, 'limit', 50]);
  });

  it.each([undefined, null, ''])('list with no user id (%p) returns nothing and sends nothing', async (id) => {
    expect(await goals.list(id)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('get reads one goal by id', async () => {
    results = [{ data: { id: 'g1', status: 'active' }, error: null }];
    expect(await goals.get('g1')).toEqual({ id: 'g1', status: 'active' });
    expect(calls).toEqual([[T, 'from'], [T, 'select', '*'], [T, 'eq', 'id', 'g1'], [T, 'maybeSingle']]);
  });

  it('get throws a read error rather than answering "no goal"', async () => {
    results = [{ data: null, error: { code: '42501' } }];
    await expect(goals.get('g1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('goals writes', () => {
  it("create inserts once with the caller's identity injected and tracks it", async () => {
    results = [{ data: { id: 'g1' }, error: null }];
    await goals.create({ exercise_name: 'Bench', target_value: 225, goal_type: 'strength' });
    expect(calls.filter((c) => c[1] === 'insert')).toEqual([
      [T, 'insert', { exercise_name: 'Bench', target_value: 225, goal_type: 'strength', user_id: 'u1', created_by: 'a@b.co' }],
    ]);
    expect(track).toHaveBeenCalledWith('goal_created', { type: 'strength' });
  });

  it('create refuses flagged language and sends nothing', () => {
    expect(() => goals.create({ exercise_name: 'badword' })).toThrow(expect.objectContaining({ code: 'PROFANITY' }));
    expect(calls).toEqual([]);
  });

  it('marking a goal complete sends one update by id', async () => {
    results = [{ data: { id: 'g1', status: 'completed' }, error: null }];
    await goals.update('g1', { status: 'completed' });
    await goals.remove('g1');
    expect(calls).toEqual([
      [T, 'from'], [T, 'update', { status: 'completed' }], [T, 'eq', 'id', 'g1'], [T, 'select'], [T, 'single'],
      [T, 'from'], [T, 'delete'], [T, 'eq', 'id', 'g1'],
    ]);
  });
});

describe('one door to goals', () => {
  it('no other source file touches db.entities.Goal', () => {
    const root = join(process.cwd(), 'src');
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'i18n-langs') walk(p); continue; }
        if (!/\.(jsx?|tsx?)$/.test(name)) continue;
        const rel = relative(root, p);
        if (rel === join('lib', 'data', 'goals.js')) continue;
        const code = readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '');
        if (/entities\s*\.\s*Goal\b/.test(code)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
