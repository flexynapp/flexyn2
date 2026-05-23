// src/hooks/useWorkoutSessions.js
//
// Per-device paused-workout drafts. When a user starts a workout and
// navigates away without saving, the Workout page's unmount cleanup
// flushes the in-flight state to localStorage via pauseWorkoutSync.
// On their next Dashboard visit, ResumeWorkoutBanner offers to
// continue from the snapshot.
//
// PER-USER NAMESPACE — IMPORTANT
// ──────────────────────────────
// The localStorage key is keyed by userId (`paused_workouts.<userId>`)
// so two users sharing a device (family phone, sign in/out) cannot see
// or resume each other's paused workouts. Otherwise User A starts a
// workout, signs out; User B signs in; the Dashboard banner reveals
// User A's regimen name + exercise list + sets logged so far, with a
// "Resume" CTA that would let User B continue/save User A's workout
// under User B's email — a real privacy + data-integrity leak.
//
// Matches the CLAUDE.md `flexyn.<feature>.<userId>` convention used by
// the rest-day key, onboarding state, dashboard widgets, etc.
//
// Anonymous fallback ('paused_workouts.anon') is provided for the
// pre-auth render window — those drafts are evicted on next read for
// any signed-in user.

import { useState, useCallback, useEffect } from 'react';

const KEY = (userId) => `paused_workouts.${userId || 'anon'}`;

// One-shot migration from the legacy global key. If older drafts
// were written to the un-namespaced 'paused_workouts' key (pre-fix),
// move them under the current user's namespace on first read and
// delete the legacy key. Subsequent users on the same device get a
// clean slate.
function migrateLegacy(userId) {
  if (!userId) return;
  try {
    const legacy = localStorage.getItem('paused_workouts');
    if (legacy == null) return;
    const existing = localStorage.getItem(KEY(userId));
    if (existing == null) {
      localStorage.setItem(KEY(userId), legacy);
    }
    localStorage.removeItem('paused_workouts');
  } catch { /* best-effort */ }
}

function readStorage(userId) {
  migrateLegacy(userId);
  try {
    return JSON.parse(localStorage.getItem(KEY(userId)) || '[]');
  } catch {
    return [];
  }
}

function writeStorage(userId, sessions) {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(sessions));
  } catch {
    // ignore quota errors
  }
}

// Synchronously upsert a session into localStorage — safe to call from
// an unmount effect. The Workout page passes its current user.id at
// the call site since this function runs outside React context.
export function pauseWorkoutSync(userId, workout) {
  const sessions = readStorage(userId);
  const idx = sessions.findIndex(s => s.id === workout.id);
  if (idx >= 0) {
    sessions[idx] = workout;
  } else {
    sessions.push(workout);
  }
  writeStorage(userId, sessions);
}

export function useWorkoutSessions(userId) {
  const [sessions, setSessions] = useState(() => readStorage(userId));

  // Re-read when the user resolves or changes. The initial state above
  // captures the value at first render; if auth loads after mount we
  // need to swap to that user's drafts.
  useEffect(() => {
    setSessions(readStorage(userId));
  }, [userId]);

  // Keep in sync if another tab or the sync function writes to localStorage
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === KEY(userId) || e.key === null) {
        setSessions(readStorage(userId));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userId]);

  const pauseWorkout = useCallback((workout) => {
    pauseWorkoutSync(userId, workout);
    setSessions(readStorage(userId));
  }, [userId]);

  const resumeWorkout = useCallback((id) => {
    const sessions = readStorage(userId);
    return sessions.find(s => s.id === id) || null;
  }, [userId]);

  const removeSession = useCallback((id) => {
    const sessions = readStorage(userId);
    writeStorage(userId, sessions.filter(s => s.id !== id));
    setSessions(readStorage(userId));
  }, [userId]);

  return { sessions, pauseWorkout, resumeWorkout, removeSession };
}
