// src/lib/adminRoles.js
//
// Single source of truth for the app-admin whitelist (client-side).
// Mirror of the username list in migration 084's is_app_admin() —
// when one changes, change the other.
//
// Used by:
//   • CoinShopModal — admin gets infinite balance for testing.
//   • AdminReports  — gates the moderator view.

export const ADMIN_USERNAMES = ['sean', 'seanj', 'kegan', 'keganbergeron', 'admin'];

/**
 * Check whether a user is an app admin by username OR email prefix.
 * Email-prefix fallback covers fresh accounts where username hasn't
 * been set yet.
 */
export function isAppAdmin(user) {
  if (!user) return false;
  const uname = (user.username || '').toLowerCase();
  const emailPrefix = (user.email || '').split('@')[0]?.toLowerCase() || ''; // email-local-part-ok: admin-whitelist check, never rendered
  return ADMIN_USERNAMES.includes(uname) || ADMIN_USERNAMES.includes(emailPrefix);
}
