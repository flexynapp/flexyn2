// src/components/regimens/StarRating.jsx
//
// Static + interactive star renderer. Two modes:
//
//   <StarRating value={4.6} />              — read-only display
//   <StarRating value={3} onChange={fn} />  — interactive picker (1-5)
//
// In display mode we render half-filled stars when value is fractional;
// in interactive mode we always commit a whole star (1-5 ints).

import React, { useState } from 'react';
import { Star } from 'lucide-react';

const SIZES = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

export default function StarRating({
  value = 0,
  onChange = null,
  size = 'sm',
  className = '',
}) {
  const interactive = typeof onChange === 'function';
  const [hover, setHover] = useState(0);
  const sizeClass = SIZES[size] || SIZES.sm;
  const v = Number.isFinite(value) ? Math.max(0, Math.min(5, value)) : 0;

  return (
    <div className={`flex items-center gap-0.5 ${className}`} role={interactive ? 'radiogroup' : 'img'} aria-label={`Rating: ${v} out of 5`}>
      {[1, 2, 3, 4, 5].map(i => {
        const active = interactive ? (hover || v) >= i : v >= i - 0.25;
        const halfFilled = !interactive && v >= i - 0.75 && v < i - 0.25;
        const fillClass = active
          ? 'fill-amber-400 text-amber-400'
          : halfFilled
            ? 'fill-amber-400/50 text-amber-400'
            : 'text-muted-foreground/40';
        const cursor = interactive ? 'cursor-pointer' : '';
        return (
          <button
            key={i}
            type="button"
            onClick={interactive ? () => onChange(i) : undefined}
            onMouseEnter={interactive ? () => setHover(i) : undefined}
            onMouseLeave={interactive ? () => setHover(0) : undefined}
            disabled={!interactive}
            aria-label={interactive ? `Rate ${i} star${i === 1 ? '' : 's'}` : undefined}
            className={`p-0 bg-transparent border-none ${cursor} disabled:cursor-default`}
            tabIndex={interactive ? 0 : -1}
          >
            <Star className={`${sizeClass} ${fillClass} transition-colors`} />
          </button>
        );
      })}
    </div>
  );
}
