// The card says "N trophies". There are two numbers it could mean, and for
// a while it showed the wrong one.
//
// `crews.trophies` is WAR RENOWN: `award_crew_progress` raises it by 30 on
// a win, so the first crew to win a war in production read "30 trophies"
// while its shelf held nothing. `crew_trophies` (migration 367) is the
// shelf — one row per unique award, which is what the Trophies tab renders.
//
// These pin the counting, because the failure mode is silent: both are
// integers, both are plausible on a card, and only one is true.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const inSpy     = vi.fn();
const selectSpy = vi.fn();
const fromSpy   = vi.fn();

vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (...a) => fromSpy(...a) },
}));

const { getCrewTrophyCounts } = await import('../crewTrophies');

function mockRows({ data, error = null }) {
  inSpy.mockResolvedValue({ data, error });
  selectSpy.mockReturnValue({ in: inSpy });
  fromSpy.mockReturnValue({ select: selectSpy });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('getCrewTrophyCounts', () => {
  it('counts shelf rows per crew, not war renown', async () => {
    mockRows({ data: [
      { crew_id: 'a' }, { crew_id: 'a' }, { crew_id: 'b' },
    ] });
    expect(await getCrewTrophyCounts(['a', 'b'])).toEqual({ a: 2, b: 1 });
    expect(fromSpy).toHaveBeenCalledWith('crew_trophies');
  });

  it('omits a crew with an empty shelf rather than inventing a zero row', async () => {
    mockRows({ data: [{ crew_id: 'a' }] });
    const counts = await getCrewTrophyCounts(['a', 'b']);
    expect(counts.b).toBeUndefined();   // callers apply ?? 0 at the render site
  });

  it('returns {} for no ids without hitting the network', async () => {
    expect(await getCrewTrophyCounts([])).toEqual({});
    expect(await getCrewTrophyCounts(null)).toEqual({});
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('deduplicates ids, so one crew twice is still one filter entry', async () => {
    mockRows({ data: [] });
    await getCrewTrophyCounts(['a', 'a', 'b']);
    expect(inSpy).toHaveBeenCalledWith('crew_id', ['a', 'b']);
  });

  it('treats an unapplied migration 367 as an empty shelf, not an error', async () => {
    // 42P01 = undefined_table. A host without the migration has no trophies,
    // which is a true statement; the card should render nothing, not break.
    mockRows({ data: null, error: { code: '42P01' } });
    expect(await getCrewTrophyCounts(['a'])).toEqual({});
  });
});
