// src/hooks/useComebackProtocol.js
//
// Detects when a user is returning after a real absence and signals the
// Workout page to show the Comeback Screen.
//
// Rules:
//   • Triggers only after MORE THAN 72 HOURS away (kegan, 2026-08-16)
//   • Only triggers once per return window (stored in sessionStorage)
//   • Never triggers if the user has a paused/active session
//   • Requires at least 1 workout log to confirm the user isn't brand new
//   • Clears after the user completes or dismisses the comeback screen

import { useCallback, useMemo, useState } from 'react';
import { differenceInCalendarDays, endOfDay, isSameDay } from 'date-fns';

const INACTIVITY_THRESHOLD_HOURS = 72;

// Per-device dismissal, namespaced per the `flexyn.<feature>.<userId>`
// convention. It used to be one global `fn_comeback_dismissed` key, which
// meant signing out and back in as someone else in the same tab inherited
// the previous account's dismissal — the second user's comeback screen was
// suppressed by a decision they never made.
function storageKey(userId) {
  return `flexyn.comebackDismissed.${userId || 'anon'}`;
}

function readDismissed(userId) {
  try { return sessionStorage.getItem(storageKey(userId)) === 'true'; }
  catch { return false; }
}

// Parse a 'YYYY-MM-DD' date string as a LOCAL calendar date, not UTC.
// `new Date('2026-05-15')` returns midnight UTC, which makes the
// differenceInDays() result jump by one in negative UTC offsets — users
// in UTC-12 saw the comeback screen ~12 hours early, users in UTC+ saw
// it late. Comparing local-calendar dates lines the threshold up with
// the user's perception of "7 days ago."
function parseLocalDate(s) {
  if (!s) return null;
  if (typeof s === 'string') {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(s);
}

// Resolve the instant a logged session actually happened.
//
// `workout_logs.date` is a DATE column, so on its own it cannot answer a
// question posed in hours: a log dated two calendar days ago is anywhere
// between 24 and 72 hours old depending on the hour it happened and the
// hour you ask. `created_at` IS a timestamptz and `db.entities` selects
// `*`, so it is on every row we hold.
//
// Use it when the log was RECORDED on the day it happened — then it is the
// session's own instant. A backfilled log (recorded on a later calendar
// day) tells us nothing about the hour, so fall back to the END of `date`:
// the latest the session could possibly have been, and therefore the only
// assumption that can never fire this screen early. Showing "it's been 2
// days" to someone who trained 30 hours ago is the failure that matters.
function lastTrainedAt(log) {
  const day = parseLocalDate(log?.date);
  if (!day || Number.isNaN(day.getTime())) return null;

  const created = log?.created_at ? new Date(log.created_at) : null;
  if (created && !Number.isNaN(created.getTime()) && isSameDay(created, day)) {
    return { instant: created, day };
  }
  return { instant: endOfDay(day), day };
}

/**
 * @param {Object} params
 * @param {Array}  params.workoutLogs  — all workout logs
 * @param {boolean} params.hasActiveSession — true if a paused session exists
 * @param {string} params.userId — scopes the dismissal flag to this account
 * @returns {{ triggered: boolean; daysSince: number; dismiss: () => void }}
 */
export function useComebackProtocol({ workoutLogs = [], hasActiveSession = false, userId } = {}) {
  // Dismissal has to be REACT STATE, not sessionStorage alone.
  //
  // This was the bug that made both buttons on the screen dead. `dismiss()`
  // wrote the flag and nothing else, while `triggered` came from a useMemo
  // over [workoutLogs, hasActiveSession] that read storage inside itself.
  // Neither dep changes when you dismiss, and `logs` in Workout.jsx is a
  // memoized array with a stable reference, so the memo never re-ran: the
  // flag was set, `triggered` stayed true, and the overlay never came down.
  // Tapping either button did nothing visible.
  //
  // The hook's own test passed throughout because it re-rendered with a
  // FRESH array literal, which changes the reference and forces the recompute
  // that production never gets.
  const [dismissTick, setDismissTick] = useState(0);

  const result = useMemo(() => {
    // Don't interrupt a paused session
    if (hasActiveSession) return { triggered: false, daysSince: 0 };

    // Not enough history to determine comeback
    if (workoutLogs.length === 0) return { triggered: false, daysSince: 0 };

    // Already dismissed this return window. Read inside the memo so a late
    // `userId` (auth resolves after first render) re-checks the right key.
    if (readDismissed(userId)) return { triggered: false, daysSince: 0 };

    // Most recent session across the whole list rather than logs[0]. The
    // caller sorts by `-date`, but that is a DATE sort with arbitrary
    // ordering inside a day, and an unsorted list would otherwise let an
    // ancient log claim a months-long absence.
    let latest = null;
    for (const log of workoutLogs) {
      const t = lastTrainedAt(log);
      if (t && (!latest || t.instant > latest.instant)) latest = t;
    }
    if (!latest) return { triggered: false, daysSince: 0 };

    const now = new Date();
    const hoursSince = (now.getTime() - latest.instant.getTime()) / 3_600_000;
    const daysSince = differenceInCalendarDays(now, latest.day);

    return { triggered: hoursSince > INACTIVITY_THRESHOLD_HOURS, daysSince };
    // `dismissTick` is not read in the body on purpose: it is the recompute
    // signal for dismiss(), which changes no other input. Removing it from
    // this list restores the dead-button bug described above.
  }, [workoutLogs, hasActiveSession, userId, dismissTick]);

  const dismiss = useCallback(() => {
    try { sessionStorage.setItem(storageKey(userId), 'true'); } catch {}
    setDismissTick((t) => t + 1);
  }, [userId]);

  return { ...result, dismiss };
}
