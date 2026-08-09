// src/lib/prCelebration.js
//
// Personal-record celebration. Fires when a workout save beats the
// user's historical best 1RM for at least one exercise (detected via
// detectPRsInWorkout in src/lib/data/personalRecords.js).
//
// 6th member of the celebration family alongside goal, first-workout,
// first-regimen, first-goal, first-meal. Each must have a DISTINCT
// signature (haptic + confetti + emoji + palette) so users feel each
// moment as its own thing instead of a generic "good job" repeat.
//
// PR-SPECIFIC SIGNATURE
// ─────────────────────
//   Emoji      🏋️  (strength/weight motif — distinct from 🏆 goal,
//                  🎉 first-workout, 💪 first-regimen, 🎯 first-goal,
//                  🥗 first-meal)
//   Haptic     [40, 80, 40, 80, 40, 80]  — heavy thuds, "weight"
//   Confetti   Single big top-center burst — peak/summit motif
//   Palette    Gold + crimson + amber — strength colors
//
// Unlike the "first-X" celebrations, PRs can fire multiple times per
// session if multiple exercises hit PRs in the same workout. We
// collapse them into one toast with a count, not N separate toasts.
//
// SHARE ACTION
// ────────────
// The toast includes a "Share" action button that fires an
// `OPEN_PR_SHARE_EVENT` window event. Workout.jsx (or any other
// listener) opens the PRShareCard dialog in response. This event-based
// indirection lets the React-free celebration helper hand off to a
// React component without coupling them at the import level.

import { toast } from '@/lib/toast';
import * as Sentry from '@sentry/react';

/**
 * Window event fired when the user taps "Share" on the PR celebration
 * toast. Detail shape: { pr: { displayName, oldPR, newPR, delta }, unit }
 *
 * Workout.jsx listens for this and pops the PRShareCard dialog.
 */
export const OPEN_PR_SHARE_EVENT = 'flexyn-open-pr-share';

// How long the toast stays up — longer than the regular workout-saved toast
// because the Share action needs a window big enough to be tappable.
// Exported and RETURNED because this helper is enqueued through rewardQueue,
// which holds the next celebration for exactly this long so the toasts never
// stack. This is also why the value must not be truncated to tighten the
// sequence: shortening it shortens the window to tap Share.
export const TOAST_MS = 8000;

// Gold / crimson / amber — strength colors. Distinct from:
//   goal:           green/yellow
//   first-workout:  orange/green/blue/purple (rainbow)
//   first-regimen:  purple/pink
//   first-goal:     blue/teal
//   first-meal:     warm food (terracotta/avocado)
const CONFETTI_COLORS = ['#fbbf24', '#f59e0b', '#dc2626', '#b45309', '#fde68a', '#ffffff'];

/**
 * Fire the PR celebration. Safe to call from mutation onSuccess —
 * every step is non-throwing.
 *
 * @param {object}  opts
 * @param {Array}   opts.prs        — array of { displayName, oldPR, newPR, delta } from detectPRsInWorkout
 * @param {string}  [opts.unit='lb'] — weight unit for the toast copy
 * @param {string}  [opts.userEmail] — Sentry tag
 */
export function firePRCelebration({ prs = [], unit = 'lb', userEmail } = {}) {
  // 0, not undefined: nothing was shown, so the queue should fall through to
  // its confetti/haptic floor rather than holding a full toast duration for a
  // celebration that never rendered.
  if (!Array.isArray(prs) || prs.length === 0) return 0;

  // Heavy-thud haptic — distinct from the lighter / longer patterns
  // used by goal / first-workout / first-meal celebrations.
  try { navigator.vibrate?.([40, 80, 40, 80, 40, 80]); } catch { /* ignore */ }

  // Toast copy: lead with the best PR (highest delta) and append a
  // count if there were multiple. A workout that breaks 3 PRs simul-
  // taneously is rare but exciting — we surface that.
  const sorted = [...prs].sort((a, b) => (b.delta || 0) - (a.delta || 0));
  const top = sorted[0];
  const extraCount = prs.length - 1;
  const newPRRounded = Math.round(top.newPR);
  const deltaRounded = Math.round((top.delta || 0) * 10) / 10;

  let title = `🏋️ New PR — ${top.displayName}: ${newPRRounded} ${unit}`;
  if (extraCount > 0) {
    title += extraCount === 1 ? ' (+1 more PR)' : ` (+${extraCount} more PRs)`;
  }

  toast.success(title, {
    description: deltaRounded > 0
      ? `Up +${deltaRounded} ${unit} from your previous best.`
      : 'You just topped your previous best.',
    duration: TOAST_MS,
    action: {
      label: 'Share',
      onClick: () => {
        // Dispatch the open-share event with the top PR. Workout.jsx
        // listens for this and opens PRShareCard. Don't couple this
        // helper to React state by importing the modal here.
        try {
          window.dispatchEvent(new CustomEvent(OPEN_PR_SHARE_EVENT, {
            detail: { pr: top, unit },
          }));
        } catch { /* SSR / no DOM — skip */ }
      },
    },
  });

  // Confetti — single big top-center burst symbolizing "peak hit".
  // Skipped under prefers-reduced-motion.
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (!reducedMotion) {
    import('canvas-confetti').then(({ default: confetti }) => {
      // First wave: big drop from center-top.
      confetti({
        particleCount: 160,
        spread:        100,
        startVelocity: 50,
        origin:        { x: 0.5, y: 0.2 },
        colors:        CONFETTI_COLORS,
        ticks:         220,
      });
      // Follow-up at 180 ms — staggered for a "weighty" feel rather
      // than a single instant pop.
      setTimeout(() => {
        confetti({
          particleCount: 60,
          spread:        60,
          startVelocity: 35,
          origin:        { x: 0.5, y: 0.35 },
          colors:        CONFETTI_COLORS,
        });
      }, 180);
    }).catch(() => { /* decorative — skip on load failure */ });
  }

  // Sentry breadcrumb for funnel analytics — same shape as the other
  // celebration helpers so we can stack them in one dashboard query.
  try {
    Sentry.addBreadcrumb({
      category: 'workout',
      message: 'pr-hit',
      level: 'info',
      data: {
        prCount: prs.length,
        topExercise: top.displayName,
        delta: deltaRounded,
        userEmail: userEmail || null,
      },
    });
  } catch { /* ignore */ }

  // Tells rewardQueue how long to hold before the next celebration.
  return TOAST_MS;
}
