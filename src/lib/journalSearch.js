// src/lib/journalSearch.js
//
// Filtering for the journal log's search box and month filter.
//
// A pure module rather than inline state in JournalHistoryModal, for the
// reason CLAUDE.md's testing section gives: the modal mounts a portal, a
// language context, a date formatter and a network read, and none of that is
// what's worth proving. What's worth proving is which rows survive a query.
//
// The whole journal is already in memory when this runs — `listEntries` pulls
// 365 days in one read and the modal groups them client-side — so filtering
// here costs nothing and never touches the network. That is the Notes-app
// behaviour Sean asked for: results move on every keystroke, offline included.
// Do NOT convert this to a server-side `ilike` query without measuring the row
// count first; at production's scale it would be slower AND stop working on a
// dropped connection.

/**
 * Normalise for comparison: casefold and strip diacritics, so "cafe" finds
 * "café" and "SQUATS" finds "squats". `NFD` splits an accented character into
 * its base plus a combining mark, and the range below drops the marks.
 */
function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * The month key a row belongs to, as `YYYY-MM`.
 *
 * Sliced off the STRING rather than parsed into a Date on purpose:
 * `entry_date` is already a local `YYYY-MM-DD` calendar day, and
 * `new Date('2026-08-01')` parses as UTC midnight, which in any timezone west
 * of Greenwich is the 31st of July locally. That would file the first of every
 * month under the month before it.
 */
export function monthKeyOf(row) {
  const d = String(row?.entry_date ?? '');
  return /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : '';
}

/**
 * Distinct months present in the rows, newest first, each with its row count.
 * Feeds the filter dropdown — offering a month with nothing in it would be a
 * control that can only ever produce an empty list.
 *
 * @param {Array} rows
 * @returns {Array<{key: string, count: number}>}
 */
export function monthsPresent(rows) {
  const counts = new Map();
  (rows || []).forEach((r) => {
    const k = monthKeyOf(r);
    if (!k) return;
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/**
 * Rows matching a free-text query and/or a month.
 *
 * Matches against the title, the snippet AND the raw `YYYY-MM-DD`, so typing
 * "2026-08" or "08-11" finds a day whose text you can't remember. The date is
 * searched as the stored string rather than as the formatted label because the
 * label is locale-dependent — matching it would mean a query that works in
 * English silently fails in Spanish.
 *
 * An all-whitespace query is treated as no query: a stray space must not empty
 * the screen.
 *
 * @param {Array} rows
 * @param {{query?: string, month?: string}} [opts] `month` is 'YYYY-MM' or ''
 * @returns {Array} the surviving rows, in their original order
 */
export function filterEntries(rows, { query = '', month = '' } = {}) {
  const q = norm(query).trim();
  const list = (rows || []).filter((r) => !month || monthKeyOf(r) === month);
  if (!q) return list;
  return list.filter((r) => {
    const hay = `${norm(r?.title)} ${norm(r?.snippet)} ${String(r?.entry_date ?? '')}`;
    // Every whitespace-separated term must appear somewhere in the row, so
    // "leg press" narrows rather than widening into an OR of two common words.
    return q.split(/\s+/).every((term) => hay.includes(term));
  });
}
