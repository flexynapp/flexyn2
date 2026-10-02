import { describe, it, expect } from 'vitest';
import { DRAMA, dramaFor } from '../openFx';

const LADDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'animated'];

describe('capsule open drama', () => {
  it('covers every rarity on the ladder', () => {
    for (const r of LADDER) expect(DRAMA[r]).toBeTruthy();
  });

  it('never gets smaller as the rarity climbs', () => {
    for (const key of ['paint', 'stir', 'rings', 'sparks', 'shake', 'flash', 'hold']) {
      for (let i = 1; i < LADDER.length; i++) {
        expect(DRAMA[LADDER[i]][key], `${key} at ${LADDER[i]}`).toBeGreaterThanOrEqual(DRAMA[LADDER[i - 1]][key]);
      }
    }
  });

  // The colour field is the whole background now, so it runs on every
  // open, a Common included, and never past the rank up's own level.
  it('keeps the colour field between visible and full', () => {
    for (const r of LADDER) {
      expect(DRAMA[r].paint).toBeGreaterThan(0);
      expect(DRAMA[r].paint).toBeLessThanOrEqual(1);
      expect(DRAMA[r].stir).toBeLessThanOrEqual(1);
    }
  });

  it('falls back to common for an unknown rarity', () => {
    expect(dramaFor('nope')).toBe(DRAMA.common);
  });
});
