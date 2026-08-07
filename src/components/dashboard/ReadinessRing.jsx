// src/components/dashboard/ReadinessRing.jsx
//
// The readiness dial, and the one place its palette lives.
//
// This SVG existed twice inside ReadinessCard — once for the compact
// variant, once for the full one — and board 02 puts a third copy in the
// sheet header, which is what finally made the duplication worth paying
// off. Three call sites, one arc.
//
// The score sits inside as `children` rather than as a prop: the card
// renders it at text-xs / text-base and the sheet at text-2xl, and a
// `scoreClassName` prop would just be children with extra steps.

import React from 'react';
import { motion } from 'framer-motion';

// A fixed traffic-light palette across themes — green = ready, amber =
// moderate, red = depleted. The hex strokes stay in sync with the Tailwind
// utilities beside them (each row's `ring` is that colour's -500 default).
// If the project ever exposes --readiness-* CSS vars, swap these to var()
// refs without touching any JSX.
export const READINESS_COLORS = {
  Primed:   { bg: 'bg-success/10',     border: 'border-success/30',     text: 'text-success',     ring: '#10b981' /* emerald-500 */ },
  Ready:    { bg: 'bg-success/10',     border: 'border-success/30',     text: 'text-success',     ring: '#22c55e' /* green-500 */ },
  Moderate: { bg: 'bg-primary/10',     border: 'border-primary/30',     text: 'text-primary',     ring: '#f59e0b' /* amber-500 */ },
  Tired:    { bg: 'bg-primary/10',     border: 'border-primary/30',     text: 'text-primary',     ring: '#fb923c' /* orange-400 */ },
  Depleted: { bg: 'bg-destructive/10', border: 'border-destructive/30', text: 'text-destructive', ring: '#f43f5e' /* rose-500 */ },
};

/**
 * Resolve a readiness label to its palette, defending against a future
 * score engine returning something unmapped — an unknown label used to
 * render the card as a blank rather than falling back.
 */
export function readinessColors(label) {
  return READINESS_COLORS[label] ? READINESS_COLORS[label] : READINESS_COLORS.Ready;
}

export default function ReadinessRing({ score = 0, color, size = 64, stroke = 6, className = '', children }) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  // Clamp: a score engine returning >100 would otherwise wind the arc past
  // a full turn and read as an empty ring.
  const pct = Math.max(0, Math.min(100, Number(score) || 0));
  const dashOffset = circ * (1 - pct / 100);

  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke="hsl(var(--secondary))"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}
