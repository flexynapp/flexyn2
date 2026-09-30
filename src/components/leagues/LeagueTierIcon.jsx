// src/components/leagues/LeagueTierIcon.jsx
//
// League emblems. Each tier is a crest the user earns, and each one is
// visibly MORE than the one below it, so the next tier up always looks
// like something worth reaching:
//
//   bronze    a plain shield with one chevron
//   silver    the shield grows small wings, two chevrons
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

// A left wing, three feathers stepping down; the right is its mirror.
const WING_SMALL = [
  'M15 17 L4 14 L7 21 Z',
  'M15 23 L3 23 L7 28 Z',
  'M15 29 L6 32 L10 35 Z',
];
const WING_FULL = [
  'M15 16 L1 10 L5 18 Z',
  'M15 21 L0 19 L5 25 Z',
  'M15 26 L1 28 L6 32 Z',
  'M15.5 31 L4 37 L10 38 Z',
];
const WING_SWEPT = [
  'M15 15 L2 4 L4 14 Z',
  'M15 20 L0 13 L3 21 Z',
  'M15 25 L0 23 L4 29 Z',
  'M15 30 L2 33 L7 36 Z',
  'M16 35 L6 42 L12 42 Z',
];

const chevron = (y) => `M21 ${y + 7} L32 ${y} L43 ${y + 7} V${y + 12} L32 ${y + 5} L21 ${y + 12} Z`;
const STAR = 'M32 20 L35.3 27.2 L43 28 L37.2 33.2 L38.8 41 L32 37 L25.2 41 L26.8 33.2 L21 28 L28.7 27.2 Z';

function Wings({ feathers, p }) {
  return (
    <>
      {feathers.map((d, i) => (
        <path key={`l${i}`} d={d} fill={i % 2 ? p.mid : p.light} stroke={p.rim} strokeWidth="1.2" strokeLinejoin="round" />
      ))}
      <g transform="translate(64 0) scale(-1 1)">
        {feathers.map((d, i) => (
          <path key={`r${i}`} d={d} fill={i % 2 ? p.dark : p.mid} stroke={p.rim} strokeWidth="1.2" strokeLinejoin="round" />
        ))}
      </g>
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
      {/* The crown sits on the stone's table. */}
      <path d="M22 22 L20 11 L26.5 16 L32 8 L37.5 16 L44 11 L42 22 Z" fill={p.crown} stroke={p.rim} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M32 8 L37.5 16 L44 11 L42 22 H32 Z" fill={p.crownDark} />
      <path d="M22 22 L20 11 L26.5 16 L32 8 L37.5 16 L44 11 L42 22 Z" fill="none" stroke={p.rim} strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="32" cy="17" r="1.8" fill={p.light} stroke={p.rim} strokeWidth="0.8" />
    </>
  ),
};

/** The emblem for a league tier id. Decorative: the tier name is always
 *  in text beside it, so it is hidden from screen readers. */
export default function LeagueTierIcon({ tier, className = 'w-8 h-8', ...rest }) {
  const id = PALETTES[tier] ? tier : 'bronze';
  const palette = { ...PALETTES[id], mid: getTier(id).color };
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false" {...rest}>
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
