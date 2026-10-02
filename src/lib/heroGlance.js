// src/lib/heroGlance.js
//
// Which slides Today's hero carousel shows beyond the week and the trend
// lines, and in what order. Pure: the hook in useHeroGlance.js fetches,
// this decides. Every builder returns null when there is nothing honest to
// show, and a null is simply no slide, so someone who does not track food,
// is in no crew and has no duel running never sees a zero about any of it.
//
// Order is by how much the next few hours can change the number:
//   contests with a clock (duel, crew war), then today's fuel and quests,
//   then goals, the weekly pattern, and the slower trend lines.
// Capped at MAX_SLIDES so the dots stay a glance rather than a list.

import { goalProgress } from '@/lib/goalProgress';

export const MAX_SLIDES = 8;
// A pattern needs enough sessions spread over enough weeks that "you
// usually train on Mondays" describes a habit rather than one busy week.
export const PATTERN_WINDOW_WEEKS = 8;
export const PATTERN_MIN_SESSIONS = 6;
export const PATTERN_MIN_WEEKS = 3;

const DAY_MS = 86_400_000;

/** Monday-first weekday index, 0 to 6. */
const mondayIndex = (d) => (d.getDay() + 6) % 7;

const parseDay = (s) => {
  if (!s) return null;
  // A bare yyyy-MM-dd is a calendar day, read in local time so Monday's
  // session does not land on Sunday west of Greenwich.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Sessions per weekday over the last PATTERN_WINDOW_WEEKS, lifting and
 * cardio together, one per day (two sessions on a Monday are one Monday).
 * The usual hour comes from created_at, which is when the session was
 * SAVED, so it is reported as "you usually finish around", never "start".
 */
export function trainingPattern({ logs = [], cardioLogs = [], now = new Date() } = {}) {
  const since = now.getTime() - PATTERN_WINDOW_WEEKS * 7 * DAY_MS;
  const days = new Map(); // yyyy-mm-dd -> Date (first save that day)
  const hours = [];
  for (const row of [...logs, ...cardioLogs]) {
    const d = parseDay(row?.date) || parseDay(row?.created_at);
    if (!d || d.getTime() < since || d.getTime() > now.getTime() + DAY_MS) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!days.has(key)) days.set(key, d);
    const saved = parseDay(row?.created_at);
    if (saved && row?.created_at?.length > 10) hours.push(saved.getHours() + saved.getMinutes() / 60);
  }

  const counts = [0, 0, 0, 0, 0, 0, 0];
  const weeks = new Set();
  for (const d of days.values()) {
    counts[mondayIndex(d)] += 1;
    const monday = new Date(d);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - mondayIndex(d));
    weeks.add(monday.getTime());
  }
  const sessions = days.size;
  const ready = sessions >= PATTERN_MIN_SESSIONS && weeks.size >= PATTERN_MIN_WEEKS;
  if (!ready) return null;

  const max = Math.max(...counts);
  // Ties go to every day at the top, up to two; three "best days" is not
  // a pattern.
  const top = counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0);
  const topDays = top.length <= 2 ? top : [];

  let usualHour = null;
  if (hours.length >= PATTERN_MIN_SESSIONS) {
    const sorted = [...hours].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    // Round to the half hour: "6:30 PM" is a habit, "6:43 PM" is a log line.
    usualHour = Math.round(mid * 2) / 2;
  }

  return {
    counts,
    sessions,
    weeks: weeks.size,
    perWeek: Math.round((sessions / PATTERN_WINDOW_WEEKS) * 10) / 10,
    topDays,
    usualHour,
  };
}

/** The viewer's side and the other side of a duel, or null when there is no live one. */
export function duelGlance(duel, userId, now = new Date()) {
  if (!duel || !userId) return null;
  const expires = duel.expires_at ? new Date(duel.expires_at) : null;
  if (expires && expires.getTime() <= now.getTime()) return null;
  const isChallenger = duel.challenger_id === userId;
  const mine = isChallenger ? duel.challenger_result : duel.opponent_result;
  const theirs = isChallenger ? duel.opponent_result : duel.challenger_result;
  // A Mirror duel is won on sets finished, so its race is in sets.
  const bySets = duel.type === 'mirror';
  const pick = (r) => {
    if (!r) return 0;
    const v = bySets ? r.sets_completed : (r.volume ?? r.score);
    return Number(v) || 0;
  };
  return {
    id: duel.id,
    pending: duel.status === 'pending',
    unit: bySets ? 'sets' : 'lbs',
    mine: pick(mine),
    theirs: pick(theirs),
    msLeft: expires ? expires.getTime() - now.getTime() : null,
    opponentName: duel.opponent_name ?? null,
  };
}

/** A running crew war as the hero shows it, or null. */
export function warGlance(war, now = new Date()) {
  if (!war) return null;
  const ends = war.endsAt ? new Date(war.endsAt) : null;
  return {
    crewId: war.crewId,
    crewName: war.crewName ?? null,
    mine: Number(war.mine) || 0,
    theirs: Number(war.theirs) || 0,
    msLeft: ends ? Math.max(0, ends.getTime() - now.getTime()) : null,
  };
}

/** Today's quests as done / total, with the rows for the visual. */
export function questGlance(rows = []) {
  const quests = (rows || []).filter((r) => r && r.quest_id);
  if (quests.length === 0) return null;
  const done = quests.filter((q) => q.completed_at || q.claimed_at).length;
  const unclaimed = quests.filter((q) => q.completed_at && !q.claimed_at).length;
  return { quests, done, total: quests.length, unclaimed };
}

/**
 * The active goal nearest to done (below 100%; a goal at 100% is being
 * completed by useGoalAutoComplete and is about to leave the list).
 */
export function goalGlance({ goals = [], logs = [], cardioLogs = [] } = {}) {
  let best = null;
  let activeCount = 0;
  for (const goal of goals || []) {
    if (goal?.status !== 'active') continue;
    activeCount += 1;
    let progress = 0;
    try { progress = Number(goalProgress(goal, logs, cardioLogs)) || 0; } catch { progress = 0; }
    if (progress >= 100) continue;
    if (!best || progress > best.progress) best = { goal, progress: Math.max(0, progress) };
  }
  return best ? { ...best, activeCount } : null;
}

/**
 * Fuel for today. Shown only to someone who tracks food: they logged a meal
 * today, or in the last week. A "2,000 kcal left" at someone who never
 * logs food reads as the app calling them lazy (CLAUDE.md, denormalised
 * columns: "a section with no data must not render as zeros").
 */
export function fuelGlance({ calories = 0, macros = null, targets = null, tracksFood = false } = {}) {
  const goal = Math.round(Number(targets?.calories) || 0);
  if (!goal) return null;
  if (!(calories > 0) && !tracksFood) return null;
  const macro = (key, targetKey) => ({
    have: Math.round(Number(macros?.[key]) || 0),
    target: Math.round(Number(targets?.[targetKey]) || 0),
  });
  return {
    calories: Math.round(calories),
    goal,
    left: goal - Math.round(calories),
    protein: macro('protein', 'protein_g'),
    carbs: macro('carbs', 'carbs_g'),
    fat: macro('fat', 'fat_g'),
  };
}

/**
 * The slide list after the week. `trends` comes from heroTrendSlides, which
 * returns a single not-ready strength slide when nothing is ready; that
 * placeholder only earns a place when nothing else would fill the hero.
 */
export function orderHeroSlides({ duel, war, fuel, quests, goal, trends = [], pattern } = {}) {
  const ready = trends.filter((t) => t.ready);
  const notReady = trends.filter((t) => !t.ready);
  const slides = [
    duel && { id: 'duel', duel },
    war && { id: 'war', war },
    fuel && { id: 'fuel', fuel },
    quests && { id: 'quests', quests },
    goal && { id: 'goal', goal },
    pattern && { id: 'pattern', pattern },
    ...ready.map((trend) => ({ id: `trend-${trend.kind}`, trend })),
  ].filter(Boolean);
  if (slides.length < 2) {
    slides.push(...notReady.map((trend) => ({ id: `trend-${trend.kind}`, trend })));
  }
  // The week is slide one and is added by the caller, so MAX_SLIDES - 1 here.
  return slides.slice(0, MAX_SLIDES - 1);
}
