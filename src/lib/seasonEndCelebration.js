// src/lib/seasonEndCelebration.js
//
// League season-end celebration. Fires on first open after a season rolls
// (migration 312) when the user collected a title and a trophy.
//
// 8th member of the celebration family alongside goal, first-workout,
// first-regimen, first-goal, first-meal, pr and crew-win. Per CLAUDE.md each
// must have a DISTINCT signature — haptic + confetti + emoji + palette — so a
// user feels each moment as its own thing rather than a generic "good job".
// All seven existing patterns were checked before picking these; none collide.
//
// SEASON-END SIGNATURE
// ────────────────────
//   Emoji      🎖️  standard finish, 👑 champion
//              (distinct from 🏆 goal, 🎉 first-workout, 💪 first-regimen,
//               🎯 first-goal, 🥗 first-meal, 🏋️ pr, ⚔️ crew-win)
//   Haptic     [60, 40, 60, 40, 200]  — two measured pulses and a long
//              resolving note. A ceremony, not a burst. No existing pattern
//              opens on 60 or closes on 200.
//   Confetti   A slow curtain across the full width from above, rather than
//              the side or centre bursts every other helper uses. It is the
//              only helper whose confetti falls rather than explodes.
//   Palette    The tier's own colour plus silver and white — the season mark
//              is the subject, so the colour should be the tier you reached.
//
// WHY THIS ONE IS QUIET
// ─────────────────────
// It is the biggest reward in the app and it gets the *slowest* animation.
// A season is 28 days; landing it with the same 400ms pop as a logged glass
// of water tells the user the two are worth the same. The curtain runs long
// and the haptic resolves rather than rattles.

import { toast } from '@/lib/toast';
import * as Sentry from '@sentry/react';

/**
 * Window event fired when the user taps "View" on the season toast.
 * Detail shape: { season, tier, isChampion, trophyId }
 *
 * Dashboard listens for this and opens the ceremony.
 */
export const OPEN_SEASON_CEREMONY_EVENT = 'flexyn-open-season-ceremony';

// Long, because the action needs a window big enough to be tappable and
// because this is the one moment in the app worth interrupting for.
// Exported and returned for rewardQueue, which holds the next celebration for
// exactly this long so toasts never stack.
export const TOAST_MS = 9000;

const TIER_COLORS = {
  bronze: '#cd7f32',
  silver: '#c0c0c0',
  gold: '#facc15',
  platinum: '#67e8f9',
  diamond: '#a5b4fc',
  legend: '#f0abfc',
};

const HAPTIC = [60, 40, 60, 40, 200];

/**
 * @param {object}  opts
 * @param {number}  opts.seasonNumber
 * @param {string}  opts.tier            — bronze … legend
 * @param {boolean} [opts.isChampion]
 * @param {string}  [opts.trophyId]
 * @returns {number} how long the toast stays up, for rewardQueue
 */
export function fireSeasonEndCelebration({
  seasonNumber,
  tier = 'bronze',
  isChampion = false,
  trophyId = null,
} = {}) {
  const tierColor = TIER_COLORS[tier] || TIER_COLORS.bronze;
  const emoji = isChampion ? '👑' : '🎖️';
  const label = tier.charAt(0).toUpperCase() + tier.slice(1);

  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(HAPTIC);
    }
  } catch {
    // Vibration is decoration; a browser that refuses must not break the toast.
  }

  // Confetti is lazy-imported so it stays out of the startup bundle —
  // vite.config keeps canvas-confetti in its own chunk for exactly this.
  import('canvas-confetti')
    .then(({ default: confetti }) => {
      const colors = [tierColor, '#c0c0c0', '#ffffff'];
      // A curtain: wide, low-velocity, high-drift, released from above the
      // viewport so it drifts down through the whole screen. Every other
      // helper in the family bursts; this one falls.
      confetti({
        particleCount: 90,
        startVelocity: 12,
        spread: 120,
        ticks: 320,
        gravity: 0.45,
        decay: 0.94,
        scalar: 1.1,
        origin: { x: 0.5, y: -0.12 },
        colors,
      });
      // A second, sparser pass a beat later so the curtain has depth rather
      // than arriving as one sheet.
      setTimeout(() => {
        confetti({
          particleCount: 45,
          startVelocity: 8,
          spread: 140,
          ticks: 300,
          gravity: 0.38,
          decay: 0.95,
          scalar: 0.9,
          origin: { x: 0.5, y: -0.1 },
          colors,
        });
      }, 550);
    })
    .catch(() => {
      // Offline or chunk fetch failed — the toast and haptic still land.
    });

  const title = isChampion
    ? `${emoji} Champion of Season ${seasonNumber}`
    : `${emoji} Season ${seasonNumber}: ${label}`;

  const description = isChampion
    ? 'Minted once. Nobody else can earn this one.'
    : `Your title and trophy are permanent — pin them from your profile.`;

  toast.success(title, {
    description,
    duration: TOAST_MS,
    action: {
      label: 'View',
      onClick: () => {
        try {
          window.dispatchEvent(
            new CustomEvent(OPEN_SEASON_CEREMONY_EVENT, {
              detail: { season: seasonNumber, tier, isChampion, trophyId },
            }),
          );
        } catch {
          // No window (SSR/tests) — nothing to open.
        }
      },
    },
  });

  Sentry.addBreadcrumb({
    category: 'celebration',
    message: 'season-end',
    level: 'info',
    data: { seasonNumber, tier, isChampion },
  });

  return TOAST_MS;
}

export default fireSeasonEndCelebration;
