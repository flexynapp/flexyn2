import { describe, it, expect, beforeEach } from 'vitest';
import {
  LEGACY_ONBOARDED_KEY,
  nutritionOnboardedKey,
  nutritionOnboardingDismissedKey,
  isNutritionOnboardingComplete,
  isNutritionOnboardingDismissed,
  markNutritionOnboardingDismissed,
  clearNutritionOnboardingDismissed,
  shouldAutoOpenNutritionOnboarding,
} from '../nutritionOnboardingGate';

const USER = { userEmail: 'a@b.com', userId: 'u1' };
const LOADED_PROFILE = { id: 'u1', nutrition_onboarding_complete: false };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('storage keys', () => {
  it('namespaces both keys per CLAUDE.md convention', () => {
    expect(nutritionOnboardedKey('u1')).toBe('flexyn.nutritionOnboarded.u1');
    expect(nutritionOnboardingDismissedKey('u1')).toBe('flexyn.nutritionOnboardingDismissed.u1');
  });

  it('falls back to anon before auth resolves', () => {
    expect(nutritionOnboardedKey(undefined)).toBe('flexyn.nutritionOnboarded.anon');
    expect(nutritionOnboardingDismissedKey(null)).toBe('flexyn.nutritionOnboardingDismissed.anon');
  });

  it('keeps the completion and dismissal keys distinct', () => {
    expect(nutritionOnboardedKey('u1')).not.toBe(nutritionOnboardingDismissedKey('u1'));
  });
});

describe('isNutritionOnboardingComplete', () => {
  it('is true when the profile column is set', () => {
    expect(isNutritionOnboardingComplete({ nutrition_onboarding_complete: true }, 'u1')).toBe(true);
  });

  it('is true from the per-user local mirror', () => {
    localStorage.setItem(nutritionOnboardedKey('u1'), 'true');
    expect(isNutritionOnboardingComplete(LOADED_PROFILE, 'u1')).toBe(true);
  });

  it('honours the legacy un-namespaced flag', () => {
    localStorage.setItem(LEGACY_ONBOARDED_KEY, 'true');
    expect(isNutritionOnboardingComplete(LOADED_PROFILE, 'u1')).toBe(true);
  });

  it('does not leak another user’s completion', () => {
    localStorage.setItem(nutritionOnboardedKey('u2'), 'true');
    expect(isNutritionOnboardingComplete(LOADED_PROFILE, 'u1')).toBe(false);
  });

  // The bug this whole module exists to prevent: dismissing must never be
  // mistaken for completing.
  it('stays FALSE after a dismissal', () => {
    markNutritionOnboardingDismissed('u1');
    expect(isNutritionOnboardingComplete(LOADED_PROFILE, 'u1')).toBe(false);
    expect(localStorage.getItem(nutritionOnboardedKey('u1'))).toBeNull();
  });
});

describe('dismissal flag', () => {
  it('round-trips through sessionStorage', () => {
    expect(isNutritionOnboardingDismissed('u1')).toBe(false);
    markNutritionOnboardingDismissed('u1');
    expect(isNutritionOnboardingDismissed('u1')).toBe(true);
    clearNutritionOnboardingDismissed('u1');
    expect(isNutritionOnboardingDismissed('u1')).toBe(false);
  });

  it('is per user', () => {
    markNutritionOnboardingDismissed('u1');
    expect(isNutritionOnboardingDismissed('u2')).toBe(false);
  });

  it('lives in sessionStorage, not localStorage, so next visit re-prompts', () => {
    markNutritionOnboardingDismissed('u1');
    expect(sessionStorage.getItem(nutritionOnboardingDismissedKey('u1'))).toBe('true');
    expect(localStorage.getItem(nutritionOnboardingDismissedKey('u1'))).toBeNull();
  });
});

describe('shouldAutoOpenNutritionOnboarding', () => {
  it('opens for a signed-in, un-onboarded user', () => {
    expect(shouldAutoOpenNutritionOnboarding({ ...USER, userProfile: LOADED_PROFILE })).toBe(true);
  });

  it('waits for auth', () => {
    expect(shouldAutoOpenNutritionOnboarding({
      userEmail: undefined, userId: 'u1', userProfile: LOADED_PROFILE,
    })).toBe(false);
  });

  it('waits for the profile query (EMPTY_PROFILE placeholder)', () => {
    expect(shouldAutoOpenNutritionOnboarding({ ...USER, userProfile: {} })).toBe(false);
  });

  it('stays shut for an onboarded user', () => {
    expect(shouldAutoOpenNutritionOnboarding({
      ...USER, userProfile: { nutrition_onboarding_complete: true },
    })).toBe(false);
  });

  it('stays shut while the user drives it manually', () => {
    expect(shouldAutoOpenNutritionOnboarding({
      ...USER, userProfile: LOADED_PROFILE, manuallyOpened: true,
    })).toBe(false);
  });

  // ── Regression: "I had to exit 5 times to see the nutrition dashboard" ──
  // Every re-evaluation of the gate after ONE dismissal must return false:
  // re-renders, profile refetches, and additional mounted copies of the page
  // all consult the same session flag.
  it('never re-opens after a single dismissal', () => {
    expect(shouldAutoOpenNutritionOnboarding({ ...USER, userProfile: LOADED_PROFILE })).toBe(true);

    markNutritionOnboardingDismissed(USER.userId);

    // A refetch hands back a fresh object identity with the same values.
    for (const profile of [
      LOADED_PROFILE,
      { ...LOADED_PROFILE },
      { id: 'u1' },                                  // column stripped by safeSelect
      { id: 'u1', nutrition_onboarding_complete: null },
    ]) {
      expect(shouldAutoOpenNutritionOnboarding({ ...USER, userProfile: profile })).toBe(false);
    }
  });

  it('re-arms for a different session (dismissal cleared)', () => {
    markNutritionOnboardingDismissed(USER.userId);
    expect(shouldAutoOpenNutritionOnboarding({ ...USER, userProfile: LOADED_PROFILE })).toBe(false);
    sessionStorage.clear(); // new browsing session
    expect(shouldAutoOpenNutritionOnboarding({ ...USER, userProfile: LOADED_PROFILE })).toBe(true);
  });

  it('a dismissal by one user does not silence the prompt for another', () => {
    markNutritionOnboardingDismissed('u1');
    expect(shouldAutoOpenNutritionOnboarding({
      userEmail: 'c@d.com', userId: 'u2', userProfile: { id: 'u2' },
    })).toBe(true);
  });
});
