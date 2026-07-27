// Tests for src/lib/data/crewSeasons.js.
//
// Two things are worth locking in here.
//
// First, the module must have no write path. Standings are server-derived
// (award_crew_progress / roll_crew_seasons, both SECURITY DEFINER), and a
// client-computed ranking would be both wrong and forgeable — the same
// class of hole migrations 245-247 spent their length closing. If a future
// change adds a .from('crew_season_stats').update(...) here, the "reads
// only" test fails.
//
// Second, zoneForRow duplicates a server rule on purpose, so it has to
// stay honest about the small-league case: with fewer than MIN_DIVISION_SIZE
// crews the server promotes and relegates nobody, and the UI must not draw
// zones that will never fire.
//
// Mock shape mirrors crewWars.test.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy  = vi.fn();
const fromSpy = vi.fn();

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc:  (...args) => rpcSpy(...args),
    from: (...args) => fromSpy(...args),
    auth: { getUser: vi.fn() },
  },
}));

const {
  getDivisionStandings,
  zoneForRow,
  placingFor,
  xpForCrewLevel,
  crewLevelProgress,
  PROMOTION_SLOTS,
  RELEGATION_SLOTS,
  MIN_DIVISION_SIZE,
} = await import('../crewSeasons');

beforeEach(() => {
  rpcSpy.mockReset();
  fromSpy.mockReset();
});

const payload = (over = {}) => ({
  data: {
    season_number: 4,
    ends_at: '2026-08-24T00:00:00Z',
    division: 3,
    rows: [
      { crew_id: 'a', name: 'Barbell Cult', points: 2840 },
      { crew_id: 'b', name: 'Iron Union',   points: 2604 },
    ],
    ...over,
  },
  error: null,
});

// ─────────────────────────────────────────────────────────────────────
// getDivisionStandings
// ─────────────────────────────────────────────────────────────────────
describe('getDivisionStandings', () => {
  it('short-circuits on a falsy crew id without hitting the network', async () => {
    expect(await getDivisionStandings(null)).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('passes the crew id through and normalises the payload', async () => {
    rpcSpy.mockResolvedValue(payload());
    const res = await getDivisionStandings('crew-1');

    expect(rpcSpy).toHaveBeenCalledWith('get_crew_division_standings', {
      p_crew_id: 'crew-1',
    });
    expect(res).toEqual({
      seasonNumber: 4,
      endsAt: '2026-08-24T00:00:00Z',
      division: 3,
      rows: [
        { crew_id: 'a', name: 'Barbell Cult', points: 2840 },
        { crew_id: 'b', name: 'Iron Union',   points: 2604 },
      ],
    });
  });

  it('returns null when the crew is not seated in a division', async () => {
    rpcSpy.mockResolvedValue(payload({ division: null, rows: [] }));
    expect(await getDivisionStandings('crew-1')).toBeNull();
  });

  it('returns null (quietly) when migration 248 is not deployed yet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const code of ['42883', '42P01']) {
      rpcSpy.mockResolvedValue({ data: null, error: { code } });
      expect(await getDivisionStandings('crew-1')).toBeNull();
    }
    // A missing RPC is an expected deploy-window state, not a defect.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns and returns null on a real failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42501' } });
    expect(await getDivisionStandings('crew-1')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('coerces a non-array rows payload rather than propagating it', async () => {
    rpcSpy.mockResolvedValue(payload({ rows: 'nope' }));
    expect((await getDivisionStandings('crew-1')).rows).toEqual([]);
  });

  it('never writes — reads go through the RPC only', async () => {
    rpcSpy.mockResolvedValue(payload());
    await getDivisionStandings('crew-1');
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// zoneForRow — mirrors roll_crew_seasons
// ─────────────────────────────────────────────────────────────────────
describe('zoneForRow', () => {
  const BIG = 20;

  it('marks the top three as promotion outside division 1', () => {
    for (let i = 0; i < PROMOTION_SLOTS; i++) {
      expect(zoneForRow(i, BIG, 3)).toBe('promotion');
    }
    expect(zoneForRow(PROMOTION_SLOTS, BIG, 3)).toBeNull();
  });

  it('never promotes out of division 1 — it is the top tier', () => {
    expect(zoneForRow(0, BIG, 1)).toBeNull();
    expect(zoneForRow(1, BIG, 1)).toBeNull();
  });

  it('still relegates from division 1', () => {
    expect(zoneForRow(BIG - 1, BIG, 1)).toBe('relegation');
  });

  it('marks the bottom three as relegation', () => {
    for (let i = BIG - RELEGATION_SLOTS; i < BIG; i++) {
      expect(zoneForRow(i, BIG, 3)).toBe('relegation');
    }
    expect(zoneForRow(BIG - RELEGATION_SLOTS - 1, BIG, 3)).toBeNull();
  });

  it('draws no zones in a division below the server minimum', () => {
    // Flexyn has three crews in production today. Promising promotion the
    // server will never grant is worse than promising nothing.
    const small = MIN_DIVISION_SIZE - 1;
    for (let i = 0; i < small; i++) {
      expect(zoneForRow(i, small, 3)).toBeNull();
    }
  });

  it('degrades to null on non-finite input', () => {
    expect(zoneForRow(undefined, 20, 3)).toBeNull();
    expect(zoneForRow(0, undefined, 3)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// placingFor
// ─────────────────────────────────────────────────────────────────────
describe('placingFor', () => {
  const standings = {
    rows: [{ crew_id: 'a' }, { crew_id: 'b' }, { crew_id: 'c' }],
  };

  it('is 1-indexed', () => {
    expect(placingFor(standings, 'a')).toBe(1);
    expect(placingFor(standings, 'c')).toBe(3);
  });

  it('returns null for an absent crew or missing standings', () => {
    expect(placingFor(standings, 'zzz')).toBeNull();
    expect(placingFor(null, 'a')).toBeNull();
    expect(placingFor({}, 'a')).toBeNull();
    expect(placingFor(standings, null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Level curve — must match crew_level_for_xp in migration 248
// ─────────────────────────────────────────────────────────────────────
describe('xpForCrewLevel', () => {
  it('matches the server curve of 100 * L * (L - 1)', () => {
    expect(xpForCrewLevel(1)).toBe(0);
    expect(xpForCrewLevel(2)).toBe(200);
    expect(xpForCrewLevel(5)).toBe(2000);
    expect(xpForCrewLevel(10)).toBe(9000);
    expect(xpForCrewLevel(12)).toBe(13200);
  });

  it('floors at level 1 for junk input', () => {
    expect(xpForCrewLevel(0)).toBe(0);
    expect(xpForCrewLevel(-4)).toBe(0);
    expect(xpForCrewLevel(undefined)).toBe(0);
  });
});

describe('crewLevelProgress', () => {
  it('reports progress through the current level', () => {
    // Level 5 spans 2,000 -> 3,000. At 2,500 that is exactly halfway.
    const p = crewLevelProgress({ crew_xp: 2500, crew_level: 5 });
    expect(p.into).toBe(500);
    expect(p.span).toBe(1000);
    expect(p.pct).toBeCloseTo(0.5);
  });

  it('clamps rather than overflowing when xp runs past the level', () => {
    const p = crewLevelProgress({ crew_xp: 99999, crew_level: 2 });
    expect(p.pct).toBe(1);
  });

  it('returns nulls on a pre-248 crew so the bar can be skipped', () => {
    expect(crewLevelProgress({}).pct).toBeNull();
    expect(crewLevelProgress(null).pct).toBeNull();
    expect(crewLevelProgress({ crew_xp: 10 }).pct).toBeNull();
  });
});
