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
  'settings.weightUnit.kg',    // "kg"  — SI symbol
  'settings.weightUnit.lbs',   // "lbs" — unit symbol
  'settings.weightUnit.stone', // "st"  — unit symbol (stone)
  'nutrition.photoAi',         // "Photo-AI" — the feature's name, same shape as nav.hub
  // ── The trophy catalog, added 2026-08-16 ──────────────────────────
  // Product nouns from `_glossary.json` doNotTranslate, plus two unit
  // symbols and one string that is nothing but placeholders.
  'trophy.category.crew',   // "Crew"      — doNotTranslate
  'trophy.ladder.crew',     // "Crew"      — doNotTranslate
  'trophy.ladder.social',   // "Hub"       — doNotTranslate, same as nav.hub
  'trophy.ladder.level',    // "Level"     — doNotTranslate, the user's Level stat
  'trophy.ladder.capsule',  // "Capsules"  — doNotTranslate
  'trophy.ladder.gauntlet', // "Gauntlet"  — the feature's name
  'trophy.unit.lb',         // "lb"        — unit symbol
  'trophy.unit.m',          // "m"         — SI symbol
  'trophy.tail.desc',       // "{n} {unit}" — placeholders and a space
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
    // Trophy catalog, added 2026-08-16. Every one is a word this
    // language spells exactly as English does — Arena, Prestige,
    // Champion, Legend, Tonnage — not a string left untranslated.
    'trophy.category.duel',
    // Added 2026-08-16 with the settings/workout/nutrition batch. Each is a
    // loanword or a kept product noun in this language, not a skipped string.
    'generator.tab.chat',
    'hub.feed.crews',
    'workout.addCardio',
    'workout.tab.cardio',
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
    // Trophy catalog, added 2026-08-16. Every one is a word this
    // language spells exactly as English does — Arena, Prestige,
    // Champion, Legend, Tonnage — not a string left untranslated.
    'trophy.category.cardio',
    'trophy.category.collection',
    'trophy.category.level',
    'trophy.ladder.duel',
    'trophy.ladder.journal',
    'trophy.ladder.prestige',
    'trophy.ladder.tonnage',
    'trophy.season.champion.name',
    'trophy.seasonTier.bronze',
    'trophy.seasonTier.champion',
    'trophy.tier.bronze',
    'trophy.unit.duels',
    'trophy.unit.types',
    // Added 2026-08-16 with the settings/workout/nutrition batch. Each is a
    // loanword or a kept product noun in this language, not a skipped string.
    'duels.title',
    'generator.style',
    'generator.tab.chat',
    'generator.type',
    'hub.feed.crews',
    'workout.addCardio',
    'workout.tab.cardio',
    'workout.tagsLabel',
    'Macros',
    'Plans',
    // Hub poll / story-note copy, added 2026-08-16. French spells all four
    // exactly as English does — option, vote, votes, note — so the catalog
    // value is identical on purpose, not a string somebody skipped.
    'hub.poll.option',
    'hub.poll.voteSingular',
    'hub.poll.votePlural',
    'hub.profile.addNote',
    'stories.note',
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
    'weeklyMealPlannerModal.macros',
    'weeklyMealPlannerModal.title',
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
  // German. Populated 2026-08-16 while the locale went 67% -> 99.4%: a
  // translation push SURFACES cognates rather than removing them, so the
  // English-echo count rose as coverage improved.
  //
  // A FIRST PASS WITHHELD 20 OF THESE on the reasoning that German has an
  // ordinary native word for each. THAT WAS WRONG, and it would have undone
  // work landed the same day. Two things the repo had already decided:
  //
  //   * _glossary.json doNotTranslate keeps Reps and Capsule in English in
  //     EVERY locale, and the 2026-08-16 term pass had just reverted German
  //     renderings of exactly those (Reps -> Wiederholungen, Capsule ->
  //     Kapsel). Ten keys below are that policy, not a gap.
  //   * _glossary.json de keeps Session and Rival in English, and the
  //     catalog already says "Themes" (Theme-Drop, Level-Themes) and
  //     "Challenge" (Challenge loeschen, Team-Challenge) throughout.
  //
  // Check the glossary AND how the catalog already renders a word before
  // calling an English value a gap. Only three of the twenty were real, and
  // they are absent here because they are now translated: duels.resultWin /
  // Loss / Tie were W / L / TIE and are S / N / U, the standard German table
  // triple and the abbreviations of words this catalog already uses
  // (duels.wins "Siege", duels.losses "Niederlagen").
  de: new Set([
    // Trophy catalog, added 2026-08-16. Every one is a word this
    // language spells exactly as English does — Arena, Prestige,
    // Champion, Legend, Tonnage — not a string left untranslated.
    'trophy.category.duel',
    'trophy.category.social',
    'trophy.ladder.journal',
    'trophy.ladder.prestige',
    'trophy.ladder.quests',
    'trophy.ladder.tonnage',
    'trophy.season.champion.name',
    'trophy.seasonTier.bronze',
    'trophy.seasonTier.champion',
    'trophy.seasonTier.gold',
    'trophy.seasonTier.legend',
    'trophy.tier.bronze',
    'trophy.tier.gold',
    // Added 2026-08-16 with the settings/workout/nutrition batch. Each is a
    // loanword or a kept product noun in this language, not a skipped string.
    'duels.challenge',
    'generator.tab.chat',
    'hub.feed.crews',
    'profile.corporate',
    'workout.addCardio',
    'workout.tab.cardio',
    'workout.tab.gym',
    'workout.tagsLabel',
    // German spells it 'Option' exactly as English does.
    'hub.poll.option',
    'aboutSection.twemoji',
    'analyticsSheet.hours',
    'analyticsSheet.hoursMinutes',
    'analyticsSheet.timesX',
    'app.corporateWellness',
    'app.creatorStudio',
    'app.name',
    'bodyMap.a11y.muscleVolume',
    'bodyMap.data.live',
    'bodyMetrics.leftArm',
    'bodyMetrics.rightArm',
    'bountyBoard.board',
    'buyConfirmDialog.flexCoins',
    'cardio',
    'cardio.live.pause',
    'cardio.pr.badge',
    'cardio.start.cta.empty',
    'cardio.start.cta.live',
    'cardio.start.kickerShort',
    'cardio.title',
    'cardioDetailModal.route',
    'coach.feel.ok.label',
    'coach.reply.goals.row',
    'coach.reply.goals.targetWeight',
    'coach.reply.prs.row',
    'coach.reply.weak.row',
    'coach.title',
    'common.optional',
    'common.optionalParen',
    'copy.noun.pr',
    'crewMessageItem.admin',
    'crewMessageItem.xpFuel',
    'crewWarPanel.crewWar',
    'dashboard.title',
    'discovery.formCoach.kicker',
    'exerciseLogger.tempo',
    'formcoach.beta',
    'friendLeaderboard.mode.weekly_sessions',
    'friendLeaderboard.mode.weekly_xp',
    'gauntletStatsModal.flexynGauntlet',
    'gifPicker.gifs',
    'goals.lbs',
    'gymEdit.logo',
    'gymEdit.website',
    'gymHub.detailsOptional',
    'gymJoinSheet.orange',
    'gymRivalMenu.capsules',
    'gymRivalMenu.levelN',
    'gymRivalMenu.rival',
    'gymSignageCard.flexynGym',
    'heavyBirdModal.gainzBird',
    'hub.feed.pump',
    'hub.messages.tab.crews',
    'hub.profile.themes',
    'hub.share.cardio',
    'hub.share.status',
    'hub.themes.lockedAt',
    'hub.themes.title',
    'hubCommentsInline.admin',
    'hubPostCard.admin',
    'hubProfile.admin',
    'leaderboardPodium.top3',
    'leaderboards.level',
    'leaderboards.scope.global',
    'leaderboards.scope.regional',
    'leaderboards.short.level',
    'leaderboards.top100',
    'league.ceremony.capsule',
    'league.ceremony.capsuleQty',
    'league.ceremony.champion',
    'legal.anthropic',
    'legal.netlify',
    'legal.openstreetmap',
    'legal.sentry',
    'legal.supabase',
    'levelBar.level',
    'levelBar.tier.amethyst',
    'levelBar.tier.bronze',
    'levelBar.tier.gold',
    'levelUp.fromTo',
    'mood.label.3',
    'muscleGroups.cardio',
    'myGym.abcd2345',
    'nav.dashboard',
    'nav.hub',
    'notifications.row.capsule.label.elite',
    'notifications.row.capsule.label.premium',
    'notifications.row.capsule.label.standard',
    'nutrition.foodDb.request.barcode',
    'nutrition.form.snack',
    'nutrition.macros.grams',
    'nutrition.minerals.magnesium',
    'nutrition.vitamins.a',
    'nutrition.vitamins.b12',
    'nutrition.vitamins.c',
    'nutrition.vitamins.d',
    'nutrition.water.ml',
    'nutrition.water.oz',
    'onboarding.feature.log.eyebrow',
    'onboarding.height.unitImperial',
    'onboarding.height.unitMetric',
    'onboarding.schedule.intensity.hardcore',
    'onboarding.sharpen.event.marathon',
    'photoMealResultModal.photoAi',
    'progress.filter',
    'progress.frame.cardio',
    'progress.frame.deltaPctDown',
    'progress.frame.deltaPctUp',
    'progress.frameShort.month',
    'progress.review.pr',
    'progress.review.sessions',
    'progress.slide.level.kicker',
    'progress.stat.level',
    'progress.stat.levelValue',
    'progress.tab.trends',
    'referralSheet.abc123',
    'regimenForm.superset',
    'regions.pull',
    'regions.push',
    'routeMap.maptiler',
    'routineTodayCard.challenge',
    'setRow.110Optional',
    'settings.group.feedback',
    'settings.group.stories',
    'settings.section.training',
    'shareSheetModal.whatsapp',
    'shop.eliteCapsule.name',
    'shop.premiumCapsule.name',
    'shop.standardCapsule.name',
    'snakeGameModal.ironSnake',
    'storyPreviewSheet.emoji',
    'sweatJetpackModal.splat',
    'sweatJetpackModal.sweatJetpack',
    'templatesModal.community',
    'themeSelector.lootCapsules',
    'todayRail.capsules',
    'trainerStudio.live',
    'trends.metric.reps',
    'trends.summary',
    'weeklyDebriefCard.balance',
    'weeklyDebriefCard.progression',
    'widgetDefs.cat.motivation',
    'workout.crewWars',
    'workout.gauntlet',
    'workout.repsLabel',
    'workout.templates.reps',
  ]),
  pt: new Set([
    // Trophy catalog, added 2026-08-16. Every one is a word this
    // language spells exactly as English does — Arena, Prestige,
    // Champion, Legend, Tonnage — not a string left untranslated.
    'trophy.category.duel',
    'trophy.ladder.market',
    'trophy.seasonTier.bronze',
    'trophy.tier.bronze',
    // Added 2026-08-16 with the settings/workout/nutrition batch. Each is a
    // loanword or a kept product noun in this language, not a skipped string.
    'generator.tab.chat',
    'hub.feed.crews',
    'hub.market.title',
    'workout.addCardio',
    'workout.tab.cardio',
    'workout.tagsLabel',
    'Macros',
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
    'weeklyMealPlannerModal.macros',
    'workout.exerciseShort',
    'workout.exercisesShort',
    'workout.min',
    'workout.minutes',
    'workout.repsLabel',
    'workout.templates.reps',
  ]),
  it: new Set([
    // Trophy catalog, added 2026-08-16. Every one is a word this
    // language spells exactly as English does — Arena, Prestige,
    // Champion, Legend, Tonnage — not a string left untranslated.
    'trophy.category.duel',
    'trophy.category.social',
    'trophy.ladder.prestige',
    'trophy.season.champion.name',
    'trophy.seasonTier.champion',
    'trophy.seasonTier.legend',
    'trophy.unit.wars',
    // Added 2026-08-16 with the settings/workout/nutrition batch. Each is a
    // loanword or a kept product noun in this language, not a skipped string.
    'duels.challenge',
    'generator.tab.chat',
    'profile.corporate',
    'workout.addCardio',
    'workout.tab.cardio',
    // Italian uses all three as English loanwords — 'follower' is already
    // the glossary rendering of Followers, and post/slot are the ordinary
    // Italian words for these things.
    'hub.profile.follower',
    'hub.profile.post',
    'hub.profile.slot',
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
    'in',
    'leaderboards.top100',
    'muscleGroups.cardio',
    'muscleGroups.core',
    'nav.dashboard',
    'notifications.row.capsule.label.elite',
    'notifications.row.capsule.label.premium',
    'notifications.row.capsule.label.standard',
    'weeklyMealPlannerModal.calInSlot',
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
    // Trophy catalog, added 2026-08-16. Every one is a word this
    // language spells exactly as English does — Arena, Prestige,
    // Champion, Legend, Tonnage — not a string left untranslated.
    'trophy.category.duel',
    'trophy.ladder.prestige',
    'trophy.season.champion.name',
    'trophy.seasonTier.champion',
    'trophy.seasonTier.legend',
    // Added 2026-08-16 with the settings/workout/nutrition batch. Each is a
    // loanword or a kept product noun in this language, not a skipped string.
    'profile.corporate',
    'workout.addCardio',
    'workout.tab.cardio',
    // Polish borrows 'post' for a social post.
    'hub.profile.post',
    'aboutSection.twemoji',
    'analyticsSheet.minutes',
    'analyticsSheet.timesX',
    'app.corporateWellness',
    'app.creatorStudio',
    'app.name',
    'biceps',
    'bodyMap.a11y.muscleVolume',
    'bodyMap.rangeShort.30d',
    'bodyMap.rangeShort.7d',
    'bodyMap.rangeShort.90d',
    'buyConfirmDialog.flexCoins',
    'capsuleOpener.themeDrop',
    'cardio',
    'cardio.field.minutes',
    'cardio.live.start',
    'cardio.title',
    'coach.feel.ok.label',
    'coach.title',
    'common.reps',
    'formcoach.beta',
    'goals.lbs',
    'goals.reps',
    'hub.share.cardio',
    'hub.share.status',
    'journal.ctx.minutes',
    'leaderboards.top100',
    'muscleGroups.biceps',
    'muscleGroups.cardio',
    'muscleGroups.triceps',
    'nav.hub',
    'notifications.row.capsule.label.premium',
    'nutrition.macros.cholesterol',
    'nutrition.macros.dv',
    'nutrition.macros.grams',
    'nutrition.water.ml',
    'nutrition.water.oz',
    'shop.eliteCapsule.name',
    'shop.premiumCapsule.name',
    'shop.standardCapsule.name',
    'triceps',
    'workout.min',
    'workout.minutes',
    'workout.repsLabel',
    'workout.templates.reps',
  ]),
  nl: new Set([
    // Trophy catalog, added 2026-08-16. Every one is a word this
    // language spells exactly as English does — Arena, Prestige,
    // Champion, Legend, Tonnage — not a string left untranslated.
    'trophy.category.duel',
    'trophy.category.social',
    'trophy.ladder.duel',
    'trophy.ladder.prestige',
    'trophy.ladder.tonnage',
    'trophy.season.champion.name',
    'trophy.seasonTier.champion',
    'trophy.seasonTier.legend',
    'trophy.unit.duels',
    'trophy.unit.items',
    'trophy.unit.posts',
    'trophy.unit.wars',
    // Added 2026-08-16 with the settings/workout/nutrition batch. Each is a
    // loanword or a kept product noun in this language, not a skipped string.
    'duels.challenge',
    'duels.title',
    'generator.tab.chat',
    'generator.type',
    'hub.feed.crews',
    'profile.corporate',
    'workout.addCardio',
    'workout.tab.cardio',
    'workout.tagsLabel',
    // Dutch says Inbox.
    'hub.messages.view.inbox',
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
    'in',
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
    'weeklyMealPlannerModal.calInSlot',
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