// Tests for src/lib/data/crewDirectory.js.
//
// Three things worth locking in.
//
// First, the module must have NO write path. Member count, combined volume and
// rank are all server-derived (migration 308, SECURITY DEFINER), and a
// client-computed ranking would be both wrong and forgeable. If a future change
// adds a .from(...).insert/update here, the "reads only" test fails.
//
// Second, rank must survive the trip untouched. Rows come back as top-N plus a
// window around the caller's crew, so the ranks are deliberately
// non-contiguous — anything that renumbers them from the array index breaks the
// only number on that screen that has to be true.
//
// Third, a host that hasn't run 308 yet must degrade to the empty shape rather
// than throw. The Netlify deploy lands before the SQL does, every time.
//
// Mock shape mirrors crewSeasons.test.js.

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
  listPublicCrews,
  getTopCrews,
  joinStateFor,
  CREW_SORTS,
  CREW_METRICS,
} = await import('../crewDirectory');

beforeEach(() => {
  rpcSpy.mockReset();
  fromSpy.mockReset();
});

// ── listPublicCrews ──────────────────────────────────────────────────────────

describe('listPublicCrews', () => {
  it('calls get_public_crews and returns the rows verbatim', async () => {
    const rows = [
      { id: 'a', name: 'Iron', member_count: 12, max_capacity: 16, total_volume_lbs: 2400 },
    ];
    rpcSpy.mockResolvedValue({ data: rows, error: null });

    const out = await listPublicCrews({ query: 'iron', sort: 'members', limit: 30, offset: 0 });

    expect(rpcSpy).toHaveBeenCalledWith('get_public_crews', {
      p_query:  'iron',
      p_sort:   'members',
      p_limit:  30,
      p_offset: 0,
    });
    expect(out).toEqual(rows);
  });

  it('sends null rather than an empty string for a blank query', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    await listPublicCrews({ query: '' });
    expect(rpcSpy.mock.calls[0][1].p_query).toBeNull();
  });

  it('falls back to volume when handed a sort the server does not accept', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    await listPublicCrews({ sort: 'trophies; DROP TABLE crews' });
    expect(rpcSpy.mock.calls[0][1].p_sort).toBe('volume');
    expect(CREW_SORTS).toContain('volume');
  });

  it('returns [] when the RPC is not deployed yet', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42883' } });
    await expect(listPublicCrews()).resolves.toEqual([]);
  });

  it('returns [] on any other error rather than throwing', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42501', message: 'nope' } });
    await expect(listPublicCrews()).resolves.toEqual([]);
  });
});

// ── getTopCrews ──────────────────────────────────────────────────────────────

describe('getTopCrews', () => {
  it('maps the board payload and preserves server ranks', async () => {
    rpcSpy.mockResolvedValue({
      data: {
        metric: 'volume',
        my_rank: 41,
        total: 120,
        // Non-contiguous on purpose: top 3, then the window around my crew.
        rows: [
          { rank: 1,  id: 'a', value: 900 },
          { rank: 2,  id: 'b', value: 800 },
          { rank: 3,  id: 'c', value: 700 },
          { rank: 40, id: 'd', value: 12 },
          { rank: 41, id: 'e', value: 11, is_member: true },
          { rank: 42, id: 'f', value: 10 },
        ],
      },
      error: null,
    });

    const board = await getTopCrews({ metric: 'volume', limit: 25 });

    expect(rpcSpy).toHaveBeenCalledWith('get_top_crews', { p_metric: 'volume', p_limit: 25 });
    expect(board.myRank).toBe(41);
    expect(board.total).toBe(120);
    expect(board.rows.map(r => r.rank)).toEqual([1, 2, 3, 40, 41, 42]);
  });

  it('falls back to volume for an unknown metric', async () => {
    rpcSpy.mockResolvedValue({ data: { metric: 'volume', rows: [] }, error: null });
    await getTopCrews({ metric: 'bench' });
    expect(rpcSpy.mock.calls[0][1].p_metric).toBe('volume');
    expect(CREW_METRICS).toEqual(['volume', 'trophies', 'points']);
  });

  it('returns the empty board when the RPC is not deployed yet', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42P01' } });
    const board = await getTopCrews();
    expect(board.rows).toEqual([]);
    expect(board.myRank).toBeNull();
    expect(board.total).toBe(0);
  });

  it('reports no rank rather than 0 for a caller in no crew', async () => {
    rpcSpy.mockResolvedValue({ data: { metric: 'volume', my_rank: null, total: 4, rows: [] }, error: null });
    const board = await getTopCrews();
    // 0 would render as "#0 of 4". Null is the only honest answer.
    expect(board.myRank).toBeNull();
  });
});

// ── joinStateFor ─────────────────────────────────────────────────────────────

describe('joinStateFor', () => {
  const crew = (over = {}) => ({ member_count: 3, max_capacity: 16, ...over });

  it('offers Join on a crew with room', () => {
    expect(joinStateFor(crew())).toBe('join');
  });

  it('reports your own crew before anything else', () => {
    // is_member wins over full: your crew being full doesn't make it joinable
    // or un-yours.
    expect(joinStateFor(crew({ is_member: true, member_count: 16 }))).toBe('member');
  });

  it('reports a pending request over the join affordance', () => {
    expect(joinStateFor(crew(), { requested: true })).toBe('requested');
  });

  it('reports full at capacity, not just above it', () => {
    expect(joinStateFor(crew({ member_count: 16 }))).toBe('full');
    expect(joinStateFor(crew({ member_count: 15 }))).toBe('join');
  });

  it('blocks the action when the viewer is already in a crew', () => {
    // Migration 252: one crew per user. The server refuses either way.
    expect(joinStateFor(crew(), { inACrew: true })).toBe('blocked');
  });

  it('still reports full ahead of blocked', () => {
    // A full crew is full for everyone; saying "leave your crew first" about a
    // crew that could not take them is the wrong sentence.
    expect(joinStateFor(crew({ member_count: 16 }), { inACrew: true })).toBe('full');
  });

  it('defaults capacity to 16 when the row omits it', () => {
    expect(joinStateFor({ member_count: 16 })).toBe('full');
  });
});

// ── No write path ────────────────────────────────────────────────────────────

describe('crewDirectory has no client write path', () => {
  it('never touches supabase.from()', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    await listPublicCrews();
    rpcSpy.mockResolvedValue({ data: { rows: [] }, error: null });
    await getTopCrews();
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
