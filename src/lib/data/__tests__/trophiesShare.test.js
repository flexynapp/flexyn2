// listEarnedForShare — the Hub composer's achievement picker source.
//
// DEFECT PINNED (audit 2026-08-11). The composer read this list from
// `@/lib/data/achievements`, i.e. the RETIRED `public.achievements`
// table, and then filtered it with `.filter(a => a.unlocked)`.
//
// Two independent faults stacked, and either alone would have been
// enough to empty the section:
//   • that table holds ONE row in all of production (the trophy engine
//     replaced it at migration 323, and 189 had already removed the
//     client INSERT policy), and
//   • it has no `unlocked` column — verified against the live schema —
//     so the predicate was `undefined` on every row it could ever see.
//
// Net effect: `unlockedAchievements.length > 0` was false for 100% of
// users, forever, so the Achievements section of the share sheet never
// rendered. Nothing threw and nothing logged; an empty section is
// indistinguishable from "this user has earned nothing".
//
// These assert the shape the composer consumes, because that shape is
// the actual contract — `buildSnapshot`'s `case 'achievement'` reads
// achievement_id / name / description / icon / unlocked_date, and
// PickCard reads name and unlocked_date.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (...a) => from(...a), rpc: vi.fn() } }));
vi.mock('@/api/safeSelect', () => ({
  safeSelect: async ({ build, columns }) => build(columns.join(',')),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('@/lib/achievementsFlow', () => ({ requestOpenAchievements: vi.fn() }));

const { listEarnedForShare } = await import('@/lib/data/trophies');

beforeEach(() => { from.mockClear(); select.mockClear(); eq.mockClear(); order.mockClear(); });

const rows = (data) => order.mockResolvedValue({ data, error: null });

describe('listEarnedForShare', () => {
  it('reads user_trophies — NOT the retired achievements table', async () => {
    rows([]);
    await listEarnedForShare('u1');
    expect(from).toHaveBeenCalledWith('user_trophies');
    expect(from).not.toHaveBeenCalledWith('achievements');
  });

  it('keys on user_id', async () => {
    rows([]);
    await listEarnedForShare('u1');
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('returns a real earned trophy in the shape the composer consumes', async () => {
    rows([{ trophy_id: 'first_rep', earned_at: '2026-08-07T10:00:00Z' }]);
    const out = await listEarnedForShare('u1');
    expect(out).toEqual([{
      id:             'first_rep',
      achievement_id: 'first_rep',
      name:           'First Rep',
      description:    'Logged your first workout.',
      icon:           '🥉',
      unlocked_date:  '2026-08-07T10:00:00Z',
    }]);
  });

  it('does NOT filter on an `unlocked` flag — every row here is already earned', async () => {
    // The regression that mattered: a row carrying no `unlocked` property
    // must still come back. Filtering on one emptied the picker outright.
    rows([
      { trophy_id: 'first_rep', earned_at: '2026-08-07T10:00:00Z' },
      { trophy_id: 'crew_squad', earned_at: '2026-05-29T10:00:00Z' },
    ]);
    const out = await listEarnedForShare('u1');
    expect(out).toHaveLength(2);
    expect(out.every(a => a.unlocked === undefined)).toBe(true);
  });

  it('resolves tail and league-season ids, which the old table could not represent', async () => {
    rows([
      { trophy_id: 'sessions_x1', earned_at: '2026-08-07T10:00:00Z' },
      { trophy_id: 'league_s5_champion', earned_at: '2026-08-07T10:00:00Z' },
    ]);
    const out = await listEarnedForShare('u1');
    expect(out.map(a => a.name)).toEqual(['Centurion II', 'Champion, S5']);
  });

  it('drops an id the catalog cannot resolve rather than posting a blank badge', async () => {
    // `xp_250` used to be the example here, back when it was the retired
    // table's one orphan row with no client definition. Migration 341
    // made it a real, resolvable XP milestone — so this now needs an id
    // that genuinely resolves to nothing, and the milestone gets its own
    // assertion below.
    rows([
      { trophy_id: 'totally_not_a_badge', earned_at: '2026-05-01T10:00:00Z' },
      { trophy_id: 'first_rep', earned_at: '2026-08-07T10:00:00Z' },
    ]);
    const out = await listEarnedForShare('u1');
    expect(out.map(a => a.achievement_id)).toEqual(['first_rep']);
  });

  it('resolves an XP milestone, which has no ladder but is still shareable', async () => {
    rows([{ trophy_id: 'xp_250', earned_at: '2026-05-01T10:00:00Z' }]);
    const out = await listEarnedForShare('u1');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('First Steps');
  });

  it('carries a null date through rather than inventing one', async () => {
    rows([{ trophy_id: 'first_rep', earned_at: null }]);
    const out = await listEarnedForShare('u1');
    expect(out[0].unlocked_date).toBeNull();
  });

  it('returns [] for a missing user instead of querying', async () => {
    const out = await listEarnedForShare(null);
    expect(out).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('degrades to [] when the table is absent rather than throwing', async () => {
    order.mockResolvedValue({ data: null, error: { code: '42P01' } });
    expect(await listEarnedForShare('u1')).toEqual([]);
  });
});
