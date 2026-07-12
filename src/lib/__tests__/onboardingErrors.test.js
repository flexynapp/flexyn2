// Tests for the onboarding save-error classifiers. The bug these guard
// against: an email-uniqueness 23505 (or any non-username failure) being
// mislabelled "username already taken" and bouncing the user to a step they
// can't fix — the exact loop that blocked onboarding completion.
import { describe, it, expect } from 'vitest';
import {
  isDuplicateUsernameError,
  isProfaneUsernameError,
  isUniqueViolation,
} from '@/lib/onboardingErrors';

describe('isDuplicateUsernameError', () => {
  it('is TRUE for a username unique-constraint violation', () => {
    expect(isDuplicateUsernameError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "user_profiles_username_key"',
    })).toBe(true);
  });

  it('is FALSE for an EMAIL unique-constraint violation (the real bug)', () => {
    expect(isDuplicateUsernameError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "user_profiles_email_key"',
    })).toBe(false);
  });

  it('is FALSE for an unrelated 23505', () => {
    expect(isDuplicateUsernameError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "some_other_key"',
    })).toBe(false);
  });

  it('is FALSE for a non-unique error even if it mentions username', () => {
    // A schema-cache miss on the username column is not a "taken" error.
    expect(isDuplicateUsernameError({
      code: 'PGRST204',
      message: "Could not find the 'username' column in the schema cache",
    })).toBe(false);
  });

  it('finds the constraint name in details/hint too', () => {
    expect(isDuplicateUsernameError({
      code: '23505',
      message: 'duplicate key value violates unique constraint',
      details: 'Key (username)=(taken) already exists.',
    })).toBe(true);
  });

  it('is FALSE for null/empty errors', () => {
    expect(isDuplicateUsernameError(null)).toBe(false);
    expect(isDuplicateUsernameError({})).toBe(false);
  });
});

describe('isProfaneUsernameError', () => {
  it('is TRUE for the 23514 username_profanity trigger', () => {
    expect(isProfaneUsernameError({
      code: '23514',
      message: 'new row violates check constraint',
      hint: 'username_profanity',
    })).toBe(true);
  });
  it('is FALSE for an ordinary check violation', () => {
    expect(isProfaneUsernameError({ code: '23514', message: 'weight_lbs must be >= 50' })).toBe(false);
  });
});

describe('isUniqueViolation', () => {
  it('matches by code and by message text', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ message: 'duplicate key value ...' })).toBe(true);
    expect(isUniqueViolation({ code: '42703', message: 'undefined column' })).toBe(false);
  });
});
