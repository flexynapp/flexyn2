// src/lib/tdee.js
//
// One definition of "how many calories does this person burn in a day",
// shared by the Progress → Insights card and the nutrition targets.
//
// These two used to be separate implementations of the same arithmetic with
// different inputs, and they disagreed. InsightsTab derived the activity
// multiplier from observed sessions per week; nutritionDefaults read it from
// `user_profiles.activity_level`, which is null on every production row
// (audit 21 — the onboarding flow that writes it has never been completed by
// anyone). So the app showed a personalised maintenance figure on Progress
// and a flat 2000 kcal on Nutrition, for the same user, on the same day.
//
// The ladder below was already identical in both files. What differed was
// only where the number feeding it came from. Now there is one of each.

import { subDays, differenceInDays } from 'date-fns';
import { parseLocalDate } from '@/lib/dateUtils';

/** How far back the activity read looks, and the floor on that window. */
export const TDEE_WINDOW_DAYS = 30;
/**
 * Never divide by fewer than a week's worth of days. A four-day-old
 * account with three sessions is not training 5.25×/week — that is one
 * good weekend extrapolated into a lifestyle. The floor keeps a new
 * account from claiming the top activity band while still letting it out
 * of the "sedentary" band it was stuck in when this divided by a flat 30.
 */
export const TDEE_MIN_WINDOW_DAYS = 7;

/**
 * Mifflin-St Jeor's sex term: +5 male, -161 female — a 166 kcal spread on
 * BMR, which the activity multiplier then scales to 200-315 kcal of TDEE.
 *
 * **Unset takes the MIDPOINT, not male.** `gender` is null on 45 of 56
 * production profiles, so defaulting to male silently handed most users a
 * male estimate with nothing on screen saying so. This is not a new
 * judgement: `_demographicScale()` in src/lib/aiCoach/workoutGenerator.js
 * already decided the same question the same way — "'other' / unset" takes
 * a middle value there, because over-prescribing "is the direction that
 * hurts someone."
 *
 * -78 is the midpoint of +5 and -161. It is deliberately a number nobody's
 * body matches: it is an admission that we do not know, and callers pair it
 * with a note saying so rather than presenting it as measured.
 */
export const BMR_SEX_TERM = { male: 5, female: -161, unknown: -78 };

/**
 * Mifflin-St Jeor BMR. Metric in.
 *
 * Returns null rather than a number when an input is missing — a BMR built
 * from placeholder demographics is worse than no BMR, because it looks
 * exactly like a real one on screen. Callers must handle null.
 *
 * Pass `sex` through raw. Do NOT collapse everything that is not 'female'
 * into 'male' before calling — that is precisely the bug this module exists
 * to stop, and it makes the midpoint branch unreachable.
 */
export function calcBMR({ weightKg, heightCm, age, sex }) {
  if (!weightKg || !heightCm || !age) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return base + (BMR_SEX_TERM[sex] ?? BMR_SEX_TERM.unknown);
}

/** True when `sex` is a value Mifflin-St Jeor actually has a term for. */
export function isKnownSex(sex) {
  return sex === 'male' || sex === 'female';
}

/** Activity multiplier from observed sessions per week. */
export function activityMultiplier(sessionsPerWeek) {
  if (sessionsPerWeek <= 0) return 1.2;
  if (sessionsPerWeek <= 2) return 1.375;
  if (sessionsPerWeek <= 4) return 1.55;
  if (sessionsPerWeek <= 6) return 1.725;
  return 1.9;
}

/**
 * Sessions per week over the trailing window, counting workouts and cardio
 * alike.
 *
 * Divides by the days the account has actually been training within the
 * window, not by a flat 30. Four days of history over a 30-day denominator
 * reported 0.7 sessions/wk for someone training daily.
 *
 * `now` is injectable so tests do not depend on the clock.
 */
export function observedSessionsPerWeek({ logs, cardioLogs, now = new Date() }) {
  const cutoff = subDays(now, TDEE_WINDOW_DAYS);
  const inWindow = (l) => {
    const d = parseLocalDate(l?.date);
    return d && d >= cutoff;
  };
  const recentLogs   = (logs || []).filter(inWindow);
  const recentCardio = (cardioLogs || []).filter(inWindow);

  const firstInWindow = [...recentLogs, ...recentCardio]
    .map(l => parseLocalDate(l.date))
    .filter(Boolean)
    .sort((a, b) => a - b)[0];
  const observedDays = firstInWindow ? differenceInDays(now, firstInWindow) + 1 : TDEE_WINDOW_DAYS;
  const windowDays = Math.min(TDEE_WINDOW_DAYS, Math.max(TDEE_MIN_WINDOW_DAYS, observedDays));

  return {
    sessionsPerWeek: (recentLogs.length + recentCardio.length) / (windowDays / 7),
    windowDays,
    sessionCount: recentLogs.length + recentCardio.length,
  };
}
