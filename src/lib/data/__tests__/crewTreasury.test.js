// Tests for src/lib/data/crewTreasury.js.
//
// Two contracts matter here.
//
// First, no client write path. The balance lives on crews (pinned by
// crews_guard_write) and both the ledger and the purchase rows have
// INSERT/UPDATE/DELETE revoked from `authenticated`. purchase_crew_perk is
// the only door, so a leader spending the treasury is a server action with
// a price attached rather than a client-side decrement. If a future change
// adds a .from(...) here, these fail.
//
// Second, 'insufficient' and 'maxed' are NORMAL outcomes rather than
// errors. The RPC re-reads the balance and owned count under a row lock
// before charging, so it can legitimately refuse a purchase the screen
// believed was affordable — two leaders tapping at once must not buy the
// same seat twice out of one balance. Those come back as { ok: false }
// payloads, not thrown errors, and the UI has to be able to tell them
// apart from a real failure.
//
// Mock shape mirrors crewWars.test.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy  = vi.fn();
const fromSpy = vi.fn();

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc:  (...args) => rpcSpy(...args),
    from: (...args) => fromSpy(...args),
    auth: { getUser: vi.fn() },
  },
}));

const { getTreasury, purchasePerk, describeLedgerReason } =
  await import('../crewTreasury');

beforeEach(() => {
  rpcSpy.mockReset();
  fromSpy.mockReset();
});

// ─────────────────────────────────────────────────────────────────────
// getTreasury
// ─────────────────────────────────────────────────────────────────────
describe('getTreasury', () => {
  const payload = (over = {}) => ({
    data: {
      balance: 2450,
      max_capacity: 17,
      perks: [{ perk_key: 'extra_seat', price: 1000, affordable: true, maxed: false }],
      ledger: [{ delta: 200, balance_after: 2450, reason: 'win' }],
      ...over,
    },
    error: null,
  });

  it('short-circuits without a crew id', async () => {
    expect(await getTreasury(null)).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('normalises the payload', async () => {
    rpcSpy.mockResolvedValue(payload());
    const res = await getTreasury('c1');

    expect(rpcSpy).toHaveBeenCalledWith('get_crew_treasury', { p_crew_id: 'c1' });
    expect(res.balance).toBe(2450);
    expect(res.maxCapacity).toBe(17);
    expect(res.perks).toHaveLength(1);
    expect(res.ledger).toHaveLength(1);
  });

  it('returns null for a non-member — the server decides', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: null });
    expect(await getTreasury('c1')).toBeNull();
  });

  it('defaults a missing balance to 0 and capacity to 16', async () => {
    rpcSpy.mockResolvedValue(payload({ balance: null, max_capacity: null }));
    const res = await getTreasury('c1');
    expect(res.balance).toBe(0);
    expect(res.maxCapacity).toBe(16);
  });

  it('coerces non-array perks and ledger', async () => {
    rpcSpy.mockResolvedValue(payload({ perks: 'nope', ledger: null }));
    const res = await getTreasury('c1');
    expect(res.perks).toEqual([]);
    expect(res.ledger).toEqual([]);
  });

  it('stays quiet when migration 251 is not deployed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect(await getTreasury('c1')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('never writes a table', async () => {
    rpcSpy.mockResolvedValue(payload());
    await getTreasury('c1');
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// purchasePerk
// ─────────────────────────────────────────────────────────────────────
describe('purchasePerk', () => {
  it('passes the crew and perk key through', async () => {
    rpcSpy.mockResolvedValue({
      data: { ok: true, perk_key: 'extra_seat', price: 500, balance: 1950, owned: 1 },
      error: null,
    });

    const res = await purchasePerk('c1', 'extra_seat');

    expect(rpcSpy).toHaveBeenCalledWith('purchase_crew_perk', {
      p_crew_id: 'c1', p_perk_key: 'extra_seat',
    });
    expect(res).toEqual({
      ok: true, perkKey: 'extra_seat', price: 500, balance: 1950, owned: 1,
    });
  });

  it('surfaces insufficient funds as a refusal, not an error', async () => {
    // The lock can refuse a purchase the screen thought was affordable.
    rpcSpy.mockResolvedValue({
      data: { ok: false, reason: 'insufficient', price: 1000, balance: 300 },
      error: null,
    });

    const res = await purchasePerk('c1', 'extra_seat');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('insufficient');
    expect(res.price).toBe(1000);
    expect(res.balance).toBe(300);
  });

  it('surfaces a maxed perk distinctly from insufficient funds', async () => {
    rpcSpy.mockResolvedValue({
      data: { ok: false, reason: 'maxed', owned: 4, balance: 9000 },
      error: null,
    });
    expect((await purchasePerk('c1', 'extra_seat')).reason).toBe('maxed');
  });

  it('maps 42501 to not_leader', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42501' } });
    expect(await purchasePerk('c1', 'extra_seat')).toEqual({ ok: false, reason: 'not_leader' });
  });

  it('reports not_deployed separately', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect(await purchasePerk('c1', 'extra_seat')).toEqual({ ok: false, reason: 'not_deployed' });
  });

  it('rejects missing arguments without calling out', async () => {
    expect(await purchasePerk(null, 'extra_seat')).toEqual({ ok: false, reason: 'missing' });
    expect(await purchasePerk('c1', null)).toEqual({ ok: false, reason: 'missing' });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('never writes a table', async () => {
    rpcSpy.mockResolvedValue({ data: { ok: true }, error: null });
    await purchasePerk('c1', 'extra_seat');
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// describeLedgerReason
// ─────────────────────────────────────────────────────────────────────
describe('describeLedgerReason', () => {
  it('renders deposits by result', () => {
    expect(describeLedgerReason('win')).toBe('War won');
    expect(describeLedgerReason('loss')).toBe('War fought');
    expect(describeLedgerReason('draw')).toBe('War drawn');
    expect(describeLedgerReason('challenge')).toBe('Challenge completed');
  });

  it('renders spends from the perk: prefix', () => {
    expect(describeLedgerReason('perk:extra_seat')).toBe('Bought a seat');
    expect(describeLedgerReason('perk:crew_banner')).toBe('Bought the banner');
    // An unknown perk key still reads as a purchase rather than falling
    // through to "Adjustment" — new catalogue rows are an INSERT, so this
    // will happen before the copy catches up.
    expect(describeLedgerReason('perk:something_new')).toBe('Bought a perk');
  });

  it('falls back safely on junk', () => {
    expect(describeLedgerReason(null)).toBe('Adjustment');
    expect(describeLedgerReason(42)).toBe('Adjustment');
    expect(describeLedgerReason('nonsense')).toBe('Adjustment');
  });

  it('routes through tFallback when one is supplied', () => {
    const t = vi.fn((_k, fallback) => `T:${fallback}`);
    expect(describeLedgerReason('win', t)).toBe('T:War won');
    expect(t).toHaveBeenCalled();
  });
});
