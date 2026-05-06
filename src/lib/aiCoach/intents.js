// src/lib/aiCoach/intents.js
//
// Pattern-based intent detection for the AI Coach. The coach is rule-based
// at its core — these intents cover ~85% of common fitness questions.
// Anything that doesn't match falls through to a "here's what I can help with"
// menu so users always get a useful response.
//
// Each intent returns { id, score, params } where score is a confidence
// number; the highest-scoring match wins.

export const INTENTS = {
  WHAT_TO_TRAIN:    'what_to_train',
  PROGRESS_CHECK:   'progress_check',
  SHOULD_INCREASE:  'should_increase_weight',
  SORENESS:         'soreness',
  CONSISTENCY:      'consistency',
  PRS:              'prs',
  WEAK_AREAS:       'weak_areas',
  CARDIO_SUGGEST:   'cardio_suggestion',
  REST_DAY:         'rest_day',
  NUTRITION_TIP:    'nutrition_tip',
  HYDRATION:        'hydration',
  GOAL_STATUS:      'goal_status',
  STREAK_STATUS:    'streak_status',
  PLATEAU:          'plateau',
  GREETING:         'greeting',
  HELP:             'help',
  UNKNOWN:          'unknown',
};

/**
 * Score how well the user's message matches each intent. Returns the top
 * match, with `params` extracted from the message where applicable.
 */
export function detectIntent(message) {
  if (!message || typeof message !== 'string') return { id: INTENTS.UNKNOWN, score: 0, params: {} };
  const m = message.toLowerCase().trim();
  if (m.length === 0) return { id: INTENTS.UNKNOWN, score: 0, params: {} };

  const candidates = [];

  // What to train today
  for (const re of [
    /\bwhat (should|do|to)\s*(i|me)?\s*(train|workout|do|lift|hit)\s*(today|now)?\b/,
    /\b(today'?s|today is)\s*(workout|training|session)\b/,
    /\b(workout|train|gym)\s*(suggestion|idea|recommendation|today)\b/,
    /\bhelp me (pick|choose|decide)\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.WHAT_TO_TRAIN, score: 9 });

  // Progress check
  for (const re of [
    /\bhow (am i|are things|is it|is my) (doing|going|progressing)\b/,
    /\bhow is my (training|workout|progress|week|month)\b/,
    /\b(progress|how|am i)\s*(doing|making)\s*(progress|gain|gains)?\b/,
    /\b(weekly|month|monthly) (recap|summary|review|report)\b/,
    /\bhow has my\s*(week|month|training|workout)\s*(been|gone)\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.PROGRESS_CHECK, score: 9 });

  // Should I increase weight
  for (const re of [
    /\b(should|can|time to) (i )?(increase|add|bump|raise|go up|push)\b/,
    /\bready (to|for) (heavier|more weight|next weight)\b/,
    /\bhow much (should|do) i (lift|weight|squat|bench|deadlift)\b/,
    /\b(am i|is it) (ready|time)\s*(to)?\s*(progress|move up|go heavier)\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.SHOULD_INCREASE, score: 9 });

  // Soreness / recovery
  for (const re of [
    /\b(i'?m|i am|feeling|so)\s*(sore|tight|achy|stiff|tired|exhausted)\b/,
    /\bmuscle\s*(soreness|pain|ache)\b/,
    /\b(can'?t|cannot|hard to) (move|walk|train)\b/,
    /\bdoms\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.SORENESS, score: 9 });

  // Consistency / habits
  for (const re of [
    /\b(am i|how) consistent\b/,
    /\bhow often (am i|do i) (work out|train|exercise)\b/,
    /\bworkout (frequency|consistency)\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.CONSISTENCY, score: 8 });

  // PRs
  for (const re of [
    /\b(my|recent|new|all)?\s*pr(s|'s)?\b/,
    /\bpersonal\s+(record|best)s?\b/,
    /\b(best|max|heaviest)\s+(lift|squat|bench|deadlift|press)/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.PRS, score: 8 });

  // Weak areas
  for (const re of [
    /\b(weak|weakest|under(trained|worked))\s*(spot|area|muscle|group)?\b/,
    /\bwhat (am i|do i) neglect(ing)?\b/,
    /\b(what|which) muscles?\s*(am i|do i|need|are)/,
    /\b(skip|missed|neglected|skipping)\s+(legs|leg day|chest|back|arms)\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.WEAK_AREAS, score: 9 });

  // Cardio
  for (const re of [
    /\b(should i|do i need to|how much) (do |run|jog|cardio)\b/,
    /\bcardio (suggestion|advice|recommend|amount)\b/,
    /\b(run|jog|bike|walk)\s*(today|tomorrow|now)\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.CARDIO_SUGGEST, score: 8 });

  // Rest day
  for (const re of [
    /\b(should i|do i need to|need a) rest\b/,
    /\brest day\b/,
    /\btake (a|the) day off\b/,
    /\bskip (today|workout)\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.REST_DAY, score: 8 });

  // Nutrition
  for (const re of [
    /\b(eat|food|meal|protein|carb|fat|calorie)s?\b/,
    /\bwhat (should|to) (eat|i eat|eat)\b/,
    /\b(meal|nutrition|diet) (idea|suggestion|tip|advice)\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.NUTRITION_TIP, score: 6 });

  // Hydration
  for (const re of [
    /\b(water|hydration|hydrate|drink)\b/,
    /\bhow much (water|fluid)\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.HYDRATION, score: 7 });

  // Goal status
  for (const re of [
    /\b(my )?goal(s)?\b/,
    /\bhow close (am i|to)\b/,
    /\bon track\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.GOAL_STATUS, score: 7 });

  // Streak
  for (const re of [
    /\bstreak\b/,
    /\b(how long|days) (have i|in a row)\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.STREAK_STATUS, score: 7 });

  // Plateau — score 10 because patterns like "can't break my PR" semantically
  // mean "I'm plateaued", and we don't want PRs intent to win on coincidence.
  for (const re of [
    /\bplateau(ed|ing)?\b/,
    /\b(stuck|stalled|not progressing)\b/,
    /\bcan'?t (break|push past|get past)\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.PLATEAU, score: 10 });

  // Greeting
  for (const re of [
    /^\s*(hi|hey|hello|yo|sup|good (morning|afternoon|evening))\s*$/,
    /^\s*(hi|hey|hello|yo) coach\b/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.GREETING, score: 10 });

  // Help / capabilities
  for (const re of [
    /\b(what can|help|how do)\b/,
    /\bwhat (do|can) you (do|know|help|answer)\b/,
    /^\s*\?+\s*$/,
  ]) if (re.test(m)) candidates.push({ id: INTENTS.HELP, score: 5 });

  if (candidates.length === 0) {
    return { id: INTENTS.UNKNOWN, score: 0, params: { raw: message } };
  }

  // Pick the highest-scoring match (ties broken by order in this file)
  candidates.sort((a, b) => b.score - a.score);
  return { ...candidates[0], params: { raw: message } };
}
