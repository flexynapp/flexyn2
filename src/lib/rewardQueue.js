// src/lib/rewardQueue.js
//
// A serial queue for post-workout celebrations. Multiple
// celebration helpers can fire simultaneously when a workout
// concludes:
//   • PR celebration (heaviest lift improved)
//   • Streak milestone (just hit day 30/60/100)
//   • Daily quest completion
//   • Achievement unlock (10/50/100 workouts)
//   • Capsule grant (first workout / level up)
//
// Firing them all at once stacks toasts on top of each other and
// the confetti collides. This queue serializes them with ~700ms
// spacing so each moment registers individually — the gym brain
// can only celebrate one thing at a time.
//
// Use as fire-and-forget: enqueue(() => fireFooCelebration({...})).
// The queue auto-drains; nothing to clean up.

const QUEUE = [];
let draining = false;
const SPACING_MS = 700;

function drain() {
  if (draining || QUEUE.length === 0) return;
  draining = true;
  const fn = QUEUE.shift();
  try {
    Promise.resolve(fn()).catch(() => { /* non-critical */ });
  } catch { /* non-critical */ }
  setTimeout(() => {
    draining = false;
    drain();
  }, SPACING_MS);
}

/**
 * Enqueue a celebration. Fires after any in-flight celebrations
 * resolve + the spacing window elapses.
 *
 * @param {Function} fn — sync or async, should fire the celebration
 *                        side-effect (toast + confetti + haptic).
 */
export function enqueueReveal(fn) {
  if (typeof fn !== 'function') return;
  QUEUE.push(fn);
  drain();
}

/** Test-only — clear the queue without firing the remaining items. */
export function _clearRewardQueue() {
  QUEUE.length = 0;
  draining = false;
}
