import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDailyChestReady } from '../useDailyChestReady';
import { setProfile, clearProfile } from '@/api/profileCache';
import { announceDailyChestClaimed } from '@/lib/dailyChest';

const UID = 'u-1';
const KEY = `daily_chest_claimed_${UID}`;

describe('useDailyChestReady (the sidebar Market dot)', () => {
  beforeEach(() => { localStorage.clear(); clearProfile(); });

  it('is ready when nothing says today was claimed', () => {
    const { result } = renderHook(() => useDailyChestReady(UID));
    expect(result.current).toBe(true);
  });

  it('agrees with the server when another device claimed today', () => {
    setProfile({ id: UID, last_daily_chest_at: new Date().toISOString() });
    const { result } = renderHook(() => useDailyChestReady(UID));
    expect(result.current).toBe(false);
  });

  it('reads the claim on the UTC day, as the Market row does', () => {
    // A claim stamped yesterday in UTC is not today, wherever the user is.
    localStorage.setItem(KEY, new Date(Date.now() - 36 * 3600e3).toISOString());
    const { result } = renderHook(() => useDailyChestReady(UID));
    expect(result.current).toBe(true);
  });

  it('clears the moment a claim is announced', () => {
    const { result } = renderHook(() => useDailyChestReady(UID));
    expect(result.current).toBe(true);
    act(() => {
      localStorage.setItem(KEY, new Date().toISOString());
      announceDailyChestClaimed();
    });
    expect(result.current).toBe(false);
  });

  it('is never ready without a user', () => {
    const { result } = renderHook(() => useDailyChestReady(null));
    expect(result.current).toBe(false);
  });
});
