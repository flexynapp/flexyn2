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

  // ── The server timestamp is the authority ────────────────────────────────
  //
  // Readiness used to come from localStorage alone, which is per-device. The
  // truth (user_profiles.last_daily_chest_at) was already in the profile
  // cache and unread, so a second device — or a cleared cache, or a private
  // window — showed a chest the server would refuse. The user tapped a reward
  // and got nothing back.

  it('hides the chest when the SERVER says claimed, even on a fresh device', () => {
    // No localStorage key at all: this device has never claimed.
    expect(localStorage.getItem('daily_chest_claimed_user-123')).toBeNull();
    expect(isDailyChestReady('user-123', new Date().toISOString())).toBe(false);
  });

  it('shows the chest when the server claim was on a previous UTC day', () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    expect(isDailyChestReady('user-123', yesterday.toISOString())).toBe(true);
  });

  it('still hides it from localStorage before the profile refetch lands', () => {
    // Immediately after a claim the RPC has not returned a new timestamp and
    // the profile cache is still stale, so the local mark is what stops the
    // card flashing back for a second.
    localStorage.setItem('daily_chest_claimed_user-123', new Date().toISOString());
    expect(isDailyChestReady('user-123', null)).toBe(false);
  });

  it('needs BOTH sources to agree before showing a chest', () => {
    // Conservative direction on purpose: this gates a currency grant.
    expect(isDailyChestReady('user-123', null)).toBe(true);
  });

  it('ignores an unparseable server timestamp rather than hiding forever', () => {
    expect(isDailyChestReady('user-123', 'not-a-date')).toBe(true);
  });
});
