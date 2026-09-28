import { describe, it, expect, beforeEach, vi } from 'vitest';

// Chainable supabase mock (same shape as injuries.test.js) — captures
// the .in() / .eq() args so we can assert the batched query shape, and
// returns whatever the test stages in _state.nextData.
const _state = {
  lastTable: null,
  lastIn: null,
  lastEq: null,
  queryCount: 0,
  nextData: null,
  nextError: null,
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      _state.lastTable = table;
      return {
        select: () => ({
          in: (col, vals) => {
            _state.lastIn = { col, vals };
            return {
              eq: (ecol, eval_) => {
                _state.lastEq = { col: ecol, val: eval_ };
                return {
                  order: () => {
                    _state.queryCount += 1;
                    return Promise.resolve({ data: _state.nextData, error: _state.nextError });
                  },
                };
              },
              order: () => ({
                limit: () => {
                  _state.queryCount += 1;
                  return Promise.resolve({ data: _state.nextData, error: _state.nextError });
                },
              }),
            };
          },
        }),
      };
    },
    rpc: async () => ({ data: null, error: null }),
  },
}));

vi.mock('@/lib/data/ownedRows', () => ({ ownedRows: () => ({}) }));

vi.mock('../hubPosts', () => ({
  incrementCounter: vi.fn(),
}));

import * as hubReactions from '../hubReactions';
import * as stickerReactions from '../stickerReactions';

beforeEach(() => {
  _state.lastTable = null;
  _state.lastIn = null;
  _state.lastEq = null;
  _state.queryCount = 0;
  _state.nextData = null;
  _state.nextError = null;
});

describe('hubReactions batched my-reaction reads', () => {
  it('collapses same-tick getMyReaction + getMyEmojiReaction across posts into one query', async () => {
    // Rows come back newest-first (the query orders -created_date).
    _state.nextData = [
      { id: 'r1', post_id: 'p1', reaction_type: 'like', emoji: 'like', created_by: 'kegan@x.com' },
      { id: 'r2', post_id: 'p1', reaction_type: null, emoji: '🔥', created_by: 'kegan@x.com' },
      { id: 'r3', post_id: 'p2', reaction_type: null, emoji: '💪', created_by: 'kegan@x.com' },
    ];

    const email = 'kegan@x.com';
    const [mine1, emoji1, mine2, emoji2] = await Promise.all([
      hubReactions.getMyReaction('p1', email),
      hubReactions.getMyEmojiReaction('p1', email),
      hubReactions.getMyReaction('p2', email),
      hubReactions.getMyEmojiReaction('p2', email),
    ]);

    // Four reads, ONE round-trip.
    expect(_state.queryCount).toBe(1);
    expect(_state.lastTable).toBe('hub_reactions');
    expect(_state.lastIn.col).toBe('post_id');
    expect(_state.lastIn.vals).toEqual(['p1', 'p2']);
    expect(_state.lastEq).toEqual({ col: 'created_by', val: email });

    expect(mine1?.id).toBe('r1'); // newest row for p1
    expect(emoji1).toBe('🔥');    // newest reaction_type-null row for p1
    expect(mine2?.id).toBe('r3');
    expect(emoji2).toBe('💪');
  });

  it('returns null (not a throw) when the batched query errors', async () => {
    _state.nextError = { message: 'boom' };
    const result = await hubReactions.getMyReaction('p9', 'err@x.com');
    expect(result).toBeNull();
  });

  it('returns null without querying when args are missing', async () => {
    expect(await hubReactions.getMyReaction(null, 'a@x.com')).toBeNull();
    expect(await hubReactions.getMyEmojiReaction('p1', null)).toBeNull();
    expect(_state.queryCount).toBe(0);
  });
});

describe('stickerReactions batched getPostReactions', () => {
  it('collapses same-tick calls into one IN query and groups per post in chronological order', async () => {
    // Newest-first, mixed posts — mirrors the batched query's ordering.
    _state.nextData = [
      { id: 's3', post_id: 'p1', variant: 'diamond', created_at: '2026-07-15T03:00:00Z' },
      { id: 's2', post_id: 'p2', variant: null, created_at: '2026-07-15T02:00:00Z' },
      { id: 's1', post_id: 'p1', variant: null, created_at: '2026-07-15T01:00:00Z' },
    ];

    const [p1Rxns, p2Rxns] = await Promise.all([
      stickerReactions.getPostReactions('p1'),
      stickerReactions.getPostReactions('p2'),
    ]);

    expect(_state.queryCount).toBe(1);
    expect(_state.lastTable).toBe('post_sticker_reactions');
    expect(_state.lastIn.vals).toEqual(['p1', 'p2']);

    // Per-post, oldest-first (UI display order).
    expect(p1Rxns.map((r) => r.id)).toEqual(['s1', 's3']);
    expect(p2Rxns.map((r) => r.id)).toEqual(['s2']);
  });

  it('returns [] for a post with no reactions in the batch result', async () => {
    _state.nextData = [];
    const rxns = await stickerReactions.getPostReactions('lonely-post');
    expect(rxns).toEqual([]);
  });
});
