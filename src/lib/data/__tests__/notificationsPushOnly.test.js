// Guards the PUSH_ONLY_TYPES filter in src/lib/data/notifications.js.
//
// Migration 181 inserts a `dm_received` notifications row for every DM, so
// one message incremented BOTH the bell count and the Messages unread count,
// and NotificationBell's `count + dmUnread` handed the PWA Badging API a 2
// for a single message. The row must keep existing — it is what delivers the
// DM push — so the fix is a read-side filter, and these tests assert on the
// QUERY that gets built rather than on a return value, because that filter is
// the entire behaviour. A regression here is silent: the counts still look
// plausible, just doubled.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Chainable supabase mock that records the full call sequence, so a test can
// assert a `.not()` was issued at all — an omitted filter would otherwise be
// indistinguishable from a present one.
const _calls = [];
const _state = { nextData: [], nextError: null, nextCount: 0 };

function chain(kind) {
  const node = {
    select: (cols, opts) => { _calls.push(['select', cols, opts]); return chain(kind); },
    eq: (col, val) => { _calls.push(['eq', col, val]); return chain(kind); },
    not: (col, op, val) => { _calls.push(['not', col, op, val]); return chain(kind); },
    or: (expr) => { _calls.push(['or', expr]); return chain(kind); },
    order: (col, opts) => { _calls.push(['order', col, opts]); return chain(kind); },
    limit: (n) => { _calls.push(['limit', n]); return chain(kind); },
    then: (resolve) => resolve({
      data: _state.nextData,
      error: _state.nextError,
      count: _state.nextCount,
    }),
  };
  return node;
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (table) => { _calls.push(['from', table]); return chain(table); } },
}));

const notifications = await import('@/lib/data/notifications');

const USER = { id: 'u-1', email: 'a@b.c' };
const notCalls = () => _calls.filter(c => c[0] === 'not');

beforeEach(() => {
  _calls.length = 0;
  _state.nextData = [];
  _state.nextError = null;
  _state.nextCount = 0;
});

describe('PUSH_ONLY_TYPES', () => {
  it('contains dm_received', () => {
    expect(notifications.PUSH_ONLY_TYPES).toContain('dm_received');
  });

  // The filter is built by joining the array into a PostgREST `in` list.
  // A value carrying a comma, paren or quote would silently produce a
  // malformed filter that PostgREST may accept while matching nothing.
  it('holds only values that are safe to interpolate into a PostgREST in() list', () => {
    for (const t of notifications.PUSH_ONLY_TYPES) {
      expect(t).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe('unreadSummary', () => {
  it('excludes push-only types from the bell count', async () => {
    _state.nextCount = 7;
    const n = await notifications.unreadSummary(USER);

    expect(n.total).toBe(7);
    expect(notCalls()).toHaveLength(1);
    const [, col, op, val] = notCalls()[0];
    expect(col).toBe('type');
    expect(op).toBe('in');
    expect(val).toBe('(dm_received)');
  });

  it('still scopes to the user and to unread rows', async () => {
    await notifications.unreadSummary(USER);
    const eqs = Object.fromEntries(_calls.filter(c => c[0] === 'eq').map(c => [c[1], c[2]]));
    expect(eqs.user_id).toBe('u-1');
    expect(eqs.is_read).toBe(false);
  });

  it('does not query at all without a user id', async () => {
    expect(await notifications.unreadSummary({})).toEqual({ total: 0, people: 0 });
    expect(_calls).toHaveLength(0);
  });

  // Option C: the badge puts a number only on what another person did.
  it('counts people-made rows separately from the app\'s own', async () => {
    _state.nextCount = 4;
    _state.nextData = [
      { type: 'friend_follow' },         // social
      { type: 'duel_invite' },           // competitive
      { type: 'quest_expiry_warning' },  // reminder
      { type: 'quest_claimed' },         // achievement
    ];
    expect(await notifications.unreadSummary(USER)).toEqual({ total: 4, people: 2 });
  });

  it('never numbers a type the catalog has not heard of', async () => {
    _state.nextCount = 1;
    _state.nextData = [{ type: 'something_new' }];
    expect(await notifications.unreadSummary(USER)).toEqual({ total: 1, people: 0 });
  });
});

describe('same-day reminders', () => {
  // "3 quests left today" from yesterday used to keep the bell lit forever.
  it('counts a same-day reminder only while its local day is running', async () => {
    await notifications.unreadSummary(USER);
    const ors = _calls.filter(c => c[0] === 'or');
    expect(ors).toHaveLength(1);
    const [, expr] = ors[0];
    const since = notifications.startOfLocalDayIso();
    expect(expr).toBe(
      `type.not.in.(${notifications.SAME_DAY_TYPES.join(',')}),created_at.gte.${since}`,
    );
  });

  it('starts the day at local midnight', () => {
    const now = new Date(2026, 8, 28, 21, 30);
    expect(new Date(notifications.startOfLocalDayIso(now)).getTime())
      .toBe(new Date(2026, 8, 28, 0, 0, 0, 0).getTime());
  });

  it('does not hide same-day reminders from the panel list', async () => {
    await notifications.listForUser(USER);
    expect(_calls.filter(c => c[0] === 'or')).toHaveLength(0);
  });

  it('holds only values safe for a PostgREST in() list', () => {
    for (const t of notifications.SAME_DAY_TYPES) expect(t).toMatch(/^[a-z0-9_]+$/);
  });
});

describe('listForUser', () => {
  it('excludes push-only types from the panel feed', async () => {
    _state.nextData = [{ id: 'n1', type: 'pr_set' }];
    const rows = await notifications.listForUser(USER);

    expect(rows).toEqual([{ id: 'n1', type: 'pr_set' }]);
    expect(notCalls()).toHaveLength(1);
    const [, col, op, val] = notCalls()[0];
    expect(col).toBe('type');
    expect(op).toBe('in');
    expect(val).toBe('(dm_received)');
  });

  // NotificationPanel reports any type missing from its ALL_KNOWN_TYPES set
  // to Sentry. dm_received was never added there, so before this filter every
  // DM produced an "Unmapped notification types" report. Keeping the two in
  // agreement is what stops that noise coming back.
  it('filters exactly the types the panel does not know about', async () => {
    await notifications.listForUser(USER);
    const [, , , val] = notCalls()[0];
    expect(val).toBe(`(${notifications.PUSH_ONLY_TYPES.join(',')})`);
  });
});
