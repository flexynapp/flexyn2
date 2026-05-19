// src/lib/i18n-discovery.js
//
// Translations for the Dashboard DiscoveryCards onboarding affordances.
//
// Languages with native-quality translations: en, es, fr, de, pt, it, ja.
// Other languages currently inherit English (see TODO at bottom). The
// consuming components use `t(key) || 'English'` fallback so an
// untranslated language never surfaces a key code — it just shows the
// English string. A dedicated translation pass with a human native
// speaker should replace the inherited-English blocks.

const enKeys = {
  'discovery.dismiss':            'Dismiss',

  'discovery.starter.kicker':     'YOUR PLAN',
  'discovery.starter.title':      'Your starter plan is ready',
  'discovery.starter.body':       "We built a regimen from your onboarding answers. Open it in Workout to start your first session.",
  'discovery.starter.cta':        'Start your first workout',

  'discovery.formCoach.kicker':   'BETA',
  'discovery.formCoach.title':    'Try Form Coach',
  'discovery.formCoach.body':     'On-device AI checks your lift form from a quick photo. No video, no upload — runs right on your phone.',
  'discovery.formCoach.cta':      'Try Form Coach',

  'discovery.coach.kicker':       'YOUR COACH',
  'discovery.coach.title':        'Meet your AI Coach',
  'discovery.coach.body':         'Personal advice tuned to your actual workouts, weight, and goals. Ask anything — programming, plateaus, recovery.',
  'discovery.coach.cta':          'Open Coach',
};

const esKeys = {
  'discovery.dismiss':            'Descartar',

  'discovery.starter.kicker':     'TU PLAN',
  'discovery.starter.title':      'Tu plan inicial está listo',
  'discovery.starter.body':       'Creamos una rutina con tus respuestas del onboarding. Ábrela en Entrenamiento para empezar tu primera sesión.',
  'discovery.starter.cta':        'Empieza tu primer entrenamiento',

  'discovery.formCoach.kicker':   'BETA',
  'discovery.formCoach.title':    'Prueba Form Coach',
  'discovery.formCoach.body':     'IA en el dispositivo que analiza tu técnica con una foto. Sin video, sin subidas — funciona en tu teléfono.',
  'discovery.formCoach.cta':      'Prueba Form Coach',

  'discovery.coach.kicker':       'TU COACH',
  'discovery.coach.title':        'Conoce a tu Coach IA',
  'discovery.coach.body':         'Consejos personalizados según tus entrenamientos, peso y objetivos. Pregúntale lo que quieras — programación, mesetas, recuperación.',
  'discovery.coach.cta':          'Abrir Coach',
};

const frKeys = {
  'discovery.dismiss':            'Ignorer',

  'discovery.starter.kicker':     'TON PLAN',
  'discovery.starter.title':      'Ton plan de départ est prêt',
  'discovery.starter.body':       "On a créé un programme à partir de tes réponses. Ouvre-le dans Entraînement pour démarrer ta première séance.",
  'discovery.starter.cta':        'Lance ton premier entraînement',

  'discovery.formCoach.kicker':   'BÊTA',
  'discovery.formCoach.title':    'Essaie Form Coach',
  'discovery.formCoach.body':     "IA sur l'appareil qui analyse ta technique à partir d'une photo. Pas de vidéo, pas d'upload — tourne sur ton téléphone.",
  'discovery.formCoach.cta':      'Essaie Form Coach',

  'discovery.coach.kicker':       'TON COACH',
  'discovery.coach.title':        'Découvre ton Coach IA',
  'discovery.coach.body':         "Conseils personnalisés selon tes entraînements, ton poids et tes objectifs. Demande-lui n'importe quoi — programmation, paliers, récupération.",
  'discovery.coach.cta':          'Ouvrir Coach',
};

const deKeys = {
  'discovery.dismiss':            'Schließen',

  'discovery.starter.kicker':     'DEIN PLAN',
  'discovery.starter.title':      'Dein Startplan ist bereit',
  'discovery.starter.body':       'Wir haben aus deinem Onboarding ein Programm gebaut. Öffne es im Training, um deine erste Session zu starten.',
  'discovery.starter.cta':        'Starte dein erstes Training',

  'discovery.formCoach.kicker':   'BETA',
  'discovery.formCoach.title':    'Probier Form Coach',
  'discovery.formCoach.body':     'KI auf dem Gerät prüft deine Hebetechnik per Foto. Kein Video, kein Upload — läuft direkt auf deinem Handy.',
  'discovery.formCoach.cta':      'Probier Form Coach',

  'discovery.coach.kicker':       'DEIN COACH',
  'discovery.coach.title':        'Lerne deinen KI-Coach kennen',
  'discovery.coach.body':         'Persönliche Tipps abgestimmt auf deine Trainings, dein Gewicht und deine Ziele. Frag alles — Programmierung, Plateaus, Erholung.',
  'discovery.coach.cta':          'Coach öffnen',
};

const ptKeys = {
  'discovery.dismiss':            'Descartar',

  'discovery.starter.kicker':     'SEU PLANO',
  'discovery.starter.title':      'Seu plano inicial está pronto',
  'discovery.starter.body':       'Construímos uma rotina com suas respostas do onboarding. Abra em Treino para começar sua primeira sessão.',
  'discovery.starter.cta':        'Comece seu primeiro treino',

  'discovery.formCoach.kicker':   'BETA',
  'discovery.formCoach.title':    'Experimente o Form Coach',
  'discovery.formCoach.body':     'IA no dispositivo analisa sua técnica a partir de uma foto. Sem vídeo, sem upload — roda no seu celular.',
  'discovery.formCoach.cta':      'Experimente o Form Coach',

  'discovery.coach.kicker':       'SEU COACH',
  'discovery.coach.title':        'Conheça seu Coach IA',
  'discovery.coach.body':         'Conselhos personalizados conforme seus treinos, peso e metas. Pergunte qualquer coisa — programação, platôs, recuperação.',
  'discovery.coach.cta':          'Abrir Coach',
};

const itKeys = {
  'discovery.dismiss':            'Ignora',

  'discovery.starter.kicker':     'IL TUO PIANO',
  'discovery.starter.title':      'Il tuo piano iniziale è pronto',
  'discovery.starter.body':       "Abbiamo creato una scheda con le tue risposte dell'onboarding. Aprila in Allenamento per iniziare la prima sessione.",
  'discovery.starter.cta':        'Inizia il tuo primo allenamento',

  'discovery.formCoach.kicker':   'BETA',
  'discovery.formCoach.title':    'Prova Form Coach',
  'discovery.formCoach.body':     'IA sul dispositivo che analizza la tecnica da una foto. Niente video, niente upload — gira sul tuo telefono.',
  'discovery.formCoach.cta':      'Prova Form Coach',

  'discovery.coach.kicker':       'IL TUO COACH',
  'discovery.coach.title':        'Scopri il tuo Coach IA',
  'discovery.coach.body':         'Consigli personalizzati su allenamenti, peso e obiettivi. Chiedi qualunque cosa — programmazione, plateau, recupero.',
  'discovery.coach.cta':          'Apri Coach',
};

const jaKeys = {
  'discovery.dismiss':            '閉じる',

  'discovery.starter.kicker':     'あなたのプラン',
  'discovery.starter.title':      'スタータープランの準備ができました',
  'discovery.starter.body':       'オンボーディングの回答からプログラムを作成しました。「ワークアウト」で開いて、最初のセッションを始めましょう。',
  'discovery.starter.cta':        '最初のワークアウトを始める',

  'discovery.formCoach.kicker':   'ベータ',
  'discovery.formCoach.title':    'フォームコーチを試す',
  'discovery.formCoach.body':     '端末上のAIが写真からフォームをチェックします。動画もアップロードもなし — スマホ上で動作します。',
  'discovery.formCoach.cta':      'フォームコーチを試す',

  'discovery.coach.kicker':       'あなたのコーチ',
  'discovery.coach.title':        'AIコーチに会う',
  'discovery.coach.body':         'ワークアウト・体重・目標に合わせたパーソナルアドバイス。何でも聞いてください — プログラミング、停滞期、回復。',
  'discovery.coach.cta':          'コーチを開く',
};

// TODO(i18n): Native-quality translations needed for the languages
// below — they currently inherit English. Translating these without
// a native speaker would risk shipping inaccurate copy on the most
// prominent onboarding affordances, which is worse than the current
// English-fallback behavior. File a follow-up task to localize:
//   - ar (Arabic)        - hi (Hindi)        - ko (Korean)
//   - zh (Chinese)       - ru (Russian)      - tr (Turkish)
//   - pl (Polish)        - nl (Dutch)
export const discoveryI18n = {
  en: enKeys,
  es: esKeys,
  fr: frKeys,
  de: deKeys,
  pt: ptKeys,
  it: itKeys,
  ja: jaKeys,
  // Inherit English until human translators review:
  ko: enKeys, zh: enKeys, ar: enKeys, hi: enKeys,
  ru: enKeys, tr: enKeys, pl: enKeys, nl: enKeys,
};
