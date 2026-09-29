import { describe, it, expect } from 'vitest';
import { DRAMA, dramaFor, chargeMs } from '../openFx';

const LADDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'animated'];

describe('capsule open drama', () => {
  it('covers every rarity on the ladder', () => {
    for (const r of LADDER) expect(DRAMA[r]).toBeTruthy();
  });

  it('never gets smaller as the rarity climbs', () => {
    for (const key of ['rays', 'rings', 'sparks', 'shake', 'flash', 'hold', 'charge']) {
      for (let i = 1; i < LADDER.length; i++) {
        expect(DRAMA[LADDER[i]][key], `${key} at ${LADDER[i]}`).toBeGreaterThanOrEqual(DRAMA[LADDER[i - 1]][key]);
      }
    }
  });

  // The hot charge tints the stage before the reel runs. Below epic it must
  // not, or every common would announce itself and the reel would lose its
  // suspense.
  it('tells only on epic or better', () => {
    expect(LADDER.filter(r => DRAMA[r].hot)).toEqual(['epic', 'legendary', 'mythic', 'animated']);
  });

  it('falls back to common for an unknown rarity', () => {
    expect(dramaFor('nope')).toBe(DRAMA.common);
  });

  it('shortens the charge in a batch and skips it under reduced motion', () => {
    expect(chargeMs('epic', { batch: true })).toBeLessThan(chargeMs('epic'));
    expect(chargeMs('legendary', { reduced: true })).toBe(0);
  });
});
