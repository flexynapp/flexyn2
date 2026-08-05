// src/lib/featureFlags.js
//
// Kill switches for features that ship inside the bundle but are
// deliberately off. A flag here is the ONE place the decision lives —
// every surface that touches the feature reads this module instead of
// carrying its own copy, so turning something back on is a one-line
// change that can't leave a stray entry point behind.

/**
 * Themes — BOTH the level-up palettes and the capsule-drop loot themes.
 *
 * OFF as of Aug 2026 (kegan). While this is false:
 *
 *   • every user runs the default Iron Orange palette, whatever
 *     `preferred_theme` / `loot_theme_id` says on their row;
 *   • the Themes control on the profile is visible but disabled and
 *     reads "Coming soon" rather than disappearing — a control that
 *     vanishes reads as a bug, one that says "soon" reads as a plan;
 *   • the client stops advertising themes as a capsule reward (reel,
 *     candidate menu, collection grid).
 *
 * The client half is presentation only. What a capsule can actually
 * award is decided server-side in `_roll_capsule_shape` — migration 281
 * drops the `theme` category from its weights, and that migration is
 * what genuinely stops theme drops.
 *
 * Nothing is deleted: LOOT_THEMES, ThemeSelector, ThemeAnimationLayer and
 * every already-owned `user_inventory` theme row stay put. Flipping this
 * back to true (and reverting 281's weights) restores the feature with
 * each user's previous pick intact, because we never overwrite it.
 */
export const THEMES_ENABLED = false;
