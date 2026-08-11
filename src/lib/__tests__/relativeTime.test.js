/**
 * `formatRelativeTime` — the always-relative comment timestamp.
 *
 * Two things this pins:
 *
 * 1. The unit boundaries. A comment age has to read naturally the whole way
 *    from seconds to years, and the failure mode of a naive implementation is
 *    "9 weeks ago" where a human says "2 months ago", or "in 12 seconds" on a
 *    comment that already exists because the device clock is a few seconds
 *    ahead of the server.
 *
 * 2. That it is locale-bound. This is the trap CLAUDE.md's i18n section
 *    describes: date-fns `format()`/`formatDistanceToNow` bind no locale, so
 *    they render English under a fully-translated screen and NO
 *    translation-key audit can see it — there is no key to be missing. The
 *    non-English assertions below exist to fail if someone swaps this back to
 *    date-fns for convenience.
 */
import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '@/lib/intlFormat';

const NOW = new Date('2026-08-11T12:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms);

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime — unit boundaries', () => {
  it('reads as now under a minute', () => {
    expect(formatRelativeTime(ago(0), 'en', NOW)).toMatch(/now/i);
    expect(formatRelativeTime(ago(30 * SEC), 'en', NOW)).toMatch(/now/i);
    expect(formatRelativeTime(ago(59 * SEC), 'en', NOW)).toMatch(/now/i);
  });

  it('switches to minutes at one minute', () => {
    expect(formatRelativeTime(ago(MIN), 'en', NOW)).toMatch(/1 minute ago/);
    expect(formatRelativeTime(ago(45 * MIN), 'en', NOW)).toMatch(/45 minutes ago/);
  });

  it('switches to hours at one hour', () => {
    expect(formatRelativeTime(ago(HOUR), 'en', NOW)).toMatch(/1 hour ago/);
    expect(formatRelativeTime(ago(5 * HOUR), 'en', NOW)).toMatch(/5 hours ago/);
  });

  it('switches to days at one day', () => {
    expect(formatRelativeTime(ago(DAY), 'en', NOW)).toMatch(/yesterday|1 day ago/i);
    expect(formatRelativeTime(ago(3 * DAY), 'en', NOW)).toMatch(/3 days ago/);
  });

  it('switches to weeks, then months, then years', () => {
    expect(formatRelativeTime(ago(10 * DAY), 'en', NOW)).toMatch(/week/);
    expect(formatRelativeTime(ago(60 * DAY), 'en', NOW)).toMatch(/month/);
    expect(formatRelativeTime(ago(400 * DAY), 'en', NOW)).toMatch(/year/);
  });

  it('says months rather than an unnatural number of weeks', () => {
    // 63 days is 9 weeks. Nobody says "9 weeks ago".
    const out = formatRelativeTime(ago(63 * DAY), 'en', NOW);
    expect(out).toMatch(/month/);
    expect(out).not.toMatch(/week/);
  });

  it('clamps a clock-skewed future stamp to now instead of a future tense', () => {
    const future = new Date(NOW.getTime() + 20 * SEC);
    expect(formatRelativeTime(future, 'en', NOW)).toMatch(/now/i);
    expect(formatRelativeTime(future, 'en', NOW)).not.toMatch(/in \d/);
  });
});

describe('formatRelativeTime — locale binding', () => {
  it('renders in the viewer language, not English', () => {
    // If any of these come back English, the implementation has lost its
    // locale and the whole screen silently reverts for non-English users.
    expect(formatRelativeTime(ago(2 * HOUR), 'es', NOW)).toMatch(/hace 2 horas/i);
    expect(formatRelativeTime(ago(2 * HOUR), 'fr', NOW)).toMatch(/il y a 2 heures/i);
    expect(formatRelativeTime(ago(2 * HOUR), 'de', NOW)).toMatch(/vor 2 Stunden/i);
  });

  it('pluralises correctly per language rather than appending an s', () => {
    expect(formatRelativeTime(ago(MIN), 'es', NOW)).toMatch(/hace 1 minuto/i);
    expect(formatRelativeTime(ago(3 * MIN), 'es', NOW)).toMatch(/hace 3 minutos/i);
  });

  it('handles a non-Latin locale', () => {
    const ja = formatRelativeTime(ago(3 * HOUR), 'ja', NOW);
    expect(ja).toMatch(/3/);
    expect(ja).not.toMatch(/hours? ago/);
  });
});

describe('formatRelativeTime — malformed input', () => {
  it('returns an empty string rather than throwing or printing Invalid Date', () => {
    expect(formatRelativeTime(null, 'en', NOW)).toBe('');
    expect(formatRelativeTime(undefined, 'en', NOW)).toBe('');
    expect(formatRelativeTime('not a date', 'en', NOW)).toBe('');
  });

  it('degrades to English on an unknown language code instead of blanking', () => {
    const out = formatRelativeTime(ago(2 * HOUR), 'not-a-lang', NOW);
    expect(out).toBeTruthy();
    expect(out).toMatch(/2/);
  });

  it('accepts an ISO string, which is what the database returns', () => {
    expect(formatRelativeTime('2026-08-11T10:00:00Z', 'en', NOW)).toMatch(/2 hours ago/);
  });
});
