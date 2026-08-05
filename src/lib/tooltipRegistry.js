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
//
// ── BOTH STEPS. Step 2 is the one that gets skipped. ──────────────────────
//
// This registry held five IDs and exactly ONE of them was ever mounted. The
// other four were registered, documented, and rendered nowhere — so three
// real, shipped gestures had nothing teaching them (smart paste, the PR
// proximity bar, double-tap-to-react), and the fourth described a gesture
// that did not exist at all.
//
// An unmounted tooltip is invisible by construction: nothing throws, nothing
// warns, and the feature it was meant to teach still works fine for anyone
// who already knows about it. `src/lib/__tests__/tooltipRegistry.test.js`
// now fails the suite when a registered ID has no mount site, so step 2
// cannot be forgotten again.
//
// REMOVED 2026-08-05 — `STREAK_FLAME_TAP` ('streak-flame-tap'), "streak flame
// shows streak details". StreakFlame.jsx has no click handler and none of its
// three consumers wraps it in one, so the gesture it advertised has never
// existed. The nearby thing that DOES expand streak details is the chevron on
// LoginStreakBanner, and a chevron is already its own affordance — it does not
// need a one-shot hint. Re-add this entry only alongside a real tap target.

export const TOOLTIP = {
  LONG_PRESS_TABS:    'long-press-tabs',     // bottom-nav long-press quick actions
  DM_DOUBLE_TAP:      'dm-double-tap',       // double-tap-to-react on DM messages
  WORKOUT_SMART_PASTE: 'workout-smart-paste', // paste "225 x 8" into the weight field
  PR_PROXIMITY_BAR:    'pr-proximity-bar',    // the new bar on set rows
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
