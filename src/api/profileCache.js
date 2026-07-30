// src/api/profileCache.js
//
// The in-memory user_profiles cache that backs db.auth.me().
//
// This lives in its own module for one specific reason: it must be importable
// with NO side effects. db.js registers a supabase.auth.onAuthStateChange
// listener at module scope, so any data module that imports @/api/db to reach
// db.auth.patchCache also drags that listener in — which is exactly what broke
// gymRivalOverthrow.test.js when gymRival.js imported db. Data modules import
// this file instead: plain state, no supabase, no listeners, safe under any
// test stub.
//
// WHY A PATCH API EXISTS AT ALL. db.auth.me() returns this cache and only
// re-reads the row when it is empty, so invalidating the react-query
// ['userProfile'] key does NOT pick up a write — the refetch calls me() and is
// handed the same stale object. Every writer that changes user_profiles
// through a raw supabase update or an RPC (rather than db.auth.updateMe, which
// refreshes the cache itself) has to report what it changed here, or the UI
// keeps rendering the old value until a full reload.
//
// WHAT NOT TO PATCH. Only patch values you know actually landed:
//   • Columns migration 142 blocks for direct client writes (flex_coins,
//     total_xp, current_level, prestige_level, league_tier, login_streak,
//     workout_streak, longest_*, milestone_capsules_awarded, referral_code,
//     referred_by, last_daily_chest_at) are rejected with 42501 on a direct
//     update — patching a client-computed value for those caches something
//     that never persisted, which is worse than being stale.
//   • flex_coins additionally passes through migration 264's ledger trigger,
//     which CLAMPS credits past the rolling ceiling. Even a successful write
//     may not store the number you sent.
// For those, patch only with a value the SERVER handed back (an RPC's return
// payload), never with one computed on the client.

let _profile = null;

/** Current cached profile, or null when nothing is loaded. */
export function getProfile() {
  return _profile;
}

/** Replace the cache wholesale (used after a full load). */
export function setProfile(profile) {
  _profile = profile;
  return _profile;
}

/**
 * Merge a patch into the cached profile.
 * No-op until the profile has been loaded once — there is nothing to keep in
 * sync yet, and the next me() will read fresh anyway.
 */
export function patchProfile(patch) {
  if (_profile && patch && typeof patch === 'object') {
    _profile = { ..._profile, ...patch };
  }
  return _profile;
}

/** Drop the cache (sign-out, user change). */
export function clearProfile() {
  _profile = null;
}
