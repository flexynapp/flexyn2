// Every screen that reads or writes cardio_logs now goes through
// src/lib/data/cardio.js. These tests pin the exact statements the entity
// backed functions send, through the real db.js underneath, so the next step
// (replacing db.entities inside this module) has to reproduce them exactly.
// listForPRs, listSummaries and getById already query supabase directly and
// are pinned in cardioListForPRs.test.js and cardioDetailFetch.test.jsx.

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
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), EVENTS: { CARDIO_LOGGED: 'cardio_logged' } }));

const cardio = await import('../cardio');
const { track } = await import('@/lib/analytics');

beforeEach(() => { calls = []; results = []; track.mockClear(); });

describe('cardio reads', () => {
  it('list reads the user\'s own rows by user id, newest first', async () => {
    results = [{ data: [{ id: 'c1' }], error: null }];
    const rows = await cardio.list('u1', 200);
    expect(rows).toEqual([{ id: 'c1' }]);
    expect(calls).toEqual([
      ['cardio_logs', 'from'],
      ['cardio_logs', 'select', '*'],
      ['cardio_logs', 'eq', 'user_id', 'u1'],
      ['cardio_logs', 'order', 'date', { ascending: false }],
      ['cardio_logs', 'limit', 200],
    ]);
  });

  it('list defaults to 50 rows, and the last-log card asks for 1', async () => {
    await cardio.list('u1');
    expect(calls.at(-1)).toEqual(['cardio_logs', 'limit', 50]);
    await cardio.list('u1', 1);
    expect(calls.at(-1)).toEqual(['cardio_logs', 'limit', 1]);
  });

  it.each([undefined, null, ''])('list with no user id (%p) returns nothing and sends nothing', async (id) => {
    expect(await cardio.list(id, 50)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('listForDate adds the date filter and keeps the newest-first order', async () => {
    await cardio.listForDate('u1', '2026-09-27');
    expect(calls).toEqual([
      ['cardio_logs', 'from'],
      ['cardio_logs', 'select', '*'],
      ['cardio_logs', 'eq', 'user_id', 'u1'],
      ['cardio_logs', 'eq', 'date', '2026-09-27'],
      ['cardio_logs', 'order', 'date', { ascending: false }],
      ['cardio_logs', 'limit', 50],
    ]);
  });

  it('a read error throws', async () => {
    results = [{ data: null, error: { code: '42501' } }];
    await expect(cardio.list('u1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('cardio writes', () => {
  const payload = {
    date: '2026-09-27', type: 'run', mode: 'outdoor', duration_seconds: 1800,
    distance_meters: 5000, pace_seconds_per_km: 360, calories: 350, notes: null,
    gps_track: [{ lat: 1, lng: 2, t: 0 }],
  };

  it('create inserts once with the caller\'s identity injected and tracks it', async () => {
    results = [{ data: { id: 'c1' }, error: null }];
    const row = await cardio.create({ ...payload, user_id: 'someone-else', created_by: 'x@y.z' });
    expect(row).toEqual({ id: 'c1' });
    expect(calls.filter((c) => c[1] === 'insert')).toEqual([
      ['cardio_logs', 'insert', { ...payload, user_id: 'u1', created_by: 'a@b.co' }],
    ]);
    expect(track).toHaveBeenCalledWith('cardio_logged');
  });

  it('create throws any other error, including a missing column', async () => {
    results = [{ data: null, error: { code: 'PGRST204' } }];
    await expect(cardio.create(payload)).rejects.toMatchObject({ code: 'PGRST204' });
    expect(calls.filter((c) => c[1] === 'insert')).toHaveLength(1);
    expect(track).not.toHaveBeenCalled();
  });

  // Both throw synchronously; every caller awaits them inside an async
  // function or a try, where a sync throw and a rejection land the same way.
  it('create and update refuse profane notes before sending anything', () => {
    expect(() => cardio.create({ ...payload, notes: 'fuck' })).toThrow(expect.objectContaining({ code: 'PROFANITY' }));
    expect(() => cardio.update('c1', { notes: 'fuck' })).toThrow(expect.objectContaining({ code: 'PROFANITY' }));
    expect(calls).toEqual([]);
  });

  it('update patches by id and returns the row', async () => {
    results = [{ data: { id: 'c1', calories: 400 }, error: null }];
    const row = await cardio.update('c1', { calories: 400 });
    expect(row).toEqual({ id: 'c1', calories: 400 });
    expect(calls).toEqual([
      ['cardio_logs', 'from'],
      ['cardio_logs', 'update', { calories: 400 }],
      ['cardio_logs', 'eq', 'id', 'c1'],
      ['cardio_logs', 'select'],
      ['cardio_logs', 'single'],
    ]);
  });

  it('remove deletes by id and throws on error', async () => {
    await cardio.remove('c1');
    expect(calls).toEqual([
      ['cardio_logs', 'from'],
      ['cardio_logs', 'delete'],
      ['cardio_logs', 'eq', 'id', 'c1'],
    ]);
    results = [{ error: { code: '42501' } }];
    await expect(cardio.remove('c1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('one door to cardio_logs', () => {
  // Only this module may use the old entity for cardio logs. A new call site
  // elsewhere would skip whatever this module does next.
  it('no other source file touches db.entities.CardioLog', () => {
    const root = join(process.cwd(), 'src');
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'i18n-langs') walk(p); continue; }
        if (!/\.(jsx?|tsx?)$/.test(name)) continue;
        const rel = relative(root, p);
        if (rel === join('lib', 'data', 'cardio.js')) continue;
        const code = readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '');
        if (/entities\s*\.\s*CardioLog\b/.test(code)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
