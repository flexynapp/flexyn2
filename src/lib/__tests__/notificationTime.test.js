// Guards the locale-aware timestamp that replaced date-fns
// `formatDistanceToNow`, which both notification surfaces called with NO
// locale — so "3 hours ago" rendered in English under a fully translated
// screen, in all 15 languages.
//
// The trap worth knowing, and the reason for the non-English assertions
// below: EVERY test in this repo that stubs translation does so as
// `(key, english) => english`, which returns the pre-interpolated English
// fallback and therefore passes whether or not the localisation works. A
// date has no translation key at all, so it is invisible to that stub twice
// over. The only way to see this bug is to assert on a non-English locale.

import { describe, it, expect } from 'vitest';
import {
  BUCKET, bucketFor, formatNotificationTime, groupByDay, toDate,
} from '@/lib/notificationTime';

const NOW = new Date('2026-08-10T15:30:00');
const ago = (ms) => new Date(NOW.getTime() - ms);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('bucketFor', () => {
  it('buckets by calendar day, not elapsed hours', () => {
    // 11pm yesterday is 16.5h ago — "yesterday", not "today".
    expect(bucketFor(new Date('2026-08-09T23:00:00'), NOW)).toBe(BUCKET.YESTERDAY);
    // 1am today is 14.5h ago — "today", the same elapsed span.
    expect(bucketFor(new Date('2026-08-10T01:00:00'), NOW)).toBe(BUCKET.TODAY);
  });

  it('handles the boundaries', () => {
    expect(bucketFor(NOW, NOW)).toBe(BUCKET.TODAY);
    expect(bucketFor(ago(2 * DAY), NOW)).toBe(BUCKET.EARLIER);
  });

  it('treats a clock-skewed future stamp as today rather than falling through', () => {
    expect(bucketFor(new Date(NOW.getTime() + 5 * MIN), NOW)).toBe(BUCKET.TODAY);
  });

  it('does not throw on a missing or unparseable date', () => {
    expect(bucketFor(null, NOW)).toBe(BUCKET.EARLIER);
    expect(bucketFor('not a date', NOW)).toBe(BUCKET.EARLIER);
  });
});

describe('formatNotificationTime', () => {
  it('renders today relative', () => {
    expect(formatNotificationTime(ago(5 * MIN), 'en', NOW)).toMatch(/5/);
    expect(formatNotificationTime(ago(3 * HOUR), 'en', NOW)).toMatch(/3/);
  });

  it('is actually localised — the whole point of the module', () => {
    const es = formatNotificationTime(ago(5 * MIN), 'es', NOW);
    const en = formatNotificationTime(ago(5 * MIN), 'en', NOW);
    expect(es).not.toBe(en);
    // "hace 5 min" — Spanish puts the marker first, English last.
    expect(es.toLowerCase()).toContain('hace');
  });

  it('localises the earlier-than-yesterday date too', () => {
    const d = new Date('2026-08-04T09:00:00');
    const en = formatNotificationTime(d, 'en', NOW);
    const de = formatNotificationTime(d, 'de', NOW);
    expect(en).toMatch(/Aug/);
    expect(de).not.toBe(en);
  });

  it('clamps a future stamp to "now" rather than saying "in 3 minutes"', () => {
    const future = formatNotificationTime(new Date(NOW.getTime() + 3 * MIN), 'en', NOW);
    expect(future).not.toMatch(/^in /);
  });

  it('falls back rather than blanking the column on a bad language code', () => {
    expect(formatNotificationTime(ago(5 * DAY), 'not-a-locale', NOW)).not.toBe('');
  });

  it('returns empty for a missing date, not "Invalid Date"', () => {
    expect(formatNotificationTime(null, 'en', NOW)).toBe('');
    expect(formatNotificationTime('nonsense', 'en', NOW)).toBe('');
  });
});

describe('groupByDay', () => {
  const rows = [
    { id: 1, created_at: ago(5 * MIN).toISOString() },
    { id: 2, created_at: ago(2 * HOUR).toISOString() },
    { id: 3, created_at: new Date('2026-08-09T18:00:00').toISOString() },
    { id: 4, created_at: ago(6 * DAY).toISOString() },
  ];

  it('splits into day groups in display order', () => {
    const groups = groupByDay(rows, NOW);
    expect(groups.map(g => g.bucket)).toEqual([BUCKET.TODAY, BUCKET.YESTERDAY, BUCKET.EARLIER]);
    expect(groups[0].rows.map(r => r.id)).toEqual([1, 2]);
  });

  it('preserves the incoming newest-first order within a group', () => {
    expect(groupByDay(rows, NOW)[0].rows.map(r => r.id)).toEqual([1, 2]);
  });

  it('drops empty groups instead of rendering a header over nothing', () => {
    const groups = groupByDay([rows[3]], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].bucket).toBe(BUCKET.EARLIER);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});

describe('toDate', () => {
  it('passes a Date through and rejects an invalid one', () => {
    expect(toDate(NOW)).toBe(NOW);
    expect(toDate(new Date('nope'))).toBeNull();
    expect(toDate(undefined)).toBeNull();
  });
});
