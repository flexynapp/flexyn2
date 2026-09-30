// src/components/leagues/LeagueTierIcon.jsx
//
// League emblems. Each tier is a crest the user earns, and each one is
// visibly MORE than the one below it, so the next tier up always looks
// like something worth reaching:
//
//   bronze    a plain shield with one chevron
//   silver    small wings, two chevrons
//   gold      full wings and a star
//   platinum  swept wings, a star, and a spike above the crest
//   diamond   the shield becomes a cut stone between great wings
//   legend    the stone crowned
//
// Depth comes from flat facets (a light and a dark half on every part),
// not from gradients: this is a drawn object, so it gets a light source,
// but the app's no-gradient rule still holds. Each tier's palette is its
// league colour plus a lighter and darker step of the same hue, so the
// emblem IS the tier colour and needs no chip behind it.
//
// The shapes live on a 64 grid. The silhouettes differ tier to tier, so
// the ladder still reads at the 14px the profile plate draws them.

import React from 'react';
import { getTier } from '@/lib/leagueTiers';

// light, dark, rim and glyph ink. `mid` is the tier colour itself, read
// from leagueTiers so the emblem and every other use of it cannot drift.
const PALETTES = {
  bronze:   { light: '#EDB27A', dark: '#9A5A22', rim: '#5E3413', ink: '#FFF1E0' },
  silver:   { light: '#F4F6F8', dark: '#8E959D', rim: '#4E555D', ink: '#FFFFFF' },
  gold:     { light: '#FFF08A', dark: '#CE9A04', rim: '#6E4E00', ink: '#FFFBE6' },
  platinum: { light: '#E0FCFF', dark: '#22B8CC', rim: '#0B5D69', ink: '#FFFFFF' },
  diamond:  { light: '#DCEBFF', dark: '#2F6FE0', rim: '#15327A', ink: '#FFFFFF' },
  legend:   { light: '#FFD3DA', dark: '#DB2B4E', rim: '#6E0F2A', ink: '#FFFFFF', crown: '#FACC15', crownDark: '#C99A06' },
};

// Shield, in two halves so the left catches the light.
const SHIELD_OUT_L = 'M32 8 L14 14 V31 C14 43 22 51 32 57 Z';
const SHIELD_OUT_R = 'M32 8 L50 14 V31 C50 43 42 51 32 57 Z';
const SHIELD_IN_L = 'M32 13 L18.5 17.5 V31 C18.5 40.5 24.5 47 32 51.5 Z';
const SHIELD_IN_R = 'M32 13 L45.5 17.5 V31 C45.5 40.5 39.5 47 32 51.5 Z';

// A left wing: a curved leading edge out to the tip, then a scalloped
// trailing edge (one scallop per flight feather) back to the shield. The
// right wing is the mirror. `size` scales it out from the shoulder and
// `lift` raises the tip, so the same wing grows from Silver to Legend.
const TIPS = [[0.5, 7], [1.5, 15], [3.5, 23], [7, 30.5], [12, 36.5]];
function wingPath(size, lift = 0) {
  const pt = ([x, y]) => [16 - (16 - x) * size, 12 + (y - 12) * size - lift * (1 - (y - 6) / 31)];
  const f = (n) => Math.round(n * 10) / 10;
  const [t0x, t0y] = pt(TIPS[0]);
  const [c1x, c1y] = pt([11, 5]);
  const [c2x, c2y] = pt([5, 3]);
  let d = `M16 ${f(12 - lift * 0.3)} C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(t0x)} ${f(t0y)}`;
  for (let i = 1; i < TIPS.length; i++) {
    const [px, py] = TIPS[i - 1];
    const [nx, ny] = pt([px + 3.5, py + 3]);
    const [tx, ty] = pt(TIPS[i]);
    const [qx, qy] = pt([TIPS[i][0] - 1.5, (py + 3 + TIPS[i][1]) / 2]);
    d += ` L${f(nx)} ${f(ny)} Q${f(qx)} ${f(qy)} ${f(tx)} ${f(ty)}`;
  }
  const [ex, ey] = pt([16, 36]);
  return `${d} L${f(ex)} ${f(ey)} Z`;
}
const WING_SMALL = { size: 0.72, lift: 0 };
const WING_FULL = { size: 0.95, lift: 0 };
const WING_SWEPT = { size: 1.05, lift: 5 };

const chevron = (y) => `M21 ${y + 7} L32 ${y} L43 ${y + 7} V${y + 12} L32 ${y + 5} L21 ${y + 12} Z`;
const STAR = 'M32 20 L35.3 27.2 L43 28 L37.2 33.2 L38.8 41 L32 37 L25.2 41 L26.8 33.2 L21 28 L28.7 27.2 Z';

function Wings({ feathers: { size, lift }, p }) {
  const outer = wingPath(size, lift);
  // The coverts: a smaller copy of the wing laid over the root, a step
  // lighter, which is what makes it read as feathers and not a fin.
  const inner = wingPath(size * 0.62, lift * 0.6);
  const side = (fillOuter, fillInner) => (
    <>
      <path d={outer} fill={fillOuter} stroke={p.rim} strokeWidth="1.3" strokeLinejoin="round" />
      <path d={inner} fill={fillInner} stroke={p.rim} strokeWidth="1" strokeLinejoin="round" />
    </>
  );
  return (
    <>
      {side(p.mid, p.light)}
      <g transform="translate(64 0) scale(-1 1)">{side(p.dark, p.mid)}</g>
    </>
  );
}

function Shield({ p }) {
  return (
    <>
      <path d={SHIELD_OUT_L} fill={p.mid} />
      <path d={SHIELD_OUT_R} fill={p.dark} />
      <path d={SHIELD_IN_L} fill={p.light} />
      <path d={SHIELD_IN_R} fill={p.mid} />
      <path d="M32 8 L50 14 V31 C50 43 42 51 32 57 C22 51 14 43 14 31 V14 Z" fill="none" stroke={p.rim} strokeWidth="2" strokeLinejoin="round" />
      {/* A catch-light along the upper left edge, where the light falls. */}
      <path d="M17 16.2 L31 11.6" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />
    </>
  );
}

// The cut stone for Diamond and Legend: a crown row over a pavilion.
function Gem({ p, y = 0 }) {
  return (
    <g transform={`translate(0 ${y})`}>
      <path d="M21 17 H43 L50 27 H14 Z" fill={p.light} />
      <path d="M21 17 L27 27 H14 Z" fill={p.mid} />
      <path d="M43 17 L37 27 H50 Z" fill={p.mid} />
      <path d="M14 27 H32 V54 Z" fill={p.mid} />
      <path d="M50 27 H32 V54 Z" fill={p.dark} />
      <path d="M27 27 L32 54 L37 27 Z" fill={p.light} opacity="0.55" />
      <path d="M21 17 H43 L50 27 L32 54 L14 27 Z" fill="none" stroke={p.rim} strokeWidth="2" strokeLinejoin="round" />
      <path d="M24 20.5 L27 20.5" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
    </g>
  );
}

const EMBLEMS = {
  bronze: (p) => (
    <>
      <Shield p={p} />
      <path d={chevron(25)} fill={p.ink} stroke={p.rim} strokeWidth="1" strokeLinejoin="round" />
    </>
  ),
  silver: (p) => (
    <>
      <Wings feathers={WING_SMALL} p={p} />
      <Shield p={p} />
      <path d={chevron(19)} fill={p.ink} stroke={p.rim} strokeWidth="1" strokeLinejoin="round" />
      <path d={chevron(30)} fill={p.ink} stroke={p.rim} strokeWidth="1" strokeLinejoin="round" />
    </>
  ),
  gold: (p) => (
    <>
      <Wings feathers={WING_FULL} p={p} />
      <Shield p={p} />
      <path d={STAR} fill={p.ink} stroke={p.rim} strokeWidth="1.2" strokeLinejoin="round" />
    </>
  ),
  platinum: (p) => (
    <>
      <Wings feathers={WING_SWEPT} p={p} />
      <path d="M32 0 L36 9 L32 12 L28 9 Z" fill={p.light} stroke={p.rim} strokeWidth="1.2" strokeLinejoin="round" />
      <Shield p={p} />
      <path d={STAR} fill={p.ink} stroke={p.rim} strokeWidth="1.2" strokeLinejoin="round" />
    </>
  ),
  diamond: (p) => (
    <>
      <Wings feathers={WING_SWEPT} p={p} />
      <Gem p={p} y={2} />
    </>
  ),
  legend: (p) => (
    <>
      <Wings feathers={WING_SWEPT} p={p} />
      <Gem p={p} y={6} />
      {/* The crown sits on the stone's table: five points, a jewel on
          each tall one, the right half in shadow like everything else. */}
      <path d="M19 23 L16 8 L24.5 15 L32 4 L39.5 15 L48 8 L45 23 Z" fill={p.crown} />
      <path d="M32 4 L39.5 15 L48 8 L45 23 H32 Z" fill={p.crownDark} />
      <path d="M19 23 L16 8 L24.5 15 L32 4 L39.5 15 L48 8 L45 23 Z" fill="none" stroke={p.rim} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M19.5 19.5 H44.5" stroke={p.rim} strokeWidth="1" opacity="0.6" />
      {[[16, 8], [32, 4], [48, 8]].map(([cx, cy]) => (
        <circle key={cx} cx={cx} cy={cy} r="2.3" fill={p.light} stroke={p.rim} strokeWidth="1" />
      ))}
      <circle cx="32" cy="15" r="2" fill={p.mid} stroke={p.rim} strokeWidth="0.9" />
    </>
  ),
};

/** The emblem for a league tier id. Decorative: the tier name is always
 *  in text beside it, so it is hidden from screen readers. */
export default function LeagueTierIcon({ tier, className = 'w-8 h-8', ...rest }) {
  const id = PALETTES[tier] ? tier : 'bronze';
  const palette = { ...PALETTES[id], mid: getTier(id).color };
  return (
    <svg viewBox="-3 -3 70 70" className={className} aria-hidden="true" focusable="false" {...rest}>
      {EMBLEMS[id](palette)}
    </svg>
  );
}

/**
 * The emblem at a set size. It carries its own colour, so there is no
 * chip behind it any more; the name is kept so the call sites read the
 * same as before.
 */
export function LeagueTierBadge({ tier, size = 32, className = '' }) {
  const meta = getTier(tier);
  return (
    <LeagueTierIcon
      tier={meta.id}
      className={`shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
