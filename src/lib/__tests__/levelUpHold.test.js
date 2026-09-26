import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  holdLevelUps, releaseLevelUps, parkIfHeld, onReleasedLevelUp, _resetLevelUpHold,
} from '../levelUpHold';

const ev = { fromLevel: 3, toLevel: 4, totalXp: 1200 };

beforeEach(() => _resetLevelUpHold());

describe('levelUpHold', () => {
  it('shows straight away when nothing holds it', () => {
    expect(parkIfHeld(ev)).toBe(false);
  });

  it('drops a parked level-up the win screen already showed', () => {
    const show = vi.fn();
    onReleasedLevelUp(show);
    holdLevelUps();
    expect(parkIfHeld(ev)).toBe(true);
    releaseLevelUps({ shownByWin: true });
    expect(show).not.toHaveBeenCalled();
    expect(parkIfHeld(ev)).toBe(false);
  });

  it('plays a parked level-up the win screen did not show', () => {
    const show = vi.fn();
    onReleasedLevelUp(show);
    holdLevelUps();
    parkIfHeld(ev);
    releaseLevelUps();
    expect(show).toHaveBeenCalledWith(ev);
  });

  it('does nothing on release when nothing was parked', () => {
    const show = vi.fn();
    onReleasedLevelUp(show);
    holdLevelUps();
    releaseLevelUps();
    releaseLevelUps();
    expect(show).not.toHaveBeenCalled();
  });

  it('stops showing after the manager unregisters', () => {
    const show = vi.fn();
    const off = onReleasedLevelUp(show);
    off();
    holdLevelUps();
    parkIfHeld(ev);
    releaseLevelUps();
    expect(show).not.toHaveBeenCalled();
  });
});
