// src/lib/timeLeft.js
//
// "3d 4h left" without pulling a formatter in. date-fns' formatDistanceToNow
// rounds to a single unit ("4 days"), which on the last day of a countdown
// reads as if there is a day left when there are two hours — the one point in
// the window where the number changes behaviour. It also binds no locale, so
// it renders English under a fully translated screen.
//
// The d/h units come from Intl (formatUnit), not hardcoded letters: French
// writes days as "j" and German as "T". This comment used to claim the
// letters were the same in every released locale, and French showed "3d".
// The WORD around them is keyed — `crewWars.timeLeft` ("{t} left") — so the
// sentence still moves.

import { formatUnit } from '@/lib/intlFormat';

/**
 * Whole days and hours until `endsAt`, or null when it has passed.
 *
 * @param {string|number|Date} endsAt
 * @param {Date} [now]
 * @param {string} [language] app language code; English when omitted
 * @returns {string|null} e.g. "3d 4h", "7h" (fr: "3j 4h")
 */
export function timeLeft(endsAt, now = new Date(), language = 'en') {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  return days > 0
    ? `${formatUnit(days, 'day', language)} ${formatUnit(hours % 24, 'hour', language)}`
    : formatUnit(hours, 'hour', language);
}
