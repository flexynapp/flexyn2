// src/lib/dailyChest.js
//
// Tiny shared helper for the "is the daily chest claimable today?" check.
// Used by DailyChestCard (to decide whether to render the chest banner)
// AND by DiscoveryCards (so the "open your capsule" card doesn't render
// while the daily chest is still unclaimed — only one of the two banners
// should show at a time, with the chest taking priority).
//
// Compares against UTC date to mirror the server-side gate in
// claim_daily_chest (migration 068). Both halves must agree on UTC or the
// card and the RPC disagree about what "today" is.
//
// ── The server is the authority; localStorage is a same-device fast path ──
//
// This used to read ONLY `daily_chest_claimed_<userId>` from localStorage.
// That key is per-device, and the truth (`user_profiles.last_daily_chest_at`)
// was already sitting in the profile cache unread. So a second device, a
// cleared cache, or a private window all showed an available chest that the
// server would then refuse — the user tapped a reward and got nothing.
//
// Both sources are now consulted, and a claim recorded by EITHER counts. That
// direction is deliberate:
//
//   • server says claimed  → hide it, even on a device that never claimed.
//     Fixes the cross-device case.
//   • local says claimed   → hide it, even before the profile refetch lands.
//     Prevents the card flashing back for a second after a successful claim.
//
// The only way to see the chest is for both to agree it is unclaimed, which
// is the conservative side of a currency grant.
//
// `lastClaimAt` is passed in rather than imported so this stays a pure
// function — it has two callers with different data sources, and both already
// hold the profile.

function claimedOnUtcToday(value) {
  if (!value) return false;
  const last = new Date(value);
  if (Number.isNaN(last.getTime())) return false;
  const now = new Date();
  return (
    last.getUTCFullYear() === now.getUTCFullYear() &&
    last.getUTCMonth() === now.getUTCMonth() &&
    last.getUTCDate() === now.getUTCDate()
  );
}

/**
 * @param {string} userId
 * @param {string|Date|null} [lastClaimAt] `user_profiles.last_daily_chest_at`.
 *   Omit only where the profile genuinely isn't available — omitting it falls
 *   back to the old per-device behaviour.
 */
export function isDailyChestReady(userId, lastClaimAt) {
  if (!userId) return false;

  if (claimedOnUtcToday(lastClaimAt)) return false;

  try {
    const v = localStorage.getItem(`daily_chest_claimed_${userId}`);
    if (!v) return true;
    return !claimedOnUtcToday(v);
  } catch {
    // Storage unavailable (private mode, quota) — the server value above is
    // the one that matters anyway, and it already said "not claimed".
    return true;
  }
}
