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
import { differenceInDays } from 'date-fns';

const SESSION_KEY = 'fn_comeback_dismissed';
const INACTIVITY_THRESHOLD_DAYS = 7;

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

    const daysSince = differenceInDays(new Date(), new Date(mostRecentLog.date));
    const triggered = daysSince >= INACTIVITY_THRESHOLD_DAYS;

    return { triggered, daysSince };
  }, [workoutLogs, hasActiveSession]);

  const dismiss = () => {
    try { sessionStorage.setItem(SESSION_KEY, 'true'); } catch {}
  };

  return { ...result, dismiss };
}
