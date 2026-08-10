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

  // ── Generated plan notes (src/lib/aiCoach/trainingModifiers.js) ──────────
  //
  // TODO(i18n): English only, per the no-machine-translation rule. These are
  // advice sentences, not labels — a bad translation here tells someone the
  // wrong thing about training under a deficit or around ovulation, so they
  // need a native pass rather than a quick fill.
  //
  // Each of these is ALSO present as the tFallback fallback at its point of
  // use in trainingModifiers.js. That duplication is deliberate: the module
  // is pure and cannot reach this file, so the English has to travel with the
  // rule it belongs to. If you edit a sentence here, edit it there too.
  'coach.note.cycle.menstrual':  'Period week — starting ~5% lighter. If cramps or fatigue hit, drop a set; if you feel fine, ignore this and train as normal.',
  'coach.note.cycle.follicular': 'Follicular phase. Many people feel strongest here, but the evidence is mixed — go by how the warm-up sets move, not the calendar.',
  'coach.note.cycle.ovulation':  'Around ovulation, oestrogen peaks and ligaments sit a little laxer — take an extra warm-up set and be strict on knee tracking in squats, lunges and any landing.',
  'coach.note.cycle.luteal':     'Luteal phase — core temperature runs higher and the same weight can feel heavier. Longer rests are built in; judge the session on effort, not the number.',
  'coach.note.diet.lose':        'You are eating in a deficit, so this session trims a set and keeps the weight heavy — intensity is what protects strength while cutting.',
  'coach.note.diet.gain':        'You are eating in a surplus — there is room for an extra set.',
  'coach.note.feel.good':        'You said you feel good — nudged slightly heavier. Stop the set with a rep in reserve.',
  'coach.note.feel.rough':       'You said you feel rough — lighter, shorter and with more rest. Showing up counts; this still maintains.',
  'coach.note.goal.strength':    'Built for strength: lower reps, longer rests.',
  'coach.note.goal.muscle':      'Built for hypertrophy: moderate reps, moderate rests.',
  'coach.note.goal.lose':        'Built for a cut: slightly higher reps, tighter rests to keep the heart rate up.',
  'coach.note.goal.endurance':   'Built for endurance: higher reps, short rests.',
  'coach.note.goal.speed':       'Speed work: keep the bar moving fast and the rests short.',
  'coach.note.goal.mobility':    'Mobility is one of your goals — give the warm-up its full time and take the end-range positions slowly.',
  // {goals} is a locale-formatted list. Keep the placeholder — do NOT split
  // this into fragments joined with a comma; that is the bug the list
  // formatter exists to prevent.
  'coach.note.goal.blend':       'Balancing {goals} — reps and rests land between what each one would ask for on its own.',
  'coach.note.ageRest':          'Rest is {sec}s longer than the default — recovery between sets slows with age, and rushing it turns a strength session into a conditioning one.',
  // Goal labels, used only inside the blend sentence above.
  'coach.goal.strength.label':   'strength',
  'coach.goal.muscle.label':     'muscle',
  'coach.goal.lose.label':       'fat loss',
  'coach.goal.endurance.label':  'endurance',
  'coach.goal.speed.label':      'speed',
  'coach.goal.mobility.label':   'mobility',
  // Post-workout fuel. The food name is its own key so the sentence and the
  // food can be translated independently — word order differs.
  'coach.note.fuel.named':       'Refuel within a couple of hours — {food} works.',
  'coach.note.fuel.generic':     'Refuel within a couple of hours: a protein source and a carb source that fit your plan.',
  'coach.fuel.greek_yogurt_and_some_fruit': 'Greek yogurt and some fruit',
  'coach.fuel.chicken_and_rice':            'chicken and rice',
  'coach.fuel.eggs_and_toast':              'eggs and toast',
  'coach.fuel.salmon_and_potatoes':         'salmon and potatoes',
  'coach.fuel.a_tofu_rice_bowl':            'a tofu rice bowl',
  'coach.fuel.lentils_and_rice':            'lentils and rice',
  'coach.fuel.eggs_and_avocado':            'eggs and avocado',
  'coach.fuel.beef_and_sweet_potato':       'beef and sweet potato',
  'coach.fuel.chicken_and_avocado':         'chicken and avocado',
  // Daily check-in chips (rendered by WorkoutQuickGenerator).
  'coach.feel.good.label':  'Good',
  'coach.feel.good.hint':   'Strong, ready to push',
  'coach.feel.ok.label':    'OK',
  'coach.feel.ok.hint':     'Normal day',
  'coach.feel.rough.label': 'Rough',
  'coach.feel.rough.hint':  'Tired, sore or cramping',

  // ── Plan card chrome + evidence panel (components/coach/CoachPlanCard) ──
  // TODO(i18n): English only, per the no-machine-translation rule.
  'coach.plan.edit':          'Edit',
  'coach.plan.done':          'Done',
  'coach.plan.editAria':      'Edit workout',
  'coach.plan.editDoneAria':  'Finish editing workout',
  'coach.plan.fuel':          'Fuel your training',
  'coach.plan.save':          'Save as regimen',
  'coach.plan.saved':         'Saved to Regimens',
  'coach.plan.cancel':        'Cancel',
  'coach.plan.when':          'When are you doing this?',
  'coach.plan.timePassed':    'That time has passed',
  'coach.plan.remindMe':      'Remind me {day} at {time}',
  'coach.plan.exercise':      'exercise',
  'coach.plan.setLess':       'One less set of {name}',
  'coach.plan.setMore':       'One more set of {name}',
  'coach.plan.swapAria':      'Swap {name} for another {group}',
  'coach.plan.swapTitle':     'Swap for another {group}',
  'coach.plan.noAlternative': 'No alternative available',
  'coach.plan.remove':        'Remove {name}',
  // Evidence panel. Counts carry .one/.other — English is the only language
  // where appending an "s" is the plural rule.
  'coach.plan.evidence.title':            'What this is based on',
  'coach.plan.evidence.none':             'No logged sessions yet — weights are estimates',
  'coach.plan.evidence.summary.one':      '{n} logged session',
  'coach.plan.evidence.summary.other':    '{n} logged sessions',
  'coach.plan.evidence.fromHistory.one':  '{n} lift from your history',
  'coach.plan.evidence.fromHistory.other':'{n} lifts from your history',
  'coach.plan.evidence.log':              'Your training log',
  'coach.plan.evidence.logValue.one':     '{n} session in the last {days} days',
  'coach.plan.evidence.logValue.other':   '{n} sessions in the last {days} days',
  'coach.plan.evidence.mostRecent':       ', most recent {date}',
  'coach.plan.evidence.logNone':          'Nothing logged in the last {days} days',
  'coach.plan.evidence.weights':          'Weights from your own sets',
  'coach.plan.evidence.estimated':        'Estimated',
  'coach.plan.evidence.estimatedValue.one':   "{n} lift you haven't logged — sized from your bodyweight ({lbs} lb), experience ({level})",
  'coach.plan.evidence.estimatedValue.other': "{n} lifts you haven't logged — sized from your bodyweight ({lbs} lb), experience ({level})",
  'coach.plan.evidence.andAge':           ' and age ({age})',
  'coach.plan.evidence.adjustHint':       'Adjust on your first set and the next session uses your real number.',
  'coach.plan.evidence.bodyweight':       'Bodyweight',
  'coach.plan.evidence.bodyweightValue.one':   '{n} movement with no external load',
  'coach.plan.evidence.bodyweightValue.other': '{n} movements with no external load',
  'coach.plan.evidence.settings':         'Settings used',
  'coach.plan.evidence.excluded':         'Excluded for injury',
  // Schedule chips (src/lib/data/scheduledWorkouts.js). The two weekday
  // slots need no key — Intl already renders them in-language.
  'coach.schedule.today':    'Today',
  'coach.schedule.tomorrow': 'Tomorrow',
  'coach.schedule.morning':  'Morning',
  'coach.schedule.midday':   'Midday',
  'coach.schedule.evening':  'Evening',
  'coach.schedule.night':    'Night',

  // ── Rules-engine replies (src/lib/aiCoach/responders.js) ────────────────
  // TODO(i18n): English only. PARTIAL — the plumbing covers every responder
  // (each takes `t`), but only the replies below are extracted so far. The
  // rest are still literals in that file; converting one is a local change
  // that needs no structural work.
  //
  // Multi-line replies are ONE key each, not one per bullet. A translator
  // has to be free to reorder and rewrap, and a list assembled from
  // separately-translated fragments cannot be.
  'coach.reply.error':             'Hmm, something went wrong looking at your data. Try again in a moment.',
  'coach.reply.overload.needData': 'I need at least 3 sessions of recent data to give you a real answer. Log a few workouts first.',
  'coach.reply.overload.noRepeat': "I don't see a single exercise repeated 3+ times in your recent log. Repeat a lift across several sessions and I'll have something concrete to say.",
  'coach.reply.sore.noTraining':   'Soreness without recent training is unusual — could be sleep, stress, or another activity. Hydrate, walk for 20 min, and check back in tomorrow.',
  'coach.reply.prs.none':          "No workouts logged yet — log a few sessions and I'll surface your PRs.",
  'coach.reply.prs.noWeights':     "I see workouts but no weighted lifts — bodyweight progress is real, but I can't surface PRs without weights.",
  'coach.reply.goals.signIn':      'Sign in to see your goals.',
  'coach.reply.goals.none':        'No active goals. Open the Goals modal to set a PR target — having a number to chase changes how you train.',
  'coach.reply.goals.error':       "Couldn't load your goals — try opening the Goals modal directly.",
  'coach.reply.streak.signIn':     'Sign in to see your streaks.',
  'coach.reply.sleep.none':        "I don't have a sleep log for you today yet. Tap the sleep card on the Dashboard to record last night.",
  'coach.reply.greeting.hot':      "Welcome back! {n} days of workout streak — you're on fire 🔥. What's on your mind today?",
  'coach.reply.greeting.streak':   'Good to see you. Day {n} workout streak — keep it alive. What can I help with?',
  'coach.reply.rest.body':         '**Rest is when adaptation happens.** A few signals you should rest today:\n\n• Trained hard 3+ days in a row\n• Sleeping less than usual\n• Joints (not muscles) hurt\n• Resting heart rate elevated\n\nIf none of these, light activity — 20 min walk, 10 min mobility — beats sitting still. "Active rest" still counts.',
  'coach.reply.nutrition.body':    '**Three things that move the needle most:**\n\n• **Protein** at every meal — 0.7–1 g per lb of bodyweight per day\n• **Hit your calorie target** — under for fat loss, slight surplus for muscle gain\n• **Vegetables** at lunch and dinner — fiber, micros, fullness\n\nOpen the Nutrition tab to log a meal — even one logged meal trains the habit.',
  'coach.reply.hydration.body':    'Aim for **8 glasses (64 oz) of water minimum** per day, more if you sweat heavily.\n\nTap the Drink Water buttons in Nutrition — small wins compound. The Drink Water quest pays out coins for hitting 4 or 8 glasses.',
  'coach.reply.plateau.body':      "**Plateaus mean it's time to change a variable.** Pick one:\n\n• **Volume** — add an extra set or 2 to the stalled lift\n• **Intensity** — drop weight 10% and chase 2 more reps per set\n• **Frequency** — train the lift 2x/week instead of 1x\n• **Variation** — swap to a close cousin (back squat → front squat) for 3 weeks\n\nOne change at a time. Give it 3 weeks before judging.",
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
