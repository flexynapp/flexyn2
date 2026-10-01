// Tests for src/lib/data/dmRequestBlocks.js — the QUIET pair-keyed
// blocks written when you delete someone's message request (mig 234).
//
// Distinct from userBlocks.js (block_user_full, mig 106). These tests
// exist partly to pin that separation: this module must never touch the
// full-block RPCs.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const _sb = {
  lastTable: null,
  lastSelect: null,
  lastOrder: null,
  lastDeleteEq: null,
  deleteCalled: false,
  nextData: [],
  nextError: null,
  nextDeleteError: null,
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      _sb.lastTable = table;
      const chain = {
        select: (cols) => { _sb.lastSelect = cols; return chain; },
        order: (col, opts) => {
          _sb.lastOrder = { col, opts };
          if (_sb.onOrder) _sb.onOrder();
          return Promise.resolve({ data: _sb.nextData, error: _sb.nextError });
        },
        delete: () => { _sb.deleteCalled = true; return chain; },
        eq: (col, val) => {
          _sb.lastDeleteEq = { col, val };
          return Promise.resolve({ data: null, error: _sb.nextDeleteError });
        },
      };
      return chain;
    },
  },
}));

const { listMyRequestBlocks, removeRequestBlock } = await import('../dmRequestBlocks');

beforeEach(() => {
  _sb.lastTable = null;
  _sb.lastSelect = null;
  _sb.lastOrder = null;
  _sb.lastDeleteEq = null;
  _sb.deleteCalled = false;
  _sb.nextData = [];
  _sb.nextError = null;
  _sb.nextDeleteError = null;
  _sb.onOrder = null;
});

describe('listMyRequestBlocks', () => {
  it('reads dm_request_blocks newest-first', async () => {
    _sb.nextData = [
      { blocked_email: 'b@x.com', created_at: '2026-07-02T00:00:00Z' },
      { blocked_email: 'a@x.com', created_at: '2026-07-01T00:00:00Z' },
    ];
    const rows = await listMyRequestBlocks();
    expect(_sb.lastTable).toBe('dm_request_blocks');
    expect(_sb.lastOrder).toEqual({ col: 'created_at', opts: { ascending: false } });
    expect(rows.map(r => r.blocked_email)).toEqual(['b@x.com', 'a@x.com']);
  });

  // The row is named by blocked_id (resolved through public_profiles), so
  // the id has to be asked for. Settings never matches people by email.
  it('asks for blocked_id so Settings can name the account', async () => {
    await listMyRequestBlocks();
    expect(String(_sb.lastSelect)).toMatch(/\bblocked_id\b/);
  });

  it('still returns rows when blocked_id does not exist yet', async () => {
    // First read fails on the missing column; safeSelect strips it and retries.
    let calls = 0;
    _sb.nextError = { code: '42703', message: 'column dm_request_blocks.blocked_id does not exist' };
    _sb.nextData = null;
    _sb.onOrder = () => {
      calls += 1;
      if (calls > 1) {
        _sb.nextError = null;
        _sb.nextData = [{ blocked_email: 'a@x.com', created_at: 't' }];
      }
    };
    const rows = await listMyRequestBlocks();
    expect(calls).toBe(2);
    expect(String(_sb.lastSelect)).not.toMatch(/blocked_id/);
    expect(rows).toEqual([{ blocked_email: 'a@x.com', created_at: 't' }]);
  });

  // RLS is owner-only, so no blocker_email filter is needed or wanted —
  // adding one would just be a second place to get the identity wrong.
  it('does not filter by a client-supplied identity', async () => {
    await listMyRequestBlocks();
    expect(_sb.lastDeleteEq).toBeNull();
  });

  it('returns [] on a pre-234 host so Settings just hides the section', async () => {
    _sb.nextError = { code: '42P01', message: 'relation does not exist' };
    _sb.nextData = null;
    expect(await listMyRequestBlocks()).toEqual([]);
  });
});

describe('removeRequestBlock', () => {
  it('throws when the email is missing', async () => {
    await expect(removeRequestBlock(null)).rejects.toThrow(/blockedEmail/);
  });

  it('deletes the row, lower-casing the email', async () => {
    await removeRequestBlock('Them@Example.COM');
    expect(_sb.lastTable).toBe('dm_request_blocks');
    expect(_sb.deleteCalled).toBe(true);
    expect(_sb.lastDeleteEq).toEqual({ col: 'blocked_email', val: 'them@example.com' });
  });

  it('propagates a delete error', async () => {
    _sb.nextDeleteError = { code: '42501', message: 'rls denied' };
    await expect(removeRequestBlock('them@example.com'))
      .rejects.toMatchObject({ code: '42501' });
  });
});
