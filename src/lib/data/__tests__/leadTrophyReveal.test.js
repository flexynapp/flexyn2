import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = [];
vi.mock('@/api/supabaseClient', () => {
  const chain = {
    select: () => chain, eq: () => chain, like: () => chain, order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return { supabase: { from: () => chain, rpc: vi.fn() } };
});

const { listUnseenLeadTrophies, markLeadTrophiesSeen } = await import('@/lib/data/trophies');

const NOW = Date.parse('2026-10-05T13:00:00Z');

describe('Lead Lifter reveal', () => {
  beforeEach(() => {
    localStorage.clear();
    rows.length = 0;
  });

  it('puts the whole-league trophy first and skips what this device has seen', async () => {
    rows.push(
      { trophy_id: 'league_lead_gold_3_2026w40', earned_at: '2026-10-05T12:10:00Z' },
      { trophy_id: 'league_lead_gold_2026w40', earned_at: '2026-10-05T12:10:00Z' },
    );
    const first = await listUnseenLeadTrophies('u1', NOW);
    expect(first.map((r) => r.trophy_id)).toEqual(['league_lead_gold_2026w40', 'league_lead_gold_3_2026w40']);
    markLeadTrophiesSeen('u1', first.map((r) => r.trophy_id));
    expect(await listUnseenLeadTrophies('u1', NOW)).toEqual([]);
  });

  it('does not reveal an old win on a new device', async () => {
    rows.push({ trophy_id: 'league_lead_silver_1_2026w30', earned_at: '2026-07-27T12:10:00Z' });
    expect(await listUnseenLeadTrophies('u1', NOW)).toEqual([]);
  });
});
