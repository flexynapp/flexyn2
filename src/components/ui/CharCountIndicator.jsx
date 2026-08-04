// src/components/ui/CharCountIndicator.jsx
//
// "127/280" character-count indicator for length-capped inputs. Goes
// amber as the user approaches the limit, red once over. Designed to
// be a quiet inline hint, not a screaming validation error.
//
// USAGE
//
//   <textarea value={bio} onChange={...} maxLength={280} />
//   <CharCountIndicator value={bio} max={280} />
//
// PROPS
//
//   value         The current input value (string).
//   max           Hard cap to display ("X/MAX"). Required.
//   warnAt        Ratio at which to switch to amber. Default 0.85.
//   className     Optional outer wrapper class.
//
// ACCESSIBILITY
//
//   aria-live="polite" so screen readers announce the remaining count
//   without interrupting input. We update on every keystroke but
//   browsers throttle live-region announcements naturally.

import React from 'react';

export default function CharCountIndicator({ value = '', max, warnAt = 0.85, className = '' }) {
  if (!max || max <= 0) return null;
  const len = typeof value === 'string' ? value.length : 0;
  const ratio = len / max;
  const over = len > max;
  const warn = !over && ratio >= warnAt;

  const color = over
    ? 'text-red-500'
    : warn
      ? 'text-amber-500'
      : 'text-muted-foreground';

  return (
    <span
      aria-live="polite"
      className={`text-micro tabular-nums ${color} ${className}`}
    >
      {len}/{max}
    </span>
  );
}
