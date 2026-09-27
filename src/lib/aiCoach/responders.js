import { asT, enT } from './coachI18n';
import { formatList, formatNumber, formatDate } from '@/lib/intlFormat';
// src/lib/aiCoach/responders.js
//
// Per-intent response generation. Each responder pulls live user data from
// Supabase, analyzes it, and crafts a personalized reply. The output is a
// markdown-ish string with line breaks; the chat UI renders it with simple
// whitespace-pre-wrap formatting.
//
// These are no longer the Coach's primary path — coach.js asks the
// `coach-chat` Edge Function first, and this router is what answers when that
// is unavailable (not deployed, no API key, offline, daily cap reached). It
// stays because the properties that made it the original choice still hold
// where it runs:
//   1. Zero per-message cost — works at any scale
//   2. Deterministic — same data → same advice
//   3. No API key required to ship
//   4. The advice is grounded in actual user data, not LLM hallucination
//
// buildCoachContext() at the bottom of this file assembles the same data into
// the digest the language model reads, so both paths describe one truth.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { db } from '@/api/db';
import { subDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { INTENTS } from './intents';
import { normalizeGoals, profileAge } from './trainingModifiers';
// listRecentSleepLogs is imported further down, beside the recovery
// responders that have always used it — imports hoist, so both call sites
// see it.
import { listRecentMoodLogs } from '@/lib/data/moodLogs';
import { listRecentStepLogs } from '@/lib/data/stepLogs';
import * as workoutLogs from '@/lib/data/workouts';
import * as cardioData from '@/lib/data/cardio';
import * as nutritionData from '@/lib/data/nutrition';
import * as bodyMetricsData from '@/lib/data/bodyMetrics';


// ── Log dates are calendar days, not instants ────────────────────────────────
//
// `workout_logs.date` is a bare YYYY-MM-DD: the day the user trained, in the
// timezone they trained in. `new Date('2026-08-07')` parses that as UTC
// midnight, which is the PREVIOUS local day for every user west of Greenwich
// — so "It's been N days" ran one day high, and a session logged today
// rendered as yesterday, for most of the userbase. `parseISO` reads a
// date-only string as local midnight, which is what the value means.
//
// Anything that is already a full timestamp still parses normally. Returns
// null rather than an Invalid Date so a bad row degrades to "no timing"
// instead of poisoning arithmetic downstream with NaN.
// `t` is threaded into every responder from askCoach's ctx and defaults to
// English — see ./coachI18n for why translation arrives as an argument in a
// module that must stay free of React.
function parseLogDate(value) {
  if (!value) return null;
  const d = typeof value === 'string' ? parseISO(value) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

const MUSCLE_GROUPS = {
  chest:    ['bench', 'chest', 'push-up', 'dip', 'fly', 'pec'],
  back:     ['row', 'pull-up', 'pulldown', 'deadlift', 'lat'],
  shoulders:['press', 'overhead', 'lateral', 'shoulder', 'ohp'],
  arms:     ['curl', 'tricep', 'bicep', 'extension', 'pushdown'],
  legs:     ['squat', 'lunge', 'leg press', 'leg curl', 'leg extension', 'rdl', 'calf'],
  core:     ['plank', 'crunch', 'sit-up', 'ab', 'leg raise'],
};

function classifyExercise(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const [group, kws] of Object.entries(MUSCLE_GROUPS)) {
    if (kws.some(kw => lower.includes(kw))) return group;
  }
  return null;
}

async function _fetchRecentWorkouts(userId, days = 14) {
  if (!userId) return [];
  const since = subDays(new Date(), days);
  try {
    const all = await workoutLogs.list(userId, 200);
    return (all || []).filter(w => { const d = parseLogDate(w.date); return d && d >= since; });
  } catch {
    return [];
  }
}

async function _fetchRecentCardio(userId, days = 14) {
  if (!userId) return [];
  const since = subDays(new Date(), days);
  try {
    const all = await cardioData.list(userId, 200);
    return (all || []).filter(l => { const d = parseLogDate(l.date); return d && d >= since; });
  } catch {
    return [];
  }
}

async function _fetchProfile(userId) {
  if (!userId) return null;
  const { data } = await safeSelect({
    columns: ['flex_coins', 'login_streak', 'workout_streak', 'longest_workout_streak', 'total_xp', 'league_tier'],
    build: (cols) => supabase
      .from('user_profiles')
      .select(cols)
      .eq('id', userId)
      .maybeSingle(),
  });
  return data;
}

// ── Responders ───────────────────────────────────────────────────────────────

async function whatToTrain({ user, t, language }) {
  const T = asT(t);
  const workouts = await _fetchRecentWorkouts(user?.id, 7);
  if (workouts.length === 0) {
    return T('coach.reply.train.none', [
      "👋 Looks like you haven't logged any workouts in the last 7 days.",
      '',
      '**Suggestion:** Start with a full-body session today — squat, bench, row, OHP, plank. 30–45 minutes is plenty.',
      '',
      'If you have a Regimen saved, just open it from the Workout tab and hit start.',
    ].join('\n'));
  }

  // Tally muscle groups touched in last 7 days
  const tally = { chest: 0, back: 0, shoulders: 0, arms: 0, legs: 0, core: 0 };
  for (const w of workouts) {
    for (const ex of w.exercises || []) {
      const grp = classifyExercise(ex.name);
      if (grp) tally[grp] += (ex.sets || []).length;
    }
  }

  const sorted = Object.entries(tally).sort((a, b) => a[1] - b[1]);
  const least = sorted.slice(0, 2).map(e => e[0]);
  const most  = sorted.slice(-1)[0];

  // Days since last workout
  const lastDate = workouts[0]?.date;
  const daysSince = parseLogDate(lastDate) ? differenceInCalendarDays(new Date(), parseLogDate(lastDate)) : 0;

  // Muscle-group names already ship in all 15 languages under
  // `muscleGroups.<key>` — CLAUDE.md's i18n section is explicit that a
  // second vocabulary would be two answers to one question.
  const group = (g) => T(`muscleGroups.${g}`, g);

  const lines = [
    T(`coach.reply.train.count.${workouts.length === 1 ? 'one' : 'other'}`,
      workouts.length === 1
        ? "**You've trained {n} time in the last 7 days.**"
        : "**You've trained {n} times in the last 7 days.**",
      { n: workouts.length }),
    '',
  ];

  if (daysSince === 0) {
    lines.push(T('coach.reply.train.today',
      'You already trained today. Solid. If you have energy left, a short 20-min cardio or core session would be a great cap.'));
  } else if (daysSince === 1) {
    lines.push(T('coach.reply.train.yesterday', "You trained yesterday. Today's a good day to push."));
  } else if (daysSince >= 3) {
    lines.push(T('coach.reply.train.gap',
      "It's been {n} days. Time to get back in. Start with something you enjoy to lower the activation energy.",
      { n: daysSince }));
  }

  lines.push('');
  if (least.every(g => tally[g] === 0)) {
    // `join(' and ')` / `join(' or ')` were English grammar hand-rolled into
    // a template. Intl supplies each locale's own conjunction and
    // disjunction — see 07d72977.
    lines.push(T('coach.reply.train.untouched',
      "**Train these next:** {groups}. You haven't touched them this week.",
      { groups: formatList(least.map(group), language) }));
  } else {
    lines.push(T('coach.reply.train.under',
      '**Train these next:** {groups}. Under-trained vs. {most} this week.',
      {
        groups: formatList(least.map(group), language, { type: 'disjunction' }),
        most: group(most[0]),
      }));
  }
  lines.push('');
  lines.push(T('coach.reply.train.close',
    'Pick a regimen from the Workout tab, or build a quick session yourself. Aim for 4–6 exercises and 45 minutes.'));
  return lines.join('\n');
}

async function progressCheck({ user, t, language }) {
  const T = asT(t);
  const [thisWeek, lastWeek, profile] = await Promise.all([
    _fetchRecentWorkouts(user?.id, 7),
    (async () => {
      const all = await _fetchRecentWorkouts(user?.id, 14);
      const cutoff = subDays(new Date(), 7);
      return all.filter(w => { const d = parseLogDate(w.date); return d && d < cutoff; });
    })(),
    _fetchProfile(user?.id),
  ]);

  const totalVolume = (logs) => {
    let v = 0;
    for (const w of logs) for (const ex of w.exercises || []) for (const s of ex.sets || []) {
      v += (Number(s.weight) || 0) * (Number(s.reps) || 0);
    }
    return v;
  };

  const v1 = totalVolume(thisWeek);
  const v2 = totalVolume(lastWeek);
  const delta = v2 > 0 ? Math.round(((v1 - v2) / v2) * 100) : (v1 > 0 ? 100 : 0);
  const sessionDelta = thisWeek.length - lastWeek.length;

  const signed = (n) => `${n >= 0 ? '+' : ''}${formatNumber(n, language)}`;

  const lines = [T('coach.reply.progress.title', '**Last 7 days:**')];
  lines.push(T(`coach.reply.progress.workouts.${thisWeek.length === 1 ? 'one' : 'other'}`,
    thisWeek.length === 1
      ? '• {n} workout ({delta} vs prev week)'
      : '• {n} workouts ({delta} vs prev week)',
    { n: formatNumber(thisWeek.length, language), delta: signed(sessionDelta) }));
  if (v1 > 0) {
    // This used to pass no language on the reasoning that the surrounding
    // "lb total volume" copy was English-only, so a localized number would
    // look mismatched. That copy is a key now, so the number follows it.
    lines.push(T('coach.reply.progress.volume', '• {volume} lb total volume ({delta}%)',
      { volume: formatNumber(v1, language), delta: signed(delta) }));
  }
  if (profile?.workout_streak > 0) {
    lines.push(T('coach.reply.progress.workoutStreak', '• {n}-day workout streak (best: {best})', {
      n: formatNumber(profile.workout_streak, language),
      best: formatNumber(profile.longest_workout_streak || profile.workout_streak, language),
    }));
  }
  if (profile?.login_streak > 0) {
    lines.push(T('coach.reply.progress.loginStreak', '• {n}-day login streak',
      { n: formatNumber(profile.login_streak, language) }));
  }

  lines.push('');
  if (thisWeek.length === 0) {
    lines.push(T('coach.reply.progress.nothing',
      "You haven't logged anything this week. The hardest part of progress is showing up. Start with one set."));
  } else if (sessionDelta < 0 && lastWeek.length > 0) {
    lines.push(T('coach.reply.progress.dip',
      "Slight dip from last week. Either you're deloading on purpose, or life got busy. Both are fine. Just don't string two low weeks back-to-back."));
  } else if (delta >= 5) {
    lines.push(T('coach.reply.progress.up',
      "You're trending up. Keep the discipline; volume increase like this compounds."));
  } else if (delta <= -10) {
    lines.push(T('coach.reply.progress.down',
      "Volume dropped meaningfully. If you're not fatigued or deloading, push intensity next session."));
  } else {
    lines.push(T('coach.reply.progress.steady',
      "Steady. Consistency beats intensity over months. You're doing the right thing."));
  }
  return lines.join('\n');
}

async function shouldIncrease({ user, t, language }) {
  const T = asT(t);
  const workouts = await _fetchRecentWorkouts(user?.id, 21);
  if (workouts.length < 3) {
    return T('coach.reply.overload.needData',
      "I need at least 3 sessions of recent data to give you a real answer. Log a few workouts first.");
  }

  // Group sets by exercise and look for the most-frequent compound
  const byExercise = {};
  for (const w of workouts) {
    for (const ex of w.exercises || []) {
      const name = ex.name?.trim();
      if (!name) continue;
      if (!byExercise[name]) byExercise[name] = [];
      byExercise[name].push({
        date: w.date,
        topSet: (ex.sets || []).reduce((best, s) => (
          (Number(s.weight) || 0) > (best?.weight || 0) ? { weight: Number(s.weight), reps: Number(s.reps) } : best
        ), null),
      });
    }
  }

  // Find an exercise with ≥3 sessions where top-set reps held or grew at the same weight
  const candidates = Object.entries(byExercise).filter(([, sessions]) => sessions.length >= 3);
  if (candidates.length === 0) {
    return T('coach.reply.overload.noRepeat',
      "I don't see a single exercise repeated 3+ times in your recent log. Repeat a lift across several sessions and I'll have something concrete to say.");
  }

  candidates.sort((a, b) => b[1].length - a[1].length);
  const [topName, sessions] = candidates[0];
  const recent3 = sessions.slice(0, 3); // already date-desc
  const weights = recent3.map(s => s.topSet?.weight || 0);
  const reps    = recent3.map(s => s.topSet?.reps || 0);
  const sameWeight = weights.every(w => w === weights[0] && w > 0);
  const repsHeld   = reps.every(r => r >= reps[reps.length - 1] && r >= 5);

  // A rep SEQUENCE ("8, 8, 7 reps") is not a conjunction list — "8, 8, and
  // 7" reads wrong — so these keep a plain comma and only the digits get
  // localized. See listFormatter.test.js for why Intl has no separator-only
  // list type to reach for here.
  const nums = (arr) => arr.map(v => formatNumber(v, language)).join(', ');
  const nextWeight = weights[0] + (weights[0] >= 200 ? 10 : weights[0] >= 100 ? 5 : 2.5);

  if (sameWeight && repsHeld && reps[0] >= 8) {
    return [
      T('coach.reply.overload.yesTitle', '**Yes, bump your {lift} weight.**', { lift: topName }),
      '',
      T('coach.reply.overload.yesBody',
        "You hit {weight} lb for {reps} reps across the last 3 sessions. That's the textbook signal: same weight, stable reps in the 8+ range.",
        { weight: formatNumber(weights[0], language), reps: nums(reps) }),
      '',
      T('coach.reply.overload.yesNext',
        "Try {next} lb next time, aiming for 5–8 reps. If form holds, you're locked in.",
        { next: formatNumber(nextWeight, language) }),
    ].join('\n');
  }
  if (sameWeight && repsHeld) {
    return [
      T('coach.reply.overload.almostTitle', '**Almost. Keep grinding {lift} a bit longer.**', { lift: topName }),
      '',
      T('coach.reply.overload.almostBody',
        "You're at {weight} lb for {reps} reps. Get to 8+ reps consistently before adding weight.",
        { weight: formatNumber(weights[0], language), reps: nums(reps) }),
    ].join('\n');
  }
  return [
    T('coach.reply.overload.notYetTitle', '**Not yet on {lift}.**', { lift: topName }),
    '',
    T('coach.reply.overload.notYetBody',
      'Your top sets recently were {weights} lb at {reps} reps. Not stable enough to add weight. Lock in {weight} lb at 8+ reps for 3 sessions, then push.',
      { weights: nums(weights), reps: nums(reps), weight: formatNumber(weights[0], language) }),
  ].join('\n');
}

async function soreness({ user, t, language }) {
  const T = asT(t);
  const recent = await _fetchRecentWorkouts(user?.id, 3);
  const last = recent[0];
  if (!last) {
    return T('coach.reply.sore.noTraining',
      "Soreness without recent training is unusual. Could be sleep, stress, or another activity. Hydrate, walk for 20 min, and check back in tomorrow.");
  }

  const lastGroups = new Set();
  for (const ex of last.exercises || []) {
    const grp = classifyExercise(ex.name);
    if (grp) lastGroups.add(grp);
  }
  const sorePart = lastGroups.size > 0
    ? formatList(Array.from(lastGroups).map(g => T(`muscleGroups.${g}`, g)), language)
    : T('coach.reply.sore.whatever', 'whatever you trained');

  return [
    T('coach.reply.sore.intro',
      "Soreness in **{part}** is normal 24–48h after a hard session, that's DOMS, not damage.",
      { part: sorePart }),
    '',
    T('coach.reply.sore.body', [
      '**What to do today:**',
      '• 20–30 min low-intensity cardio (zone 2 walk, easy bike) — pumps blood through the sore muscles',
      '• Hit 8+ glasses of water (you have a Drink Water quest — use it)',
      '• 5 min dynamic mobility for the sore area',
      '',
      'Skip lifting that area until soreness drops below "limits range of motion" levels. You can train un-sore body parts.',
    ].join('\n')),
  ].join('\n');
}

async function consistency({ user, t, language }) {
  const T = asT(t);
  const last30 = await _fetchRecentWorkouts(user?.id, 30);
  const days = new Set(last30.map(w => w.date));
  const ratio = days.size / 30;

  const lines = [T('coach.reply.consistency.headline',
    'Last 30 days: **{n} workout days** ({pct}%).',
    { n: formatNumber(days.size, language), pct: formatNumber(Math.round(ratio * 100), language) })];
  lines.push('');
  if (ratio >= 0.5) {
    lines.push(T('coach.reply.consistency.top',
      "You're crushing it. 4+ workouts a week consistently is in the top 5% of any fitness app's user base."));
  } else if (ratio >= 0.3) {
    lines.push(T('coach.reply.consistency.solid',
      "Solid. Roughly 3x/week. That's enough volume to make real progress."));
  } else if (ratio >= 0.15) {
    lines.push(T('coach.reply.consistency.showing',
      "You're showing up. Try to add one more session per week. Pick the day before you check this. Log it tomorrow."));
  } else {
    lines.push(T('coach.reply.consistency.low',
      "Currently inconsistent. Don't aim for perfect. Aim for 2 sessions this week. Lock in the habit before optimizing the program."));
  }
  return lines.join('\n');
}

async function prsResponder({ user, t, language }) {
  const T = asT(t);
  // Personal records by exercise: max single-set weight × reps
  const all = await _fetchRecentWorkouts(user?.id, 365);
  if (all.length === 0) return T('coach.reply.prs.none',
      "No workouts logged yet. Log a few sessions and I'll surface your PRs.");

  const prMap = {};
  for (const w of all) {
    for (const ex of w.exercises || []) {
      const name = ex.name?.trim();
      if (!name) continue;
      const top = (ex.sets || []).reduce((best, s) => (
        (Number(s.weight) || 0) > (best?.weight || 0) ? { weight: Number(s.weight), reps: Number(s.reps) } : best
      ), null);
      if (!top || top.weight <= 0) continue;
      if (!prMap[name] || top.weight > prMap[name].weight) {
        prMap[name] = { weight: top.weight, reps: top.reps, date: w.date };
      }
    }
  }
  const top5 = Object.entries(prMap)
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 5);
  if (top5.length === 0) return T('coach.reply.prs.noWeights',
      "I see workouts but no weighted lifts. Bodyweight progress is real, but I can't surface PRs without weights.");

  const lines = [T('coach.reply.prs.title', '**Your top 5 PRs:**')];
  for (const [name, pr] of top5) {
    // date-fns `format` binds no locale, so this printed "Aug 7" under a
    // fully-translated reply. Same defect the journal header had.
    lines.push(T('coach.reply.prs.row', '• {name}: {weight} lb × {reps} ({date})', {
      name,
      weight: formatNumber(pr.weight, language),
      reps: formatNumber(pr.reps, language),
      date: formatDate(parseLogDate(pr.date), language, { month: 'short', day: 'numeric' }),
    }));
  }
  return lines.join('\n');
}

async function weakAreas({ user, t, language }) {
  const T = asT(t);
  const last14 = await _fetchRecentWorkouts(user?.id, 14);
  const tally = { chest: 0, back: 0, shoulders: 0, arms: 0, legs: 0, core: 0 };
  for (const w of last14) {
    for (const ex of w.exercises || []) {
      const grp = classifyExercise(ex.name);
      if (grp) tally[grp] += (ex.sets || []).length;
    }
  }
  const sorted = Object.entries(tally).sort((a, b) => a[1] - b[1]);
  const least = sorted.slice(0, 2);
  const group = (g) => T(`muscleGroups.${g}`, g);
  const lines = [T('coach.reply.weak.title', '**Last 14 days, by sets:**')];
  for (const [g, n] of sorted) {
    lines.push(T('coach.reply.weak.row', '• {group}: {n}',
      { group: group(g), n: formatNumber(n, language) }));
  }
  lines.push('');
  if (least[0][1] === 0) {
    lines.push(T('coach.reply.weak.untrained',
      "You haven't trained **{groups}** at all in 14 days. Schedule them this week.",
      { groups: formatList(least.map(l => group(l[0])), language, { type: 'disjunction' }) }));
  } else {
    lines.push(T('coach.reply.weak.underdosed',
      'Underdosed: **{group}**. Add an extra session targeting it.',
      { group: group(least[0][0]) }));
  }
  return lines.join('\n');
}

async function cardioSuggest({ user, t, language }) {
  const T = asT(t);
  const cardio = await _fetchRecentCardio(user?.id, 7);
  const totalSec = cardio.reduce((s, c) => s + (Number(c.duration_seconds) || 0), 0);
  const totalMin = Math.round(totalSec / 60);

  const mins = formatNumber(totalMin, language);
  if (totalMin >= 150) {
    return T('coach.reply.cardio.over',
      "You've logged **{n} min of cardio** in the last 7 days. Exceeds the WHO 150 min/week recommendation. Optional: 1 short session as active recovery.",
      { n: mins });
  }
  if (totalMin >= 75) {
    return T('coach.reply.cardio.mid',
      '**{n} min** logged this week. Adding ~75 more minutes hits the WHO weekly target. Two 30-min sessions would do it.',
      { n: mins });
  }
  if (totalMin > 0) {
    return T('coach.reply.cardio.low',
      'Only **{n} min** of cardio this week. Aim for 150 min/week for cardiovascular health. A 25-min walk every other day gets you there.',
      { n: mins });
  }
  return T('coach.reply.cardio.none', [
    'No cardio logged in the last 7 days.',
    '',
    "**Easy starting point:** 20 min walk after a meal. That's it. You can scale up to running/biking when the habit's locked in.",
  ].join('\n'));
}

async function restDay({ t } = {}) {
  const T = asT(t);
  // One key for the whole block rather than one per line: a translator has
  // to be free to reorder and rewrap, and a bullet list assembled from
  // separately-translated fragments cannot be.
  return T('coach.reply.rest.body', [
    '**Rest is when adaptation happens.** A few signals you should rest today:',
    '',
    '• Trained hard 3+ days in a row',
    '• Sleeping less than usual',
    '• Joints (not muscles) hurt',
    '• Resting heart rate elevated',
    '',
    'If none of these, light activity — 20 min walk, 10 min mobility — beats sitting still. "Active rest" still counts.',
  ].join('\n'));
}

async function nutritionTip({ user, t, language }) {
  const T = asT(t);
  return T('coach.reply.nutrition.body', [
    '**Three things that move the needle most:**',
    '',
    '• **Protein** at every meal — 0.7–1 g per lb of bodyweight per day',
    '• **Hit your calorie target** — under for fat loss, slight surplus for muscle gain',
    '• **Vegetables** at lunch and dinner — fiber, micros, fullness',
    '',
    'Open the Nutrition tab to log a meal — even one logged meal trains the habit.',
  ].join('\n'));
}

async function hydration({ t } = {}) {
  const T = asT(t);
  return T('coach.reply.hydration.body', [
    'Aim for **8 glasses (64 oz) of water minimum** per day, more if you sweat heavily.',
    '',
    'Tap the Drink Water buttons in Nutrition — small wins compound. The Drink Water quest pays out coins for hitting 4 or 8 glasses.',
  ].join('\n'));
}

async function goalStatus({ user, t, language }) {
  const T = asT(t);
  if (!user?.id) return T('coach.reply.goals.signIn',
      "Sign in to see your goals.");
  try {
    const goals = await db.entities.Goal.filter({ user_id: user.id }, '-created_date', 50).catch(() => []);
    const active = goals.filter(g => g.status !== 'completed');
    if (active.length === 0) {
      return T('coach.reply.goals.none',
      "No active goals. Open the Goals modal to set a PR target. Having a number to chase changes how you train.");
    }
    const lines = [T(`coach.reply.goals.title.${active.length === 1 ? 'one' : 'other'}`,
      active.length === 1 ? '**You have {n} active goal:**' : '**You have {n} active goals:**',
      { n: formatNumber(active.length, language) })];
    for (const g of active.slice(0, 5)) {
      const target = g.target_weight
        ? T('coach.reply.goals.targetWeight', '{n} lb', { n: formatNumber(g.target_weight, language) })
        : g.target_reps
          ? T('coach.reply.goals.targetReps', '{n} reps', { n: formatNumber(g.target_reps, language) })
          : g.target_value || '?';
      lines.push(T('coach.reply.goals.row', '• {name} → {target}',
        { name: g.exercise_name || T('coach.reply.goals.unnamed', 'Goal'), target }));
    }
    return lines.join('\n');
  } catch {
    return T('coach.reply.goals.error',
      "Couldn't load your goals. Try opening the Goals modal directly.");
  }
}

async function streakStatus({ user, t, language }) {
  const T = asT(t);
  const profile = await _fetchProfile(user?.id);
  if (!profile) return T('coach.reply.streak.signIn',
      "Sign in to see your streaks.");
  const lines = [];
  if (profile.workout_streak > 0) {
    lines.push(T(`coach.reply.streak.workout.${profile.workout_streak === 1 ? 'one' : 'other'}`,
      profile.workout_streak === 1
        ? '💪 Workout streak: **{n} day** (best: {best})'
        : '💪 Workout streak: **{n} days** (best: {best})',
      {
        n: formatNumber(profile.workout_streak, language),
        best: formatNumber(profile.longest_workout_streak || profile.workout_streak, language),
      }));
  } else {
    lines.push(T('coach.reply.streak.workoutNone', '💪 Workout streak: 0. Train today to start one.'));
  }
  if (profile.login_streak > 0) {
    lines.push(T(`coach.reply.streak.login.${profile.login_streak === 1 ? 'one' : 'other'}`,
      profile.login_streak === 1
        ? '🔥 Login streak: **{n} day**'
        : '🔥 Login streak: **{n} days**',
      { n: formatNumber(profile.login_streak, language) }));
  }
  if (profile.league_tier) {
    lines.push(T('coach.reply.streak.league', '🏆 League: **{tier}**', { tier: profile.league_tier }));
  }
  return lines.join('\n');
}

async function plateau({ user, t, language }) {
  const T = asT(t);
  return T('coach.reply.plateau.body', [
    "**Plateaus mean it's time to change a variable.** Pick one:",
    '',
    '• **Volume** — add an extra set or 2 to the stalled lift',
    '• **Intensity** — drop weight 10% and chase 2 more reps per set',
    '• **Frequency** — train the lift 2x/week instead of 1x',
    '• **Variation** — swap to a close cousin (back squat → front squat) for 3 weeks',
    '',
    'One change at a time. Give it 3 weeks before judging.',
  ].join('\n'));
}

async function greeting({ user, t, language }) {
  const T = asT(t);
  const profile = await _fetchProfile(user?.id);
  const streak = profile?.workout_streak || 0;
  if (streak >= 7) {
    return T('coach.reply.greeting.hot',
      "Welcome back! {n} days of workout streak. You're on fire 🔥. What's on your mind today?",
      { n: streak });
  }
  if (streak > 0) {
    return T('coach.reply.greeting.streak',
      'Good to see you. Day {n} workout streak. Keep it alive. What can I help with?',
      { n: streak });
  }
  return T('coach.reply.greeting.intro', [
    "Hey 👋 I'm your Coach. I can answer:",
    '',
    "• **What should I train today?** — I'll look at your last 7 days",
    '• **Should I increase weight on [lift]?** — analyzes recent reps',
    '• **How am I doing?** — weekly progress review',
    "• **I'm sore** — recovery suggestions",
    '• **What are my PRs?** — top lifts surfaced',
    '• **Am I weak in any area?** — training-frequency check',
    '',
    'Try one of those, or just type a question.',
  ].join('\n'));
}

async function help({ t, language } = {}) {
  // Forwards `t` — it was dropping it, which would have rendered the help
  // text in English inside an otherwise-translated thread.
  return greeting({ user: {}, t, language });
}

async function unknown({ params, t, language }) {
  const T = asT(t);
  return [
    T('coach.reply.unknown.body', [
      "I'm not sure how to help with that yet. I'm best at:",
      '',
      '• Workout suggestions (try: *what should I train today*)',
      '• Progressive overload (try: *should I increase my squat weight*)',
      "• Recovery (try: *I'm sore*)",
      '• Progress check (try: *how am I doing*)',
      '• PRs, streaks, weak areas',
      '',
    ].join('\n')),
    T('coach.reply.unknown.asked',
      'You asked: "{q}". Rephrasing might help, or pick a question above.',
      { q: (params?.raw || '').slice(0, 80) }),
  ].join('\n');
}

// ── Recovery / Sleep responders (migration 095 — sleep_logs) ─────────────────

import { computeRecoveryScore } from '../recoveryScore';
import { listRecentSleepLogs, getTodaySleepLog } from '../data/sleepLogs';

async function recoveryCheck({ user, t, language }) {
  const T = asT(t);
  // Pull last 7 days of sleep + the most recent workout to compute
  // a recovery score on the same heuristic the Dashboard surfaces use.
  const [recent, latestWorkout] = await Promise.all([
    listRecentSleepLogs(7).catch(() => []),
    _fetchRecentWorkouts(user?.id, 14).then(arr => arr?.[0]).catch(() => null),
  ]);

  const todays = recent[recent.length - 1] || null;
  const { score, labelId, label } = computeRecoveryScore({
    sleepHours:    todays?.hours,
    soreness:      todays?.soreness,
    lastWorkoutAt: latestWorkout?.date,
  });

  const lines = [];
  lines.push(T('coach.reply.recovery.score', 'Recovery: {score}/100, {label}',
    { score: formatNumber(score, language), label: T(`readiness.label.${labelId}`, label) }));
  if (todays?.hours) {
    lines.push(T('coach.reply.recovery.lastNight', 'Last night: {hours}h{quality}', {
      hours: formatNumber(todays.hours, language),
      quality: todays.quality
        ? T('coach.reply.recovery.quality', ' (quality {q}/5)',
            { q: formatNumber(todays.quality, language) })
        : '',
    }));
  } else {
    lines.push(T('coach.reply.recovery.noSleep',
      'No sleep log yet today. Log it to sharpen this score.'));
  }
  if (latestWorkout?.date) {
    const days = differenceInCalendarDays(new Date(), parseLogDate(latestWorkout.date));
    lines.push(days === 0
      ? T('coach.reply.recovery.trainedToday',
          'You trained today. Light recovery work is the right move.')
      : T(`coach.reply.recovery.sinceWorkout.${days === 1 ? 'one' : 'other'}`,
          days === 1 ? '{n} day since last workout.' : '{n} days since last workout.',
          { n: formatNumber(days, language) }));
  }
  // Action prompt — ties recovery score to a training decision.
  if (score >= 80) {
    lines.push(T('coach.reply.recovery.hard', 'Hit it hard. Take a PR shot today.'));
  } else if (score >= 65) {
    lines.push(T('coach.reply.recovery.planned',
      'Train as planned. Save the heaviest lift for later in the session.'));
  } else if (score >= 50) {
    lines.push(T('coach.reply.recovery.cap',
      'Train, but cap intensity. Leave 1-2 reps in reserve.'));
  } else {
    lines.push(T('coach.reply.recovery.mobility',
      'Consider a mobility day or a light cardio session.'));
  }
  return lines.join('\n');
}

async function sleepLog({ user, t, language }) {
  const T = asT(t);
  const todays = await getTodaySleepLog().catch(() => null);
  if (!todays) {
    return T('coach.reply.sleep.none',
      "I don't have a sleep log for you today yet. Tap the sleep card on the Dashboard to record last night.");
  }
  const lines = [
    T('coach.reply.sleep.logged', 'Logged: {hours}h{quality}', {
      hours: formatNumber(todays.hours, language),
      quality: todays.quality
        ? T('coach.reply.recovery.quality', ' (quality {q}/5)',
            { q: formatNumber(todays.quality, language) })
        : '',
    }),
  ];
  if (todays.soreness) {
    lines.push(T('coach.reply.sleep.soreness', 'Soreness: {n}/5',
      { n: formatNumber(todays.soreness, language) }));
  }
  if (todays.hours >= 8) {
    lines.push(T('coach.reply.sleep.solid', "Solid duration. You're set up for a good session."));
  } else if (todays.hours >= 6.5) {
    lines.push(T('coach.reply.sleep.decent', 'Decent. Caffeine + protein early helps.'));
  } else {
    lines.push(T('coach.reply.sleep.short', 'Short night. Favor technique over loading today.'));
  }
  return lines.join('\n');
}

// ── Router ───────────────────────────────────────────────────────────────────

const RESPONDERS = {
  [INTENTS.WHAT_TO_TRAIN]:   whatToTrain,
  [INTENTS.PROGRESS_CHECK]:  progressCheck,
  [INTENTS.SHOULD_INCREASE]: shouldIncrease,
  [INTENTS.SORENESS]:        soreness,
  [INTENTS.CONSISTENCY]:     consistency,
  [INTENTS.PRS]:             prsResponder,
  [INTENTS.WEAK_AREAS]:      weakAreas,
  [INTENTS.CARDIO_SUGGEST]:  cardioSuggest,
  [INTENTS.REST_DAY]:        restDay,
  [INTENTS.NUTRITION_TIP]:   nutritionTip,
  [INTENTS.HYDRATION]:       hydration,
  [INTENTS.GOAL_STATUS]:     goalStatus,
  [INTENTS.STREAK_STATUS]:   streakStatus,
  [INTENTS.PLATEAU]:         plateau,
  [INTENTS.RECOVERY_CHECK]:  recoveryCheck,
  [INTENTS.SLEEP_LOG]:       sleepLog,
  [INTENTS.GREETING]:        greeting,
  [INTENTS.HELP]:            help,
  [INTENTS.UNKNOWN]:         unknown,
};

export async function respond({ user, intent, t, language = 'en' }) {
  const fn = RESPONDERS[intent.id] || unknown;
  try {
    return await fn({ user, intent, params: intent.params, t, language });
  } catch (err) {
    console.warn('[aiCoach] responder threw:', err);
    const msg = 'Hmm, something went wrong looking at your data. Try again in a moment.';
    // The apology must not depend on the thing that may have just broken. A
    // `t` that throws is one of the ways a responder gets here, so this path
    // tries the translator and falls back to English rather than throwing
    // out of the catch block and leaving the chat with no reply at all.
    try {
      return asT(t)('coach.reply.error', msg);
    } catch {
      return enT('coach.reply.error', msg);
    }
  }
}

// ── LLM context digest ───────────────────────────────────────────────────────
//
// The same data the responders above read, assembled once into a compact
// object for the `coach-chat` Edge Function. Everything the model is allowed
// to state as fact about this user comes from here — the system prompt tells
// it never to invent a number, so anything missing from this object is
// something the coach will say it doesn't know rather than guess at.
//
// Three constraints shaped it:
//
//   1. **Compact.** It rides in the prompt on every message, so it is capped
//      at 4 KB server-side. Names and numbers, no raw rows, no set-by-set
//      history — the model needs enough to be specific, not the database.
//   2. **No free text from other users.** Nothing here crosses a user
//      boundary; it is all the caller's own rows.
//   3. **Fails soft, field by field.** Every section is independently
//      try/caught. A broken cardio table degrades the cardio line, it does
//      not blank the whole digest and silently turn the coach generic.

const _n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Every date in the digest ships with the day count already worked out.
// The model cannot be trusted to subtract two dates: asked for the user's
// PRs it reported a lift logged 2026-07-28 as "28 days ago" (it was 10),
// having read the day-of-month as the answer — while getting the same lift
// right in a different reply. Arithmetic belongs in code; the model's job is
// what the number means.
function _daysAgo(date) {
  const d = parseLogDate(date);
  return d ? differenceInCalendarDays(new Date(), d) : null;
}

/**
 * Free text → one safe line, or null.
 *
 * The digest is newline-separated labelled lines, so any user-authored string
 * that reaches it has to be flattened or it can forge a line the model reads
 * as ours. Collapsing all whitespace (not just trimming) is what does that.
 */
function _oneLine(value, max) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/** Run a reader, degrade to [] on any failure. Never lets one dead source
 *  take the rest of the digest with it. */
async function _safe(fn) {
  try { return (await fn()) || []; } catch { return []; }
}

export async function buildCoachContext({
  user,
  profile = {},
  excludeMuscleGroups = [],
  // The rows behind `excludeMuscleGroups`. Optional: a caller that only has
  // the derived set still gets the avoid-list, just without the severity and
  // timing detail.
  activeInjuries = [],
} = {}) {
  const ctx = {
    // Stated up front so the model reports weights in the unit the user
    // reads everywhere else in the app. Logs are stored in lb.
    units: profile?.weight_unit === 'kg' ? 'kg' : 'lb',
    today: format(new Date(), 'yyyy-MM-dd'),
  };

  // ── The demographics, read from the columns that exist ─────────────────────
  //
  // Three of these fields resolved to null for 100% of users, every time,
  // because they named things `user_profiles` does not have. Counted against
  // the 43 live profiles on 2026-08-09:
  //
  //   skillLevel  read `level` / `skill`. Neither is a column. The real one is
  //               `fitness_level` (19 of 43 populated, values like
  //               'consistent'). Note `current_level` IS a column and is the
  //               XP level — reading that would have been worse than reading
  //               nothing, so don't "fix" it that way.
  //   goals       read `fitness_goals` through `Array.isArray`. It is a CSV
  //               STRING ('strength,muscle,endurance'), so the guard was
  //               always false and the list was always empty. 19 of 43 have
  //               the CSV; `fitness_goals_arr` is the newer array form.
  //   trainingDays read `days` / `daysCount`. Neither is a column. The real
  //               one is `training_days`, an array of weekday indices
  //               (["0","2","4"]) whose LENGTH is the sessions per week.
  //
  // So a fully-onboarded user's PROFILE line carried sex, age and bodyweight
  // and nothing else — no experience level, no goal, no training frequency —
  // while the system prompt asks the model to program against exactly those.
  //
  // `activity_level` was excluded here on the reasoning "0 of 43 — nothing
  // writes it", while `nutrition_goal` / `dietary_restrictions` /
  // `weekly_rate_lbs` were kept as "also 0 of 43, but the writers are real".
  // That distinction was wrong: all four are written by the SAME object
  // literal, in NutritionOnboardingModal's `handleSubmit`. There is no sense
  // in which one of them has a less real writer than the other three.
  //
  // The reason all four are empty is that `handleSubmit` has never run.
  // Measured 2026-08-11: 56 profiles, 10 with nutrition_onboarding_complete
  // = true, 0 with any of the four values. Every one of those 10 arrived via
  // `handleSkip`, which writes the completion flag and nothing else. So the
  // emptiness is a conversion fact, not a broken writer — and it will fix
  // itself the moment anyone finishes the flow, for all four at once.
  //
  // activity_level still isn't added, but for the real reason: ctx.profile is
  // only half the work — coach-chat/index.ts builds the PROFILE line field by
  // field, so a key added here renders nowhere until that function is changed
  // and redeployed. Not worth a deploy for a value no account has.
  const _rawGoals = (Array.isArray(profile?.fitness_goals_arr) && profile.fitness_goals_arr.length)
    ? profile.fitness_goals_arr
    : profile?.fitness_goals;
  const _hasGoals = Array.isArray(_rawGoals) ? _rawGoals.length > 0 : !!_rawGoals;
  const _days = profile?.training_days;

  ctx.profile = {
    sex:           profile?.gender || null,
    // profileAge also resolves a `birthday`, which is the field onboarding
    // actually writes for some users.
    age:           profileAge(profile),
    bodyweightLb:  _n(profile?.weight_lbs),
    // Stored as text ('188'). Needed for anything the model is asked to
    // estimate from body size — the prompt has a whole nutrition section.
    heightCm:      _n(profile?.height_cm),
    skillLevel:    profile?.fitness_level || null,
    // normalizeGoals already handles all three shapes this arrives in and is
    // the same function the generator's modifiers use, so the prose and the
    // programming can't disagree about what the user is training for.
    goals:         _hasGoals ? normalizeGoals(_rawGoals) : [],
    nutritionGoal: profile?.nutrition_goal || null,
    weeklyRateLbs: _n(profile?.weekly_rate_lbs),
    targetWeightLb: _n(profile?.target_weight_lbs),
    trainingDaysPerWeek: Array.isArray(_days) ? _days.length : _n(_days),
    // Named so the model never suggests a food the user can't eat — the
    // same rule fuelNote() follows in trainingModifiers.
    dietaryRestrictions: Array.isArray(profile?.dietary_restrictions) ? profile.dietary_restrictions : [],
  };

  // Muscle groups an active injury rules out. The model must not program
  // around these itself (that's the generator's job) but it must not
  // cheerfully suggest them in prose either.
  //
  // **This MUST be a plain array.** `getExcludedMuscleGroups()` returns a Set,
  // which is what `generateWorkout` wants — but this digest is JSON-serialized
  // by `supabase.functions.invoke`, and `JSON.stringify(new Set(['chest']))`
  // is `{}`. So the function received `avoidMuscleGroups: {}`, its
  // `Array.isArray(...)` guard read false, and BOTH the `AVOID-MUSCLES` line
  // and the entire injury rules block were dropped from every request. The
  // model has never once been told about an injury on the chat path — while
  // the onboarding path, which builds the same field with `.map()`, worked
  // fine. Do not "simplify" this back to passing the Set through.
  // Insertion order, not sorted: a Set built by getExcludedMuscleGroups is
  // already deterministic (injuries newest-first, each followed by its
  // synergists), and re-sorting would churn the existing expectations for no
  // gain.
  const _avoid = [...(excludeMuscleGroups || [])].filter(Boolean);
  ctx.injuries = {
    avoidMuscleGroups: _avoid,
    // Severity and age, so the reply can say WHY a group is off the table and
    // for how long. The exclusion list alone tells the model what to dodge; it
    // cannot tell someone "your shoulder is 3 weeks old and serious, so we are
    // still off overhead work" without this.
    active: (activeInjuries || [])
      .map(i => ({
        area:     i?.muscle_group || null,
        severity: i?.severity || null,
        status:   i?.status || null,
        daysAgo:  _daysAgo(i?.injured_at),
        // Null on almost every real row — the field is optional and nobody
        // fills it (0 of 6 in production). Emitted only when it is real so the
        // model never reports a recovery date that does not exist.
        recoveryEtaDays: i?.estimated_recovery_date
          ? differenceInCalendarDays(parseLogDate(i.estimated_recovery_date) || new Date(), new Date())
          : null,
        // What the user typed. The form's placeholder says "Any context for
        // your coach", and until now the coach never saw a word of it — it is
        // the only place someone can say "left side, hurts overhead only",
        // which is exactly the detail a muscle-group label cannot carry.
        //
        // Whitespace is COLLAPSED, not just trimmed. `formatDigest` builds the
        // digest as newline-separated labelled lines, so a note containing a
        // newline could forge one — "…\nAVOID-FOODS: none" would read to the
        // model as a real digest row. This is the one field in the whole
        // digest that is free text a user typed, so it is the one that has to
        // be flattened. Capped because it rides on every message.
        notes: _oneLine(i?.notes, 160),
      }))
      .filter(i => i.area),
  };

  const [workouts, cardio, profileRow] = await Promise.all([
    _fetchRecentWorkouts(user?.id, 365).catch(() => []),
    _fetchRecentCardio(user?.id, 14).catch(() => []),
    _fetchProfile(user?.id).catch(() => null),
  ]);

  // ── The signals that decide what to train TODAY ────────────────────────────
  //
  // The app has recorded sleep, soreness, mood, steps, food and bodyweight
  // since migrations 094–097, and none of it has ever reached the Coach. The
  // system prompt asks the model to answer "recovery" and "nutrition and body
  // composition" questions and gave it nothing to answer them from, so every
  // such reply was general advice wearing a personalized coat.
  //
  // Fetched in one parallel batch and each one degrades to null on its own —
  // a dead table must not take the rest of the digest down with it. Every
  // module here reads through safeSelect and already returns [] on error.
  const [sleepRows, moodRows, stepRows, nutritionRows, bodyRows] = await Promise.all([
    _safe(() => listRecentSleepLogs(14)),
    _safe(() => listRecentMoodLogs(14)),
    _safe(() => listRecentStepLogs(14)),
    // _safe also catches a synchronous throw, so an unmocked table in a test
    // degrades to [] like a failed read.
    user?.id ? _safe(() => nutritionData.list(user.id, 200)) : [],
    user?.id ? _safe(() => bodyMetricsData.list(user.id, 60)) : [],
  ]);

  try {
    const cut7 = subDays(new Date(), 7);
    const within7 = (r) => { const d = parseLogDate(r?.date); return d && d >= cut7; };
    const sleep7 = (sleepRows || []).filter(within7);
    const steps7 = (stepRows || []).filter(within7);
    // Newest-first for "the latest reading", because a stale soreness score is
    // worse than none — it describes a day the user has already trained past.
    const newest = (rows) => (rows || [])
      .filter(r => parseLogDate(r?.date))
      .sort((a, b) => parseLogDate(b.date) - parseLogDate(a.date))[0] || null;
    const lastSleep = newest(sleepRows);
    const lastMood  = newest(moodRows);

    const avg = (rows, key) => {
      const vals = rows.map(r => Number(r?.[key])).filter(Number.isFinite);
      return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;
    };

    const recovery = {
      // Every field is omitted unless a row actually carried it. `quality` and
      // `soreness` are optional on sleep_logs, so a user who logs hours only
      // must not be reported as "soreness 0" — a fabricated zero here reads as
      // "completely fresh" and is the direction that gets someone hurt.
      ...(sleep7.length ? { sleepDaysLogged: sleep7.length } : {}),
      ...(avg(sleep7, 'hours') != null ? { avgSleepHours: avg(sleep7, 'hours') } : {}),
      ...(_n(lastSleep?.quality) != null
        ? { lastSleepQuality1to5: _n(lastSleep.quality), lastSleepDaysAgo: _daysAgo(lastSleep.date) } : {}),
      ...(_n(lastSleep?.soreness) != null ? { lastSoreness1to5: _n(lastSleep.soreness) } : {}),
      // mood_logs.mood is a 0-4 index into MOOD_LABELS. Shipped as 1-5 with
      // the label attached so the model never has to guess which end is good.
      ...(_n(lastMood?.mood) != null
        ? {
            lastMood1to5: _n(lastMood.mood) + 1,
            lastMoodLabel: ['awful', 'meh', 'okay', 'good', 'on fire'][_n(lastMood.mood)] || null,
            lastMoodDaysAgo: _daysAgo(lastMood.date),
          }
        : {}),
      ...(steps7.length ? { avgStepsPerDay: Math.round(avg(steps7, 'steps') || 0) } : {}),
    };

    // The SAME score the Dashboard's readiness card shows, from the same
    // helper — the recoveryCheck responder below already uses it. A Coach that
    // computed its own would eventually disagree with the number on screen
    // about the same morning, which is worse than not having one.
    //
    // Only sent when the user actually logged something: computeRecoveryScore
    // substitutes a neutral 70 for every missing input, so on an empty day it
    // returns a confident-looking score built entirely from defaults.
    if (lastSleep && _daysAgo(lastSleep.date) != null && _daysAgo(lastSleep.date) <= 1) {
      const { score, label } = computeRecoveryScore({
        sleepHours:    _n(lastSleep.hours) ?? undefined,
        soreness:      _n(lastSleep.soreness) ?? undefined,
        lastWorkoutAt: workouts[0]?.date,
      });
      recovery.score100 = score;
      recovery.scoreLabel = label;
    }

    ctx.recovery = Object.keys(recovery).length ? recovery : null;
  } catch { ctx.recovery = null; }

  try {
    // Nutrition. The prompt is explicit that "nutrition questions get nutrition
    // answers — calories, protein targets, meal timing" and the model has been
    // doing that from population averages. `protein` is 6 of 120 rows in
    // production because quick-add captures calories only, so it is reported
    // as its own day count rather than averaged over days that never had it.
    const cut7 = subDays(new Date(), 7);
    const logs7 = (nutritionRows || []).filter(r => { const d = parseLogDate(r?.date); return d && d >= cut7; });
    const days = new Set(logs7.map(r => r.date).filter(Boolean)).size;
    if (days > 0) {
      const kcal = logs7.reduce((s, r) => s + (Number(r?.calories) || 0), 0);
      const proteinRows = logs7.filter(r => Number.isFinite(Number(r?.protein)) && Number(r.protein) > 0);
      const proteinDays = new Set(proteinRows.map(r => r.date)).size;
      ctx.nutritionLast7 = {
        daysLogged: days,
        ...(kcal > 0 ? { avgCaloriesPerLoggedDay: Math.round(kcal / days) } : {}),
        ...(proteinDays > 0
          ? {
              avgProteinGPerLoggedDay: Math.round(
                proteinRows.reduce((s, r) => s + Number(r.protein), 0) / proteinDays),
              proteinDaysLogged: proteinDays,
            }
          : {}),
      };
    } else {
      ctx.nutritionLast7 = null;
    }
  } catch { ctx.nutritionLast7 = null; }

  try {
    // Bodyweight direction, which is the only way to tell whether a stated
    // nutrition goal is actually happening. Two readings at least 7 days apart
    // or nothing — a trend drawn from one number is not a trend.
    const rows = (bodyRows || [])
      .filter(r => Number.isFinite(Number(r?.weight_lbs)) && parseLogDate(r?.date))
      .sort((a, b) => parseLogDate(b.date) - parseLogDate(a.date));
    const latest = rows[0];
    if (latest) {
      const earlier = rows.find(r => differenceInCalendarDays(parseLogDate(latest.date), parseLogDate(r.date)) >= 7);
      ctx.bodyTrend = {
        currentLb: Math.round(Number(latest.weight_lbs) * 10) / 10,
        measuredDaysAgo: _daysAgo(latest.date),
        ...(_n(latest.body_fat_pct) != null ? { bodyFatPct: _n(latest.body_fat_pct) } : {}),
        ...(earlier
          ? {
              changeLb: Math.round((Number(latest.weight_lbs) - Number(earlier.weight_lbs)) * 10) / 10,
              overDays: differenceInCalendarDays(parseLogDate(latest.date), parseLogDate(earlier.date)),
            }
          : {}),
      };
    } else {
      ctx.bodyTrend = null;
    }
  } catch { ctx.bodyTrend = null; }

  try {
    const cutoff7  = subDays(new Date(), 7);
    const cutoff14 = subDays(new Date(), 14);
    const last7  = workouts.filter(w => { const d = parseLogDate(w.date); return d && d >= cutoff7; });
    const last14 = workouts.filter(w => { const d = parseLogDate(w.date); return d && d >= cutoff14; });

    const setsByMuscle = { chest: 0, back: 0, shoulders: 0, arms: 0, legs: 0, core: 0 };
    for (const w of last14) {
      for (const ex of w.exercises || []) {
        const grp = classifyExercise(ex.name);
        if (grp) setsByMuscle[grp] += (ex.sets || []).length;
      }
    }

    ctx.training = {
      sessionsLast7:  last7.length,
      sessionsLast14: last14.length,
      daysSinceLastSession: workouts[0]?.date
        ? differenceInCalendarDays(new Date(), parseLogDate(workouts[0].date))
        : null,
      setsByMuscleLast14: setsByMuscle,
      // Exercise names only. Enough for "you've squatted three times this
      // week", far short of shipping every set. Three sessions rather than
      // six: the digest is re-sent on every message, and sessions four
      // through six never showed up in a reply — the tallies above already
      // carry the fortnight's shape.
      recentSessions: last14.slice(0, 3).map(w => ({
        date: parseLogDate(w.date) ? format(parseLogDate(w.date), 'yyyy-MM-dd') : null,
        daysAgo: _daysAgo(w.date),
        exercises: (w.exercises || []).map(e => e.name).filter(Boolean).slice(0, 10),
      })),
    };
  } catch { ctx.training = null; }

  try {
    // Same top-set logic prsResponder uses, so the chat and the PR answer
    // can never disagree about the same lift.
    const prMap = {};
    for (const w of workouts) {
      for (const ex of w.exercises || []) {
        const name = ex.name?.trim();
        if (!name) continue;
        const top = (ex.sets || []).reduce((best, s) => (
          (Number(s.weight) || 0) > (best?.weight || 0)
            ? { weight: Number(s.weight), reps: Number(s.reps) }
            : best
        ), null);
        if (!top || top.weight <= 0) continue;
        if (!prMap[name] || top.weight > prMap[name].weight) {
          prMap[name] = { weight: top.weight, reps: top.reps, date: w.date };
        }
      }
    }
    ctx.topLifts = Object.entries(prMap)
      .sort((a, b) => b[1].weight - a[1].weight)
      // Five, not eight. prsResponder shows a top five for the same reason:
      // past that it stops being "your PRs" and becomes a list.
      .slice(0, 5)
      .map(([name, pr]) => ({
        name,
        weightLb: pr.weight,
        reps: pr.reps,
        date: parseLogDate(pr.date) ? format(parseLogDate(pr.date), 'yyyy-MM-dd') : null,
        daysAgo: _daysAgo(pr.date),
      }));
  } catch { ctx.topLifts = []; }

  try {
    // `cardio_logs` has NO `duration_minutes` and NO `distance_km` column.
    // The real ones are `duration_seconds` (what the tracker writes),
    // `duration_min` (the older denormalised one) and `distance_meters`. Both
    // reads resolved to undefined, so this block reported "0 minutes, 0 km"
    // for every user who had ever run — and the model quotes what it is given,
    // so it told them so. Checked against the live schema, not guessed.
    const minutes = Math.round(cardio.reduce((s, c) => (
      s + (Number(c.duration_seconds) ? Number(c.duration_seconds) / 60 : (Number(c.duration_min) || 0))
    ), 0));
    const km = Math.round(cardio.reduce((s, c) => s + (Number(c.distance_meters) || 0) / 1000, 0) * 10) / 10;
    ctx.cardioLast14 = {
      sessions: cardio.length,
      // Omitted rather than sent as 0. A zero here is indistinguishable from
      // "logged a session with no duration", and a stat with nothing behind it
      // must not render as a zero (CLAUDE.md).
      ...(minutes > 0 ? { totalMinutes: minutes } : {}),
      ...(km > 0 ? { totalDistanceKm: km } : {}),
    };
  } catch { ctx.cardioLast14 = null; }

  try {
    ctx.streaks = {
      workoutStreakDays: _n(profileRow?.workout_streak),
      longestWorkoutStreakDays: _n(profileRow?.longest_workout_streak),
      loginStreakDays: _n(profileRow?.login_streak),
    };
  } catch { ctx.streaks = null; }

  return ctx;
}
