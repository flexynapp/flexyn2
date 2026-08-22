// src/lib/firstRegimenCelebration.js
//
// Same shape as fireFirstWorkoutCelebration: when the user creates
// their first-ever regimen, fire a louder celebration than the
// regular "Saved!" toast. Creating a personalized plan is a key
// onboarding moment — the difference between "I downloaded the app"
// and "I'm building something." It deserves real feedback.
//
// Distinct from goal-completion + first-workout vocabulary so a
// returning user can tell which milestone fired.

import { toast } from '@/lib/toast';
import * as Sentry from '@sentry/react';
import { asT } from '@/lib/translatorArg';

// Slightly different palette from first-workout so the haptic + color
// language helps distinguish the two milestones for power users who
// hit them in quick succession during their first session.
const CONFETTI_COLORS = ['#a855f7', '#ec4899', '#fb923c', '#f97316', '#22c55e'];

/**
 * Fire the first-regimen celebration. Safe to call from a mutation
 * onSuccess — every step is non-throwing.
 *
 * @param {Object} opts
 * @param {string} [opts.regimenName] - Used in the toast copy.
 * @param {number} [opts.xpGained]    - XP awarded by the save flow.
 * @param {string} [opts.userEmail]   - For Sentry user tag.
 */
export function fireFirstRegimenCelebration({ regimenName, xpGained = 0, userEmail, t } = {}) {
  const tf = asT(t);
  // Two-pulse haptic — gentler than first-workout (three pulses) since
  // saving a regimen is a quieter milestone than completing a workout.
  try { navigator.vibrate?.([15, 45, 15, 45]); } catch { /* ignore */ }

  const xpLine = xpGained > 0 ? ` · +${xpGained} XP` : '';
  const name = regimenName ? `"${regimenName}"` : 'your first regimen';
  toast.success(`💪 First plan saved — ${name}${xpLine}`, {
    description: tf('celebration.firstRegimen.body', 'Tap Start on the card to begin your first session.'),
    duration: 6000,
  });

  // Skip confetti if the user opted out of motion.
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (!reducedMotion) {
    import('canvas-confetti').then(({ default: confetti }) => {
      // Two side-bursts, no center burst — that's first-workout's
      // signature. Keeps the celebration vocabulary distinct.
      confetti({ particleCount: 90, spread: 70, origin: { x: 0.2, y: 0.6 }, colors: CONFETTI_COLORS });
      setTimeout(() => {
        confetti({ particleCount: 90, spread: 70, origin: { x: 0.8, y: 0.6 }, colors: CONFETTI_COLORS });
      }, 200);
    }).catch(() => { /* decorative — skip on load failure */ });
  }

  try {
    Sentry.addBreadcrumb({
      category: 'regimen',
      message: 'first-regimen-created',
      level: 'info',
      data: { regimenName: regimenName || null, xpGained, userEmail: userEmail || null },
    });
  } catch { /* ignore */ }
}
