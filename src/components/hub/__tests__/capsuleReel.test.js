// Reel-shape variation.
//
// Written in response to direct user feedback: "it's almost the same wheel
// spin every time, just a different item." It was. buildReel returned a
// fixed 22-card array with the prize pinned at index 18, so every spin
// travelled an identical distance and the ??? teaser sat in the slot
// immediately before the prize on EVERY open — spoiling the reveal a full
// card early, every time.
//
// These assertions are deliberately about DISTRIBUTION rather than exact
// values: the point is that consecutive spins differ, which a
// single-sample test cannot show.

import { describe, it, expect } from 'vitest';
import { buildReel } from '../CapsuleOpener';

const WIN = { id: 'stk_fire', emoji: '🔥', name: 'On Fire', rarity: 'common', type: 'sticker' };
const spins = (n, item = WIN) => Array.from({ length: n }, () => buildReel(item));

describe('buildReel — structure', () => {
  it('always places the declared winner at the declared index', () => {
    for (const { cards, winIndex } of spins(200)) {
      expect(cards[winIndex]).toBe(WIN);
    }
  });

  it('never emits an undefined card', () => {
    for (const { cards } of spins(200)) {
      expect(cards.every(Boolean)).toBe(true);
      expect(cards.every(c => typeof c.rarity === 'string')).toBe(true);
    }
  });

  it('always leaves run-out cards after the prize so it can settle mid-reel', () => {
    for (const { cards, winIndex } of spins(200)) {
      expect(cards.length - winIndex - 1).toBeGreaterThanOrEqual(3);
    }
  });

  it('never repeats the same card back to back', () => {
    for (const { cards } of spins(100)) {
      for (let i = 1; i < cards.length; i++) {
        if (cards[i].id === '__filler__' || cards[i - 1].id === '__filler__') continue;
        expect(cards[i].id === cards[i - 1].id && cards[i] !== WIN).toBe(false);
      }
    }
  });
});

describe('buildReel — variation (the actual bug)', () => {
  it('varies the landing index across spins — this was a constant 18', () => {
    const seen = new Set(spins(200).map(r => r.winIndex));
    expect(seen.size).toBeGreaterThan(5);
  });

  it('varies total reel length — this was a constant 22', () => {
    const seen = new Set(spins(200).map(r => r.cards.length));
    expect(seen.size).toBeGreaterThan(5);
  });

  it('varies travel distance enough to change how the same easing reads', () => {
    const idx = spins(300).map(r => r.winIndex);
    expect(Math.max(...idx) - Math.min(...idx)).toBeGreaterThanOrEqual(8);
  });

  it('does NOT always put the ??? teaser immediately before the prize', () => {
    const offsets = [];
    for (const { cards, winIndex } of spins(300)) {
      const at = cards.findIndex(c => c.id === '__mystery__');
      offsets.push(at === -1 ? null : winIndex - at);
    }
    // Sometimes absent entirely...
    expect(offsets.some(o => o === null)).toBe(true);
    // ...and when present, it sits at more than one distance from the win.
    const present = new Set(offsets.filter(o => o !== null));
    expect(present.size).toBeGreaterThan(1);
  });

  it('varies filler rarity mix between spins — cold reels vs hot reels', () => {
    const epicPlus = ({ cards }) =>
      cards.filter(c => ['epic', 'legendary', 'animated'].includes(c.rarity)).length;
    const counts = spins(80).map(epicPlus);
    expect(new Set(counts).size).toBeGreaterThan(3);
  });

  it('sometimes seeds a rarer near-miss directly before a common win', () => {
    const nearMisses = spins(300).filter(({ cards, winIndex }) => {
      const before = cards[winIndex - 1];
      return before && ['rare', 'epic', 'legendary', 'uncommon'].includes(before.rarity);
    });
    expect(nearMisses.length).toBeGreaterThan(0);
  });
});
