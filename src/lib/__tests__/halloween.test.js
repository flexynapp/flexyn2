import { describe, it, expect, beforeEach } from 'vitest';
import {
  isHalloweenSeason,
  halloweenStorageKey,
  readHalloweenChoice,
  writeHalloweenChoice,
  isHalloweenActive,
} from '../halloween';

const d = (y, m, day) => new Date(y, m - 1, day, 12);

describe('isHalloweenSeason', () => {
  it('opens on Sept 25 and closes after Nov 1, inclusive at both ends', () => {
    expect(isHalloweenSeason(d(2026, 9, 24))).toBe(false);
    expect(isHalloweenSeason(d(2026, 9, 25))).toBe(true);
    expect(isHalloweenSeason(d(2026, 10, 15))).toBe(true);
    expect(isHalloweenSeason(d(2026, 10, 31))).toBe(true);
    expect(isHalloweenSeason(d(2026, 11, 1))).toBe(true);
    expect(isHalloweenSeason(d(2026, 11, 2))).toBe(false);
  });

  it('is off the rest of the year', () => {
    for (const m of [1, 3, 6, 8, 12]) expect(isHalloweenSeason(d(2026, m, 15))).toBe(false);
  });
});

describe('the per-season choice', () => {
  beforeEach(() => localStorage.clear());

  it('is unanswered until written, which is what shows the prompt', () => {
    expect(readHalloweenChoice(d(2026, 10, 1))).toBeNull();
    writeHalloweenChoice(false, d(2026, 10, 1));
    expect(readHalloweenChoice(d(2026, 10, 1))).toBe('off');
  });

  it('is keyed by year, so next October asks again', () => {
    writeHalloweenChoice(true, d(2026, 10, 1));
    expect(halloweenStorageKey(d(2027, 10, 1))).not.toBe(halloweenStorageKey(d(2026, 10, 1)));
    expect(readHalloweenChoice(d(2027, 10, 1))).toBeNull();
  });

  it('is only active in season, even if switched on', () => {
    writeHalloweenChoice(true, d(2026, 10, 1));
    expect(isHalloweenActive(d(2026, 10, 20))).toBe(true);
    expect(isHalloweenActive(d(2026, 11, 5))).toBe(false);
  });

  it('ignores a garbage stored value', () => {
    localStorage.setItem(halloweenStorageKey(d(2026, 10, 1)), 'yes');
    expect(readHalloweenChoice(d(2026, 10, 1))).toBeNull();
  });
});
