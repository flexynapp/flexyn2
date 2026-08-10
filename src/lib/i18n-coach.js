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


  // Data-driven replies. Multi-line ones are ONE key — see the note above.
  'coach.reply.train.today': 'You already trained today — solid. If you have energy left, a short 20-min cardio or core session would be a great cap.',
  'coach.reply.train.yesterday': "You trained yesterday — today's a good day to push.",
  'coach.reply.train.gap': "It's been {n} days. Time to get back in. Start with something you enjoy to lower the activation energy.",
  'coach.reply.train.untouched': "**Train these next:** {groups} — you haven't touched them this week.",
  'coach.reply.train.under': '**Train these next:** {groups} — under-trained vs. {most} this week.',
  'coach.reply.train.close': 'Pick a regimen from the Workout tab, or build a quick session yourself. Aim for 4–6 exercises and 45 minutes.',
  'coach.reply.progress.title': '**Last 7 days:**',
  'coach.reply.progress.volume': '• {volume} lb total volume ({delta}%)',
  'coach.reply.progress.workoutStreak': '• {n}-day workout streak (best: {best})',
  'coach.reply.progress.loginStreak': '• {n}-day login streak',
  'coach.reply.progress.nothing': "You haven't logged anything this week. The hardest part of progress is showing up — start with one set.",
  'coach.reply.progress.dip': "Slight dip from last week. Either you're deloading on purpose, or life got busy. Both are fine — just don't string two low weeks back-to-back.",
  'coach.reply.progress.up': "You're trending up. Keep the discipline; volume increase like this compounds.",
  'coach.reply.progress.down': "Volume dropped meaningfully. If you're not fatigued or deloading, push intensity next session.",
  'coach.reply.progress.steady': "Steady. Consistency beats intensity over months — you're doing the right thing.",
  'coach.reply.overload.needData': "I need at least 3 sessions of recent data to give you a real answer. Log a few workouts first.",
  'coach.reply.overload.noRepeat': "I don't see a single exercise repeated 3+ times in your recent log. Repeat a lift across several sessions and I'll have something concrete to say.",
  'coach.reply.overload.yesTitle': '**Yes — bump your {lift} weight.**',
  'coach.reply.overload.yesBody': "You hit {weight} lb for {reps} reps across the last 3 sessions. That's the textbook signal: same weight, stable reps in the 8+ range.",
  'coach.reply.overload.yesNext': "Try {next} lb next time, aiming for 5–8 reps. If form holds, you're locked in.",
  'coach.reply.overload.almostTitle': '**Almost — keep grinding {lift} a bit longer.**',
  'coach.reply.overload.almostBody': "You're at {weight} lb for {reps} reps. Get to 8+ reps consistently before adding weight.",
  'coach.reply.overload.notYetTitle': '**Not yet on {lift}.**',
  'coach.reply.overload.notYetBody': 'Your top sets recently were {weights} lb at {reps} reps — not stable enough to add weight. Lock in {weight} lb at 8+ reps for 3 sessions, then push.',
  'coach.reply.sore.noTraining': "Soreness without recent training is unusual — could be sleep, stress, or another activity. Hydrate, walk for 20 min, and check back in tomorrow.",
  'coach.reply.sore.whatever': 'whatever you trained',
  'coach.reply.sore.intro': "Soreness in **{part}** is normal 24–48h after a hard session — that's DOMS, not damage.",
  'coach.reply.consistency.headline': 'Last 30 days: **{n} workout days** ({pct}%).',
  'coach.reply.consistency.top': "You're crushing it. 4+ workouts a week consistently is in the top 5% of any fitness app's user base.",
  'coach.reply.consistency.solid': "Solid — roughly 3x/week. That's enough volume to make real progress.",
  'coach.reply.consistency.showing': "You're showing up. Try to add one more session per week. Pick the day before you check this — log it tomorrow.",
  'coach.reply.consistency.low': "Currently inconsistent. Don't aim for perfect — aim for 2 sessions this week. Lock in the habit before optimizing the program.",
  'coach.reply.prs.none': "No workouts logged yet — log a few sessions and I'll surface your PRs.",
  'coach.reply.prs.noWeights': "I see workouts but no weighted lifts — bodyweight progress is real, but I can't surface PRs without weights.",
  'coach.reply.prs.title': '**Your top 5 PRs:**',
  'coach.reply.prs.row': '• {name}: {weight} lb × {reps} ({date})',
  'coach.reply.weak.title': '**Last 14 days, by sets:**',
  'coach.reply.weak.row': '• {group}: {n}',
  'coach.reply.weak.untrained': "You haven't trained **{groups}** at all in 14 days. Schedule them this week.",
  'coach.reply.weak.underdosed': 'Underdosed: **{group}**. Add an extra session targeting it.',
  'coach.reply.cardio.over': "You've logged **{n} min of cardio** in the last 7 days — exceeds the WHO 150 min/week recommendation. Optional: 1 short session as active recovery.",
  'coach.reply.cardio.mid': '**{n} min** logged this week. Adding ~75 more minutes hits the WHO weekly target. Two 30-min sessions would do it.',
  'coach.reply.cardio.low': 'Only **{n} min** of cardio this week. Aim for 150 min/week for cardiovascular health. A 25-min walk every other day gets you there.',
  'coach.reply.goals.signIn': "Sign in to see your goals.",
  'coach.reply.goals.none': "No active goals. Open the Goals modal to set a PR target — having a number to chase changes how you train.",
  'coach.reply.goals.targetWeight': '{n} lb',
  'coach.reply.goals.targetReps': '{n} reps',
  'coach.reply.goals.row': '• {name} → {target}',
  'coach.reply.goals.unnamed': 'Goal',
  'coach.reply.goals.error': "Couldn't load your goals — try opening the Goals modal directly.",
  'coach.reply.streak.signIn': "Sign in to see your streaks.",
  'coach.reply.streak.workoutNone': '💪 Workout streak: 0. Train today to start one.',
  'coach.reply.streak.league': '🏆 League: **{tier}**',
  'coach.reply.greeting.hot': "Welcome back! {n} days of workout streak — you're on fire 🔥. What's on your mind today?",
  'coach.reply.greeting.streak': 'Good to see you. Day {n} workout streak — keep it alive. What can I help with?',
  'coach.reply.unknown.asked': 'You asked: "{q}". Rephrasing might help, or pick a question above.',
  'coach.reply.recovery.score': 'Recovery: {score}/100 — {label}',
  'coach.reply.recovery.lastNight': 'Last night: {hours}h{quality}',
  'coach.reply.recovery.quality': ' (quality {q}/5)',
  'coach.reply.recovery.noSleep': 'No sleep log yet today — log it to sharpen this score.',
  'coach.reply.recovery.trainedToday': 'You trained today — light recovery work is the right move.',
  'coach.reply.recovery.hard': 'Hit it hard. Take a PR shot today.',
  'coach.reply.recovery.planned': 'Train as planned. Save the heaviest lift for later in the session.',
  'coach.reply.recovery.cap': 'Train, but cap intensity — leave 1-2 reps in reserve.',
  'coach.reply.recovery.mobility': 'Consider a mobility day or a light cardio session.',
  'coach.reply.sleep.none': "I don't have a sleep log for you today yet. Tap the sleep card on the Dashboard to record last night.",
  'coach.reply.sleep.logged': 'Logged: {hours}h{quality}',
  'coach.reply.sleep.soreness': 'Soreness: {n}/5',
  'coach.reply.sleep.solid': "Solid duration. You're set up for a good session.",
  'coach.reply.sleep.decent': 'Decent. Caffeine + protein early helps.',
  'coach.reply.sleep.short': 'Short night — favor technique over loading today.',

  // Count-driven keys, whose call sites build the suffix from an expression.
  'coach.reply.train.count.one':      "**You've trained {n} time in the last 7 days.**",
  'coach.reply.train.count.other':    "**You've trained {n} times in the last 7 days.**",
  'coach.reply.progress.workouts.one':   '• {n} workout ({delta} vs prev week)',
  'coach.reply.progress.workouts.other': '• {n} workouts ({delta} vs prev week)',
  'coach.reply.goals.title.one':      '**You have {n} active goal:**',
  'coach.reply.goals.title.other':    '**You have {n} active goals:**',
  'coach.reply.streak.workout.one':   '💪 Workout streak: **{n} day** (best: {best})',
  'coach.reply.streak.workout.other': '💪 Workout streak: **{n} days** (best: {best})',
  'coach.reply.streak.login.one':     '🔥 Login streak: **{n} day**',
  'coach.reply.streak.login.other':   '🔥 Login streak: **{n} days**',
  'coach.reply.recovery.sinceWorkout.one':   '{n} day since last workout.',
  'coach.reply.recovery.sinceWorkout.other': '{n} days since last workout.',


  // ── Onboarding coach (src/lib/aiCoach/onboardingCoach.js) ───────────────
  // TODO(i18n): English only, per the no-machine-translation rule.
  //
  // Covers the step intros and starter prompts, and the `recommend` / `skip`
  // / `free` branches — the replies that infer from what someone typed, plus
  // the `apply.label` on the button they tap to accept one.
  //
  // The label maps (goal / level / activity / nutrition-goal) are keys
  // because they are interpolated INTO those replies: leaving them English
  // would put a raw English noun inside a translated sentence, which is the
  // failure this whole series exists to remove.
  //
  // Still literal: several multi-line `explain` bodies whose text lives in a
  // joined array rather than a single literal. They are the same mechanical
  // shape as the ones above and need no structural work.
  'coach.onboarding.fallbackIntro': "Ask me anything about this step — or tell me about yourself and I'll fill it in.",
  'coach.onboarding.goal.inferred': 'That reads as **{goals}**. You can tick more than one — the plan blends them rather than picking a winner, so a strength + lose-fat combination keeps the bar heavy and takes the volume down instead of turning every session into cardio.',
  'coach.onboarding.goal.apply': 'Select {goals}',
  'coach.onboarding.level.inferred': 'Sounds like **{level}** — {why}.',
  'coach.onboarding.level.apply': 'Select {level}',
  'coach.onboarding.days.noteRunner': ' Since you picked a running goal, these are the days the plan has something scheduled — easy runs can sit on the gaps without counting against recovery.',
  'coach.onboarding.days.noteRest': ' The rest days between sessions are doing real work; a muscle grows on the day off, not the day you trained it.',
  'coach.onboarding.days.reply': "For **{level}**, {count} days a week is the honest answer — enough to progress, few enough that a busy week doesn't break the streak. **{days}** spreads them out.{note}\n\nPick whatever actually fits your week instead, though. The schedule you keep beats the schedule that's optimal.",
  'coach.onboarding.days.levelUnknown': 'where you are now',
  'coach.onboarding.days.apply': 'Select {days}',
  'coach.onboarding.target.down': 'down',
  'coach.onboarding.target.up': 'up',
  'coach.onboarding.target.reply': '{lbs} lb {dir} at a sustainable **{rate} lb/week** is about **{weeks} weeks** — roughly {date}.\n\nYou can set a nearer date, but the app will clamp the daily calories at a floor rather than take you somewhere unsafe, so a very aggressive date mostly just makes the projection wrong.',
  'coach.onboarding.target.apply': 'Set target date to {date}',
  'coach.onboarding.nutritionGoal.reply': '**{goal}** it is.{tail}',
  'coach.onboarding.nutritionGoal.apply': 'Select {goal}',
  'coach.onboarding.activity.tailSedentary': " Don't feel bad about it — most people sit for work, and picking it honestly gets you a target that works rather than one that quietly stalls.",
  'coach.onboarding.activity.reply': "That's **{level}**.{tail}",
  'coach.onboarding.activity.apply': 'Select {level}',
  'coach.onboarding.goalLabel.strength': 'Build strength',
  'coach.onboarding.goalLabel.muscle': 'Add muscle',
  'coach.onboarding.goalLabel.lose': 'Lose fat',
  'coach.onboarding.goalLabel.speed': 'Run faster',
  'coach.onboarding.goalLabel.endurance': 'Run further',
  'coach.onboarding.goalLabel.mobility': 'Move better',
  'coach.onboarding.levelLabel.newbie': 'New',
  'coach.onboarding.levelLabel.returning': 'Returning',
  'coach.onboarding.levelLabel.consistent': 'Consistent',
  'coach.onboarding.levelLabel.advanced': 'Advanced',
  'coach.onboarding.activityLabel.sedentary': 'Sedentary',
  'coach.onboarding.activityLabel.light': 'Lightly active',
  'coach.onboarding.activityLabel.moderate': 'Moderately active',
  'coach.onboarding.activityLabel.very': 'Very active',
  'coach.onboarding.activityLabel.extra': 'Extra active',
  'coach.onboarding.nutritionGoalLabel.lose': 'Lose weight',
  'coach.onboarding.nutritionGoalLabel.maintain': 'Maintain weight',
  'coach.onboarding.nutritionGoalLabel.gain': 'Gain weight',
  'coach.onboarding.level.why.newbie': 'we start light and spend the first weeks on form, which is what makes the later jumps possible',
  'coach.onboarding.level.why.returning': 'we ramp gently — coming back at your old numbers is the single most common way people get hurt in week one',
  'coach.onboarding.level.why.consistent': 'real progressive overload and periodization from the start',
  'coach.onboarding.level.why.advanced': 'specificity and training blocks, because the easy gains are already banked',
  'coach.onboarding.nutritionGoal.tail.lose': "Protein goes up while you're in a deficit — that's what keeps the weight you lose from including muscle.",
  'coach.onboarding.nutritionGoal.tail.gain': 'Slow is the whole trick here — a big surplus adds fat faster than it adds muscle.',
  'coach.onboarding.nutritionGoal.tail.maintain': 'Maintenance is also the right pick if you want to recomp: same weight, better composition.',
  'coach.onboarding.welcome.intro': "I'm your coach. I'll be here on every step — ask me what a question means, or just describe yourself and I'll fill it in.",
  'coach.onboarding.welcome.prompt.what': 'What is this setup for?',
  'coach.onboarding.welcome.prompt.long': 'How long does it take?',
  'coach.onboarding.welcome.explain': "The next few questions set your starting loads, how many days a week you train, and what the plan optimizes for. It takes about two minutes, and nothing here is permanent — all of it is editable later from your profile.",
  'coach.onboarding.goal.intro': "What are you actually here for? Tell me in your own words if it's easier — I'll turn it into the right picks.",
  'coach.onboarding.goal.prompt.which': 'Which goal should I pick?',
  'coach.onboarding.goal.prompt.multi': 'Can I pick more than one?',
  'coach.onboarding.sharpen.prompt.which': 'Which of these should I choose?',
  'coach.onboarding.sharpen.explain': "This is the specific version of the goal you already picked. It decides things like whether your plan leans toward heavy triples or toward volume — a real difference in what you'll be doing on a Tuesday, so it's worth answering honestly rather than ambitiously.",
  'coach.onboarding.experience.intro': "How much training does your body have behind it? This sets your starting weights, so honest beats optimistic here.",
  'coach.onboarding.experience.prompt.which': 'Which one am I?',
  'coach.onboarding.experience.prompt.between': "I'm between two of these",
  'coach.onboarding.experience.prompt.why': 'Why does this matter?',
  'coach.onboarding.experience.explain': "It sets the loads you start at, and nothing else. Aim too high and your first sessions are too heavy to complete with good form; aim low and you spend one extra week ramping. When in doubt, go lower — the plan raises the weight as soon as you're finishing sets easily.",
  'coach.onboarding.age.intro': "Age and a username. Ask me anything about why these are here.",
  'coach.onboarding.age.prompt.why': 'Why do you need my age?',
  'coach.onboarding.age.prompt.name': 'Can I change my username later?',
  'coach.onboarding.height.intro': "Height. Quick one.",
  'coach.onboarding.height.prompt.why': 'Why do you need my height?',
  'coach.onboarding.height.explain': "Height and weight together give your BMR, which is what every calorie target in the Nutrition tab is built on. Without it those targets are a generic guess. Switch between ft/in and cm with the toggle.",
  'coach.onboarding.weight.intro': "Your current weight — the starting point everything else is measured from.",
  'coach.onboarding.weight.prompt.why': 'Why do you need my weight?',
  'coach.onboarding.weight.prompt.unsure': "I don't know it exactly",
  'coach.onboarding.weight.explain': "Two jobs: your calorie targets, and your starting loads for bodyweight-relative lifts. A close estimate is fine — you can update it any time, and progress is tracked from wherever you actually start.",
  'coach.onboarding.days.prompt.howmany': 'How many days should I train?',
  'coach.onboarding.days.explain': "This sets how your plan is split. Three days is usually full-body; four or five moves to an upper/lower or push/pull split. Rest days aren't idle time — the adaptation happens on them.",
  'coach.onboarding.assessment.intro': "A few benchmarks. 'Not yet' is an answer, not a failure — it just tells me where to start you.",
  'coach.onboarding.assessment.prompt.unsure': "I don't know if I can do these",
  'coach.onboarding.assessment.explain': "They're calibration, not a test. Each one is a rough marker of relative strength, and together they tell the plan whether to start you at the light end or the middle of the range for your experience level.",
  'coach.onboarding.injury.intro': "Anything currently injured or bothering you? This is the one step I'd really rather you didn't skip.",
  'coach.onboarding.injury.explain': "Anything you log here gets pulled out of your plan, along with the muscles that work with it — flag a shoulder and the plan drops chest and triceps work too, because they load the same joint. Without it you'll be handed an Overhead Press on a shoulder that can't do one.",
  'coach.onboarding.home_gym.intro': "Where do you train? Picking your gym puts you on its leaderboard with the people who actually train there.",
  'coach.onboarding.home_gym.prompt.nofind': "I can't find my gym",
  'coach.onboarding.home_gym.explain': "It gives you the board for your gym — ranked by how many days a week people show up, not by how much they lift, so it's a board a beginner can actually place on. You can change it later from Profile → My Gym.",
  'coach.onboarding.home_gym.prompt.change': 'Can I change it later?',
  'coach.onboarding.goal.prompt.recomp': 'Can I lose fat and gain muscle?',
  'coach.onboarding.goal.explain': "**Lose** puts you under maintenance, **Gain** puts you over, **Maintain** sits at it. The macros shift too — protein goes up in a deficit specifically to protect the muscle you already have.",
  'coach.onboarding.target.intro': "Target weight and a date. I can work out a date that's actually reachable — just ask.",
  'coach.onboarding.target.prompt.date': 'What date should I set?',
  'coach.onboarding.target.prompt.fast': 'Is 2 lb a week too fast?',
  'coach.onboarding.target.prompt.safe': "What's a safe rate?",
  'coach.onboarding.target.explain': "The gap between where you are and where you want to be, divided by the weeks between now and your date, is your weekly rate — and that rate is what sets your daily calories. A closer date means a steeper deficit.",
  'coach.onboarding.activity.intro': "How active is a normal day for you? Describe it and I'll pick the level.",
  'coach.onboarding.activity.prompt.which': 'Which level am I?',
  'coach.onboarding.activity.prompt.count': 'Does my workout count?',
  'coach.onboarding.activity.explain': "This multiplies your BMR into a daily burn, and it's the single biggest lever on your calorie target — one level out is a few hundred calories a day. Count your whole day, not just the gym: a nurse on their feet for twelve hours out-burns a desk worker who lifts four times a week.",
  'coach.onboarding.restrictions.intro': "Anything you don't eat? This shapes what I suggest later on.",
  'coach.onboarding.restrictions.prompt.skip': 'Can I skip this?',
  'coach.onboarding.restrictions.explain': "It filters every food suggestion in the app — meal ideas, the fuelling notes on your workout card, all of it. Set it here and you stop having to mentally discard half of what you're shown.",
  'coach.onboarding.allergens.intro': "Allergens. Worth being thorough with this one.",
  'coach.onboarding.allergens.prompt.custom': "My allergy isn't listed",
  'coach.onboarding.allergens.explain': "Allergens are kept separate from preferences because they're treated harder: nothing the coach suggests will name a food that hits one, and if a combination rules out everything it can name, it drops to plain macros rather than guessing at something.",
  'coach.onboarding.preview.intro': "Your targets. Ask me where any of these numbers came from.",
  'coach.onboarding.preview.prompt.protein': 'Why this much protein?',
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
