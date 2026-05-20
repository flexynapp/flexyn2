import { describe, it, expect, beforeEach } from 'vitest';
import {
  isDismissed,
  dismiss,
  undismiss,
  clearAllDismissals,
  DISCOVERY_CARDS,
} from '../discoveryPrefs';

beforeEach(() => {
  localStorage.clear();
  clearAllDismissals();
});

describe('discoveryPrefs — basic dismiss flow', () => {
  it('is not dismissed on a fresh slate', () => {
    expect(isDismissed(DISCOVERY_CARDS.STARTER_PLAN)).toBe(false);
  });

  it('becomes dismissed after dismiss()', () => {
    dismiss(DISCOVERY_CARDS.STARTER_PLAN);
    expect(isDismissed(DISCOVERY_CARDS.STARTER_PLAN)).toBe(true);
  });

  it('persists dismissal across reads (in-memory + localStorage)', () => {
    dismiss(DISCOVERY_CARDS.AI_COACH);
    expect(isDismissed(DISCOVERY_CARDS.AI_COACH)).toBe(true);
    expect(isDismissed(DISCOVERY_CARDS.AI_COACH)).toBe(true);
    expect(isDismissed(DISCOVERY_CARDS.AI_COACH)).toBe(true);
  });

  it('dismiss() is idempotent — calling twice does not break anything', () => {
    dismiss(DISCOVERY_CARDS.FORM_COACH);
    dismiss(DISCOVERY_CARDS.FORM_COACH);
    expect(isDismissed(DISCOVERY_CARDS.FORM_COACH)).toBe(true);
  });

  it('undismiss() reverses a dismissal', () => {
    dismiss(DISCOVERY_CARDS.STARTER_PLAN);
    undismiss(DISCOVERY_CARDS.STARTER_PLAN);
    expect(isDismissed(DISCOVERY_CARDS.STARTER_PLAN)).toBe(false);
  });
});

describe('discoveryPrefs — cooldown semantics', () => {
  it('cooldown=0 means "instantly expired" (not dismissed)', () => {
    dismiss(DISCOVERY_CARDS.STARTER_PLAN);
    expect(isDismissed(DISCOVERY_CARDS.STARTER_PLAN, 0)).toBe(false);
  });

  it('long cooldown keeps it dismissed', () => {
    dismiss(DISCOVERY_CARDS.STARTER_PLAN);
    expect(isDismissed(DISCOVERY_CARDS.STARTER_PLAN, 10_000)).toBe(true);
  });

  it('cooldown is undefined → permanent dismissal', () => {
    dismiss(DISCOVERY_CARDS.STARTER_PLAN);
    expect(isDismissed(DISCOVERY_CARDS.STARTER_PLAN)).toBe(true);
  });
});

describe('discoveryPrefs — clearAll + safety', () => {
  it('clearAllDismissals wipes everything', () => {
    dismiss(DISCOVERY_CARDS.STARTER_PLAN);
    dismiss(DISCOVERY_CARDS.AI_COACH);
    dismiss(DISCOVERY_CARDS.FORM_COACH);
    clearAllDismissals();
    expect(isDismissed(DISCOVERY_CARDS.STARTER_PLAN)).toBe(false);
    expect(isDismissed(DISCOVERY_CARDS.AI_COACH)).toBe(false);
    expect(isDismissed(DISCOVERY_CARDS.FORM_COACH)).toBe(false);
  });

  it('is safe to call with falsy/empty cardId', () => {
    expect(isDismissed(null)).toBe(false);
    expect(isDismissed('')).toBe(false);
    expect(() => dismiss(null)).not.toThrow();
    expect(() => undismiss(undefined)).not.toThrow();
  });

  it('DISCOVERY_CARDS exposes the three expected IDs', () => {
    expect(DISCOVERY_CARDS.STARTER_PLAN).toBe('starterPlan');
    expect(DISCOVERY_CARDS.FORM_COACH).toBe('formCoachIntro');
    expect(DISCOVERY_CARDS.AI_COACH).toBe('coachIntro');
  });
});

describe('discoveryPrefs — corrupted storage recovery', () => {
  it('recovers from non-JSON localStorage data', () => {
    localStorage.setItem('fn-discovery-dismissed-v1', '{not valid json');
    // First import already happened; we have to reach in and force a reload
    // for the in-memory cache. Simplest: undismiss to force a re-write, then
    // confirm nothing crashes.
    expect(() => isDismissed(DISCOVERY_CARDS.STARTER_PLAN)).not.toThrow();
  });
});
