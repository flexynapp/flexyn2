// The exact statements src/lib/data/templates.js sends to workout_templates.
// Written against the old db.js client before the module left it, and
// passing unchanged after, which is the proof the swap matched.
// templates.test.js covers what the module does to a template's content.

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
    rpc: vi.fn(() => Promise.resolve({ error: null })),
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

const templates = await import('../templates');
const { supabase } = await import('@/api/supabaseClient');

const T = 'workout_templates';
const insertOf = () => calls.filter((c) => c[1] === 'insert').map((c) => c[2]);

beforeEach(() => { calls = []; results = []; supabase.rpc.mockClear(); });

describe('workout_templates reads', () => {
  it("list reads the user's own templates, newest first", async () => {
    results = [{ data: [{ id: 't1' }], error: null }];
    expect(await templates.list('u1')).toEqual([{ id: 't1' }]);
    expect(calls).toEqual([
      [T, 'from'], [T, 'select', templates.TEMPLATE_COLUMNS], [T, 'eq', 'user_id', 'u1'],
      [T, 'order', 'created_date', { ascending: false }], [T, 'limit', 1000],
    ]);
  });

  it('list with no user reads nothing', async () => {
    expect(await templates.list(undefined)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('listPublic reads public templates by copy count, and [] on a failed read', async () => {
    results = [{ data: [{ id: 'p' }], error: null }, { data: null, error: { code: '42501' } }];
    expect(await templates.listPublic(20)).toEqual([{ id: 'p' }]);
    expect(calls).toEqual([
      [T, 'from'], [T, 'select', templates.TEMPLATE_COLUMNS], [T, 'eq', 'is_public', true],
      [T, 'order', 'copy_count', { ascending: false }], [T, 'limit', 20],
    ]);
    expect(await templates.listPublic(20)).toEqual([]);
  });
});

describe('workout_templates writes', () => {
  it('create inserts the stripped template with the caller as owner', async () => {
    results = [{ data: { id: 't1' }, error: null }];
    await templates.create({ name: 'T', user_id: 'x', exercises: [{ name: 'Row', sets: [{ weight: 1, reps: 2 }] }] });
    expect(insertOf()).toEqual([{
      name: 'T', user_id: 'u1', created_by: 'a@b.co',
      exercises: [{ name: 'Row', sets: [{ weight: null, reps: null }] }],
    }]);
    expect(calls.slice(-2)).toEqual([[T, 'select', templates.TEMPLATE_COLUMNS], [T, 'single']]);
  });

  it('saveTemplate inserts a private skeleton', async () => {
    results = [{ data: { id: 't2' }, error: null }];
    expect(await templates.saveTemplate({ name: ' Push ', exercises: [{ name: 'Bench', sets: [{ weight: 1, reps: 1 }] }] }))
      .toEqual({ ok: true, id: 't2' });
    expect(insertOf()).toEqual([{
      name: 'Push', description: '', is_public: false, user_id: 'u1', created_by: 'a@b.co',
      exercises: [{ name: 'Bench', sets: [{ weight: null, reps: null }] }],
    }]);
  });

  it('update patches by id, reading the row first only when publishing', async () => {
    results = [{ data: { id: 't1' }, error: null }];
    await templates.update('t1', { name: 'New' });
    expect(calls).toEqual([
      [T, 'from'], [T, 'update', { name: 'New' }], [T, 'eq', 'id', 't1'], [T, 'select', templates.TEMPLATE_COLUMNS], [T, 'single'],
    ]);

    calls = [];
    results = [{ data: { original_template_id: null }, error: null }, { data: { id: 't1' }, error: null }];
    await templates.update('t1', { is_public: true });
    expect(calls).toEqual([
      [T, 'from'], [T, 'select', 'original_template_id'], [T, 'eq', 'id', 't1'], [T, 'maybeSingle'],
      [T, 'from'], [T, 'update', { is_public: true }], [T, 'eq', 'id', 't1'], [T, 'select', templates.TEMPLATE_COLUMNS], [T, 'single'],
    ]);
  });

  it('update refuses to publish a copy of someone else\'s template', async () => {
    results = [{ data: { original_template_id: 'o1' }, error: null }];
    await expect(templates.update('t1', { is_public: true })).rejects.toMatchObject({ code: 'COPY_NOT_PUBLISHABLE' });
    expect(calls.some((c) => c[1] === 'update')).toBe(false);
  });

  it('remove deletes by id and throws a failure', async () => {
    await templates.remove('t1');
    expect(calls).toEqual([[T, 'from'], [T, 'delete'], [T, 'eq', 'id', 't1']]);
    results = [{ error: { code: '42501' } }];
    await expect(templates.remove('t1')).rejects.toMatchObject({ code: '42501' });
  });

  it('copyTemplate inserts a private copy and bumps the original', async () => {
    results = [{ data: { id: 'c1' }, error: null }];
    expect(await templates.copyTemplate(
      { id: 'o1', name: 'PPL', exercises: [{ name: 'Row' }], author_username: 'sam' },
      { email: 'a@b.co' },
    )).toEqual({ id: 'c1' });
    expect(insertOf()).toEqual([{
      created_by: 'a@b.co', user_id: 'u1', name: 'PPL', exercises: [{ name: 'Row' }],
      is_public: false, copy_count: 0, original_template_id: 'o1', original_author_username: 'sam',
    }]);
    expect(supabase.rpc).toHaveBeenCalledWith('increment_copy_count', { p_table: T, p_id: 'o1' });
  });

  it('copyTemplate never names the author from their email', async () => {
    results = [{ data: { id: 'c2' }, error: null }];
    await templates.copyTemplate(
      { id: 'o2', name: 'PPL', exercises: [], created_by: 'sam.smith@work.co' },
      { email: 'a@b.co' },
    );
    expect(insertOf()[0].original_author_username).toBeNull();
  });
});

describe('one door to workout_templates', () => {
  it('no source file touches db.entities.WorkoutTemplate', () => {
    const root = join(process.cwd(), 'src');
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'i18n-langs') walk(p); continue; }
        if (!/\.(jsx?|tsx?)$/.test(name)) continue;
        const code = readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '');
        if (/entities\s*\.\s*WorkoutTemplate\b/.test(code)) offenders.push(relative(root, p));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
