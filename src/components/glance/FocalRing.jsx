// src/components/glance/FocalRing.jsx
//
// The ring around a page's one focal number (hero option D). It fills on a
// spring when it mounts and again whenever the value moves, and fires a
// haptic the moment the value ADVANCES after mount: logging a set or a meal
// is what moves it, so the buzz lands on the thing the user just did.
//
// Reduced motion draws the final arc with no travel. The haptic helper
// already stays silent under reduced motion, so nothing here re-checks it.
//
// `share` is 0..1, or null for "no target": then no arc is drawn at all and
// only the track shows, because an arc against a number the user never chose
// reads as a goal they are failing.

import React, { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { triggerHaptic } from '@/lib/haptic';

const SPRING = { type: 'spring', stiffness: 90, damping: 18, mass: 0.9 };

export default function FocalRing({ share = null, advance = null, size = 132, stroke = 12, label, children }) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const hasArc = typeof share === 'number' && Number.isFinite(share);
  const offset = hasArc ? c * (1 - Math.max(0, Math.min(1, share))) : c;

  // Haptic on advance. `advance` is the raw count (sessions, kcal), not the
  // share, so a change of target never buzzes. The first value seen is the
  // baseline: opening the page is not an achievement.
  const prev = useRef(null);
  useEffect(() => {
    const n = Number(advance);
    if (!Number.isFinite(n)) return;
    if (prev.current != null && n > prev.current) triggerHaptic('success');
    prev.current = n;
  }, [advance]);

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="block">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={stroke} />
        {hasArc && share > 0 && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            initial={reduce ? false : { strokeDashoffset: c }}
            animate={{ strokeDashoffset: offset }}
            transition={reduce ? { duration: 0 } : SPRING}
            data-testid="focal-ring-arc"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden={label ? 'true' : undefined}>
        {children}
      </div>
    </div>
  );
}
