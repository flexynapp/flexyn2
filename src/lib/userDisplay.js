// src/lib/userDisplay.js
//
// Central display-name resolution. ENTERPRISE RULE: a user is shown by their
// username / full name — NEVER by their email or any fragment of it. Email is
// PII and a mutable contact field, not a display identity.
//
// Historically the app leaned on `username || email.split('@')[0]` fallbacks
// all over the UI, which rendered the local-part of a user's email as their
// "name". This helper replaces every one of those: it walks the common
// name-bearing fields a user-ish object might carry, and falls back to a
// generic label — but it will never surface an email.
//
// A guard test (src/lib/__tests__/userDisplay.guard.test.js) fails the build
// if `email.split('@')` reappears anywhere under src/components or src/pages,
// so this stays fixed.

export const GENERIC_NAME = 'Athlete';
export const GENERIC_HANDLE = 'athlete';

/**
 * Resolve a bare display name (no leading @) from a user-ish object.
 * Checks the many name fields used across the app's denormalized shapes,
 * stripping a leading @ from snapshot handles. Never returns an email.
 *
 * @param {object|null|undefined} u
 * @param {string} [fallback='Athlete']
 * @returns {string}
 */
export function displayName(u, fallback = GENERIC_NAME) {
  if (!u || typeof u !== 'object') return fallback;
  const raw =
    u.username ||
    u.author_username ||
    u.seller_username ||
    u.display_name ||
    u.full_name ||
    u.author_name ||
    u.user_name ||
    u.name ||
    u.host ||
    null;
  const cleaned = typeof raw === 'string' ? raw.replace(/^@/, '').trim() : '';
  return cleaned || fallback;
}

/**
 * Handle form: "@username", falling back to a generic handle — never email.
 *
 * @param {object|null|undefined} u
 * @param {string} [fallback='athlete']
 * @returns {string}
 */
export function handle(u, fallback = GENERIC_HANDLE) {
  return `@${displayName(u, fallback)}`;
}

/**
 * Mask an email for the rare cases where a self-service list (e.g. your own
 * blocked/muted accounts) only stores the email and still needs to be
 * recognizable to its owner. Shows a few leading chars + domain, hiding the
 * rest: "john.doe@gmail.com" -> "joh•••@gmail.com". Never emit a full email.
 *
 * @param {string|null|undefined} email
 * @returns {string}
 */
export function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return 'account';
  const [local, domain] = email.split('@');
  const head = local.slice(0, Math.min(3, local.length));
  return `${head}•••@${domain}`;
}
