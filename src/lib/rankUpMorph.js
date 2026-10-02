// src/lib/rankUpMorph.js
//
// The geometry of a crest turning into another crest, for a first
// placement and a demotion (Kegan approved it on 2026-10-02, from the
// motion previews). The outline melts from one league's shape into the
// next instead of cross-fading two pictures: wings grow out of the
// shoulders or fold back into them, a shield cuts itself into a stone or
// rounds back into a shield, and the glyph on it swaps as the shape passes
// halfway.
//
// No path library. Every shape is described by the same few numbers, so
// any league can turn into any other by interpolating them:
//
//   wings  { size, lift } from LeagueTierIcon, size 0 meaning none. A wing
//          scaled to 0 collapses into its shoulder point, so growing one
//          from nothing never passes through a blob.
//   body   the shield and the cut stone drawn on the same ten points, so
//          the outline between them is always a real shield-ish outline.
//   spike  Platinum's point above the crest, 0 or 1.
//   crown  Legend's crown, 0 or 1.
//
// Pure functions. No DOM.

import { TIER_WINGS, wingPath } from '@/components/leagues/LeagueTierIcon';

// The shield, as ten points: M p0 L p1 L p2 C p3 p4 p5 C p6 p7 p8 L p9 Z.
const SHIELD = [32, 8, 50, 14, 50, 31, 50, 43, 42, 51, 32, 57, 22, 51, 14, 43, 14, 31, 14, 14];
// The cut stone on the same ten points, with its straight sides written as
// curves whose handles sit on the line. `y` is how far down the crest the
// stone sits (Diamond 2, Legend 6, as LeagueTierIcon draws them).
const gem = (y) => [32, 17 + y, 43, 17 + y, 50, 27 + y, 44, 36 + y, 38, 45 + y, 32, 54 + y, 26, 45 + y, 20, 36 + y, 14, 27 + y, 21, 17 + y];

const f = (n) => Math.round(n * 100) / 100;

/** The numbers that describe a league's crest. */
export function crestShape(tier) {
  const wings = TIER_WINGS[tier] ?? null;
  return {
    wing: wings ? { size: wings.size, lift: wings.lift } : { size: 0, lift: 0 },
    body: tier === 'diamond' ? gem(2) : tier === 'legend' ? gem(6) : SHIELD,
    spike: tier === 'platinum' ? 1 : 0,
    crown: tier === 'legend' ? 1 : 0,
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

/** The body outline between two shapes, at t from 0 to 1. */
export function bodyPath(a, b, t) {
  const p = a.map((v, i) => f(lerp(v, b[i], t)));
  return `M${p[0]} ${p[1]} L${p[2]} ${p[3]} L${p[4]} ${p[5]} C${p[6]} ${p[7]} ${p[8]} ${p[9]} ${p[10]} ${p[11]} C${p[12]} ${p[13]} ${p[14]} ${p[15]} ${p[16]} ${p[17]} L${p[18]} ${p[19]} Z`;
}

/**
 * Everything the morph draws at t (0 to 1, already eased): the wing and its
 * coverts, the body, and how present the spike and the crown are.
 */
export function morphAt(from, to, t) {
  const size = lerp(from.wing.size, to.wing.size, t);
  const lift = lerp(from.wing.lift, to.wing.lift, t);
  return {
    wing: wingPath(size, lift),
    covert: wingPath(size * 0.62, lift * 0.6),
    // A wing smaller than this is a speck at the shoulder: fade it rather
    // than draw a dot.
    wingOpacity: f(Math.min(1, size / 0.18)),
    body: bodyPath(from.body, to.body, t),
    spike: f(lerp(from.spike, to.spike, t)),
    crown: f(lerp(from.crown, to.crown, t)),
  };
}

/** Ease in and out, so the shape starts and settles without a jolt. */
export function morphEase(t) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function hexRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/**
 * A palette greyed exactly the way the sequence greys a real crest: a copy
 * under `grayscale(1) brightness(0.45)` laid over it at `amount`. Drawing
 * the morph in these colours is what lets the real crest hand over to it
 * without a visible change.
 */
export function greyPalette(palette, amount = 0.92) {
  const out = {};
  Object.entries(palette).forEach(([k, hex]) => {
    if (typeof hex !== 'string' || !hex.startsWith('#')) return;
    const [r, g, b] = hexRgb(hex);
    // The luminance weights CSS grayscale() uses.
    const grey = (0.2126 * r + 0.7152 * g + 0.0722 * b) * 0.45;
    out[k] = toHex([r, g, b].map((v) => v + (grey - v) * amount));
  });
  return out;
}
