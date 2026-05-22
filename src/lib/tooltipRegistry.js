// src/lib/tooltipRegistry.js
//
// IDs for one-shot first-time tooltips. Each ID gets exactly ONE
// chance to fire across a user's lifetime (per device — backed by
// localStorage). Add new entries here so the codebase has a single
// discoverable source of registered tooltips.
//
// Each tooltip:
//   • Fires the first time its consuming component mounts and the
//     anchor is visible
//   • Auto-dismisses after 3 seconds
//   • Records `seen_tooltip_<id>` in localStorage and never fires
//     again for this user/device combo
//
// To add a new tooltip:
//   1. Append a constant below.
//   2. Mount <OneShotTooltip id={TOOLTIP.YOUR_ID} ... /> in the
//      consuming component.

export const TOOLTIP = {
  LONG_PRESS_TABS:    'long-press-tabs',     // bottom-nav long-press quick actions
  DM_DOUBLE_TAP:      'dm-double-tap',       // double-tap-to-react on DM messages
  WORKOUT_SMART_PASTE: 'workout-smart-paste', // paste "225 x 8" into the weight field
  PR_PROXIMITY_BAR:    'pr-proximity-bar',    // the new bar on set rows
  STREAK_FLAME_TAP:    'streak-flame-tap',    // streak flame shows streak details
};

const LS_PREFIX = 'flexyn.seenTooltip.';

export function hasSeenTooltip(id) {
  if (!id) return true;
  try { return localStorage.getItem(LS_PREFIX + id) === '1'; } catch { return false; }
}

export function markTooltipSeen(id) {
  if (!id) return;
  try { localStorage.setItem(LS_PREFIX + id, '1'); } catch { /* best-effort */ }
}

/**
 * Wipe ALL seen-tooltip flags for this device. Useful for QA + debug
 * paths so we can re-trigger the first-time experience without
 * creating a new account.
 */
export function resetAllSeenTooltips() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
