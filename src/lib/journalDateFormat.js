// src/lib/journalDateFormat.js
//
// What the journal's day header says, and why it is not simply
// "weekday, month day".
//
// The header is the dominant element on the screen — the date IS the page.
// It also sits in the narrowest row in the feature: two 28pt day arrows on
// either side and the mood chip to its right leave the heading **233pt** at
// a 375pt iPhone SE, measured live at `font-heading font-bold text-xl`
// (Archivo 700 20px).
//
// The full form does not fit in that box, and this was never a Spanish
// problem — it was an every-language problem that English happened to lose
// by the smallest margin, so it read as "slightly tight" rather than broken:
//
//     widest of the 15 supported languages, Archivo 700 20px
//
//     weekday + month + day                294pt   pt-BR  ✗  (7 languages clip)
//       └─ "segunda-feira, 24 de novembro"
//     weekday + month + day + year         373pt   pt-BR  ✗  (10 languages clip)
//       └─ "segunda-feira, 24 de novembro de 2025"
//     SHORT weekday + month + day          217pt   pl     ✓
//     SHORT weekday + short month + year   235pt   pt-BR  ✗  (pt-BR alone, by 2pt)
//     short month + day + year             177pt   pt-BR  ✓
//
// `truncate` made this actively harmful rather than merely ugly on the
// out-of-year form: the ellipsis eats the END of the string, which is where
// the YEAR is. "miércoles, 24 de diciembre d…" is not a shorter way of
// saying December 2025 — it is indistinguishable from December 2026, on the
// one screen whose entire subject is which day you are looking at.
//
// So the weekday is abbreviated (Kegan's call, 2026-08-09, from the measured
// options). The weekday is the token that survives abbreviation best: "mié"
// and "Wed" are unambiguous in a way that a clipped month name is not.
//
// That fixed the current year everywhere and left pt-BR two points over on
// out-of-year dates — "dom., 24 de ago. de 2025", 235pt, because Portuguese
// spends two "de" particles on one date. Two points is not a margin worth
// shipping: Archivo failing to load and Helvetica standing in would swallow
// it, and then the year truncates again on exactly one language. So the
// weekday comes off out-of-year dates entirely, which buys 56pt.
//
// The result is a symmetry the component already half-had, rather than two
// unrelated exceptions — SHOW THE TOKENS THAT DISCRIMINATE AT THAT DISTANCE:
//
//     within this year   weekday, month, day    the year is noise; every
//                                               date shares it
//     any other year     month, day, YEAR       the weekday is noise; you
//                                               are 228 days out and the
//                                               label beneath already says
//                                               so ("hace 228 días")
//
// The year-dropping half of that rule predates this work. The weekday-
// dropping half is its mirror, and both exist because a token that cannot
// tell two candidate days apart is costing width that a token which can
// needs.

/**
 * Intl.DateTimeFormat options for the journal's day header.
 *
 * Pass both dates so the "is this the current year" decision is explicit
 * and testable rather than reading the clock inside a formatter.
 *
 * @param {Date} date  the day being shown
 * @param {Date} now   today, for the year comparison
 * @returns {Intl.DateTimeFormatOptions}
 */
export function dayHeaderFormat(date, now) {
  const sameYear = date.getFullYear() === now.getFullYear();
  return sameYear
    ? { weekday: 'short', month: 'long', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
}

/**
 * The widest the heading may render before it truncates, in CSS px, at the
 * narrowest supported phone. Exported so a test can assert the formats
 * chosen above actually fit rather than trusting the comment.
 */
export const HEADER_BOX_PX = 233;
