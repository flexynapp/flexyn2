// Proves the safeSelect wiring in src/lib/data/, not safeSelect itself.
//
// Eight of these modules imported safeSelect and never called it, so
// every explicit-column read in them went out unguarded. That gap was
// invisible: the import satisfied a reader skimming for it, and no test
// exercised the missing-column path.
//
// The window it matters in is this project's actual deploy shape.
// Frontend ships on a Netlify push; the database is deployed by hand,
// pasting SQL into the Supabase editor. So there is routinely a live
// period where the client asks for a column the database doesn't have.
// Unguarded, PostgREST answers 42703, the read's `if (error) return []`
// fires, and the user is told they have no trophies / no blocks / no
// cycle history. Silent, total, and indistinguishable from empty.
//
// These assert on the SEQUENCE — first attempt names every column, the
// retry drops exactly the missing one — because that is the part that
// was unproven.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromSpy = vi.fn();
const getUserSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (...args) => fromSpy(...args),
    auth: { getUser: (...args) => getUserSpy(...args) },
  },
}));

const { listBlocks }  = await import('../userBlocks');
const { listMutes }   = await import('../userMutes');
const { listEarned }  = await import('../trophies');
const { listMine }    = await import('../cycleLogs');
const { countsFor }   = await import('../itemSoldCounts');
const { listMyGifts } = await import('../coinGifts');

/**
 * A chainable supabase stub that records the column string of every
 * attempt and answers them from a queued list of results.
 *
 * Every filter method returns `this` AND the object is thenable, which
 * is what lets the same stub serve `.select().eq().order()` awaited at
 * any point in the chain.
 */
function stubQuery(results) {
  const columnsSeen = [];
  let attempt = 0;
  const chain = {
    select(cols) { columnsSeen.push(cols); return chain; },
    eq()    { return chain; },
    in()    { return chain; },
    order() { return chain; },
    limit() { return chain; },
    then(resolve, reject) {
      const r = results[Math.min(attempt++, results.length - 1)];
      return Promise.resolve(r).then(resolve, reject);
    },
  };
  fromSpy.mockReturnValue(chain);
  return { columnsSeen };
}

/** The shape PostgREST returns when a selected column isn't in the schema. */
const missingColumn = (name) => ({
  data: null,
  error: { code: '42703', message: `column ${name} does not exist` },
});

beforeEach(() => {
  fromSpy.mockReset();
  getUserSpy.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the reads survive a column the database does not have yet', () => {
  it('userBlocks.listBlocks strips created_at and still returns the block list', async () => {
    const { columnsSeen } = stubQuery([
      missingColumn('created_at'),
      { data: [{ blocked_email: 'a@b.c' }], error: null },
    ]);

    const rows = await listBlocks('u1');

    expect(columnsSeen[0]).toBe('blocked_email, blocked_id, created_at');
    expect(columnsSeen[1]).toBe('blocked_email, blocked_id');
    // Before the wiring this returned [] — "you have blocked nobody",
    // which is a different and much worse answer than "I can't show you
    // when you blocked them".
    expect(rows).toEqual([{ blocked_email: 'a@b.c' }]);
  });

  it('userMutes.listMutes does the same', async () => {
    const { columnsSeen } = stubQuery([
      missingColumn('created_at'),
      { data: [{ muted_email: 'a@b.c' }], error: null },
    ]);

    expect(await listMutes('u1')).toEqual([{ muted_email: 'a@b.c' }]);
    expect(columnsSeen).toEqual(['muted_email, muted_id, created_at', 'muted_email, muted_id']);
  });

  it('cycleLogs.listMine keeps the period history when `notes` is missing', async () => {
    const { columnsSeen } = stubQuery([
      missingColumn('notes'),
      { data: [{ id: 1, start_date: '2026-08-01', created_at: 'x' }], error: null },
    ]);

    expect(await listMine('u1')).toHaveLength(1);
    expect(columnsSeen[1]).toBe('id, start_date, created_at');
  });

  it('itemSoldCounts.countsFor still builds its Map', async () => {
    stubQuery([
      missingColumn('sold_count'),
      { data: [{ item_id: 'i1' }], error: null },
    ]);

    const m = await countsFor(['i1']);
    // sold_count is gone, so Number(undefined) || 0 lands on 0 rather
    // than throwing or losing the row.
    expect(m.get('i1')).toBe(0);
  });
});

describe('conditionally-built chains rebuild per attempt', () => {
  // A supabase query builder is single-use. Both of these used to build
  // the chain ONCE and branch on it; replaying that builder would send
  // the retry with the first attempt's filters already applied.

  it('trophies.listEarned retries with the email filter intact', async () => {
    const { columnsSeen } = stubQuery([
      missingColumn('earned_at'),
      { data: [{ trophy_id: 't1' }], error: null },
    ]);

    expect(await listEarned('a@b.c', true)).toEqual([{ trophy_id: 't1' }]);
    expect(columnsSeen).toEqual(['trophy_id, earned_at', 'trophy_id']);
    // Two attempts means two builders — one `from()` per attempt.
    expect(fromSpy).toHaveBeenCalledTimes(2);
  });

  it('coinGifts.listMyGifts retries with the direction filter intact', async () => {
    getUserSpy.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const { columnsSeen } = stubQuery([
      missingColumn('message'),
      { data: [{ id: 'g1', amount: 10 }], error: null },
    ]);

    expect(await listMyGifts({ direction: 'sent' })).toEqual([{ id: 'g1', amount: 10 }]);
    expect(columnsSeen[1]).toBe('id, sender_id, recipient_id, amount, created_at');
    expect(fromSpy).toHaveBeenCalledTimes(2);
  });
});

describe('real failures are still failures', () => {
  it('an RLS denial is not retried and not swallowed into partial data', async () => {
    const { columnsSeen } = stubQuery([
      { data: null, error: { code: '42501', message: 'row-level security' } },
    ]);

    // safeSelect only strips the schema-cache misses it recognises.
    // Anything else propagates, and these readers turn it into [].
    expect(await listBlocks('u1')).toEqual([]);
    expect(columnsSeen).toHaveLength(1);
  });

  it('a missing TABLE is left to the caller\'s own 42P01 branch', async () => {
    stubQuery([{ data: null, error: { code: '42P01', message: 'relation does not exist' } }]);
    expect(await listMine('u1')).toEqual([]);
  });
});
