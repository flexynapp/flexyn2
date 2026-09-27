// src/components/feedback/FeedbackPill.jsx
//
// What a `toast.*()` call looks like since 2026-09-27: one dark pill that
// drops from the top of the screen, grows sideways into its message, plays
// its icon, and folds back up. It replaced sonner's box, which Kegan hated:
// it looked like every other web app, sat on top of the buttons you were
// pressing (the + sheet's water buttons, in his screenshot), and stacked.
//
// Why these choices:
//   • TOP, not bottom. Every sheet and every primary button in this app is
//     at the bottom, under the thumb. A message there covers the next tap.
//     The top edge is the one place nobody is pressing.
//   • ONE at a time, morphing. A new message reshapes the same pill rather
//     than stacking a second box (lib/feedbackStore.js has the queue rules).
//   • The same dark surface in every theme, like the phone's own island, so
//     it reads as the app talking rather than another card on the page.
//   • The icon is the moment: a check that draws in for a success, a mark
//     that shakes the pill for an error, an emoji that pops for a reward.
//     Haptics go through lib/haptic.js so the Settings switch still wins.
//
// Swipe it up or tap it to dismiss. A message with an action (Undo, Retry,
// Open) keeps a button on its right edge.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { subscribe, getSnapshot, dismiss } from '@/lib/feedbackStore';
import { triggerHaptic } from '@/lib/haptic';
import DrawnCheck from '@/components/feedback/DrawnCheck';

const HAPTIC = { success: 'success', error: 'warning', warning: 'warning' };

const SPRING = { type: 'spring', stiffness: 520, damping: 34, mass: 0.8 };

function Mark({ tone, children }) {
  return (
    <motion.svg
      viewBox="0 0 24 24" className={`w-5 h-5 ${tone}`} aria-hidden="true"
      initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING}
    >
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.18" />
      {children}
    </motion.svg>
  );
}

const ErrorMark = () => (
  <Mark tone="text-[hsl(var(--pill-danger))]">
    <path d="M12 6.5v7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    <circle cx="12" cy="17.2" r="1.5" fill="currentColor" />
  </Mark>
);

const WarningMark = () => (
  <Mark tone="text-primary">
    <path d="M12 6.5v7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    <circle cx="12" cy="17.2" r="1.5" fill="currentColor" />
  </Mark>
);

const InfoMark = () => (
  <Mark tone="text-[hsl(var(--pill-muted))]">
    <circle cx="12" cy="7.3" r="1.5" fill="currentColor" />
    <path d="M12 11v6.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
  </Mark>
);

function CustomIcon({ icon }) {
  // Call sites pass an emoji string (most of the 153) or a node.
  return (
    <motion.span
      className="w-5 h-5 inline-flex items-center justify-center text-base leading-none [&_svg]:w-5 [&_svg]:h-5"
      aria-hidden="true"
      initial={{ scale: 0.3, rotate: -20 }} animate={{ scale: [0.3, 1.3, 1], rotate: 0 }}
      transition={{ duration: 0.5, times: [0, 0.55, 1] }}
    >
      {icon}
    </motion.span>
  );
}

function Icon({ item }) {
  if (item.icon) return <CustomIcon icon={item.icon} />;
  if (item.kind === 'success') return <DrawnCheck className="w-5 h-5 text-[hsl(var(--pill-success))]" />;
  if (item.kind === 'error') return <ErrorMark />;
  if (item.kind === 'warning') return <WarningMark />;
  return <InfoMark />;
}

export default function FeedbackPill() {
  const { current } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const lastKey = useRef(null);

  useEffect(() => {
    if (!current || current.key === lastKey.current) return;
    lastKey.current = current.key;
    const h = HAPTIC[current.kind];
    if (h) triggerHaptic(h);
  }, [current]);

  const tall = !!current && (!!current.description || String(current.message ?? '').length > 40);

  return (
    <div
      className="fixed inset-x-0 z-[400] flex justify-center px-4 pointer-events-none"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
      data-feedback-pill-host=""
    >
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {current && current.kind !== 'error' ? [current.message, current.description].filter(Boolean).join('. ') : ''}
      </div>
      <div role="alert" className="sr-only">
        {current && current.kind === 'error' ? [current.message, current.description].filter(Boolean).join('. ') : ''}
      </div>
      <AnimatePresence>
        {current && (
          <motion.div
            key="pill"
            layout
            data-feedback-pill=""
            className={`pointer-events-auto max-w-[min(420px,100%)] overflow-hidden bg-[hsl(var(--pill-bg))] text-[hsl(var(--pill-fg))] shadow-md ring-1 ring-white/10 ${tall ? 'rounded-2xl' : 'rounded-full'}`}
            initial={{ y: -48, scale: 0.5, opacity: 0 }}
            animate={current.kind === 'error'
              ? { y: 0, scale: 1, opacity: 1, x: [0, -7, 6, -4, 2, 0] }
              : { y: 0, scale: 1, opacity: 1, x: 0 }}
            exit={{ y: -40, scale: 0.7, opacity: 0, transition: { duration: 0.2 } }}
            transition={{ ...SPRING, x: { duration: 0.4, delay: 0.1 } }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.6, bottom: 0.1 }}
            onDragEnd={(_e, info) => { if (info.offset.y < -16 || info.velocity.y < -300) dismiss(current.id); }}
            onClick={() => { if (!current.action) dismiss(current.id); }}
          >
            <motion.div
              key={current.key}
              layout="position"
              className="flex items-center gap-2 ps-3 pe-4 py-2 min-h-11"
              initial={{ opacity: 0, filter: 'blur(4px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.2, delay: 0.06 }}
            >
              <span className="shrink-0 flex" aria-hidden="true"><Icon item={current} /></span>
              {/* The live regions above announce the text; hiding it here
                  stops a screen reader reading it twice. The action button
                  stays reachable. */}
              <span className="min-w-0 flex flex-col" aria-hidden="true">
                <span className="text-sm font-semibold leading-snug">{current.message}</span>
                {current.description && (
                  <span className="text-xs leading-snug text-[hsl(var(--pill-muted))]">{current.description}</span>
                )}
              </span>
              {current.action && (
                <button
                  type="button"
                  className="shrink-0 self-stretch -my-2 -me-4 ms-1 min-h-11 px-4 rounded-e-full text-sm font-semibold text-primary hover:bg-white/10 active:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    try { current.action.onClick?.(e); } finally { dismiss(current.id); }
                  }}
                >
                  {current.action.label}
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
