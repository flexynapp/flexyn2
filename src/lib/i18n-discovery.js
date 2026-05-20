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

  'discovery.pushOptIn.kicker':           'STAY ON TRACK',
  'discovery.pushOptIn.title':            'Want a daily nudge?',
  'discovery.pushOptIn.body':             "Quiet, optional reminders to keep your streak alive. Manage them anytime in Settings — we'll never spam you.",
  'discovery.pushOptIn.cta':              'Enable reminders',
  'discovery.pushOptIn.dismissLabel':     'Not now',
  'discovery.pushOptIn.toastEnabled':     'Reminders enabled — change anytime in Settings.',
  'discovery.pushOptIn.toastDenied':      'Notifications blocked at the browser level. Re-enable from your browser settings if you change your mind.',
  'discovery.pushOptIn.toastUnsupported': "This device doesn't support push notifications yet.",
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

  'discovery.pushOptIn.kicker':           'NO PIERDAS EL RITMO',
  'discovery.pushOptIn.title':            '¿Quieres un recordatorio diario?',
  'discovery.pushOptIn.body':             'Recordatorios silenciosos y opcionales para mantener tu racha. Cámbialo cuando quieras en Ajustes — nunca te haremos spam.',
  'discovery.pushOptIn.cta':              'Activar recordatorios',
  'discovery.pushOptIn.dismissLabel':     'Ahora no',
  'discovery.pushOptIn.toastEnabled':     'Recordatorios activados — cámbialo cuando quieras en Ajustes.',
  'discovery.pushOptIn.toastDenied':      'Notificaciones bloqueadas en el navegador. Actívalas desde la configuración si cambias de idea.',
  'discovery.pushOptIn.toastUnsupported': 'Este dispositivo todavía no admite notificaciones push.',
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

  'discovery.pushOptIn.kicker':           'GARDE LE RYTHME',
  'discovery.pushOptIn.title':            'Tu veux un rappel quotidien ?',
  'discovery.pushOptIn.body':             'Rappels discrets et facultatifs pour entretenir ta série. Modifiable à tout moment dans Paramètres — pas de spam.',
  'discovery.pushOptIn.cta':              'Activer les rappels',
  'discovery.pushOptIn.dismissLabel':     'Plus tard',
  'discovery.pushOptIn.toastEnabled':     'Rappels activés — modifiable à tout moment dans Paramètres.',
  'discovery.pushOptIn.toastDenied':      "Notifications bloquées au niveau du navigateur. Réactive-les depuis les paramètres si tu changes d'avis.",
  'discovery.pushOptIn.toastUnsupported': "Cet appareil ne prend pas encore en charge les notifications push.",
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

  'discovery.pushOptIn.kicker':           'BLEIB DRAN',
  'discovery.pushOptIn.title':            'Tägliche Erinnerung?',
  'discovery.pushOptIn.body':             'Leise, optionale Erinnerungen für deine Streak. Jederzeit in den Einstellungen änderbar — kein Spam.',
  'discovery.pushOptIn.cta':              'Erinnerungen aktivieren',
  'discovery.pushOptIn.dismissLabel':     'Später',
  'discovery.pushOptIn.toastEnabled':     'Erinnerungen aktiviert — jederzeit in den Einstellungen änderbar.',
  'discovery.pushOptIn.toastDenied':      'Benachrichtigungen sind im Browser blockiert. Aktiviere sie in den Browser-Einstellungen, falls du es dir anders überlegst.',
  'discovery.pushOptIn.toastUnsupported': 'Dieses Gerät unterstützt Push-Benachrichtigungen noch nicht.',
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

  'discovery.pushOptIn.kicker':           'MANTENHA O RITMO',
  'discovery.pushOptIn.title':            'Quer um lembrete diário?',
  'discovery.pushOptIn.body':             'Lembretes discretos e opcionais para manter sua sequência. Ajustável a qualquer momento em Configurações — sem spam.',
  'discovery.pushOptIn.cta':              'Ativar lembretes',
  'discovery.pushOptIn.dismissLabel':     'Agora não',
  'discovery.pushOptIn.toastEnabled':     'Lembretes ativados — ajustável a qualquer momento em Configurações.',
  'discovery.pushOptIn.toastDenied':      'Notificações bloqueadas no nível do navegador. Reative pelas configurações do navegador se mudar de ideia.',
  'discovery.pushOptIn.toastUnsupported': 'Este dispositivo ainda não suporta notificações push.',
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

  'discovery.pushOptIn.kicker':           'NON FERMARTI',
  'discovery.pushOptIn.title':            'Vuoi un promemoria giornaliero?',
  'discovery.pushOptIn.body':             'Promemoria discreti e opzionali per mantenere la serie. Modificabili in Impostazioni — niente spam.',
  'discovery.pushOptIn.cta':              'Attiva promemoria',
  'discovery.pushOptIn.dismissLabel':     'Non ora',
  'discovery.pushOptIn.toastEnabled':     'Promemoria attivati — modificabili in Impostazioni.',
  'discovery.pushOptIn.toastDenied':      'Notifiche bloccate a livello di browser. Riattivale dalle impostazioni del browser se cambi idea.',
  'discovery.pushOptIn.toastUnsupported': 'Questo dispositivo non supporta ancora le notifiche push.',
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

  'discovery.pushOptIn.kicker':           '習慣を続ける',
  'discovery.pushOptIn.title':            '毎日のリマインダーを受け取りますか?',
  'discovery.pushOptIn.body':             '連続記録を保つための、控えめで任意のリマインダー。設定でいつでも変更できます — スパムは送りません。',
  'discovery.pushOptIn.cta':              'リマインダーを有効にする',
  'discovery.pushOptIn.dismissLabel':     '今はしない',
  'discovery.pushOptIn.toastEnabled':     'リマインダーが有効になりました — 設定でいつでも変更できます。',
  'discovery.pushOptIn.toastDenied':      '通知がブラウザレベルでブロックされています。気が変わったらブラウザ設定から再有効化してください。',
  'discovery.pushOptIn.toastUnsupported': 'このデバイスはまだプッシュ通知に対応していません。',
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
