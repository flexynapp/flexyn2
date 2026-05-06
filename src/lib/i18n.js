/**
 * ============================================================
 * INTERNATIONALIZATION RULES — READ BEFORE ADDING UI STRINGS
 * ============================================================
 * ALL user-facing strings MUST go through t('key.path').
 * NEVER hardcode display text directly in JSX.
 *
 * ⚠️  Adding the English value verbatim to all 14 other language blocks is NOT
 *    a translation. The strengthened i18n-check will warn on English-identical
 *    values in non-English languages. Either translate properly, or — if the
 *    value is intentionally identical (a brand name, a widely-known code,
 *    etc.) — add the key to ALLOW_IDENTICAL in i18n-check.js.
 *
 * ⚠️  CRITICAL RULE: When you add a new t('key') call anywhere in the app,
 *    you MUST add that key to the English ('en') block in one of the i18n
 *    part files IMMEDIATELY. Without an English entry, the key will display
 *    as raw text for ALL users regardless of their language setting, because
 *    English is the fallback. Other languages can be added later with TODO
 *    comments, but English is non-negotiable.
 *
 * When adding a new string:
 *  1. Choose a dot-namespaced key (e.g. 'settings.newOption').
 *  2. Add it to the English ('en') block first — this is mandatory.
 *  3. Add it to ALL 15 language files (i18n-part*.js) under the SAME key.
 *  4. If you only know the English text, add the English value and add
 *     TODO comments for the other 14 languages — they will fall back to
 *     English at runtime (via getTranslation) but will warn in dev console.
 *
 * A lint check (i18n-check.js) runs in dev mode and logs any missing keys
 * in non-English languages. Run the dev server to see warnings.
 *
 * Supported languages: en, es, fr, de, pt, it, ja, ko, zh,
 *                      ar, hi, ru, tr, pl, nl
 * ============================================================
 */
import { translations_p1 } from './i18n-part1';
import { translations_p2 } from './i18n-part2';
import { translations_p3 } from './i18n-part3';
import { translations_p4 } from './i18n-part4';
import { translations_p5 } from './i18n-part5';
import { translations_p6 } from './i18n-part6';
import { translations_p7 } from './i18n-part7';
import { translations_p8 } from './i18n-part8';
import { goalsI18n } from './i18n-goals';
import { translations_p9 } from './i18n-part9';
import { translations_p10 } from './i18n-part10';
import { dashboardRedesignI18n } from './i18n-dashboard-redesign';
import { pageHeaderI18n } from './i18n-pageheader';
import { restTimerI18n } from './i18n-rest-timer';
import { warnI18n } from './i18n-warn';
import { nutritionOnboardingI18n } from './i18n-nutrition-onboarding';
import { savedWorkoutsI18n } from './i18n-saved-workouts';
import { leaderboardsI18n } from './i18n-leaderboards';
import { hubI18n } from './i18n-hub';
import { hubCommentsI18n } from './i18n-hub-comments';
import { onboardingStepsI18n } from './i18n-onboarding-steps';
import { onboardingSlideshowI18n } from './i18n-onboarding-slideshow';
import { gamificationI18n } from './i18n-gamification';
import { formCoachI18n } from './i18n-formcoach';
import { translationI18n } from './i18n-translation';
import { leaguesI18n } from './i18n-leagues';
import { notificationsI18n } from './i18n-notifications';

// Deep-merge all translation parts per language
const mergeTranslations = (...parts) => {
  const result = {};
  for (const part of parts) {
    for (const [lang, keys] of Object.entries(part)) {
      result[lang] = { ...(result[lang] || {}), ...keys };
    }
  }
  return result;
};

export const translations = mergeTranslations(translations_p1, translations_p2, translations_p3, translations_p4, translations_p5, translations_p6, translations_p7, translations_p8, goalsI18n, translations_p9, translations_p10, dashboardRedesignI18n, pageHeaderI18n, restTimerI18n, warnI18n, nutritionOnboardingI18n, savedWorkoutsI18n, leaderboardsI18n, hubI18n, hubCommentsI18n, onboardingStepsI18n, onboardingSlideshowI18n, gamificationI18n, formCoachI18n, translationI18n, leaguesI18n, notificationsI18n);

export function getTranslation(lang, key) {
  const langVal = translations[lang]?.[key];
  if (langVal != null) return langVal;
  const enVal = translations['en']?.[key];
  if (import.meta.env.DEV && lang !== 'en' && enVal != null) {
    console.warn(`[i18n] Missing translation — lang: "${lang}", key: "${key}"`);
  }
  return enVal ?? key;
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English',    nativeLabel: 'English',    flag: '🇺🇸' },
  { code: 'es', label: 'Spanish',    nativeLabel: 'Español',    flag: '🇪🇸' },
  { code: 'fr', label: 'French',     nativeLabel: 'Français',   flag: '🇫🇷' },
  { code: 'de', label: 'German',     nativeLabel: 'Deutsch',    flag: '🇩🇪' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português',  flag: '🇧🇷' },
  { code: 'it', label: 'Italian',    nativeLabel: 'Italiano',   flag: '🇮🇹' },
  { code: 'ja', label: 'Japanese',   nativeLabel: '日本語',       flag: '🇯🇵' },
  { code: 'ko', label: 'Korean',     nativeLabel: '한국어',        flag: '🇰🇷' },
  { code: 'zh', label: 'Chinese',    nativeLabel: '中文',         flag: '🇨🇳' },
  { code: 'ar', label: 'Arabic',     nativeLabel: 'العربية',     flag: '🇸🇦' },
  { code: 'hi', label: 'Hindi',      nativeLabel: 'हिन्दी',         flag: '🇮🇳' },
  { code: 'ru', label: 'Russian',    nativeLabel: 'Русский',    flag: '🇷🇺' },
  { code: 'tr', label: 'Turkish',    nativeLabel: 'Türkçe',     flag: '🇹🇷' },
  { code: 'pl', label: 'Polish',     nativeLabel: 'Polski',     flag: '🇵🇱' },
  { code: 'nl', label: 'Dutch',      nativeLabel: 'Nederlands', flag: '🇳🇱' },
];