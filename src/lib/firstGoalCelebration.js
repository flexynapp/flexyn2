// src/lib/firstGoalCelebration.js
//
// Setting a first goal is a commitment moment — the user is declaring
// what success looks like for them. Treating it like every other goal
// save (a plain "Goal created" toast) under-rewards it. This helper
// fires a distinct celebration the first time a user creates a goal.
//
// Separate from fireGoalCelebration (which fires on goal COMPLETION).
// The vocabulary (haptic, confetti pattern, copy) is chosen to be
// distinguishable from goal-completion + first-workout + first-regimen
// so a returning user feels each milestone as its own moment.

import { toast } from '@/lib/toast';
import * as Sentry from '@sentry/react';
import { asT } from '@/lib/translatorArg';

// Blue/teal palette — distinct from other first-X celebrations
// (first-workout = orange/green, first-regimen = purple/pink,
// goal-completion = green/yellow) so the visual identity is clear.
const CONFETTI_COLORS = ['#0ea5e9', '#06b6d4', '#14b8a6', '#22d3ee', '#3b82f6'];

/**
 * Fire the first-goal celebration. Safe to call from a mutation
 * onSuccess — every step is non-throwing.
 *
 * @param {Object} opts
 * @param {string} [opts.targetSummary] - Short label of what the goal targets
 *   (e.g. "Bench Press 225 lb"). Falls back to a generic phrase if missing.
 * @param {string} [opts.userEmail]     - For Sentry user tag.
 */
export function fireFirstGoalCelebration({ targetSummary, userEmail, t } = {}) {
  const tf = asT(t);
  // Single sharp pulse + a longer one — distinct from the multi-pulse
  // patterns used by the other first-X celebrations.
  try { navigator.vibrate?.([10, 30, 80]); } catch { /* ignore */ }

  const label = targetSummary ? `: ${targetSummary}` : '';
  toast.success(`🎯 First goal set${label}`, {
    description: tf('celebration.firstGoal.body', 'Log workouts that match the target and we’ll track your progress automatically.'),
    duration: 6000,
  });

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (!reducedMotion) {
    import('canvas-confetti').then(({ default: confetti }) => {
      // Single top-of-screen burst with high spread — visually different
      // from the side-bursts other first-X celebrations use, so this
      // moment reads as its own thing.
      confetti({
        particleCount: 110,
        spread: 100,
        startVelocity: 38,
        origin: { x: 0.5, y: 0.3 },
        colors: CONFETTI_COLORS,
      });
    }).catch(() => { /* decorative — skip on load failure */ });
  }

  try {
    Sentry.addBreadcrumb({
      category: 'goal',
      message: 'first-goal-created',
      level: 'info',
      data: { targetSummary: targetSummary || null, userEmail: userEmail || null },
    });
  } catch { /* ignore */ }
}
