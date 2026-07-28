// src/lib/trainingWeek.js
//
// Turns a list of workout logs into "did I train each day this week" plus a
// current streak.
//
// WHY BOTH FROM ONE SOURCE
// ────────────────────────
// `user_profiles.workout_streak` exists and is server-maintained, so the
// streak could come from there. It deliberately doesn't. The profile hero
// shows the week strip and the streak side by side, and two numbers derived
// from two different sources will eventually disagree — a server counter that
// ran at a different hour than the client's timezone says "12 days" next to a
// strip with a visible gap, and the user believes neither. One derivation
// means they can only ever agree.
//
// TIMEZONE
// ────────
// Everything is bucketed by the viewer's LOCAL calendar day. A workout logged
// at 11pm and one logged at 1am are different days to the person who did
// them, whatever UTC thinks.

/** Local YYYY-MM-DD for a Date. Not toISOString — that converts to UTC. */
function localDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * A log's date can be a bare 'YYYY-MM-DD' or a full timestamp. Bare dates are
 * already local calendar days and must NOT go through the Date constructor —
 * `new Date('2026-07-27')` parses as UTC midnight, which is the previous day
 * for anyone west of Greenwich, silently shifting half the world's workouts
 * back a square.
 */
function logDayKey(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const bare = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (bare && value.length <= 10) return bare[1];
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : localDayKey(d);
}

/**
 * Set of local day keys on which at least one workout was logged.
 * @param {Array} logs rows with a `date` field
 * @returns {Set<string>}
 */
export function trainedDayKeys(logs) {
  const out = new Set();
  for (const log of logs || []) {
    const key = logDayKey(log?.date);
    if (key) out.add(key);
  }
  return out;
}

/**
 * The seven days ending today, oldest first — a rolling week, not Mon–Sun.
 *
 * A fixed calendar week resets to empty every Monday, so a user who trains
 * Fri/Sat/Sun sees a full strip on Sunday night and a blank one on Monday
 * morning having done nothing wrong. Rolling keeps the last seven days'
 * worth of evidence visible at all times.
 *
 * @param {Array} logs
 * @param {Date} [now] injectable for tests
 * @param {string} [locale] for the weekday initial
 * @returns {Array<{key:string,label:string,trained:boolean,isToday:boolean}>}
 */
export function buildTrainingWeek(logs, now = new Date(), locale = undefined) {
  const trained = trainedDayKeys(logs);
  const todayKey = localDayKey(now);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = localDayKey(d);
    let label;
    try {
      label = new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(d);
    } catch {
      label = new Intl.DateTimeFormat('en', { weekday: 'narrow' }).format(d);
    }
    days.push({ key, label, trained: trained.has(key), isToday: key === todayKey });
  }
  return days;
}

/**
 * Consecutive days trained, counting back from today.
 *
 * Today NOT being trained does not break the streak — it hasn't happened yet.
 * A streak only dies once a full day passes with nothing in it, which is why
 * the walk starts at yesterday when today is empty. Getting this wrong means
 * telling someone at 9am that they've lost a 40-day streak they still have
 * all day to keep.
 *
 * @param {Array} logs
 * @param {Date} [now] injectable for tests
 * @returns {number}
 */
export function currentStreak(logs, now = new Date()) {
  const trained = trainedDayKeys(logs);
  if (trained.size === 0) return 0;

  const startOffset = trained.has(localDayKey(now)) ? 0 : 1;
  let streak = 0;
  for (let i = startOffset; i < 400; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    if (!trained.has(localDayKey(d))) break;
    streak += 1;
  }
  return streak;
}
