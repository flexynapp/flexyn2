// src/lib/i18n-coach.js
//
// Translations for the AI Coach chat UI chrome. The coach's actual replies
// are generated in src/lib/aiCoach/responders.js — those are English at the
// moment because they include data formatting, exercise names, and varying
// contextual phrasing. Localizing the responders fully is a follow-up.

const enKeys = {
  'coach.title':           'Coach',
  'coach.subtitle':        'Personalized advice from your data',
  'coach.placeholder':     'Ask Coach anything…',
  'coach.thinking':        'Thinking…',
  'coach.welcome.title':   'Your personal coach',
  'coach.welcome.desc':    'Ask me anything about your training. I read your actual workout data to give you specific advice.',
};

const esKeys = {
  'coach.title':           'Coach',
  'coach.subtitle':        'Consejos personalizados según tus datos',
  'coach.placeholder':     'Pregunta lo que quieras al Coach…',
  'coach.thinking':        'Pensando…',
  'coach.welcome.title':   'Tu entrenador personal',
  'coach.welcome.desc':    'Pregúntame cualquier cosa sobre tu entrenamiento. Leo tus datos reales para darte consejos específicos.',
};

const frKeys = {
  'coach.title':           'Coach',
  'coach.subtitle':        'Conseils personnalisés à partir de tes données',
  'coach.placeholder':     'Pose une question au Coach…',
  'coach.thinking':        'Réflexion…',
  'coach.welcome.title':   'Ton coach personnel',
  'coach.welcome.desc':    'Pose-moi n\'importe quelle question sur ton entraînement. Je lis tes vraies données pour te donner des conseils précis.',
};

const deKeys = {
  'coach.title':           'Coach',
  'coach.subtitle':        'Persönliche Tipps aus deinen Daten',
  'coach.placeholder':     'Frag den Coach alles…',
  'coach.thinking':        'Denke nach…',
  'coach.welcome.title':   'Dein persönlicher Coach',
  'coach.welcome.desc':    'Frag mich alles über dein Training. Ich lese deine echten Workout-Daten und gebe dir konkrete Tipps.',
};

const ptKeys = {
  'coach.title':           'Coach',
  'coach.subtitle':        'Conselhos personalizados dos seus dados',
  'coach.placeholder':     'Pergunte qualquer coisa ao Coach…',
  'coach.thinking':        'Pensando…',
  'coach.welcome.title':   'Seu coach pessoal',
  'coach.welcome.desc':    'Pergunte qualquer coisa sobre seu treino. Leio seus dados reais para dar conselhos específicos.',
};

const jaKeys = {
  'coach.title':           'コーチ',
  'coach.subtitle':        'あなたのデータからパーソナライズドアドバイス',
  'coach.placeholder':     'コーチに何でも聞いてください…',
  'coach.thinking':        '考え中…',
  'coach.welcome.title':   'あなた専属のコーチ',
  'coach.welcome.desc':    'トレーニングについて何でも聞いてください。実際のワークアウトデータを読み取り、具体的なアドバイスを提供します。',
};

export const coachI18n = {
  en: enKeys,
  es: esKeys,
  fr: frKeys,
  de: deKeys,
  pt: ptKeys,
  ja: jaKeys,
  it: enKeys, ko: enKeys, zh: enKeys, ar: enKeys, hi: enKeys,
  ru: enKeys, tr: enKeys, pl: enKeys, nl: enKeys,
};
