import { describe, it, expect, beforeEach } from 'vitest';
import {
  consumeFirstLaunch,
  isFirstLaunch,
  clearFirstLaunch,
  markReturningUser,
  isReturningUser,
} from '../firstLaunch';

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom only */ }
});

describe('firstLaunch', () => {
  it('isFirstLaunch returns true when the launched flag is absent', () => {
    expect(isFirstLaunch()).toBe(true);
  });

  it('consumeFirstLaunch returns true on first call then flips the flag', () => {
    expect(consumeFirstLaunch()).toBe(true);
    expect(isFirstLaunch()).toBe(false);
    expect(consumeFirstLaunch()).toBe(false);
  });

  it('clearFirstLaunch wipes both the launched flag and the returning-user flag', () => {
    consumeFirstLaunch();
    markReturningUser();
    expect(isFirstLaunch()).toBe(false);
    expect(isReturningUser()).toBe(true);
    clearFirstLaunch();
    expect(isFirstLaunch()).toBe(true);
    expect(isReturningUser()).toBe(false);
  });

  it('markReturningUser is independent of the first-launch flag', () => {
    markReturningUser();
    // First-launch tracks the DEVICE; returning-user tracks ACCOUNT.
    // The audit caught these being conflated previously.
    expect(isFirstLaunch()).toBe(true);
    expect(isReturningUser()).toBe(true);
  });
});
