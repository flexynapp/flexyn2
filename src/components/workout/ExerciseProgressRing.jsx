// src/components/workout/ExerciseProgressRing.jsx
//
// One ring per exercise, filled by its checked sets. It is the exercise's
// progress at a glance, and the thing that closes when the last set is
// checked: the ring turns green, pops, and throws a small burst before
// ExerciseLogger folds the card away. The idea is Apple Fitness's closing
// rings, applied to one exercise instead of one day.

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const R = 15;
const CIRC = 2 * Math.PI * R;
const PARTICLES = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2;
  const d = 30 + (i % 3) * 8;
  return { x: Math.round(Math.cos(a) * d), y: Math.round(Math.sin(a) * d), tone: i % 2 ? 'bg-success' : 'bg-primary', delay: (i % 2) * 0.04 };
});

export default function ExerciseProgressRing({ done = 0, total = 0, bursting = false }) {
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  const complete = total > 0 && done >= total;
  return (
    <motion.div
      className="relative w-9 h-9 shrink-0"
      animate={bursting ? { scale: [1, 1.25, 1] } : { scale: 1 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      role="img"
      aria-label={`${done} of ${total} sets done`}
    >
      <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={R} fill="none" strokeWidth="3" className="stroke-border" />
        <motion.circle
          cx="18" cy="18" r={R} fill="none" strokeWidth="3" strokeLinecap="round"
          className={complete ? 'stroke-success' : 'stroke-primary'}
          strokeDasharray={CIRC}
          initial={false}
          animate={{ strokeDashoffset: CIRC * (1 - frac) }}
          transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </svg>
      <span
        aria-hidden="true"
        className={[
          'absolute inset-0 flex items-center justify-center text-micro font-bold tabular-nums',
          complete ? 'text-success' : 'text-muted-foreground',
        ].join(' ')}
      >
        {complete ? '✓' : `${done}/${total}`}
      </span>
      <AnimatePresence>
        {bursting && PARTICLES.map((p, i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className={`absolute left-1/2 top-1/2 -ml-[3px] -mt-[3px] w-1.5 h-1.5 rounded-sm pointer-events-none ${p.tone}`}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, delay: p.delay, ease: 'easeOut' }}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
