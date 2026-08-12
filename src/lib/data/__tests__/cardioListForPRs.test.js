/**
 * PR detection must not download the user's GPS history.
 *
 * Every cardio save ran `CardioLog.filter({created_by}, '-date', 1000)`, and
 * `makeEntity().filter` issues `select('*')` — so each save pulled up to a
 * thousand FULL rows, `gps_track` JSONB included, in order to read four
 * numbers off each one. Measured on production: 60 GPS points is 2,887
 * bytes, so an hour's run is roughly 100 KB a row, and a couple of hundred
 * logged runs is tens of megabytes fetched per save, on a phone. Three save
 * paths did it, plus the detail modal on every open.
 *
 * The assertion that matters is the COLUMN LIST, because that is the fix and
 * because nothing else would notice: the old query returned correct results,
 * it just paid enormously for them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let captured = null;
const rows = [{ id: 'a', type: 'running_outside', distance_meters: 5000, duration_seconds: 1500 }];

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: () => {
      const chain = {
        select: (cols) => { captured = cols; return chain; },
        eq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: rows, error: null }),
        then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
      };
      return chain;
    },
  },
}));
vi.mock('@/api/db', () => ({ db: { entities: { CardioLog: {} } } }));
vi.mock('@/lib/profanityFilter', () => ({ containsProfanity: () => false }));

import { listForPRs } from '@/lib/data/cardio';
import { detectNewPRs } from '@/lib/cardioPRs';

beforeEach(() => { captured = null; });

describe('listForPRs', () => {
  it('never asks for gps_track — the whole point of the change', async () => {
    await listForPRs('k@x.com');
    expect(captured).toBeTruthy();
    expect(captured).not.toContain('gps_track');
    expect(captured).not.toBe('*');
  });

  it('asks for exactly the columns PR detection and its callers read', async () => {
    await listForPRs('k@x.com');
    const cols = captured.split(',').map(c => c.trim()).sort();
    // type/distance/duration feed detectNewPRs; id and the two dates are
    // what the call sites filter the current log out with.
    expect(cols).toEqual(['created_date', 'date', 'distance_meters', 'duration_seconds', 'id', 'type']);
  });

  it('returns rows PR detection can actually work on', async () => {
    const prior = await listForPRs('k@x.com');
    const prs = detectNewPRs(
      { type: 'running_outside', distance_meters: 5000, duration_seconds: 1200 }, prior);
    // Faster over the same distance than the only prior row, so it is a PR.
    expect(prs.map(p => p.distance)).toContain('5k');
  });

  it('is empty rather than throwing without an email', async () => {
    expect(await listForPRs(null)).toEqual([]);
    expect(captured).toBeNull();   // and issues no query at all
  });
});
