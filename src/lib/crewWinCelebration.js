// src/lib/crewWinCelebration.js
//
// Sixth member of the celebration family. Fires when a user's crew wins
// a Crew War battle — the most communal moment in the app, and the only
// celebration that involves multiple people sharing in the same win.
//
// Distinct signature per the CLAUDE.md celebration table:
//   • Haptic: triple-tap + long pulse — "group cheering" rhythm
//   • Confetti: multi-color group palette (red/blue/green/yellow/purple),
//     full-screen, double burst from bottom corners
//   • Emoji: 🏆
//   • Duration: 8 seconds (longer than personal celebrations to honor
//     the shared moment)
//
// Mirrors the shape of the existing fireFirstWorkoutCelebration etc.
// helpers so a future contributor can extend the family the same way.

import { toast } from '@/lib/toast';
import * as Sentry from '@sentry/react';
import { formatNumber } from '@/lib/intl';

// Multi-color palette — distinct from any single-user celebration which
// use tighter palettes. A crew win is meant to feel chromatically loud.
const PALETTE = ['#ef4444', '#3b82f6', '#22c55e', '#fbbf24', '#a855f7'];

/**
 * Fire the crew-win celebration. Safe to call from mutation onSuccess
 * or notification-render paths — every step is non-throwing.
 *
 * @param {Object} opts
 * @param {string} [opts.crewName]    - The winning crew's name.
 * @param {number} [opts.xpGained]    - User's personal XP from the battle.
 * @param {number} [opts.finalScore]  - Crew's final score (for the toast).
 * @param {boolean}[opts.wasContributor] - True if the user actually contributed; false if they're just a member.
 * @param {string} [opts.userEmail]   - For Sentry user tag.
 * @param {string} [opts.language]    - User's ISO-639-1 language for locale-aware number rendering.
 */
export function fireCrewWinCelebration({
  crewName,
  xpGained = 0,
  finalScore,
  wasContributor = true,
  userEmail,
  language,
} = {}) {
  // Triple-tap + long pulse — the "group cheering" haptic shape.
  // Distinct from goal (15/50/15), first-workout (20/60/20/60/80),
  // and PR (20/80/20/80/40).
  try { navigator.vibrate?.([20, 50, 20, 50, 20, 50, 80]); } catch { /* ignore */ }

  // Copy varies on whether they personally contributed. A passive crew
  // member who didn't log a workout this week still gets the celebration
  // but it shouldn't claim XP they didn't earn.
  const trophy = '🏆';
  const headline = wasContributor && xpGained > 0
    ? `${trophy} Crew won — +${xpGained} XP`
    : `${trophy} Your crew won!`;
  const scoreStr = finalScore != null ? formatNumber(finalScore, language) : null;
  const description = crewName
    ? (scoreStr != null ? `${crewName} · final score ${scoreStr}` : crewName)
    : (scoreStr != null ? `Final score: ${scoreStr}` : undefined);

  toast.success(headline, {
    description,
    duration: 8000,
  });

  // Skip the visual celebration if the user opted out of motion.
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (!reducedMotion) {
    import('canvas-confetti').then(({ default: confetti }) => {
      // Double burst from bottom corners — feels like the whole crew is
      // cheering from both sides of the room. Larger particle count
      // than single-user celebrations to honor the shared moment.
      confetti({
        particleCount: 140,
        spread: 80,
        origin: { x: 0.15, y: 0.85 },
        colors: PALETTE,
        startVelocity: 45,
      });
      confetti({
        particleCount: 140,
        spread: 80,
        origin: { x: 0.85, y: 0.85 },
        colors: PALETTE,
        startVelocity: 45,
      });
      // Center burst 250ms later for the "everyone meets in the middle" feel.
      setTimeout(() => {
        confetti({
          particleCount: 100,
          spread: 120,
          origin: { x: 0.5, y: 0.6 },
          colors: PALETTE,
          scalar: 1.2,
        });
      }, 250);
    }).catch(() => { /* decorative — skip on load failure */ });
  }

  // Sentry breadcrumb — feeds the celebration funnel metric without
  // standing up a separate analytics pipeline.
  try {
    Sentry.addBreadcrumb({
      category: 'crew',
      message: 'crew-win-celebrated',
      level: 'info',
      data: { crewName, xpGained, finalScore, wasContributor, userEmail: userEmail || null },
    });
  } catch { /* ignore */ }
}
