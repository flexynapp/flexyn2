import { describe, it, expect, beforeEach } from 'vitest';
import { isDailyChestReady } from '../dailyChest';

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom only */ }
});

describe('isDailyChestReady', () => {
  it('returns true when the user has never claimed', () => {
    expect(isDailyChestReady('user-123')).toBe(true);
  });

  it('returns false right after a same-day claim', () => {
    localStorage.setItem('daily_chest_claimed_user-123', new Date().toISOString());
    expect(isDailyChestReady('user-123')).toBe(false);
  });

  it('returns true when the last claim was yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    localStorage.setItem('daily_chest_claimed_user-123', yesterday.toISOString());
    expect(isDailyChestReady('user-123')).toBe(true);
  });

  it('returns false for an undefined userId (no key to check)', () => {
    // Anonymous / pre-auth path should NOT light up the chest banner
    // because we have no way to gate the same-day claim.
    expect(isDailyChestReady(undefined)).toBe(false);
  });

  it('tolerates a malformed timestamp in storage', () => {
    localStorage.setItem('daily_chest_claimed_user-123', 'not-a-date');
    // Malformed → treat as never-claimed so the user can claim today.
    expect(typeof isDailyChestReady('user-123')).toBe('boolean');
  });
});
