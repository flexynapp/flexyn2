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
    'cardio.modes.swimming.desc': 'Pool or open water',

    // The other three tile descriptions, and a translation REGRESSION
    // taken deliberately — read this before "fixing" it back.
    //
    // Running, Walking and Biking all passed t('cardio.subtitle') —
    // "Track running, walking, and cycling" — so three of the four tiles
    // in the 2x2 grid carried one identical line, which was also the page
    // subtitle directly above them. Under "Running", a line listing
    // walking and cycling is worse than no line.
    //
    // `cardio.subtitle` IS translated in all 15 languages and these are
    // not, so a non-English user trades a translated-but-wrong line for
    // an English-but-right one. That is the trade CLAUDE.md's i18n rule
    // calls for — English-only with a TODO beats machine-translating
    // prose — and the swimming tile beside them has shipped exactly this
    // way since the Aug 2026 audit.
    //
    // Framing is what each activity actually LOGS, because environment
    // cannot separate these: running and walking offer the same two
    // (outside / treadmill), so an environment line would just be a new
    // pair of duplicates. Checked against CardioManualForm's field gates
    // — elevation is outside-and-not-biking, power is biking-only,
    // splits come off a GPS track.
    'cardio.modes.running.desc': 'Pace, splits, and elevation',
    'cardio.modes.walking.desc': 'Distance, pace, and elevation',
    'cardio.modes.biking.desc': 'Speed, power, and distance',
    'cardio.swim.whereQuestion': 'Where are you swimming?',
    'cardio.swim.pool': 'Pool',
    'cardio.swim.pool.desc': 'Lap pool, 25 m or 50 m',
    'cardio.swim.openWater': 'Open Water',
    'cardio.swim.openWater.desc': 'Lake, ocean, river',
    'cardio.nav.templates': 'Templates',
    'cardio.nav.templates.desc': 'Quick-start saved configurations',
    'cardio.nav.planned': 'Planned Sessions',
    'cardio.nav.planned.desc': 'Schedule upcoming workouts',
    'cardio.nav.goals': 'Cardio Goals',
    'cardio.nav.goals.desc': 'Weekly & monthly distance targets',
    'cardio.nav.devices': 'Devices & Apps',
    'cardio.nav.devices.desc': 'Apple Watch, Garmin, Fitbit…',
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