// Tests for the two exports migration 363 exists to serve:
// getGymRivalWeekState and rivalMetric (src/lib/data/gymRival.js).
//
// What these are guarding, and why it is worth a test rather than a
// component render:
//
//   • The rival's total used to be read from the CLIENT, against
//     workout_logs / cardio_logs, which are owner-only RLS with no rival
//     exception. So the rival column was structurally 0 — never an empty
//     week — and the screen printed "0 — 0 · Dead even" on top of it. The
//     fix is that this module now asks the server. A test that mocked the
//     old read would have passed the whole time, which is exactly why the
//     defect survived: the assertion has to be about WHICH call is made.
//
//   • An RPC that isn't deployed yet must degrade to null, NOT to zeroes.
//     A zero here would put the old lie back on the screen through a
//     different door — the menu keys "we can't show their total" off a
//     null week, so returning {you:0, them:0} would render a confident
//     dead heat for every user until the migration lands.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { rpc: (...a) => rpc(...a) },
}));
// selectProfiles is imported at module scope by gymRival.js; it is not
// exercised here, but leaving it unmocked drags in the real db client.
vi.mock('@/lib/data/users', () => ({ selectProfiles: vi.fn() }));
vi.mock('@/api/profileCache', () => ({ patchProfile: vi.fn() }));
// crews.js imports @/api/db, which registers a supabase.auth.onAuthStateChange
// listener at module scope — CLAUDE.md flags this exact import as what broke
// gymRivalOverthrow.test.js. Stub it so importing the crew helper is safe.
vi.mock('@/api/db', () => ({ db: { auth: {}, entities: {} }, default: {} }));

const { getGymRivalWeekState, rivalMetric, matchQuality } = await import('@/lib/data/gymRival');
const { getCrewBadges } = await import('@/lib/data/crews');

const ROW = {
  week_since:    '2026-08-10T00:00:00+00:00',
  week_ends:     '2026-08-17T00:00:00+00:00',
  you_volume:    '14820',
  them_volume:   '13580',
  you_distance:  '0',
  them_distance: '0',
  you_logged:    true,
  them_logged:   false,
  afk_deadline:  '2026-08-12T09:00:00+00:00',
  is_stalled:    false,
};

beforeEach(() => { rpc.mockReset(); });

describe('getGymRivalWeekState', () => {
  it('asks the SERVER for both totals — never reads the rival client-side', async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    await getGymRivalWeekState('assignment-1');
    expect(rpc).toHaveBeenCalledWith('gym_rival_week_state', { p_assignment_id: 'assignment-1' });
  });

  it('returns raw numbers and real Dates', async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const s = await getGymRivalWeekState('a');
    expect(s.youVolume).toBe(14820);
    expect(s.themVolume).toBe(13580);
    expect(s.youLogged).toBe(true);
    expect(s.themLogged).toBe(false);
    expect(s.isStalled).toBe(false);
    expect(s.endsAt).toBeInstanceOf(Date);
    expect(s.endsAt.toISOString()).toBe('2026-08-17T00:00:00.000Z');
  });

  it('accepts a bare object as well as a one-row array', async () => {
    rpc.mockResolvedValue({ data: ROW, error: null });
    expect((await getGymRivalWeekState('a')).youVolume).toBe(14820);
  });

  it('returns null — NOT zeroes — when the RPC is not deployed', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'does not exist' } });
    expect(await getGymRivalWeekState('a')).toBeNull();
  });

  it('returns null on an empty result rather than a zeroed week', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await getGymRivalWeekState('a')).toBeNull();
  });

  it('does not call the RPC without an assignment id', async () => {
    expect(await getGymRivalWeekState(undefined)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces a stalled match — an active row that can never settle', async () => {
    rpc.mockResolvedValue({ data: [{ ...ROW, is_stalled: true }], error: null });
    expect((await getGymRivalWeekState('a')).isStalled).toBe(true);
  });

  // Migration 373. A bodyweight set scored 0 against a `you_logged` that said
  // TRUE, so a calisthenics athlete saw a zero beside a rival's real number
  // and had no exit — gym_rival_void_stale releases people who did NOT log,
  // and they had. Bodyweight now counts at bodyweight x factor, which needs a
  // weight_lbs on file; 27 of 56 profiles have one.
  it('carries the bodyweight-missing flag so the screen can ask for a weight', async () => {
    rpc.mockResolvedValue({ data: [{ ...ROW, you_bw_missing: true, them_bw_missing: false }], error: null });
    const s = await getGymRivalWeekState('a');
    expect(s.youBwMissing).toBe(true);
    expect(s.themBwMissing).toBe(false);
  });

  it('reads the flag as false on a server that has not run 373 yet', async () => {
    // The deploy window: Netlify ships this client before the SQL is pasted,
    // so both columns are simply absent. A prompt driven by `undefined` has to
    // stay quiet rather than telling every user to go and enter their weight.
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const s = await getGymRivalWeekState('a');
    expect(s.youBwMissing).toBe(false);
    expect(s.themBwMissing).toBe(false);
  });
});

describe('rivalMetric', () => {
  const state = {
    youVolume: 14820, themVolume: 13580, youDistance: 8000, themDistance: 9500,
  };

  it('picks volume for a gym match', () => {
    expect(rivalMetric(state, 'gym')).toEqual({ you: 14820, them: 13580, kind: 'volume' });
  });

  it('picks distance for a cardio match', () => {
    expect(rivalMetric(state, 'cardio')).toEqual({ you: 8000, them: 9500, kind: 'distance' });
  });

  it('defaults to volume when no type is given', () => {
    expect(rivalMetric(state).kind).toBe('volume');
  });

  // The menu keys its "their total isn't known" branch off a null metric.
  // Returning {you: 0, them: 0} here would restore the exact defect this
  // whole change exists to remove.
  it('returns null for a null state instead of a zeroed pair', () => {
    expect(rivalMetric(null, 'gym')).toBeNull();
  });
});

// matchQuality bands the `match_gap` migration 364 stores on the assignment.
// The null case is the one that matters: rows rolled before 364 carry no gap,
// and the pending screen must stay silent rather than claim a quality it
// cannot know — a default of "fair" would be an assertion about a matchup
// nothing measured.
describe('matchQuality', () => {
  it('returns null when the row carries no gap (pre-364 assignments)', () => {
    expect(matchQuality(null)).toBeNull();
    expect(matchQuality(undefined)).toBeNull();
    expect(matchQuality('not a number')).toBeNull();
  });

  it('bands a gap into the four labels', () => {
    expect(matchQuality(0)).toBe('very-close');
    expect(matchQuality(0.0434)).toBe('very-close');   // the seeded "twin" case
    expect(matchQuality(0.2)).toBe('close');
    expect(matchQuality(0.45)).toBe('fair');
    expect(matchQuality(0.9)).toBe('widest');
  });

  it('treats a numeric string from postgres as a number', () => {
    expect(matchQuality('0.0767')).toBe('very-close');
  });

  it('does not treat 0 as absent', () => {
    expect(matchQuality(0)).not.toBeNull();
  });
});

// getCrewBadges — the crew shown under a username on the Gym Rival screens.
//
// The reason this is an RPC rather than a select is the whole point of the
// test: crew_members' only SELECT policy is is_crew_member(crew_id), so a
// direct client read of someone else's crew returns an empty set — not an
// error — and the badge would render blank for every rival you don't already
// train with. Asserting on WHICH call is made is the only way that stays
// fixed; a mock of the old shape would pass forever.
describe('getCrewBadges', () => {
  it('calls the RPC, never a crew_members select', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await getCrewBadges(['u1', 'u2']);
    expect(rpc).toHaveBeenCalledWith('public_crew_badges', { p_user_ids: ['u1', 'u2'] });
  });

  it('keys the result by user id', async () => {
    rpc.mockResolvedValue({ data: [
      { member_id: 'u1', badge_crew_id: 'c1', crew_name: 'Iron Legion', crew_tag: 'IRL', crew_avatar_url: null },
    ], error: null });
    const out = await getCrewBadges(['u1']);
    expect(out.u1).toEqual({ crewId: 'c1', name: 'Iron Legion', tag: 'IRL', avatarUrl: null });
  });

  // crews.tag is NULL on all 4 production crews, so this is the DEFAULT case.
  // A '' tag must come back as null or the UI renders "Iron Legion · []".
  it('normalises a missing tag to null rather than an empty string', async () => {
    rpc.mockResolvedValue({ data: [
      { member_id: 'u1', badge_crew_id: 'c1', crew_name: 'Jimbos', crew_tag: '', crew_avatar_url: '' },
    ], error: null });
    const out = await getCrewBadges(['u1']);
    expect(out.u1.tag).toBeNull();
    expect(out.u1.avatarUrl).toBeNull();
  });

  it('returns {} without calling the RPC when there is nobody to look up', async () => {
    expect(await getCrewBadges([])).toEqual({});
    expect(await getCrewBadges([null, undefined])).toEqual({});
    expect(await getCrewBadges(undefined)).toEqual({});
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns {} — never throws — when the RPC is not deployed', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect(await getCrewBadges(['u1'])).toEqual({});
  });

  it('skips a row with no member_id instead of keying on undefined', async () => {
    rpc.mockResolvedValue({ data: [{ crew_name: 'Ghost' }], error: null });
    expect(await getCrewBadges(['u1'])).toEqual({});
  });
});
