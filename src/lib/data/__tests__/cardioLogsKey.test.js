/**
 * Seven cardio_logs readers, seven cache entries.
 *
 * They all used the bare key `['cardioLogs', email]` with different
 * queryFns and different limits — 1, 50, 100, 500, 500, 1000, 1000. React
 * Query caches by key, so that was not seven queries, it was one, and
 * whichever observer triggered the fetch decided what every other
 * component received. The cardio home asking for a single row to render
 * "Repeat last" could populate the cache Progress then read as the user's
 * whole history.
 *
 * Nothing failed loudly: every consumer got well-formed rows, just not
 * necessarily the ones it asked for, and never reproducibly — the winner
 * depends on mount order.
 *
 * Two properties matter and both are tested against a REAL QueryClient
 * rather than asserted about arrays, because the second one is the reason
 * the fix could be small: invalidation still works untouched.
 */
import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { cardioLogsKey } from '@/lib/data/cardioKeys';

// Every scope in use, so adding an eighth reader without a scope shows up.
const SCOPES = ['lastLog', 'savedList', 'goalProgress', 'nutritionTargets',
                'progress', 'dashboard', 'workout'];
const EMAIL = 'k@x.com';

describe('cardioLogsKey', () => {
  it('gives every reader a distinct key', () => {
    const keys = SCOPES.map(s => JSON.stringify(cardioLogsKey(EMAIL, s)));
    expect(new Set(keys).size).toBe(SCOPES.length);
  });

  it('keeps the shared prefix, which is what invalidation matches on', () => {
    for (const s of SCOPES) {
      expect(cardioLogsKey(EMAIL, s).slice(0, 2)).toEqual(['cardioLogs', EMAIL]);
    }
  });

  it('separates users as well as scopes', () => {
    expect(cardioLogsKey('a@x.com', 'workout')).not.toEqual(cardioLogsKey('b@x.com', 'workout'));
  });
});

describe('the cache actually keeps them apart', () => {
  it('a 1-row read cannot serve a 1000-row reader', () => {
    const qc = new QueryClient();
    // "Repeat last" lands first, as it does when you open the cardio home.
    qc.setQueryData(cardioLogsKey(EMAIL, 'lastLog'), [{ id: 'newest' }]);
    // Progress asks for the full history.
    expect(qc.getQueryData(cardioLogsKey(EMAIL, 'progress'))).toBeUndefined();

    // Under the old shared key this was the bug: one entry, first writer wins.
    qc.setQueryData(['cardioLogs', EMAIL], [{ id: 'newest' }]);
    expect(qc.getQueryData(['cardioLogs', EMAIL])).toHaveLength(1);
  });

  it('each scope holds its own rows at the same time', () => {
    const qc = new QueryClient();
    qc.setQueryData(cardioLogsKey(EMAIL, 'lastLog'), [{ id: '1' }]);
    qc.setQueryData(cardioLogsKey(EMAIL, 'progress'), [{ id: '1' }, { id: '2' }, { id: '3' }]);
    expect(qc.getQueryData(cardioLogsKey(EMAIL, 'lastLog'))).toHaveLength(1);
    expect(qc.getQueryData(cardioLogsKey(EMAIL, 'progress'))).toHaveLength(3);
  });
});

describe('the six existing invalidations still reach every scope', () => {
  // This is the property that let the fix stay small. React Query matches
  // queryKey as a PREFIX unless `exact: true`, so the save paths can keep
  // calling invalidateQueries({ queryKey: ['cardioLogs', email] }) with no
  // edit at all. If that were ever false, a cardio save would refresh
  // nothing and the bug would be worse than the one being fixed.
  it('a bare prefix invalidation marks all seven stale', async () => {
    const qc = new QueryClient();
    for (const s of SCOPES) qc.setQueryData(cardioLogsKey(EMAIL, s), [{ id: s }]);
    SCOPES.forEach(s => expect(qc.getQueryState(cardioLogsKey(EMAIL, s)).isInvalidated).toBe(false));

    await qc.invalidateQueries({ queryKey: ['cardioLogs', EMAIL] });

    SCOPES.forEach(s =>
      expect(qc.getQueryState(cardioLogsKey(EMAIL, s)).isInvalidated, `${s} was not invalidated`).toBe(true));
  });

  it('does not invalidate another user on the way past', async () => {
    const qc = new QueryClient();
    qc.setQueryData(cardioLogsKey('a@x.com', 'workout'), [{ id: 'a' }]);
    qc.setQueryData(cardioLogsKey('b@x.com', 'workout'), [{ id: 'b' }]);
    await qc.invalidateQueries({ queryKey: ['cardioLogs', 'a@x.com'] });
    expect(qc.getQueryState(cardioLogsKey('b@x.com', 'workout')).isInvalidated).toBe(false);
  });
});
