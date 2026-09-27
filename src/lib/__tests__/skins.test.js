import { describe, it, expect, beforeEach } from 'vitest';
import {
  SKINS,
  availableSkin,
  isSkinInWindow,
  skinStorageKey,
  readSkinChoice,
  writeSkinChoice,
  isSkinOn,
} from '../skins';

const d = (y, m, day) => new Date(y, m - 1, day, 12);
const halloween = SKINS.find((s) => s.id === 'halloween');
const winter = { id: 'winter', window: { start: { month: 12, day: 1 }, end: { month: 1, day: 2 } } };

describe('skin windows', () => {
  it('Halloween opens Sept 25 and closes after Nov 1, inclusive', () => {
    expect(isSkinInWindow(halloween, d(2026, 9, 24))).toBe(false);
    expect(isSkinInWindow(halloween, d(2026, 9, 25))).toBe(true);
    expect(isSkinInWindow(halloween, d(2026, 10, 31))).toBe(true);
    expect(isSkinInWindow(halloween, d(2026, 11, 1))).toBe(true);
    expect(isSkinInWindow(halloween, d(2026, 11, 2))).toBe(false);
  });

  it('handles a window that crosses New Year, keyed to the year it opened', () => {
    expect(isSkinInWindow(winter, d(2026, 12, 20))).toBe(true);
    expect(isSkinInWindow(winter, d(2027, 1, 2))).toBe(true);
    expect(isSkinInWindow(winter, d(2027, 1, 3))).toBe(false);
    expect(skinStorageKey(winter, d(2027, 1, 1))).toBe(skinStorageKey(winter, d(2026, 12, 1)));
  });

  it('offers exactly the in-window skin, and none out of season', () => {
    expect(availableSkin(d(2026, 10, 10))?.id).toBe('halloween');
    expect(availableSkin(d(2026, 6, 10))).toBeNull();
  });

  it('no two registered windows overlap on any day of the year', () => {
    for (let t = new Date(2026, 0, 1); t.getFullYear() === 2026; t.setDate(t.getDate() + 1)) {
      const open = SKINS.filter((s) => s.window && isSkinInWindow(s, t));
      expect(open.length, t.toDateString()).toBeLessThanOrEqual(1);
    }
  });

  it('every skin carries its copy as [key, English] pairs', () => {
    for (const s of SKINS) {
      for (const f of ['name', 'hint', 'offerTitle', 'offerBody']) {
        expect(s.copy[f]).toHaveLength(2);
        expect(s.copy[f][0]).toMatch(new RegExp(`^skin\\.${s.id}\\.`));
      }
    }
  });
});

describe('the per-window choice', () => {
  beforeEach(() => localStorage.clear());

  it('is unanswered until written, which is what shows the offer', () => {
    expect(readSkinChoice(halloween, d(2026, 10, 1))).toBeNull();
    writeSkinChoice(halloween, false, d(2026, 10, 1));
    expect(readSkinChoice(halloween, d(2026, 10, 1))).toBe('off');
  });

  it('is keyed by year, so next season asks again', () => {
    writeSkinChoice(halloween, true, d(2026, 10, 1));
    expect(readSkinChoice(halloween, d(2027, 10, 1))).toBeNull();
  });

  it('is only on in window, even if switched on', () => {
    writeSkinChoice(halloween, true, d(2026, 10, 1));
    expect(isSkinOn(halloween, d(2026, 10, 20))).toBe(true);
    expect(isSkinOn(halloween, d(2026, 11, 5))).toBe(false);
    expect(isSkinOn(null)).toBe(false);
  });

  it('ignores a garbage stored value', () => {
    localStorage.setItem(skinStorageKey(halloween, d(2026, 10, 1)), 'yes');
    expect(readSkinChoice(halloween, d(2026, 10, 1))).toBeNull();
  });
});
