// Guards the journal day header's date format.
//
// What these can and cannot check matters here. The format was chosen by
// MEASURING rendered text against the 233pt box the header actually gets on
// a 375pt phone — and jsdom has no text metrics, so a test cannot re-measure
// it. What a test CAN do is stop the two ways this regresses:
//
//   1. Someone restores `weekday: 'long'` because it reads better in
//      English. It does read better in English. It also clips in 7 of the
//      15 supported languages, English included.
//   2. Someone drops the year from the out-of-year branch to save width.
//      The year is the only thing distinguishing December 2025 from
//      December 2026 on a screen whose whole subject is which day it is.
//
// The px numbers live in the module's header comment beside the formats
// they justify.

import { describe, it, expect } from 'vitest';
import { dayHeaderFormat, HEADER_BOX_PX } from '../journalDateFormat';

const LANGS = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru', 'tr', 'pl', 'nl'];

const NOW = new Date(2026, 7, 9); // 2026-08-09

describe('the rule', () => {
  it('omits the year within the current year', () => {
    const opts = dayHeaderFormat(new Date(2026, 0, 1), NOW);
    expect(opts.year).toBeUndefined();
  });

  it('includes the year outside it, in BOTH directions', () => {
    // Backwards is the common case (browsing the Log). Forwards matters
    // because a device with a wrong clock, or a New Year's Eve session that
    // crosses midnight, can legitimately land there.
    for (const d of [new Date(2025, 11, 24), new Date(2027, 0, 2)]) {
      expect(dayHeaderFormat(d, NOW).year, `${d.toDateString()} lost its year`).toBe('numeric');
    }
  });

  it('never asks for a long weekday — that is the form that clipped', () => {
    for (const d of [new Date(2026, 0, 1), new Date(2025, 11, 24)]) {
      expect(dayHeaderFormat(d, NOW).weekday).not.toBe('long');
    }
  });

  it('drops the weekday entirely once the year has to be shown', () => {
    // The two halves of one rule: show the tokens that DISCRIMINATE at that
    // distance. Inside this year every date shares the year, so it is noise
    // and the weekday earns its width. Outside it the reverse holds — and
    // keeping both put pt-BR 2pt over the box, which is how a truncated
    // year gets back onto the screen.
    expect(dayHeaderFormat(new Date(2026, 0, 1), NOW).weekday).toBe('short');
    expect(dayHeaderFormat(new Date(2025, 11, 24), NOW).weekday).toBeUndefined();
  });

  it('shortens the month only when the year is also being shown', () => {
    // Within this year there is room for the full month name, and the month
    // is the more useful word. Adding a year is what forces the trade.
    expect(dayHeaderFormat(new Date(2026, 0, 1), NOW).month).toBe('long');
    expect(dayHeaderFormat(new Date(2025, 11, 24), NOW).month).toBe('short');
  });
});

describe('what it produces, in every supported language', () => {
  it('always renders a day number, in both branches', () => {
    for (const lang of LANGS) {
      for (const d of [NOW, new Date(2025, 11, 24)]) {
        const s = new Intl.DateTimeFormat(lang, dayHeaderFormat(d, NOW)).format(d);
        expect(s.trim(), `${lang} produced nothing`).not.toBe('');
        expect(/\d/.test(s), `${lang} has no day number: "${s}"`).toBe(true);
      }
    }
  });

  it('always renders the year on an out-of-year date', () => {
    const old = new Date(2025, 11, 24);
    for (const lang of LANGS) {
      const s = new Intl.DateTimeFormat(lang, dayHeaderFormat(old, NOW)).format(old);
      // Every supported locale writes 2025 in Western digits under the
      // default numbering system, including ar (Modern Standard uses
      // Latin digits in most CLDR ar-* data).
      expect(/2025|٢٠٢٥/.test(s), `${lang} dropped the year: "${s}"`).toBe(true);
    }
  });

  it('stays inside a character budget that the measured box implies', () => {
    // A weak proxy for width, deliberately loose — it exists to catch a
    // format change that balloons the string (a long weekday coming back
    // takes pt-BR from 24 characters to 38), not to police a few px.
    const BUDGET = 27;
    for (const lang of LANGS) {
      for (const d of [NOW, new Date(2025, 10, 24)]) {
        const s = new Intl.DateTimeFormat(lang, dayHeaderFormat(d, NOW)).format(d);
        expect(s.length, `${lang} "${s}" is ${s.length} chars, over the ${BUDGET} budget`).toBeLessThanOrEqual(BUDGET);
      }
    }
  });
});

describe('the box constant', () => {
  it('records the width the formats were chosen against', () => {
    // If the header's layout changes — an arrow removed, the mood chip
    // moved — this number is stale and the formats deserve re-measuring.
    expect(HEADER_BOX_PX).toBe(233);
  });
});
