// src/components/emptyStateIllustrations.jsx
//
// Inline SVG illustrations for empty states. Each is a small, friendly,
// minimal-stroke scene (~140-200 lines of svg) sized at 160×120 px,
// designed to feel like a doodle rather than stock art. Uses
// `currentColor` so they tint with the surrounding text — drop into a
// `text-primary` / `text-muted-foreground` wrapper to control color.
//
// USAGE
//
//   <EmptyState
//     illustration={<NoPostsIllustration />}
//     title="No posts yet"
//     ...
//   />
//
// All illustrations share the same outer SVG container so they swap
// cleanly inside <EmptyState illustration={...} />.

import React from 'react';

const SVG_PROPS = {
  width: 160,
  height: 120,
  viewBox: '0 0 160 120',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

// Plate + steam — for empty meal log.
export function NoMealsIllustration() {
  return (
    <svg {...SVG_PROPS}>
      <ellipse cx="80" cy="80" rx="42" ry="10" opacity="0.5" />
      <path d="M40 76 Q80 56 120 76" />
      <circle cx="70" cy="70" r="6" opacity="0.7" />
      <circle cx="90" cy="68" r="5" opacity="0.7" />
      <path d="M70 40 q-4 -8 0 -16" opacity="0.6" />
      <path d="M82 40 q-4 -8 0 -16" opacity="0.6" />
      <path d="M94 40 q-4 -8 0 -16" opacity="0.6" />
    </svg>
  );
}

// Dumbbell — for empty workout history.
export function NoWorkoutsIllustration() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="34" y="56" width="14" height="20" rx="2" />
      <rect x="112" y="56" width="14" height="20" rx="2" />
      <rect x="44" y="62" width="8" height="8" rx="1.5" />
      <rect x="108" y="62" width="8" height="8" rx="1.5" />
      <line x1="52" y1="66" x2="108" y2="66" />
      <path d="M80 30 v8" opacity="0.5" />
      <path d="M68 36 l4 6" opacity="0.5" />
      <path d="M92 36 l-4 6" opacity="0.5" />
    </svg>
  );
}

// People silhouettes — for empty followers/squad lists.
export function NoFriendsIllustration() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="60" cy="50" r="10" />
      <path d="M44 88 q0 -14 16 -14 t16 14" />
      <circle cx="100" cy="50" r="10" />
      <path d="M84 88 q0 -14 16 -14 t16 14" />
      <path d="M80 22 v6" opacity="0.5" />
      <path d="M76 26 l8 0" opacity="0.5" />
    </svg>
  );
}

// Bubble + ellipsis — for empty DM thread / no messages yet.
export function NoMessagesIllustration() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M40 50 q0 -16 16 -16 h48 q16 0 16 16 v18 q0 16 -16 16 h-30 l-12 12 v-12 h-6 q-16 0 -16 -16 z" />
      <circle cx="65" cy="60" r="2.5" fill="currentColor" />
      <circle cx="80" cy="60" r="2.5" fill="currentColor" />
      <circle cx="95" cy="60" r="2.5" fill="currentColor" />
    </svg>
  );
}

// Trophy — for empty achievements / no PRs.
export function NoTrophyIllustration() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M62 36 h36 v18 a18 18 0 0 1 -36 0 z" />
      <path d="M62 42 q-12 0 -12 12 q0 8 12 10" opacity="0.7" />
      <path d="M98 42 q12 0 12 12 q0 8 -12 10" opacity="0.7" />
      <line x1="68" y1="76" x2="92" y2="76" />
      <line x1="74" y1="84" x2="86" y2="84" />
      <line x1="80" y1="76" x2="80" y2="84" />
      <path d="M70 28 q4 -6 10 -6 t10 6" opacity="0.6" />
    </svg>
  );
}

// Calendar grid — for empty stats / no data window.
export function NoDataIllustration() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="38" y="38" width="84" height="60" rx="4" />
      <line x1="38" y1="54" x2="122" y2="54" />
      <line x1="56" y1="38" x2="56" y2="34" />
      <line x1="104" y1="38" x2="104" y2="34" />
      <circle cx="58" cy="70" r="2" fill="currentColor" opacity="0.6" />
      <circle cx="76" cy="70" r="2" fill="currentColor" opacity="0.6" />
      <circle cx="94" cy="70" r="2" fill="currentColor" opacity="0.6" />
      <circle cx="58" cy="86" r="2" fill="currentColor" opacity="0.4" />
      <circle cx="76" cy="86" r="2" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

// Flag on a peak — for empty goals.
export function NoGoalsIllustration() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M30 92 L70 50 L100 78 L130 56" />
      <line x1="70" y1="50" x2="70" y2="24" />
      <path d="M70 24 L96 30 L70 38 Z" />
      <line x1="30" y1="92" x2="130" y2="92" opacity="0.4" />
    </svg>
  );
}

// Empty feed — page with line items.
export function NoFeedIllustration() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="38" y="32" width="84" height="60" rx="4" />
      <circle cx="52" cy="48" r="6" />
      <line x1="64" y1="46" x2="108" y2="46" />
      <line x1="64" y1="52" x2="92" y2="52" opacity="0.5" />
      <line x1="46" y1="72" x2="114" y2="72" opacity="0.5" />
      <line x1="46" y1="80" x2="98" y2="80" opacity="0.5" />
    </svg>
  );
}
