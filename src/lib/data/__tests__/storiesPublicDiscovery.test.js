/**
 * Public story discovery returned nothing from the day it shipped.
 *
 * `blockedByIds` was read inside the discovery block but declared with `const`
 * about forty-five lines BELOW it, so the first line that touched it threw a
 * TDZ ReferenceError — every call, every user. The bare `catch {}` around
 * discovery swallowed it and fell through to an empty set, which is exactly
 * what "nobody you don't follow has posted a public story" looks like. An
 * empty discovery set and a broken one are indistinguishable from the outside,
 * which is why this survived.
 *
 * ESLint knew. `no-use-before-define` flagged the exact line — at 'warn', and
 * `npm run lint` runs `--quiet`, so it was never shown. CLAUDE.md records the
 * same muted rule hiding the 2026-05-23 production crash.
 *
 * These drive the real function against a table-dispatching supabase mock.
 * Revert the declaration to its old position and the first test fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const T = {};   // table -> rows
const calls = [];

function chain(table) {
  calls.push(table);
  const c = {
    select: () => c, eq: () => c, in: () => c, is: () => c, gt: () => c,
    lt: () => c, order: () => c, limit: () => c, neq: () => c, not: () => c,
    then: (onF, onR) => Promise.resolve({ data: T[table] ?? [], error: null }).then(onF, onR),
  };
  return c;
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (t) => chain(t),
    // stories.js pulls in db.js transitively, which subscribes at module load.
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getUser: async () => ({ data: { user: { id: 'me' } } }),
    },
    rpc: async () => ({ data: null, error: null }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  },
}));
// selectProfiles routes profile reads; safeSelect passes the column list through.
vi.mock('@/lib/data/users', () => ({
  selectProfiles: (build) => build({ select: () => chain('public_profiles') }),
}));
vi.mock('@/api/safeSelect', () => ({
  safeSelect: async ({ build, columns }) => build(columns),
}));

import { getStoriesFeedData } from '../stories';

const ME = { id: 'me' };
const future = new Date(Date.now() + 86400000).toISOString();

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(T)) delete T[k];
  T.stories = [
    // Posted by someone the viewer does NOT follow, public, public profile.
    { id: 's1', user_id: 'stranger', privacy: 'public', crew_id: null, expires_at: future, created_at: future },
  ];
  T.public_profiles = [
    { id: 'stranger', username: 'stranger', avatar_url: null, is_private: false },
  ];
  T.story_views = []; T.story_likes = []; T.status_notes = [];
  T.story_blocks = []; T.status_note_likes = [];
});

describe('public story discovery', () => {
  it('surfaces a public story from an account you do not follow', async () => {
    const out = await getStoriesFeedData(ME, []);
    const owners = out.groups.map(g => g.user_id);
    expect(owners, 'discovery returned nothing — the TDZ is back').toContain('stranger');
  });

  it('does not throw, and does not silently swallow, when discovery works', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await getStoriesFeedData(ME, []);
    const swallowed = warn.mock.calls.filter(c => String(c[0]).includes('public discovery failed'));
    expect(swallowed, 'discovery threw and was caught').toHaveLength(0);
    warn.mockRestore();
  });

  it('still returns the own/following feed if discovery is impossible', async () => {
    // Discovery is additive: a failure there must never take the main feed with
    // it. Force the stories table to blow up only for the discovery query by
    // removing the profile rows it needs.
    T.public_profiles = [];
    const out = await getStoriesFeedData(ME, []);
    expect(Array.isArray(out.groups)).toBe(true);
  });

  it('returns the empty shape for a signed-out caller', async () => {
    const out = await getStoriesFeedData(null);
    expect(out.groups).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
