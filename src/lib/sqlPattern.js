// Escaping for values interpolated into SQL LIKE / ILIKE patterns.
//
// PostgREST passes `.like()` / `.ilike()` values straight through to Postgres
// as a pattern, so `%` and `_` in a user-supplied string are WILDCARDS, not
// literals. That is easy to miss because the failure is silent and looks like
// a legitimate result: onboarding's username availability check ran
// `.ilike('username', 'jordan_lifts')`, which matched an existing
// `jordanxlifts` and told the user their name was taken. Since the resulting
// error disables the Continue button, it blocked signup for every username
// containing an underscore — a shape the field's own placeholder recommends.
//
// Postgres' default LIKE escape character is a backslash, so escaping means
// prefixing each of `\`, `%` and `_` with one. The backslash must be handled
// first or it would double-escape the ones added after it — the regex
// character class covers all three in a single pass for that reason.

/**
 * Escape a literal string for use as a LIKE / ILIKE pattern.
 *
 * Use this on any value that should match EXACTLY. Wildcards you add
 * yourself go outside the call:
 *
 *   .ilike('username', escapeLikePattern(name))         // exact, case-insensitive
 *   .ilike('username', `%${escapeLikePattern(query)}%`) // contains
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeLikePattern(value) {
  return String(value ?? '').replace(/[\\%_]/g, '\\$&');
}
