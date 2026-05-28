// src/lib/dailyChest.js
//
// Tiny shared helper for the "is the daily chest claimable today?" check.
// Used by DailyChestCard (to decide whether to render the chest banner)
// AND by DiscoveryCards (so the "open your capsule" card doesn't render
// while the daily chest is still unclaimed — only one of the two banners
// should show at a time, with the chest taking priority).
//
// Compares against UTC date to mirror the server-side gate in
// claim_daily_chest (migration 068).

export function isDailyChestReady(userId) {
  if (!userId) return false;
  try {
    const v = localStorage.getItem(`daily_chest_claimed_${userId}`);
    if (!v) return true;
    const last = new Date(v);
    const now = new Date();
    const sameUtcDay =
      last.getUTCFullYear() === now.getUTCFullYear() &&
      last.getUTCMonth() === now.getUTCMonth() &&
      last.getUTCDate() === now.getUTCDate();
    return !sameUtcDay;
  } catch {
    return true;
  }
}
