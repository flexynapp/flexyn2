// src/lib/nutritionOnboardingGate.js
//
// Decides whether the nutrition-onboarding wizard should auto-open on the
// Nutrition page, and records a dismissal that survives re-renders.
//
// There are THREE distinct states here and conflating any two of them has
// already produced user-facing bugs:
//
//   1. COMPLETE  — the user actually finished (or explicitly Skipped)
//                  onboarding. Persisted server-side on
//                  `user_profiles.nutrition_onboarding_complete`, mirrored
//                  to `flexyn.nutritionOnboarded.<userId>` in localStorage
//                  so the modal doesn't flash before the profile query
//                  resolves. This flag also gates NutritionPlansPanel.
//   2. DISMISSED — the user closed the wizard (X / Esc / backdrop) without
//                  entering goals. They are NOT onboarded: we must still be
//                  able to prompt them next visit and the explicit "Set up
//                  nutrition" entry points must still work. So this lives in
//                  sessionStorage, keyed per user, and is deliberately NOT
//                  written to the profile. Closing once has to stick for the
//                  rest of the session — see below.
//   3. NEITHER   — prompt them.
//
// Why a stored dismissal rather than component state: the page can be
// mounted more than once (route transitions), and the auto-open effect
// re-runs whenever the profile query settles. Component state is per
// instance and per mount; the session flag is the single source of truth
// that every instance agrees on.

export const LEGACY_ONBOARDED_KEY = 'fn-nutrition-onboarded';

/** localStorage key for "onboarding COMPLETE" (CLAUDE.md namespace). */
export function nutritionOnboardedKey(userId) {
  return `flexyn.nutritionOnboarded.${userId || 'anon'}`;
}

/** sessionStorage key for "dismissed WITHOUT completing". */
export function nutritionOnboardingDismissedKey(userId) {
  return `flexyn.nutritionOnboardingDismissed.${userId || 'anon'}`;
}

function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function readSession(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

/** True when the user has finished (or explicitly skipped) onboarding. */
export function isNutritionOnboardingComplete(userProfile, userId) {
  if (userProfile?.nutrition_onboarding_complete) return true;
  // Per-user key first; fall back to the legacy un-namespaced flag so a
  // device that onboarded on an older build doesn't get re-prompted.
  return readLocal(nutritionOnboardedKey(userId)) === 'true'
      || readLocal(LEGACY_ONBOARDED_KEY) === 'true';
}

/** True when the user closed the wizard this session without completing. */
export function isNutritionOnboardingDismissed(userId) {
  return readSession(nutritionOnboardingDismissedKey(userId)) === 'true';
}

/** Record a dismissal for the rest of this session. */
export function markNutritionOnboardingDismissed(userId) {
  try {
    sessionStorage.setItem(nutritionOnboardingDismissedKey(userId), 'true');
  } catch { /* private mode / quota — worst case we re-prompt */ }
}

/**
 * Clear the dismissal. Called when the user deliberately re-opens the
 * wizard so that closing it again re-arms cleanly, and so an interrupted
 * manual run doesn't leave a stale flag behind.
 */
export function clearNutritionOnboardingDismissed(userId) {
  try {
    sessionStorage.removeItem(nutritionOnboardingDismissedKey(userId));
  } catch { /* ignore */ }
}

/**
 * Should the wizard auto-open right now?
 *
 * @param {object}  args
 * @param {string=} args.userEmail    — falsy until auth resolves
 * @param {string=} args.userId       — used for the per-user storage keys
 * @param {object=} args.userProfile  — `{}` while the profile query is in flight
 * @param {boolean=} args.manuallyOpened — user opened it deliberately
 */
export function shouldAutoOpenNutritionOnboarding({
  userEmail,
  userId,
  userProfile,
  manuallyOpened = false,
} = {}) {
  if (!userEmail) return false;
  // `{}` is the EMPTY_PROFILE placeholder — the query hasn't resolved yet.
  // Opening now would flash the wizard at already-onboarded users.
  if (userProfile && Object.keys(userProfile).length === 0) return false;
  if (isNutritionOnboardingComplete(userProfile, userId)) return false;
  if (isNutritionOnboardingDismissed(userId)) return false;
  if (manuallyOpened) return false;
  return true;
}
