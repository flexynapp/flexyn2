// Tests for src/lib/data/storyPolls.js — the client wrappers around
// mig 112's cast_story_poll_vote / story_poll_results RPCs + the
// per-viewer getMyVote read. Mocks supabase.rpc + .from to verify
// call shape and the pre-112-host graceful degradation.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy = vi.fn();
const fromSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => rpcSpy(...args),
    from: (...args) => fromSpy(...args),
  },
}));

const { castVote, getResults, getMyVote } = await import('../storyPolls');

beforeEach(() => {
  rpcSpy.mockReset();
  fromSpy.mockReset();
});

describe('castVote', () => {
  it('throws when storyId or optionId is missing', async () => {
    await expect(castVote(null, 'a')).rejects.toThrow();
    await expect(castVote('s1', null)).rejects.toThrow();
  });

  it('calls the cast_story_poll_vote RPC with both ids', async () => {
    rpcSpy.mockResolvedValueOnce({ error: null });
    await castVote('s1', 'a');
    expect(rpcSpy).toHaveBeenCalledWith('cast_story_poll_vote', {
      p_story_id:  's1',
      p_option_id: 'a',
    });
  });

  it('throws when the RPC returns an error', async () => {
    rpcSpy.mockResolvedValueOnce({ error: { code: '22023', message: 'invalid_args' } });
    await expect(castVote('s1', '')).rejects.toBeTruthy();
  });
});

describe('getResults', () => {
  it('returns a Map of option_id → count', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: [
        { option_id: 'a', vote_count: 12 },
        { option_id: 'b', vote_count: 7 },
      ],
      error: null,
    });
    const m = await getResults('s1');
    expect(m.get('a')).toBe(12);
    expect(m.get('b')).toBe(7);
    expect(m.get('c')).toBeUndefined();
  });

  it('returns an empty Map when storyId is missing', async () => {
    const m = await getResults(null);
    expect(m.size).toBe(0);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns an empty Map on a pre-112 host (42883)', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '42883' } });
    const m = await getResults('s1');
    expect(m.size).toBe(0);
  });

  it('returns an empty Map on any other RPC error (graceful failure)', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '50000', message: 'boom' } });
    const m = await getResults('s1');
    expect(m.size).toBe(0);
  });

  it('coerces non-numeric counts to 0', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: [{ option_id: 'a', vote_count: 'NaN' }],
      error: null,
    });
    const m = await getResults('s1');
    expect(m.get('a')).toBe(0);
  });
});

describe('getMyVote', () => {
  it('returns null when storyId or userId is missing', async () => {
    expect(await getMyVote(null, 'u1')).toBeNull();
    expect(await getMyVote('s1', null)).toBeNull();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('selects option_id scoped to story + voter', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { option_id: 'b' }, error: null });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    fromSpy.mockReturnValue({ select });

    const v = await getMyVote('s1', 'u1');
    expect(fromSpy).toHaveBeenCalledWith('story_poll_votes');
    expect(eq1).toHaveBeenCalledWith('story_id', 's1');
    expect(eq2).toHaveBeenCalledWith('voter_id', 'u1');
    expect(v).toBe('b');
  });

  it('returns null when no vote row exists', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    fromSpy.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
    });
    expect(await getMyVote('s1', 'u1')).toBeNull();
  });
});
