import { asT } from './coachI18n';
import { formatList, formatDate } from '@/lib/intlFormat';
// src/lib/aiCoach/onboardingCoach.js
//
// The AI Coach, for people who don't have any data yet.
//
// The main coach (coach.js → intents.js → responders.js) answers questions
// ABOUT a training history: PRs, streaks, weak areas, "how was my week".
// During onboarding none of that exists — the user hasn't logged a set and
// in the initial flow doesn't even have a profile row yet — so every one of
// those responders would answer with an empty-state apology. The questions
// people actually have here are a different shape:
//
//   "which of these should I pick?"   "what does 16:8 mean?"
//   "am I a beginner or returning?"   "is 2 lb a week too fast?"
//
// So this module answers per-STEP rather than per-intent. It knows what the
// current step is asking, what the user has answered so far, and — the part
// that makes it worth having — it can hand back an `apply` payload so the
// answer becomes the selection instead of something the user has to go and
// re-enter themselves.
//
// Pure: no I/O, no React, and NO `@/api/db` import (see CLAUDE.md, Profile
// cache). Context flows in; the caller owns the draft and the writes.

/* ═══════════════════════════════════════════════════════════════
   STEP IDS
   Namespaced because both flows have a step called "goal" and they
   mean different things (training goal vs calorie goal).
═══════════════════════════════════════════════════════════════ */

export const OB = {
  WELCOME:    'welcome',
  GOAL:       'goal',
  SHARPEN:    'sharpen',
  EXPERIENCE: 'experience',
  AGE:        'age',
  HEIGHT:     'height',
  WEIGHT:     'weight',
  DAYS:       'days',
  ASSESSMENT: 'assessment',
  INJURY:     'injury_history',
  HOME_GYM:   'home_gym',
  LOADING:    'loading',
  REVEAL:     'reveal',
};

export const NUT = {
  GOAL:         'nutrition_goal',
  TARGET:       'nutrition_target',
  ACTIVITY:     'nutrition_activity',
  RESTRICTIONS: 'nutrition_restrictions',
  ALLERGENS:    'nutrition_allergens',
  PREVIEW:      'nutrition_preview',
};

/** Nutrition modal step index → step id. Its steps are numeric. */
export const NUTRITION_STEP_IDS = [
  NUT.GOAL, NUT.TARGET, NUT.ACTIVITY, NUT.RESTRICTIONS, NUT.ALLERGENS, NUT.PREVIEW,
];

/* ═══════════════════════════════════════════════════════════════
   FREE-TEXT INFERENCE
   Users describe themselves ("I sit at a desk all day and want to
   drop 20 lbs") far more often than they ask a clean question, so
   the describe-yourself path has to be first-class, not a fallback.
═══════════════════════════════════════════════════════════════ */

// Label maps carry keys; `lbl()` below resolves one with the caller's
// translator. They are interpolated INTO replies, so leaving them English
// would put raw English nouns inside a translated sentence.
const lbl = (T, keys, map, k) => T(keys[k], map[k] || k);

const GOAL_LABEL_KEYS = Object.fromEntries(
  ['strength','muscle','lose','speed','endurance','mobility'].map(k => [k, `coach.onboarding.goalLabel.${k}`]),
);
const LEVEL_LABEL_KEYS = Object.fromEntries(
  ['newbie','returning','consistent','advanced'].map(k => [k, `coach.onboarding.levelLabel.${k}`]),
);
const ACTIVITY_LABEL_KEYS = Object.fromEntries(
  ['sedentary','light','moderate','very','extra'].map(k => [k, `coach.onboarding.activityLabel.${k}`]),
);
const NUTRITION_GOAL_LABEL_KEYS = Object.fromEntries(
  ['lose','maintain','gain'].map(k => [k, `coach.onboarding.nutritionGoalLabel.${k}`]),
);

const GOAL_LABELS = {
  strength:  'Build strength',
  muscle:    'Add muscle',
  lose:      'Lose fat',
  speed:     'Run faster',
  endurance: 'Run further',
  mobility:  'Move better',
};

// Ordered: the first pattern that hits wins for that goal id, and a message
// can match several goals (people genuinely want two or three).
// Words that mean a goal HERE, not merely in English.
//
// Several of these used to be bare tokens that carry a completely different
// sense in an ordinary sentence, and the step acted on them:
//
//   "I'm heavy right now"        → Build strength   (heavy = their bodyweight)
//   "I only have half an hour"   → Run further      (half = half-marathon)
//   "how much longer does this take?" → Run further (longer = duration)
//   "my schedule is tight"       → Move better      (tight = busy)
//   "cut down on my gym time"    → Lose fat         (cut = reduce)
//
// So the ambiguous ones now require the context that disambiguates them:
// `heavy` needs something to lift, `half` needs a marathon, `pace` needs a
// run, `tight` needs a body part. `longer` is gone outright — endurance is
// already covered by distance/further/stamina/marathon, and no phrasing of
// "longer" reliably means it.
const GOAL_PATTERNS = [
  ['lose',      /\b(lose|losing|shed|slim|leaner?|lean out|body ?fat|belly|tone|toned|weight loss|cutting|drop (?:weight|fat|lb|kg|pounds)|cut (?:weight|fat|down to))\b/],
  ['muscle',    /\b(muscle|bigger|size|mass|hypertrophy|bulk|bulking|jacked|fill out|put on)\b/],
  ['strength',  /\b(strong|stronger|strength|powerlift|1 ?rm|max out|heavy (?:weights?|lifts?|squats?|bench|deadlifts?|bars?|sets?|days?)|lift(?:ing)? heavy|heavier (?:weights?|bars?|lifts?))\b/],
  ['speed',     /\b(faster|speed|sprint|quicker|mile time|5 ?k time|(?:run|running|mile|race) pace|pace (?:per|for) )\b/],
  ['endurance', /\b(endurance|distance|further|farther|stamina|marathon|10 ?k|conditioning)\b/],
  ['mobility',  /\b(mobility|mobile|flexib|stiff|posture|longevity|pain[- ]free|range of motion|tight (?:hips?|hamstrings?|shoulders?|back|calves|calf|hip flexors?|chest|quads?)|(?:hips?|hamstrings?|shoulders?|back|calves|quads?)(?: are| is| feel| feels)? tight)\b/],
];

// "I don't want to bulk up" named a goal and meant the opposite of picking it.
// Nothing looked for the negation, so the step answered "That reads as **Add
// muscle**" and offered a button that would select it.
//
// A match is dropped when a negator sits just before it. The window is short
// so a negation can't leak across a clause — "I don't want to lose weight, I
// want to get stronger" must still infer strength.
//
// This suppresses more than it should in one case: "no more belly fat" reads
// as negated when the user does want that goal. That direction is the right
// one to fail in — the cost is the generic list instead of a pre-selection,
// where the cost of the old behaviour was asserting the opposite of what
// someone just told you and offering to act on it.
const NEGATORS = /\b(?:don'?t|do not|dont|not|no|never|avoid|rather not|isn'?t|ain'?t|without|stop|quit)\b/;
const NEGATION_WINDOW = 28;

/** Every training goal the message points at, most-confident first. */
export function inferGoals(message) {
  const m = String(message || '').toLowerCase();
  return GOAL_PATTERNS
    .filter(([, re]) => {
      const hit = re.exec(m);
      if (!hit) return false;
      // Check the words immediately before the match, not the whole message,
      // so one negated clause can't cancel a goal named in another.
      const before = m.slice(Math.max(0, hit.index - NEGATION_WINDOW), hit.index);
      return !NEGATORS.test(before);
    })
    .map(([id]) => id);
}

const LEVEL_LABELS = {
  newbie:     'New',
  returning:  'Returning',
  consistent: 'Consistent',
  advanced:   'Advanced',
};

/**
 * Experience level from a description.
 *
 * `returning` is tested BEFORE `consistent` and `advanced` on purpose:
 * "I lifted for three years but stopped in 2023" contains both "years" and
 * "stopped", and the answer that serves that person is Returning — starting
 * them at their old numbers is how people get hurt in week one.
 */
export function inferLevel(message) {
  const m = String(message || '').toLowerCase();
  // Every way people say "I stopped for a while". The long-tail matters
  // more than usual here because the alternative reading of the same
  // sentence is `advanced` — "I lifted for 4 years but took 2 years off"
  // contains "4 years", and answering Advanced to that person starts them
  // at loads their body hasn't seen since before the break.
  if (/\b(coming back|came back|getting back|back (in)?to|returning|coming off|took [^.]{0,24}off|took [^.]{0,24}break|\d+\s*(year|month|week)s?\s*off|(stopped|quit|paused)\s+(lifting|training|working out|going|for)|hiatus|been (a while|out|away|off)|out of the gym|used to|haven'?t (trained|lifted|worked out|been) (in|for)|after [^.]{0,24}(break|injury|layoff))\b/.test(m)) return 'returning';
  if (/\b(never|no experience|complete beginner|total beginner|just start|starting out|first time|new to (this|lifting|the gym)|day one)\b/.test(m)) return 'newbie';
  if (/\b(advanced|experienced|plateau|competitive|compete|coach(ed)?|\d{2,}\s*years|[3-9]\+?\s*years|many years|decade)\b/.test(m)) return 'advanced';
  if (/\b(consistent|regularly|couple (of )?years|1-2 years|[6-9]\s*months|1[0-9]\s*months|a year|two years|2\s*years)\b/.test(m)) return 'consistent';
  if (/\b([0-5]\s*months|few months|couple (of )?months|less than (6|six))\b/.test(m)) return 'newbie';
  return null;
}

const ACTIVITY_LABELS = {
  sedentary: 'Sedentary',
  light:     'Lightly active',
  moderate:  'Moderately active',
  very:      'Very active',
  extra:     'Extra active',
};

/** Daily-activity level from a description of the user's day. */
export function inferActivity(message) {
  const m = String(message || '').toLowerCase();
  if (/\b(twice a day|2x (a )?day|two[- ]a[- ]days|athlete|physical job|labou?r|construction|training for a marathon)\b/.test(m)) return 'extra';
  if (/\b(very active|6[- ]7|six|every day|daily|5[- ]6|nurse|server|on my feet all day|warehouse)\b/.test(m)) return 'very';
  if (/\b(moderate|3[- ]5|three|four|few times a week|3x|4x)\b/.test(m)) return 'moderate';
  if (/\b(light|1[- ]3|once or twice|twice a week|2x (a )?week|some walking|walk)\b/.test(m)) return 'light';
  if (/\b(desk|office|sedentary|sit(ting)? (all day|at a desk)|barely|hardly|no exercise|not (very )?active|couch)\b/.test(m)) return 'sedentary';
  return null;
}

const NUTRITION_GOAL_LABELS = { lose: 'Lose weight', maintain: 'Maintain weight', gain: 'Gain weight' };

/** Calorie goal from a description. */
export function inferNutritionGoal(message) {
  const m = String(message || '').toLowerCase();
  if (/\b(lose|losing|drop|shed|cut|cutting|deficit|slim|leaner?|weight loss|body ?fat)\b/.test(m)) return 'lose';
  if (/\b(gain|gaining|bulk|bulking|surplus|put on|add weight|mass|bigger)\b/.test(m)) return 'gain';
  if (/\b(maintain|maintenance|stay|same weight|recomp|hold)\b/.test(m)) return 'maintain';
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   QUESTION SHAPE
═══════════════════════════════════════════════════════════════ */

const ASKS_RECOMMENDATION = /\b(which|what) (should|do|would|one)|how (many|much) (should|do)|recommend|suggest|help me (pick|choose|decide)|pick for me|choose for me|not sure|unsure|no idea|don'?t know|dunno|i'?m stuck|you (pick|choose|decide)|best for me\b/i;
const ASKS_EXPLANATION    = /\b(what (is|are|does|do)|what'?s|explain|mean(s|ing)?|difference between|why (do|are) you|why does|how does|tell me about)\b/i;
const ASKS_SKIP           = /\b(skip|do i have to|can i (skip|leave|come back)|is (this|it) (required|optional|necessary)|later)\b/i;

/* ═══════════════════════════════════════════════════════════════
   PER-STEP KNOWLEDGE

   Each entry supplies:
     intro(draft)    — the greeting shown when the sheet opens
     prompts(draft)  — tappable starter questions
     explain(draft)  — answer to "what does this mean / why ask"
     recommend(draft, message) — { reply, apply? }
     skip(draft)     — answer to "can I skip this"
     free(message, draft) — step-specific handling of a description

   `apply` is { field, value, label }. The host maps `field` onto its own
   state; nothing here knows how the draft is stored.
═══════════════════════════════════════════════════════════════ */

const listGoals = (ids) => (ids || []).map(id => GOAL_LABELS[id]).filter(Boolean);

function goalRecommendation(draft, message, t, language = 'en') {
  const T = asT(t);
  const inferred = inferGoals(message);
  if (inferred.length) {
    const picked = inferred.slice(0, 3);
    const names = picked.map(k => lbl(T, GOAL_LABEL_KEYS, GOAL_LABELS, k));
    return {
      reply: T('coach.onboarding.goal.inferred',
        'That reads as **{goals}**. You can tick more than one. The plan blends them rather than picking a winner, so a strength + lose-fat combination keeps the bar heavy and takes the volume down instead of turning every session into cardio.',
        { goals: formatList(names, language) }),
      // `apply.label` is on a button the user taps, so it needs the same
      // treatment as the reply — it was the one user-visible string in this
      // module that is not prose.
      apply: {
        field: 'goal', value: picked,
        label: T('coach.onboarding.goal.apply', 'Select {goals}', { goals: names.join(' + ') }),
      },
    };
  }
  return {
    reply: T('coach.onboarding.goal.menu', [
      'Pick by the outcome you want six months from now, not by what you think you should say:',
      '',
      '• **Build strength** — heavy compounds, low reps. Numbers on the bar go up.',
      '• **Add muscle** — more sets in the 6–12 range. Size goes up.',
      '• **Lose fat** — the training keeps your strength; the deficit does the fat loss.',
      '• **Run faster** — intervals and tempo work.',
      '• **Run further** — easy volume, built up gradually.',
      '• **Move better** — mobility and range of motion.',
      '',
      'Tick as many as apply — the plan averages them. Four or more and progress on each one gets slow, which is the only reason to hold back.',
      '',
      "If you'd rather just tell me what you're after in your own words, do that and I'll set it for you.",
    ].join('\n')),
  };
}

function levelRecommendation(draft, message, t, language = 'en') {
  const T = asT(t);
  const inferred = inferLevel(message);
  if (inferred) {
    const why = T(`coach.onboarding.level.why.${inferred}`, {
      newbie:     'we start light and spend the first weeks on form, which is what makes the later jumps possible',
      returning:  'we ramp gently. Coming back at your old numbers is the single most common way people get hurt in week one',
      consistent: 'real progressive overload and periodization from the start',
      advanced:   'specificity and training blocks, because the easy gains are already banked',
    }[inferred]);
    const name = lbl(T, LEVEL_LABEL_KEYS, LEVEL_LABELS, inferred);
    return {
      reply: T('coach.onboarding.level.inferred', 'Sounds like **{level}**: {why}.', { level: name, why }),
      apply: {
        field: 'level', value: inferred,
        label: T('coach.onboarding.level.apply', 'Select {level}', { level: name }),
      },
    };
  }
  return {
    reply: T('coach.onboarding.level.menu', [
      'Go by what your body is used to right now, not by what you once managed:',
      '',
      '• **New** — under 6 months of lifting.',
      '• **Returning** — you have trained before but have had a break.',
      '• **Consistent** — 6–24 months of fairly regular training.',
      '• **Advanced** — 2+ years, and your lifts are near a plateau.',
      '',
      "When you're between two, take the lower one. It only affects your starting loads, and starting lighter costs you about a week — starting too heavy can cost you a month.",
      '',
      'Tell me roughly how long you have been training and I will set it.',
    ].join('\n')),
  };
}

// Indices into Onboarding's WEEKDAYS, which is MONDAY-first: 0 = Mon, 6 = Sun.
// Not the JS Date convention. Assuming Sunday-first here shipped a coach that
// said "Mon, Wed, Fri" and then selected Tue, Thu, Sat — the reply and the
// grid disagreed, which is worse than giving no suggestion at all. If these
// ever move, DAY_NAMES below must move with them.
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_SPREADS = {
  2: [1, 4],           // Tue, Fri
  3: [0, 2, 4],        // Mon, Wed, Fri
  4: [0, 1, 3, 4],     // Mon, Tue, Thu, Fri
  5: [0, 1, 2, 4, 5],  // Mon, Tue, Wed, Fri, Sat
};

// Monday-first localized weekday abbreviations. 2024-01-01 was a Monday, so
// offsetting from it keeps DAY_SPREADS' Monday-first indices meaningful in
// every locale. DAY_NAMES above stays as the English fallback.
function dayNames(language) {
  const monday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return formatDate(d, language, { weekday: 'short' });
  });
}

function daysRecommendation(draft, message, t, language = 'en') {
  const T = asT(t);
  const level = draft?.level;
  const goals = Array.isArray(draft?.goal) ? draft.goal : (draft?.goal ? [draft.goal] : []);
  const count = level === 'advanced' ? 5 : level === 'consistent' ? 4 : 3;
  const spread = DAY_SPREADS[count];
  const runner = goals.includes('speed') || goals.includes('endurance');
  const note = runner
    ? T('coach.onboarding.days.noteRunner',
        'Since you picked a running goal, these are the days the plan has something scheduled. Easy runs can sit on the gaps without counting against recovery.')
    : T('coach.onboarding.days.noteRest',
        ' The rest days between sessions are doing real work; a muscle grows on the day off, not the day you trained it.');
  const names = dayNames(language);
  // A day LIST, not a conjunction — "Mon, Wed, and Fri" reads wrong on a
  // schedule, and the label has to match the reply exactly (the comment
  // above DAY_NAMES explains what happens when they disagree).
  const dayList = spread.map(i => names[i] || DAY_NAMES[i]).join(', ');
  return {
    reply: T('coach.onboarding.days.reply',
      "For **{level}**, {count} days a week is the honest answer. Enough to progress, few enough that a busy week doesn't break the streak. **{days}** spreads them out.{note}\n\nPick whatever actually fits your week instead, though. The schedule you keep beats the schedule that's optimal.",
      {
        level: level
          ? lbl(T, LEVEL_LABEL_KEYS, LEVEL_LABELS, level)
          : T('coach.onboarding.days.levelUnknown', 'where you are now'),
        count, days: dayList, note,
      }),
    apply: {
      field: 'days', value: spread,
      label: T('coach.onboarding.days.apply', 'Select {days}', { days: dayList }),
    },
  };
}

/**
 * A target date that lands the user's goal at a sustainable rate.
 *
 * Loss is capped at 1% of bodyweight per week (and 2 lb absolute), gain at
 * 0.5 lb per week. Those are the rates where you keep muscle on the way down
 * and don't add mostly fat on the way up, and they're the same clamps
 * computePreview applies — so a date suggested here won't come back flagged
 * "too aggressive" two steps later.
 */
export function suggestTargetDate({ currentLbs, targetLbs, today = new Date() }) {
  const cur = Number(currentLbs);
  const tgt = Number(targetLbs);
  if (!Number.isFinite(cur) || !Number.isFinite(tgt) || cur <= 0 || tgt <= 0) return null;
  const delta = tgt - cur;
  if (Math.abs(delta) < 0.5) return null;
  const perWeek = delta < 0
    ? Math.min(cur * 0.01, 2)   // losing
    : 0.5;                       // gaining
  const weeks = Math.ceil(Math.abs(delta) / perWeek);
  const date = new Date(today.getTime());
  date.setDate(date.getDate() + weeks * 7);
  return { weeks, perWeek: Math.round(perWeek * 100) / 100, date, delta };
}

function targetRecommendation(draft, message, t, language = 'en') {
  const T = asT(t);
  const { currentLbs, targetLbs } = draft || {};
  const s = suggestTargetDate({ currentLbs, targetLbs });
  if (!s) {
    return {
      reply: T('coach.onboarding.target.noTarget', [
        'Put in the weight you want to reach and I will work out a date that gets you there without wrecking the process.',
        '',
        'The rates worth staying inside: about **1% of bodyweight per week** coming down, and about **0.5 lb per week** going up. Faster than that going down and you start losing muscle along with the fat; faster going up and most of what you add is fat.',
      ].join('\n')),
    };
  }
  const iso = `${s.date.getFullYear()}-${String(s.date.getMonth() + 1).padStart(2, '0')}-${String(s.date.getDate()).padStart(2, '0')}`;
  // `toLocaleDateString(undefined, …)` read the BROWSER's locale, not the
  // app's — the defect intlFormat exists to stop, and it appeared twice in
  // this one function.
  const longDate  = formatDate(s.date, language, { month: 'long', day: 'numeric', year: 'numeric' });
  const shortDate = formatDate(s.date, language, { month: 'short', day: 'numeric', year: 'numeric' });
  // "down"/"up" is a word inside a sentence, so it cannot stay a bare
  // ternary — several languages inflect the surrounding clause with it.
  const dir = s.delta < 0
    ? T('coach.onboarding.target.down', 'down')
    : T('coach.onboarding.target.up', 'up');
  return {
    reply: T('coach.onboarding.target.reply',
      '{lbs} lb {dir} at a sustainable **{rate} lb/week** is about **{weeks} weeks**: roughly {date}.\n\nYou can set a nearer date, but the app will clamp the daily calories at a floor rather than take you somewhere unsafe, so a very aggressive date mostly just makes the projection wrong.',
      { lbs: Math.abs(Math.round(s.delta)), dir, rate: s.perWeek, weeks: s.weeks, date: longDate }),
    apply: {
      field: 'targetDate', value: iso,
      label: T('coach.onboarding.target.apply', 'Set target date to {date}', { date: shortDate }),
    },
  };
}

const GUIDES = {
  /* ── Initial onboarding ───────────────────────────────────── */

  [OB.WELCOME]: {
    intro: (_d, T) => T('coach.onboarding.welcome.intro',
      "I'm your coach. I'll be here on every step. Ask me what a question means, or just describe yourself and I'll fill it in."),
    prompts: (_d, T) => [
      { id: 'what', text: T('coach.onboarding.welcome.prompt.what', 'What is this setup for?') },
      { id: 'long', text: T('coach.onboarding.welcome.prompt.long', 'How long does it take?') },
    ],
    explain: (_d, T) => T('coach.onboarding.welcome.explain',
      "The next few questions set your starting loads, how many days a week you train, and what the plan optimizes for. It takes about two minutes, and nothing here is permanent. All of it is editable later from your profile."),
  },

  [OB.GOAL]: {
    intro: (_d, T) => T('coach.onboarding.goal.intro',
      "What are you actually here for? Tell me in your own words if it's easier. I'll turn it into the right picks."),
    prompts: (_d, T) => [
      { id: 'which', text: T('coach.onboarding.goal.prompt.which', 'Which goal should I pick?') },
      { id: 'multi', text: T('coach.onboarding.goal.prompt.multi', 'Can I pick more than one?') },
      { id: 'diff',  text: T('coach.onboarding.goal.prompt.diff', "What's the difference between strength and muscle?") },
    ],
    explain: (_d, T) => T('coach.onboarding.goal.explainDiff',
      "**Strength** is about the number on the bar. Heavy, low reps. **Add muscle** is about size. More total sets in the 6–12 range. They overlap a lot, and picking both is completely normal; the plan blends them rather than choosing.\n\n**Lose fat** doesn't change your lifting much: the deficit does the fat loss, the training is what stops you losing muscle with it."),
    recommend: goalRecommendation,
    // Only claims the message when inference actually fires. Wiring
    // `goalRecommendation` in directly would swallow every question on this
    // step — it always returns a reply — so "what's the difference between
    // strength and muscle" would get the generic list instead of the answer.
    free: (message, draft, T, language) =>
      (inferGoals(message).length ? goalRecommendation(draft, message, T, language) : null),
  },

  [OB.SHARPEN]: {
    intro: (d, T) => T('coach.onboarding.sharpen.intro',
      "Narrowing down {goals}. Pick what matters most, or ask me and I'll talk you through them.",
      { goals: listGoals(d?.goal).join(' + ') || T('coach.onboarding.sharpen.yourGoal', 'your goal') }),
    prompts: (_d, T) => [
      { id: 'which', text: T('coach.onboarding.sharpen.prompt.which', 'Which of these should I choose?') },
      { id: 'why',   text: T('coach.onboarding.sharpen.prompt.why', 'Why does this matter?') },
    ],
    explain: (_d, T) => T('coach.onboarding.sharpen.explain',
      "This is the specific version of the goal you already picked. It decides things like whether your plan leans toward heavy triples or toward volume. A real difference in what you'll be doing on a Tuesday, so it's worth answering honestly rather than ambitiously."),
    recommend: (_d, _m, T) => ({
      reply: T('coach.onboarding.sharpen.recommend',
        "Pick the one you'd actually be pleased about in three months. If two of them feel equally good, take the one that needs less equipment or less time. You'll do it more often, and frequency is what makes any of this work."),
    }),
  },

  [OB.EXPERIENCE]: {
    intro: (_d, T) => T('coach.onboarding.experience.intro',
      "How much training does your body have behind it? This sets your starting weights, so honest beats optimistic here."),
    prompts: (_d, T) => [
      { id: 'which', text: T('coach.onboarding.experience.prompt.which', 'Which one am I?') },
      { id: 'between', text: T('coach.onboarding.experience.prompt.between', "I'm between two of these") },
      { id: 'why', text: T('coach.onboarding.experience.prompt.why', 'Why does this matter?') },
    ],
    explain: (_d, T) => T('coach.onboarding.experience.explain',
      "It sets the loads you start at, and nothing else. Aim too high and your first sessions are too heavy to complete with good form; aim low and you spend one extra week ramping. When in doubt, go lower. The plan raises the weight as soon as you're finishing sets easily."),
    recommend: levelRecommendation,
    free: (message, draft, T, language) =>
      (inferLevel(message) ? levelRecommendation(draft, message, T, language) : null),
  },

  [OB.AGE]: {
    intro: (_d, T) => T('coach.onboarding.age.intro',
      "Age and a username. Ask me anything about why these are here."),
    prompts: (_d, T) => [
      { id: 'why', text: T('coach.onboarding.age.prompt.why', 'Why do you need my age?') },
      { id: 'name', text: T('coach.onboarding.age.prompt.name', 'Can I change my username later?') },
    ],
    explain: (_d, T) => T('coach.onboarding.age.explain',
      "Age feeds two things: your calorie maths later on, and a small adjustment to rest periods. Recovery between sets genuinely takes longer as you get older, and the plan accounts for it rather than pretending otherwise. It isn't shown to anyone.\n\nYour username is the name other people see on leaderboards, and you can change it later in Profile."),
  },

  [OB.HEIGHT]: {
    intro: (_d, T) => T('coach.onboarding.height.intro',
      "Height. Quick one."),
    prompts: (_d, T) => [{ id: 'why', text: T('coach.onboarding.height.prompt.why', 'Why do you need my height?') }],
    explain: (_d, T) => T('coach.onboarding.height.explain',
      "Height and weight together give your BMR, which is what every calorie target in the Nutrition tab is built on. Without it those targets are a generic guess. Switch between ft/in and cm with the toggle."),
  },

  [OB.WEIGHT]: {
    intro: (_d, T) => T('coach.onboarding.weight.intro',
      "Your current weight. The starting point everything else is measured from."),
    prompts: (_d, T) => [
      { id: 'why', text: T('coach.onboarding.weight.prompt.why', 'Why do you need my weight?') },
      { id: 'unsure', text: T('coach.onboarding.weight.prompt.unsure', "I don't know it exactly") },
    ],
    explain: (_d, T) => T('coach.onboarding.weight.explain',
      "Two jobs: your calorie targets, and your starting loads for bodyweight-relative lifts. A close estimate is fine. You can update it any time, and progress is tracked from wherever you actually start."),
    free: (message, _d, T) => (
      /\b(don'?t know|not sure|unsure|no scale|estimate|roughly|about)\b/i.test(message)
      ? { reply: T('coach.onboarding.weight.freeEstimate',
          "Estimate it. Being 5 lb out changes your calorie target by about 25 kcal. Nothing you'd notice. Put your best guess in and correct it the first time you weigh yourself.") }
        : null
    ),
  },

  [OB.DAYS]: {
    intro: (d, T) => T('coach.onboarding.days.intro',
      'How many days a week can you realistically train?{hint}', {
        hint: d?.level
          ? T('coach.onboarding.days.introHint',
              "I've got a suggestion based on your experience level. Ask.")
          : '',
      }),
    prompts: (_d, T) => [
      { id: 'howmany', text: T('coach.onboarding.days.prompt.howmany', 'How many days should I train?') },
      { id: 'best',    text: T('coach.onboarding.days.prompt.best', 'Which days are best?') },
      { id: 'change',  text: T('coach.onboarding.days.prompt.change', 'Can I change this later?') },
    ],
    explain: (_d, T) => T('coach.onboarding.days.explain',
      "This sets how your plan is split. Three days is usually full-body; four or five moves to an upper/lower or push/pull split. Rest days aren't idle time. The adaptation happens on them."),
    recommend: daysRecommendation,
    free: (message, draft, T, language) => (
      /\b(\d)\s*(days?|x|times)\b/i.test(message) ? daysRecommendation(draft, message, T, language) : null
    ),
  },

  [OB.ASSESSMENT]: {
    intro: (_d, T) => T('coach.onboarding.assessment.intro',
      "A few benchmarks. 'Not yet' is an answer, not a failure. It just tells me where to start you."),
    prompts: (_d, T) => [
      { id: 'unsure', text: T('coach.onboarding.assessment.prompt.unsure', "I don't know if I can do these") },
      { id: 'why',    text: T('coach.onboarding.assessment.prompt.why', 'What are these for?') },
    ],
    explain: (_d, T) => T('coach.onboarding.assessment.explain',
      "They're calibration, not a test. Each one is a rough marker of relative strength, and together they tell the plan whether to start you at the light end or the middle of the range for your experience level."),
    recommend: (_d, _m, T) => ({
      reply: T('coach.onboarding.assessment.recommend',
        "If you're not sure, answer 'not yet'. Underestimating costs you one easy session; overestimating puts a bar on your back that you can't complete, which is both a worse workout and the riskier mistake."),
    }),
  },

  [OB.INJURY]: {
    intro: (_d, T) => T('coach.onboarding.injury.intro',
      "Anything currently injured or bothering you? This is the one step I'd really rather you didn't skip."),
    prompts: (_d, T) => [
      { id: 'why',  text: T('coach.onboarding.injury.prompt.why', 'Why does this matter?') },
      { id: 'skip', text: T('coach.onboarding.injury.prompt.skip', 'Can I skip this?') },
      { id: 'old',  text: T('coach.onboarding.injury.prompt.old', 'What about an old injury?') },
    ],
    explain: (_d, T) => T('coach.onboarding.injury.explain',
      "Anything you log here gets pulled out of your plan, along with the muscles that work with it. Flag a shoulder and the plan drops chest and triceps work too, because they load the same joint. Without it you'll be handed an Overhead Press on a shoulder that can't do one."),
    skip: (_d, _text, T) => ({ reply: T('coach.onboarding.injury.skip',
      "You can, and nothing breaks. But this is the one step where skipping has a real cost: an injury the plan doesn't know about is an injury it will program straight through. If you have anything at all, thirty seconds here is worth it.") }),
    free: (message, _d, T) => (
      /\b(old|past|healed|used to|years ago|fine now|recovered)\b/i.test(message)
      ? { reply: T('coach.onboarding.injury.freeOld',
          "If it's fully healed and doesn't bother you under load, leave it out. The exclusions are aggressive and you'd lose useful exercises for no reason. If it still talks to you on heavy days, log it as **Mild**. You can end it from Progress the moment it stops mattering.") }
        : null
    ),
  },

  [OB.HOME_GYM]: {
    intro: (_d, T) => T('coach.onboarding.home_gym.intro',
      "Where do you train? Picking your gym puts you on its leaderboard with the people who actually train there."),
    prompts: (_d, T) => [
      { id: 'why',    text: T('coach.onboarding.home_gym.prompt.why', 'Why pick a gym?') },
      { id: 'skip',   text: T('coach.onboarding.home_gym.prompt.skip', 'Can I skip this?') },
      { id: 'nofind', text: T('coach.onboarding.home_gym.prompt.nofind', "I can't find my gym") },
    ],
    explain: (_d, T) => T('coach.onboarding.home_gym.explain',
      "It gives you the board for your gym. Ranked by how many days a week people show up, not by how much they lift, so it's a board a beginner can actually place on. You can change it later from Profile → My Gym."),
    skip: (_d, _text, T) => ({ reply: T('coach.onboarding.gym.skip',
      "Yes, freely. It's a social feature. Nothing about your training plan depends on it, and you can pick one any time from Profile → My Gym.") }),
    free: (message, _d, T) => (
      /\b(can'?t find|not (there|listed|showing)|no results|missing|home gym|garage|my house)\b/i.test(message)
      ? { reply: T('coach.onboarding.gym.freeMissing',
          "Two things. If you train at home, skip this. It's for shared gyms. If it's a real gym that isn't listed, the lookup pulls from OpenStreetMap and sometimes just fails to answer; try again in a moment. Skipping now costs you nothing, and you can add it later from Profile → My Gym.") }
        : null
    ),
  },

  [OB.LOADING]:  {
    intro: (_d, T) => T('coach.onboarding.loading.intro', 'Building your plan. One moment.'),
  },
  [OB.REVEAL]:   {
    intro: (_d, T) => T('coach.onboarding.home_gym.intro',
      "Here's what I built. Ask me anything about it before you start."),
    prompts: (_d, T) => [
      { id: 'why',    text: T('coach.onboarding.home_gym.prompt.why', 'Why this plan?') },
      { id: 'change', text: T('coach.onboarding.home_gym.prompt.change', 'Can I change it later?') },
    ],
    explain: (_d, T) => T('coach.onboarding.home_gym.explain',
      "It's built from your goals, your experience level and the days you gave me, with anything you flagged as injured taken out. Nothing is locked — every session is editable, and the plan adjusts on its own as your logged sets tell it more."),
  },

  /* ── Nutrition onboarding ─────────────────────────────────── */

  [NUT.GOAL]: {
    intro: (_d, T) => T('coach.onboarding.goal.intro',
      "Losing, holding, or gaining? Describe what you're after and I'll set it."),
    prompts: (_d, T) => [
      { id: 'which', text: T('coach.onboarding.goal.prompt.which', 'Which goal should I pick?') },
      { id: 'recomp', text: T('coach.onboarding.goal.prompt.recomp', 'Can I lose fat and gain muscle?') },
    ],
    explain: (_d, T) => T('coach.onboarding.goal.explain',
      "**Lose** puts you under maintenance, **Gain** puts you over, **Maintain** sits at it. The macros shift too. Protein goes up in a deficit specifically to protect the muscle you already have."),
    recommend: (draft, message, T) => {
      const g = inferNutritionGoal(message);
      if (g) {
        const name = lbl(T, NUTRITION_GOAL_LABEL_KEYS, NUTRITION_GOAL_LABELS, g);
        // The trailing clause is its own key per branch rather than a
        // ternary spliced into a template — a translator needs the whole
        // sentence, and two of the three read very differently.
        const tail = T(`coach.onboarding.nutritionGoal.tail.${g}`, {
          lose: " Protein goes up while you're in a deficit — that's what keeps the weight you lose from including muscle.",
          gain: ' Slow is the whole trick here — a big surplus adds fat faster than it adds muscle.',
          maintain: ' Maintenance is also the right pick if you want to recomp: same weight, better composition.',
        }[g] || '');
        return {
          reply: T('coach.onboarding.nutritionGoal.reply', '**{goal}** it is.{tail}', { goal: name, tail }),
          apply: {
            field: 'goal', value: g,
            label: T('coach.onboarding.nutritionGoal.apply', 'Select {goal}', { goal: name }),
          },
        };
      }
      return {
        reply: T('coach.onboarding.nutritionGoal.recommend',
          "If you want to see a smaller number on the scale, pick **Lose**. If you're chasing size and strength and don't mind some weight coming with it, pick **Gain**. If you mostly want to look different at the same weight, pick **Maintain**: that's the recomp route, and it's the slowest of the three but the one you can hold indefinitely."),
      };
    },
  },

  [NUT.TARGET]: {
    intro: (_d, T) => T('coach.onboarding.target.intro',
      "Target weight and a date. I can work out a date that's actually reachable, just ask."),
    prompts: (_d, T) => [
      { id: 'date', text: T('coach.onboarding.target.prompt.date', 'What date should I set?') },
      { id: 'fast', text: T('coach.onboarding.target.prompt.fast', 'Is 2 lb a week too fast?') },
      { id: 'safe', text: T('coach.onboarding.target.prompt.safe', "What's a safe rate?") },
    ],
    explain: (_d, T) => T('coach.onboarding.target.explain',
      "The gap between where you are and where you want to be, divided by the weeks between now and your date, is your weekly rate, and that rate is what sets your daily calories. A closer date means a steeper deficit."),
    recommend: targetRecommendation,
    free: (message, draft, T) => (
      /\b(too fast|safe|realistic|aggressive|how (fast|quick)|rate|per week|a week)\b/i.test(message)
        ? {
          // One key for the whole block, not one per bullet — a translator
          // has to be free to reorder and rewrap a list.
          reply: T('coach.onboarding.target.rates', [
            'The rates that hold up:',
            '',
            '• **Losing** — up to about 1% of bodyweight per week, and no more than 2 lb. Past that you start losing muscle with the fat, and the hunger makes it hard to stick to anyway.',
            '• **Gaining** — about 0.5 lb per week. Faster and most of the extra is fat.',
            '',
            'Two pounds a week is fine at 250 lb and too fast at 140 lb — it depends on your bodyweight, which is exactly why the app works in percentages. Give me your target and I will suggest a date that lands inside those.',
          ].join('\n')),
        }
        : null
    ),
  },

  [NUT.ACTIVITY]: {
    intro: (_d, T) => T('coach.onboarding.activity.intro',
      "How active is a normal day for you? Describe it and I'll pick the level."),
    prompts: (_d, T) => [
      { id: 'which', text: T('coach.onboarding.activity.prompt.which', 'Which level am I?') },
      { id: 'count', text: T('coach.onboarding.activity.prompt.count', 'Does my workout count?') },
    ],
    explain: (_d, T) => T('coach.onboarding.activity.explain',
      "This multiplies your BMR into a daily burn, and it's the single biggest lever on your calorie target. One level out is a few hundred calories a day. Count your whole day, not just the gym: a nurse on their feet for twelve hours out-burns a desk worker who lifts four times a week."),
    recommend: (draft, message, T) => {
      const a = inferActivity(message);
      if (a) {
        const name = lbl(T, ACTIVITY_LABEL_KEYS, ACTIVITY_LABELS, a);
        const tail = a === 'sedentary'
          ? T('coach.onboarding.activity.tailSedentary',
              "Don't feel bad about it. Most people sit for work, and picking it honestly gets you a target that works rather than one that quietly stalls.")
          : '';
        return {
          reply: T('coach.onboarding.activity.reply', "That's **{level}**.{tail}", { level: name, tail }),
          apply: {
            field: 'activity', value: a,
            label: T('coach.onboarding.activity.apply', 'Select {level}', { level: name }),
          },
        };
      }
      return {
        reply: T('coach.onboarding.activity.recommend',
          "Roughly: **Sedentary** is a desk job with little else. **Lightly active** adds 1–3 sessions a week. **Moderately active** is 3–5. **Very active** is 6–7, or a job where you're on your feet. **Extra active** is manual labour or twice-a-day training.\n\nWhen you're between two, take the lower one. Overestimating your burn is the most common reason a deficit doesn't produce a loss."),
      };
    },
  },

  [NUT.RESTRICTIONS]: {
    intro: (_d, T) => T('coach.onboarding.restrictions.intro',
      "Anything you don't eat? This shapes what I suggest later on."),
    prompts: (_d, T) => [
      { id: 'skip', text: T('coach.onboarding.restrictions.prompt.skip', 'Can I skip this?') },
      { id: 'why',  text: T('coach.onboarding.restrictions.prompt.why', 'What does this change?') },
    ],
    explain: (_d, T) => T('coach.onboarding.restrictions.explain',
      "It filters every food suggestion in the app. Meal ideas, the fuelling notes on your workout card, all of it. Set it here and you stop having to mentally discard half of what you're shown."),
    skip: (_d, _text, T) => ({ reply: T('coach.onboarding.restrictions.skip',
      "Yes. It's optional and editable any time from the Nutrition tab. The only cost of skipping is that suggestions will occasionally name something you don't eat.") }),
  },

  [NUT.ALLERGENS]: {
    intro: (_d, T) => T('coach.onboarding.allergens.intro',
      "Allergens. Worth being thorough with this one."),
    prompts: (_d, T) => [
      { id: 'why',    text: T('coach.onboarding.allergens.prompt.why', 'Why is this separate?') },
      { id: 'custom', text: T('coach.onboarding.allergens.prompt.custom', "My allergy isn't listed") },
    ],
    explain: (_d, T) => T('coach.onboarding.allergens.explain',
      "Allergens are kept separate from preferences because they're treated harder: nothing the coach suggests will name a food that hits one, and if a combination rules out everything it can name, it drops to plain macros rather than guessing at something."),
    free: (message, _d, T) => (
      /\b(not listed|isn'?t (there|listed)|missing|custom|specific|only|other)\b/i.test(message)
      ? { reply: T('coach.onboarding.allergens.freeCustom',
          "Type it into the custom field. Free text works, and it's matched on the term you enter. Use the narrowest accurate word: 'shrimp' keeps the rest of the shellfish family available, where 'shellfish' takes all of it out.") }
        : null
    ),
  },

  [NUT.PREVIEW]: {
    intro: (_d, T) => T('coach.onboarding.preview.intro',
      "Your targets. Ask me where any of these numbers came from."),
    prompts: (_d, T) => [
      { id: 'how',     text: T('coach.onboarding.preview.prompt.how', 'How were these calculated?') },
      { id: 'protein', text: T('coach.onboarding.preview.prompt.protein', 'Why this much protein?') },
      { id: 'change',  text: T('coach.onboarding.preview.prompt.change', 'Can I change them later?') },
    ],
    explain: (_d, T) => T('coach.onboarding.macros.explain',
      "Height, weight, age and sex give your BMR via Mifflin–St Jeor. Your activity level multiplies that into a daily burn. Your goal and date shift it up or down from there.\n\nProtein is set per pound of bodyweight. Highest when you're cutting, because that's when the muscle is at risk. Fat gets a floor for hormone health, and carbs take whatever's left. All of it is editable later from Edit Goals."),
  },
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC API
═══════════════════════════════════════════════════════════════ */

// Inlined rather than held in a named constant: the no-bare-literals guard
// in coachI18n.test.js reads the source, and a constant passed to T() one
// line later is indistinguishable to it from a literal nobody wrapped.
const fallbackIntro = (T) => T('coach.onboarding.fallbackIntro',
  "Ask me anything about this step, or tell me about yourself and I'll fill it in.");

// Every GUIDES function takes the translator as its LAST argument. That is
// the least invasive shape available here: the guides are 73 closures inside
// one object literal, so a ctx parameter would have meant rewriting each
// signature AND each call, where an appended argument leaves the existing
// ones in place. `asT` makes an un-threaded caller render English, so the
// public API's `t` stays optional. See ./coachI18n.

/** Opening line when the coach sheet is opened on `stepId`. */
export function introFor(stepId, draft = {}, t) {
  const T = asT(t);
  const g = GUIDES[stepId];
  if (!g || typeof g.intro !== 'function') return fallbackIntro(T);
  return g.intro(draft, T);
}

/** Tappable starter questions for `stepId`. Never more than three. */
export function promptsFor(stepId, draft = {}, t) {
  const T = asT(t);
  const g = GUIDES[stepId];
  if (!g || typeof g.prompts !== 'function') return [];
  return g.prompts(draft, T).slice(0, 3);
}

/** True when this step has anything worth asking about. */
export function hasCoachFor(stepId) {
  return Boolean(GUIDES[stepId]);
}

/**
 * Answer a question asked on `stepId`.
 *
 * Returns `{ reply, apply }` where `apply` — when present — is a
 * `{ field, value, label }` the caller can turn into an actual selection.
 * Never throws and never returns an empty reply: a coach button that
 * sometimes produces nothing is worse than no coach button.
 */
export function answerOnboarding({ stepId, draft = {}, message, t, language = 'en' }) {
  const T = asT(t);
  const text = String(message || '').trim();
  const guide = GUIDES[stepId];

  if (!text) return { reply: introFor(stepId, draft, T) };
  if (!guide) return { reply: fallbackIntro(T) };

  // Order matters. A step-specific free-text handler goes first because
  // "I can't find my gym" and "is 2 lb a week too fast" both read as
  // questions to the generic matchers but have a much better specific
  // answer waiting for them.
  //
  // The one exception is a definition question, which has to reach
  // `explain` first: "what's the difference between strength and muscle?"
  // names two goals, so the goal step's inference matches it and would
  // otherwise answer a question about terminology by silently selecting
  // both of them.
  const isDefinitionQuestion = ASKS_EXPLANATION.test(text) && typeof guide.explain === 'function';
  if (!isDefinitionQuestion && typeof guide.free === 'function') {
    const hit = guide.free(text, draft, T, language);
    if (hit && hit.reply) return hit;
  }

  if (ASKS_SKIP.test(text) && typeof guide.skip === 'function') {
    return guide.skip(draft, text, T, language);
  }

  if (ASKS_RECOMMENDATION.test(text) && typeof guide.recommend === 'function') {
    return guide.recommend(draft, text, T, language);
  }

  if (ASKS_EXPLANATION.test(text) && typeof guide.explain === 'function') {
    return { reply: guide.explain(draft, T) };
  }

  // Not obviously a question — most likely the user describing themselves.
  // Try the recommender, which is where every inference lives.
  if (typeof guide.recommend === 'function') {
    const hit = guide.recommend(draft, text, T, language);
    if (hit && hit.reply) return hit;
  }

  if (typeof guide.explain === 'function') return { reply: guide.explain(draft, T) };
  return { reply: introFor(stepId, draft, T) };
}
