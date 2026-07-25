// src/lib/goalCelebration.js
//
// Single celebration entry point for goal completion. Centralizes the
// confetti + haptic + toast + analytics breadcrumb so every caller
// (GoalsAlmostComplete, GoalsModal, anywhere else we wire completion
// later) produces the same celebratory moment.
//
// Previously goal completion was SILENT — the card dismissed but no
// confetti, no XP toast, no breadcrumb. For a feature literally called
// "Goals", that's the most under-rewarded moment in the app.

import { toast } from '@/lib/toast';
import * as Sentry from '@sentry/react';

const CONFETTI_COLORS = ['#22c55e', '#10b981', '#facc15', '#fb923c', '#a855f7'];

/**
 * Fire a celebratory moment for a completed goal. Safe to call from
 * mutation onSuccess handlers — every step is non-throwing.
 *
 * @param {Object} opts
 * @param {string} opts.goalName    - e.g. "Bench Press" — appears in the toast.
 * @param {number} opts.xpReward    - XP granted (0 disables the XP line).
 * @param {Object} [opts.profile]   - Reduced-motion check uses prefers-reduced-motion media query.
 * @param {string} [opts.userEmail] - For Sentry user tag.
 */
export function fireGoalCelebration({ goalName, xpReward = 0, userEmail } = {}) {
  // 1. Haptic — short triple buzz on phones that support it (iOS Safari
  //    in iframes throws on this call, so wrap it).
  try { navigator.vibrate?.([15, 50, 15]); } catch { /* ignore */ }

  // 2. Toast — clearly tells the user what just happened. Sonner stacks
  //    multiple toasts, so completing two goals in a row produces two
  //    visible cards rather than the second silently replacing the first.
  const xpLine = xpReward > 0 ? ` · +${xpReward} XP` : '';
  toast.success(`🏆 Goal completed — ${goalName || 'goal'}${xpLine}`, {
    duration: 4500,
  });

  // 3. Confetti — same import-on-demand pattern as LevelUpOverlay so we
  //    don't pay the ~10 KB cost on every page load. Skip when the user
  //    has prefers-reduced-motion set (WCAG 2.3.3 / Apple HIG).
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (!reducedMotion) {
    import('canvas-confetti').then(({ default: confetti }) => {
      // Two bursts from opposite sides — same shape LevelUpOverlay uses
      // so the celebration vocabulary stays consistent.
      confetti({ particleCount: 90, spread: 75, origin: { x: 0.2, y: 0.55 }, colors: CONFETTI_COLORS });
      setTimeout(() => {
        confetti({ particleCount: 90, spread: 75, origin: { x: 0.8, y: 0.55 }, colors: CONFETTI_COLORS });
      }, 220);
    }).catch(() => {
      // Confetti is decorative — silently skip on load failure.
    });
  }

  // 4. Sentry breadcrumb — gives us an analytics trail for completion
  //    rate / typical completion XP without standing up a separate
  //    analytics pipeline. Safe when Sentry isn't initialized.
  try {
    Sentry.addBreadcrumb({
      category: 'goal',
      message: 'goal-completed',
      level: 'info',
      data: {
        goalName: goalName || null,
        xpReward,
        userEmail: userEmail || null,
      },
    });
  } catch { /* ignore */ }
}
