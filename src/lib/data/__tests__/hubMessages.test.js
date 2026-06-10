import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── db.entities mock ────────────────────────────────────────────────────────
// listMessages goes through db.entities.HubMessage.filter(...). We capture the
// args the data layer passes and hand back whatever the test stages.
const _msgState = {
  lastFilterConditions: null,
  lastFilterSort: null,
  lastFilterLimit: null,
  filterReturn: [],
};

vi.mock('@/api/db', () => ({
  db: {
    entities: {
      HubMessage: {
        filter: vi.fn(async (conditions, sort, limit) => {
          _msgState.lastFilterConditions = conditions;
          _msgState.lastFilterSort = sort;
          _msgState.lastFilterLimit = limit;
          return _msgState.filterReturn;
        }),
      },
      HubConversation: {},
    },
  },
}));

// ── supabase mock ───────────────────────────────────────────────────────────
// listOlderMessages uses the client directly to express the `< created_date`
// cursor bound. Capture the chain calls so we can assert the query shape.
const _sbState = {
  lastTable: null,
  lastSelect: null,
  lastEq: null,
  lastLt: null,
  lastOrder: null,
  lastLimit: null,
  nextData: [],
  nextError: null,
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      _sbState.lastTable = table;
      const chain = {
        select: (cols) => { _sbState.lastSelect = cols; return chain; },
        eq: (col, val) => { _sbState.lastEq = { col, val }; return chain; },
        lt: (col, val) => { _sbState.lastLt = { col, val }; return chain; },
        order: (col, opts) => { _sbState.lastOrder = { col, opts }; return chain; },
        limit: (n) => {
          _sbState.lastLimit = n;
          return Promise.resolve({ data: _sbState.nextData, error: _sbState.nextError });
        },
      };
      return chain;
    },
  },
}));

vi.mock('@/lib/dmPolls', () => ({ isPollVote: () => false }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const hubMessages = await import('../hubMessages');

beforeEach(() => {
  _msgState.lastFilterConditions = null;
  _msgState.lastFilterSort = null;
  _msgState.lastFilterLimit = null;
  _msgState.filterReturn = [];
  _sbState.lastTable = null;
  _sbState.lastSelect = null;
  _sbState.lastEq = null;
  _sbState.lastLt = null;
  _sbState.lastOrder = null;
  _sbState.lastLimit = null;
  _sbState.nextData = [];
  _sbState.nextError = null;
});

describe('listMessages', () => {
  it('fetches newest-first then returns ascending (oldest-first) for render', async () => {
    // DB returns newest-first (what the -created_date query yields).
    _msgState.filterReturn = [
      { id: 'c', created_date: '2026-06-10T03:00:00Z' },
      { id: 'b', created_date: '2026-06-10T02:00:00Z' },
      { id: 'a', created_date: '2026-06-10T01:00:00Z' },
    ];
    const rows = await hubMessages.listMessages('conv-1', 200);
    expect(_msgState.lastFilterConditions).toEqual({ conversation_id: 'conv-1' });
    expect(_msgState.lastFilterSort).toBe('-created_date');
    expect(_msgState.lastFilterLimit).toBe(200);
    // Reversed → oldest-first.
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the array the entity layer returned', async () => {
    const original = [
      { id: 'b', created_date: '2026-06-10T02:00:00Z' },
      { id: 'a', created_date: '2026-06-10T01:00:00Z' },
    ];
    _msgState.filterReturn = original;
    await hubMessages.listMessages('conv-1');
    expect(original.map(r => r.id)).toEqual(['b', 'a']); // untouched
  });

  it('returns [] for a missing conversation id', async () => {
    expect(await hubMessages.listMessages(null)).toEqual([]);
  });
});

describe('listOlderMessages', () => {
  it('queries strictly-older rows, newest-first, and reverses to ascending', async () => {
    _sbState.nextData = [
      { id: 'z', created_date: '2026-06-10T00:50:00Z' },
      { id: 'y', created_date: '2026-06-10T00:40:00Z' },
      { id: 'x', created_date: '2026-06-10T00:30:00Z' },
    ];
    const rows = await hubMessages.listOlderMessages('conv-1', '2026-06-10T01:00:00Z', 100);
    expect(_sbState.lastTable).toBe('hub_messages');
    expect(_sbState.lastEq).toEqual({ col: 'conversation_id', val: 'conv-1' });
    expect(_sbState.lastLt).toEqual({ col: 'created_date', val: '2026-06-10T01:00:00Z' });
    expect(_sbState.lastOrder).toEqual({ col: 'created_date', opts: { ascending: false } });
    expect(_sbState.lastLimit).toBe(100);
    // Reversed → oldest-first so it can be prepended.
    expect(rows.map(r => r.id)).toEqual(['x', 'y', 'z']);
  });

  it('returns [] when no cursor is supplied (no history paged)', async () => {
    const rows = await hubMessages.listOlderMessages('conv-1', null);
    expect(rows).toEqual([]);
    expect(_sbState.lastTable).toBeNull(); // never hit the DB
  });

  it('returns [] and reports on error rather than throwing', async () => {
    _sbState.nextError = { message: 'rls denied' };
    _sbState.nextData = null;
    const rows = await hubMessages.listOlderMessages('conv-1', '2026-06-10T01:00:00Z');
    expect(rows).toEqual([]);
  });
});
