// src/lib/firstWorkoutCelebration.js
//
// The first workout a user ever logs is the most important milestone in
// the onboarding journey — it converts "I downloaded the app" into "I'm
// using the app." Treating it like every other workout (a small toast)
// massively under-rewards the moment.
//
// This helper fires a louder celebration ONLY on the first-ever workout.
// Subsequent saves keep the existing quieter feedback (the regular
// workout-saved toast in Workout.jsx).
//
// Same shape as fireGoalCelebration: confetti + haptic + a real toast
// + Sentry breadcrumb. Different copy and a bigger confetti volume so
// the moment feels distinct.

import { toast } from '@/lib/toast';
import * as Sentry from '@sentry/react';

const CONFETTI_COLORS = ['#f97316', '#fb923c', '#fbbf24', '#22c55e', '#3b82f6', '#a855f7'];

/**
 * Fire the first-workout celebration. Safe to call from mutation
 * onSuccess — every step is non-throwing.
 *
 * @param {Object} opts
 * @param {number} [opts.xpGained]      - XP awarded by the save flow.
 * @param {string} [opts.userEmail]     - For Sentry user tag.
 */
// How long the toast stays up. Exported and RETURNED because this helper is
// enqueued through rewardQueue, which holds the next celebration for exactly
// this long so the two toasts never stack. Change it here and the queue
// follows; hard-code it in the toast call and the queue silently goes back
// to overlapping them.
export const TOAST_MS = 6000;

export function fireFirstWorkoutCelebration({ xpGained = 0, userEmail } = {}) {
  // Triple buzz then a longer pulse — distinct from goal-completion
  // (15/50/15) so a returning user can tell which milestone fired.
  try { navigator.vibrate?.([20, 60, 20, 60, 80]); } catch { /* ignore */ }

  const xpLine = xpGained > 0 ? ` · +${xpGained} XP` : '';
  toast.success(`🎉 First workout logged${xpLine}`, {
    description: "You're officially training with Flexyn. Keep the momentum going.",
    duration: TOAST_MS,
  });

  // Skip confetti if the user opted out of motion.
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (!reducedMotion) {
    import('canvas-confetti').then(({ default: confetti }) => {
      // Three bursts — heavier than goal-completion (which fires two)
      // because this is THE onboarding-defining moment.
      confetti({ particleCount: 120, spread: 90, origin: { x: 0.5, y: 0.6 }, colors: CONFETTI_COLORS });
      setTimeout(() => {
        confetti({ particleCount: 100, spread: 80, origin: { x: 0.2, y: 0.55 }, colors: CONFETTI_COLORS });
      }, 200);
      setTimeout(() => {
        confetti({ particleCount: 100, spread: 80, origin: { x: 0.8, y: 0.55 }, colors: CONFETTI_COLORS });
      }, 380);
    }).catch(() => { /* decorative — skip on load failure */ });
  }

  // Sentry breadcrumb — gives us a first-conversion funnel metric
  // without standing up a separate analytics pipeline.
  try {
    Sentry.addBreadcrumb({
      category: 'workout',
      message: 'first-workout-logged',
      level: 'info',
      data: { xpGained, userEmail: userEmail || null },
    });
  } catch { /* ignore */ }

  // Tells rewardQueue how long to hold before the next celebration.
  return TOAST_MS;
}
