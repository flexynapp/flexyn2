// Every screen that reads or writes workout_logs now goes through
// src/lib/data/workouts.js. These tests pin the exact statements that module
// sends, through the real db.js underneath it, so the next step (replacing
// db.entities inside this module) has to reproduce them exactly.

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
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), EVENTS: { WORKOUT_LOGGED: 'workout_logged' } }));

const workouts = await import('../workouts');
const { track } = await import('@/lib/analytics');

beforeEach(() => { calls = []; results = []; track.mockClear(); });

describe('workouts reads', () => {
  it('list reads the user\'s own rows by user id, newest first', async () => {
    results = [{ data: [{ id: 'w1' }], error: null }];
    const rows = await workouts.list('u1', 500);
    expect(rows).toEqual([{ id: 'w1' }]);
    expect(calls).toEqual([
      ['workout_logs', 'from'],
      ['workout_logs', 'select', '*'],
      ['workout_logs', 'eq', 'user_id', 'u1'],
      ['workout_logs', 'order', 'date', { ascending: false }],
      ['workout_logs', 'limit', 500],
    ]);
  });

  it('list defaults to 50 rows', async () => {
    await workouts.list('u1');
    expect(calls.at(-1)).toEqual(['workout_logs', 'limit', 50]);
  });

  it.each([undefined, null, ''])('list with no user id (%p) returns nothing and sends nothing', async (id) => {
    expect(await workouts.list(id, 50)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('listForDate adds the date filter', async () => {
    await workouts.listForDate('u1', '2026-09-27');
    expect(calls).toEqual([
      ['workout_logs', 'from'],
      ['workout_logs', 'select', '*'],
      ['workout_logs', 'eq', 'user_id', 'u1'],
      ['workout_logs', 'eq', 'date', '2026-09-27'],
      ['workout_logs', 'order', 'date', { ascending: false }],
      ['workout_logs', 'limit', 50],
    ]);
  });

  it('a read error throws', async () => {
    results = [{ data: null, error: { code: '42501' } }];
    await expect(workouts.list('u1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('workouts writes', () => {
  const payload = {
    title: 'Push', date: '2026-09-27', duration_min: 45, exercises: [{ name: 'Bench', sets: [{ weight: 100, reps: 5 }] }],
    notes: 'good', tags: [], idempotency_key: 'k1', total_volume: 500,
  };

  it('create inserts once with the caller\'s identity injected and tracks it', async () => {
    results = [{ data: { id: 'w1' }, error: null }];
    const row = await workouts.create({ ...payload, user_id: 'someone-else', created_by: 'x@y.z' });
    expect(row).toEqual({ id: 'w1' });
    expect(calls.filter((c) => c[1] === 'insert')).toEqual([
      ['workout_logs', 'insert', { ...payload, user_id: 'u1', created_by: 'a@b.co' }],
    ]);
    expect(track).toHaveBeenCalledWith('workout_logged');
  });

  it('create returns the existing row marked __duplicate on an idempotency conflict', async () => {
    results = [
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "workout_logs_idempotency_idx"' } },
      { data: { id: 'w0' }, error: null },
    ];
    const row = await workouts.create(payload);
    expect(row).toEqual({ id: 'w0', __duplicate: true });
    expect(calls.slice(-5)).toEqual([
      ['workout_logs', 'from'],
      ['workout_logs', 'select', '*'],
      ['workout_logs', 'eq', 'user_id', 'u1'],
      ['workout_logs', 'eq', 'idempotency_key', 'k1'],
      ['workout_logs', 'maybeSingle'],
    ]);
    expect(track).not.toHaveBeenCalled();
  });

  it('create throws any other error, including a missing column', async () => {
    results = [{ data: null, error: { code: 'PGRST204' } }];
    await expect(workouts.create(payload)).rejects.toMatchObject({ code: 'PGRST204' });
    expect(calls.filter((c) => c[1] === 'insert')).toHaveLength(1);
  });

  // Both throw synchronously; every caller awaits them inside an async
  // function or a try, where a sync throw and a rejection land the same way.
  it('create and update refuse profane notes before sending anything', () => {
    expect(() => workouts.create({ ...payload, notes: 'fuck' })).toThrow(expect.objectContaining({ code: 'PROFANITY' }));
    expect(() => workouts.update('w1', { notes: 'fuck' })).toThrow(expect.objectContaining({ code: 'PROFANITY' }));
    expect(calls).toEqual([]);
  });

  it('update patches by id and returns the row', async () => {
    results = [{ data: { id: 'w1', total_volume: 300 }, error: null }];
    const row = await workouts.update('w1', { exercises: [], total_volume: 300 });
    expect(row).toEqual({ id: 'w1', total_volume: 300 });
    expect(calls).toEqual([
      ['workout_logs', 'from'],
      ['workout_logs', 'update', { exercises: [], total_volume: 300 }],
      ['workout_logs', 'eq', 'id', 'w1'],
      ['workout_logs', 'select'],
      ['workout_logs', 'single'],
    ]);
  });

  it('remove deletes by id and throws on error', async () => {
    await workouts.remove('w1');
    expect(calls).toEqual([
      ['workout_logs', 'from'],
      ['workout_logs', 'delete'],
      ['workout_logs', 'eq', 'id', 'w1'],
    ]);
    results = [{ error: { code: '42501' } }];
    await expect(workouts.remove('w1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('one door to workout_logs', () => {
  // Only this module may use the old entity for workout logs. A new call site
  // elsewhere would skip whatever this module does next.
  it('no other source file touches db.entities.WorkoutLog', () => {
    const root = join(process.cwd(), 'src');
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'i18n-langs') walk(p); continue; }
        if (!/\.(jsx?|tsx?)$/.test(name)) continue;
        const rel = relative(root, p);
        if (rel === join('lib', 'data', 'workouts.js')) continue;
        const code = readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '');
        if (/entities\s*\.\s*WorkoutLog\b/.test(code)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
