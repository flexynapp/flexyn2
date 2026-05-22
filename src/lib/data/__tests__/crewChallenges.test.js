// Tests for src/lib/data/crewChallenges.js — covers the validation
// gates and the notification-RPC side effects added by mig 104.
//
// Patterns mirror userBlocks.test.js: mock supabase.from + supabase.rpc
// + supabase.auth, then verify the call shape and the structured
// {ok, reason, id} return contract.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy        = vi.fn();
const fromSpy       = vi.fn();
const getUserSpy    = vi.fn();
const profanitySpy  = vi.fn();

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc:  (...args) => rpcSpy(...args),
    from: (...args) => fromSpy(...args),
    auth: { getUser: (...args) => getUserSpy(...args) },
  },
}));

vi.mock('@/lib/profanityFilter', () => ({
  containsProfanity: (...args) => profanitySpy(...args),
}));

const {
  createChallenge,
  updateChallengeProgress,
  setChallengeStatus,
  listChallengesForCrew,
  VALID_METRICS,
} = await import('../crewChallenges');

// Helper: build a chainable insert mock that returns { data, error }
// from .single().
function mockInsertSingle({ data, error }) {
  const single = vi.fn().mockResolvedValue({ data, error });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  fromSpy.mockReturnValue({ insert });
  return { insert, select, single };
}

// Helper: build a chainable update mock that returns { error } from .eq().
function mockUpdateEq({ error }) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn().mockReturnValue({ eq });
  fromSpy.mockReturnValue({ update });
  return { update, eq };
}

beforeEach(() => {
  rpcSpy.mockReset();
  fromSpy.mockReset();
  getUserSpy.mockReset();
  profanitySpy.mockReset();
  // Default: profanity check is a no-op
  profanitySpy.mockReturnValue(false);
  // Default: authenticated user
  getUserSpy.mockResolvedValue({ data: { user: { id: 'u1', email: 'u1@example.com' } } });
});

// ─────────────────────────────────────────────────────────────────────
// VALID_METRICS export
// ─────────────────────────────────────────────────────────────────────

describe('VALID_METRICS', () => {
  it('exposes the four supported metric keys', () => {
    expect(VALID_METRICS).toEqual([
      'total_volume',
      'total_sessions',
      'total_xp',
      'days_active',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// createChallenge — validation
// ─────────────────────────────────────────────────────────────────────

describe('createChallenge validation', () => {
  const validArgs = {
    crewId: 'c1',
    title: 'Lift 30,000 lbs',
    metric: 'total_volume',
    targetValue: 30000,
    endsAt: new Date('2030-01-01').toISOString(),
  };

  it('returns missing_fields when any required arg is missing', async () => {
    expect(await createChallenge({})).toEqual({ ok: false, reason: 'missing_fields' });
    expect(await createChallenge({ ...validArgs, crewId: '' })).toEqual({ ok: false, reason: 'missing_fields' });
    expect(await createChallenge({ ...validArgs, title: '' })).toEqual({ ok: false, reason: 'missing_fields' });
    expect(await createChallenge({ ...validArgs, metric: '' })).toEqual({ ok: false, reason: 'missing_fields' });
    expect(await createChallenge({ ...validArgs, targetValue: 0 })).toEqual({ ok: false, reason: 'missing_fields' });
    expect(await createChallenge({ ...validArgs, endsAt: '' })).toEqual({ ok: false, reason: 'missing_fields' });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('returns invalid_metric when metric is not in the whitelist', async () => {
    const r = await createChallenge({ ...validArgs, metric: 'flex_coins' });
    expect(r).toEqual({ ok: false, reason: 'invalid_metric' });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('returns invalid_target for non-positive or non-finite targets', async () => {
    expect(await createChallenge({ ...validArgs, targetValue: -5 })).toEqual({ ok: false, reason: 'invalid_target' });
    expect(await createChallenge({ ...validArgs, targetValue: 'abc' })).toEqual({ ok: false, reason: 'invalid_target' });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('returns profanity when the title contains a banned word', async () => {
    profanitySpy.mockReturnValueOnce(true);
    const r = await createChallenge({ ...validArgs, title: 'banned-word' });
    expect(r).toEqual({ ok: false, reason: 'profanity' });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('returns unauthenticated when no user session', async () => {
    getUserSpy.mockResolvedValueOnce({ data: { user: null } });
    const r = await createChallenge(validArgs);
    expect(r).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// createChallenge — happy path + notification fanout
// ─────────────────────────────────────────────────────────────────────

describe('createChallenge insert + notify', () => {
  const validArgs = {
    crewId: 'c1',
    title: '  Lift 30,000 lbs  ',
    metric: 'total_volume',
    targetValue: '30000.7',
    endsAt: '2030-01-01T00:00:00.000Z',
  };

  it('inserts with the right shape (trimmed title, rounded target, ISO ends_at) and fires the notification RPC', async () => {
    const { insert } = mockInsertSingle({ data: { id: 'chal-1' }, error: null });
    rpcSpy.mockResolvedValueOnce({ data: 1, error: null });

    const r = await createChallenge(validArgs);

    expect(r).toEqual({ ok: true, id: 'chal-1' });
    expect(fromSpy).toHaveBeenCalledWith('crew_challenges');
    expect(insert).toHaveBeenCalledWith({
      crew_id:      'c1',
      created_by:   'u1',
      title:        'Lift 30,000 lbs', // trimmed
      metric:       'total_volume',
      target_value: 30001, // Math.round('30000.7') = 30001
      ends_at:      '2030-01-01T00:00:00.000Z',
    });
    expect(rpcSpy).toHaveBeenCalledWith('notify_crew_challenge_created_for', {
      p_challenge_id: 'chal-1',
    });
  });

  it('truncates titles longer than 80 chars', async () => {
    const long = 'a'.repeat(120);
    const { insert } = mockInsertSingle({ data: { id: 'chal-2' }, error: null });
    rpcSpy.mockResolvedValueOnce({ data: 1, error: null });

    await createChallenge({ ...validArgs, title: long });
    const inserted = insert.mock.calls[0][0];
    expect(inserted.title).toHaveLength(80);
  });

  it('maps RLS 42501 to not_admin reason', async () => {
    mockInsertSingle({ data: null, error: { code: '42501', message: 'rls' } });

    const r = await createChallenge(validArgs);
    expect(r).toEqual({ ok: false, reason: 'not_admin' });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('maps any other insert error to db_error', async () => {
    mockInsertSingle({ data: null, error: { code: 'XX', message: 'boom' } });

    const r = await createChallenge(validArgs);
    expect(r).toEqual({ ok: false, reason: 'db_error' });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('skips the notification RPC when data.id is missing (defensive guard)', async () => {
    mockInsertSingle({ data: null, error: null });

    const r = await createChallenge(validArgs);
    expect(r).toEqual({ ok: true, id: undefined });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('still returns ok:true if the notification RPC throws (fire-and-forget)', async () => {
    mockInsertSingle({ data: { id: 'chal-3' }, error: null });
    rpcSpy.mockRejectedValueOnce(new Error('network'));

    const r = await createChallenge(validArgs);
    expect(r).toEqual({ ok: true, id: 'chal-3' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// setChallengeStatus — only fires the notification on 'completed'
// ─────────────────────────────────────────────────────────────────────

describe('setChallengeStatus', () => {
  it('rejects invalid status values without hitting the DB', async () => {
    const r = await setChallengeStatus('chal-1', 'bogus');
    expect(r).toEqual({ ok: false, reason: 'invalid' });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('rejects when id is missing', async () => {
    expect(await setChallengeStatus(null, 'completed')).toEqual({ ok: false, reason: 'invalid' });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('updates the row and fires the completed RPC when status=completed', async () => {
    mockUpdateEq({ error: null });
    rpcSpy.mockResolvedValueOnce({ data: 1, error: null });

    const r = await setChallengeStatus('chal-1', 'completed');

    expect(r).toEqual({ ok: true });
    expect(fromSpy).toHaveBeenCalledWith('crew_challenges');
    expect(rpcSpy).toHaveBeenCalledWith('notify_crew_challenge_completed_for', {
      p_challenge_id: 'chal-1',
    });
  });

  it('does NOT fire the notification for status=expired (silent failure mode)', async () => {
    mockUpdateEq({ error: null });

    const r = await setChallengeStatus('chal-1', 'expired');
    expect(r).toEqual({ ok: true });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('does NOT fire the notification for status=active', async () => {
    mockUpdateEq({ error: null });

    const r = await setChallengeStatus('chal-1', 'active');
    expect(r).toEqual({ ok: true });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns db_error on update failure and does NOT fire notification', async () => {
    mockUpdateEq({ error: { code: 'XX', message: 'fail' } });

    const r = await setChallengeStatus('chal-1', 'completed');
    expect(r).toEqual({ ok: false, reason: 'db_error' });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns ok even if the completion notification RPC throws', async () => {
    mockUpdateEq({ error: null });
    rpcSpy.mockRejectedValueOnce(new Error('network'));

    const r = await setChallengeStatus('chal-1', 'completed');
    expect(r).toEqual({ ok: true });
  });
});

// ─────────────────────────────────────────────────────────────────────
// updateChallengeProgress — clamping + db error path
// ─────────────────────────────────────────────────────────────────────

describe('updateChallengeProgress', () => {
  it('returns no_id when id is falsy', async () => {
    const r = await updateChallengeProgress(null, 100);
    expect(r).toEqual({ ok: false, reason: 'no_id' });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('clamps negative progress to 0 and rounds floats', async () => {
    const { update } = mockUpdateEq({ error: null });
    await updateChallengeProgress('chal-1', -5.7);
    expect(update).toHaveBeenCalledWith({ current_value: 0 });
  });

  it('rounds non-integer progress', async () => {
    const { update } = mockUpdateEq({ error: null });
    await updateChallengeProgress('chal-1', 42.6);
    expect(update).toHaveBeenCalledWith({ current_value: 43 });
  });

  it('returns db_error on failure', async () => {
    mockUpdateEq({ error: { code: 'XX' } });
    const r = await updateChallengeProgress('chal-1', 100);
    expect(r).toEqual({ ok: false, reason: 'db_error' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// listChallengesForCrew — query shape
// ─────────────────────────────────────────────────────────────────────

describe('listChallengesForCrew', () => {
  it('returns [] for falsy crewId without hitting the network', async () => {
    expect(await listChallengesForCrew(null)).toEqual([]);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('by default filters status=active', async () => {
    const eqStatus = vi.fn().mockResolvedValue({ data: [{ id: 'a' }], error: null });
    const limit    = vi.fn().mockReturnValue({ eq: eqStatus });
    const order    = vi.fn().mockReturnValue({ limit });
    const eqCrew   = vi.fn().mockReturnValue({ order });
    const select   = vi.fn().mockReturnValue({ eq: eqCrew });
    fromSpy.mockReturnValue({ select });

    const rows = await listChallengesForCrew('c1');
    expect(rows).toEqual([{ id: 'a' }]);
    expect(eqCrew).toHaveBeenCalledWith('crew_id', 'c1');
    expect(eqStatus).toHaveBeenCalledWith('status', 'active');
  });

  it('does NOT apply the status filter when includeExpired=true', async () => {
    const limit  = vi.fn().mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], error: null });
    const order  = vi.fn().mockReturnValue({ limit });
    const eqCrew = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq: eqCrew });
    fromSpy.mockReturnValue({ select });

    const rows = await listChallengesForCrew('c1', true);
    expect(rows).toHaveLength(2);
  });
});
