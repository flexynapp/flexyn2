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
// the confetti collides. This queue serializes them so each moment
// registers individually — the gym brain can only celebrate one
// thing at a time.
//
// ── Why the spacing is no longer a flat 700ms ────────────────────
// It was, and for the toasts that was a stagger rather than spacing.
// Celebration toasts live 4500–8000ms, so at 700ms the second one
// always appeared while the first still had 3.8–7.3s left to run.
// Sonner then stacks them — and since <Toaster> sets no `expand`, it
// collapses the stack (scale .95/.90, y −14/−28) and only expands on
// HOVER, which a phone does not have. So the second celebration was a
// sliver behind the first for up to eight seconds, and the queue's own
// header comment claimed it was preventing exactly that.
//
// The 700ms WAS doing real work for the confetti and the haptics: two
// bursts 700ms apart read as two moments rather than one mess. That is
// kept as a floor. What changed is that the hold now defaults to the
// celebration's own toast duration, which the helper returns, so the
// toast is gone before the next one arrives.
//
// A helper that returns nothing gets DEFAULT_HOLD_MS — deliberately the
// longest celebration toast in the app, so an un-annotated helper errs
// toward dead air rather than back toward stacking.
//
// Use as fire-and-forget: enqueue(() => fireFooCelebration({...})).
// The queue auto-drains; nothing to clean up.

const QUEUE = [];
let draining = false;
let drainTimerId = null;
const MIN_HOLD_MS = 700;      // confetti/haptic separation — the old spacing
const DEFAULT_HOLD_MS = 8000; // longest celebration toast (PR, crew win)

function drain() {
  if (draining || QUEUE.length === 0) return;
  draining = true;
  const fn = QUEUE.shift();
  // Read the hold SYNCHRONOUSLY from the return value rather than awaiting
  // it. Awaiting would let a slow celebration stall the whole queue, which
  // is the opposite of what this exists for — the helpers declare a
  // duration and do their confetti/Sentry work fire-and-forget.
  let hold = DEFAULT_HOLD_MS;
  try {
    const declared = fn();
    // >= 0, not > 0: a helper that bailed without showing a toast returns 0,
    // and must fall through to MIN_HOLD_MS rather than to the 8s default.
    if (Number.isFinite(declared) && declared >= 0) {
      hold = declared;
    } else if (declared && typeof declared.catch === 'function') {
      declared.catch(() => { /* non-critical */ });
    }
  } catch { /* non-critical */ }
  // Track the timer ID so a hard-reset can cancel pending spacing
  // and stop the queue from firing more celebrations after the user
  // has navigated away. Previous version started an untracked
  // setTimeout per item, leaking the timer across SPA navigation —
  // a delayed celebration toast would surface on the destination
  // page mid-render.
  drainTimerId = setTimeout(() => {
    drainTimerId = null;
    draining = false;
    drain();
  }, Math.max(MIN_HOLD_MS, hold));
}

/**
 * Enqueue a celebration. Fires after any in-flight celebrations
 * resolve + the spacing window elapses.
 *
 * @param {Function} fn — sync or async, should fire the celebration
 *                        side-effect (toast + confetti + haptic).
 *                        RETURN the toast's duration in ms and the queue
 *                        holds the next celebration until it has cleared;
 *                        return nothing and it falls back to
 *                        DEFAULT_HOLD_MS. Returning a number is what stops
 *                        the toasts stacking — see the note at the top.
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
  if (drainTimerId != null) {
    clearTimeout(drainTimerId);
    drainTimerId = null;
  }
}
