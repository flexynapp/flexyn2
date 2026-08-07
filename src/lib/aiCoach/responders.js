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
import { subDays, differenceInCalendarDays, format } from 'date-fns';
import { INTENTS } from './intents';
import { formatNumber } from '../intl';

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

async function _fetchRecentWorkouts(userEmail, days = 14) {
  if (!userEmail) return [];
  const since = subDays(new Date(), days);
  try {
    const all = await db.entities.WorkoutLog.filter({ created_by: userEmail }, '-date', 200);
    return (all || []).filter(w => new Date(w.date) >= since);
  } catch {
    return [];
  }
}

async function _fetchRecentCardio(userEmail, days = 14) {
  if (!userEmail) return [];
  const since = subDays(new Date(), days);
  try {
    const all = await db.entities.CardioLog.filter({ created_by: userEmail }, '-date', 200);
    return (all || []).filter(l => new Date(l.date) >= since);
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

async function whatToTrain({ user }) {
  const workouts = await _fetchRecentWorkouts(user?.email, 7);
  if (workouts.length === 0) {
    return [
      "👋 Looks like you haven't logged any workouts in the last 7 days.",
      '',
      "**Suggestion:** Start with a full-body session today — squat, bench, row, OHP, plank. 30–45 minutes is plenty.",
      '',
      "If you have a Regimen saved, just open it from the Workout tab and hit start.",
    ].join('\n');
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
  const daysSince = lastDate ? differenceInCalendarDays(new Date(), new Date(lastDate)) : 0;

  const lines = [
    `**You've trained ${workouts.length} time${workouts.length === 1 ? '' : 's'} in the last 7 days.**`,
    '',
  ];

  if (daysSince === 0) {
    lines.push("You already trained today — solid. If you have energy left, a short 20-min cardio or core session would be a great cap.");
  } else if (daysSince === 1) {
    lines.push("You trained yesterday — today's a good day to push.");
  } else if (daysSince >= 3) {
    lines.push(`It's been ${daysSince} days. Time to get back in. Start with something you enjoy to lower the activation energy.`);
  }

  lines.push('');
  if (least.every(g => tally[g] === 0)) {
    lines.push(`**Train these next:** ${least.join(' and ')} — you haven't touched them this week.`);
  } else {
    lines.push(`**Train these next:** ${least.join(' or ')} — under-trained vs. ${most[0]} this week.`);
  }
  lines.push('');
  lines.push("Pick a regimen from the Workout tab, or build a quick session yourself. Aim for 4–6 exercises and 45 minutes.");
  return lines.join('\n');
}

async function progressCheck({ user }) {
  const [thisWeek, lastWeek, profile] = await Promise.all([
    _fetchRecentWorkouts(user?.email, 7),
    (async () => {
      const all = await _fetchRecentWorkouts(user?.email, 14);
      const cutoff = subDays(new Date(), 7);
      return all.filter(w => new Date(w.date) < cutoff);
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

  const lines = [`**Last 7 days:**`];
  lines.push(`• ${thisWeek.length} workout${thisWeek.length === 1 ? '' : 's'} (${sessionDelta >= 0 ? '+' : ''}${sessionDelta} vs prev week)`);
  if (v1 > 0) {
    // formatNumber with no language defaults to en-US — deterministic
    // across all users. The surrounding "lb total volume" copy is
    // English-only too, so mixing locales here would look broken.
    lines.push(`• ${formatNumber(v1)} lb total volume (${delta >= 0 ? '+' : ''}${delta}%)`);
  }
  if (profile?.workout_streak > 0) {
    lines.push(`• ${profile.workout_streak}-day workout streak (best: ${profile.longest_workout_streak || profile.workout_streak})`);
  }
  if (profile?.login_streak > 0) {
    lines.push(`• ${profile.login_streak}-day login streak`);
  }

  lines.push('');
  if (thisWeek.length === 0) {
    lines.push("You haven't logged anything this week. The hardest part of progress is showing up — start with one set.");
  } else if (sessionDelta < 0 && lastWeek.length > 0) {
    lines.push("Slight dip from last week. Either you're deloading on purpose, or life got busy. Both are fine — just don't string two low weeks back-to-back.");
  } else if (delta >= 5) {
    lines.push("You're trending up. Keep the discipline; volume increase like this compounds.");
  } else if (delta <= -10) {
    lines.push("Volume dropped meaningfully. If you're not fatigued or deloading, push intensity next session.");
  } else {
    lines.push("Steady. Consistency beats intensity over months — you're doing the right thing.");
  }
  return lines.join('\n');
}

async function shouldIncrease({ user }) {
  const workouts = await _fetchRecentWorkouts(user?.email, 21);
  if (workouts.length < 3) {
    return "I need at least 3 sessions of recent data to give you a real answer. Log a few workouts first.";
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
    return "I don't see a single exercise repeated 3+ times in your recent log. Repeat a lift across several sessions and I'll have something concrete to say.";
  }

  candidates.sort((a, b) => b[1].length - a[1].length);
  const [topName, sessions] = candidates[0];
  const recent3 = sessions.slice(0, 3); // already date-desc
  const weights = recent3.map(s => s.topSet?.weight || 0);
  const reps    = recent3.map(s => s.topSet?.reps || 0);
  const sameWeight = weights.every(w => w === weights[0] && w > 0);
  const repsHeld   = reps.every(r => r >= reps[reps.length - 1] && r >= 5);

  if (sameWeight && repsHeld && reps[0] >= 8) {
    return [
      `**Yes — bump your ${topName} weight.**`,
      '',
      `You hit ${weights[0]} lb for ${reps.join(', ')} reps across the last 3 sessions. That's the textbook signal: same weight, stable reps in the 8+ range.`,
      '',
      `Try ${weights[0] + (weights[0] >= 200 ? 10 : weights[0] >= 100 ? 5 : 2.5)} lb next time, aiming for 5–8 reps. If form holds, you're locked in.`,
    ].join('\n');
  }
  if (sameWeight && repsHeld) {
    return [
      `**Almost — keep grinding ${topName} a bit longer.**`,
      '',
      `You're at ${weights[0]} lb for ${reps.join(', ')} reps. Get to 8+ reps consistently before adding weight.`,
    ].join('\n');
  }
  return [
    `**Not yet on ${topName}.**`,
    '',
    `Your top sets recently were ${weights.join(', ')} lb at ${reps.join(', ')} reps — not stable enough to add weight. Lock in ${weights[0]} lb at 8+ reps for 3 sessions, then push.`,
  ].join('\n');
}

async function soreness({ user }) {
  const recent = await _fetchRecentWorkouts(user?.email, 3);
  const last = recent[0];
  if (!last) {
    return "Soreness without recent training is unusual — could be sleep, stress, or another activity. Hydrate, walk for 20 min, and check back in tomorrow.";
  }

  const lastGroups = new Set();
  for (const ex of last.exercises || []) {
    const grp = classifyExercise(ex.name);
    if (grp) lastGroups.add(grp);
  }
  const sorePart = lastGroups.size > 0 ? Array.from(lastGroups).join(', ') : 'whatever you trained';

  return [
    `Soreness in **${sorePart}** is normal 24–48h after a hard session — that's DOMS, not damage.`,
    '',
    "**What to do today:**",
    '• 20–30 min low-intensity cardio (zone 2 walk, easy bike) — pumps blood through the sore muscles',
    '• Hit 8+ glasses of water (you have a Drink Water quest — use it)',
    '• 5 min dynamic mobility for the sore area',
    '',
    'Skip lifting that area until soreness drops below "limits range of motion" levels. You can train un-sore body parts.',
  ].join('\n');
}

async function consistency({ user }) {
  const last30 = await _fetchRecentWorkouts(user?.email, 30);
  const days = new Set(last30.map(w => w.date));
  const ratio = days.size / 30;

  const lines = [`Last 30 days: **${days.size} workout days** (${Math.round(ratio * 100)}%).`];
  lines.push('');
  if (ratio >= 0.5) {
    lines.push("You're crushing it. 4+ workouts a week consistently is in the top 5% of any fitness app's user base.");
  } else if (ratio >= 0.3) {
    lines.push("Solid — roughly 3x/week. That's enough volume to make real progress.");
  } else if (ratio >= 0.15) {
    lines.push("You're showing up. Try to add one more session per week. Pick the day before you check this — log it tomorrow.");
  } else {
    lines.push("Currently inconsistent. Don't aim for perfect — aim for 2 sessions this week. Lock in the habit before optimizing the program.");
  }
  return lines.join('\n');
}

async function prsResponder({ user }) {
  // Personal records by exercise: max single-set weight × reps
  const all = await _fetchRecentWorkouts(user?.email, 365);
  if (all.length === 0) return "No workouts logged yet — log a few sessions and I'll surface your PRs.";

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
  if (top5.length === 0) return "I see workouts but no weighted lifts — bodyweight progress is real, but I can't surface PRs without weights.";

  const lines = ["**Your top 5 PRs:**"];
  for (const [name, pr] of top5) {
    lines.push(`• ${name}: ${pr.weight} lb × ${pr.reps} (${format(new Date(pr.date), 'MMM d')})`);
  }
  return lines.join('\n');
}

async function weakAreas({ user }) {
  const last14 = await _fetchRecentWorkouts(user?.email, 14);
  const tally = { chest: 0, back: 0, shoulders: 0, arms: 0, legs: 0, core: 0 };
  for (const w of last14) {
    for (const ex of w.exercises || []) {
      const grp = classifyExercise(ex.name);
      if (grp) tally[grp] += (ex.sets || []).length;
    }
  }
  const sorted = Object.entries(tally).sort((a, b) => a[1] - b[1]);
  const least = sorted.slice(0, 2);
  const lines = ["**Last 14 days, by sets:**"];
  for (const [g, n] of sorted) lines.push(`• ${g}: ${n}`);
  lines.push('');
  if (least[0][1] === 0) {
    lines.push(`You haven't trained **${least.map(l => l[0]).join(' or ')}** at all in 14 days. Schedule them this week.`);
  } else {
    lines.push(`Underdosed: **${least[0][0]}**. Add an extra session targeting it.`);
  }
  return lines.join('\n');
}

async function cardioSuggest({ user }) {
  const cardio = await _fetchRecentCardio(user?.email, 7);
  const totalSec = cardio.reduce((s, c) => s + (Number(c.duration_seconds) || 0), 0);
  const totalMin = Math.round(totalSec / 60);

  if (totalMin >= 150) {
    return `You've logged **${totalMin} min of cardio** in the last 7 days — exceeds the WHO 150 min/week recommendation. Optional: 1 short session as active recovery.`;
  }
  if (totalMin >= 75) {
    return `**${totalMin} min** logged this week. Adding ~75 more minutes hits the WHO weekly target. Two 30-min sessions would do it.`;
  }
  if (totalMin > 0) {
    return `Only **${totalMin} min** of cardio this week. Aim for 150 min/week for cardiovascular health. A 25-min walk every other day gets you there.`;
  }
  return [
    "No cardio logged in the last 7 days.",
    '',
    "**Easy starting point:** 20 min walk after a meal. That's it. You can scale up to running/biking when the habit's locked in.",
  ].join('\n');
}

async function restDay() {
  return [
    "**Rest is when adaptation happens.** A few signals you should rest today:",
    '',
    '• Trained hard 3+ days in a row',
    '• Sleeping less than usual',
    '• Joints (not muscles) hurt',
    '• Resting heart rate elevated',
    '',
    'If none of these, light activity — 20 min walk, 10 min mobility — beats sitting still. "Active rest" still counts.',
  ].join('\n');
}

async function nutritionTip({ user }) {
  return [
    "**Three things that move the needle most:**",
    '',
    '• **Protein** at every meal — 0.7–1 g per lb of bodyweight per day',
    '• **Hit your calorie target** — under for fat loss, slight surplus for muscle gain',
    '• **Vegetables** at lunch and dinner — fiber, micros, fullness',
    '',
    'Open the Nutrition tab to log a meal — even one logged meal trains the habit.',
  ].join('\n');
}

async function hydration() {
  return [
    "Aim for **8 glasses (64 oz) of water minimum** per day, more if you sweat heavily.",
    '',
    'Tap the Drink Water buttons in Nutrition — small wins compound. The Drink Water quest pays out coins for hitting 4 or 8 glasses.',
  ].join('\n');
}

async function goalStatus({ user }) {
  if (!user?.email) return "Sign in to see your goals.";
  try {
    const goals = await db.entities.Goal.filter({ created_by: user.email }, '-created_date', 50).catch(() => []);
    const active = goals.filter(g => g.status !== 'completed');
    if (active.length === 0) {
      return "No active goals. Open the Goals modal to set a PR target — having a number to chase changes how you train.";
    }
    const lines = [`**You have ${active.length} active goal${active.length === 1 ? '' : 's'}:**`];
    for (const g of active.slice(0, 5)) {
      const target = g.target_weight ? `${g.target_weight} lb` : g.target_reps ? `${g.target_reps} reps` : g.target_value || '?';
      lines.push(`• ${g.exercise_name || 'Goal'} → ${target}`);
    }
    return lines.join('\n');
  } catch {
    return "Couldn't load your goals — try opening the Goals modal directly.";
  }
}

async function streakStatus({ user }) {
  const profile = await _fetchProfile(user?.id);
  if (!profile) return "Sign in to see your streaks.";
  const lines = [];
  if (profile.workout_streak > 0) {
    lines.push(`💪 Workout streak: **${profile.workout_streak} day${profile.workout_streak === 1 ? '' : 's'}** (best: ${profile.longest_workout_streak || profile.workout_streak})`);
  } else {
    lines.push("💪 Workout streak: 0. Train today to start one.");
  }
  if (profile.login_streak > 0) {
    lines.push(`🔥 Login streak: **${profile.login_streak} day${profile.login_streak === 1 ? '' : 's'}**`);
  }
  if (profile.league_tier) {
    lines.push(`🏆 League: **${profile.league_tier}**`);
  }
  return lines.join('\n');
}

async function plateau({ user }) {
  return [
    "**Plateaus mean it's time to change a variable.** Pick one:",
    '',
    '• **Volume** — add an extra set or 2 to the stalled lift',
    '• **Intensity** — drop weight 10% and chase 2 more reps per set',
    '• **Frequency** — train the lift 2x/week instead of 1x',
    '• **Variation** — swap to a close cousin (back squat → front squat) for 3 weeks',
    '',
    'One change at a time. Give it 3 weeks before judging.',
  ].join('\n');
}

async function greeting({ user }) {
  const profile = await _fetchProfile(user?.id);
  const streak = profile?.workout_streak || 0;
  if (streak >= 7) {
    return `Welcome back! ${streak} days of workout streak — you're on fire 🔥. What's on your mind today?`;
  }
  if (streak > 0) {
    return `Good to see you. Day ${streak} workout streak — keep it alive. What can I help with?`;
  }
  return [
    "Hey 👋 I'm your Coach. I can answer:",
    '',
    '• **What should I train today?** — I\'ll look at your last 7 days',
    '• **Should I increase weight on [lift]?** — analyzes recent reps',
    "• **How am I doing?** — weekly progress review",
    "• **I'm sore** — recovery suggestions",
    "• **What are my PRs?** — top lifts surfaced",
    "• **Am I weak in any area?** — training-frequency check",
    '',
    'Try one of those, or just type a question.',
  ].join('\n');
}

async function help() {
  return greeting({ user: {} });
}

async function unknown({ params }) {
  return [
    "I'm not sure how to help with that yet. I'm best at:",
    '',
    '• Workout suggestions (try: *what should I train today*)',
    '• Progressive overload (try: *should I increase my squat weight*)',
    '• Recovery (try: *I\'m sore*)',
    '• Progress check (try: *how am I doing*)',
    '• PRs, streaks, weak areas',
    '',
    `You asked: "${(params?.raw || '').slice(0, 80)}". Rephrasing might help, or pick a question above.`,
  ].join('\n');
}

// ── Recovery / Sleep responders (migration 095 — sleep_logs) ─────────────────

import { computeRecoveryScore } from '../recoveryScore';
import { listRecentSleepLogs, getTodaySleepLog } from '../data/sleepLogs';

async function recoveryCheck({ user }) {
  // Pull last 7 days of sleep + the most recent workout to compute
  // a recovery score on the same heuristic the Dashboard surfaces use.
  const [recent, latestWorkout] = await Promise.all([
    listRecentSleepLogs(7).catch(() => []),
    _fetchRecentWorkouts(user?.email, 14).then(arr => arr?.[0]).catch(() => null),
  ]);

  const todays = recent[recent.length - 1] || null;
  const { score, label } = computeRecoveryScore({
    sleepHours:    todays?.hours,
    sleepQuality:  todays?.quality,
    soreness:      todays?.soreness,
    lastWorkoutAt: latestWorkout?.date,
  });

  const lines = [];
  lines.push(`Recovery: ${score}/100 — ${label}`);
  if (todays?.hours) {
    lines.push(`Last night: ${todays.hours}h${todays.quality ? ` (quality ${todays.quality}/5)` : ''}`);
  } else {
    lines.push("No sleep log yet today — log it to sharpen this score.");
  }
  if (latestWorkout?.date) {
    const days = differenceInCalendarDays(new Date(), new Date(latestWorkout.date));
    lines.push(days === 0
      ? "You trained today — light recovery work is the right move."
      : days === 1
        ? "1 day since last workout."
        : `${days} days since last workout.`);
  }
  // Action prompt — ties recovery score to a training decision.
  if (score >= 80) {
    lines.push("Hit it hard. Take a PR shot today.");
  } else if (score >= 65) {
    lines.push("Train as planned. Save the heaviest lift for later in the session.");
  } else if (score >= 50) {
    lines.push("Train, but cap intensity — leave 1-2 reps in reserve.");
  } else {
    lines.push("Consider a mobility day or a light cardio session.");
  }
  return lines.join('\n');
}

async function sleepLog({ user }) {
  const todays = await getTodaySleepLog().catch(() => null);
  if (!todays) {
    return "I don't have a sleep log for you today yet. Tap the sleep card on the Dashboard to record last night.";
  }
  const lines = [
    `Logged: ${todays.hours}h${todays.quality ? ` (quality ${todays.quality}/5)` : ''}`,
  ];
  if (todays.soreness) lines.push(`Soreness: ${todays.soreness}/5`);
  if (todays.hours >= 8) {
    lines.push("Solid duration. You're set up for a good session.");
  } else if (todays.hours >= 6.5) {
    lines.push("Decent. Caffeine + protein early helps.");
  } else {
    lines.push("Short night — favor technique over loading today.");
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

export async function respond({ user, intent }) {
  const fn = RESPONDERS[intent.id] || unknown;
  try {
    return await fn({ user, intent, params: intent.params });
  } catch (err) {
    console.warn('[aiCoach] responder threw:', err);
    return "Hmm, something went wrong looking at your data. Try again in a moment.";
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

export async function buildCoachContext({ user, profile = {}, excludeMuscleGroups = [] } = {}) {
  const ctx = {
    // Stated up front so the model reports weights in the unit the user
    // reads everywhere else in the app. Logs are stored in lb.
    units: profile?.weight_unit === 'kg' ? 'kg' : 'lb',
    today: format(new Date(), 'yyyy-MM-dd'),
  };

  ctx.profile = {
    sex:           profile?.gender || null,
    age:           _n(profile?.age),
    bodyweightLb:  _n(profile?.weight_lbs),
    skillLevel:    profile?.level || profile?.skill || null,
    goals:         Array.isArray(profile?.fitness_goals) ? profile.fitness_goals : [],
    nutritionGoal: profile?.nutrition_goal || null,
    weeklyRateLbs: _n(profile?.weekly_rate_lbs),
    trainingDaysPerWeek: _n(profile?.days) ?? _n(profile?.daysCount),
    // Named so the model never suggests a food the user can't eat — the
    // same rule fuelNote() follows in trainingModifiers.
    dietaryRestrictions: Array.isArray(profile?.dietary_restrictions) ? profile.dietary_restrictions : [],
  };

  // Muscle groups an active injury rules out. The model must not program
  // around these itself (that's the generator's job) but it must not
  // cheerfully suggest them in prose either.
  ctx.injuries = { avoidMuscleGroups: excludeMuscleGroups || [] };

  const [workouts, cardio, profileRow] = await Promise.all([
    _fetchRecentWorkouts(user?.email, 365).catch(() => []),
    _fetchRecentCardio(user?.email, 14).catch(() => []),
    _fetchProfile(user?.id).catch(() => null),
  ]);

  try {
    const cutoff7  = subDays(new Date(), 7);
    const cutoff14 = subDays(new Date(), 14);
    const last7  = workouts.filter(w => new Date(w.date) >= cutoff7);
    const last14 = workouts.filter(w => new Date(w.date) >= cutoff14);

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
        ? differenceInCalendarDays(new Date(), new Date(workouts[0].date))
        : null,
      setsByMuscleLast14: setsByMuscle,
      // Exercise names only. Enough for "you've squatted three times this
      // week", far short of shipping every set.
      recentSessions: last14.slice(0, 6).map(w => ({
        date: w.date ? format(new Date(w.date), 'yyyy-MM-dd') : null,
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
      .slice(0, 8)
      .map(([name, pr]) => ({
        name,
        weightLb: pr.weight,
        reps: pr.reps,
        date: pr.date ? format(new Date(pr.date), 'yyyy-MM-dd') : null,
      }));
  } catch { ctx.topLifts = []; }

  try {
    ctx.cardioLast14 = {
      sessions: cardio.length,
      totalMinutes: Math.round(cardio.reduce((s, c) => s + (Number(c.duration_minutes) || 0), 0)),
      totalDistanceKm: Math.round(cardio.reduce((s, c) => s + (Number(c.distance_km) || 0), 0) * 10) / 10,
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
