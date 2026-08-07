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
  // Shown once the daily cap on model-backed replies is hit. The coach keeps
  // answering from the rules engine — this explains why it got simpler.
  // English-only for now; tFallback carries it on the other 14 languages
  // until a native pass, per the no-machine-translation rule in CLAUDE.md.
  'coach.capped':          "You've hit today's limit for detailed answers — back to the basics until tomorrow.",
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


const itKeys = {
  'coach.title': 'Coach',
  'coach.subtitle': 'Consigli personalizzati dai tuoi dati',
  'coach.placeholder': 'Chiedi qualsiasi cosa al Coach…',
  'coach.thinking': 'Sto pensando…',
  'coach.welcome.title': 'Il tuo coach personale',
  'coach.welcome.desc': 'Chiedimi qualsiasi cosa sul tuo allenamento. Leggo i tuoi dati reali per darti consigli specifici.',
};

const koKeys = {
  'coach.title': '코치',
  'coach.subtitle': '내 데이터 기반 맞춤 조언',
  'coach.placeholder': '코치에게 무엇이든 물어보세요…',
  'coach.thinking': '생각 중…',
  'coach.welcome.title': '나의 개인 코치',
  'coach.welcome.desc': '훈련에 대해 무엇이든 물어보세요. 실제 운동 기록을 읽고 구체적으로 조언해 드립니다.',
};

const zhKeys = {
  'coach.title': '教练',
  'coach.subtitle': '基于你的数据的个性化建议',
  'coach.placeholder': '有什么想问教练的…',
  'coach.thinking': '思考中…',
  'coach.welcome.title': '你的私人教练',
  'coach.welcome.desc': '关于训练随便问。我会读取你真实的训练数据，给出具体建议。',
};

const arKeys = {
  'coach.title': 'المدرّب',
  'coach.subtitle': 'نصائح مخصّصة من بياناتك',
  'coach.placeholder': 'اسأل المدرّب أي شيء…',
  'coach.thinking': 'جاري التفكير…',
  'coach.welcome.title': 'مدرّبك الشخصي',
  'coach.welcome.desc': 'اسألني أي شيء عن تدريبك. أقرأ بيانات تمارينك الفعلية لأعطيك نصائح محدّدة.',
};

const hiKeys = {
  'coach.title': 'कोच',
  'coach.subtitle': 'आपके डेटा से निजी सलाह',
  'coach.placeholder': 'कोच से कुछ भी पूछें…',
  'coach.thinking': 'सोच रहा हूँ…',
  'coach.welcome.title': 'आपका निजी कोच',
  'coach.welcome.desc': 'अपनी ट्रेनिंग के बारे में कुछ भी पूछें। मैं आपका असली वर्कआउट डेटा पढ़कर ठोस सलाह देता हूँ।',
};

const ruKeys = {
  'coach.title': 'Тренер',
  'coach.subtitle': 'Персональные советы по твоим данным',
  'coach.placeholder': 'Спроси у Тренера что угодно…',
  'coach.thinking': 'Думаю…',
  'coach.welcome.title': 'Твой личный тренер',
  'coach.welcome.desc': 'Спрашивай что угодно о тренировках. Я читаю твои реальные данные и даю конкретные советы.',
};

const trKeys = {
  'coach.title': 'Koç',
  'coach.subtitle': 'Verilerinden kişisel tavsiyeler',
  'coach.placeholder': 'Koç\'a her şeyi sor…',
  'coach.thinking': 'Düşünüyor…',
  'coach.welcome.title': 'Kişisel koçun',
  'coach.welcome.desc': 'Antrenmanınla ilgili her şeyi sor. Gerçek antrenman verilerini okuyup sana özel tavsiye veriyorum.',
};

const plKeys = {
  'coach.title': 'Trener',
  'coach.subtitle': 'Osobiste porady na podstawie twoich danych',
  'coach.placeholder': 'Zapytaj Trenera o cokolwiek…',
  'coach.thinking': 'Myślę…',
  'coach.welcome.title': 'Twój osobisty trener',
  'coach.welcome.desc': 'Pytaj o wszystko, co dotyczy treningu. Czytam twoje prawdziwe dane treningowe, żeby dać konkretną radę.',
};

const nlKeys = {
  'coach.title': 'Coach',
  'coach.subtitle': 'Persoonlijk advies uit jouw gegevens',
  'coach.placeholder': 'Vraag de Coach alles…',
  'coach.thinking': 'Aan het denken…',
  'coach.welcome.title': 'Jouw persoonlijke coach',
  'coach.welcome.desc': 'Vraag me alles over je training. Ik lees je echte trainingsgegevens om je specifiek advies te geven.',
};

export const coachI18n = {
  en: enKeys,
  es: esKeys,
  fr: frKeys,
  de: deKeys,
  pt: ptKeys,
  ja: jaKeys,
  it: itKeys, ko: koKeys, zh: zhKeys, ar: arKeys, hi: hiKeys,
  ru: ruKeys, tr: trKeys, pl: plKeys, nl: nlKeys,
};
