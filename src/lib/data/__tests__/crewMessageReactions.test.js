import { describe, it, expect, beforeEach, vi } from 'vitest';

// Chainable supabase mock — captures the .in() args and returns staged rows.
const _state = {
  lastTable: null,
  lastIn: null,
  queryCount: 0,
  nextData: [],
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
            _state.queryCount += 1;
            return Promise.resolve({ data: _state.nextData, error: _state.nextError });
          },
        }),
      };
    },
    rpc: async () => ({ data: null, error: null }),
  },
}));

import * as crewRxns from '../crewMessageReactions';

beforeEach(() => {
  _state.lastTable = null;
  _state.lastIn = null;
  _state.queryCount = 0;
  _state.nextData = [];
  _state.nextError = null;
});

describe('getReactionsForMessage (batched)', () => {
  it('collapses same-tick single-message calls into one IN query', async () => {
    _state.nextData = [
      { message_id: 'm1', user_id: 'u1', emoji: '🔥' },
      { message_id: 'm1', user_id: 'u2', emoji: '💪' },
      { message_id: 'm3', user_id: 'u1', emoji: '👏' },
    ];

    const [m1, m2, m3] = await Promise.all([
      crewRxns.getReactionsForMessage('m1'),
      crewRxns.getReactionsForMessage('m2'),
      crewRxns.getReactionsForMessage('m3'),
    ]);

    expect(_state.queryCount).toBe(1);
    expect(_state.lastTable).toBe('crew_message_reactions');
    expect(_state.lastIn.col).toBe('message_id');
    expect(_state.lastIn.vals).toEqual(['m1', 'm2', 'm3']);

    expect(m1).toEqual([
      { user_id: 'u1', emoji: '🔥' },
      { user_id: 'u2', emoji: '💪' },
    ]);
    expect(m2).toEqual([]); // no rows for m2 → empty array, not undefined
    expect(m3).toEqual([{ user_id: 'u1', emoji: '👏' }]);
  });

  it('resolves empty arrays for every caller on query error (matches legacy {})', async () => {
    _state.nextError = { message: 'boom' };
    _state.nextData = null;

    const [a, b] = await Promise.all([
      crewRxns.getReactionsForMessage('m1'),
      crewRxns.getReactionsForMessage('m2'),
    ]);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
  });
});
