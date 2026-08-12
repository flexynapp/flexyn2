/**
 * The journal log's search box and month filter.
 *
 * The month tests are the ones worth having: `entry_date` is a calendar day
 * string, and the obvious implementation — `new Date(entry_date).getMonth()` —
 * parses it as UTC midnight, which files the 1st of every month under the
 * month before it anywhere west of Greenwich. That bug is invisible in a
 * London CI box and wrong for every American user, so it is pinned here
 * rather than left to be noticed.
 */
import { describe, it, expect } from 'vitest';
import { filterEntries, monthsPresent, monthKeyOf } from '@/lib/journalSearch';

const rows = [
  { id: 1, entry_date: '2026-08-12', title: 'Push day',  snippet: 'Bench felt strong' },
  { id: 2, entry_date: '2026-08-01', title: null,        snippet: 'Легкая пробежка' },
  { id: 3, entry_date: '2026-07-30', title: 'Café stop', snippet: 'rest day' },
  { id: 4, entry_date: '2026-07-04', title: null,        snippet: 'Leg press 3x10' },
];

describe('monthKeyOf', () => {
  it('reads the month off the string rather than parsing a Date', () => {
    // The first of the month is the case that breaks under UTC parsing.
    expect(monthKeyOf({ entry_date: '2026-08-01' })).toBe('2026-08');
  });

  it('returns empty for a malformed or missing date', () => {
    expect(monthKeyOf({ entry_date: 'nonsense' })).toBe('');
    expect(monthKeyOf({})).toBe('');
    expect(monthKeyOf(null)).toBe('');
  });
});

describe('monthsPresent', () => {
  it('lists each month once, newest first, with counts', () => {
    expect(monthsPresent(rows)).toEqual([
      { key: '2026-08', count: 2 },
      { key: '2026-07', count: 2 },
    ]);
  });

  it('offers no month that has no entries', () => {
    // The dropdown is built from this. A month with nothing in it would be a
    // control whose only possible outcome is an empty screen.
    const keys = monthsPresent(rows).map(m => m.key);
    expect(keys).not.toContain('2026-06');
  });

  it('survives an empty or missing list', () => {
    expect(monthsPresent([])).toEqual([]);
    expect(monthsPresent(null)).toEqual([]);
  });
});

describe('filterEntries', () => {
  it('returns everything when nothing is asked for', () => {
    expect(filterEntries(rows, {})).toHaveLength(4);
    expect(filterEntries(rows)).toHaveLength(4);
  });

  it('treats an all-whitespace query as no query', () => {
    // A stray space must not blank the screen.
    expect(filterEntries(rows, { query: '   ' })).toHaveLength(4);
  });

  it('matches the title, case-insensitively', () => {
    expect(filterEntries(rows, { query: 'PUSH' }).map(r => r.id)).toEqual([1]);
  });

  it('matches the snippet', () => {
    expect(filterEntries(rows, { query: 'bench' }).map(r => r.id)).toEqual([1]);
  });

  it('matches the raw date, so you can search a day you cannot describe', () => {
    expect(filterEntries(rows, { query: '2026-07-04' }).map(r => r.id)).toEqual([4]);
  });

  it('ignores diacritics in both directions', () => {
    expect(filterEntries(rows, { query: 'cafe' }).map(r => r.id)).toEqual([3]);
    expect(filterEntries(rows, { query: 'café' }).map(r => r.id)).toEqual([3]);
  });

  it('ANDs multiple terms rather than ORing them', () => {
    // "leg press" must narrow. An OR would also return every row containing
    // the word "leg" OR the word "press", which on a training journal is
    // most of them.
    expect(filterEntries(rows, { query: 'leg press' }).map(r => r.id)).toEqual([4]);
    expect(filterEntries(rows, { query: 'leg banana' })).toEqual([]);
  });

  it('matches non-Latin text', () => {
    expect(filterEntries(rows, { query: 'пробежка' }).map(r => r.id)).toEqual([2]);
  });

  it('filters by month', () => {
    expect(filterEntries(rows, { month: '2026-07' }).map(r => r.id)).toEqual([3, 4]);
  });

  it('combines month and query', () => {
    expect(filterEntries(rows, { month: '2026-07', query: 'rest' }).map(r => r.id)).toEqual([3]);
    expect(filterEntries(rows, { month: '2026-08', query: 'rest' })).toEqual([]);
  });

  it('preserves the incoming order, which is what the month grouping relies on', () => {
    // groupByMonth walks the list once and starts a new section whenever the
    // month key changes, so a filter that reordered rows would split a month
    // into two headed sections.
    expect(filterEntries(rows, { query: 'a' }).map(r => r.id))
      .toEqual(rows.filter(r => filterEntries([r], { query: 'a' }).length).map(r => r.id));
  });

  it('tolerates rows with null title and snippet', () => {
    expect(() => filterEntries([{ entry_date: '2026-08-01' }], { query: 'x' })).not.toThrow();
  });
});
