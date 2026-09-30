// getMyLeagueLevel reads your resolved weeks and hands them to
// leagueLevel(). What is worth pinning is the query (your own rows, resolved
// brackets only) and that it can never break the league card: any failure
// answers level 1.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let result = { data: [], error: null };

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
    from: (table) => {
      calls.push(['from', table]);
      const chain = {
        select: (cols) => { calls.push(['select', cols]); return chain; },
        eq: (col, val) => { calls.push(['eq', col, val]); return chain; },
        order: (col, opts) => { calls.push(['order', col, opts]); return chain; },
        limit: (n) => { calls.push(['limit', n]); return Promise.resolve(result); },
      };
      return chain;
    },
  },
}));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const { getMyLeagueLevel } = await import('../leagues');
const USER = { id: 'u1' };
const row = (tier, week, qualified) => ({ qualified, joined_at: week, leagues: { tier, week_start: week, is_resolved: true } });

beforeEach(() => {
  calls.length = 0;
  result = { data: [], error: null };
});

describe('getMyLeagueLevel', () => {
  it('reads only your own resolved weeks', async () => {
    await getMyLeagueLevel(USER, 'silver');
    expect(calls).toContainEqual(['from', 'league_members']);
    expect(calls).toContainEqual(['eq', 'user_id', 'u1']);
    expect(calls).toContainEqual(['eq', 'leagues.is_resolved', true]);
  });

  it('counts qualified weeks in the current league, newest first', async () => {
    // Deliberately out of order: the stint is decided by week_start.
    result = {
      data: [
        row('bronze', '2026-09-07', true),
        row('silver', '2026-09-21', true),
        row('silver', '2026-09-14', true),
      ],
      error: null,
    };
    expect(await getMyLeagueLevel(USER, 'silver')).toBe(3);
    expect(await getMyLeagueLevel(USER, 'gold')).toBe(1);
  });

  it('answers level 1 on an error or without a user', async () => {
    result = { data: null, error: { message: 'nope' } };
    expect(await getMyLeagueLevel(USER, 'silver')).toBe(1);
    expect(await getMyLeagueLevel(null, 'silver')).toBe(1);
    expect(await getMyLeagueLevel(USER, null)).toBe(1);
  });
});
