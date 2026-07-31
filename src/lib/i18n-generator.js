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


const itKeys = {
  'generator.title': 'Genera allenamento',
  'generator.cardSubtitle': 'L\'AI costruisce una sessione dal tuo storico',
  'generator.focus': 'Focus',
  'generator.duration': 'Durata',
  'generator.equipment': 'Attrezzatura',
  'generator.skill': 'Esperienza',
  'generator.generate': 'Genera',
  'generator.regenerate': 'Rigenera',
  'generator.thinking': 'Sto costruendo il tuo allenamento…',
  'generator.thinkingDesc': 'Sto leggendo il tuo storico di allenamento.',
  'generator.use': 'Usa questo',
  'generator.loaded': 'Allenamento caricato — si comincia!',
  'generator.disclaimer': 'Personalizzato usando i tuoi ultimi 60 giorni di allenamenti. Non sostituisce un coach se hai infortuni o esigenze particolari.',
};

const koKeys = {
  'generator.title': '운동 생성',
  'generator.cardSubtitle': 'AI가 기록을 바탕으로 세션을 구성합니다',
  'generator.focus': '중점 부위',
  'generator.duration': '시간',
  'generator.equipment': '장비',
  'generator.skill': '숙련도',
  'generator.generate': '생성',
  'generator.regenerate': '다시 생성',
  'generator.thinking': '운동을 구성하는 중…',
  'generator.thinkingDesc': '운동 기록을 읽고 있습니다.',
  'generator.use': '이걸로 하기',
  'generator.loaded': '운동을 불러왔습니다 — 시작하세요!',
  'generator.disclaimer': '최근 60일간의 운동 기록을 바탕으로 맞춤 구성했습니다. 부상이 있거나 특별한 필요가 있다면 코치를 대신할 수 없습니다.',
};

const zhKeys = {
  'generator.title': '生成训练',
  'generator.cardSubtitle': 'AI 根据你的记录安排一次训练',
  'generator.focus': '训练重点',
  'generator.duration': '时长',
  'generator.equipment': '器械',
  'generator.skill': '经验水平',
  'generator.generate': '生成',
  'generator.regenerate': '重新生成',
  'generator.thinking': '正在为你安排训练…',
  'generator.thinkingDesc': '正在读取你的训练记录。',
  'generator.use': '就用这个',
  'generator.loaded': '训练已载入 — 开始吧！',
  'generator.disclaimer': '根据你最近 60 天的训练记录个性化生成。如果你有伤病或特殊需求，这不能替代教练。',
};

const arKeys = {
  'generator.title': 'إنشاء تمرين',
  'generator.cardSubtitle': 'الذكاء الاصطناعي يبني جلسة من سجلك',
  'generator.focus': 'التركيز',
  'generator.duration': 'المدة',
  'generator.equipment': 'المعدات',
  'generator.skill': 'الخبرة',
  'generator.generate': 'إنشاء',
  'generator.regenerate': 'إعادة الإنشاء',
  'generator.thinking': 'جاري بناء تمرينك…',
  'generator.thinkingDesc': 'نقرأ سجل تدريبك.',
  'generator.use': 'استخدم هذا',
  'generator.loaded': 'تم تحميل التمرين — ابدأ!',
  'generator.disclaimer': 'مُخصّص باستخدام آخر 60 يومًا من سجل تمارينك. ليس بديلاً عن مدرّب إذا كانت لديك إصابات أو احتياجات خاصة.',
};

const hiKeys = {
  'generator.title': 'वर्कआउट बनाएँ',
  'generator.cardSubtitle': 'AI आपके इतिहास से एक सेशन बनाता है',
  'generator.focus': 'फ़ोकस',
  'generator.duration': 'अवधि',
  'generator.equipment': 'उपकरण',
  'generator.skill': 'अनुभव',
  'generator.generate': 'बनाएँ',
  'generator.regenerate': 'फिर से बनाएँ',
  'generator.thinking': 'आपका वर्कआउट बन रहा है…',
  'generator.thinkingDesc': 'आपका ट्रेनिंग इतिहास पढ़ा जा रहा है।',
  'generator.use': 'यही लें',
  'generator.loaded': 'वर्कआउट लोड हो गया — शुरू करें!',
  'generator.disclaimer': 'आपके पिछले 60 दिनों के वर्कआउट इतिहास से बनाया गया। चोट या विशेष ज़रूरत होने पर यह कोच का विकल्प नहीं है।',
};

const ruKeys = {
  'generator.title': 'Сгенерировать тренировку',
  'generator.cardSubtitle': 'ИИ соберёт сессию по твоей истории',
  'generator.focus': 'Фокус',
  'generator.duration': 'Длительность',
  'generator.equipment': 'Оборудование',
  'generator.skill': 'Опыт',
  'generator.generate': 'Сгенерировать',
  'generator.regenerate': 'Сгенерировать заново',
  'generator.thinking': 'Собираем твою тренировку…',
  'generator.thinkingDesc': 'Читаем историю твоих тренировок.',
  'generator.use': 'Взять эту',
  'generator.loaded': 'Тренировка загружена — начинай!',
  'generator.disclaimer': 'Составлено по твоей истории тренировок за последние 60 дней. Не заменяет тренера, если у тебя травмы или особые требования.',
};

const trKeys = {
  'generator.title': 'Antrenman oluştur',
  'generator.cardSubtitle': 'Yapay zekâ geçmişinden bir seans kurar',
  'generator.focus': 'Odak',
  'generator.duration': 'Süre',
  'generator.equipment': 'Ekipman',
  'generator.skill': 'Deneyim',
  'generator.generate': 'Oluştur',
  'generator.regenerate': 'Yeniden oluştur',
  'generator.thinking': 'Antrenmanın hazırlanıyor…',
  'generator.thinkingDesc': 'Antrenman geçmişin okunuyor.',
  'generator.use': 'Bunu kullan',
  'generator.loaded': 'Antrenman yüklendi — başla!',
  'generator.disclaimer': 'Son 60 günlük antrenman geçmişine göre kişiselleştirildi. Sakatlığın veya özel bir ihtiyacın varsa bir antrenörün yerini tutmaz.',
};

const plKeys = {
  'generator.title': 'Wygeneruj trening',
  'generator.cardSubtitle': 'AI ułoży sesję na podstawie twojej historii',
  'generator.focus': 'Nacisk',
  'generator.duration': 'Czas trwania',
  'generator.equipment': 'Sprzęt',
  'generator.skill': 'Doświadczenie',
  'generator.generate': 'Generuj',
  'generator.regenerate': 'Generuj ponownie',
  'generator.thinking': 'Układam twój trening…',
  'generator.thinkingDesc': 'Czytam historię twoich treningów.',
  'generator.use': 'Użyj tego',
  'generator.loaded': 'Trening wczytany — do dzieła!',
  'generator.disclaimer': 'Spersonalizowane na podstawie twoich treningów z ostatnich 60 dni. Nie zastępuje trenera, jeśli masz kontuzje lub szczególne potrzeby.',
};

const nlKeys = {
  'generator.title': 'Training genereren',
  'generator.cardSubtitle': 'AI stelt een sessie samen uit je historie',
  'generator.focus': 'Focus',
  'generator.duration': 'Duur',
  'generator.equipment': 'Apparatuur',
  'generator.skill': 'Ervaring',
  'generator.generate': 'Genereren',
  'generator.regenerate': 'Opnieuw genereren',
  'generator.thinking': 'Je training wordt samengesteld…',
  'generator.thinkingDesc': 'Je trainingshistorie wordt gelezen.',
  'generator.use': 'Deze gebruiken',
  'generator.loaded': 'Training geladen — aan de slag!',
  'generator.disclaimer': 'Gepersonaliseerd op basis van je trainingen van de afgelopen 60 dagen. Geen vervanging voor een coach als je blessures of bijzondere behoeften hebt.',
};

export const generatorI18n = {
  en: enKeys, es: esKeys, fr: frKeys, de: deKeys, pt: ptKeys, ja: jaKeys,
  it: itKeys, ko: koKeys, zh: zhKeys, ar: arKeys, hi: hiKeys,
  ru: ruKeys, tr: trKeys, pl: plKeys, nl: nlKeys,
};
