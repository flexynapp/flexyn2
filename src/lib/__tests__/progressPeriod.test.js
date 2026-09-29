import { describe, it, expect } from 'vitest';
import { periodBounds, splitByPeriod } from '@/lib/progressPeriod';

// Wednesday 2026-09-30, midday local time.
const WED = new Date(2026, 8, 30, 12);
const row = (date) => ({ id: date, date });
const ids = (rows) => rows.map((r) => r.id);

describe('periodBounds', () => {
  it('starts the week on Monday, like the hero ring', () => {
    const b = periodBounds('week', WED);
    expect(b.start).toEqual(new Date(2026, 8, 28));
    expect(b.prevStart).toEqual(new Date(2026, 8, 21));
    // Mon to Wed this week is three days, so last week is Mon to Wed too.
    expect(b.prevEnd).toEqual(new Date(2026, 8, 24));
  });

  it('never lets the previous month run into this one', () => {
    // 31 March: February has 28 days, so the window stops at 1 March.
    const b = periodBounds('month', new Date(2026, 2, 31, 9));
    expect(b.prevStart).toEqual(new Date(2026, 1, 1));
    expect(b.prevEnd).toEqual(new Date(2026, 2, 1));
  });

  it('has no previous period for all time', () => {
    expect(periodBounds('all', WED)).toBeNull();
  });
});

describe('splitByPeriod', () => {
  const rows = [
    row('2026-09-20'), // Sun of the week before last
    row('2026-09-21'), // Mon last week
    row('2026-09-23'), // Wed last week
    row('2026-09-24'), // Thu last week, past this week's elapsed span
    row('2026-09-27'), // Sun last week
    row('2026-09-28'), // Mon this week
    row('2026-09-30'), // today
  ];

  it('counts the calendar week, not the last seven days', () => {
    const { current, prev } = splitByPeriod(rows, 'week', WED);
    expect(ids(current)).toEqual(['2026-09-28', '2026-09-30']);
    expect(ids(prev)).toEqual(['2026-09-21', '2026-09-23']);
  });

  it('compares a Monday with last Monday only', () => {
    const { prev } = splitByPeriod(rows, 'week', new Date(2026, 8, 28, 8));
    expect(ids(prev)).toEqual(['2026-09-21']);
  });

  it('returns everything for all time, with no comparison', () => {
    const { current, prev } = splitByPeriod(rows, 'all', WED);
    expect(current).toHaveLength(rows.length);
    expect(prev).toBeNull();
  });

  it('ignores rows without a date', () => {
    const { current } = splitByPeriod([{ id: 'x' }, row('2026-09-29')], 'week', WED);
    expect(ids(current)).toEqual(['2026-09-29']);
  });
});
