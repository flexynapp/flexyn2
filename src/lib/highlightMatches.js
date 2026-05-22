// src/lib/highlightMatches.js
//
// Split a string into alternating non-match / match segments based on
// a query. Used by the in-thread DM search overlay to render matches
// with a highlighted background while preserving surrounding text.
//
// Returns:
//   [{ text, match: boolean }, ...]
//
// Case-insensitive; empty / null queries return the full string as a
// single non-match segment so the caller can blindly render the array.

export function highlightMatches(text, query) {
  const safeText = typeof text === 'string' ? text : '';
  if (!query || typeof query !== 'string') {
    return [{ text: safeText, match: false }];
  }
  const q = query.trim();
  if (!q) return [{ text: safeText, match: false }];

  if (safeText.length === 0) {
    return [{ text: '', match: false }];
  }
  const segments = [];
  const lower = safeText.toLowerCase();
  const ql = q.toLowerCase();
  let cursor = 0;
  while (cursor < safeText.length) {
    const i = lower.indexOf(ql, cursor);
    if (i === -1) {
      segments.push({ text: safeText.slice(cursor), match: false });
      break;
    }
    if (i > cursor) segments.push({ text: safeText.slice(cursor, i), match: false });
    segments.push({ text: safeText.slice(i, i + q.length), match: true });
    cursor = i + q.length;
  }
  return segments;
}

/** Count how many times the query matches within text (case-insensitive). */
export function countMatches(text, query) {
  if (!query || typeof query !== 'string' || typeof text !== 'string') return 0;
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const lower = text.toLowerCase();
  let count = 0;
  let i = 0;
  while ((i = lower.indexOf(q, i)) !== -1) {
    count += 1;
    i += q.length;
  }
  return count;
}
