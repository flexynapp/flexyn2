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
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { X } from 'lucide-react';

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
  const y = useMotionValue(0);
  const opacity = useTransform(y, [0, 300], [1, 0]);

  // Prevent body scroll when sheet is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const handleDragEnd = (_e, info) => {
    if (info.velocity.y >= VELOCITY_THRESHOLD || info.offset.y >= DISTANCE_THRESHOLD) {
      onClose();
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="bs-backdrop"
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
            style={{ opacity }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Sheet panel */}
          <motion.div
            key="bs-panel"
            className={`fixed bottom-0 start-0 end-0 z-[201] bg-background rounded-t-2xl flex flex-col overflow-hidden ${className}`}
            style={{
              maxHeight,
              y,
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{
              type: 'spring',
              stiffness: 340,
              damping: 38,
              mass: 1,
            }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.3 }}
            onDragEnd={handleDragEnd}
            dragListener={true}
          >
            {/* Drag handle + title bar */}
            <div className="flex flex-col items-center pt-2.5 pb-1 px-4 cursor-grab active:cursor-grabbing shrink-0 select-none">
              {/* Pill indicator */}
              <div className="w-10 h-1 rounded-full bg-muted-foreground/25 mb-3" />

              {/* Title row */}
              {title && (
                <div className="w-full flex items-center justify-between mb-1">
                  <h2 className="font-heading font-bold text-base">{title}</h2>
                  <button
                    onClick={onClose}
                    className="w-8 h-8 rounded-full bg-secondary hover:bg-secondary/80 active:bg-secondary/80 flex items-center justify-center transition-colors shrink-0"
                    aria-label="Close"
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
