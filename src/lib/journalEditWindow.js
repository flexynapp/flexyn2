// src/lib/journalEditWindow.js
//
// How far back a My Journal day stays writable, as one pure function so
// the rule can be tested without rendering the editor.
//
// The old rule was `readOnly = !isToday` — one expression, no comment,
// and never designed. It refused the thing a training journal is most
// often used for: writing up last night's session the next morning.
// Nothing scored reads journal_entries (no XP, coin, achievement or
// leaderboard path touches it, and Readiness reads mood_logs), so no
// invariant was holding the lock in place.
//
// Seven days covers the real case and matches the weekly frame the rest
// of the app already uses. Beyond it an entry stays fixed: a journal you
// can silently rewrite forever is a different promise.

export const EDIT_WINDOW_DAYS = 7;

/**
 * @param {string} dateStr  the day being viewed, YYYY-MM-DD
 * @param {string} today    today, YYYY-MM-DD
 * @returns {{ daysAgo: number, readOnly: boolean, isToday: boolean }}
 */
export function editability(dateStr, today) {
  // Compared as local midnights parsed from the STRINGS, never as a diff
  // of live timestamps: `new Date()` carries a time-of-day, so a
  // millisecond subtraction answers "0 days ago" for yesterday at 23:00
  // and "1" for yesterday at 01:00 — the window would then quietly widen
  // or narrow depending on what time the user opened the app.
  const a = Date.parse(`${today}T00:00:00`);
  const b = Date.parse(`${dateStr}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    // Unparseable means we cannot prove the day is inside the window, and
    // the safe direction is read-only: refusing an edit is recoverable,
    // silently writing to the wrong day is not.
    return { daysAgo: NaN, readOnly: true, isToday: false };
  }
  const daysAgo = Math.round((a - b) / 86400000);
  return {
    daysAgo,
    // A future day is not writable either — it is reachable only by a
    // clock change, and it is not a day that has happened.
    readOnly: daysAgo > EDIT_WINDOW_DAYS || daysAgo < 0,
    isToday: daysAgo === 0,
  };
}
