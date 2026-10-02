// src/lib/activeSession.js
//
// "Is the user in the middle of training right now?" — one answer for the
// whole app, so anything that wants to interrupt (the first-week check-in
// sheet today) can wait instead.
//
// Each surface that runs a live session marks itself while it does: the
// workout logger while a workout is started, the live cardio trackers while
// tracking or paused. A paused workout saved to the resume banner is NOT
// active; the user has left it.
//
// Plain module state plus a listener set, so it has no imports and is safe
// in any test.

import { useEffect } from 'react';

const active = new Set();
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try { fn(active.size > 0); } catch { /* a listener's failure is its own */ }
  }
}

export function setSessionActive(key, on) {
  const had = active.has(key);
  if (on && !had) active.add(key);
  else if (!on && had) active.delete(key);
  else return;
  emit();
}

export function isSessionActive() {
  return active.size > 0;
}

/** Calls fn(isActive) whenever the answer changes. Returns an unsubscribe. */
export function onSessionActiveChange(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Marks `key` active while `on` is true and clears it on unmount. */
export function useMarkSessionActive(key, on) {
  useEffect(() => {
    setSessionActive(key, !!on);
    return () => setSessionActive(key, false);
  }, [key, on]);
}

/** Test helper. */
export function _resetActiveSessions() {
  active.clear();
  listeners.clear();
}
