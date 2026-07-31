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
  'league.globalGap': 'globalmente · {n} XP detrás de {name}',
  'league.globalLeading': 'globalmente · liderando la tabla',
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
  'league.globalGap': 'au niveau mondial · {n} XP derrière {name}',
  'league.globalLeading': 'au niveau mondial · en tête du classement',
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
  'league.globalGap': 'weltweit · {n} XP hinter {name}',
  'league.globalLeading': 'weltweit · an der Spitze',
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
  'league.globalGap': 'globalmente · {n} XP atrás de {name}',
  'league.globalLeading': 'globalmente · liderando a tabela',
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
  'league.globalGap': '全体 · {name}に{n} XP差',
  'league.globalLeading': '全体 · 首位',
};


const itKeys = {
  'league.title': 'Lega',
  'league.weekly': 'Lega settimanale',
  'league.yourRank': 'La tua posizione',
  'league.thisWeek': 'questa settimana',
  'league.daysLeft': 'Giorni rimasti',
  'league.members': 'membri',
  'league.empty': 'Ancora nessun membro — guadagna XP per entrare in classifica!',
  'league.promoteZone': 'Zona promozione',
  'league.demoteZone': 'Zona retrocessione',
  'league.topPromoted': 'I primi {n} promossi',
  'league.bottomDemoted': 'Gli ultimi {n} retrocessi',
  'league.holdingPosition': 'Posizione mantenuta',
  'league.globalGap': 'a livello globale · {n} XP dietro {name}',
  'league.globalLeading': 'a livello globale · in testa alla classifica',
};

const koKeys = {
  'league.title': '리그',
  'league.weekly': '주간 리그',
  'league.yourRank': '내 순위',
  'league.thisWeek': '이번 주',
  'league.daysLeft': '남은 일수',
  'league.members': '명',
  'league.empty': '아직 멤버가 없습니다 — XP를 모아 순위에 참여하세요!',
  'league.promoteZone': '승급 구간',
  'league.demoteZone': '강등 구간',
  'league.topPromoted': '상위 {n}명 승급',
  'league.bottomDemoted': '하위 {n}명 강등',
  'league.holdingPosition': '순위 유지',
  'league.globalGap': '전체 기준 · {name}님보다 {n} XP 뒤',
  'league.globalLeading': '전체 기준 · 1위',
};

const zhKeys = {
  'league.title': '联赛',
  'league.weekly': '每周联赛',
  'league.yourRank': '你的排名',
  'league.thisWeek': '本周',
  'league.daysLeft': '剩余天数',
  'league.members': '名成员',
  'league.empty': '还没有成员 — 赚取 XP 加入排行榜！',
  'league.promoteZone': '晋级区',
  'league.demoteZone': '降级区',
  'league.topPromoted': '前 {n} 名晋级',
  'league.bottomDemoted': '后 {n} 名降级',
  'league.holdingPosition': '保持排名',
  'league.globalGap': '全球 · 落后 {name} {n} XP',
  'league.globalLeading': '全球 · 排名第一',
};

const arKeys = {
  'league.title': 'الدوري',
  'league.weekly': 'الدوري الأسبوعي',
  'league.yourRank': 'ترتيبك',
  'league.thisWeek': 'هذا الأسبوع',
  'league.daysLeft': 'الأيام المتبقية',
  'league.members': 'عضوًا',
  'league.empty': 'لا يوجد أعضاء بعد — اكسب XP للانضمام إلى الترتيب!',
  'league.promoteZone': 'منطقة الصعود',
  'league.demoteZone': 'منطقة الهبوط',
  'league.topPromoted': 'أفضل {n} يصعدون',
  'league.bottomDemoted': 'آخر {n} يهبطون',
  'league.holdingPosition': 'الحفاظ على المركز',
  'league.globalGap': 'عالميًا · متأخر بـ {n} XP عن {name}',
  'league.globalLeading': 'عالميًا · في الصدارة',
};

const hiKeys = {
  'league.title': 'लीग',
  'league.weekly': 'साप्ताहिक लीग',
  'league.yourRank': 'आपकी रैंक',
  'league.thisWeek': 'इस हफ़्ते',
  'league.daysLeft': 'बचे दिन',
  'league.members': 'सदस्य',
  'league.empty': 'अभी कोई सदस्य नहीं — रैंकिंग में आने के लिए XP कमाएँ!',
  'league.promoteZone': 'प्रमोशन ज़ोन',
  'league.demoteZone': 'डिमोशन ज़ोन',
  'league.topPromoted': 'टॉप {n} प्रमोट',
  'league.bottomDemoted': 'निचले {n} डिमोट',
  'league.holdingPosition': 'स्थान बरकरार',
  'league.globalGap': 'वैश्विक · {name} से {n} XP पीछे',
  'league.globalLeading': 'वैश्विक · सबसे आगे',
};

const ruKeys = {
  'league.title': 'Лига',
  'league.weekly': 'Недельная лига',
  'league.yourRank': 'Твоё место',
  'league.thisWeek': 'на этой неделе',
  'league.daysLeft': 'Осталось дней',
  'league.members': 'участников',
  'league.empty': 'Пока нет участников — заработай XP, чтобы попасть в таблицу!',
  'league.promoteZone': 'Зона повышения',
  'league.demoteZone': 'Зона понижения',
  'league.topPromoted': 'Топ-{n} повышаются',
  'league.bottomDemoted': 'Последние {n} понижаются',
  'league.holdingPosition': 'Позиция сохранена',
  'league.globalGap': 'в мире · отстаёшь от {name} на {n} XP',
  'league.globalLeading': 'в мире · во главе таблицы',
};

const trKeys = {
  'league.title': 'Lig',
  'league.weekly': 'Haftalık lig',
  'league.yourRank': 'Sıralaman',
  'league.thisWeek': 'bu hafta',
  'league.daysLeft': 'Kalan gün',
  'league.members': 'üye',
  'league.empty': 'Henüz üye yok — sıralamaya girmek için XP kazan!',
  'league.promoteZone': 'Yükselme bölgesi',
  'league.demoteZone': 'Düşme bölgesi',
  'league.topPromoted': 'İlk {n} yükseliyor',
  'league.bottomDemoted': 'Son {n} düşüyor',
  'league.holdingPosition': 'Sıra korunuyor',
  'league.globalGap': 'küresel · {name} oyuncusundan {n} XP geride',
  'league.globalLeading': 'küresel · listenin başında',
};

const plKeys = {
  'league.title': 'Liga',
  'league.weekly': 'Liga tygodniowa',
  'league.yourRank': 'Twoja pozycja',
  'league.thisWeek': 'w tym tygodniu',
  'league.daysLeft': 'Pozostało dni',
  'league.members': 'członków',
  'league.empty': 'Brak członków — zdobądź XP, aby wejść do rankingu!',
  'league.promoteZone': 'Strefa awansu',
  'league.demoteZone': 'Strefa spadku',
  'league.topPromoted': 'Pierwszych {n} awansuje',
  'league.bottomDemoted': 'Ostatnich {n} spada',
  'league.holdingPosition': 'Pozycja utrzymana',
  'league.globalGap': 'globalnie · {n} XP za {name}',
  'league.globalLeading': 'globalnie · na czele',
};

const nlKeys = {
  'league.title': 'Divisie',
  'league.weekly': 'Wekelijkse divisie',
  'league.yourRank': 'Jouw positie',
  'league.thisWeek': 'deze week',
  'league.daysLeft': 'Dagen over',
  'league.members': 'leden',
  'league.empty': 'Nog geen leden — verdien XP om in de stand te komen!',
  'league.promoteZone': 'Promotiezone',
  'league.demoteZone': 'Degradatiezone',
  'league.topPromoted': 'Top {n} promoveert',
  'league.bottomDemoted': 'Onderste {n} degradeert',
  'league.holdingPosition': 'Positie behouden',
  'league.globalGap': 'wereldwijd · {n} XP achter {name}',
  'league.globalLeading': 'wereldwijd · aan kop',
};

export const leaguesI18n = {
  en: enKeys,
  es: esKeys,
  fr: frKeys,
  de: deKeys,
  pt: ptKeys,
  ja: jaKeys,
  // English fallback for the remaining nine — fillable later.
  it: itKeys, ko: koKeys, zh: zhKeys, ar: arKeys, hi: hiKeys,
  ru: ruKeys, tr: trKeys, pl: plKeys, nl: nlKeys,
};
