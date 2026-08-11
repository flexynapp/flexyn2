// getCrewFirstAchievers — the crew "First to Achieve" leaderboard.
//
// DEFECT PINNED. This read the retired `public.achievements` table, which
// holds ONE row in all of production, so the panel was empty for every
// crew. An earlier pass fixed the COLUMN names here (it had been
// filtering on `a.unlocked && a.unlocked_date`, neither of which exists)
// and left the source table behind — so the panel went from empty for one
// reason to empty for another, and an empty leaderboard reads as "this
// crew has achieved nothing" either way.
//
// Now reads `user_trophies` in a single query rather than one per member.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// A generic chainable supabase stub. Every builder method returns the
// builder; awaiting it resolves whatever `TABLES` holds for the table the
// chain started from. That keeps the test honest about WHICH table each
// query hits — the whole point of this regression — without hand-rolling
// a different mock per call chain.
const TABLES = {};
const calls = [];

function builder(table) {
  const b = {};
  const chain = (name) => (...args) => { calls.push({ table, name, args }); return b; };
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq']) b[m] = chain(m);
  b.then = (resolve) => resolve(TABLES[table] ?? { data: [], error: null });
  return b;
}
const from = vi.fn((table) => { calls.push({ table, name: 'from', args: [] }); return builder(table); });

vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (...a) => from(...a) } }));
vi.mock('@/api/safeSelect', () => ({
  safeSelect: async ({ build, columns }) => build(columns.join(',')),
}));
vi.mock('@/api/db', () => ({ db: { entities: {} } }));
vi.mock('@/lib/imageCompress', () => ({ compressImage: vi.fn() }));
vi.mock('@/lib/profanityFilter', () => ({ containsProfanity: () => false }));

const PROFILES = [
  { id: 'u1', username: 'ana', avatar_url: null },
  { id: 'u2', username: 'ben', avatar_url: null },
];
vi.mock('@/lib/data/users', () => ({
  selectProfiles: async () => ({ data: PROFILES, error: null }),
}));

const { getCrewFirstAchievers } = await import('@/lib/data/crews');

/** Tables the chain will see: crew members, then their trophies. */
const seed = (trophies, opts = {}) => {
  TABLES.crew_members = { data: [{ id: 'm1', user_id: 'u1' }, { id: 'm2', user_id: 'u2' }], error: null };
  TABLES.user_trophies = { data: trophies, error: opts.error ?? null };
};
const tablesHit = () => [...new Set(calls.filter(c => c.name === 'from').map(c => c.table))];

beforeEach(() => {
  from.mockClear(); calls.length = 0;
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  seed([]);
});

describe('getCrewFirstAchievers', () => {
  it('reads user_trophies, not the retired achievements table', async () => {
    await getCrewFirstAchievers('c1');
    expect(tablesHit()).toContain('user_trophies');
    expect(tablesHit()).not.toContain('achievements');
  });

  it('queries the whole crew in ONE round trip, not one per member', async () => {
    await getCrewFirstAchievers('c1');
    const trophyQueries = calls.filter(c => c.table === 'user_trophies' && c.name === 'from');
    expect(trophyQueries).toHaveLength(1);
    expect(calls.find(c => c.table === 'user_trophies' && c.name === 'in').args)
      .toEqual(['user_id', ['u1', 'u2']]);
  });

  it('credits the EARLIEST unlocker of each trophy', async () => {
    seed([
      { user_id: 'u2', trophy_id: 'first_rep', earned_at: '2026-08-09T10:00:00Z' },
      { user_id: 'u1', trophy_id: 'first_rep', earned_at: '2026-08-07T10:00:00Z' },
    ]);
    const out = await getCrewFirstAchievers('c1');
    expect(out).toHaveLength(1);
    expect(out[0].userId).toBe('u1');
    expect(out[0].unlockedAt).toBe('2026-08-07T10:00:00Z');
    expect(out[0].profile.username).toBe('ana');
  });

  it('sorts most-recent bragging rights first', async () => {
    seed([
      { user_id: 'u1', trophy_id: 'first_rep', earned_at: '2026-08-01T10:00:00Z' },
      { user_id: 'u2', trophy_id: 'crew_squad', earned_at: '2026-08-09T10:00:00Z' },
    ]);
    const out = await getCrewFirstAchievers('c1');
    expect(out.map(r => r.achievementId)).toEqual(['crew_squad', 'first_rep']);
  });

  it('does NOT filter on an `unlocked` flag — row presence is the unlock', async () => {
    // The shape that emptied this twice. A row carrying no such property
    // must still count.
    seed([{ user_id: 'u1', trophy_id: 'first_rep', earned_at: '2026-08-07T10:00:00Z' }]);
    expect(await getCrewFirstAchievers('c1')).toHaveLength(1);
  });

  it('skips rows for users who are not crew members', async () => {
    seed([
      { user_id: 'u9', trophy_id: 'first_rep', earned_at: '2026-08-01T10:00:00Z' },
      { user_id: 'u1', trophy_id: 'crew_squad', earned_at: '2026-08-07T10:00:00Z' },
    ]);
    const out = await getCrewFirstAchievers('c1');
    expect(out.map(r => r.achievementId)).toEqual(['crew_squad']);
  });

  it('degrades to [] on a read error rather than throwing at the panel', async () => {
    seed([], { error: { code: '42P01' } });
    expect(await getCrewFirstAchievers('c1')).toEqual([]);
  });

  it('returns [] for no crew and no members without querying', async () => {
    expect(await getCrewFirstAchievers(null)).toEqual([]);
    expect(tablesHit()).toEqual([]);
    TABLES.crew_members = { data: [], error: null };
    expect(await getCrewFirstAchievers('c1')).toEqual([]);
    expect(tablesHit()).not.toContain('user_trophies');
  });
});
