// src/components/market/dailyChest.js
//
// Local-only claim hints for the Daily Chest.
//
// Was: localStorage-only claim gate. That was a coin minter — clear
// localStorage / use incognito / use a second device → re-claim, and the
// server had no idea. The real gate is now the `claim_daily_chest` RPC
// (migration 068), which atomically checks
// user_profiles.last_daily_chest_at and only credits once per UTC day.
//
// We KEEP a localStorage hint purely so the chest doesn't flicker into
// the "available" look on every cold load. The server remains the source
// of truth; nothing here grants anything.

const CHEST_KEY = (userId) => `daily_chest_claimed_${userId}`;

const utcDate = (iso) => new Date(iso).toISOString().slice(0, 10);

export function isDailyChestClaimedLocally(userId) {
  if (!userId) return false;
  const val = localStorage.getItem(CHEST_KEY(userId));
  if (!val) return false;
  // Compare on UTC date — server-side claim_daily_chest (mig 068) gates
  // on `(last_daily_chest_at AT TIME ZONE 'UTC')::DATE < v_today_utc`,
  // so the client MUST use the same axis. A previous local-TZ comparison
  // disagreed with the server during the user's late evening (local
  // calendar already tomorrow, UTC still today → UI said "claimed" but
  // the server hadn't reset) and again during their early morning (local
  // still yesterday, UTC already today → UI said "available" but the
  // last claim already counted for today).
  return utcDate(val) === utcDate(new Date().toISOString());
}

export function markDailyChestClaimedLocally(userId) {
  if (!userId) return;
  localStorage.setItem(CHEST_KEY(userId), new Date().toISOString());
}
