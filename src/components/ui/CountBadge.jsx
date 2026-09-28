// src/components/ui/CountBadge.jsx
//
// The one unread mark for an icon: a count pill, or a plain dot.
//
// There were four, drawn four ways: the bell (destructive, a five-step
// wobble on every change), the sidebar Messages icon (destructive, a fade),
// the Social tab (primary, no motion) and the Market chest dot (a raw
// `bg-red-500`, so a different red from the theme's in dark mode). They sat
// side by side in the same header and sidebar.
//
// What every mark here does, and why:
//   • A 2px ring in the surface colour cuts it away from the icon it sits
//     on. Without it the pill touches the glyph's outline and, at phone
//     size, the two read as one blob. The ring colour is the host's
//     background, so pass `ring` when the host is not `bg-card`.
//   • It pops once when it appears or its number changes, and shrinks away
//     when it clears. A refresh that returns the same value does nothing.
//   • Tone is `alert` (destructive) for the bell and `primary` for
//     everything else. A message or a ready chest is not an error.
//
// Position is the host's job (`className`), because the glyph under it
// differs: the bell's shoulder is not where a speech bubble's is.

import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

const TONE = {
  alert:   'bg-destructive text-destructive-foreground',
  primary: 'bg-primary text-primary-foreground',
};

export default function CountBadge({
  count = 0,
  dot = false,
  tone = 'alert',
  ring = 'border-card',
  className = '',
  label,
}) {
  const reduce = useReducedMotion();
  const showCount = count > 0;
  const show = showCount || dot;
  const key = showCount ? `n${count}` : 'dot';

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          key={key}
          data-badge={showCount ? 'count' : 'dot'}
          initial={reduce ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { scale: 0, opacity: 0, transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 700, damping: 20 }}
          aria-hidden={label ? undefined : 'true'}
          aria-label={label}
          className={`absolute pointer-events-none rounded-full border-2 ${ring} ${TONE[tone] || TONE.alert} ${
            showCount
              ? 'min-w-[18px] h-[18px] px-1 text-micro font-bold leading-none tabular-nums flex items-center justify-center'
              : 'w-2.5 h-2.5 box-content'
          } ${className}`}
        >
          {showCount ? (count > 9 ? '9+' : count) : null}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
