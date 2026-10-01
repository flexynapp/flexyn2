// src/lib/workoutSuggestion.js
//
// Pure-client suggestion for tomorrow's focus based on the user's last
// 7 days of workouts. Looks at muscle-group coverage and recommends
// the under-trained group OR a recovery day when everything has been
// hit.
//
// NOT AI — deterministic heuristic that runs in <1ms on the user's
// existing workout log array. Stateless / no DB calls. The "smart"
// label is earned by the heuristic being correct most of the time
// without the cost / latency / vendor lock-in of an LLM round-trip.
//
// SUGGESTION SHAPE
// ────────────────
//   { focus: 'legs' | 'chest' | 'back' | 'shoulders' | 'arms' |
//            'core' | 'cardio' | 'recovery',
//     reason: English sentence; reasonKey + reasonVars translate it
//       (group vars are slugs, the card names them via suggestion.group.*),
//     intensity: 'light' | 'medium' | 'heavy' }
//
// Returns null when there's not enough data (< 2 workouts in the past
// 7 days) — the card should hide rather than show a guess based on
// noise.

import { differenceInCalendarDays } from 'date-fns';

// Muscle group → top-level focus mapping. Granular muscles
// (biceps/triceps) collapse to a parent group so we don't fragment
// the coverage analysis.
const GROUP_NORMALIZE = {
  legs:        'legs',
  quads:       'legs',
  hamstrings:  'legs',
  glutes:      'legs',
  calves:      'legs',
  chest:       'chest',
  pecs:        'chest',
  back:        'back',
  lats:        'back',
  traps:       'back',
  shoulders:   'shoulders',
  delts:       'shoulders',
  arms:        'arms',
  biceps:      'arms',
  triceps:     'arms',
  forearms:    'arms',
  core:        'core',
  abs:         'core',
  obliques:    'core',
};

const ALL_FOCUSES = ['legs', 'chest', 'back', 'shoulders', 'arms', 'core'];

function normalizeGroup(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase().trim();
  return GROUP_NORMALIZE[key] || null;
}

/**
 * Compute tomorrow's suggestion from a workout-log array.
 *
 * @param {object} input
 * @param {Array}  input.logs        Workout logs sorted any order.
 * @param {Array}  [input.cardioLogs] Cardio logs (for recovery rotation).
 * @param {Date}   [input.now]       Override for testing.
 * @returns {{focus: string, reason: string, intensity: string} | null}
 */
export function computeSuggestion({ logs = [], cardioLogs = [], now = new Date() }) {
  if (!Array.isArray(logs) || logs.length < 2) return null;

  // Filter to last 7 days.
  const recent = logs.filter((log) => {
    const d = new Date(log.date || log.created_at || log.created_date || 0);
    if (Number.isNaN(d.getTime())) return false;
    const diff = differenceInCalendarDays(now, d);
    return diff >= 0 && diff <= 7;
  });
  if (recent.length < 2) return null;

  // Count muscle-group sessions in the window.
  const groupCounts = Object.fromEntries(ALL_FOCUSES.map(f => [f, 0]));
  let strengthSessions = 0;

  for (const log of recent) {
    strengthSessions += 1;
    const groupsThisLog = new Set();
    for (const ex of log.exercises || []) {
      // Two possible shapes: `muscle_group` (string) or `muscle_groups`
      // (array). Handle both.
      const groups = Array.isArray(ex.muscle_groups) && ex.muscle_groups.length
        ? ex.muscle_groups
        : ex.muscle_group ? [ex.muscle_group] : [];
      for (const g of groups) {
        const norm = normalizeGroup(g);
        if (norm) groupsThisLog.add(norm);
      }
    }
    for (const g of groupsThisLog) {
      groupCounts[g] = (groupCounts[g] || 0) + 1;
    }
  }

  // Days since last workout — recovery suggestion when the user just
  // hit a heavy day (worked 4+ muscle groups in their most recent log).
  const sorted = [...recent].sort((a, b) => {
    const da = new Date(a.date || a.created_at || a.created_date || 0).getTime();
    const db = new Date(b.date || b.created_at || b.created_date || 0).getTime();
    return db - da;
  });
  const lastLog = sorted[0];
  const lastLogDate = new Date(lastLog.date || lastLog.created_at || lastLog.created_date || 0);
  const daysSinceLast = differenceInCalendarDays(now, lastLogDate);

  // Heavy day check: 4+ distinct muscle groups in the most recent log.
  const lastLogGroups = new Set();
  for (const ex of lastLog.exercises || []) {
    const groups = Array.isArray(ex.muscle_groups) && ex.muscle_groups.length
      ? ex.muscle_groups
      : ex.muscle_group ? [ex.muscle_group] : [];
    for (const g of groups) {
      const norm = normalizeGroup(g);
      if (norm) lastLogGroups.add(norm);
    }
  }
  const lastWasHeavy = lastLogGroups.size >= 4;

  // If they just hit a heavy day yesterday or today → recovery suggestion.
  if (daysSinceLast <= 1 && lastWasHeavy) {
    const hasCardio = (cardioLogs || []).some((c) => {
      const d = new Date(c.date || c.created_at || 0);
      return !Number.isNaN(d.getTime()) && differenceInCalendarDays(now, d) <= 2;
    });
    return {
      focus: hasCardio ? 'recovery' : 'cardio',
      reason: hasCardio
        ? 'You hit a heavy day. Take a recovery walk or a mobility session.'
        : 'You hit a heavy day. Light cardio is the right next move.',
      reasonKey: hasCardio ? 'suggestion.why.heavyRecovery' : 'suggestion.why.heavyCardio',
      reasonVars: {},
      intensity: 'light',
    };
  }

  // Find the LEAST-trained group across the focus list. Tie-break by
  // a stable canonical order so suggestions don't oscillate randomly.
  let leastGroup = null;
  let leastCount = Infinity;
  for (const f of ALL_FOCUSES) {
    const c = groupCounts[f] || 0;
    if (c < leastCount) {
      leastCount = c;
      leastGroup = f;
    }
  }

  // If the user has trained the under-trained group ZERO times this
  // week, recommend it with high confidence.
  if (leastCount === 0) {
    return {
      focus: leastGroup,
      reason: `You haven't trained ${leastGroup} this week. Try ${leastGroup} tomorrow.`,
      reasonKey: 'suggestion.why.untrained',
      reasonVars: { group: leastGroup },
      intensity: 'medium',
    };
  }

  // Otherwise recommend the under-trained group as a balance correction.
  // Find the most-trained group for the contrastive copy.
  let mostGroup = null;
  let mostCount = -1;
  for (const f of ALL_FOCUSES) {
    const c = groupCounts[f] || 0;
    if (c > mostCount) {
      mostCount = c;
      mostGroup = f;
    }
  }

  return {
    focus: leastGroup,
    reason: mostGroup && mostCount > leastCount
      ? `You've trained ${mostGroup} ${mostCount}× this week. Balance it with ${leastGroup} tomorrow.`
      : `Your least trained group this week is ${leastGroup}. Try it tomorrow.`,
    reasonKey: mostGroup && mostCount > leastCount ? 'suggestion.why.balance' : 'suggestion.why.least',
    reasonVars: mostGroup && mostCount > leastCount
      ? { most: mostGroup, n: mostCount, group: leastGroup }
      : { group: leastGroup },
    intensity: 'medium',
  };
}
