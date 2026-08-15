/**
 * i18n completeness check — runs only in development.
 *
 * Pass 1 — Missing keys:
 *   Logs every key present in English but absent from at least one other
 *   supported language. Missing English keys are the critical failure mode
 *   that causes raw keys to appear in the UI.
 *
 * Pass 2 — English-identical (untranslated) values:
 *   Flags keys where a non-English language carries the exact same byte
 *   sequence as the English value. This usually means someone copied the
 *   English string as a placeholder and forgot to translate it.
 *   Exceptions:
 *     • Keys in ALLOW_IDENTICAL — intentional proper nouns / codes /
 *       unit symbols, identical in every language.
 *     • Keys in ALLOW_IDENTICAL_BY_LANG[lang] — cognates, where that one
 *       language legitimately uses the English word ("Cardio" in
 *       Spanish). Scoped per language on purpose: the same value in a
 *       non-Latin script is never a cognate, so it must still warn.
 *     • Keys whose English value contains no letters (pure numbers,
 *       punctuation, template tokens, etc.).
 *     • English values that are, or contain only, the brand name "Flexyn"
 *       (brand names legitimately stay the same across languages).
 *
 * Import this file once in src/main.jsx (inside a DEV guard) to activate it.
 */
import { loadLanguage, ALL_LANGUAGES } from './i18n';

// ALL_LANGUAGES, not the offered list. Most locales are shelved rather than
// offered (see the note in i18n.js); auditing only the offered ones would mean
// this file checked English against itself while every shelved catalog drifted
// unobserved until someone tried to ship it again.

// Lazy-load all per-language aggregates and return them as a single
// `{ <code>: { key: value, ... } }` object — matches the shape the rest
// of this file expects. Only runs in DEV. Each aggregate is dynamic-
// imported via the i18n module's importer map, so production users
// never pay this cost.
async function loadAllLanguages() {
  const out = {};
  await Promise.all(
    ALL_LANGUAGES.map(async ({ code }) => {
      await loadLanguage(code);
      // After loadLanguage, the i18n module cached the data internally;
      // we need a way to read it. Use a fresh import of the aggregate
      // — it's deduplicated by the module system so this is free after
      // the loadLanguage call cached the module.
      try {
        const mod = await import(/* @vite-ignore */ `../locales/${code}.json`);
        out[code] = mod.default || mod;
      } catch (err) {
        console.warn(`[i18n-check] Could not load "${code}":`, err);
        out[code] = {};
      }
    })
  );
  return out;
}

/**
 * Keys that are intentionally identical across all languages.
 * Add here when the value is a proper noun, brand name, code, or symbol
 * that should not differ by language.
 */
const ALLOW_IDENTICAL = new Set([
  'app.name',       // "Flexyn" — brand name
  'levelBar.level', // "Lv {n}" — widely understood abbreviation
  // ── Units, codes and proper nouns ──────────────────────────────────
  // These are identical in EVERY language by design. They were flagged
  // in all 14 because `hasLetters` only skips values with no letters at
  // all, and "lbs" / "g" / "W" have letters while still being symbols.
  'nutrition.macros.grams', // "g"    — SI symbol
  'nutrition.water.ml',     // "ml"   — SI symbol
  'nutrition.water.oz',     // "oz"   — unit symbol
  'goals.lbs',              // "lbs"  — unit symbol
  'nutrition.macros.dv',    // "DV"   — Daily Value, standard nutrition label code
  'duels.resultWin',        // "W"    — scoreboard notation
  'duels.resultLoss',       // "L"    — scoreboard notation
  'duels.resultTie',        // "TIE"  — scoreboard notation
  'nav.hub',                // "Hub"  — the feature's name, not a common noun
]);

/**
 * Cognates: keys whose English value is legitimately the SAME WORD in a
 * particular language. "Cardio" really is "Cardio" in Spanish; "Notes"
 * really is "Notes" in French.
 *
 * Deliberately PER-LANGUAGE rather than folded into ALLOW_IDENTICAL
 * above. A flat key-level skip would also suppress the check for
 * Japanese, Korean, Chinese, Arabic, Hindi and Russian — where a
 * coincidental match is impossible, so an identical value there is
 * always a genuine untranslated string. Keeping these scoped means the
 * checker still catches `cardio.title` sitting in English in the
 * Japanese file, which is exactly the bug class it exists for.
 *
 * Adding an entry here is a claim that a native speaker would write the
 * English word. If you are not sure, leave it out and let it warn.
 */
const ALLOW_IDENTICAL_BY_LANG = {
  es: new Set([
    'cardio',
    'cardio.field.hours',
    'cardio.field.minutes',
    'cardio.title',
    'coach.title',
    'common.reps',
    'core',
    'discovery.formCoach.kicker',
    'formcoach.beta',
    'goals.reps',
    'hub.feed.pump',
    'hub.messages.tab.crews',
    'hub.share.cardio',
    'leaderboards.scope.global',
    'leaderboards.scope.regional',
    'leaderboards.top100',
    'muscleGroups.cardio',
    'muscleGroups.core',
    'notifications.row.capsule.label.premium',
    'workout.min',
    'workout.minutes',
    'workout.repsLabel',
    'workout.templates.reps',
  ]),
  fr: new Set([
    // Plans surface: 'Macros' and 'Plans' are the French words too.
    'weeklyMealPlannerModal.macros',
    'weeklyMealPlannerModal.title',
    'achievementDefs.cat.nutrition',
    'biceps',
    'bodyMetrics.dateRequired',
    'cardio',
    'cardio.field.date',
    'cardio.field.distance',
    'cardio.field.hours',
    'cardio.field.minutes',
    'cardio.field.notes',
    'cardio.field.seconds',
    'cardio.live.pause',
    'cardio.title',
    'cardio.voice.mile',
    'cardio.voice.miles',
    'cardio.voice.minutes',
    'cardio.weekly.calories',
    'cardio.weekly.distance',
    'coach.title',
    'dashboard.stats.volume',
    'formcoach.corrections',
    'gauntlet.type.nutrition',
    'generator.focus',
    'goals.notes',
    'goals.reps',
    'goals.sessions',
    'goals.type.cardio_distance',
    'goals.type.cardio_sessions',
    'header.nutrition',
    'hub.activity.volume',
    'hub.feed.pump',
    'hub.messages',
    'hub.messages.tab.crews',
    'hub.messages.tab.dms',
    'hub.privacy.public',
    'hub.profile.message',
    'hub.share.cardio',
    'leaderboards.top100',
    'levelBar.tier.bronze',
    'muscleGroups.biceps',
    'muscleGroups.cardio',
    'muscleGroups.obliques',
    'muscleGroups.triceps',
    'nav.nutrition',
    'notifications.row.capsule.label.premium',
    'notifications.row.capsule.label.standard',
    'notifications.title',
    'nutrition.date',
    'nutrition.macros.calories',
    'nutrition.macros.sodium',
    'nutrition.minerals.calcium',
    'nutrition.minerals.potassium',
    'nutrition.title',
    'obliques',
    'regimens.description',
    'regimens.notes',
    'settings.distanceUnit.mi',
    'triceps',
    'widgetDefs.cat.motivation',
    'workout.date',
    'workout.exerciseShort',
    'workout.exercisesShort',
    'workout.min',
    'workout.minutes',
    'workout.notes',
    'workout.repsLabel',
    'workout.templates.public',
  ]),
  de: new Set([
    'bodyMetrics.leftArm',
    'bodyMetrics.rightArm',
    'cardio',
    'cardio.live.pause',
    'cardio.title',
    'coach.title',
    'common.optional',
    'dashboard.title',
    'discovery.formCoach.kicker',
    'formcoach.beta',
    'hub.feed.pump',
    'hub.messages.tab.crews',
    'hub.share.cardio',
    'hub.share.status',
    'leaderboards.level',
    'leaderboards.scope.global',
    'leaderboards.scope.regional',
    'leaderboards.top100',
    'levelBar.tier.amethyst',
    'levelBar.tier.bronze',
    'levelBar.tier.gold',
    'levelUp.fromTo',
    'muscleGroups.cardio',
    'nav.dashboard',
    'notifications.row.capsule.label.elite',
    'notifications.row.capsule.label.premium',
    'notifications.row.capsule.label.standard',
    'nutrition.form.snack',
    'nutrition.minerals.magnesium',
    'nutrition.vitamins.a',
    'nutrition.vitamins.b12',
    'nutrition.vitamins.c',
    'nutrition.vitamins.d',
    'progress.filter',
    'widgetDefs.cat.motivation',
  ]),
  pt: new Set([
    // 'Macros' is the Portuguese word too.
    'weeklyMealPlannerModal.macros',
    'cardio',
    'cardio.field.hours',
    'cardio.field.minutes',
    'cardio.title',
    'coach.title',
    'common.reps',
    'core',
    'dashboard.stats.volume',
    'discovery.formCoach.kicker',
    'formcoach.beta',
    'goals.reps',
    'hub.activity.volume',
    'hub.feed.pump',
    'hub.messages.tab.crews',
    'hub.share.cardio',
    'hub.share.status',
    'leaderboards.scope.global',
    'leaderboards.scope.regional',
    'leaderboards.top100',
    'levelBar.tier.bronze',
    'muscleGroups.cardio',
    'muscleGroups.core',
    'notifications.row.capsule.label.elite',
    'notifications.row.capsule.label.premium',
    'workout.exerciseShort',
    'workout.exercisesShort',
    'workout.min',
    'workout.minutes',
    'workout.repsLabel',
    'workout.templates.reps',
  ]),
  it: new Set([
    // "{n} cal in {label}" is valid Italian unchanged — 'in' is the same word.
    'weeklyMealPlannerModal.calInSlot',
    'cardio',
    'cardio.field.hours',
    'cardio.field.minutes',
    'cardio.field.seconds',
    'cardio.title',
    'coach.title',
    'core',
    'dashboard.stats.volume',
    'dashboard.title',
    'discovery.formCoach.kicker',
    'formcoach.beta',
    'formcoach.title',
    'generator.focus',
    'hub.activity.volume',
    'hub.share.cardio',
    'leaderboards.top100',
    'muscleGroups.cardio',
    'muscleGroups.core',
    'nav.dashboard',
    'notifications.row.capsule.label.elite',
    'notifications.row.capsule.label.premium',
    'notifications.row.capsule.label.standard',
    'workout.min',
    'workout.minutes',
  ]),
  tr: new Set([
    'common.feet',
    'formcoach.beta',
    'hub.feed.pump',
    'notifications.row.capsule.label.premium',
    'nutrition.macros.protein',
    'progress.setLabel',
    'workout.set',
    'workout.setSingular',
  ]),
  pl: new Set([
    'biceps',
    'cardio',
    'cardio.field.minutes',
    'cardio.live.start',
    'cardio.title',
    'formcoach.beta',
    'hub.share.cardio',
    'hub.share.status',
    'leaderboards.top100',
    'muscleGroups.biceps',
    'muscleGroups.cardio',
    'muscleGroups.triceps',
    'notifications.row.capsule.label.premium',
    'nutrition.macros.cholesterol',
    'triceps',
    'workout.min',
    'workout.minutes',
  ]),
  nl: new Set([
    // "{n} cal in {label}" is valid Dutch unchanged — 'in' is the same word.
    'weeklyMealPlannerModal.calInSlot',
    'biceps',
    'cardio',
    'cardio.field.minutes',
    'cardio.field.seconds',
    'cardio.title',
    'cardio.voice.kilometer',
    'cardio.voice.perKilometer',
    'coach.title',
    'common.sets',
    'core',
    'dashboard.claim',
    'dashboard.stats.volume',
    'dashboard.stats.workoutPlural',
    'dashboard.stats.workoutSingular',
    'dashboard.title',
    'discovery.openCapsule.dismissLabel',
    'formcoach.tips',
    'generator.focus',
    'hamstrings',
    'hub.activity.sets',
    'hub.activity.volume',
    'hub.messages.tab.crews',
    'hub.share.cardio',
    'hub.share.status',
    'leaderboards.top100',
    'levelUp.fromTo',
    'levelUp.title',
    'muscleGroups.biceps',
    'muscleGroups.cardio',
    'muscleGroups.core',
    'muscleGroups.hamstrings',
    'muscleGroups.triceps',
    'nav.dashboard',
    'notifications.row.capsule.label.elite',
    'notifications.row.capsule.label.premium',
    'nutrition.form.lunch',
    'nutrition.form.snack',
    'nutrition.macros.cholesterol',
    'progress.setLabel',
    'settings.distanceUnit.km',
    'shop.eliteCapsule.name',
    'shop.premiumCapsule.name',
    'shop.streakFreeze.name',
    'triceps',
    'workout.min',
    'workout.minutes',
    'workout.seconds',
    'workout.set',
    'workout.setSingular',
    'workout.templates.sets',
  ]),
};

/** Returns true if the string contains at least one Unicode letter. */
function hasLetters(str) {
  return /\p{L}/u.test(str);
}

/** Returns true if the value is (or is exclusively) the brand name "Flexyn". */
function isBrandNameOnly(str) {
  return /^\s*Flexyn\s*$/i.test(str);
}

/**
 * Returns true if this English value should be silently skipped when
 * checking for English-identical translations.
 */
function shouldSkipIdenticalCheck(key, enValue, lang) {
  if (ALLOW_IDENTICAL.has(key)) return true;
  if (lang && ALLOW_IDENTICAL_BY_LANG[lang]?.has(key)) return true;
  if (!hasLetters(enValue)) return true;    // pure numbers / punctuation / tokens
  if (isBrandNameOnly(enValue)) return true; // brand name only
  return false;
}

export async function checkI18nCompleteness() {
  if (!import.meta.env.DEV) return;

  const translations = await loadAllLanguages();
  const enDict = translations['en'] || {};
  const enKeys = new Set(Object.keys(enDict));

  // ── Pass 1: missing keys ──────────────────────────────────────────────────
  const missingIssues = [];
  for (const { code } of ALL_LANGUAGES) {
    if (code === 'en') continue;
    const langKeys = new Set(Object.keys(translations[code] || {}));
    for (const key of enKeys) {
      if (!langKeys.has(key)) {
        missingIssues.push(`[i18n-check] Missing in "${code}": '${key}'`);
      }
    }
  }

  if (missingIssues.length > 0) {
    console.group('[i18n-check] Translation gaps found:');
    missingIssues.forEach(i => console.warn(i));
    console.groupEnd();
  } else {
    console.info('[i18n-check] ✅ All languages complete (no missing keys).');
  }

  // ── Pass 2: English-identical (untranslated) values ───────────────────────
  const identicalIssues = [];
  for (const { code } of ALL_LANGUAGES) {
    if (code === 'en') continue;
    const langDict = translations[code] || {};
    for (const key of enKeys) {
      const enValue = enDict[key];
      if (shouldSkipIdenticalCheck(key, enValue, code)) continue;
      if (langDict[key] === enValue) {
        identicalIssues.push(`[i18n-check] Untranslated in "${code}": '${key}' = "${enValue}"`);
      }
    }
  }

  if (identicalIssues.length > 0) {
    console.group('[i18n-check] Untranslated (English-identical) values:');
    identicalIssues.forEach(i => console.warn(i));
    console.groupEnd();
  } else {
    console.info('[i18n-check] ✅ No English-identical values in other languages.');
  }
}