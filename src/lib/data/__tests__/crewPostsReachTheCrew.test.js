/**
 * A crew-only post was readable by nobody, including the crew.
 *
 * `hub_posts` had no `crew_id` column. The composer sent one anyway on all
 * three create() paths, and `makeEntity().create` catches PostgREST's
 * PGRST204 for an unknown column, strips the key and retries — by design — so
 * the insert SUCCEEDED and the scoping vanished with no error. The row landed
 * `privacy = 'crew'` with no crew, and the read policy admits only 'public'
 * or 'followers', so the only reader was the author.
 *
 * Migration 379 adds the column and the read branch. This covers the client
 * half, which had its own hole: the Squad window is keyed on `author_email`,
 * so even with RLS fixed a crew post would only have reached crew mates who
 * ALSO follow the author — and most of a crew does not follow most of the
 * crew. `fetchCrewWindow` is the other half.
 *
 * The mock captures the query rather than asserting a stub's return value,
 * because what matters here is WHICH ROWS ARE ASKED FOR.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let q = null;

vi.mock('@/api/supabaseClient', () => {
  const chain = () => {
    const c = {
      select: (cols) => { q.select = cols; return c; },
      eq:     (k, v) => { q.eq.push([k, v]); return c; },
      in:     (k, v) => { q.in.push([k, v]); return c; },
      order:  (k, o) => { q.order = [k, o]; return c; },
      limit:  (n)    => { q.limit = n; return Promise.resolve({ data: q.rows, error: q.error }); },
      lt:     () => c,
      filter: () => c,
    };
    return c;
  };
  return {
    supabase: {
      from: (t) => { q.from = t; return chain(); },
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getUser: async () => ({ data: { user: { id: 'me' } } }),
        getSession: async () => ({ data: { session: null } }),
      },
      rpc: async () => ({ data: null, error: null }),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

import { fetchCrewWindow } from '../hubPosts';

beforeEach(() => { q = { eq: [], in: [], rows: [{ id: 'p1' }], error: null }; });

describe('fetchCrewWindow', () => {
  it('asks for the crew posts addressed to my crews', async () => {
    const rows = await fetchCrewWindow(['crew-a', 'crew-b']);
    expect(q.from).toBe('hub_posts');
    expect(q.eq).toContainEqual(['privacy', 'crew']);
    expect(q.in).toContainEqual(['crew_id', ['crew-a', 'crew-b']]);
    expect(rows).toEqual([{ id: 'p1' }]);
  });

  it('does not query at all when I am in no crew', async () => {
    // An empty `.in()` list is a query that can only return nothing, and
    // PostgREST is happy to run it. Skipping it is the point.
    const rows = await fetchCrewWindow([]);
    expect(rows).toEqual([]);
    expect(q.from, 'no crews means no round-trip').toBeUndefined();
  });

  it('drops empty ids rather than sending them', async () => {
    await fetchCrewWindow([null, 'crew-a', undefined, '']);
    expect(q.in).toContainEqual(['crew_id', ['crew-a']]);
  });

  it('returns [] rather than throwing when the read fails', async () => {
    q.error = { code: '42501', message: 'nope' };
    q.rows = null;
    expect(await fetchCrewWindow(['crew-a'])).toEqual([]);
  });

  it('reads newest first', async () => {
    await fetchCrewWindow(['crew-a']);
    expect(q.order[0]).toBe('created_date');
    expect(q.order[1]).toEqual({ ascending: false });
  });
});
