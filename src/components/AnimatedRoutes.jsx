import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';

// Order of bottom-tab routes — used to compute slide direction so
// switching forward (Dashboard → Workout) slides right-to-left, and
// switching backward (Workout → Dashboard) slides left-to-right.
// Routes not in this list (modals, sub-routes) get a soft cross-fade
// instead of a directional slide to avoid "where did the page come
// from" confusion.
const TAB_ORDER = [
  '/dashboard',
  '/workout',
  '/hub',
  '/progress',
  '/nutrition',
];

function tabIndex(pathname) {
  return TAB_ORDER.indexOf(pathname);
}

export default function AnimatedRoutes({ children }) {
  const location = useLocation();
  const previousPathRef = useRef(location.pathname);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReducedMotion(mq.matches);
    const handler = (e) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  // Directional slide: -1 = previous was further right → new slides in
  // from left. +1 = previous was further left → new slides in from
  // right. 0 = non-tab transition → cross-fade only.
  const prevIdx = tabIndex(previousPathRef.current);
  const currIdx = tabIndex(location.pathname);
  const direction =
    prevIdx >= 0 && currIdx >= 0 && prevIdx !== currIdx
      ? Math.sign(currIdx - prevIdx)
      : 0;

  useEffect(() => {
    previousPathRef.current = location.pathname;
  }, [location.pathname]);

  // Reduced motion → no transform, cross-fade only. Modest distance
  // (24px) keeps the slide subtle.
  const slideOffset = reducedMotion ? 0 : 24;

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, x: direction * slideOffset }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -direction * slideOffset, pointerEvents: 'none' }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        style={{ minHeight: '100%' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
