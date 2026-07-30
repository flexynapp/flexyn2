// Tests for the stranded-capsule recovery sweep.
//
// Context: a capsule is spent the instant the reel starts, but the item
// only exists once Claim runs finalize_capsule_claim. Anything in between
// — reload, crash, an unreachable Claim button — destroys the reward.
// Measured on a live account: 5 of 21 opened capsules stranded, including
// an epic and two rares.
//
// The risky parts are (a) not double-granting when two tabs sweep at once
// and (b) not stealing a capsule the user is opening RIGHT NOW, so those
// get the most attention.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

const listStranded = vi.fn();
vi.mock('@/lib/data/capsules', () => ({ listStranded: (...a) => listStranded(...a) }));

const { recoverOne, recoverStrandedCapsules, recoveryMessage } =
  await import('../capsuleRecovery');

const row = (over = {}) => ({
  id: 'cap-1',
  capsule_type: 'standard',
  rolled_rarity: 'rare',
  rolled_category: 'sticker',
  rolled_variant: null,
  opened_at: new Date(Date.now() - 600_000).toISOString(),
  ...over,
});

beforeEach(() => {
  rpc.mockReset();
  listStranded.mockReset();
});

describe('recoverOne', () => {
  it('finalizes with an item of the ROLLED rarity, not the catalog default', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await recoverOne(row({ rolled_rarity: 'epic' }));
    expect(res.ok).toBe(true);
    const [, args] = rpc.mock.calls[0];
    // The tier is what the server decided and what carries the value.
    expect(args.p_item_rarity).toBe('epic');
    expect(args.p_capsule_id).toBe('cap-1');
  });

  it('carries the rolled variant through — a foil is worth 2-10x', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await recoverOne(row({ rolled_variant: 'gold' }));
    expect(rpc.mock.calls[0][1].p_variant).toBe('gold');
  });

  it('treats "already claimed" as a skip, not a failure — another tab won', async () => {
    rpc.mockResolvedValue({ error: { message: 'capsule already claimed' } });
    const res = await recoverOne(row());
    expect(res).toEqual({ ok: false, skipped: true });
  });

  it('reports a real failure as a failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const res = await recoverOne(row());
    expect(res.ok).toBe(false);
    expect(res.skipped).toBeUndefined();
  });

  it('falls back to a sticker when the rolled category has no catalog entry', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await recoverOne(row({ rolled_category: 'nonsense' }));
    expect(res.ok).toBe(true);
    expect(rpc.mock.calls[0][1].p_item_id).toBeTruthy();
  });

  // Contract changed in migration 267. This used to skip without calling the
  // RPC when the client couldn't resolve an item locally — correct when the
  // client's guess WAS the item being granted. Now the server derives the item
  // from loot_catalog and this capsule's stored roll and ignores the arguments
  // entirely, so a client that can't guess must not block recovery: a stranded
  // capsule whose rolled_category this bundle doesn't recognise was previously
  // unrecoverable forever.
  it('still attempts recovery when nothing resolves locally — the server owns the item', async () => {
    rpc.mockResolvedValue({ data: { item_id: 'stk_fire', item_name: 'On Fire', item_emoji: '\u{1F525}' }, error: null });
    const res = await recoverOne(row({ rolled_rarity: 'not-a-tier', rolled_category: 'nope' }));
    expect(rpc).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    // And it reports what the server granted, not the failed local guess.
    expect(res.item.id).toBe('stk_fire');
  });

  it('reports the granted item over a mismatched local guess', async () => {
    rpc.mockResolvedValue({ data: { item_id: 'stk_comet', item_name: 'Comet', item_emoji: '\u{1F4AB}' }, error: null });
    const res = await recoverOne(row());
    expect(res.ok).toBe(true);
    expect(res.item.id).toBe('stk_comet');
  });
});

describe('recoverStrandedCapsules', () => {
  it('is a no-op with no email — never queries', async () => {
    expect(await recoverStrandedCapsules(null)).toEqual({ recovered: 0, items: [], failed: 0 });
    expect(listStranded).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is stranded', async () => {
    listStranded.mockResolvedValue([]);
    const res = await recoverStrandedCapsules('a@b.c');
    expect(res.recovered).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('recovers every stranded capsule', async () => {
    listStranded.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await recoverStrandedCapsules('a@b.c');
    expect(res.recovered).toBe(3);
    expect(res.items).toHaveLength(3);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('does not count an already-claimed row as recovered OR failed', async () => {
    listStranded.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' })]);
    rpc.mockResolvedValueOnce({ error: null })
       .mockResolvedValueOnce({ error: { message: 'capsule already claimed' } });
    const res = await recoverStrandedCapsules('a@b.c');
    expect(res).toMatchObject({ recovered: 1, failed: 0 });
  });

  it('keeps going after one row fails', async () => {
    listStranded.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
    rpc.mockResolvedValueOnce({ error: { message: 'boom' } })
       .mockResolvedValue({ error: null });
    const res = await recoverStrandedCapsules('a@b.c');
    expect(res).toMatchObject({ recovered: 2, failed: 1 });
  });

  it('swallows a query failure — a repair pass must never break the bag', async () => {
    listStranded.mockRejectedValue(new Error('network'));
    await expect(recoverStrandedCapsules('a@b.c')).resolves
      .toEqual({ recovered: 0, items: [], failed: 0 });
  });

  it('grants sequentially, not in parallel — concurrent credits are the race these RPCs killed', async () => {
    listStranded.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' })]);
    let inFlight = 0, maxInFlight = 0;
    rpc.mockImplementation(async () => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight -= 1;
      return { error: null };
    });
    await recoverStrandedCapsules('a@b.c');
    expect(maxInFlight).toBe(1);
  });
});

describe('recoveryMessage', () => {
  it('says nothing when nothing was recovered', () => {
    expect(recoveryMessage({ recovered: 0, items: [] })).toBeNull();
  });

  it('names the item for a single recovery', () => {
    const msg = recoveryMessage({ recovered: 1, items: [{ emoji: '🔥', name: 'On Fire' }] });
    expect(msg).toContain('On Fire');
  });

  it('counts them for several', () => {
    expect(recoveryMessage({ recovered: 3, items: [{}, {}, {}] })).toContain('3 items');
  });

  it('survives an item with no emoji or name', () => {
    expect(() => recoveryMessage({ recovered: 1, items: [{}] })).not.toThrow();
  });
});

describe('buildCandidateMenu — the payload open_capsule_atomic rolls against', () => {
  it('covers every category the server can roll', async () => {
    const { buildCandidateMenu } = await import('../lootRoll');
    const menu = buildCandidateMenu();
    for (const cat of ['sticker', 'theme', 'title', 'frame']) {
      expect(Object.keys(menu).some(k => k.startsWith(cat + ':'))).toBe(true);
    }
  });

  it('covers every rarity the odds tables can produce', async () => {
    const { buildCandidateMenu } = await import('../lootRoll');
    const menu = buildCandidateMenu();
    // _weighted_pick can return any of these; a missing bucket means the
    // server falls back to a sticker, and for common..animated it must not
    // have to.
    for (const r of ['common', 'uncommon', 'rare', 'epic', 'legendary', 'animated']) {
      expect(menu[`sticker:${r}`], `sticker:${r} missing`).toBeTruthy();
    }
  });

  it('sends only id/name/emoji/type — never a rarity the server would trust', async () => {
    const { buildCandidateMenu } = await import('../lootRoll');
    for (const entry of Object.values(buildCandidateMenu())) {
      expect(Object.keys(entry).sort()).toEqual(['emoji', 'id', 'name', 'type']);
      expect(entry).not.toHaveProperty('rarity');
    }
  });

  it('never emits an entry without an id or name', async () => {
    const { buildCandidateMenu } = await import('../lootRoll');
    for (const [key, entry] of Object.entries(buildCandidateMenu())) {
      expect(entry.id, key).toBeTruthy();
      expect(entry.name, key).toBeTruthy();
    }
  });
});
