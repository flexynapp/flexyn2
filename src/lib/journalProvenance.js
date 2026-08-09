// src/lib/journalProvenance.js
//
// Was this entry written on the day it describes, or after the fact?
//
// The 7-day edit window (journalEditWindow.js) made that question real:
// before it, every entry was necessarily same-day, so there was nothing
// to mark. Now an entry can be written three days late, or amended a
// week after the session it describes, and nothing said so — which is
// the difference between a record and a document.
//
// NO MIGRATION. `journal_entries` has carried `created_at` and
// `updated_at` since migration 145, so this is derived from columns that
// already exist and it answers correctly for rows written before the
// marker existed. A dedicated `edited_at` column would have been a
// migration, a backfill, and a second source of truth to keep in step.
//
// Two things this deliberately does NOT do:
//   • It does not distinguish WHAT changed. `tagMood` bumps updated_at
//     too, so tapping a mood on a past day marks the entry as edited.
//     That is honest — the mood is part of the entry — and the
//     alternative is per-field auditing for a line of muted text.
//   • It does not treat updated_at as trustworthy to the second. It is
//     client-supplied, so a skewed clock can produce a nonsense delta;
//     anything negative or absurd yields no marker rather than a wrong
//     one. Saying nothing is always available and never wrong.

/** Local calendar date of an ISO timestamp, as YYYY-MM-DD. `updated_at` is
 *  a timestamptz and `entry_date` is a LOCAL date, so they cannot be
 *  compared until the timestamp is resolved in the viewer's own zone —
 *  otherwise an evening edit in UTC-6 reads as the following day. */
function localDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysBetween(fromDateStr, toDateStr) {
  const a = Date.parse(`${fromDateStr}T00:00:00`);
  const b = Date.parse(`${toDateStr}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

// A delta beyond this is a broken clock, not a late edit.
const MAX_SANE_DAYS = 3650;

/**
 * @param {object} entry  { entry_date, created_at, updated_at }
 * @returns {{ writtenLate: number|0, editedLate: number|0, marked: boolean }}
 *   writtenLate — days between the day and when the entry first existed
 *   editedLate  — days between the day and the last write, when that is
 *                 later than creation
 */
export function provenance(entry) {
  const none = { writtenLate: 0, editedLate: 0, marked: false };
  if (!entry?.entry_date) return none;

  const created = localDate(entry.created_at);
  const updated = localDate(entry.updated_at);

  const cDelta = created ? daysBetween(entry.entry_date, created) : null;
  const uDelta = updated ? daysBetween(entry.entry_date, updated) : null;

  const sane = (n) => typeof n === 'number' && n > 0 && n <= MAX_SANE_DAYS;

  const writtenLate = sane(cDelta) ? cDelta : 0;
  // Only an edit that happened AFTER creation is an edit. An entry
  // written late is one write, not a write plus an amendment, and
  // reporting both from a single upsert would double-count it.
  const editedLate = sane(uDelta) && (cDelta == null || uDelta > cDelta) ? uDelta : 0;

  return { writtenLate, editedLate, marked: writtenLate > 0 || editedLate > 0 };
}

/**
 * The one line to render, or null. Kept beside the rule so the three
 * cases cannot drift apart from the booleans that produce them.
 *
 * @param t  (key, englishFallback) => string
 */
export function provenanceLabel(entry, t) {
  const { writtenLate, editedLate } = provenance(entry);
  // One key per phrasing, with the count interpolated — NOT a key per
  // count. `journal.prov.nDays.3` would be an unbounded key space that no
  // translator can ever finish, and every miss renders the raw key path
  // (see the i18n note in CLAUDE.md: getTranslation returns the KEY on a
  // total miss, which is truthy and therefore looks like a value).
  const days = (n) => (n === 1
    ? t('journal.prov.day', '1 day', { n })
    : t('journal.prov.days', `${n} days`, { n }));

  if (writtenLate && editedLate) {
    return t('journal.prov.writtenAndEdited', `Written ${days(writtenLate)} later, edited since`, { d: days(writtenLate) });
  }
  if (writtenLate) return t('journal.prov.written', `Written ${days(writtenLate)} later`, { d: days(writtenLate) });
  if (editedLate) return t('journal.prov.edited', `Edited ${days(editedLate)} later`, { d: days(editedLate) });
  return null;
}
