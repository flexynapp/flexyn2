// src/components/loot/CapsuleIcon.jsx
//
// The capsule, drawn as a capsule.
//
// Every surface used to render a capsule as 📦 / 🎁 / 💠 — a cardboard
// box, a wrapped present and a diamond. Three different objects, none of
// them the thing the product actually calls a capsule. A capsule is the
// gachapon sphere: two shells that meet at a seam, the coloured half on
// top, the clear half below.
//
// So it's an SVG rather than an emoji: the shape has to be a sphere on
// every platform (emoji art is per-vendor), and the tier has to read as
// colour rather than as a completely different object. Steel / gold /
// aurora, one shape.
//
// Emoji-only surfaces — toast titles, push notification icons, catalog
// rows that are plain strings — use CAPSULE_GLYPH from lootCatalog.js.

import { useId } from 'react';

// Top shell → bottom shell, per tier. The bottom stays pale on all three
// so the "clear half with the prize inside" reading survives at 24px,
// which is the size it renders at in the Bag's batch-open bar.
const PALETTE = {
  standard: {
    domeTop: '#a8b6c6', domeBottom: '#4b5b6d',
    shellTop: '#f8fafc', shellBottom: '#c3cede',
    seam: '#334155', rim: '#1e293b',
  },
  premium: {
    domeTop: '#fcd34d', domeBottom: '#d97706',
    shellTop: '#fffbeb', shellBottom: '#fde68a',
    seam: '#92400e', rim: '#78350f',
  },
  elite: {
    domeTop: '#67e8f9', domeBottom: '#4f46e5',
    shellTop: '#f0fdff', shellBottom: '#c7d2fe',
    seam: '#3730a3', rim: '#312e81',
  },
};

/**
 * @param {'standard'|'premium'|'elite'} [type]
 * @param {number} [size]   px, square
 * @param {string} [label]  when set the icon is exposed to screen readers
 */
export default function CapsuleIcon({ type = 'standard', size = 48, label, className = '', style }) {
  // Gradient ids must be unique per instance — the Bag renders a dozen of
  // these at once and duplicate ids make every capsule take the first
  // one's colours.
  const uid = useId().replace(/:/g, '');
  const p = PALETTE[type] ?? PALETTE.standard;
  const dome  = `cap-dome-${uid}`;
  const shell = `cap-shell-${uid}`;
  const clip  = `cap-clip-${uid}`;

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}
    >
      <defs>
        <linearGradient id={dome} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={p.domeTop} />
          <stop offset="100%" stopColor={p.domeBottom} />
        </linearGradient>
        <linearGradient id={shell} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={p.shellTop} />
          <stop offset="100%" stopColor={p.shellBottom} />
        </linearGradient>
        <clipPath id={clip}>
          <circle cx="32" cy="33" r="24" />
        </clipPath>
      </defs>

      {/* Lower shell — the clear half. */}
      <circle cx="32" cy="33" r="24" fill={`url(#${shell})`} />

      {/* Upper shell — the coloured half, capped at the seam line. */}
      <path d="M8 33 A24 24 0 0 1 56 33 Z" fill={`url(#${dome})`} />

      <g clipPath={`url(#${clip})`}>
        {/* The seam. A capsule reads as two halves or it reads as a ball. */}
        <rect x="4" y="30.5" width="56" height="5" fill={p.seam} opacity="0.9" />
        <rect x="4" y="30.5" width="56" height="1.4" fill="#fff" opacity="0.22" />
        {/* Contact shadow inside the bottom of the shell. */}
        <ellipse cx="32" cy="60" rx="20" ry="9" fill={p.rim} opacity="0.18" />
      </g>

      {/* Specular highlight — sells the sphere more than the gradient does. */}
      <ellipse cx="23" cy="19" rx="8" ry="5" fill="#fff" opacity="0.45" transform="rotate(-28 23 19)" />
      <ellipse cx="42" cy="45" rx="4" ry="2.5" fill="#fff" opacity="0.28" transform="rotate(-28 42 45)" />

      {/* Rim, last, so it sits over both shells. */}
      <circle cx="32" cy="33" r="24" fill="none" stroke={p.rim} strokeWidth="1.6" opacity="0.55" />
    </svg>
  );
}

export { PALETTE as CAPSULE_PALETTE };
