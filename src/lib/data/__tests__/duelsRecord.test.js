// A Session Duel is someone taking on your last workout without asking you.
// It belongs on the record of the person who started it and never counts as
// a loss for the person taken on (duels audit, round two).

import { describe, it, expect, vi } from 'vitest';

const calls = [];
vi.mock('@/api/supabaseClient', () => {
  const chain = (table) => {
    const q = {
      _table: table,
      select: (cols) => { calls.push(['select', table, cols]); return q; },
      or: (f) => { calls.push(['or', table, f]); return q; },
      in: () => q,
      gt: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res) => res({ data: [], error: null }),
    };
    return q;
  };
  return {
    supabase: {
      from: chain,
      auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) },
      rpc: async () => ({ data: null, error: null }),
    },
  };
});
vi.mock('@/lib/data/users', () => ({ selectProfiles: async () => ({ data: [] }) }));
vi.mock('@/lib/data/hubMessages', () => ({ findOrCreateConversation: vi.fn(), sendMessage: vi.fn() }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const { countsTowardRecord, getActiveDuel } = await import('@/lib/data/duels');

describe('countsTowardRecord', () => {
  it('counts every live duel for both sides', () => {
    const d = { mode: 'live', challenger_id: 'a', opponent_id: 'b' };
    expect(countsTowardRecord(d, 'a')).toBe(true);
    expect(countsTowardRecord(d, 'b')).toBe(true);
  });

  it('counts a session duel for the challenger only', () => {
    const d = { mode: 'session', challenger_id: 'a', opponent_id: 'b' };
    expect(countsTowardRecord(d, 'a')).toBe(true);
    expect(countsTowardRecord(d, 'b')).toBe(false);
  });
});

describe('getActiveDuel', () => {
  it('asks only for duels that need the caller', async () => {
    calls.length = 0;
    await getActiveDuel();
    const filter = calls.find(([k, t]) => k === 'or' && t === 'duels')?.[2];
    // Running duels, except a Session Duel where the caller is taken on,
    // plus challenges waiting for the caller's answer. A challenge the
    // caller sent and nobody has answered does not badge the Workout page.
    expect(filter).toBe(
      'and(status.eq.active,challenger_id.eq.me),'
      + 'and(status.eq.active,opponent_id.eq.me,mode.eq.live),'
      + 'and(status.eq.pending,opponent_id.eq.me)',
    );
  });
});
