// src/lib/data/weeklyRecap.js
//
// Aggregates the last 7 days of workout history into a single recap shape
// for the Dashboard's "This week" card. Pure function — takes already-loaded
// logs from React Query, never touches the network, fully unit-testable.
//
// Window: rolling last 7 days (matches the convention in Dashboard's
// thisWeekLogs / weeklyVolume — see Dashboard.jsx:284). Comparison window
// is the 7 days BEFORE that (days 8-14 ago). Anything older feeds into
// the PR baseline only.
//
// PR definition: simple weight-based personal record. An exercise hits a
// PR this week if any set's weight exceeds the user's all-time max set
// weight for the same exercise (case-insensitive name match). This is
// intentionally lenient — we'd rather over-celebrate than under-celebrate.
// A stricter "1RM" definition would be more accurate but loses signal
// for users who don't push to true singles.
//
// Edge cases:
//   • No logs at all → returns null (caller hides the card).
//   • No logs this week, has prior weeks → returns null (no recap to show
//     — the streak-break / welcome-back nudges own that surface).
//   • Workout with no weights (bodyweight) → counted toward workouts/days
//     but volume stays 0 and PR detection skips zero-weight sets.

import { isAfter, subDays } from 'date-fns';

function calcVolumeLbs(logs) {
  let total = 0;
  for (const log of logs) {
    for (const ex of (log.exercises || [])) {
      for (const set of (ex.sets || [])) {
        const w = Number(set.weight) || 0;
        const r = Number(set.reps) || 0;
        total += w * r;
      }
    }
  }
  return total;
}

function extractDayKey(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function computeWeeklyRecap({ logs = [], cardioLogs = [], now = new Date() } = {}) {
  if (!Array.isArray(logs) || logs.length === 0) return null;

  const weekStart     = subDays(now, 7);
  const prevWeekStart = subDays(now, 14);

  const thisWeek  = [];
  const prevWeek  = [];
  const older     = [];
  for (const log of logs) {
    if (!log.date) continue;
    const d = new Date(log.date);
    if (isAfter(d, weekStart))            thisWeek.push(log);
    else if (isAfter(d, prevWeekStart))   prevWeek.push(log);
    else                                  older.push(log);
  }

  if (thisWeek.length === 0) return null;

  const thisVolume = calcVolumeLbs(thisWeek);
  const prevVolume = calcVolumeLbs(prevWeek);

  // Days active (distinct calendar days). Cardio logs count too — the
  // recap is about "did you move," not "did you lift."
  const dayKeys = new Set();
  for (const log of thisWeek) {
    const k = extractDayKey(log.date);
    if (k) dayKeys.add(k);
  }
  for (const log of (cardioLogs || [])) {
    if (!log.date) continue;
    if (isAfter(new Date(log.date), weekStart)) {
      const k = extractDayKey(log.date);
      if (k) dayKeys.add(k);
    }
  }

  // Heaviest single set this week — one display tile, conversation starter.
  let bestLift = null;
  for (const log of thisWeek) {
    for (const ex of (log.exercises || [])) {
      for (const set of (ex.sets || [])) {
        const w = Number(set.weight) || 0;
        const r = Number(set.reps) || 0;
        if (w > 0 && r > 0 && (!bestLift || w > bestLift.weight)) {
          bestLift = { name: ex.name, weight: w, reps: r };
        }
      }
    }
  }

  // PR detection: priorMax includes prevWeek + older. We compare against
  // an all-time max so a single freak week doesn't reset the baseline.
  const priorMax = new Map();
  for (const log of older.concat(prevWeek)) {
    for (const ex of (log.exercises || [])) {
      const key = (ex.name || '').toLowerCase().trim();
      if (!key) continue;
      for (const set of (ex.sets || [])) {
        const w = Number(set.weight) || 0;
        if (w > 0) priorMax.set(key, Math.max(priorMax.get(key) || 0, w));
      }
    }
  }
  const thisWeekMax = new Map();
  const thisWeekDisplayName = new Map();
  for (const log of thisWeek) {
    for (const ex of (log.exercises || [])) {
      const key = (ex.name || '').toLowerCase().trim();
      if (!key) continue;
      if (!thisWeekDisplayName.has(key)) thisWeekDisplayName.set(key, ex.name);
      for (const set of (ex.sets || [])) {
        const w = Number(set.weight) || 0;
        if (w > 0) thisWeekMax.set(key, Math.max(thisWeekMax.get(key) || 0, w));
      }
    }
  }
  const prs = [];
  for (const [key, w] of thisWeekMax.entries()) {
    const prior = priorMax.get(key) || 0;
    if (w > prior) {
      prs.push({
        name:         thisWeekDisplayName.get(key) || key,
        weight:       w,
        prevWeight:   prior,
        // Skip exercises we've never seen before — a PR on day 1 isn't
        // a PR, it's a starting weight. Only celebrate true improvements.
        isFirstTime:  prior === 0,
      });
    }
  }
  const realPRs = prs.filter(p => !p.isFirstTime)
                     .sort((a, b) => (b.weight - b.prevWeight) - (a.weight - a.prevWeight))
                     .slice(0, 3);

  // Volume delta as percent (null when prior week had nothing — no
  // meaningful baseline).
  const volumePct = prevVolume > 0
    ? Math.round(((thisVolume - prevVolume) / prevVolume) * 100)
    : null;

  return {
    workouts:       thisWeek.length,
    workoutsPrev:   prevWeek.length,
    workoutsDelta:  thisWeek.length - prevWeek.length,
    volumeLbs:      thisVolume,
    volumePrevLbs:  prevVolume,
    volumeDeltaLbs: thisVolume - prevVolume,
    volumePct,
    daysActive:     dayKeys.size,
    bestLift,
    prs: realPRs,
  };
}
