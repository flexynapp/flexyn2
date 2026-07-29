// src/lib/i18n-leagues.js
//
// Translations for the Weekly League system + workout streak banner.
// Full translations for the 6 most-used languages; English fallback for the
// remaining 9 (per project policy in i18n.js — caller falls through to en).

const enKeys = {
  // League card
  'league.weekly':           'Weekly League',
  'league.yourRank':         'Your rank',
  'league.daysLeft':         'Days left',
  // TODO(i18n): English-only — needs a native pass for the other 14 locales.
  // Both are called through tFallback, so other languages render English
  // rather than a raw key until that pass lands.
  'league.globalGap':        'globally · {n} XP behind {name}',
  'league.globalLeading':    'globally · leading the board',
  'league.thisWeek':         'this week',
  'league.promoteZone':      'Promotion zone',
  'league.demoteZone':       'Demotion zone',
  'league.holdingPosition':  'Holding position',

  // League standings modal
  'league.title':            'League',
  'league.members':          'members',
  'league.topPromoted':      'Top {n} promoted',
  'league.bottomDemoted':    'Bottom {n} demoted',
  'league.empty':            'No members yet — earn XP to join the standings!',

  // Workout streak banner
  'dashboard.workoutDayStreak':   'day workout streak',
  'dashboard.workoutDaysStreak':  'day workout streak',
  'dashboard.atRiskToday':        'Train today to keep it',
  'dashboard.workoutStreakMilestone': '🔥 {day}-day workout streak! +{coins} coins',
};

const esKeys = {
  'league.weekly':           'Liga Semanal',
  'league.yourRank':         'Tu posición',
  'league.daysLeft':         'Días restantes',
  'league.thisWeek':         'esta semana',
  'league.promoteZone':      'Zona de ascenso',
  'league.demoteZone':       'Zona de descenso',
  'league.holdingPosition':  'Manteniendo posición',
  'league.title':            'Liga',
  'league.members':          'miembros',
  'league.topPromoted':      'Top {n} ascienden',
  'league.bottomDemoted':    'Últimos {n} descienden',
  'league.empty':            'Sin miembros aún — gana XP para entrar al ranking.',
  'dashboard.workoutDayStreak':   'día de racha de entreno',
  'dashboard.workoutDaysStreak':  'días de racha de entreno',
  'dashboard.atRiskToday':        'Entrena hoy para mantenerla',
  'dashboard.workoutStreakMilestone': '🔥 ¡{day} días de racha de entreno! +{coins} monedas',
};

const frKeys = {
  'league.weekly':           'Ligue Hebdomadaire',
  'league.yourRank':         'Votre rang',
  'league.daysLeft':         'Jours restants',
  'league.thisWeek':         'cette semaine',
  'league.promoteZone':      'Zone de promotion',
  'league.demoteZone':       'Zone de relégation',
  'league.holdingPosition':  'Maintien',
  'league.title':            'Ligue',
  'league.members':          'membres',
  'league.topPromoted':      'Top {n} promus',
  'league.bottomDemoted':    'Bas {n} relégués',
  'league.empty':            'Aucun membre — gagnez de l\'XP pour rejoindre le classement !',
  'dashboard.workoutDayStreak':   'jour de série d\'entraînement',
  'dashboard.workoutDaysStreak':  'jours de série d\'entraînement',
  'dashboard.atRiskToday':        'Entraînez-vous aujourd\'hui pour la garder',
  'dashboard.workoutStreakMilestone': '🔥 Série de {day} jours d\'entraînement ! +{coins} pièces',
};

const deKeys = {
  'league.weekly':           'Wöchentliche Liga',
  'league.yourRank':         'Dein Rang',
  'league.daysLeft':         'Tage übrig',
  'league.thisWeek':         'diese Woche',
  'league.promoteZone':      'Aufstiegszone',
  'league.demoteZone':       'Abstiegszone',
  'league.holdingPosition':  'Position halten',
  'league.title':            'Liga',
  'league.members':          'Mitglieder',
  'league.topPromoted':      'Top {n} aufgestiegen',
  'league.bottomDemoted':    'Untere {n} abgestiegen',
  'league.empty':            'Noch keine Mitglieder — verdiene XP, um in die Rangliste zu kommen!',
  'dashboard.workoutDayStreak':   'Tag Trainings-Serie',
  'dashboard.workoutDaysStreak':  'Tage Trainings-Serie',
  'dashboard.atRiskToday':        'Trainiere heute, um sie zu behalten',
  'dashboard.workoutStreakMilestone': '🔥 {day}-tägige Trainings-Serie! +{coins} Münzen',
};

const ptKeys = {
  'league.weekly':           'Liga Semanal',
  'league.yourRank':         'Sua posição',
  'league.daysLeft':         'Dias restantes',
  'league.thisWeek':         'esta semana',
  'league.promoteZone':      'Zona de promoção',
  'league.demoteZone':       'Zona de rebaixamento',
  'league.holdingPosition':  'Mantendo posição',
  'league.title':            'Liga',
  'league.members':          'membros',
  'league.topPromoted':      'Top {n} promovidos',
  'league.bottomDemoted':    'Últimos {n} rebaixados',
  'league.empty':            'Sem membros ainda — ganhe XP para entrar no ranking!',
  'dashboard.workoutDayStreak':   'dia de sequência de treino',
  'dashboard.workoutDaysStreak':  'dias de sequência de treino',
  'dashboard.atRiskToday':        'Treine hoje para manter',
  'dashboard.workoutStreakMilestone': '🔥 Sequência de {day} dias de treino! +{coins} moedas',
};

const jaKeys = {
  'league.weekly':           'ウィークリーリーグ',
  'league.yourRank':         'あなたの順位',
  'league.daysLeft':         '残り日数',
  'league.thisWeek':         '今週',
  'league.promoteZone':      '昇格圏',
  'league.demoteZone':       '降格圏',
  'league.holdingPosition':  '現状維持',
  'league.title':            'リーグ',
  'league.members':          '人',
  'league.topPromoted':      '上位{n}人昇格',
  'league.bottomDemoted':    '下位{n}人降格',
  'league.empty':            'メンバーなし — XPを獲得してランクインしよう！',
  'dashboard.workoutDayStreak':   '日連続ワークアウト',
  'dashboard.workoutDaysStreak':  '日連続ワークアウト',
  'dashboard.atRiskToday':        '今日トレーニングして連続を守ろう',
  'dashboard.workoutStreakMilestone': '🔥 {day}日連続ワークアウト達成！ +{coins} コイン',
};

export const leaguesI18n = {
  en: enKeys,
  es: esKeys,
  fr: frKeys,
  de: deKeys,
  pt: ptKeys,
  ja: jaKeys,
  // English fallback for the remaining nine — fillable later.
  it: enKeys, ko: enKeys, zh: enKeys, ar: enKeys, hi: enKeys,
  ru: enKeys, tr: enKeys, pl: enKeys, nl: enKeys,
};
