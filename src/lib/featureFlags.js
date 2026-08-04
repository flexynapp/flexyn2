// src/lib/featureFlags.js
//
// Kill switches for features that ship inside the bundle but are
// deliberately off. A flag here is the ONE place the decision lives —
// every surface that touches the feature reads this module instead of
// carrying its own copy, so turning something back on is a one-line
// change that can't leave a stray entry point behind.
//
// Two shapes coexist here, and that is deliberate rather than untidy.
// `THEMES_ENABLED` is a bare const because its consumers read it directly
// at module scope; the `FEATURE_FLAGS` map is for route-level gates that
// want a lookup. Adding a flag to either is fine — just don't duplicate a
// decision across both.
//
// All of these are build-time constants rather than remote config: there
// is no flag service here, and a remote flag would add a network
// dependency to the question "should this render". Flip a value, ship.

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
 * award is decided server-side in `_roll_capsule_shape` — the capsule
 * drop migration removes the `theme` category from its weights, and that
 * migration is what genuinely stops theme drops.
 *
 * Nothing is deleted: LOOT_THEMES, ThemeSelector, ThemeAnimationLayer and
 * every already-owned `user_inventory` theme row stay put. Flipping this
 * back to true (and reverting the weights) restores the feature with
 * each user's previous pick intact, because we never overwrite it.
 */
export const THEMES_ENABLED = false;

/**
 * Route-level gates for surfaces that are reachable but unfinished.
 */
export const FEATURE_FLAGS = {
  /**
   * Paid trainer programs — creator studio + consumer storefront.
   *
   * Off because the buy path invokes the `checkout-session` Edge
   * Function, which has never been deployed, so a tap produced a failed
   * invocation. `trainer_listings` and `trainer_purchases` are both
   * empty, so nobody has hit it — the surface being reachable is the
   * whole problem.
   *
   * This must NOT be fixed by deploying checkout-session. Selling
   * digital goods through Stripe inside an iOS wrapper is the App Store
   * rejection (Apple 3.1.1), not the missing function. It stays off
   * until there is a payment story that survives review.
   */
  trainerMarketplace: false,

  /**
   * Corporate wellness portal. `organizations` has zero rows and the
   * surface is half-built.
   */
  corporatePortal: false,
};

/**
 * @param {keyof typeof FEATURE_FLAGS} name
 * @returns {boolean} false for an unknown flag — an un-declared feature is
 *   off, so a typo hides a surface rather than exposing one.
 */
export function isEnabled(name) {
  return FEATURE_FLAGS[name] === true;
}

export default FEATURE_FLAGS;
