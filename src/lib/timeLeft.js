// src/lib/timeLeft.js
//
// "3d 4h left" without pulling a formatter in. date-fns' formatDistanceToNow
// rounds to a single unit ("4 days"), which on the last day of a countdown
// reads as if there is a day left when there are two hours — the one point in
// the window where the number changes behaviour. It also binds no locale, so
// it renders English under a fully translated screen.
//
// The d/h suffixes are not translated and that is deliberate: they are the
// same two letters in every released locale, and a key per unit buys a
// translator a decision they cannot make better. The WORD around them is
// keyed — `crewWars.timeLeft` ("{t} left") — so the sentence still moves.

/**
 * Whole days and hours until `endsAt`, or null when it has passed.
 *
 * @param {string|number|Date} endsAt
 * @param {Date} [now]
 * @returns {string|null} e.g. "3d 4h", "7h"
 */
export function timeLeft(endsAt, now = new Date()) {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
}
