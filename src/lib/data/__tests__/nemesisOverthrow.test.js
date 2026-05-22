// Tests for src/lib/data/nemesis.js performOverthrow — the most
// complex change shipped this session. Covers:
//   • Order-of-operations: status update FIRST, then increment, then
//     notification, then new-nemesis assignment. The
//     notify_nemesis_overthrown_for RPC (mig 111) checks the row's
//     status server-side and no-ops if it's still 'active', so the
//     order is load-bearing.
//   • The broken .update({ overthrow_count: rpc(...) }) call removed
//     by the cleanup commit is NOT silently reintroduced.
//   • Graceful degradation when assignNemesis() finds no candidates
//     (returns early; performOverthrow still completes).
//
// Strategy: build a chainable supabase mock where every method
// returns the same builder, and every terminal method resolves to
// `{ data: null, error: null }`. That makes assignNemesis() take its
// "no candidates" early-return path so we don't have to model the
// whole assign flow.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const callLog = [];

function record(kind, op, args) {
  callLog.push({ kind, op, args });
}

// Chainable builder: every method either logs + returns the builder,
// or resolves to { data: null, error: null }. The PromiseResolvable
// shape (`.then`) lets it be awaited at any chain depth.
function makeBuilder(table) {
  const builder = {};
  const terminal = Promise.resolve({ data: null, error: null });
  const wrap = (opName) => (...args) => {
    record('from', `${opName}:${table}`, args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select  = wrap('select');
  builder.insert  = wrap('insert');
  builder.update  = wrap('update');
  builder.delete  = wrap('delete');
  builder.eq      = wrap('eq');
  builder.neq     = wrap('neq');
  builder.gte     = wrap('gte');
  builder.lte     = wrap('lte');
  builder.gt      = wrap('gt');
  builder.lt      = wrap('lt');
  builder.in      = wrap('in');
  builder.not     = wrap('not');
  builder.is      = wrap('is');
  builder.order   = wrap('order');
  builder.limit   = wrap('limit');
  builder.single  = () => terminal;
  builder.maybeSingle = () => terminal;
  // Make the builder itself awaitable
  builder.then = (onF, onR) => terminal.then(onF, onR);
  return builder;
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'u1', email: 'u1@example.com' } },
      }),
    },
    from: (table) => makeBuilder(table),
    rpc: (name, args) => {
      record('rpc', name, args);
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

const { performOverthrow } = await import('../nemesis');

beforeEach(() => {
  callLog.length = 0;
});

describe('performOverthrow', () => {
  it('returns silently when no user is authenticated', async () => {
    const sb = (await import('@/api/supabaseClient')).supabase;
    sb.auth.getUser.mockResolvedValueOnce({ data: { user: null } });

    await performOverthrow('assignment-1');

    expect(callLog).toHaveLength(0);
  });

  it('fires the three operations in the correct order: status update -> increment -> notify', async () => {
    await performOverthrow('assignment-42');

    // Find the ordinal indices of our three load-bearing calls.
    const ops = callLog.map(c => `${c.kind}:${c.op}`);

    const idxStatusUpdate = ops.indexOf('from:update:nemesis_assignments');
    const idxIncrementRPC = ops.indexOf('rpc:increment_overthrow_count');
    const idxNotifyRPC    = ops.indexOf('rpc:notify_nemesis_overthrown_for');

    // All three must have fired
    expect(idxStatusUpdate).toBeGreaterThanOrEqual(0);
    expect(idxIncrementRPC).toBeGreaterThanOrEqual(0);
    expect(idxNotifyRPC).toBeGreaterThanOrEqual(0);

    // Status update first (must be 'overthrown' before notify RPC's
    // server-side status check passes). Increment between. Notify last.
    expect(idxStatusUpdate).toBeLessThan(idxIncrementRPC);
    expect(idxIncrementRPC).toBeLessThan(idxNotifyRPC);
  });

  it('passes assignment_id to the status update .eq and the notification RPC', async () => {
    await performOverthrow('assignment-42');

    // The .eq('id', 'assignment-42') sits right after the update payload.
    const eqCalls = callLog.filter(c =>
      c.kind === 'from' && c.op === 'eq:nemesis_assignments'
    );
    const idEq = eqCalls.find(c => Array.isArray(c.args) && c.args[0] === 'id');
    expect(idEq).toBeTruthy();
    expect(idEq.args[1]).toBe('assignment-42');

    const notify = callLog.find(c =>
      c.kind === 'rpc' && c.op === 'notify_nemesis_overthrown_for'
    );
    expect(notify.args).toEqual({ p_assignment_id: 'assignment-42' });
  });

  it('passes the caller user_id to increment_overthrow_count', async () => {
    await performOverthrow('assignment-42');

    const increment = callLog.find(c =>
      c.kind === 'rpc' && c.op === 'increment_overthrow_count'
    );
    expect(increment.args).toEqual({ p_user_id: 'u1' });
  });

  it('writes status="overthrown" + overthrown_at on the status update', async () => {
    await performOverthrow('assignment-42');

    const statusUpdate = callLog.find(c =>
      c.kind === 'from' && c.op === 'update:nemesis_assignments'
    );
    expect(statusUpdate.args).toMatchObject({ status: 'overthrown' });
    expect(statusUpdate.args.overthrown_at).toBeTruthy();
    expect(new Date(statusUpdate.args.overthrown_at).toString()).not.toBe('Invalid Date');
  });

  it('does NOT call .from("user_profiles").update — the broken builder-as-value path is removed', async () => {
    // Regression guard. The pre-cleanup code did:
    //   .from('user_profiles').update({ overthrow_count: supabase.rpc('coalesce_increment', ...) })
    // which passed an un-executed builder as the column value. The cleanup
    // commit (587bcf5) replaced this with the increment_overthrow_count
    // RPC alone. Verify the broken path can't sneak back.
    await performOverthrow('assignment-42');

    const userProfilesUpdate = callLog.find(c =>
      c.kind === 'from' && c.op === 'update:user_profiles'
    );
    expect(userProfilesUpdate).toBeUndefined();

    // And specifically: the coalesce_increment RPC name (the never-defined
    // function the broken call referenced) is never invoked.
    const coalesceCall = callLog.find(c =>
      c.kind === 'rpc' && c.op === 'coalesce_increment'
    );
    expect(coalesceCall).toBeUndefined();
  });
});
