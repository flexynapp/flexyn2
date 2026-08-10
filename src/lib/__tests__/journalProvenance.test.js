// src/lib/__tests__/journalProvenance.test.js
//
// The edit marker. It exists because the 7-day window does — before that
// every entry was necessarily same-day and there was nothing to mark —
// and it is derived from `created_at` / `updated_at`, which have been on
// journal_entries since migration 145. That is why it needed no
// migration and why it answers correctly for rows written before it.
//
// Three traps, all of which produce a confidently WRONG line rather than
// a missing one, which is the worse failure for a provenance marker:
//   • entry_date is a LOCAL date and updated_at is a timestamptz. Compare
//     them without resolving the timestamp in the viewer's zone and an
//     evening edit reads as the next day.
//   • an entry written late is ONE write. Counting it as written-late AND
//     edited-late double-reports a single upsert as an amendment.
//   • updated_at is client-supplied, so a skewed clock can produce a
//     nonsense delta. Say nothing rather than something wrong.

import { describe, it, expect } from 'vitest';
import { provenance, provenanceLabel } from '../journalProvenance';

// Build an ISO timestamp at a given LOCAL wall-clock time, so these tests
// assert the same thing in every timezone CI might run in. Using a literal
// "…T14:00:00Z" would flip results either side of the date line.
const at = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm).toISOString();
const t = (key, english) => english;

describe('provenance', () => {
  it('marks nothing for an entry written and left alone on its own day', () => {
    expect(provenance({
      entry_date: '2026-08-09',
      created_at: at(2026, 8, 9, 9),
      updated_at: at(2026, 8, 9, 21),
    })).toEqual({ writtenLate: 0, editedLate: 0, marked: false });
  });

  it('marks an entry written the next morning about yesterday', () => {
    const p = provenance({
      entry_date: '2026-08-08',
      created_at: at(2026, 8, 9, 7),
      updated_at: at(2026, 8, 9, 7),
    });
    expect(p).toEqual({ writtenLate: 1, editedLate: 0, marked: true });
  });

  it('does NOT double-report a late write as an amendment', () => {
    // One upsert: created_at and updated_at are the same instant. Reporting
    // both would render "Written 2 days later, edited since" for a single
    // write that was never edited at all.
    const iso = at(2026, 8, 9, 10);
    expect(provenance({ entry_date: '2026-08-07', created_at: iso, updated_at: iso }))
      .toEqual({ writtenLate: 2, editedLate: 0, marked: true });
  });

  it('marks a same-day entry amended days later', () => {
    expect(provenance({
      entry_date: '2026-08-02',
      created_at: at(2026, 8, 2, 20),
      updated_at: at(2026, 8, 5, 8),
    })).toEqual({ writtenLate: 0, editedLate: 3, marked: true });
  });

  it('reports both when a late entry is later amended again', () => {
    expect(provenance({
      entry_date: '2026-08-02',
      created_at: at(2026, 8, 3, 9),
      updated_at: at(2026, 8, 6, 9),
    })).toEqual({ writtenLate: 1, editedLate: 4, marked: true });
  });

  it('resolves the timestamp in LOCAL time, so a late-evening edit is still same-day', () => {
    // 23:50 local on the entry's own day. Compared as a UTC calendar date
    // this is "tomorrow" for anywhere east of UTC, and the entry would be
    // wrongly stamped as edited a day late.
    expect(provenance({
      entry_date: '2026-08-09',
      created_at: at(2026, 8, 9, 8),
      updated_at: at(2026, 8, 9, 23, 50),
    }).marked).toBe(false);
  });

  it('says nothing rather than something wrong when the clock is skewed', () => {
    // updated_at BEFORE the day it belongs to, and an absurd future delta.
    expect(provenance({ entry_date: '2026-08-09', created_at: at(2026, 8, 1), updated_at: at(2026, 8, 1) }).marked).toBe(false);
    expect(provenance({ entry_date: '2026-08-09', created_at: at(2040, 1, 1), updated_at: at(2040, 1, 1) }).marked).toBe(false);
  });

  it('is inert on missing or malformed input', () => {
    const none = { writtenLate: 0, editedLate: 0, marked: false };
    expect(provenance(null)).toEqual(none);
    expect(provenance({})).toEqual(none);
    expect(provenance({ entry_date: '2026-08-09' })).toEqual(none);
    expect(provenance({ entry_date: '2026-08-09', created_at: 'garbage', updated_at: 'garbage' })).toEqual(none);
  });
});

describe('provenanceLabel', () => {
  it('renders null when there is nothing to say', () => {
    expect(provenanceLabel({ entry_date: '2026-08-09', created_at: at(2026, 8, 9), updated_at: at(2026, 8, 9) }, t)).toBeNull();
    expect(provenanceLabel(null, t)).toBeNull();
  });

  it('singularises one day', () => {
    expect(provenanceLabel({ entry_date: '2026-08-08', created_at: at(2026, 8, 9), updated_at: at(2026, 8, 9) }, t))
      .toBe('Written 1 day later');
  });

  it('pluralises the rest', () => {
    expect(provenanceLabel({ entry_date: '2026-08-02', created_at: at(2026, 8, 2), updated_at: at(2026, 8, 5) }, t))
      .toBe('Edited 3 days later');
    expect(provenanceLabel({ entry_date: '2026-08-02', created_at: at(2026, 8, 3), updated_at: at(2026, 8, 6) }, t))
      .toBe('Written 1 day later, edited since');
  });
});

describe('the label interpolates, in a language that is not English', () => {
  // Same guard as dayContext's: the `(key, english) => english` stub above
  // returns a fallback that has ALREADY interpolated via template literal, so
  // it cannot see a caller that drops its vars. Under a real translation the
  // hole is visible — "Escrito {d} despues" — and that is what shipped until
  // JournalView's t-wrapper stopped discarding its third argument.
  const tES = (key, english, vars) => {
    const TPL = {
      'journal.prov.day': '1 dia',
      'journal.prov.days': '{n} dias',
      'journal.prov.written': 'Escrito {d} despues',
      'journal.prov.edited': 'Editado {d} despues',
      'journal.prov.writtenAndEdited': 'Escrito {d} despues, editado desde entonces',
    };
    const tpl = TPL[key];
    if (!tpl) return english;
    return tpl.replace(/\{(\w+)\}/g, (m, name) => (vars && name in vars ? String(vars[name]) : m));
  };

  const late = (writtenDays) => ({
    entry_date: '2026-08-01',
    created_at: `2026-08-0${1 + writtenDays}T12:00:00Z`,
    updated_at: `2026-08-0${1 + writtenDays}T12:00:00Z`,
  });

  it('leaves no {d} or {n} in any phrasing', () => {
    for (const days of [1, 3]) {
      const label = provenanceLabel(late(days), tES);
      expect(label, `${days}-day-late entry produced no label`).toBeTruthy();
      expect(label, `unsubstituted placeholder in "${label}"`).not.toMatch(/\{\w+\}/);
      expect(label.startsWith('Escrito')).toBe(true);
    }
  });

  it('nests the day count INSIDE the sentence, not beside it', () => {
    // `days()` is itself a translated string passed as {d}. A wrapper that
    // drops vars breaks the outer sentence and the inner count separately.
    expect(provenanceLabel(late(3), tES)).toBe('Escrito 3 dias despues');
  });
});

