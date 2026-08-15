// Tests for getCrewMemberCount in src/lib/data/crews.js.
//
// The contract that matters is the NULL, not the number. `crews` has no
// member_count column, so this is a derived head count — and a caller
// that cannot tell "the read failed" from "the crew is empty" renders
// "0 lifters" at a crew that has six. Every other count in this app that
// went wrong went wrong in exactly that direction (see the
// gym_businesses.member_count drift in CLAUDE.md), so the failure path
// returns null and the UI drops the cell.
//
// It also has to be a HEAD count. The Crew Wars sheet wants one integer,
// and pulling every member row to call .length on it is a payload for a
// number the server can send on its own.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (...a) => fromSpy(...a), auth: { getUser: vi.fn() } },
}));

// crews.js imports @/api/db, which registers a supabase.auth.onAuthStateChange
// listener at MODULE SCOPE — so importing it against a stubbed client throws
// before any test runs. Same stub set as crewsLeaveJoin.test.js; see the
// Profile cache section of CLAUDE.md for why db.js is the one module a data
// test can never let through.
vi.mock('@/api/safeSelect', () => ({ safeSelect: async () => ({ data: [], error: null }) }));
vi.mock('@/lib/data/users', () => ({ selectProfiles: async () => ({ data: [] }) }));
vi.mock('@/api/db', () => ({ db: { entities: {} } }));
vi.mock('@/lib/imageCompress', () => ({ compressImage: async (f) => f }));
vi.mock('@/lib/profanityFilter', () => ({ containsProfanity: () => false }));

const { getCrewMemberCount } = await import('../crews');

// Records the arguments each link in the chain was called with, so a test
// can assert on the STATEMENT rather than only on the value it returned.
function mockCount(result) {
  const calls = { select: null, eq: null, table: null };
  fromSpy.mockImplementation((table) => {
    calls.table = table;
    return {
      select: (cols, opts) => {
        calls.select = { cols, opts };
        return {
          eq: (col, val) => {
            calls.eq = { col, val };
            return Promise.resolve(result);
          },
        };
      },
    };
  });
  return calls;
}

beforeEach(() => {
  fromSpy.mockReset();
});

describe('getCrewMemberCount', () => {
  it('asks for a head count, not the rows', async () => {
    const calls = mockCount({ count: 6, error: null });
    await getCrewMemberCount('c1');

    expect(calls.table).toBe('crew_members');
    expect(calls.select.opts).toEqual({ count: 'exact', head: true });
    expect(calls.eq).toEqual({ col: 'crew_id', val: 'c1' });
  });

  it('returns the count', async () => {
    mockCount({ count: 6, error: null });
    expect(await getCrewMemberCount('c1')).toBe(6);
  });

  it('returns null — not 0 — when the read fails', async () => {
    mockCount({ count: null, error: { code: '42501' } });
    expect(await getCrewMemberCount('c1')).toBeNull();
  });

  it('returns null when supabase reports no count at all', async () => {
    mockCount({ count: null, error: null });
    expect(await getCrewMemberCount('c1')).toBeNull();
  });

  it('short-circuits without a crew id', async () => {
    mockCount({ count: 6, error: null });
    expect(await getCrewMemberCount(null)).toBeNull();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('reports a genuinely empty crew as 0, which is not the failure case', async () => {
    mockCount({ count: 0, error: null });
    expect(await getCrewMemberCount('c1')).toBe(0);
  });
});
