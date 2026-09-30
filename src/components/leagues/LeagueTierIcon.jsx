// src/components/leagues/LeagueTierIcon.jsx
//
// The league tiers' own marks. They replace the medal emoji (🥉🥈🥇💠💎👑),
// which rendered differently on every platform, could not take the tier
// colour, and read as stickers next to the app's drawn icons.
//
// The six marks are one ladder, read the way rank insignia are:
//   bronze   one chevron
//   silver   two chevrons
//   gold     three chevrons
//   platinum a star
//   diamond  a cut stone
//   legend   a crown
// Chevrons count up through the metals, so the first three tiers are
// ordered by shape alone and survive a colour-blind reading.
//
// Every mark is solid and filled with currentColor on a 24 grid. The
// caller sets the colour, usually `onTierColor(tier.color)` on a chip in
// the tier colour (see LeagueTierBadge below). No strokes: a 1.5px line
// disappears at the 14px the ladder draws these.

import React from 'react';
import { getTier, onTierColor } from '@/lib/leagueTiers';

// One up-pointing chevron, apex at (12, y), arms `h` tall and `t` thick.
const chevron = (y, h = 6, t = 3.5) =>
  `M4 ${y + h}L12 ${y}L20 ${y + h}V${y + h + t}L12 ${y + t}L4 ${y + h + t}Z`;

const MARKS = {
  bronze: <path d={chevron(7, 7, 4.5)} />,
  silver: (
    <>
      <path d={chevron(3.5, 6.5, 4)} />
      <path d={chevron(11, 6.5, 4)} />
    </>
  ),
  gold: (
    <>
      <path d={chevron(2)} />
      <path d={chevron(8)} />
      <path d={chevron(14)} />
    </>
  ),
  platinum: (
    <path d="M12 2.5l2.85 6.1 6.65.8-4.92 4.55 1.3 6.6L12 17.2l-5.88 3.35 1.3-6.6L2.5 9.4l6.65-.8z" />
  ),
  // Crown (the table and girdle) above the pavilion, split by a gap so it
  // reads as a cut stone and not a kite.
  diamond: (
    <>
      <path d="M7.4 3.5h9.2l4.2 5.2H3.2z" />
      <path d="M3.2 10.4h17.6L12 21z" />
    </>
  ),
  legend: (
    <>
      <path d="M3 6.5l4.6 4.3L12 3.5l4.4 7.3L21 6.5l-1.8 10H4.8z" />
      <path d="M4.8 18h14.4v2.5H4.8z" />
    </>
  ),
};

/** The bare mark in currentColor. `tier` is a league tier id. */
export default function LeagueTierIcon({ tier, className = 'w-4 h-4', ...rest }) {
  const mark = MARKS[tier] || MARKS.bronze;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {mark}
    </svg>
  );
}

/**
 * The mark on a solid chip in the tier colour. This is the one form the
 * tier colour takes on the card, the standings and the ladder, so the
 * chip and its ink are decided here rather than at each call site.
 */
export function LeagueTierBadge({ tier, size = 32, className = '' }) {
  const meta = getTier(tier);
  return (
    <span
      className={`shrink-0 inline-flex items-center justify-center rounded-sm ${className}`}
      style={{ width: size, height: size, backgroundColor: meta.color, color: onTierColor(meta.color) }}
      aria-hidden="true"
    >
      <LeagueTierIcon tier={meta.id} style={{ width: Math.round(size * 0.6), height: Math.round(size * 0.6) }} className="" />
    </span>
  );
}
