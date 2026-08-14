// A `useLanguage` mock that resolves against the REAL English catalog.
//
// The pattern this replaces is `t: (k) => k`, which returns the key path. It
// looks harmless and is not: a component rendering t('nutrition.noMeals')
// puts the literal string "nutrition.noMeals" on screen, so any assertion
// about copy has to be written against the key. That inverts the test —
// it then passes only while the string stays HARDCODED in JSX, and fails the
// moment someone extracts it correctly. mealHistorySheet had exactly that:
// a case named 'a water-only day says "No meals logged"' which broke when
// "No meals logged" became a key.
//
// Resolving en.json instead means the assertions read like the screen, and a
// key that does not exist fails here rather than rendering its own path.
//
// Usage — the factory must be self-contained, because vi.mock is hoisted
// above imports:
//
//   vi.mock('@/lib/LanguageContext', async () => {
//     const { languageMock } = await import('@/lib/__tests__/i18nMock');
//     return languageMock();
//   });
//
// Pass overrides for anything else the component reads:
//
//   return languageMock({ language: 'es', setLanguage: () => {} });
//
// NOT for tests that assert WHICH KEY was requested. Those deliberately
// instrument t/tFallback (see prHistoryModalI18n, muscleGroupHeatmapI18n,
// tapToCopy) and must keep their own spies.
import en from '@/locales/en.json';

/** Replace {placeholders} the same way LanguageContext's `t` does. */
function fill(str, vars) {
  if (!vars || typeof str !== 'string') return str;
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
    str,
  );
}

/**
 * @param {object} [extra] merged over the defaults — `language`, `setLanguage`,
 *   `SUPPORTED_LANGUAGES`, or a narrower `t` when a test needs one.
 * @returns the module shape `vi.mock('@/lib/LanguageContext', …)` expects.
 */
export function languageMock(extra = {}) {
  const value = {
    language: 'en',
    t: (key, vars) => fill(en[key] ?? key, vars),
    tFallback: (key, english, vars) => fill(en[key] ?? english, vars),
    currentLanguage: { code: 'en', label: 'English', nativeLabel: 'English', flag: '🇺🇸' },
    setLanguage: () => {},
    ...extra,
  };
  return { useLanguage: () => value, LanguageContext: { Provider: ({ children }) => children } };
}
