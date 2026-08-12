export const cardioI18n = {
  en: {
    'cardio.pr.title': '🏆 New {label} PR!',
    'cardio.pr.badge': '{label} PR',
    'cardio.weather.feelsLike': 'feels like',
    // These two shipped with tr/pl/nl translations but no English
    // original and no call site. Completing the key rather than
    // deleting three real translations — resolution is
    // language -> en -> key, so an English original is what stops a
    // future t() call showing English users the raw path.
    'cardio.weather.checking': 'Checking conditions…',
    'cardio.weather.outside': 'Outside conditions',
    'cardio.live.autoPaused': 'Auto-paused',
    'cardio.live.autoResumed': 'Resumed',

    // TODO(i18n): English-only, pending a native-speaker pass — do NOT
    // machine-translate. Hardcoded in the JSX until the Aug 2026 audit:
    // swimming and the utility tiles were added after running/walking/
    // biking (keys in i18n-part8.js) and never got keys, so a non-English
    // user saw three translated tiles and one English one in the same 2x2
    // grid. Extracting them does not translate them — it makes them
    // translatable, and puts them in front of the audit as a real gap
    // instead of hiding them in JSX where no coverage tool can see them.
    'cardio.modes.swimming': 'Swimming',

    // The two missing halves of the cardio.type.* set. The other six live
    // in i18n-part8.js and are translated in all 15 languages; swimming
    // was added to the picker without either of these, and because
    // getTranslation returns the KEY on a total miss, a pool swim
    // rendered the literal "cardio.type.swimming_pool" in the manual
    // form's heading, the detail modal's title, the Repeat-last row and
    // three Hub surfaces — one of which is a post other people see.
    //
    // Worded to match the six that exist: environment first, activity
    // noun second, sentence case. "Outdoor run", "Treadmill walk",
    // "Stationary bike" — so "Pool swim" and "Open water swim".
    //
    // English-only like the rest of this block, which is also how the
    // word "Swimming" itself ships: cardio.modes.swimming has no
    // translation either, so these two are consistent with the activity
    // they belong to rather than an island. Whoever does the native pass
    // should take the whole swimming set in one go.
    'cardio.type.swimming_pool': 'Pool swim',
    'cardio.type.swimming_openwater': 'Open water swim',

    // Start Session — the hero and the picker sheet that replaced the 2x2
    // activity grid and the mode → environment → input-type chain
    // (kegan, 2026-08-11). English-only like the rest of this block.
    //
    // The "Where" pills reuse the EXISTING translated env keys —
    // cardio.env.outside / .treadmill / .stationary are in i18n-part8.js in
    // all 15 languages — so only swim's pair is untranslated, which is the
    // state the whole swimming set is already in. Picking per-activity
    // words over one universal Outside/Inside pair is what made that reuse
    // possible; the universal pair would have needed two new keys and lost
    // "Stationary" and "Open water", the words cyclists and swimmers use.
    'cardio.start.kicker': 'START A SESSION',
    'cardio.start.kickerShort': 'Start',
    'cardio.start.hero': 'Start Session',
    'cardio.start.heroSub': 'Running, Walking, Biking, or Swimming',
    'cardio.start.activity': 'Activity',
    'cardio.start.where': 'Where',
    'cardio.start.how': 'How',
    'cardio.start.cta.live': 'Start',
    'cardio.start.cta.manual': 'Log',
    'cardio.start.cta.empty': 'Start',
    'cardio.start.noLiveSwim': 'Live tracking needs GPS or a treadmill readout, so swims are logged by hand.',

    'cardio.swim.whereQuestion': 'Where are you swimming?',
    'cardio.swim.pool': 'Pool',
    'cardio.swim.pool.desc': 'Lap pool, 25 m or 50 m',
    'cardio.swim.openWater': 'Open Water',
    'cardio.swim.openWater.desc': 'Lake, ocean, river',
    'cardio.nav.templates': 'Templates',
    'cardio.nav.templates.desc': 'Quick-start saved configurations',
    'cardio.nav.planned': 'Planned Sessions',
    'cardio.nav.planned.desc': 'Schedule upcoming workouts',
    'cardio.detail.laps': 'Laps',
    'cardio.detail.stroke': 'Stroke',
    'cardio.planned.notesPlaceholder': 'Notes… (optional)',
  },
  es: {
    'cardio.pr.title': '🏆 ¡Nuevo récord de {label}!',
    'cardio.pr.badge': 'Récord {label}',
    'cardio.weather.feelsLike': 'sensación térmica',
    'cardio.live.autoPaused': 'Pausa automática',
    'cardio.live.autoResumed': 'Reanudado',
  },
  fr: {
    'cardio.pr.title': '🏆 Nouveau record {label} !',
    'cardio.pr.badge': 'Record {label}',
    'cardio.weather.feelsLike': 'ressenti',
    'cardio.live.autoPaused': 'Pause automatique',
    'cardio.live.autoResumed': 'Repris',
  },
  de: {
    'cardio.pr.title': '🏆 Neuer {label}-Rekord!',
    'cardio.pr.badge': '{label} Rekord',
    'cardio.weather.feelsLike': 'gefühlt',
  },
  pt: {
    'cardio.pr.title': '🏆 Novo recorde de {label}!',
    'cardio.pr.badge': 'Recorde {label}',
    'cardio.weather.feelsLike': 'sensação',
    'cardio.live.autoPaused': 'Pausado automaticamente',
    'cardio.live.autoResumed': 'Retomado',
  },
  it: {
    'cardio.pr.title': '🏆 Nuovo record {label}!',
    'cardio.pr.badge': 'Record {label}',
    'cardio.weather.feelsLike': 'percepito',
    'cardio.live.autoPaused': 'Pausa automatica',
    'cardio.live.autoResumed': 'Ripreso',
  },
  ja: {
    'cardio.pr.title': '🏆 新記録 {label}！',
    'cardio.pr.badge': '{label} 記録',
    'cardio.weather.feelsLike': '体感',
  },
  ko: {
    'cardio.pr.title': '🏆 새 {label} 기록!',
    'cardio.pr.badge': '{label} 기록',
    'cardio.weather.feelsLike': '체감',
  },
  zh: {
    'cardio.pr.title': '🏆 新纪录 {label}！',
    'cardio.pr.badge': '{label} 纪录',
    'cardio.weather.feelsLike': '体感',
  },
  ar: {
    'cardio.pr.title': '🏆 رقم قياسي جديد {label}!',
    'cardio.pr.badge': 'رقم قياسي {label}',
    'cardio.weather.feelsLike': 'يبدو كأنه',
  },
  hi: {
    'cardio.pr.title': '🏆 नया {label} रिकॉर्ड!',
    'cardio.pr.badge': '{label} रिकॉर्ड',
    'cardio.weather.feelsLike': 'महसूस होता है',
  },
  ru: {
    'cardio.pr.title': '🏆 Новый рекорд {label}!',
    'cardio.pr.badge': 'Рекорд {label}',
  },
  tr: {
    'cardio.pr.title': '🏆 Yeni {label} rekoru!',
    'cardio.pr.badge': '{label} Rekoru',
  },
  pl: {
    'cardio.pr.title': '🏆 Nowy rekord {label}!',
    'cardio.pr.badge': 'Rekord {label}',
  },
  nl: {
    'cardio.pr.title': '🏆 Nieuw {label}-record!',
    'cardio.pr.badge': '{label} Record',
  },
};