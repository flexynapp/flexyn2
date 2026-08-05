// date-fns locale objects, keyed by the app's own language codes.
//
// This map must stay in lockstep with the 15 languages in LanguageContext:
//
//   en es fr de pt it ja ko zh ar hi ru tr pl nl
//
// It didn't. Four languages we ship (ko, ar, hi, tr) had no entry and fell
// through to enUS, so a Korean user reading a fully translated screen still
// got "Monday", "August" and "3 days ago" in English wherever a date-fns
// `format` / `formatDistance` ran — the calendar grids, PR history, progress
// photos, the resume banner. Meanwhile four locales were imported for
// languages the app has never offered (sv, da, nb, fi), which shipped their
// weight in the bundle to serve nobody.
//
// Arabic gets `ar` (Modern Standard) rather than a country variant: the app
// has one Arabic locale, and MSA is the right register for UI chrome.
//
// If you add a language to LanguageContext, add it here in the same commit.
// A missing entry is invisible — `?? enUS` is a silent, plausible-looking
// fallback, which is exactly why this drifted for as long as it did.
import {
  enUS, es, fr, de, pt, it, ja, ko, zhCN, ar, hi, ru, tr, pl, nl,
} from 'date-fns/locale';

const DATE_LOCALES = {
  en: enUS,
  es,
  fr,
  de,
  pt,
  it,
  ja,
  ko,
  zh: zhCN,
  ar,
  hi,
  ru,
  tr,
  pl,
  nl,
};

export function getDateLocale(lang) {
  return DATE_LOCALES[lang] ?? enUS;
}
