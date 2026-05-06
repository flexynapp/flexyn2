// src/lib/i18n-generator.js
// Translations for the AI Workout Generator UI.

const enKeys = {
  'generator.title':         'Generate Workout',
  'generator.cardSubtitle':  'AI builds a session from your history',
  'generator.focus':         'Focus',
  'generator.duration':      'Duration',
  'generator.equipment':     'Equipment',
  'generator.skill':         'Experience',
  'generator.generate':      'Generate',
  'generator.regenerate':    'Regenerate',
  'generator.use':           'Use this',
  'generator.thinking':      'Building your workout…',
  'generator.thinkingDesc':  'Reading your training history.',
  'generator.disclaimer':    'Personalized using your last 60 days of workout history. Not a substitute for a coach if you have injuries or special needs.',
  'generator.loaded':        'Workout loaded — start lifting!',
};

const esKeys = {
  'generator.title':         'Generar Entrenamiento',
  'generator.cardSubtitle':  'La IA construye una sesión basada en tu historial',
  'generator.focus':         'Enfoque',
  'generator.duration':      'Duración',
  'generator.equipment':     'Equipo',
  'generator.skill':         'Experiencia',
  'generator.generate':      'Generar',
  'generator.regenerate':    'Regenerar',
  'generator.use':           'Usar este',
  'generator.thinking':      'Construyendo tu entrenamiento…',
  'generator.thinkingDesc':  'Leyendo tu historial de entrenamiento.',
  'generator.disclaimer':    'Personalizado con tus últimos 60 días de historial. No reemplaza a un entrenador si tienes lesiones o necesidades especiales.',
  'generator.loaded':        '¡Entrenamiento cargado — empieza a entrenar!',
};

const frKeys = {
  'generator.title':         'Générer un Entraînement',
  'generator.cardSubtitle':  "L'IA construit une séance à partir de ton historique",
  'generator.focus':         'Focus',
  'generator.duration':      'Durée',
  'generator.equipment':     'Équipement',
  'generator.skill':         'Niveau',
  'generator.generate':      'Générer',
  'generator.regenerate':    'Régénérer',
  'generator.use':           'Utiliser',
  'generator.thinking':      'Création de ton entraînement…',
  'generator.thinkingDesc':  'Lecture de ton historique.',
  'generator.disclaimer':    "Personnalisé avec tes 60 derniers jours d'entraînement. Pas un substitut à un coach si tu as des blessures.",
  'generator.loaded':        'Entraînement chargé — c\'est parti !',
};

const deKeys = {
  'generator.title':         'Workout generieren',
  'generator.cardSubtitle':  'KI baut eine Einheit aus deinem Verlauf',
  'generator.focus':         'Fokus',
  'generator.duration':      'Dauer',
  'generator.equipment':     'Ausrüstung',
  'generator.skill':         'Erfahrung',
  'generator.generate':      'Generieren',
  'generator.regenerate':    'Neu generieren',
  'generator.use':           'Diese verwenden',
  'generator.thinking':      'Erstelle dein Workout…',
  'generator.thinkingDesc':  'Lese deinen Trainingsverlauf.',
  'generator.disclaimer':    'Personalisiert anhand deiner letzten 60 Tage. Kein Ersatz für einen Coach bei Verletzungen.',
  'generator.loaded':        'Workout geladen — los geht\'s!',
};

const ptKeys = {
  'generator.title':         'Gerar Treino',
  'generator.cardSubtitle':  'A IA monta uma sessão do seu histórico',
  'generator.focus':         'Foco',
  'generator.duration':      'Duração',
  'generator.equipment':     'Equipamento',
  'generator.skill':         'Experiência',
  'generator.generate':      'Gerar',
  'generator.regenerate':    'Gerar de novo',
  'generator.use':           'Usar este',
  'generator.thinking':      'Montando seu treino…',
  'generator.thinkingDesc':  'Lendo seu histórico de treino.',
  'generator.disclaimer':    'Personalizado com seus últimos 60 dias. Não substitui um treinador se houver lesões.',
  'generator.loaded':        'Treino carregado — vamos lá!',
};

const jaKeys = {
  'generator.title':         'ワークアウトを生成',
  'generator.cardSubtitle':  'AIが履歴からセッションを構築',
  'generator.focus':         '対象部位',
  'generator.duration':      '時間',
  'generator.equipment':     '器具',
  'generator.skill':         '経験',
  'generator.generate':      '生成',
  'generator.regenerate':    '再生成',
  'generator.use':           'これを使う',
  'generator.thinking':      'ワークアウトを作成中…',
  'generator.thinkingDesc':  'トレーニング履歴を読み取っています。',
  'generator.disclaimer':    '過去60日のトレーニング履歴に基づいたパーソナライズ。怪我や特別な事情がある場合はコーチを利用してください。',
  'generator.loaded':        'ワークアウトをロード — 始めよう！',
};

export const generatorI18n = {
  en: enKeys, es: esKeys, fr: frKeys, de: deKeys, pt: ptKeys, ja: jaKeys,
  it: enKeys, ko: enKeys, zh: enKeys, ar: enKeys, hi: enKeys,
  ru: enKeys, tr: enKeys, pl: enKeys, nl: enKeys,
};
