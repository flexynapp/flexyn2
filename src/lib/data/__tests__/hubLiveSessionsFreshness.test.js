/**
 * A live session has to be RECENT, not merely flagged active.
 *
 * `is_active` is written true on start and false on end, and only the client
 * ever writes the false. Close the tab, kill the PWA, lose signal on the way
 * home — none of them run any code, so the row stays true forever. Nothing on
 * the server expires it.
 *
 * The result was a card reading LIVE NOW on every user's feed permanently, and
 * the host could not clear it because HubFeed filters the viewer's own session
 * out of the rail: the one person able to act on it is the one person who never
 * sees it. That asymmetry is why this went unnoticed rather than being reported
 * on day one.
 *
 * The broadcaster now ends its session on unmount and on `pagehide`, but a
 * force-quit runs neither, so the READ has to defend itself. That is what these
 * assert: the freshness floor is on both readers, and it is a floor rather than
 * a sort.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _state = { filters: [], table: null, rows: [], select: null };

function builder() {
  const chain = {
    select: (cols) => { _state.select = cols; return chain; },
    eq:  (col, val) => { _state.filters.push(['eq', col, val]); return chain; },
    gt:  (col, val) => { _state.filters.push(['gt', col, val]); return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: _state.rows[0] ?? null, error: null }),
    then: (onF, onR) => Promise.resolve({ data: _state.rows, error: null }).then(onF, onR),
  };
  return chain;
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => { _state.table = table; return builder(); },
  },
}));

import * as live from '../hubLiveSessions';

const gtFor = (col) => _state.filters.find(([op, c]) => op === 'gt' && c === col);

beforeEach(() => {
  _state.filters = [];
  _state.table = null;
  _state.rows = [];
  _state.select = null;
});

describe('live session freshness', () => {
  it('listActiveSessions asks for recent rows, not just active ones', async () => {
    await live.listActiveSessions();
    expect(_state.table).toBe('hub_live_sessions');
    expect(_state.filters).toContainEqual(['eq', 'is_active', true]);
    expect(gtFor('started_at'), 'no freshness floor — a stale row would render as LIVE').toBeTruthy();
  });

  it('uses a floor a few hours back, not "now" and not the epoch', async () => {
    const before = Date.now();
    await live.listActiveSessions();
    const cutoff = new Date(gtFor('started_at')[2]).getTime();
    const age = before - cutoff;
    // Long enough that a real workout in progress is never cut off mid-session,
    // short enough that a stuck row clears the same day.
    expect(age).toBeGreaterThan(60 * 60 * 1000);
    expect(age).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('applies the same floor to the host own-session lookup', async () => {
    // Otherwise a host whose app was killed is told they are still live and
    // cannot start a new session, forever.
    await live.getMyActiveSession('host-uuid');
    expect(_state.filters).toContainEqual(['eq', 'host_user_id', 'host-uuid']);
    expect(gtFor('started_at')).toBeTruthy();
  });

  it('getMyActiveSession returns null rather than throwing with no host', async () => {
    expect(await live.getMyActiveSession(null)).toBeNull();
    expect(_state.table).toBeNull();
  });
});

describe('the live rail does not hand out the host email', () => {
  // Every signed-in user sees the rail. It identifies the host by
  // host_user_id, so host_email has no reason to leave the server.
  it('lists explicit columns without host_email', async () => {
    await live.listActiveSessions();
    expect(_state.select).not.toBe('*');
    expect(_state.select).toContain('host_user_id');
    expect(_state.select).not.toContain('host_email');
  });
});
