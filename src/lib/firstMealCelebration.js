// src/lib/firstMealCelebration.js
//
// The first time a user logs a meal (not just water) marks them
// engaging with the nutrition tracking surface — a separate
// onboarding momentum point from the workout / regimen / goal
// milestones.
//
// Each first-X helper picks a distinct vocabulary (haptic, confetti
// shape, palette) so a user who hits multiple milestones in their
// first session feels each one as its own moment rather than five
// identical celebrations.

import { toast } from 'sonner';
import * as Sentry from '@sentry/react';

// Warm fruit/vegetable palette — visually nutrition-coded so the
// moment reads as "you logged FOOD" even before the user looks at
// the toast.
const CONFETTI_COLORS = ['#ef4444', '#f59e0b', '#84cc16', '#16a34a', '#f97316', '#ec4899'];

/**
 * Fire the first-meal celebration. Safe to call from a mutation
 * onSuccess — every step is non-throwing.
 *
 * @param {Object} opts
 * @param {string} [opts.mealName]  - Used in the toast copy ("First meal: Chicken & rice").
 * @param {number} [opts.calories]  - If provided, shown in the toast.
 * @param {string} [opts.userEmail] - For Sentry user tag.
 */
export function fireFirstMealCelebration({ mealName, calories, userEmail } = {}) {
  // Short three-tap haptic — different rhythm from the other first-X
  // helpers so the haptic alone IDs which milestone fired.
  try { navigator.vibrate?.([12, 30, 12, 30, 12]); } catch { /* ignore */ }

  const calLine = (typeof calories === 'number' && calories > 0) ? ` · ${Math.round(calories)} cal` : '';
  const name = mealName ? `: ${mealName}` : '';
  toast.success(`🥗 First meal logged${name}${calLine}`, {
    description: "Nutrition tracking unlocks macro insights as you build up history.",
    duration: 6000,
  });

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (!reducedMotion) {
    import('canvas-confetti').then(({ default: confetti }) => {
      // Two bottom-corner bursts — yet another signature distinct from
      // the side / center / top-of-screen patterns the other helpers
      // use. "Bottom" reads as the food coming up onto the plate.
      confetti({ particleCount: 80, spread: 65, startVelocity: 45, origin: { x: 0.15, y: 0.85 }, colors: CONFETTI_COLORS });
      setTimeout(() => {
        confetti({ particleCount: 80, spread: 65, startVelocity: 45, origin: { x: 0.85, y: 0.85 }, colors: CONFETTI_COLORS });
      }, 180);
    }).catch(() => { /* decorative — skip on load failure */ });
  }

  try {
    Sentry.addBreadcrumb({
      category: 'nutrition',
      message: 'first-meal-logged',
      level: 'info',
      data: {
        mealName: mealName || null,
        calories: typeof calories === 'number' ? calories : null,
        userEmail: userEmail || null,
      },
    });
  } catch { /* ignore */ }
}
