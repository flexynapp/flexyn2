// src/lib/onboardingErrors.js
//
// Classifiers for the errors the onboarding profile-save can throw, so the
// reveal step can route the user to the right fix instead of guessing.
//
// The bug this fixes: the previous inline check treated ANY 23505 (or any
// message mentioning "username") as "username already taken". A duplicate
// EMAIL (unique constraint user_profiles_email_key) is also a 23505, so an
// email collision — or any unrelated save failure whose message happened to
// contain "username" — bounced the user to the username step with a
// misleading error they couldn't act on. These classifiers only fire for the
// specific constraint/trigger involved, keyed off the constraint NAME, which
// distinguishes user_profiles_username_key from user_profiles_email_key.

// Gather every text field a PostgREST/Postgres error may carry the
// constraint name in.
function errorText(err) {
  return [err?.message, err?.details, err?.hint].filter(Boolean).join(' ');
}

/** True when the error is a unique-constraint violation (23505 or its text). */
export function isUniqueViolation(err) {
  if (err?.code === '23505') return true;
  return /duplicate key|unique constraint|already exists/i.test(errorText(err));
}

/**
 * True only when a UNIQUE violation is specifically on the username — i.e.
 * the constraint name mentions "username". An email/other-column collision
 * returns false so it isn't mislabelled as "username taken".
 */
export function isDuplicateUsernameError(err) {
  return isUniqueViolation(err) && /username/i.test(errorText(err));
}

/**
 * True when the server-side username profanity trigger (migration 050)
 * rejected the name — surfaces as 23514 tagged 'username_profanity'.
 */
export function isProfaneUsernameError(err) {
  return err?.code === '23514' &&
    /username_profanity|prohibited content/i.test(errorText(err));
}

/**
 * True when enforce_reserved_operator_handles refused the name. Also 23514,
 * but the message is "username is reserved", which the profanity check
 * does not match, so the user got a raw error on every retry instead of
 * being sent back to pick another name.
 */
export function isReservedUsernameError(err) {
  return err?.code === '23514' && /username is reserved/i.test(errorText(err));
}
