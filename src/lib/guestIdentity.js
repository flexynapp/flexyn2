// src/lib/guestIdentity.js
//
// One derivation of "what address is this account keyed by", because there
// were four copies of it and two places that needed it and did something else.
//
// A guest signs in through `signInAnonymously()`, and such an account has NO
// `auth.users.email` — measured at 0 of 27 in migration 366. What it does have
// is a `user_profiles.email` of `guest_<uuid>@flexyn.guest`, written by
// migration 172's `handle_new_user` trigger. So any code that reads the
// address off the AUTH user and writes it to a NOT NULL `user_email` column
// gets a 23502 for every guest, and any code that GUARDS on it turns a fully
// authenticated guest away as unauthenticated.
//
// Both had happened. `sleepLogs`, `stepLogs`, `moodLogs` and `makeEntity` in
// api/db.js each carried their own correct copy of the fallback; story
// reactions and story highlights each read `auth.getUser().email` raw and were
// broken for guests in the two different ways above — a reaction that lit up
// and silently reverted, and a highlight album that answered "Could not create
// — try again" every time with no path to success.
//
// Deriving rather than reading `user_profiles` is deliberate and matches the
// four existing copies: it is the same string the trigger wrote, so it needs
// no round trip, and the identity layer stays consistent with `makeEntity`.

/**
 * The address this account is keyed by, guest or not.
 *
 * @param {{id?: string, email?: string}|null|undefined} user
 *   Either an AuthContext user or a `supabase.auth.getUser()` user.
 * @returns {string|null} the address, or null when there is no account at all.
 */
export function accountEmail(user) {
  if (user?.email) return user.email;
  if (user?.id) return `guest_${user.id}@flexyn.guest`;
  return null;
}

/**
 * True for an account made by "Continue as guest" (`signInAnonymously()`).
 *
 * Reads `is_anonymous` when the caller has the auth user, and falls back to
 * the guest address shape, because the AuthContext user is the profile row
 * and older sessions merged it without the flag.
 *
 * @param {{is_anonymous?: boolean, email?: string}|null|undefined} user
 */
export function isGuestAccount(user) {
  if (!user) return false;
  if (user.is_anonymous === true) return true;
  return typeof user.email === 'string' && user.email.endsWith('@flexyn.guest');
}
