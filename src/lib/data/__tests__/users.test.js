// Tests for src/lib/data/users.js selectProfiles — the deploy-window
// fallback for the public_profiles view (June 2026 privacy audit).
//
// Covers:
//   • Happy path: queries public_profiles, never touches user_profiles.
//   • Fallback: 42P01 / PGRST205 / "not found" messages naming the view
//     re-run the identical query against user_profiles.
//   • Verdict caching: after one fallback, subsequent calls skip the
//     view probe entirely (one probe per session).
//   • Non-view errors (RLS, network, bad column) propagate untouched
//     and do NOT flip the verdict.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromCalls = [];
const inCalls = [];
let resultForTable; // (table) => { data, error }

function makeBuilder(table) {
  const builder = {};
  const terminal = () => Promise.resolve(resultForTable(table));
  const chain = () => builder;
  for (const op of ['select', 'eq', 'neq', 'in', 'not', 'is', 'ilike', 'order', 'limit', 'gt', 'gte', 'lte']) {
    builder[op] = chain;
  }
  builder.in = (col, vals) => { inCalls.push([col, vals]); return builder; };
  builder.single = terminal;
  builder.maybeSingle = terminal;
  builder.then = (onF, onR) => terminal().then(onF, onR);
  return builder;
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      fromCalls.push(table);
      return makeBuilder(table);
    },
  },
}));

import { selectProfiles, list, listByIds, __resetProfilesSourceForTests } from '@/lib/data/users';

const ROWS = [{ id: 'u1', email: 'a@b.c', username: 'alpha' }];

beforeEach(() => {
  fromCalls.length = 0;
  inCalls.length = 0;
  __resetProfilesSourceForTests();
  resultForTable = () => ({ data: ROWS, error: null });
});

describe('selectProfiles', () => {
  it('queries public_profiles and returns its result on success', async () => {
    const { data, error } = await selectProfiles((from) => from.select('*').limit(10));
    expect(error).toBeNull();
    expect(data).toEqual(ROWS);
    expect(fromCalls).toEqual(['public_profiles']);
  });

  it.each([
    ['42P01', 'relation "public.public_profiles" does not exist'],
    ['PGRST205', "Could not find the table 'public.public_profiles' in the schema cache"],
  ])('falls back to user_profiles on %s', async (code, message) => {
    resultForTable = (table) =>
      table === 'public_profiles'
        ? { data: null, error: { code, message } }
        : { data: ROWS, error: null };
    const { data, error } = await selectProfiles((from) => from.select('*'));
    expect(error).toBeNull();
    expect(data).toEqual(ROWS);
    expect(fromCalls).toEqual(['public_profiles', 'user_profiles']);
  });

  it('falls back when the error message names public_profiles as not found (no code)', async () => {
    resultForTable = (table) =>
      table === 'public_profiles'
        ? { data: null, error: { message: "table 'public_profiles' not found" } }
        : { data: ROWS, error: null };
    const { data } = await selectProfiles((from) => from.select('*'));
    expect(data).toEqual(ROWS);
    expect(fromCalls).toEqual(['public_profiles', 'user_profiles']);
  });

  it('caches the fallback verdict — the view is probed at most once per session', async () => {
    resultForTable = (table) =>
      table === 'public_profiles'
        ? { data: null, error: { code: '42P01', message: 'relation does not exist' } }
        : { data: ROWS, error: null };
    await selectProfiles((from) => from.select('*'));
    await selectProfiles((from) => from.select('*'));
    await selectProfiles((from) => from.select('*'));
    expect(fromCalls).toEqual(['public_profiles', 'user_profiles', 'user_profiles', 'user_profiles']);
  });

  it('caches the success verdict and keeps querying the view', async () => {
    await selectProfiles((from) => from.select('*'));
    await selectProfiles((from) => from.select('*'));
    expect(fromCalls).toEqual(['public_profiles', 'public_profiles']);
  });

  it('propagates non-view errors untouched and does not flip the verdict', async () => {
    const rlsError = { code: '42501', message: 'permission denied for table user_profiles' };
    resultForTable = () => ({ data: null, error: rlsError });
    const { error } = await selectProfiles((from) => from.select('*'));
    expect(error).toBe(rlsError);
    expect(fromCalls).toEqual(['public_profiles']);

    // Next call still probes the view (verdict was not set to fallback).
    resultForTable = () => ({ data: ROWS, error: null });
    await selectProfiles((from) => from.select('*'));
    expect(fromCalls).toEqual(['public_profiles', 'public_profiles']);
  });

  it('surfaces a 42703 missing-column error WITHOUT falling back', async () => {
    // This test used to accept the fallback, on the reasoning that "the same
    // column is missing on both relations, so it is harmless". Production
    // falsified that premise: `display_name` exists on user_profiles and was
    // missing from the deployed public_profiles view, so the fallback was not
    // harmless at all — it silently re-ran every cross-user read against a
    // table whose only SELECT policy is `auth.uid() = id`, which answers 200
    // with the caller's own row and nothing else.
    //
    // A missing COLUMN must surface. Only a missing RELATION may fall back.
    const colError = { code: '42703', message: 'column public_profiles.bogus does not exist' };
    resultForTable = () => ({ data: null, error: colError });
    const { error } = await selectProfiles((from) => from.select('bogus'));
    expect(error).toBe(colError);
    expect(fromCalls).toEqual(['public_profiles']);

    // …and the verdict must not be poisoned: the next call still probes the view.
    resultForTable = () => ({ data: ROWS, error: null });
    await selectProfiles((from) => from.select('*'));
    expect(fromCalls).toEqual(['public_profiles', 'public_profiles']);
  });

  it('still falls back on a code-less error that names the missing view', async () => {
    // The deploy-window case the substring probe was written for: PostgREST
    // can answer before its schema cache has a code to give.
    resultForTable = (table) =>
      table === 'public_profiles'
        ? { data: null, error: { message: 'relation public_profiles does not exist' } }
        : { data: ROWS, error: null };
    const { data, error } = await selectProfiles((from) => from.select('*'));
    expect(error).toBeNull();
    expect(data).toEqual(ROWS);
    expect(fromCalls).toEqual(['public_profiles', 'user_profiles']);
  });
});

describe('list', () => {
  it('returns rows from the view', async () => {
    const rows = await list();
    expect(rows).toEqual(ROWS);
    expect(fromCalls).toEqual(['public_profiles']);
  });

  it('throws on a real error', async () => {
    resultForTable = () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(list()).rejects.toMatchObject({ code: '42501' });
  });
});

describe('listByIds', () => {
  // The followers sheet used to list() every profile and filter in memory,
  // which downloaded the whole table and dropped anyone past the row limit.
  it('asks only for the ids it was given, once each', async () => {
    const rows = await listByIds(['u1', 'u2', 'u1', null, undefined]);
    expect(rows).toEqual(ROWS);
    expect(inCalls).toEqual([['id', ['u1', 'u2']]]);
  });

  it('splits a long id list into requests of 100', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    await listByIds(ids);
    expect(inCalls.map(([, v]) => v.length)).toEqual([100, 100, 50]);
    expect(inCalls.flatMap(([, v]) => v)).toEqual(ids);
  });

  it('makes no request for an empty list', async () => {
    expect(await listByIds([])).toEqual([]);
    expect(fromCalls).toEqual([]);
  });

  it('throws on a real error', async () => {
    resultForTable = () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(listByIds(['u1'])).rejects.toMatchObject({ code: '42501' });
  });
});

// The old db.entities.User.list() ran the same view read. Every caller now
// uses list() above, and this fails if one comes back.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

describe('one door to user profiles', () => {
  it('no source file touches db.entities.User', () => {
    const root = join(process.cwd(), 'src');
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'i18n-langs') walk(p); continue; }
        if (!/\.(jsx?|tsx?)$/.test(name)) continue;
        const code = readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '');
        if (/entities\s*\.\s*User\b/.test(code)) offenders.push(relative(root, p));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
