// Tests for src/lib/data/regimenReviews.js — list/submit/aggregates/getMyReview
// wrappers for the regimen ratings system (mig 118). Mocks supabase
// .from/.rpc to verify call shape + the needs_adoption error mapping.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (...args) => fromSpy(...args) },
}));

const { listForRegimen, submit, aggregatesFor, getMyReview } = await import('../regimenReviews');

beforeEach(() => fromSpy.mockReset());

describe('listForRegimen', () => {
  it('returns [] when regimenId is missing', async () => {
    expect(await listForRegimen(null)).toEqual([]);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('queries newest-first scoped to the regimen', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: 'r1' }], error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const eq    = vi.fn().mockReturnValue({ order });
    fromSpy.mockReturnValue({ select: () => ({ eq }) });
    const rows = await listForRegimen('reg1', 5);
    expect(fromSpy).toHaveBeenCalledWith('regimen_reviews');
    expect(eq).toHaveBeenCalledWith('regimen_id', 'reg1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(5);
    expect(rows).toHaveLength(1);
  });

  it('returns [] on error', async () => {
    fromSpy.mockReturnValue({
      select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { code: 'X' } }) }) }) }),
    });
    expect(await listForRegimen('reg1')).toEqual([]);
  });
});

describe('submit', () => {
  const ctx = { regimenId: 'reg1', rating: 5, comment: 'great', userId: 'u1' };

  it('rejects invalid args', async () => {
    expect((await submit({})).code).toBe('invalid_args');
    expect((await submit({ ...ctx, rating: 0 })).code).toBe('invalid_rating');
    expect((await submit({ ...ctx, rating: 6 })).code).toBe('invalid_rating');
    expect((await submit({ ...ctx, rating: 3.5 })).code).toBe('invalid_rating');
  });

  it('upserts with onConflict key + correct payload', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    fromSpy.mockReturnValue({ upsert });
    const res = await submit(ctx);
    expect(res.ok).toBe(true);
    expect(fromSpy).toHaveBeenCalledWith('regimen_reviews');
    expect(upsert).toHaveBeenCalledWith(
      {
        regimen_id:     'reg1',
        reviewer_id:    'u1',
        rating:         5,
        comment:        'great',
      },
      { onConflict: 'regimen_id,reviewer_id' },
    );
  });

  it('maps adoption-guard rejections to needs_adoption', async () => {
    fromSpy.mockReturnValue({
      upsert: () => Promise.resolve({ error: { code: '42501', message: 'review_requires_adoption' } }),
    });
    expect((await submit(ctx)).code).toBe('needs_adoption');
  });

  it('returns rpc_error for generic failures', async () => {
    fromSpy.mockReturnValue({
      upsert: () => Promise.resolve({ error: { code: '50000', message: 'boom' } }),
    });
    expect((await submit(ctx)).code).toBe('rpc_error');
  });

  it('normalizes empty comment to null', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    fromSpy.mockReturnValue({ upsert });
    await submit({ ...ctx, comment: '   ' });
    expect(upsert.mock.calls[0][0].comment).toBeNull();
  });
});

describe('aggregatesFor', () => {
  it('returns an empty Map for empty / non-array input', async () => {
    expect((await aggregatesFor(null)).size).toBe(0);
    expect((await aggregatesFor([])).size).toBe(0);
    expect((await aggregatesFor([null, undefined])).size).toBe(0);
  });

  it('de-dupes ids before the IN query', async () => {
    const inFn = vi.fn().mockResolvedValue({ data: [], error: null });
    fromSpy.mockReturnValue({ select: () => ({ in: inFn }) });
    await aggregatesFor(['a', 'a', 'b', 'b', 'a']);
    expect(inFn).toHaveBeenCalledWith('regimen_id', ['a', 'b']);
  });

  it('returns a Map of regimen_id → { avg_rating, review_count }', async () => {
    fromSpy.mockReturnValue({
      select: () => ({
        in: () => Promise.resolve({
          data: [
            { regimen_id: 'r1', avg_rating: 4.5, review_count: 12 },
            { regimen_id: 'r2', avg_rating: 3.2, review_count: 5  },
          ],
          error: null,
        }),
      }),
    });
    const m = await aggregatesFor(['r1', 'r2']);
    expect(m.get('r1')).toEqual({ avg_rating: 4.5, review_count: 12 });
    expect(m.get('r2')).toEqual({ avg_rating: 3.2, review_count: 5 });
  });
});

describe('getMyReview', () => {
  it('returns null when args missing', async () => {
    expect(await getMyReview(null, 'u1')).toBeNull();
    expect(await getMyReview('r1', null)).toBeNull();
  });

  it('returns the existing review or null', async () => {
    fromSpy.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'rev1', rating: 4 }, error: null }) }) }) }),
    });
    expect(await getMyReview('r1', 'u1')).toEqual({ id: 'rev1', rating: 4 });
  });
});
