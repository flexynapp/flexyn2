// src/components/OneShotTooltip.jsx
//
// Floating "hint" tooltip that fires EXACTLY ONCE per user/device per
// registered id. Each new feature gets one shot at a hint, then never
// shows it again. The "never again" is the trust contract — users
// learn the app trusts them to remember.
//
// USAGE
//
//   <OneShotTooltip
//     id={TOOLTIP.LONG_PRESS_TABS}
//     anchorRef={tabRef}
//     placement="top"
//   >
//     Hold any tab for shortcuts.
//   </OneShotTooltip>
//
// PROPS
//
//   id           Registered tooltip id from tooltipRegistry.
//   anchorRef    React ref to the element this tooltip points at.
//                Used to compute position (above/below the anchor).
//   placement    'top' | 'bottom'. Default 'top'.
//   children     Tooltip body text or React node.
//   delayMs      How long after mount before fading in. Default 600ms
//                — lets the user finish whatever interaction triggered
//                the mount before the tooltip pops up.
//   durationMs   How long the tooltip stays visible. Default 3000ms.

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { hasSeenTooltip, markTooltipSeen } from '@/lib/tooltipRegistry';

const DEFAULT_DELAY = 600;
const DEFAULT_DURATION = 3000;

export default function OneShotTooltip({
  id,
  anchorRef,
  placement = 'top',
  children,
  delayMs = DEFAULT_DELAY,
  durationMs = DEFAULT_DURATION,
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (!id) return;
    if (hasSeenTooltip(id)) return;
    if (!anchorRef?.current) return;

    fired.current = true;
    const showTimer = setTimeout(() => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      setRect(r);
      setOpen(true);
      markTooltipSeen(id);
    }, delayMs);

    return () => clearTimeout(showTimer);
  }, [id, anchorRef, delayMs]);

  // Auto-hide after `durationMs` of being visible. Also dismiss on
  // any tap inside the document (so the user can dismiss early by
  // doing literally anything).
  useEffect(() => {
    if (!open) return;
    const hideTimer = setTimeout(() => setOpen(false), durationMs);
    const dismissOnAnyTap = () => setOpen(false);
    // Slight delay so the same tap that triggered the mount doesn't
    // immediately dismiss the tooltip.
    const armTimer = setTimeout(() => {
      window.addEventListener('mousedown', dismissOnAnyTap, { once: true });
      window.addEventListener('touchstart', dismissOnAnyTap, { once: true });
      window.addEventListener('keydown', dismissOnAnyTap, { once: true });
    }, 200);
    return () => {
      clearTimeout(hideTimer);
      clearTimeout(armTimer);
      window.removeEventListener('mousedown', dismissOnAnyTap);
      window.removeEventListener('touchstart', dismissOnAnyTap);
      window.removeEventListener('keydown', dismissOnAnyTap);
    };
  }, [open, durationMs]);

  if (!rect) return null;

  // Center horizontally above/below the anchor.
  const left = rect.left + rect.width / 2;
  const isTop = placement === 'top';
  const top = isTop ? rect.top - 12 : rect.bottom + 12;
  const transform = `translate(-50%, ${isTop ? '-100%' : '0'})`;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: isTop ? 4 : -4, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: isTop ? 4 : -4, scale: 0.96 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            left,
            top,
            transform,
            zIndex: 60,
            pointerEvents: 'none',
          }}
        >
          <div className="relative max-w-[240px] px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium shadow-lg">
            {children}
            <div
              aria-hidden="true"
              className="absolute start-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-primary"
              style={isTop ? { bottom: -3 } : { top: -3 }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
