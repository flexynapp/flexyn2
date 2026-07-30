// Tests for src/lib/recentImplements.js — the per-device recall list
// that lets the equipment picker lead with gear the user actually uses.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  implementKey, getRecentImplements, recordImplementUse,
  forgetImplement, bestGuessImplement,
} from '../recentImplements';

const USER = 'user-1';
const hammer = { brand: 'hammer_strength', line: 'Plate Loaded', model: 'Iso-Lateral Row', label: 'Hammer Strength Plate Loaded Iso-Lateral Row' };
const cybex  = { brand: 'cybex', line: 'Eagle', model: null, label: 'Cybex Eagle' };

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('implementKey', () => {
  it('identifies by brand + line + model, ignoring the display label', () => {
    expect(implementKey(hammer)).toBe(implementKey({ ...hammer, label: 'Translated name' }));
  });

  it('separates different models of the same line', () => {
    expect(implementKey(hammer)).not.toBe(implementKey({ ...hammer, model: 'Iso-Lateral Chest Press' }));
  });

  it('is case-insensitive', () => {
    expect(implementKey({ brand: 'Cybex', line: 'EAGLE' })).toBe(implementKey({ brand: 'cybex', line: 'eagle' }));
  });

  it('survives null/undefined', () => {
    expect(implementKey(null)).toBe('');
    expect(implementKey(undefined)).toBe('');
    expect(implementKey({})).toBe('||');
  });
});

describe('recordImplementUse', () => {
  it('stores a first pick', () => {
    recordImplementUse(USER, 'seated_row', hammer);
    const list = getRecentImplements(USER, 'seated_row');
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe(hammer.label);
    expect(list[0].count).toBe(1);
  });

  it('increments rather than duplicating on re-pick', () => {
    recordImplementUse(USER, 'seated_row', hammer);
    recordImplementUse(USER, 'seated_row', hammer);
    recordImplementUse(USER, 'seated_row', hammer);
    const list = getRecentImplements(USER, 'seated_row');
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(3);
  });

  it('keeps implement types in separate buckets', () => {
    recordImplementUse(USER, 'seated_row', hammer);
    recordImplementUse(USER, 'leg_press', cybex);
    expect(getRecentImplements(USER, 'seated_row')).toHaveLength(1);
    expect(getRecentImplements(USER, 'leg_press')).toHaveLength(1);
    expect(getRecentImplements(USER, 'leg_press')[0].brand).toBe('cybex');
  });

  it('keeps users separate', () => {
    recordImplementUse(USER, 'seated_row', hammer);
    expect(getRecentImplements('user-2', 'seated_row')).toEqual([]);
  });

  it('caps the list and evicts least-recently-used', () => {
    for (let i = 0; i < 20; i++) {
      recordImplementUse(USER, 'leg_press', { brand: 'other', line: `Machine ${i}`, model: null, label: `Machine ${i}` });
    }
    expect(getRecentImplements(USER, 'leg_press').length).toBeLessThanOrEqual(12);
  });

  it('ignores missing arguments instead of writing junk', () => {
    expect(recordImplementUse(USER, null, hammer)).toEqual([]);
    expect(recordImplementUse(USER, 'seated_row', null)).toEqual([]);
    expect(getRecentImplements(USER, 'seated_row')).toEqual([]);
  });
});

describe('ranking', () => {
  it('puts the most recently used first, not the most frequent', () => {
    // The switched-gyms case: an old machine used many times should not
    // outrank the one they used today.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    for (let i = 0; i < 50; i++) recordImplementUse(USER, 'leg_press', cybex);

    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    recordImplementUse(USER, 'leg_press', hammer);

    const list = getRecentImplements(USER, 'leg_press');
    expect(list[0].brand).toBe('hammer_strength');
    expect(list[1].brand).toBe('cybex');
    expect(list[1].count).toBe(50);
  });

  it('bestGuessImplement returns the top-ranked entry', () => {
    recordImplementUse(USER, 'leg_press', cybex);
    recordImplementUse(USER, 'leg_press', hammer);
    expect(bestGuessImplement(USER, 'leg_press').brand).toBe('hammer_strength');
  });

  it('bestGuessImplement returns null with no history', () => {
    expect(bestGuessImplement(USER, 'leg_press')).toBeNull();
    expect(bestGuessImplement(USER, null)).toBeNull();
  });
});

describe('forgetImplement', () => {
  it('removes one entry and leaves the rest', () => {
    recordImplementUse(USER, 'leg_press', cybex);
    recordImplementUse(USER, 'leg_press', hammer);
    forgetImplement(USER, 'leg_press', cybex);
    const list = getRecentImplements(USER, 'leg_press');
    expect(list).toHaveLength(1);
    expect(list[0].brand).toBe('hammer_strength');
  });

  it('is a no-op for something never recorded', () => {
    recordImplementUse(USER, 'leg_press', hammer);
    forgetImplement(USER, 'leg_press', cybex);
    expect(getRecentImplements(USER, 'leg_press')).toHaveLength(1);
  });
});

describe('resilience', () => {
  it('returns [] for an unknown type', () => {
    expect(getRecentImplements(USER, 'never_used')).toEqual([]);
    expect(getRecentImplements(USER, null)).toEqual([]);
  });

  it('recovers from corrupt stored JSON', () => {
    localStorage.setItem(`flexyn.implements.${USER}`, '{not json');
    expect(getRecentImplements(USER, 'leg_press')).toEqual([]);
    // ...and can still write afterwards.
    recordImplementUse(USER, 'leg_press', hammer);
    expect(getRecentImplements(USER, 'leg_press')).toHaveLength(1);
  });

  it('recovers when the stored value is the wrong shape', () => {
    localStorage.setItem(`flexyn.implements.${USER}`, '["an array, not an object"]');
    expect(getRecentImplements(USER, 'leg_press')).toEqual([]);
  });

  it('tolerates a non-array bucket', () => {
    localStorage.setItem(`flexyn.implements.${USER}`, JSON.stringify({ leg_press: 'nope' }));
    expect(getRecentImplements(USER, 'leg_press')).toEqual([]);
  });
});
