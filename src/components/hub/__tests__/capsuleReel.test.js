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
import {
  buildReel, buildLegendaryReel, splitIntoWaves, isGoldCard, isEncoreTier,
} from '../CapsuleOpener';

const WIN = { id: 'stk_fire', emoji: '🔥', name: 'On Fire', rarity: 'common', type: 'sticker' };
const LEGEND = { id: 'stk_glow', emoji: '🌟', name: 'Radiance', rarity: 'legendary', type: 'sticker' };
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

describe('buildReel — filler pool breadth (user-reported)', () => {
  // "The same icons spin by until the actual awarded item, which is
  // different." Cause: fillers were drawn from ITEMS stickers only — 19
  // entries, 5 of them common — while the cold weight table puts ~52% of
  // cards in the common tier. Half of every reel came from a five-item
  // pool. These lock in the wider pool so it can't silently narrow again.

  it('draws from far more than the old 19-item sticker pool', () => {
    const ids = new Set();
    for (const { cards, winIndex } of spins(60)) {
      cards.forEach((c, i) => { if (i !== winIndex && c.id !== '__mystery__') ids.add(c.id); });
    }
    expect(ids.size).toBeGreaterThan(60);
  });

  it('shows titles / frames / themes, not just stickers — all are winnable', () => {
    const ids = new Set();
    for (const { cards } of spins(120)) cards.forEach(c => ids.add(c.id));
    // Catalog id prefixes: t_ titles, f_ frames, flx_ branded.
    expect([...ids].some(id => id.startsWith('t_'))).toBe(true);
    expect([...ids].some(id => id.startsWith('f_'))).toBe(true);
    expect([...ids].some(id => id.startsWith('flx_'))).toBe(true);
  });

  it('does not repeat an item within a single reel', () => {
    for (const { cards, winIndex } of spins(120)) {
      const fillers = cards
        .filter((c, i) => i !== winIndex && c.id !== '__mystery__' && c.id !== '__filler__')
        .map(c => c.id);
      expect(new Set(fillers).size).toBe(fillers.length);
    }
  });

  it('two consecutive reels share few icons — the actual complaint', () => {
    const overlaps = [];
    for (let n = 0; n < 40; n++) {
      const a = new Set(buildReel(WIN).cards.map(c => c.id));
      const b = new Set(buildReel(WIN).cards.map(c => c.id));
      const shared = [...a].filter(id => b.has(id)).length;
      overlaps.push(shared / Math.min(a.size, b.size));
    }
    const mean = overlaps.reduce((x, y) => x + y, 0) / overlaps.length;
    // Old behaviour was effectively 1.0 for the common tier. Anything
    // under half means consecutive spins genuinely look different.
    expect(mean).toBeLessThan(0.5);
  });
});

describe('buildLegendaryReel — the encore spin', () => {
  const encores = (n, item = LEGEND) => Array.from({ length: n }, () => buildLegendaryReel(item));

  it('contains NOTHING below legendary — that is the whole premise', () => {
    for (const { cards } of encores(200)) {
      for (const c of cards) {
        expect(isEncoreTier(c.rarity)).toBe(true);
      }
    }
  });

  it('lands on the item the server actually granted', () => {
    for (const { cards, winIndex } of encores(200)) {
      expect(cards[winIndex]).toBe(LEGEND);
    }
  });

  it('never shows the prize anywhere except the winning slot', () => {
    for (const { cards, winIndex } of encores(200)) {
      const elsewhere = cards.filter((c, i) => i !== winIndex && c.id === LEGEND.id);
      expect(elsewhere).toHaveLength(0);
    }
  });

  it('never repeats a card back to back — the gold pool is small enough to', () => {
    for (const { cards } of encores(200)) {
      for (let i = 1; i < cards.length; i++) {
        expect(cards[i].id).not.toBe(cards[i - 1].id);
      }
    }
  });

  it('leaves run-out cards after the prize so it settles mid-reel', () => {
    for (const { cards, winIndex } of encores(200)) {
      expect(cards.length - winIndex - 1).toBeGreaterThanOrEqual(3);
    }
  });

  it('varies its landing index — an encore is still a spin, not a cut', () => {
    const seen = new Set(encores(200).map(r => r.winIndex));
    expect(seen.size).toBeGreaterThan(3);
  });

  it('works for mythic and animated wins too, without downgrading them', () => {
    const mythic = { id: 'x_myth', emoji: '🌠', name: 'Myth', rarity: 'mythic', type: 'sticker' };
    const { cards, winIndex } = buildLegendaryReel(mythic);
    expect(cards[winIndex]).toBe(mythic);
    expect(cards.every(c => isEncoreTier(c.rarity))).toBe(true);
  });
});

describe('gold tier — which pull gets which treatment', () => {
  it('paints legendary gold, and nothing below it', () => {
    expect(isGoldCard('legendary')).toBe(true);
    for (const r of ['common', 'uncommon', 'rare', 'epic']) {
      expect(isGoldCard(r)).toBe(false);
    }
  });

  it('leaves mythic and animated their own colour', () => {
    expect(isGoldCard('mythic')).toBe(false);
    expect(isGoldCard('animated')).toBe(false);
  });

  it('still gives mythic and animated the encore — they outrank legendary', () => {
    for (const r of ['legendary', 'mythic', 'animated']) expect(isEncoreTier(r)).toBe(true);
    for (const r of ['common', 'uncommon', 'rare', 'epic']) expect(isEncoreTier(r)).toBe(false);
  });
});

describe('splitIntoWaves — batch opens in stacks of 4', () => {
  it('splits 6 into 4 + 2, the reported example', () => {
    const r = splitIntoWaves(Array.from({ length: 6 }, (_, i) => i));
    expect(r.map(w => w.length)).toEqual([4, 2]);
  });

  it('handles exact multiples without a trailing empty wave', () => {
    expect(splitIntoWaves(Array.from({ length: 8 }, (_, i) => i)).map(w => w.length))
      .toEqual([4, 4]);
  });

  it('caps every wave at four', () => {
    for (let n = 1; n <= 10; n++) {
      const waves = splitIntoWaves(Array.from({ length: n }, (_, i) => i));
      expect(Math.max(...waves.map(w => w.length))).toBeLessThanOrEqual(4);
    }
  });

  it('never drops or duplicates a result', () => {
    for (let n = 1; n <= 10; n++) {
      const input = Array.from({ length: n }, (_, i) => i);
      expect(splitIntoWaves(input).flat()).toEqual(input);
    }
  });

  it('returns no waves for an empty batch', () => {
    expect(splitIntoWaves([])).toEqual([]);
  });
});
