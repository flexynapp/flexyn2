// src/lib/focalGoal.js
//
// The one number each page is chasing, and the sentence that says what it
// means today. Hero option D (kegan, 2026-09-27): "One number you are
// chasing, drawn big, with a sentence that says what it means today."
//
// Pure: no React, no `@/api/db`, no translation. Every sentence comes back as
// a descriptor { key, fallback, vars } so the component runs it through
// tFallback and the tests can assert the RULE without a render. Anything that
// needs the locale (weekday names, list joining) is passed in as a function.
//
// ── Where the weekly target comes from ────────────────────────────────────
// `user_profiles.training_days`, the weekday picks from onboarding, an array
// of Monday-based indices ("0" = Monday, see WEEKDAY_SEED in Onboarding.jsx).
// Its LENGTH is sessions per week. Measured 2026-09-27: set on 57 of 77
// profiles, and every one of the 57 is non-empty. The obvious-looking column,
// `onboarding_days_per_week`, is set on 0 of 77: nothing writes it, so it is
// deliberately not read here (CLAUDE.md, "Count the populated rows before you
// trust a denormalised column").
//
// When training_days is missing the target is UNKNOWN, not 3. The Dashboard
// path slide floors an unknown at 3, which is fine for a suggestion and wrong
// for a ring: a ring drawn against a number the user never chose reads as a
// goal they are failing. So an unknown target draws no ring and the sentence
// talks about the count and last week instead.

import { parseLocalDate, toLocalDateString } from '@/lib/dateUtils';
import { startOfWeekMonday } from '@/lib/glanceStats';

const d = (key, fallback, vars) => (vars ? { key, fallback, vars } : { key, fallback });

// ── Progress: the training week ────────────────────────────────────────────

/** Sessions per week the user chose, 1 to 7, or null when unknown. */
export function weeklyTarget(profile) {
  const days = profile?.training_days;
  if (!Array.isArray(days)) return null;
  const distinct = new Set(days.map((x) => String(x)).filter((x) => /^[0-6]$/.test(x)));
  return distinct.size > 0 ? distinct.size : null;
}

/**
 * The week so far. A "session" is a distinct day with at least one logged
 * workout: the target is days per week, so two sessions on one day fill one
 * day, and the ring and the day dots can never disagree.
 */
export function weekSummary({ logs = [], profile = {}, now = new Date() } = {}) {
  const monday = startOfWeekMonday(now);
  const lastMonday = new Date(monday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const todayKey = toLocalDateString(now);
  const todayIndex = (now.getDay() + 6) % 7;

  const trainedKeys = new Set();
  const lastWeekKeys = new Set();
  let everTrained = false;
  for (const log of logs || []) {
    const day = parseLocalDate(log?.date);
    if (!day) continue;
    everTrained = true;
    const key = toLocalDateString(day);
    if (day >= monday) trainedKeys.add(key);
    else if (day >= lastMonday) lastWeekKeys.add(key);
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const key = toLocalDateString(date);
    return { index: i, key, date, done: trainedKeys.has(key), today: key === todayKey, future: key > todayKey };
  });
  const done = days.filter((x) => x.done && !x.future).length;
  const trainedToday = days[todayIndex].done;
  // Days still available to train, today included unless it is already in.
  const slotsLeft = days.filter((x) => (x.today && !x.done) || x.future).length;

  return {
    target: weeklyTarget(profile),
    done,
    lastWeekDone: lastWeekKeys.size,
    days,
    todayIndex,
    trainedToday,
    slotsLeft,
    everTrained,
  };
}

/** The big sentence beside the ring. */
export function weekHeadline(s) {
  if (!s.everTrained) return d('progress.focal.week.first', 'Your first session starts the week.');
  if (s.target) {
    const remaining = s.target - s.done;
    if (remaining <= 0) return d('progress.focal.week.done', 'Week done. Anything now is extra.');
    if (remaining > s.slotsLeft) {
      return d('progress.focal.week.short', 'Not enough days left for {n} this week. Every session still counts.', { n: s.target });
    }
    if (remaining === 1) return d('progress.focal.week.oneMore', 'One more session to hit your week.');
    return d('progress.focal.week.more', '{n} more sessions to hit your week.', { n: remaining });
  }
  if (s.done === 0) return d('progress.focal.week.noneYet', 'No sessions yet this week.');
  if (s.done === 1) return d('progress.focal.week.count_one', 'One session this week.');
  return d('progress.focal.week.count_other', '{n} sessions this week.', { n: s.done });
}

/**
 * The quieter line under it: what actually happened, from the user's own
 * days. `formatDays(indices)` turns Monday-based weekday indices into a
 * localised list ("Tuesday and Thursday").
 */
export function weekDetail(s, formatDays = (xs) => xs.join(', ')) {
  if (!s.everTrained) {
    if (s.target === 1) return d('progress.focal.week.planned_one', 'You planned one day a week. Any session today counts.');
    if (s.target) return d('progress.focal.week.planned_other', 'You planned {n} days a week. Any session today counts.', { n: s.target });
    return d('progress.focal.week.anyCounts', 'Any session counts, even ten minutes.');
  }
  if (s.done > 0) {
    if (s.done === 1 && s.trainedToday) return d('progress.focal.week.trainedToday', 'You trained today.');
    const indices = s.days.filter((x) => x.done).map((x) => x.index);
    return d('progress.focal.week.trainedOn', 'You trained {days}.', { days: formatDays(indices) });
  }
  if (s.lastWeekDone === 1) return d('progress.focal.week.lastWeek_one', 'Last week you trained one day.');
  if (s.lastWeekDone > 1) return d('progress.focal.week.lastWeek_other', 'Last week you trained {n} days.', { n: s.lastWeekDone });
  return d('progress.focal.week.startToday', 'A session today starts the week.');
}

// ── Nutrition: today's fuel ────────────────────────────────────────────────

// Within this share of the target counts as "on target". 5% of 2,000 kcal is
// 100 kcal, which is about the error in any single logged meal.
export const ON_TARGET_BAND = 0.05;

/**
 * Today's intake against the calorie target. `entries` is the day's
 * nutrition_logs rows; water rows (meal_type NULL, food_name 'Water…') are
 * the caller's to exclude, because this module does not know the encoding.
 */
export function fuelSummary({ meals = [], targets = {} } = {}) {
  let kcal = 0;
  let protein = 0;
  for (const m of meals || []) {
    kcal += Number(m?.calories) || 0;
    protein += Number(m?.protein_g ?? m?.protein) || 0;
  }
  return {
    logged: (meals || []).length > 0,
    meals: (meals || []).length,
    kcal: Math.round(kcal),
    protein: Math.round(protein),
    target: Math.round(Number(targets?.calories) || 0),
    proteinTarget: Math.round(Number(targets?.protein_g) || 0),
  };
}

export function fuelHeadline(s) {
  if (!s.logged) return d('nutrition.focal.empty', 'Nothing logged today.');
  if (!(s.target > 0)) return d('nutrition.focal.noTarget', '{n} kcal so far today.', { n: s.kcal });
  const gap = s.target - s.kcal;
  if (Math.abs(gap) <= s.target * ON_TARGET_BAND) return d('nutrition.focal.onTarget', 'Right on your target.');
  if (gap > 0) return d('nutrition.focal.left', '{n} kcal left for today.', { n: gap });
  return d('nutrition.focal.over', '{n} kcal over today.', { n: -gap });
}

export function fuelDetail(s) {
  if (!s.logged) {
    if (s.target > 0) return d('nutrition.focal.emptyDetail', 'Your target is {n} kcal. Log a meal and the ring starts filling.', { n: s.target });
    return d('nutrition.focal.emptyDetailNoTarget', 'Log a meal and it shows up here.');
  }
  // Protein has its own meter in the stat row beside this, so the sentence
  // only speaks for it when there is something to say: the target is hit.
  if (s.proteinTarget > 0 && s.protein >= s.proteinTarget) {
    return d('nutrition.focal.proteinHit', 'Protein target hit at {n} g.', { n: s.protein });
  }
  if (s.meals === 1) return d('nutrition.focal.meals_one', 'One meal logged so far.');
  return d('nutrition.focal.meals_other', '{n} meals logged so far.', { n: s.meals });
}

/** 0..1 share of a target, for a ring. Null when there is no target. */
export function ringShare(value, target) {
  const t = Number(target) || 0;
  if (t <= 0) return null;
  return Math.max(0, Math.min(1, (Number(value) || 0) / t));
}
