// Unit tests for the external duel-invite client (migration 072).
//
// Covers:
//   • createInviteLink / getInvitePublic / claimInvite — RPC glue
//   • buildInviteUrl — works with and without window.location
//   • stashPendingToken / readPendingToken / clearPendingToken —
//     localStorage envelope with 24-hour TTL, and the legacy
//     bare-string fallback for users who stashed before the envelope
//     change shipped.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const _state = {
  rpcCalls: [],
  rpcResponses: {},
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: async (fnName, args) => {
      _state.rpcCalls.push({ fnName, args });
      const next = _state.rpcResponses[fnName];
      if (!next) return { data: null, error: { code: '42883', message: `unknown RPC: ${fnName}` } };
      return next;
    },
  },
}));

const {
  createInviteLink,
  getInvitePublic,
  claimInvite,
  buildInviteUrl,
  stashPendingToken,
  readPendingToken,
  clearPendingToken,
  PENDING_INVITE_LS_KEY,
} = await import('../duelInvites');

beforeEach(() => {
  _state.rpcCalls = [];
  _state.rpcResponses = {};
  localStorage.clear();
  vi.useRealTimers();
});

describe('createInviteLink', () => {
  it('passes default args when no opts provided', async () => {
    _state.rpcResponses['create_pending_duel_invite'] = {
      data: { id: 'inv-1', token: 'abc123', expires_at: 'now+24h', duel_type: 'open', window_hours: 24 },
      error: null,
    };
    const got = await createInviteLink();
    expect(got.token).toBe('abc123');
    expect(_state.rpcCalls[0].args).toEqual({
      p_duel_type:          'open',
      p_session_template:   null,
      p_target_exercise_id: null,
      p_window_hours:       24,
    });
  });

  it('forwards mirror-duel template + window override', async () => {
    _state.rpcResponses['create_pending_duel_invite'] = {
      data: { id: 'inv-2', token: 'tok', expires_at: 'now+48h', duel_type: 'mirror', window_hours: 48 },
      error: null,
    };
    const sessionTemplate = { exercises: [{ id: 'ex1', sets: 3 }] };
    await createInviteLink({ duelType: 'mirror', sessionTemplate, windowHours: 48 });
    expect(_state.rpcCalls[0].args).toEqual({
      p_duel_type:          'mirror',
      p_session_template:   sessionTemplate,
      p_target_exercise_id: null,
      p_window_hours:       48,
    });
  });

  it('forwards exercise-duel target', async () => {
    _state.rpcResponses['create_pending_duel_invite'] = {
      data: { id: 'inv-3', token: 'tok' },
      error: null,
    };
    await createInviteLink({ duelType: 'exercise', targetExerciseId: 'ex-99' });
    expect(_state.rpcCalls[0].args.p_target_exercise_id).toBe('ex-99');
  });

  it('throws when the RPC returns an error (caller surfaces it)', async () => {
    _state.rpcResponses['create_pending_duel_invite'] = {
      data: null, error: { code: '23505', message: 'token collision' },
    };
    await expect(createInviteLink()).rejects.toMatchObject({ code: '23505' });
  });
});

describe('getInvitePublic', () => {
  it('returns null for empty token without calling the RPC', async () => {
    const got = await getInvitePublic('');
    expect(got).toBeNull();
    expect(_state.rpcCalls).toHaveLength(0);
  });

  it('returns the public payload on success', async () => {
    const payload = {
      id: 'inv-1', challenger_username: 'kegan', duel_type: 'open',
      window_hours: 24, expires_at: 'now+24h', is_claimed: false, is_expired: false,
    };
    _state.rpcResponses['get_pending_duel_invite_public'] = { data: payload, error: null };
    const got = await getInvitePublic('tok');
    expect(got).toEqual(payload);
  });

  it('returns null and logs (does not throw) when the RPC errors', async () => {
    // Failing here would crash the landing page for anon visitors —
    // the warn-and-return-null path lets the UI show "invite not found"
    // instead of an error boundary.
    _state.rpcResponses['get_pending_duel_invite_public'] = {
      data: null, error: { code: '42P01', message: 'table missing' },
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const got = await getInvitePublic('tok');
    expect(got).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('claimInvite', () => {
  it('returns the RPC payload on success', async () => {
    _state.rpcResponses['claim_pending_duel_invite'] = {
      data: { duel_id: 'duel-1', already_claimed_by_you: false }, error: null,
    };
    const got = await claimInvite('tok');
    expect(got).toEqual({ duel_id: 'duel-1', already_claimed_by_you: false });
  });

  it('throws when the RPC errors so caller can route to the right UI', async () => {
    _state.rpcResponses['claim_pending_duel_invite'] = {
      data: null, error: { code: 'P0001', message: 'invite expired' },
    };
    await expect(claimInvite('tok')).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('buildInviteUrl', () => {
  it('returns empty string for falsy token', () => {
    expect(buildInviteUrl(null)).toBe('');
    expect(buildInviteUrl('')).toBe('');
  });

  it('prefixes window.location.origin in the browser', () => {
    // jsdom default origin
    const url = buildInviteUrl('abc');
    expect(url).toBe(`${window.location.origin}/duel-invite/abc`);
  });
});

describe('stashPendingToken / readPendingToken — envelope + TTL', () => {
  it('round-trips a token', () => {
    stashPendingToken('tok-1');
    expect(readPendingToken()).toBe('tok-1');
  });

  it('persists as a JSON envelope (not bare string)', () => {
    stashPendingToken('tok-1');
    const raw = localStorage.getItem(PENDING_INVITE_LS_KEY);
    expect(raw.startsWith('{')).toBe(true);
    const env = JSON.parse(raw);
    expect(env.token).toBe('tok-1');
    expect(typeof env.stashedAt).toBe('number');
  });

  it('expires after 24 hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    stashPendingToken('tok-1');
    // Move 25 hours forward — past the TTL.
    vi.setSystemTime(new Date('2026-01-02T01:00:00Z'));
    expect(readPendingToken()).toBeNull();
    // Expiry also clears the value so the next read isn't ambiguous.
    expect(localStorage.getItem(PENDING_INVITE_LS_KEY)).toBeNull();
  });

  it('still valid at 23h59m', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    stashPendingToken('tok-1');
    vi.setSystemTime(new Date('2026-01-01T23:59:00Z'));
    expect(readPendingToken()).toBe('tok-1');
  });

  it('reads legacy bare-string token (pre-envelope users)', () => {
    // Older app version stored the token verbatim. Don't break them
    // mid-flow — return it as-is, AND upgrade the storage shape so
    // the 24-hour TTL starts ticking from this read.
    localStorage.setItem(PENDING_INVITE_LS_KEY, 'legacy-token');
    expect(readPendingToken()).toBe('legacy-token');
  });

  it('upgrades a legacy bare-string to the envelope shape on first read', () => {
    // Without this upgrade, a stuck bare-string sits in localStorage
    // on a shared browser forever (no other call site re-stashes after
    // the landing page sets it). The first read now writes the envelope
    // shape back so the TTL kicks in.
    localStorage.setItem(PENDING_INVITE_LS_KEY, 'legacy-token');
    readPendingToken();
    const raw = localStorage.getItem(PENDING_INVITE_LS_KEY);
    expect(raw.startsWith('{')).toBe(true);
    const env = JSON.parse(raw);
    expect(env.token).toBe('legacy-token');
    expect(typeof env.stashedAt).toBe('number');
  });

  it('upgraded legacy token then expires 24h later', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    localStorage.setItem(PENDING_INVITE_LS_KEY, 'legacy-token');
    // First read upgrades and returns the token.
    expect(readPendingToken()).toBe('legacy-token');
    // 25h later, the envelope's TTL has elapsed and the read returns null.
    vi.setSystemTime(new Date('2026-01-02T01:00:00Z'));
    expect(readPendingToken()).toBeNull();
  });

  it('returns null on malformed JSON envelope', () => {
    localStorage.setItem(PENDING_INVITE_LS_KEY, '{not valid json');
    expect(readPendingToken()).toBeNull();
  });

  it('returns null when envelope is missing token field', () => {
    localStorage.setItem(PENDING_INVITE_LS_KEY, JSON.stringify({ stashedAt: Date.now() }));
    expect(readPendingToken()).toBeNull();
  });

  it('no-ops stashing a falsy token', () => {
    stashPendingToken('');
    stashPendingToken(null);
    expect(localStorage.getItem(PENDING_INVITE_LS_KEY)).toBeNull();
  });

  it('clearPendingToken removes the key', () => {
    stashPendingToken('tok-1');
    clearPendingToken();
    expect(localStorage.getItem(PENDING_INVITE_LS_KEY)).toBeNull();
    expect(readPendingToken()).toBeNull();
  });
});
