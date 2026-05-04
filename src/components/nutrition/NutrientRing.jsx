// src/components/nutrition/NutrientRing.jsx
// SVG circular progress ring used when the "Nutrient ring view" setting is on.
// Inherits color from parent via `currentColor` so callers just need to set a
// Tailwind text-color class on a wrapping element.

import { motion } from 'framer-motion';

const VIEW = 48;          // viewBox size (square)
const STROKE = 4.5;       // ring thickness
const R = (VIEW - STROKE) / 2;  // radius = 21.75
const CIRC = 2 * Math.PI * R;   // full circumference ≈ 136.66

/**
 * @param {number}  percent  0-100, clamped automatically
 * @param {number}  size     rendered pixel size (default 48)
 * @param {string}  className  extra classes applied to the <svg>
 */
export default function NutrientRing({ percent = 0, size = 48, className = '' }) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const offset  = CIRC * (1 - clamped / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={className}
      // Rotate so progress starts from the top (12 o'clock position)
      style={{ transform: 'rotate(-90deg)', display: 'block' }}
      aria-hidden="true"
    >
      {/* Track ring */}
      <circle
        cx={VIEW / 2}
        cy={VIEW / 2}
        r={R}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={STROKE}
      />
      {/* Progress arc */}
      <motion.circle
        cx={VIEW / 2}
        cy={VIEW / 2}
        r={R}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={CIRC}
        initial={{ strokeDashoffset: CIRC }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
      />
    </svg>
  );
}
