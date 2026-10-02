// src/components/nav/TabIcons.jsx
//
// The four tab bar icons, drawn from lucide's own geometry (LayoutDashboard,
// Play, Users, CircleUser) so they look identical at rest, with one short
// motion each that plays when the tab BECOMES active:
//
//   Today  the four tiles settle in, one after another
//   Train  the play arrow nudges forward
//   Hub    the second person pops up beside the first
//   You    the outline draws round, then the head and shoulders
//
// Answer tier (see TIER in @/lib/motion): under 0.4s, same orange as the
// label, transform, opacity and stroke drawing only, no glow. Nothing plays
// on first load, on a re-tap of the tab you are on, or with Reduce Motion
// on, where the icon simply is its final shape.
//
// Two things that broke in the preview and must not come back:
// - Never set `transformBox: fill-box` on these shapes yourself. framer
//   already computes an SVG transform origin in px; adding fill-box makes it
//   measure from the wrong box and the shape jumps.
// - Each icon remounts its svg on a new play (the `key`), so `initial` runs
//   again. Without the key the motion plays once per page load.

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { EASE_OUT, SPRING } from '@/lib/motion';
import { prefersReducedMotion } from '@/lib/reducedMotion';

/**
 * A counter that goes up each time `active` turns true after mount.
 * 0 means "never played", so the first render draws the resting icon.
 */
export function usePlayOnActivate(active) {
  const [plays, setPlays] = useState(0);
  const was = useRef(active);
  useEffect(() => {
    if (active && !was.current && !prefersReducedMotion()) setPlays((n) => n + 1);
    was.current = active;
  }, [active]);
  return plays;
}

const svgProps = (active) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: active ? 2.5 : 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'w-5 h-5',
  'aria-hidden': true,
  focusable: false,
});

const TILES = [
  { x: 3, y: 3, width: 7, height: 9 },
  { x: 14, y: 3, width: 7, height: 5 },
  { x: 14, y: 12, width: 7, height: 9 },
  { x: 3, y: 16, width: 7, height: 5 },
];

export function TodayIcon({ active }) {
  const play = usePlayOnActivate(active);
  return (
    <svg {...svgProps(active)} key={play}>
      {TILES.map((r, i) => (
        <motion.rect
          key={i}
          {...r}
          rx="1"
          initial={play ? { scale: 0.45, opacity: 0.3 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ ...SPRING.pop, delay: i * 0.05 }}
        />
      ))}
    </svg>
  );
}

export function TrainIcon({ active }) {
  const play = usePlayOnActivate(active);
  return (
    <svg {...svgProps(active)} key={play}>
      <motion.polygon
        points="6 3 20 12 6 21 6 3"
        initial={false}
        animate={play ? { x: [0, 3.5, 0] } : { x: 0 }}
        transition={{ duration: 0.34, ease: EASE_OUT, times: [0, 0.4, 1] }}
      />
    </svg>
  );
}

export function HubIcon({ active }) {
  const play = usePlayOnActivate(active);
  return (
    <svg {...svgProps(active)} key={play}>
      <motion.g
        initial={false}
        animate={play ? { y: [0, 1.2, 0] } : { y: 0 }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
      >
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
      </motion.g>
      <motion.g
        initial={play ? { y: 4, opacity: 0 } : false}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...SPRING.pop, delay: 0.08 }}
      >
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </motion.g>
    </svg>
  );
}

export function YouIcon({ active }) {
  const play = usePlayOnActivate(active);
  return (
    <svg {...svgProps(active)} key={play}>
      {/* Rotated a quarter turn so the outline draws from the top. */}
      <motion.circle
        cx="12"
        cy="12"
        r="10"
        initial={play ? { pathLength: 0, rotate: -90 } : false}
        animate={{ pathLength: 1, rotate: -90 }}
        transition={{ duration: 0.34, ease: EASE_OUT }}
      />
      <motion.circle
        cx="12"
        cy="10"
        r="3"
        initial={play ? { scale: 0.3 } : false}
        animate={{ scale: 1 }}
        transition={{ ...SPRING.pop, delay: 0.1 }}
      />
      <motion.path
        d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"
        initial={play ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.24, ease: EASE_OUT, delay: 0.12 }}
      />
    </svg>
  );
}
