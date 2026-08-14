/**
 * BottomSheet — mobile-native slide-up sheet with swipe-down-to-dismiss.
 *
 * Drop-in replacement for Dialog for mobile-first surfaces. On desktop
 * (lg+) it renders as a centered dialog. On mobile it slides up from the
 * bottom and can be dismissed by:
 *   • Swiping down > 80 px on the handle / header
 *   • Tapping the backdrop
 *   • Dragging with velocity ≥ 300 px/s
 *
 * Usage:
 *   <BottomSheet open={open} onClose={close} title="My Sheet">
 *     {children}
 *   </BottomSheet>
 *
 * Props:
 *   open      boolean            — controlled open state
 *   onClose   () => void         — called when user dismisses
 *   title     string             — modal title (rendered in drag-handle bar)
 *   maxHeight string             — CSS max-height for content area (default '85dvh')
 *   snapPoints boolean           — future: multi-snap (not yet implemented)
 *   className string             — extra classes on the panel
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useMotionValue, useTransform, useDragControls } from 'framer-motion';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import prefersReducedMotion from '@/lib/reducedMotion';
import { useLanguage } from '@/lib/LanguageContext';

// Velocity threshold for swipe-to-dismiss (px/s)
const VELOCITY_THRESHOLD = 300;
// Y distance threshold (px) to dismiss on drag end
const DISTANCE_THRESHOLD = 80;

export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  maxHeight = '90dvh',
  className = '',
}) {
  const { tFallback } = useLanguage();
  const y = useMotionValue(0);
  // Backdrop fade tied to how far the sheet has been dragged down. Applied
  // to its own element — see the backdrop below for why it cannot share
  // one with the enter/exit fade.
  const dragFade = useTransform(y, [0, 300], [1, 0]);

  // A full-height slide is the largest movement this app makes. Under
  // `prefers-reduced-motion` it cross-fades in place instead — the sheet
  // still DRAGS, because dragging is a gesture the user drives, not an
  // animation played at them.
  const reduced = prefersReducedMotion();

  // Drives the backdrop's CSS fade. Starts false on mount so the first
  // paint is transparent and the transition has somewhere to travel from.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) { setShown(false); return; }
    // Next frame, so the browser paints opacity 0 before it sees 1.
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Prevent body scroll when sheet is open
  useBodyScrollLock(open);

  const handleDragEnd = (_e, info) => {
    if (info.velocity.y >= VELOCITY_THRESHOLD || info.offset.y >= DISTANCE_THRESHOLD) {
      onClose();
    }
  };

  // The drag starts on the handle bar, not on the panel. The doc comment at
  // the top of this file has always said "swiping down on the handle /
  // header" — the implementation put `dragListener` on the whole panel
  // instead, and that is what made the sheet's own content unscrollable.
  //
  // framer writes `touch-action: pan-x` onto a `drag="y"` element whose
  // listener is live (render/html/use-props.mjs). touch-action is resolved
  // by intersecting the value down the ancestor chain, so pan-x on the panel
  // forbids vertical panning for everything inside it — including the
  // `overflow-y-auto` content div two lines below. Worse, `dragConstraints`
  // pins the top at 0, so swiping UP — the gesture for reading further down
  // a list — moved nothing and scrolled nothing. Anything below the fold in
  // a sheet was simply unreachable by touch.
  //
  // Same framer branch, same fix, as ReorderableRow in components/dashboard.
  const dragControls = useDragControls();

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — CSS fade over a motion-value fade, two elements.
              It was ONE div carrying both `style={{ opacity }}` (the
              drag-linked value) and initial/animate/exit opacity keyframes.
              Framer will not own one property twice, so the element sat at
              its `initial` and rendered `opacity: 0` FOREVER — on every
              sheet in the app, not just this one. Measured in the browser
              (computed 0, inline `opacity: 0`, flat across a second), not
              inferred, and it survived a full reload.
              Nothing threw and nothing looked obviously broken: the sheet
              opens, and a tap on the invisible layer still dismisses it.
              What was missing is the only thing that says the page behind
              is inert — most of what makes a sheet read as a raised
              surface rather than as more page.
              The enter fade is now plain CSS rather than framer. Splitting
              the two properties across two elements was not enough on its
              own: a bare `initial`/`animate` opacity pair on the outer
              element still never ran here, while the panel's `y` animates
              normally beside it. CSS has no such ambiguity, and the
              multiplication of the two layers' opacities is free.
              `backdrop-blur-sm` went with it — glassmorphism is on the
              banned list in docs/ui-craft-prompt.md, and a layer that has
              never once been visible cannot regress by losing it. */}
          <div
            key="bs-backdrop"
            className="fixed inset-0 z-[200] transition-opacity duration-200"
            style={{ opacity: shown ? 1 : 0 }}
            onClick={onClose}
            aria-hidden="true"
          >
            <motion.div className="absolute inset-0 bg-black/60" style={{ opacity: dragFade }} />
          </div>

          {/* Sheet panel */}
          <motion.div
            key="bs-panel"
            className={`fixed bottom-0 start-0 end-0 z-[201] bg-background rounded-t-2xl flex flex-col overflow-hidden ${className}`}
            style={{
              maxHeight,
              y,
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
            initial={reduced ? { opacity: 0 } : { y: '100%' }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: '100%' }}
            transition={reduced ? { duration: 0.12 } : {
              type: 'spring',
              stiffness: 340,
              damping: 38,
              mass: 1,
            }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.3 }}
            onDragEnd={handleDragEnd}
            dragListener={false}
            dragControls={dragControls}
          >
            {/* Drag handle + title bar — `touch-none` because this bar is now
                the one element that claims the vertical gesture. The close
                button inside it is excluded: a pointerdown that starts a drag
                would otherwise swallow the tap. */}
            <div
              onPointerDown={(e) => {
                if (e.target.closest('button')) return;
                dragControls.start(e);
              }}
              className="flex flex-col items-center pt-2.5 pb-1 px-4 cursor-grab active:cursor-grabbing shrink-0 select-none touch-none"
            >
              {/* Pill indicator */}
              <div className="w-10 h-1 rounded-full bg-muted-foreground/25 mb-3" />

              {/* Title row */}
              {title && (
                <div className="w-full flex items-center justify-between mb-1">
                  <h2 className="font-heading font-bold text-base">{title}</h2>
                  <button
                    onClick={onClose}
                    className="w-8 h-8 rounded-full bg-secondary hover:bg-secondary/80 active:bg-secondary/80 flex items-center justify-center transition-colors shrink-0"
                    aria-label={tFallback("common.close", "Close")}
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              )}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
