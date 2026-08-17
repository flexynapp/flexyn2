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
  syncMyCrewChallengeProgress,
  getChallengeContributions,
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
// syncMyCrewChallengeProgress — the ONLY progress write path (mig 246)
//
// The contract that matters here is negative: the client must send no
// numbers. Progress used to be written by updateChallengeProgress /
// setChallengeStatus straight from the browser, which was both dead code
// and a forgery vector. Those are gone; these tests pin the replacement
// down to an argument-free RPC call.
// ─────────────────────────────────────────────────────────────────────

describe('syncMyCrewChallengeProgress', () => {
  it('calls the RPC with no arguments at all', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { updated: 2, completed: [] }, error: null });

    await syncMyCrewChallengeProgress();

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith('sync_my_crew_challenge_progress');
    // No second argument — nothing for a crafted client to steer.
    expect(rpcSpy.mock.calls[0]).toHaveLength(1);
  });

  it('never touches the crew_challenges table directly', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { updated: 0, completed: [] }, error: null });

    await syncMyCrewChallengeProgress();

    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('normalises the server payload', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: { updated: 3, completed: ['chal-1', 'chal-2'] },
      error: null,
    });

    const r = await syncMyCrewChallengeProgress();
    expect(r).toEqual({ ok: true, updated: 3, completed: ['chal-1', 'chal-2'] });
  });

  it('defaults missing payload fields rather than propagating undefined', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: null });

    const r = await syncMyCrewChallengeProgress();
    expect(r).toEqual({ ok: true, updated: 0, completed: [] });
  });

  it('maps a 42501 to unauthenticated and everything else to db_error', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    expect(await syncMyCrewChallengeProgress()).toEqual({
      ok: false, reason: 'unauthenticated',
    });

    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '42883' } });
    expect(await syncMyCrewChallengeProgress()).toEqual({
      ok: false, reason: 'db_error',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// getChallengeContributions — read-side breakdown
// ─────────────────────────────────────────────────────────────────────

describe('getChallengeContributions', () => {
  it('short-circuits on a falsy id', async () => {
    expect(await getChallengeContributions(null)).toEqual([]);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('passes the challenge id through to the RPC', async () => {
    rpcSpy.mockResolvedValueOnce({ data: [{ user_id: 'u1', value: 10 }], error: null });

    const rows = await getChallengeContributions('chal-1');

    expect(rpcSpy).toHaveBeenCalledWith('get_crew_challenge_contributions', {
      p_challenge_id: 'chal-1',
    });
    expect(rows).toEqual([{ user_id: 'u1', value: 10 }]);
  });

  it('returns [] on error and on a non-array payload', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: 'XX' } });
    expect(await getChallengeContributions('chal-1')).toEqual([]);

    rpcSpy.mockResolvedValueOnce({ data: { nope: true }, error: null });
    expect(await getChallengeContributions('chal-1')).toEqual([]);
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
    const isTpl    = vi.fn().mockReturnValue({ order });
    const eqCrew   = vi.fn().mockReturnValue({ is: isTpl });
    const select   = vi.fn().mockReturnValue({ eq: eqCrew });
    fromSpy.mockReturnValue({ select });

    const rows = await listChallengesForCrew('c1');
    expect(rows).toEqual([{ id: 'a' }]);
    expect(eqCrew).toHaveBeenCalledWith('crew_id', 'c1');
    expect(eqStatus).toHaveBeenCalledWith('status', 'active');
  });

  // Migration 367 put GENERATIONAL challenges in this same table. Without
  // this filter the crew's chase renders twice: properly on the Trophies
  // tab, and again on the Home tab as a generic row with no trophy and a
  // bare progress bar. Proved against production before the fix: the Home
  // tab listed 1 and the Trophies tab listed the same 1.
  it('excludes generational challenges, which have their own surface', async () => {
    const eqStatus = vi.fn().mockResolvedValue({ data: [], error: null });
    const limit    = vi.fn().mockReturnValue({ eq: eqStatus });
    const order    = vi.fn().mockReturnValue({ limit });
    const isTpl    = vi.fn().mockReturnValue({ order });
    const eqCrew   = vi.fn().mockReturnValue({ is: isTpl });
    const select   = vi.fn().mockReturnValue({ eq: eqCrew });
    fromSpy.mockReturnValue({ select });

    await listChallengesForCrew('c1');
    expect(isTpl).toHaveBeenCalledWith('template_key', null);
  });

  it('does NOT apply the status filter when includeExpired=true', async () => {
    const limit  = vi.fn().mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], error: null });
    const order  = vi.fn().mockReturnValue({ limit });
    const isTpl  = vi.fn().mockReturnValue({ order });
    const eqCrew = vi.fn().mockReturnValue({ is: isTpl });
    const select = vi.fn().mockReturnValue({ eq: eqCrew });
    fromSpy.mockReturnValue({ select });

    const rows = await listChallengesForCrew('c1', true);
    expect(rows).toHaveLength(2);
    // still excluded, whatever the status filter does
    expect(isTpl).toHaveBeenCalledWith('template_key', null);
  });
});
