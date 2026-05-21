// src/hooks/useComebackProtocol.js
//
// Detects when a user is returning after 7+ days of inactivity and signals
// the Workout page to show the Comeback Screen.
//
// Rules:
//   • Only triggers once per return window (stored in sessionStorage)
//   • Never triggers if the user has a paused/active session
//   • Requires at least 1 workout log to confirm the user isn't brand new
//   • Clears after the user completes or dismisses the comeback screen

import { useMemo } from 'react';
import { differenceInCalendarDays } from 'date-fns';

const SESSION_KEY = 'fn_comeback_dismissed';
const INACTIVITY_THRESHOLD_DAYS = 7;

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

/**
 * @param {Object} params
 * @param {Array}  params.workoutLogs  — all workout logs (most recent first)
 * @param {boolean} params.hasActiveSession — true if a paused session exists
 * @returns {{ triggered: boolean; daysSince: number; dismiss: () => void }}
 */
export function useComebackProtocol({ workoutLogs = [], hasActiveSession = false }) {
  const result = useMemo(() => {
    // Don't interrupt a paused session
    if (hasActiveSession) return { triggered: false, daysSince: 0 };

    // Not enough history to determine comeback
    if (workoutLogs.length === 0) return { triggered: false, daysSince: 0 };

    // Already dismissed this return window
    if (sessionStorage.getItem(SESSION_KEY) === 'true') return { triggered: false, daysSince: 0 };

    // Find most recent workout date
    const mostRecentLog = workoutLogs[0];
    if (!mostRecentLog?.date) return { triggered: false, daysSince: 0 };

    const logDate = parseLocalDate(mostRecentLog.date);
    if (!logDate || Number.isNaN(logDate.getTime())) {
      return { triggered: false, daysSince: 0 };
    }
    const daysSince = differenceInCalendarDays(new Date(), logDate);
    const triggered = daysSince >= INACTIVITY_THRESHOLD_DAYS;

    return { triggered, daysSince };
  }, [workoutLogs, hasActiveSession]);

  const dismiss = () => {
    try { sessionStorage.setItem(SESSION_KEY, 'true'); } catch {}
  };

  return { ...result, dismiss };
}
