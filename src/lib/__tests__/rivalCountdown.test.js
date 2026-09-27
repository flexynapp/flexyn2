// The Rival and Past You countdowns. They printed English d/h/m under a
// Spanish or French UI until formatDuration existed, and a walkover winner
// was shown the full prize while the settler paid a fifth of it.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/supabaseClient', () => ({ supabase: {} }));

const { formatDuration } = await import('@/lib/intlFormat');
const { computeRivalReward } = await import('@/lib/data/gymRival');

const H = 3_600_000;

describe('formatDuration', () => {
  it('shows two units at most', () => {
    expect(formatDuration(2 * 24 * H + 5 * H + 30 * 60_000, 'en')).toBe('2d 5h');
    expect(formatDuration(5 * H + 12 * 60_000, 'en')).toBe('5h 12m');
    expect(formatDuration(12 * 60_000, 'en')).toBe('12m');
  });

  it('uses the language, not English letters', () => {
    expect(formatDuration(2 * 24 * H + 5 * H, 'fr')).toBe('2j 5h');
    expect(formatDuration(5 * H + 12 * 60_000, 'es')).toBe('5h 12min');
  });

  it('never goes negative', () => {
    expect(formatDuration(-5000, 'en')).toBe('0m');
  });
});

describe('computeRivalReward', () => {
  it('is the full prize for a contested win', () => {
    expect(computeRivalReward()).toEqual({ xp: 5000, coins: 500, capsules: 5 });
  });

  it('matches what the settler pays for a walkover', () => {
    expect(computeRivalReward({ walkover: true })).toEqual({ xp: 1000, coins: 100, capsules: 1 });
  });
});
