// src/components/feedback/DrawnCheck.jsx
//
// The check that draws itself in: the one mark every in-place confirmation
// shares (the feedback pill, a button that turns into "Added"), so a
// success looks the same wherever it lands. It pops slightly past full size
// and settles, then the stroke draws. MotionConfig reducedMotion="user" in
// App.jsx turns both into an instant state change.

import { motion } from 'framer-motion';

export default function DrawnCheck({ className = 'w-5 h-5', halo = true }) {
  return (
    <motion.svg
      viewBox="0 0 24 24" className={className} aria-hidden="true"
      initial={{ scale: 0.6 }} animate={{ scale: [0.6, 1.15, 1] }}
      transition={{ duration: 0.45, times: [0, 0.6, 1] }}
    >
      {halo && <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.18" />}
      <motion.path
        d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" strokeWidth="2.6"
        strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 0.32, delay: 0.12, ease: 'easeOut' }}
      />
    </motion.svg>
  );
}
